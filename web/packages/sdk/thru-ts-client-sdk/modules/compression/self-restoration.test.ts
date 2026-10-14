import { describe, expect, it } from 'vitest';
import { EOA_PROGRAM_ID, NOOP_PROGRAM_ADDRESS } from '../../../src/core-program-addresses';
import { Pubkey, Signature } from '../../domain/primitives';
import { Transaction } from '../../domain/transactions/Transaction';
import { fixture, address, missing } from './__tests__/fixture';
import { TransactionVmError } from '@thru/sdk/proto';
import { CompressionError } from './types';

async function compressedPayer() {
  const f = await fixture();
  const rawMeta = new Uint8Array(64);
  rawMeta.set(Pubkey.from(EOA_PROGRAM_ID).toBytes(), 16);
  new DataView(rawMeta.buffer).setBigUint64(56, 7n, true);
  f.chain.nonce = 7n;
  f.images.set(f.publicKey, { rawMeta, rawData: new Uint8Array(), versionContext: { slot: 100n } });
  f.getAccount.mockImplementation(async req => {
    if (!f.active.has(f.publicKey)) throw missing();
    return { address: req.address, meta: { nonce: f.chain.nonce, balance: 0n } };
  });
  return f;
}

describe('compressed keypair fee payer', () => {
  it.each([false, true])('canonicalizes a hex payer before restoring once (ta duplicate=%s)', async duplicate => {
    const f = await compressedPayer();
    const result = await f.sdk.compression.decompressAccounts({ ...f.options,
      accounts: [Pubkey.from(f.publicKey).toHex(), ...(duplicate ? [f.publicKey] : [])] });
    expect(f.actions).toEqual(['restore-payer']);
    expect(f.sent).toHaveLength(1); expect(f.sent[0]!.nonce).toBe(7n);
    expect(f.sent[0]!.program.toThruFmt()).toBe(NOOP_PROGRAM_ADDRESS);
    expect(result.accounts).toEqual([{ address: f.publicKey, status: 'restored', signatures: result.signatures }]);
    const repeat = await f.sdk.compression.decompressAccounts({ ...f.options,
      accounts: [Pubkey.from(f.publicKey).toHex(), f.publicKey] });
    expect(repeat.accounts).toEqual([{ address: f.publicKey, status: 'active', signatures: [] }]);
    expect(f.sent).toHaveLength(1);
  });

  it('keeps invalid addresses wrapped as RPC_ERROR without submitting', async () => {
    const f = await compressedPayer();
    const result = f.sdk.compression.decompressAccounts({ ...f.options, accounts: ['not-an-address'] });
    await expect(result).rejects.toBeInstanceOf(CompressionError);
    await expect(result).rejects.toMatchObject({ code: 'RPC_ERROR', message: 'Must be provided as hex string or ta-address',
      details: { result: { accounts: [], signatures: [], uploads: [] } } });
    expect(f.sent).toHaveLength(0);
  });

  it('restores a zero-balance EOA with a proof-bearing NOOP, then uses its new nonce', async () => {
    const f = await compressedPayer();
    const result = await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [address(10), f.publicKey, address(11), f.publicKey] });
    expect(f.actions).toEqual(['restore-payer', 'batch', 'restore', 'restore']);
    const tx = f.sent[0]!;
    expect(tx.program.toThruFmt()).toBe(NOOP_PROGRAM_ADDRESS);
    expect(tx.flags & 1).toBe(1);
    expect(tx.feePayerStateProof![7]! >>> 6).toBe(0); // EXISTING, never CREATION.
    expect(tx.fee).toBe(0n);
    expect(tx.requestedStateUnits).toBe(1);
    expect(f.sent.map(tx => tx.nonce)).toEqual([7n, 8n]);
    expect(result.accounts.find(a => a.address === f.publicKey)).toMatchObject({ status: 'restored', signatures: [result.signatures[0]] });
    expect(result.signatures).toHaveLength(2);
    expect(f.saved()).toBeUndefined();
    const repeat = await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [f.publicKey] });
    expect(repeat.accounts[0]?.status).toBe('active');
    expect(repeat.signatures).toEqual([]);
  });

  it('does not implicitly restore an unrequested payer', async () => {
    const f = await compressedPayer();
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [address(10)] }))
      .rejects.toMatchObject({ code: 'MISSING_ACCOUNT' });
    expect(f.sent).toHaveLength(0);
  });

  it('submits nothing during cooldown and restores at its boundary', async () => {
    const f = await compressedPayer(); f.slots.locallyExecuted = 483n;
    const options = { ...f.options, accounts: [f.publicKey] };
    await expect(f.sdk.compression.decompressAccounts(options)).rejects.toMatchObject({ code: 'NOT_READY', details: { retrySlot: 484n } });
    expect(f.sent).toHaveLength(0);
    f.slots.locallyExecuted = 484n;
    await f.sdk.compression.decompressAccounts(options);
    expect(f.sent).toHaveLength(1);
  });

  it.each(['owner', 'data', 'metadata', 'deleted', 'missing'])('rejects an invalid %s archive before signing', async kind => {
    const f = await compressedPayer(); const image = f.images.get(f.publicKey)!;
    if (kind === 'owner') image.rawMeta.fill(0, 16, 48);
    if (kind === 'data') { image.rawData = new Uint8Array(1); new DataView(image.rawMeta.buffer).setUint32(4, 1, true); }
    if (kind === 'metadata') image.rawMeta = new Uint8Array(63);
    if (kind === 'deleted') image.rawMeta[3] = 0x10;
    if (kind === 'missing') f.images.delete(f.publicKey);
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [f.publicKey] }))
      .rejects.toMatchObject({ code: ['deleted', 'missing'].includes(kind) ? 'MISSING_ACCOUNT' : 'INVALID_IMAGE' });
    expect(f.sent).toHaveLength(0);
  });

  it('reconciles a lost successful response without restoring twice', async () => {
    const f = await compressedPayer(); f.chain.sendThrows = true;
    await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [f.publicKey] });
    expect(f.sent).toHaveLength(1); expect(f.saved()).toBeUndefined();
  });

  it('preserves uncertainty across a restart and expires using the unchanged archived nonce', async () => {
    const f = await compressedPayer(); f.chain.confirm = false;
    const options = { ...f.options, accounts: [f.publicKey] };
    await expect(f.sdk.compression.decompressAccounts(options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    await expect(f.make().compression.decompressAccounts(options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    expect(f.sent).toHaveLength(1);
    f.slots.finalized = 629n; f.chain.durable = 628n;
    await expect(f.sdk.compression.reconcilePending(options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    f.chain.durable = 629n; f.chain.confirm = true;
    await f.sdk.compression.decompressAccounts(options);
    expect(f.sent.map(tx => tx.nonce)).toEqual([7n, 7n]); expect(f.saved()).toBeUndefined();
  });

  it('clears a definite pre-execution rejection while the payer remains archived', async () => {
    const f = await compressedPayer(); f.chain.vmError = TransactionVmError.TRANSACTION_VM_ERROR_EXPIRED;
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [f.publicKey] }))
      .rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    expect(f.saved()).toBeUndefined(); expect(f.active.has(f.publicKey)).toBe(false);
  });

  it('retains the pending signature when reconciliation RPC fails', async () => {
    const f = await compressedPayer(); f.chain.confirm = false;
    const options = { ...f.options, accounts: [f.publicKey] };
    await expect(f.sdk.compression.decompressAccounts(options)).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    const signature = f.saved()!.signature;
    f.getTransactionStatus.mockRejectedValue(new Error('RPC unavailable'));
    await expect(f.make().compression.decompressAccounts(options))
      .rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN', details: { signature } });
    expect(f.sent).toHaveLength(1); expect(f.saved()!.signature).toBe(signature);
  });

  it('cancels a stalled prerequisite RPC at the operation deadline', async () => {
    const f = await compressedPayer();
    f.getRawAccount.mockImplementation(() => new Promise(() => {}));
    await expect(f.sdk.compression.decompressAccounts({ ...f.options, accounts: [f.publicKey], signal: AbortSignal.timeout(20) }))
      .rejects.toMatchObject({ code: 'RPC_ERROR' });
    expect(f.sent).toHaveLength(0);
  }, 1000);

  it('continues after another client restores the payer before submission', async () => {
    const f = await compressedPayer();
    const original = f.generateStateProof.getMockImplementation()!;
    f.generateStateProof.mockImplementationOnce(async req => {
      f.active.add(f.publicKey); f.chain.nonce++;
      return original(req);
    });
    await f.sdk.compression.decompressAccounts({ ...f.options, accounts: [f.publicKey, address(10)] });
    expect(f.actions).toEqual(['restore']); expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.nonce).toBe(8n);
  });

  it('coordinates through chain receipts when separate clients submit competing restores', async () => {
    const f = await compressedPayer(); const original = f.sendTransaction.getMockImplementation()!;
    f.sendTransaction.mockImplementation(async req => {
      const tx = Transaction.fromWire(req.rawTransaction);
      const signature = { value: req.rawTransaction.slice(-64) };
      const key = Signature.from(signature.value).toThruFmt();
      // Model the runtime's duplicate/nonce guard, independently of either SDK session.
      if (f.statuses.has(key)) return { signature };
      if (tx.nonce !== f.chain.nonce) {
        f.statuses.set(key, { vmError: TransactionVmError.TRANSACTION_VM_ERROR_NONCE_TOO_LOW, userErrorCode: 0n });
        return { signature };
      }
      return original(req);
    });
    const options = { ...f.options, journal: undefined, accounts: [f.publicKey] };
    const results = await Promise.all([f.sdk.compression.decompressAccounts(options), f.make().compression.decompressAccounts(options)]);
    expect(f.actions).toEqual(['restore-payer']); expect(f.chain.nonce).toBe(8n);
    expect(results.every(result => ['active', 'restored'].includes(result.accounts[0]!.status))).toBe(true);
  });
});
