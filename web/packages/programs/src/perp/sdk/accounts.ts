import { Pubkey } from '@thru/sdk';
import { ACCOUNT_CREATION_RESOURCES } from '../../resources';
import { parseTokenAccountData } from '../../token/accounts';
import { deriveTokenAccountAddress } from '../../token/derivation';
import { createInitializeAccountInstruction } from '../../token/instructions/initialize-account';
import { accountStatuses, restoreArchivedAccounts } from './compression';
import type { PerpDeployment, PerpDeploymentQuoteMint } from './deployment';
import { txHeaderCache, type TxHeaderClient } from './header-cache';
import { hexToBytes } from './instructions';
import { accountExists, getStateProof, isArchivedAccount, isNotFound, normalizeAddress, readAccount, waitForAccount, type ThruClient } from './rpc';
import { sendAndConfirm } from './send';
import { createKeypairSigner, type PerpsSigner } from './signers';
import { submitPerpTransaction, type PerpSubmitOptions } from './submit';

/* The accounts a new key needs before it can trade.

   A key pays for its own transactions, so its account (the fee payer)
   must exist on chain; deposits draw from, and withdrawals pay into, the
   owner's canonical token account for the market's quote mint (the one
   deriveTokenAccountAddress gives with its default seed), which must exist
   too.  A fresh key has neither.  ensurePerpsAccounts creates both and is
   idempotent; it does not fund the token account (on Betanet the hosted
   faucet funds an existing token account).

   Accounts the chain archived (state compression) are restored instead of
   created: a deposit or withdrawal does not restore its token account
   unless it is sent with `archived`. */

/** A local key: `privateKey` (32 bytes, or hex) or `privateKeyHex`, the
    key file shape keypairSignerFromJSON reads. */
export type PerpsKeyInput = { address: string; privateKey: Uint8Array | string } | { address: string; privateKeyHex: string };

export interface PerpsFeePayerAccount {
  address: string;
  /** 'existing': it was active; 'created' or 'restored' by this call. */
  status: 'existing' | 'created' | 'restored';
}

export interface PerpsQuoteTokenAccountState {
  symbol: string;
  mint: string;
  owner: string;
  /** The canonical token account: deposits draw from it, withdrawals pay into it. */
  address: string;
  exists: boolean;
  /** It exists but state compression archived it: it must be restored
      before a transaction can use it (ensureQuoteTokenAccount does). */
  archived: boolean;
  /** Its balance in quote atoms (0 when it does not exist; an archived
      account's archived balance). */
  amount: bigint;
}

export interface PerpsQuoteTokenAccount extends Omit<PerpsQuoteTokenAccountState, 'exists' | 'archived'> {
  /** 'existing': it was active; 'created' or 'restored' by this call. */
  status: 'existing' | 'created' | 'restored';
}

export interface PerpsAccountsSetup {
  feePayer: PerpsFeePayerAccount;
  tokenAccounts: PerpsQuoteTokenAccount[];
}

/** What these helpers need of a client: a PerpsClient fits. */
export interface PerpsAccountsContext {
  thru: ThruClient;
  deployment: Pick<PerpDeployment, 'tokenProgram' | 'quoteMints' | 'markets'>;
}

function keyBytes(key: PerpsKeyInput): { address: string; privateKey: Uint8Array } {
  const raw = 'privateKeyHex' in key ? key.privateKeyHex : key.privateKey;
  const privateKey = typeof raw === 'string' ? hexToBytes(raw) : new Uint8Array(raw);
  if (privateKey.length !== 32) throw new Error('privateKey must be 32 bytes');
  return { address: normalizeAddress(key.address), privateKey };
}

/** Makes the key's account usable as a fee payer: creates it when it never
    existed (the key signs its own creation) and restores it when state
    compression archived it.  Checks that the private key belongs to
    `key.address` first. */
export async function ensureFeePayerAccount(thru: ThruClient, key: PerpsKeyInput): Promise<PerpsFeePayerAccount> {
  const { address, privateKey } = keyBytes(key);
  const derived = Pubkey.from(await thru.keys.fromPrivateKey(privateKey)).toThruFmt();
  if (derived !== address) throw new Error(`the private key does not belong to ${address}`);
  if (await accountExists(thru, address, { archived: false })) return { address, status: 'existing' };
  const [state] = await accountStatuses(thru, [address]);
  if (state?.status === 'ACTIVE') return { address, status: 'existing' };
  /* Either way the key's nonce moves: a cached one is stale. */
  const headers = txHeaderCache(thru as unknown as TxHeaderClient);
  if (state?.status === 'COMPRESSED') {
    await restoreArchivedAccounts(thru, { accounts: [], signer: { kind: 'keypair', publicKey: address, privateKey } });
    headers.invalidate(address);
    return { address, status: 'restored' };
  }
  const transaction = await thru.accounts.create({ header: ACCOUNT_CREATION_RESOURCES, publicKey: address });
  await transaction.sign(privateKey);
  await sendAndConfirm(thru, transaction.toWire(), `create account ${address}`);
  headers.invalidate(address);
  await waitForAccount(thru, address, 'fee payer account');
  return { address, status: 'created' };
}

/** A quote mint of the deployment by symbol (case-insensitive) or address;
    by default the one quote mint its markets use. */
export function perpsQuoteMint(deployment: Pick<PerpDeployment, 'quoteMints' | 'markets'>, quote?: string): PerpDeploymentQuoteMint {
  const symbols = [...new Set(deployment.markets.map((market) => market.quoteSymbol))];
  if (quote === undefined && symbols.length !== 1) throw new Error(`the markets use ${symbols.length} quote mints (${symbols.join(', ')}); pass quote`);
  const wanted = quote ?? symbols[0]!;
  const mint = deployment.quoteMints.find((entry) => entry.symbol.toUpperCase() === wanted.toUpperCase() || entry.address === wanted);
  if (!mint) throw new Error(`unknown quote mint ${wanted}; known: ${deployment.quoteMints.map((entry) => entry.symbol).join(', ')}`);
  return mint;
}

