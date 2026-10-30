import { CompressionError } from '@thru/sdk';
import { describe, expect, it, vi } from 'vitest';

import type { ThruClient } from './rpc';
import {
  ArchivedAccountsError,
  accountStatuses,
  archivedAccountsError,
  forgetAccountStatuses,
  restoreArchivedAccounts,
  type RestoreSigner,
} from './compression';

const A = 'taJU3IuyXuPJr0HCCLnHRBNowYnNjF-u3ksLABZnTLfbH8';
const B = 'taohK3y_Lg6ftdh9JMwWfNox3AN3PljXt9XjV1_Xp0oe_6';
const PAYER = 'taqVscHs2INdqx6387pQN3uofbt4JfrgkCcEXhOJACmuFf';
const WALLET = 'taeO593-qbpUo0oPUaU7rPhPekrgyWKrborkpYryBidV1_';
const PROGRAM = 'tayM9Pm_Zpu30DUvzYpBUFsG2riV3tdhWg9yPgN3gV_zO1';

type Status = 'ACTIVE' | 'COMPRESSED' | 'DOES_NOT_EXIST';

function client(statuses: Record<string, Status>, decompress = vi.fn().mockResolvedValue({ accounts: [], signatures: ['sig'], uploads: [] })) {
  const getAccountStatuses = vi.fn(async ({ accounts }: { accounts: readonly string[] }) =>
    accounts.map((address) => ({ address, status: statuses[address] ?? 'ACTIVE' })),
  );
  const sdk = { compression: { getAccountStatuses, decompressAccounts: decompress } } as unknown as ThruClient;
  return { sdk, getAccountStatuses, decompress };
}

const keypair: RestoreSigner = { kind: 'keypair', publicKey: PAYER, privateKey: new Uint8Array(32) };
const wallet: RestoreSigner = { kind: 'wallet', feePayer: PAYER, walletAddress: WALLET, signTransaction: vi.fn() };

describe('restoreArchivedAccounts', () => {
  it('does nothing when every account is active or not created yet', async () => {
    const { sdk, getAccountStatuses, decompress } = client({ [B]: 'DOES_NOT_EXIST' });
    await expect(restoreArchivedAccounts(sdk, { accounts: [A, B, A], signer: keypair })).resolves.toEqual({ restored: [], signatures: [] });
    expect(decompress).not.toHaveBeenCalled();
    /* One metadata read per distinct account, fee payer included. */
    expect(getAccountStatuses.mock.calls.map(([options]) => options.accounts[0]).sort()).toEqual([A, B, PAYER].sort());
  });

  it('skips accounts seen active within the cache window and the skip list', async () => {
    const { sdk, getAccountStatuses } = client({});
    await restoreArchivedAccounts(sdk, { accounts: [A, PROGRAM], signer: keypair, skip: [PROGRAM] });
    expect(getAccountStatuses).toHaveBeenCalledTimes(2);
    await restoreArchivedAccounts(sdk, { accounts: [A], signer: keypair });
    expect(getAccountStatuses).toHaveBeenCalledTimes(2);
    forgetAccountStatuses(sdk, [A]);
    await restoreArchivedAccounts(sdk, { accounts: [A], signer: keypair });
    expect(getAccountStatuses).toHaveBeenCalledTimes(3);
  });

  it('expires cached active statuses', async () => {
    const { sdk, getAccountStatuses } = client({});
    await accountStatuses(sdk, [A], undefined, 0);
    await accountStatuses(sdk, [A], undefined, 29_000);
    expect(getAccountStatuses).toHaveBeenCalledTimes(1);
    await accountStatuses(sdk, [A], undefined, 31_000);
    expect(getAccountStatuses).toHaveBeenCalledTimes(2);
  });

  it('restores only the archived accounts with the local key, the fee payer included', async () => {
    const decompress = vi.fn().mockResolvedValue({
      accounts: [{ address: PAYER, status: 'restored', signatures: ['s1'] }, { address: A, status: 'restored', signatures: ['s2'] }],
      signatures: ['s1', 's2'],
      uploads: [],
    });
    const { sdk } = client({ [PAYER]: 'COMPRESSED', [A]: 'COMPRESSED' }, decompress);
    const onRestoring = vi.fn();
    const result = await restoreArchivedAccounts(sdk, { accounts: [A, B], signer: keypair, onRestoring });
    expect(onRestoring).toHaveBeenCalledWith([PAYER, A]);
    expect(decompress).toHaveBeenCalledWith(
      expect.objectContaining({ accounts: [PAYER, A], fee: 0n, feePayer: { publicKey: PAYER, privateKey: expect.any(Uint8Array) } }),
    );
    expect(result).toEqual({ restored: [PAYER, A], signatures: ['s1', 's2'] });
  });

  it('restores through the wallet signer', async () => {
    const { sdk, decompress } = client({ [A]: 'COMPRESSED' });
    await restoreArchivedAccounts(sdk, { accounts: [A], signer: wallet });
    const options = decompress.mock.calls[0]![0];
    expect(options).toMatchObject({ accounts: [A], feePayer: { publicKey: PAYER }, walletAddress: WALLET });
    expect(options.feePayer).not.toHaveProperty('privateKey');
    expect(options.signTransaction).toBe((wallet as { signTransaction: unknown }).signTransaction);
  });

  it('refuses when the wallet signer itself is archived', async () => {
    const { sdk, decompress } = client({ [WALLET]: 'COMPRESSED', [A]: 'COMPRESSED' });
    const error = await restoreArchivedAccounts(sdk, { accounts: [A], signer: wallet }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ArchivedAccountsError);
    expect(error).toMatchObject({ kind: 'unsupported', details: { address: WALLET } });
    expect(decompress).not.toHaveBeenCalled();
  });

  it('maps a cooldown to a typed error with the retry slot', async () => {
    const decompress = vi.fn().mockRejectedValue(new CompressionError('NOT_READY', 'cooldown', { address: A, retrySlot: 1234n }));
    const { sdk } = client({ [A]: 'COMPRESSED' }, decompress);
    const error = await restoreArchivedAccounts(sdk, { accounts: [A], signer: keypair }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'cooldown', details: { address: A, retrySlot: 1234n } });
    expect((error as Error).message).toMatch(/slot 1234/);
  });
});

describe('archivedAccountsError', () => {
  it('keeps the signatures of an uncertain restore', () => {
    const error = archivedAccountsError(
      new CompressionError('TRANSACTION_UNCERTAIN', 'pending', {
        signature: 'sigB',
        result: { accounts: [], signatures: ['sigA', 'sigB'], uploads: [] },
      }),
    );
    expect(error.kind).toBe('uncertain');
    expect(error.details.signatures).toEqual(['sigA', 'sigB']);
    expect(error.message).toMatch(/awaiting confirmation/);
  });

  it('reports other failures as failed', () => {
    expect(archivedAccountsError(new CompressionError('TRANSACTION_FAILED', 'reverted')).kind).toBe('failed');
    expect(archivedAccountsError(new Error('socket hang up'))).toMatchObject({ kind: 'failed', message: expect.stringMatching(/socket hang up/) });
  });
});
