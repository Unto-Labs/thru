import { describe, expect, it, vi } from 'vitest';
import { TransactionVmError } from '@thru/sdk/proto';
import { Code, ConnectError } from '@connectrpc/connect';
import { fixture, address, missing } from './__tests__/fixture';
import { CompressionError } from './types';
import { Transaction } from '../../domain/transactions/Transaction';
import { createThruClient } from '../../client';
import { ValidateArgs } from '../../domain/programs/passkey-manager/abi/thru/program/passkey_manager/types';
import { Pubkey } from '../../domain/primitives';

const a = address(10), b = address(11);
describe('integrated sdk.compression', () => {
  it('is present on the normal client without program/transport setup', () => {
    const sdk = createThruClient({ baseUrl: 'http://test.invalid' });
    expect(sdk.compression.decompressAccounts).toBeTypeOf('function');
    expect(sdk.compression.getAccountStatuses).toBeTypeOf('function');
  });
  it('classifies active, compressed, missing and deleted accounts, preserving duplicates', async () => {
    const f = await fixture({ [a]: 10, [b]: 20, [address(12)]: 0 }); f.active.add(a);
    f.images.get(address(12))!.rawMeta[3] = 0x10;
    const statuses = await f.sdk.compression.getAccountStatuses({ accounts: [a, b, address(13), address(12), b] });
    expect(statuses.map(s => s.status)).toEqual(['ACTIVE', 'COMPRESSED', 'DOES_NOT_EXIST', 'DOES_NOT_EXIST', 'COMPRESSED']);
    expect(statuses[1]?.retrySlot).toBe(484n);
    expect(f.sendTransaction).not.toHaveBeenCalled();
  });
  it('does not interpret an RPC outage as absence', async () => {
    const f = await fixture(); f.getRawAccount.mockRejectedValue(new ConnectError('offline', Code.Unavailable));
    await expect(f.sdk.compression.getAccountStatuses({ accounts: [a] })).rejects.toThrow('offline');
  });
  it('skips active accounts, deduplicates and batches small restorations using canonical programs', async () => {
    const f = await fixture();
    const result = await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a, b, a] });
    expect(result.accounts.map(o => o.status)).toEqual(['restored', 'restored']);
    expect(result.signatures).toHaveLength(1);
    expect(f.sent[0]?.program.toThruFmt()).toBe(f.programs.multicall);
    expect(f.sent[0]?.fee).toBe(0n);
    expect(f.sent[0]?.requestedStateUnits).toBe(4);
    const skip = await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] });
    expect(skip.accounts[0]?.status).toBe('active'); expect(skip.signatures).toHaveLength(0);
    expect(f.batchGenerateStateProofs).toHaveBeenCalledTimes(1);
  });
  it('returns cooldown promptly without signing or submitting', async () => {
    const f = await fixture(); f.slots.locallyExecuted = 483n;
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] }))
      .rejects.toMatchObject({ code: 'NOT_READY', details: { retrySlot: 484n } });
    expect(f.sendTransaction).not.toHaveBeenCalled();
    f.slots.locallyExecuted = 484n;
    await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] });
  });
  it('rejects missing and malformed archives', async () => {
    const f = await fixture();
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [address(99)] })).rejects.toMatchObject({ code: 'MISSING_ACCOUNT' });
    f.images.get(a)!.rawMeta = new Uint8Array(63);
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
  it('retries only remaining accounts after a concurrent restoration fails the atomic batch', async () => {
    const f = await fixture(); f.onExecute(kind => { if (kind === 'batch') { f.active.add(a); throw new Error('race'); } });
    const result = await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a, b] });
    expect(result.accounts.map(o => o.status)).toEqual(['active', 'restored']);
    expect(result.signatures).toHaveLength(2);
  });
  it('retains partial progress when a later transaction fails', async () => {
    const f = await fixture({ [a]: 300, [b]: 300 }); let count = 0;
    f.onExecute(kind => { if (kind === 'restore' && ++count === 2) throw new Error('failure'); });
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, maxTransactionBytes: 850, accounts: [a, b] }))
      .rejects.toMatchObject({ code: 'TRANSACTION_FAILED', details: { result: { accounts: [{ address: a, status: 'restored' }] } } });
  });
  it('uploads large images and cleans temporary state', async () => {
    const f = await fixture({ [a]: 65536 });
    const result = await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] });
    expect(f.actions).toEqual(['create', 'write', 'write', 'write', 'restore-upload', 'destroy']);
    expect(f.sent[4]?.requestedStateUnits).toBe(19);
    expect(result.uploads.every(u => u.status === 'cleaned')).toBe(true);
    expect(f.sent.every(tx => tx.toWire().length <= 32768)).toBe(true);
  });
  it('uses separate metadata/data buffers for a maximum account', async () => {
    // Runner pauses must not expire confirmations in this success-path test.
    // Only Date is frozen; polling and the overall test timeout stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const f = await fixture({ [a]: 16 * 1024 * 1024 });
      const result = await f.sdk.compression.decompressAccounts({ ...f.options, timeoutMs: 200, accounts: [a] });
      expect(result.uploads).toHaveLength(2);
      expect(result.uploads.every(u => u.status === 'cleaned')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
  it.each([false, true])('preserves staging only when the restoration is uncertain (%s)', async uncertain => {
    const f = await fixture({ [a]: 40000 });
    f.onExecute(kind => {
      if (kind === 'write' && f.actions.filter(x => x === 'write').length === 2 && uncertain) f.chain.confirm = false;
      if (kind === 'restore-upload' && !uncertain) throw new Error('definite failure');
    });
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] }))
      .rejects.toMatchObject({ code: uncertain ? 'TRANSACTION_UNCERTAIN' : 'TRANSACTION_FAILED',
        details: { result: { uploads: [{ status: uncertain ? 'pending' : 'cleaned' }] } } });
    expect(f.actions.includes('destroy')).toBe(!uncertain);
  });
  it('returns cleanup handles and honors their original uploader override', async () => {
    const f = await fixture({ [a]: 40000 }); f.programs.uploader = address(60);
    f.onExecute(kind => { if (kind === 'destroy') throw new Error('cleanup failed'); });
    let error: CompressionError | undefined;
    try { await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a], programAddresses: { uploader: address(60) } }); }
    catch (e) { error = e as CompressionError; }
    expect(error?.code).toBe('CLEANUP_FAILED'); expect(error?.details.result?.accounts[0]?.status).toBe('restored');
    f.onExecute(undefined);
    const cleanup = await f.sdk.compression.cleanupUploads({ ...f.options, uploads: error!.details.result!.uploads });
    expect(cleanup.uploads[0]?.status).toBe('cleaned'); expect(f.sent[f.sent.length - 1]?.program.toThruFmt()).toBe(address(60));
  });
  it('compresses with the required flag and NEW/updating proof selection, skipping protected accounts', async () => {
    const f = await fixture(); f.active.add(a); f.active.add(b); f.images.get(a)!.rawMeta[3] = 0x20;
    f.images.get(b)!.rawMeta[3] = 4;
    await f.sdk.compression.compressAccount({ ...f.options, account: a });
    expect(f.sent[0]?.flags).toBe(2);
    expect((await f.sdk.compression.compressAccount({ ...f.options, account: b })).accounts[0]?.status).toBe('skipped');
    expect(f.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('requests no state growth when compressing an active account (NEW=%s)', async isNew => {
    const f = await fixture({ [a]: 4096 });
    f.active.add(a);
    f.images.get(a)!.rawMeta[3] = isNew ? 0x20 : 0;
    const result = await f.sdk.compression.compressAccount({ ...f.options, account: a });
    expect(result.accounts[0]?.status).toBe('compressed');
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.requestedStateUnits).toBe(0);
    expect(f.sent[0]?.requestedComputeUnits).toBeGreaterThan(0);
    expect(f.sent[0]?.requestedMemoryUnits).toBeGreaterThan(0);
  });
  it('retains the metadata-inclusive restoration budget across a 4 KiB boundary', async () => {
    const f = await fixture({ [a]: 4096 });
    await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] });
    // Two footprint units plus the existing per-account/fee-payer allowance.
    expect(f.sent[0]?.requestedStateUnits).toBe(4);
  });
  it('does no work after cancellation or invalid fee', async () => {
    const f = await fixture();
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a], signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED' });
    for (const fee of [-1n, 1n << 64n]) await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a], fee })).rejects.toThrow('unsigned 64-bit');
    expect(f.sendTransaction).not.toHaveBeenCalled();
  });
  it('serializes concurrent calls and refreshes the payer nonce', async () => {
    const f = await fixture();
    await Promise.all([a, b].map(account => f.sdk.compression.decompressAccounts({ ...f.options, accounts: [account] })));
    expect(f.sent.map(t => t.nonce)).toEqual([0n, 1n]); expect(f.saved()).toBeUndefined();
  });
  it('reconciles a lost submission response without retrying an executed transaction', async () => {
    const f = await fixture(); f.chain.sendThrows = true;
    await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] });
    expect(f.sendTransaction).toHaveBeenCalledTimes(1); expect(f.saved()).toBeUndefined();
  });
  it('retains uncertainty across calls and restarts until expiry is durably indexed', async () => {
    const f = await fixture(); f.chain.confirm = false;
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] })).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    expect(f.saved()?.validUntilSlot).toBe(628n);
    expect(f.journal.save.mock.invocationCallOrder[0]).toBeLessThan(f.sendTransaction.mock.invocationCallOrder[0]!);
    for (const sdk of [f.sdk, f.make()]) await expect(sdk.compression.decompressAccounts({ ...f.options, accounts: [b] })).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    expect(f.sent).toHaveLength(1);
    f.slots.finalized = 629n; f.chain.durable = 600n;
    await expect(f.sdk.compression.reconcilePending(f.options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    f.chain.durable = 629n; f.chain.confirm = true;
    await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [b] });
    expect(f.sent).toHaveLength(2); expect(f.saved()).toBeUndefined();
  });
  it('keeps an advanced nonce with a missing result pending and reconciles when it appears', async () => {
    const f = await fixture(); f.chain.confirm = false;
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] })).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    f.slots.finalized = 629n; f.chain.nonce = 1n;
    await expect(f.make().compression.reconcilePending(f.options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    f.indexPending(); await f.sdk.compression.reconcilePending(f.options);
    expect(f.saved()).toBeUndefined(); expect(f.sent).toHaveLength(1);
  });
  it('blocks cleanup while a restoration is unresolved', async () => {
    const f = await fixture(); f.chain.confirm = false;
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] })).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    await expect(f.sdk.compression.cleanupUploads({ ...f.options, uploads: [{ meta: a, buffer: b, status: 'pending' }] })).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    expect(f.sent).toHaveLength(1);
  });
  it('never sends after a journal failure or cancellation during its write', async () => {
    const f = await fixture(); f.journal.save.mockRejectedValue(new Error('disk full'));
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] })).rejects.toThrow('disk full');
    expect(f.sent).toHaveLength(0);
    const g = await fixture(); const abort = new AbortController();
    g.journal.save.mockImplementationOnce(async () => { abort.abort(); });
    await expect(g.sdk.compression.decompressAccounts({ ...g.options, accounts: [a], signal: abort.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(g.sent).toHaveLength(0);
  });
  it('keeps in-memory uncertainty across calls even without a journal', async () => {
    const f = await fixture(); f.chain.confirm = false;
    const options = { ...f.options, journal: undefined, accounts: [a] };
    await expect(f.sdk.compression.decompressAccounts(options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    await expect(f.sdk.compression.decompressAccounts(options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    expect(f.sent).toHaveLength(1);
  });
  it('waits for nonce indexing after execution, including VM failure', async () => {
    const f = await fixture(); f.chain.vmError = TransactionVmError.TRANSACTION_VM_ERROR_VM_REVERT;
    f.getAccount.mockImplementationOnce(async req => ({ address: req.address, meta: { nonce: 0n, balance: 10000n } }))
      .mockImplementationOnce(async req => ({ address: req.address, meta: { nonce: 0n, balance: 10000n } }));
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] }))
      .rejects.toMatchObject({ code: 'TRANSACTION_FAILED', details: { vmError: f.chain.vmError } });
    expect(f.getAccount).toHaveBeenCalledTimes(3); expect(f.saved()).toBeUndefined();
  });
  it('does not require nonce advancement after an expiry rejection', async () => {
    const f = await fixture(); f.chain.vmError = TransactionVmError.TRANSACTION_VM_ERROR_EXPIRED;
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] })).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    expect(f.chain.nonce).toBe(0n); expect(f.saved()).toBeUndefined();
  });
  it('does not change journals to discard pending work', async () => {
    const f = await fixture(); f.chain.confirm = false;
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [a] })).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    await expect(f.sdk.compression.reconcilePending({ feePayer: f.options.feePayer, journal: { load: async () => undefined, save: async () => {} } })).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
  });
});

