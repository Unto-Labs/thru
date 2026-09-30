import { describe, expect, it } from 'vitest';
import { address, fixture } from './__tests__/fixture';

describe('compression upload resource budgets', () => {
  it.each([false, true])('writes and cleans up without state headroom (wallet: %s)', async wallet => {
    const account = address(10);
    const f = await fixture({ [account]: 65536 });
    f.onExecute((kind, tx) => {
      if (kind === 'write' || kind === 'destroy') {
        // These phases must remain admissible when no state headroom remains.
        if (tx.requestedStateUnits !== 0) throw new Error('No state headroom');
      }
    });

    const result = await f.sdk.compression.decompressAccounts({
      ...(wallet ? f.wallet : f.options), accounts: [account],
    });

    expect(result.accounts).toEqual([expect.objectContaining({ address: account, status: 'restored' })]);
    expect(result.uploads.length).toBeGreaterThan(0);
    expect(result.uploads.every(upload => upload.status === 'cleaned')).toBe(true);
    expect(f.actions).toContain('write');
    expect(f.actions).toContain('destroy');
    expect(f.actions).toContain('restore-upload');
    for (const [index, kind] of f.actions.entries()) {
      const units = f.sent[index]!.requestedStateUnits;
      if (kind === 'write' || kind === 'destroy') expect(units).toBe(0);
      if (kind === 'create') expect(units).toBeGreaterThan(0);
      // A 64 KiB account plus its metadata needs 17 state units to restore.
      if (kind === 'restore-upload') expect(units).toBeGreaterThanOrEqual(17);
    }
  });
});
