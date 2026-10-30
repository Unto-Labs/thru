import { Pubkey } from '@thru/sdk';
import { buildAccountContext } from '../../wallet/context';
import { programResources } from '../../resources';
import { txHeaderCache, type TxHeaderClient } from './header-cache';
import { bytesToHex, hexToBytes } from './instructions';
import type { ThruClient } from './rpc';
import type { PerpTxParts } from './tx';

/* Signers.

   A signer turns an unsigned perp transaction into signed wire bytes:
   - a keypair signer (bots, agents, scripts) builds the transaction with
     the key as fee payer and signs it locally;
   - a wallet signer (browser) hands the wallet a transaction intent; the
     wallet's managed fee payer pays and the wallet program wraps the call,
     so the perp program goes first among the read-only accounts;
   - a session signer is a wallet signer whose intents a signing session
     (a short-lived key the wallet program authorizes, @thru/wallet's
     ThruSigningSession) signs without a prompt per transaction.
   Signers are structural: nothing here imports a wallet package. */

export interface PerpsSignRequest {
  thru: ThruClient;
  programAddress: string;
  tx: PerpTxParts & { label?: string };
  /** Read the fee payer's nonce again instead of using a cached one. */
  fresh?: boolean;
}

export interface PerpsSignedTransaction {
  /** Signed wire bytes. */
  raw: Uint8Array;
  /** The nonce came from a cache: on a nonce reject, sign again with `fresh`. */
  nonceCached?: boolean;
  /** Report the outcome (keeps the keypair signer's nonce cache right). */
  confirmed?(): void;
  failed?(): void;
}

export interface PerpsSigner {
  /** 'keypair' | 'wallet' | 'session' (or a custom signer's own). */
  readonly kind: string;
  /** The account whose seats and margin accounts the transactions act on
      (the seat authority): the key's address, or the wallet address. */
  readonly address: string;
  sign(request: PerpsSignRequest): Promise<PerpsSignedTransaction>;
  /** Starts the reads the next `sign` needs (the keypair signer's header
      fields), so they overlap the work before signing. */
  prepare?(thru: ThruClient): void;
  /** Drops what `prepare` or an earlier confirmed transaction cached (the
      next `sign` reads again). */
  invalidate?(thru: ThruClient): void;
}

/* Keypair *************************************************************************/

export interface KeypairSignerInput {
  address: string;
  /** 32-byte ed25519 private key (or hex). */
  privateKey: Uint8Array | string;
  /** The caller already checked that the key belongs to `address` (as the
      perps tools do when loading a key file); skips that check. */
  verified?: boolean;
}

/** A local key that pays for and signs its own transactions.  The header
    fields (nonce, start slot, chain id) come from the client's
    TxHeaderCache: after a confirmed transaction the next nonce is known
    without a read (the fast path of the perps tools). */
export function createKeypairSigner(input: KeypairSignerInput): PerpsSigner {
  const address = Pubkey.from(input.address).toThruFmt();
  const privateKey = typeof input.privateKey === 'string' ? hexToBytes(input.privateKey) : new Uint8Array(input.privateKey);
  if (privateKey.length !== 32) throw new Error('privateKey must be 32 bytes');
  let verified = input.verified === true;
  const headersOf = (thru: ThruClient) => txHeaderCache(thru as unknown as TxHeaderClient);
  return {
    kind: 'keypair',
    address,
    async sign({ thru, programAddress, tx, fresh }) {
      if (!verified) {
        const derived = Pubkey.from(await thru.keys.fromPrivateKey(privateKey)).toThruFmt();
        if (derived !== address) throw new Error(`the private key does not belong to ${address}`);
        verified = true;
      }
      const headers = headersOf(thru);
      const { nonceCached, ...fields } = await headers.fields(address, { fresh });
      const transaction = await thru.transactions.build({
        feePayer: { publicKey: address },
        program: programAddress,
        instructionData: tx.instructionData,
        accounts: { readWrite: tx.readWrite, readOnly: tx.readOnly },
        header: { ...programResources({ stateUnits: tx.stateUnits }), fee: 0n, ...fields },
      });
      await transaction.sign(privateKey);
      return {
        raw: transaction.toWire(),
        nonceCached,
        confirmed: () => headers.confirmed(address, fields.nonce),
        failed: () => headers.invalidate(address),
      };
    },
    prepare(thru) {
      headersOf(thru).prefetch(address);
    },
    invalidate(thru) {
      headersOf(thru).invalidate(address);
    },
  };
}

