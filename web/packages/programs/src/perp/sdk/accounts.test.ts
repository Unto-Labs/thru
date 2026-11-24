import { describe, expect, it, vi } from 'vitest';
import { Pubkey } from '@thru/sdk';
import { ACCOUNT_CREATION_RESOURCES } from '../../resources';
import { deriveTokenAccountAddress } from '../../token/derivation';
import { TokenAccountBuilder, TokenProgramAccount } from '../../token/abi/thru/program/token/types';
import { ensureFeePayerAccount, ensurePerpsAccounts, ensureQuoteTokenAccount, perpsQuoteMint, readQuoteTokenAccount } from './accounts';
import { createKeypairSigner, type PerpsSigner } from './signers';
import { address, fixtureDeployment, fixtureMarket } from './test-fixtures';

/* The accounts a fresh key needs (accounts.ts), against a stand-in RPC
   that creates what the transactions it executes create. */

const KEY = { address: address(50), privateKeyHex: '07'.repeat(32) };
const OTHER = address(51);
const deployment = fixtureDeployment([{ symbol: 'BTC-UUSD', market: fixtureMarket(10) }]);
const MINT = deployment.quoteMints[0]!.address;

const CREATE_TAG = 1;
const PROGRAM_TAG = 2;

type Status = 'ACTIVE' | 'COMPRESSED' | 'DOES_NOT_EXIST';

/** A token account's bytes: the token program's account_type byte, then the account. */
function tokenAccountBytes(owner: string, amount: bigint): Uint8Array {
  const account = new TokenAccountBuilder().set_mint(Pubkey.from(MINT).toBytes()).set_owner(Pubkey.from(owner).toBytes()).set_amount(amount).set_is_frozen(0).build();
  return TokenProgramAccount.builder().payload().select('token_account_v1').writePayload(account).finish().build();
}

/** A creation state proof with no siblings (the shape the token program's
    initialize_account validates). */
function creationProof(): Uint8Array {
  const proof = new Uint8Array(104);
  new DataView(proof.buffer).setBigUint64(0, 2n << 62n, true);
  return proof;
}

