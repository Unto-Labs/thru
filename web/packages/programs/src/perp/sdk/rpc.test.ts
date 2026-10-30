import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransactionTimeoutError } from './errors';
import { accountExists, isArchivedAccount, readAccount, rpcChainId, type ThruClient } from './rpc';
import { waitForTransaction } from './send';

afterEach(() => vi.useRealTimers());

const client = (getStatus: () => Promise<unknown>) => ({ transactions: { getStatus } }) as unknown as ThruClient;
const executed = { executionResult: { vmError: 0, userErrorCode: 0n } };

it('polls every 200 ms at first, then at the configured interval', async () => {
  vi.useFakeTimers();
  const getStatus = vi.fn().mockResolvedValue(null);
  const done = waitForTransaction(client(getStatus), 'sig', 'test', 40, 750);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(getStatus).toHaveBeenCalledTimes(11);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(getStatus).toHaveBeenCalledTimes(13);
  getStatus.mockResolvedValue(executed);
  await vi.advanceTimersByTimeAsync(750);
  await expect(done).resolves.toBeUndefined();
});

it('keeps the overall timeout of retries * delayMs', async () => {
  vi.useFakeTimers();
  const getStatus = vi.fn().mockResolvedValue(null);
  const done = waitForTransaction(client(getStatus), 'sig', 'test', 4, 750);
  const settled = expect(done).rejects.toBeInstanceOf(TransactionTimeoutError);
  await vi.advanceTimersByTimeAsync(2_999);
  expect(getStatus.mock.calls.length).toBeLessThan(13);
  await vi.advanceTimersByTimeAsync(1);
  await settled;
});

describe('readAccount archived state', () => {
  const NOT_FOUND = new Error('[not_found] account not found');
  const archivedAccount = { meta: { flags: { isDeleted: false } }, data: { data: new Uint8Array([1]) } };
  const reader = (current: () => Promise<unknown>, historical: () => Promise<unknown>) => {
    const get = vi.fn((_address: string, options?: { versionContext?: unknown }) => (options?.versionContext ? historical() : current()));
    return { sdk: { accounts: { get } } as unknown as ThruClient, get };
  };

  it('returns an active account as is', async () => {
    const active = { meta: { flags: {} } };
    const { sdk, get } = reader(async () => active, async () => archivedAccount);
    const account = await readAccount(sdk, 'addr');
    expect(account).toBe(active);
    expect(isArchivedAccount(account)).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('returns a compressed account from its archived state', async () => {
    const { sdk, get } = reader(async () => { throw NOT_FOUND; }, async () => archivedAccount);
    const account = await readAccount(sdk, 'addr', { dataSlice: { offset: 8, length: 4 } });
    expect(isArchivedAccount(account)).toBe(true);
    expect(get.mock.calls[1]![1]).toMatchObject({ dataSlice: { offset: 8, length: 4 }, versionContext: expect.anything() });
    await expect(accountExists(sdk, 'addr')).resolves.toBe(true);
  });

  it('reports a missing or deleted account as not found', async () => {
    const missing = reader(async () => { throw NOT_FOUND; }, async () => { throw NOT_FOUND; });
    await expect(readAccount(missing.sdk, 'addr')).rejects.toThrow(/not found/);
    await expect(accountExists(missing.sdk, 'addr')).resolves.toBe(false);
    const deleted = reader(async () => { throw NOT_FOUND; }, async () => ({ meta: { flags: { isDeleted: true } } }));
    await expect(accountExists(deleted.sdk, 'addr')).resolves.toBe(false);
  });

  it('can require an active account', async () => {
    const { sdk, get } = reader(async () => { throw NOT_FOUND; }, async () => archivedAccount);
    await expect(accountExists(sdk, 'addr', { archived: false })).resolves.toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

});

it('reads the chain id once per client and asks again after a failed read', async () => {
  const getChainId = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(2);
  const sdk = { chain: { getChainId } } as unknown as ThruClient;
  await expect(rpcChainId(sdk)).rejects.toThrow('unavailable');
  await expect(rpcChainId(sdk)).resolves.toBe(2);
  await expect(rpcChainId(sdk)).resolves.toBe(2);
  expect(getChainId).toHaveBeenCalledTimes(2);
});