describe('wallet intent integration', () => {
  it('passes an intent to the existing wallet callback, never an SDK Transaction or private key', async () => {
    const f = await fixture(); await f.sdk.compression.decompressAccounts({ ...f.wallet, accounts: [a, b] });
    const intent = f.wallet.signTransaction.mock.calls[0]![0];
    expect(intent).not.toBeInstanceOf(Transaction); expect(intent.programAddress).toBe(f.programs.multicall);
    expect(typeof intent.instructionData).toBe('string'); expect(intent).not.toHaveProperty('privateKey');
    expect(f.sent).toHaveLength(1);
  });
  it('uses stable account pointers for large wallet restores and cleans all buffers', async () => {
    const f = await fixture({ [a]: 65536 });
    const result = await f.sdk.compression.decompressAccounts({ ...f.wallet, accounts: [a] });
    expect(result.uploads).toHaveLength(2); expect(result.uploads.every(u => u.status === 'cleaned')).toBe(true);
    const wrapped = f.sent.find(tx => {
      const target = ValidateArgs.from_array(tx.instructionData!.subarray(1))!.get_target_instruction();
      return Uint8Array.from(target.get_data())[0] === 4;
    })!;
    const target = Uint8Array.from(ValidateArgs.from_array(wrapped.instructionData!.subarray(1))!.get_target_instruction().get_data());
    expect(new DataView(target.buffer).getBigUint64(30, true) >> 40n).toBe(3n);
    expect(target.length).toBe(46);
  });
  it('rejects a wallet-selected payer change before sending', async () => {
    const f = await fixture(); const realSign = f.wallet.signTransaction.getMockImplementation()!;
    f.wallet.signTransaction.mockImplementation(async intent => {
      const raw = Buffer.from(await realSign(intent), 'base64'); raw[48] ^= 1; return raw.toString('base64');
    });
    await expect(f.sdk.compression.decompressAccounts({ ...f.wallet, accounts: [a] })).rejects.toThrow('Wallet changed');
    expect(f.sent).toHaveLength(0);
  });
  it('rejects modified account lists and a modified nested instruction', async () => {
    for (const part of ['accounts', 'instruction']) {
      const f = await fixture(); const realSign = f.wallet.signTransaction.getMockImplementation()!;
      f.wallet.signTransaction.mockImplementation(async intent => {
        const raw = Buffer.from(await realSign(intent), 'base64');
        if (part === 'accounts') raw[112] ^= 1;
        else raw[raw.length - 65] ^= 1;
        return raw.toString('base64');
      });
      await expect(f.sdk.compression.decompressAccounts({ ...f.wallet, accounts: [a] })).rejects.toThrow('Wallet changed');
      expect(f.sent).toHaveLength(0);
    }
  });
});