async function rpc(options: { feePayer?: Status; mint?: Status; keyOwner?: string; archivedTokenOwner?: string } = {}) {
  const helpers = await import('@thru/sdk').then(({ deriveAddress, deriveProgramAddress }) => ({ deriveAddress, deriveProgramAddress }));
  const live = new Map<string, Uint8Array>();
  const statuses = new Map<string, Status>([[MINT, options.mint ?? 'ACTIVE']]);
  if ((options.feePayer ?? 'DOES_NOT_EXIST') === 'ACTIVE') live.set(KEY.address, new Uint8Array(0));
  statuses.set(KEY.address, options.feePayer ?? 'DOES_NOT_EXIST');
  const tokenAccount = (owner: string) => deriveTokenAccountAddress({ helpers } as never, owner, MINT, deployment.tokenProgram).address;
  const tokenData = (owner: string, amount = 0n) => tokenAccountBytes(owner, amount);
  /* State compression's archive: read with a version context, restored by decompressAccounts. */
  const archived = new Map<string, Uint8Array>();
  if (options.archivedTokenOwner) {
    archived.set(tokenAccount(options.archivedTokenOwner), tokenData(options.archivedTokenOwner, 25n));
    statuses.set(tokenAccount(options.archivedTokenOwner), 'COMPRESSED');
  }
  /* Program transactions the stand-in built: what executing them creates. */
  const pending: Array<() => void> = [];
  const built: Array<{ program: string; readWrite: string[]; readOnly: string[]; stateUnits: number; ownerIndex: number }> = [];
  let sent = 0;
  const wire = (tag: number) => {
    const raw = new Uint8Array(176);
    raw[0] = tag;
    raw[175] = ++sent;
    return raw;
  };
  const initialize = (account: string, owner: string) => () => live.set(account, tokenData(owner));
  const thru = {
    helpers,
    keys: { fromPrivateKey: vi.fn(async () => options.keyOwner ?? KEY.address) },
    accounts: {
      get: vi.fn(async (addr: string, read?: { versionContext?: unknown }) => {
        const data = live.get(addr) ?? (read?.versionContext ? archived.get(addr) : undefined);
        if (!data) throw new Error(`account ${addr} not found`);
        return { data: { data }, meta: { nonce: 4n, flags: { isDeleted: false } } };
      }),
      create: vi.fn(async () => ({ sign: vi.fn(async () => {}), toWire: () => wire(CREATE_TAG) })),
    },
    compression: {
      getAccountStatuses: vi.fn(async ({ accounts }: { accounts: string[] }) => accounts.map((entry) => ({ address: entry, status: statuses.get(entry) ?? 'DOES_NOT_EXIST' }))),
      decompressAccounts: vi.fn(async ({ accounts }: { accounts: string[] }) => {
        for (const entry of accounts) {
          statuses.set(entry, 'ACTIVE');
          live.set(entry, archived.get(entry) ?? new Uint8Array(0));
          archived.delete(entry);
        }
        return { accounts: accounts.map((entry) => ({ address: entry, status: 'restored' })), signatures: ['restore'] };
      }),
    },
    proofs: { generate: vi.fn(async () => ({ proof: creationProof() })) },
    chain: { getChainId: vi.fn(async () => 2) },
    blocks: { getBlockHeight: vi.fn(async () => ({ finalized: 100n })) },
    transactions: {
      build: vi.fn(async (params: { feePayer: { publicKey: string }; program: string; instructionData: (ctx: unknown) => Promise<Uint8Array>; accounts: { readWrite: string[]; readOnly: string[] }; header: { stateUnits: number } }) => {
        const order = [params.feePayer.publicKey, params.program, ...params.accounts.readWrite, ...params.accounts.readOnly];
        let ownerIndex = -1;
        await params.instructionData({
          getAccountIndex: (bytes: Uint8Array) => {
            const index = order.indexOf(Pubkey.from(bytes).toThruFmt());
            if (index < 0) throw new Error('account not in the transaction');
            ownerIndex = index;
            return index;
          },
        });
        built.push({ program: params.program, readWrite: params.accounts.readWrite, readOnly: params.accounts.readOnly, stateUnits: params.header.stateUnits, ownerIndex });
        pending.push(initialize(params.accounts.readWrite[0]!, KEY.address));
        return { sign: vi.fn(async () => {}), toWire: () => wire(PROGRAM_TAG) };
      }),
      sendAndTrack: vi.fn(async function* (raw: Uint8Array) {
        if (raw[0] === CREATE_TAG) live.set(KEY.address, new Uint8Array(0));
        else pending.shift()?.();
        yield { executionResult: { vmError: 0, userErrorCode: 0n } };
      }),
      send: vi.fn(),
      getStatus: vi.fn(),
    },
  };
  return { thru, live, built, pending, tokenAccount, perps: { thru: thru as never, deployment } };
}

