import { describe, expect, it, vi } from 'vitest';
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect';
import { createThruClient } from '@thru/sdk/client';
import { QueryService } from '@thru/sdk/proto';
import { Pubkey } from '@thru/sdk';
import { readWalletAccount, isAccountNotFound } from './accounts';

function fixture(status = 'COMPRESSED') {
  const missing = Object.assign(new Error('account not found'), { code: 5 });
  const archived = { data: { data: new Uint8Array([1, 2, 3]) } };
  const get = vi.fn().mockRejectedValueOnce(missing).mockResolvedValue(archived);
  const getAccountStatuses = vi.fn().mockResolvedValue([{ status, retrySlot: 484n }]);
  const client = {
    accounts: { get },
    compression: { getAccountStatuses },
  } as never;
  return { client, get, getAccountStatuses, archived, missing };
}

describe('wallet account reads', () => {
  it('reads an active account without an archive request', async () => {
    const f = fixture();
    f.get.mockReset().mockResolvedValue(f.archived);
    expect(await readWalletAccount(f.client, 'account')).toEqual({
      account: f.archived,
    });
    expect(f.getAccountStatuses).not.toHaveBeenCalled();
  });
  it('labels historical data without changing it', async () => {
    const f = fixture();
    expect(await readWalletAccount(f.client, 'account')).toEqual({
      account: f.archived,
      compression: { status: 'COMPRESSED', retrySlot: '484' },
    });
    expect(f.get.mock.calls[1][1].versionContext.version.case).toBe('currentOrHistorical');
  });
  it('preserves actual absence', async () => {
    const f = fixture('DOES_NOT_EXIST');
    await expect(readWalletAccount(f.client, 'account')).rejects.toBe(f.missing);
    expect(f.get).toHaveBeenCalledTimes(1);
  });
  it('rereads after another actor restores the account', async () => {
    const f = fixture('ACTIVE');
    expect(await readWalletAccount(f.client, 'account')).toEqual({
      account: f.archived,
    });
    expect(f.get.mock.calls[1]).toEqual(['account']);
  });
  it('does not infer absence from an RPC outage', async () => {
    const f = fixture();
    const error = Object.assign(new Error('not found upstream'), { code: 14 });
    f.get.mockReset().mockRejectedValue(error);
    await expect(readWalletAccount(f.client, 'account')).rejects.toBe(error);
    expect(f.getAccountStatuses).not.toHaveBeenCalled();
  });
  it('does not convert an unavailable archive into absence', async () => {
    const f = fixture();
    f.get.mockRejectedValue(f.missing);
    await expect(readWalletAccount(f.client, 'account')).rejects.toMatchObject({
      code: 'RPC_ERROR',
    });
  });
  it('rejects a deleted archive', async () => {
    const f = fixture();
    f.get.mockResolvedValue({ meta: { flags: { isDeleted: true } } });
    await expect(readWalletAccount(f.client, 'account')).rejects.toMatchObject({
      code: 'RPC_ERROR',
    });
  });
});

// Exercise the actual SDK/Connect boundary, not a hand-written error shape.
it.each([Code.NotFound, Code.Unavailable])(
  'classifies SDK account RPC error %s by numeric code',
  async (code) => {
    const transport = createRouterTransport((router) => {
      router.service(QueryService, {
        getAccount: () => {
          throw new ConnectError('opaque service message', code);
        },
      });
    });
    const sdk = createThruClient({ baseUrl: 'http://accounts.invalid', transport });
    const account = Pubkey.from(new Uint8Array(32)).toThruFmt();
    const error = await sdk.accounts.get(account).catch((error) => error);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error.code).toBe(code);
    expect(isAccountNotFound(error)).toBe(code === Code.NotFound);
  }
);