/** The perps tools' key file shape: { address, privateKeyHex }. */
export function keypairSignerFromJSON(json: { address: string; privateKeyHex: string }): PerpsSigner {
  return createKeypairSigner({ address: json.address, privateKey: json.privateKeyHex });
}

/* Wallet and session ***********************************************************/

/** The transaction intent a Thru wallet signs (@thru/sdk ThruTransactionIntent). */
export interface PerpsWalletIntent {
  stateUnits?: number;
  walletAddress?: string;
  programAddress: string;
  /** base64 */
  instructionData: string;
  readWriteAddresses?: string[];
  readOnlyAddresses?: string[];
  review?: unknown;
}

/** What a wallet signer needs of a wallet (@thru/wallet's IThruChain fits). */
export interface PerpsWalletLike {
  getSigningContext(): Promise<{ feePayerPublicKey: string }>;
  signTransaction(intent: PerpsWalletIntent): Promise<string>;
}

export interface WalletSignerInput {
  wallet: PerpsWalletLike;
  walletAddress: string;
  /** The review payload the wallet shows; default: the label and the raw instruction. */
  review?: (tx: PerpsSignRequest['tx'], instructionBytes: Uint8Array, programAddress: string) => unknown;
  appName?: string;
}

/** A browser wallet: each transaction is an intent the wallet signs (and
    may ask the user to approve). */
export function createWalletSigner(input: WalletSignerInput): PerpsSigner {
  return walletSigner('wallet', input.walletAddress, input.wallet.getSigningContext.bind(input.wallet), input.wallet.signTransaction.bind(input.wallet), input);
}

/** What a session signer needs of a signing session (@thru/wallet's ThruSigningSession fits). */
export interface PerpsSigningSessionLike {
  walletAddress: string;
  signTransaction(intent: PerpsWalletIntent): Promise<string>;
}

export interface SessionSignerInput {
  session: PerpsSigningSessionLike;
  /** The wallet whose managed fee payer pays (its getSigningContext). */
  wallet: Pick<PerpsWalletLike, 'getSigningContext'>;
  review?: WalletSignerInput['review'];
  appName?: string;
}

/** A signing session: intents are signed by the session key the wallet
    program authorized (no prompt per transaction until it expires). */
export function createSessionSigner(input: SessionSignerInput): PerpsSigner {
  return walletSigner('session', input.session.walletAddress, input.wallet.getSigningContext.bind(input.wallet), input.session.signTransaction.bind(input.session), input);
}

function walletSigner(
  kind: string,
  walletAddress: string,
  getSigningContext: PerpsWalletLike['getSigningContext'],
  signTransaction: PerpsWalletLike['signTransaction'],
  input: { review?: WalletSignerInput['review']; appName?: string },
): PerpsSigner {
  const address = Pubkey.from(walletAddress).toThruFmt();
  return {
    kind,
    address,
    async sign({ programAddress, tx }) {
      const signingContext = await getSigningContext();
      const context = buildAccountContext({
        walletAddress: address,
        feePayerAddress: signingContext.feePayerPublicKey,
        readWriteAccounts: tx.readWrite.map((entry) => Pubkey.from(entry).toBytes()),
        readOnlyAccounts: [Pubkey.from(programAddress).toBytes(), ...tx.readOnly.map((entry) => Pubkey.from(entry).toBytes())],
      });
      const instructionBytes = await tx.instructionData(context);
      const review =
        input.review?.(tx, instructionBytes, programAddress) ?? {
          appName: input.appName ?? 'Thru perps',
          programAddress,
          abiName: 'tn_perp_program',
          instruction: tx.label ?? 'perp transaction',
          abiReflection: { label: tx.label ?? 'perp transaction', kind: 'transaction', typeName: 'tn_perp_program.transaction', rawHex: bytesToHex(instructionBytes), source: 'perps-sdk' },
        };
      const signed = await signTransaction({
        walletAddress: address,
        programAddress,
        instructionData: bytesToBase64(instructionBytes),
        stateUnits: tx.stateUnits,
        readWriteAddresses: context.readWriteAddresses,
        readOnlyAddresses: context.readOnlyAddresses,
        review,
      });
      return { raw: base64ToBytes(signed) };
    },
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