describe('ensureFeePayerAccount', () => {
  it('creates a fresh key\'s account, signed by the key itself', async () => {
    const env = await rpc();
    expect(await ensureFeePayerAccount(env.thru as never, KEY)).toEqual({ address: KEY.address, status: 'created' });
    expect(env.thru.accounts.create).toHaveBeenCalledWith({ header: ACCOUNT_CREATION_RESOURCES, publicKey: KEY.address });
    const transaction = await env.thru.accounts.create.mock.results[0]!.value;
    expect(transaction.sign).toHaveBeenCalledWith(new Uint8Array(32).fill(7));
    expect(env.thru.transactions.sendAndTrack).toHaveBeenCalledTimes(1);
    /* Run again: nothing to do. */
    expect(await ensureFeePayerAccount(env.thru as never, KEY)).toEqual({ address: KEY.address, status: 'existing' });
    expect(env.thru.accounts.create).toHaveBeenCalledTimes(1);
  });

  it('restores an archived account and refuses a key of another address', async () => {
    const env = await rpc({ feePayer: 'COMPRESSED' });
    expect(await ensureFeePayerAccount(env.thru as never, { address: KEY.address, privateKey: new Uint8Array(32).fill(7) })).toEqual({ address: KEY.address, status: 'restored' });
    expect(env.thru.compression.decompressAccounts).toHaveBeenCalledWith(expect.objectContaining({ accounts: [KEY.address], feePayer: { publicKey: KEY.address, privateKey: new Uint8Array(32).fill(7) } }));
    expect(env.thru.accounts.create).not.toHaveBeenCalled();
    const wrong = await rpc({ keyOwner: OTHER });
    await expect(ensureFeePayerAccount(wrong.thru as never, KEY)).rejects.toThrow(`the private key does not belong to ${KEY.address}`);
    await expect(ensureFeePayerAccount(wrong.thru as never, { address: KEY.address, privateKeyHex: '07' })).rejects.toThrow('32 bytes');
  });
});

describe('ensureQuoteTokenAccount', () => {
  it('creates the canonical quote token account the client deposits from, paid by any signer', async () => {
    const env = await rpc({ feePayer: 'ACTIVE' });
    const requests: Array<{ programAddress: string; readWrite: string[]; readOnly: string[]; stateUnits?: number }> = [];
    const wallet: PerpsSigner = {
      kind: 'test',
      address: OTHER,
      async sign({ programAddress, tx }) {
        requests.push({ programAddress, readWrite: tx.readWrite, readOnly: tx.readOnly, stateUnits: tx.stateUnits });
        env.pending.push(() => env.live.set(tx.readWrite[0]!, tokenAccountBytes(KEY.address, 0n)));
        const raw = new Uint8Array(176);
        raw[0] = PROGRAM_TAG;
        return { raw };
      },
    };
    const account = env.tokenAccount(KEY.address);
    expect(await readQuoteTokenAccount(env.perps, KEY.address)).toMatchObject({ address: account, exists: false, amount: 0n });
    expect(await ensureQuoteTokenAccount(env.perps, wallet, { owner: KEY.address })).toEqual({ symbol: 'UUSD', mint: MINT, owner: KEY.address, address: account, status: 'created', amount: 0n });
    /* The payer is not the owner: the owner joins the read-only accounts. */
    expect(requests).toEqual([{ programAddress: deployment.tokenProgram, readWrite: [account], readOnly: [MINT, KEY.address], stateUnits: 1 }]);
    expect(await ensureQuoteTokenAccount(env.perps, wallet, { owner: KEY.address })).toMatchObject({ status: 'existing' });
    expect(requests).toHaveLength(1);
  });

  it('restores an archived token account instead of reporting it ready', async () => {
    const env = await rpc({ feePayer: 'ACTIVE', archivedTokenOwner: KEY.address });
    const account = env.tokenAccount(KEY.address);
    expect(await readQuoteTokenAccount(env.perps, KEY.address)).toMatchObject({ address: account, exists: true, archived: true, amount: 25n });
    const signer = createKeypairSigner({ address: KEY.address, privateKey: new Uint8Array(32).fill(7), verified: true });
    /* Without a restore signer it is refused, not reported as ready. */
    await expect(ensureQuoteTokenAccount(env.perps, signer)).rejects.toThrow(`the UUSD token account ${account} is archived`);
    const restore = { kind: 'keypair' as const, publicKey: KEY.address, privateKey: new Uint8Array(32).fill(7) };
    expect(await ensureQuoteTokenAccount(env.perps, signer, { submit: { archived: { signer: restore } } })).toEqual({
      symbol: 'UUSD', mint: MINT, owner: KEY.address, address: account, status: 'restored', amount: 25n,
    });
    expect(env.thru.compression.decompressAccounts).toHaveBeenCalledWith(expect.objectContaining({ accounts: [account] }));
    /* Restored, not re-created. */
    expect(env.built).toEqual([]);
    expect(await readQuoteTokenAccount(env.perps, KEY.address)).toMatchObject({ exists: true, archived: false });
  });

  it('checks the chain before it restores an archived token account', async () => {
    const env = await rpc({ feePayer: 'ACTIVE', archivedTokenOwner: KEY.address });
    const signer = createKeypairSigner({ address: KEY.address, privateKey: new Uint8Array(32).fill(7), verified: true });
    const restore = { kind: 'keypair' as const, publicKey: KEY.address, privateKey: new Uint8Array(32).fill(7) };
    const checkChain = vi.fn(async () => {
      throw new Error('wrong chain');
    });
    await expect(ensureQuoteTokenAccount(env.perps, signer, { submit: { checkChain, archived: { signer: restore } } })).rejects.toThrow('wrong chain');
    expect(checkChain).toHaveBeenCalledTimes(1);
    expect(env.thru.compression.decompressAccounts).not.toHaveBeenCalled();
  });

  it('picks a quote mint by symbol or address, and the markets\' only one by default', () => {
    expect(perpsQuoteMint(deployment).symbol).toBe('UUSD');
    expect(perpsQuoteMint(deployment, 'uusd').address).toBe(MINT);
    expect(perpsQuoteMint(deployment, MINT).symbol).toBe('UUSD');
    expect(() => perpsQuoteMint(deployment, 'THRCAD')).toThrow('unknown quote mint THRCAD');
    const two = { ...deployment, markets: [...deployment.markets, { ...deployment.markets[0]!, symbol: 'BTC-THRCAD', quoteSymbol: 'THRCAD' }] };
    expect(() => perpsQuoteMint(two)).toThrow('the markets use 2 quote mints (UUSD, THRCAD); pass quote');
  });
});

