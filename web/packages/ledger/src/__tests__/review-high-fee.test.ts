/**
 * Host review must match the device field list (spec §7.7, §11.3).
 * The device (ledger/app-thru/src/app_ui/review.rs, ui_review_txn) inserts a
 * `High fee` field right after `Fee` when fee > FEE_WARN_THRESHOLD.
 */
import { describe, expect, it } from 'vitest';

import { describeTransaction, fromHex } from '../protocol';
import { txnVectors } from './helpers/corpus';

describe('describeTransaction high-fee field parity with device', () => {
  it.each([
    [99_999_999n, false],
    [100_000_000n, false],
    [100_000_001n, true],
  ] as const)('warns only above 0.1 THRU: fee=%s', (fee, expectedWarning) => {
    const v = txnVectors().find((x) => x.name === 'ledger_txn_minimal')!;
    const body = fromHex(v.body_hex);
    new DataView(body.buffer, body.byteOffset, body.byteLength).setBigUint64(16, fee, true);
    const review = describeTransaction(body, fromHex(v.signer_pubkey_hex));
    expect(review.highFee).toBe(expectedWarning);
    const feeIndex = review.fields.findIndex((field) => field.label === 'Fee');
    const warningIndex = review.fields.findIndex((field) => field.label === 'High fee');
    expect(warningIndex).toBe(expectedWarning ? feeIndex + 1 : -1);
  });
});