/** The owner's canonical token account for a quote mint (default: the
    markets' one) as it is now.  A transient read failure is thrown, not
    reported as a missing account. */
export async function readQuoteTokenAccount(perps: PerpsAccountsContext, owner: string, quote?: string): Promise<PerpsQuoteTokenAccountState> {
  const mint = perpsQuoteMint(perps.deployment, quote);
  const holder = normalizeAddress(owner);
  const { address } = deriveTokenAccountAddress(perps.thru, holder, mint.address, perps.deployment.tokenProgram);
  const base = { symbol: mint.symbol, mint: mint.address, owner: holder, address };
  try {
    const account = await readAccount(perps.thru, address);
    const parsed = parseTokenAccountData(account);
    if (normalizeAddress(parsed.mint) !== normalizeAddress(mint.address)) throw new Error(`token account ${address} is not of the ${mint.symbol} mint`);
    return { ...base, exists: true, archived: isArchivedAccount(account), amount: parsed.amount };
  } catch (error) {
    if (isNotFound(error)) return { ...base, exists: false, archived: false, amount: 0n };
    throw error;
  }
}

/** Creates the owner's canonical token account for a quote mint (default:
    the markets' one) when it does not exist, with the token program's
    initialize_account: `payer` (any signer: a key, or a wallet) signs and
    pays, the owner (default: the payer's address) need not sign.  An
    archived one is restored instead, signed by `submit.archived.signer`
    (without it, an archived account is refused). */
export async function ensureQuoteTokenAccount(
  perps: PerpsAccountsContext,
  payer: PerpsSigner,
  options: { owner?: string; quote?: string; submit?: PerpSubmitOptions } = {},
): Promise<PerpsQuoteTokenAccount> {
  const owner = normalizeAddress(options.owner ?? payer.address);
  const account = await readQuoteTokenAccount(perps, owner, options.quote);
  if (account.archived) {
    const restore = options.submit?.archived;
    if (!restore) throw new Error(`the ${account.symbol} token account ${account.address} is archived; pass submit.archived to restore it`);
    /* As submitPerpTransaction does: nothing is signed before the chain check. */
    await options.submit?.checkChain?.();
    await restoreArchivedAccounts(perps.thru, {
      accounts: [account.address],
      signer: restore.signer,
      ...(restore.onRestoring ? { onRestoring: restore.onRestoring } : {}),
      ...(restore.timeoutMs !== undefined ? { timeoutMs: restore.timeoutMs } : {}),
      ...(restore.signal ? { signal: restore.signal } : {}),
    });
    await waitForAccount(perps.thru, account.address, `${account.symbol} token account`);
    return withStatus(await readQuoteTokenAccount(perps, owner, options.quote), 'restored');
  }
  if (account.exists) return withStatus(account, 'existing');
  const proof = await getStateProof(perps.thru, account.address, `the ${account.symbol} token account`);
  await submitPerpTransaction(
    perps.thru,
    payer,
    {
      programAddress: perps.deployment.tokenProgram,
      label: `create ${account.symbol} token account for ${owner}`,
      tx: {
        instructionData: createInitializeAccountInstruction({
          tokenAccountBytes: Pubkey.from(account.address).toBytes(),
          mintAccountBytes: Pubkey.from(account.mint).toBytes(),
          ownerAccountBytes: Pubkey.from(owner).toBytes(),
          seedBytes: new Uint8Array(32),
          stateProof: proof,
        }),
        readWrite: [account.address],
        /* The signer's own address is in every transaction it signs. */
        readOnly: owner === payer.address ? [account.mint] : [account.mint, owner],
        stateUnits: 1,
      },
    },
    options.submit,
  );
  await waitForAccount(perps.thru, account.address, `${account.symbol} token account`);
  return withStatus(await readQuoteTokenAccount(perps, owner, options.quote), 'created');
}

function withStatus(state: PerpsQuoteTokenAccountState, status: PerpsQuoteTokenAccount['status']): PerpsQuoteTokenAccount {
  return { symbol: state.symbol, mint: state.mint, owner: state.owner, address: state.address, status, amount: state.amount };
}

/** From a fresh key to one that can deposit: creates (or restores) the
    key's fee payer account, then its canonical token account for every
    quote mint the deployment's markets use (or `quotes`), restoring an
    archived mint or token account.  Idempotent: safe to run at every start.  Funding
    the token account is up to you (a faucet, or a transfer). */
export async function ensurePerpsAccounts(perps: PerpsAccountsContext, key: PerpsKeyInput, options: { quotes?: string[] } = {}): Promise<PerpsAccountsSetup> {
  const feePayer = await ensureFeePayerAccount(perps.thru, key);
  const { privateKey } = keyBytes(key);
  const signer = createKeypairSigner({ address: feePayer.address, privateKey, verified: true });
  const quotes = options.quotes ?? [...new Set(perps.deployment.markets.map((market) => market.quoteSymbol))];
  const tokenAccounts: PerpsQuoteTokenAccount[] = [];
  for (const quote of quotes) {
    tokenAccounts.push(
      await ensureQuoteTokenAccount(perps, signer, {
        quote,
        submit: { archived: { signer: { kind: 'keypair', publicKey: feePayer.address, privateKey } } },
      }),
    );
  }
  return { feePayer, tokenAccounts };
}