describe('ensurePerpsAccounts', () => {
  it('takes a fresh key to a fee payer and a quote token account, restoring an archived mint', async () => {
    const env = await rpc({ mint: 'COMPRESSED' });
    const setup = await ensurePerpsAccounts(env.perps, KEY);
    expect(setup).toEqual({
      feePayer: { address: KEY.address, status: 'created' },
      tokenAccounts: [{ symbol: 'UUSD', mint: MINT, owner: KEY.address, address: env.tokenAccount(KEY.address), status: 'created', amount: 0n }],
    });
    /* The key pays: its own address is the fee payer (index 0), not a listed account. */
    expect(env.built).toEqual([{ program: deployment.tokenProgram, readWrite: [env.tokenAccount(KEY.address)], readOnly: [MINT], stateUnits: 1, ownerIndex: 0 }]);
    expect(env.thru.compression.decompressAccounts).toHaveBeenCalledWith(expect.objectContaining({ accounts: [MINT] }));
    /* Idempotent. */
    expect(await ensurePerpsAccounts(env.perps, KEY)).toMatchObject({ feePayer: { status: 'existing' }, tokenAccounts: [{ status: 'existing' }] });
    expect(env.built).toHaveLength(1);
  });

  it('restores a returning key\'s archived token account, signed by the key', async () => {
    const env = await rpc({ feePayer: 'ACTIVE', archivedTokenOwner: KEY.address });
    expect(await ensurePerpsAccounts(env.perps, KEY)).toMatchObject({ feePayer: { status: 'existing' }, tokenAccounts: [{ status: 'restored', amount: 25n }] });
    expect(env.thru.compression.decompressAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ accounts: [env.tokenAccount(KEY.address)], feePayer: { publicKey: KEY.address, privateKey: new Uint8Array(32).fill(7) } }),
    );
    expect(env.built).toEqual([]);
  });
});
