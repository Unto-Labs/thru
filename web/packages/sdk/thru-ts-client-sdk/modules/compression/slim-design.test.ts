import { describe, expect, it } from 'vitest';
import { fixture, address, missing } from './__tests__/fixture';
import { Transaction } from '../../domain/transactions/Transaction';
import { NOOP_PROGRAM_ADDRESS } from '../../../src/core-program-addresses';

describe('wallet simplification design prerequisites', () => {
  it('can report every target active while the same client still requires reconciliation', async () => {
    const target = address(10);
    const f = await fixture({ [target]: 10 });
    f.active.add(f.publicKey);
    const journal = { load: async () => undefined, save: async () => {} };
    f.onExecute((kind) => {
      if (kind === 'restore') f.getTransactionStatus.mockRejectedValue(missing());
    });
    await expect(
      f.sdk.compression.decompressAccounts({ ...f.options, journal, accounts: [target] })
    ).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });

    const states = await f.sdk.compression.getAccountStatuses({ accounts: [f.publicKey, target] });
    expect(states.every((state) => state.status === 'ACTIVE')).toBe(true);
    // The proposed statuses-first return would bypass this required guard.
    await expect(
      f.sdk.compression.reconcilePending({ ...f.options, journal })
    ).rejects.toMatchObject({ code: 'TRANSACTION_UNCERTAIN' });
    expect(f.sent).toHaveLength(1);
  });

  it('can return CLEANUP_FAILED while a destroy transaction still reserves the application nonce', async () => {
    const target = address(10);
    const f = await fixture({ [target]: 80_000 });
    f.active.add(f.publicKey);
    const send = f.sendTransaction.getMockImplementation()!;
    f.sendTransaction.mockImplementation(async (request) => {
      const tx = Transaction.fromWire(request.rawTransaction);
      if (tx.program.toThruFmt() === f.programs.uploader && tx.instructionData![0] === 2)
        f.chain.confirm = false;
      return send(request);
    });
    const error = await f.sdk.compression
      .decompressAccounts({ ...f.options, accounts: [target] })
      .catch((error) => error);
    expect(error).toMatchObject({ code: 'CLEANUP_FAILED' });
    expect(f.active.has(target)).toBe(true);
    expect(f.saved()).toBeDefined();
    expect(f.saved()!.nonce).toBe(f.chain.nonce);
    await expect(f.sdk.compression.reconcilePending(f.options)).rejects.toMatchObject({
      code: 'TRANSACTION_UNCERTAIN',
    });

    // Ignoring the cleanup failure lets an ordinary builder reuse the nonce
    // of a still-valid destroy transaction. Recovery's cache does not guard it.
    const application = await f.sdk.transactions.buildAndSign({
      feePayer: f.options.feePayer,
      program: NOOP_PROGRAM_ADDRESS,
      header: { fee: 0n },
      instructionData: new Uint8Array(),
    });
    expect(Transaction.fromWire(application.rawTransaction).nonce).toBe(f.saved()!.nonce);
  });
});
