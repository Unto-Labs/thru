/**
 * Review parity with the device app (spec §7.7, §11.3). The cases come from
 * the device app's own functional-test builders; its Ragger tests assert the
 * same clear/blind verdicts and transfer fields on the real app, and the
 * hinted review is transcribed from the device snapshots.
 */
import { describe, expect, it } from 'vitest';

import { describeTransaction, fromHex } from '../protocol';
import { REVIEW_CASES, REVIEW_SIGNER as SIGNER, reviewCaseHint as tokenHint } from './helpers/device-review';

const pairs = (review: ReturnType<typeof describeTransaction>): [string, string][] =>
  review.fields.map((f) => [f.label, f.value]);

describe('describeTransaction matches the device review', () => {
  it.each(REVIEW_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const body = fromHex(c.body_hex);
    const review = describeTransaction(body, SIGNER, { tokenHint: tokenHint(c) });
    expect(review.requiresBlindSigning).toBe(!c.clear);
    expect(review.transfer === null).toBe(!c.clear);
    if (c.fields !== undefined) {
      expect(pairs(review)).toEqual(c.fields);
    } else if (c.transfer_fields !== undefined) {
      const n = c.transfer_fields.length;
      expect(pairs(review).slice(0, n)).toEqual(c.transfer_fields);
      expect(review.fields[n].label).toBe('Network');
      expect(review.fields.length).toBe(n + 9);
    } else {
      expect(review.fields[0].label).toBe('Network');
      expect(review.fields.length).toBe(9);
    }
  });

  it('shows the token accounts when the hinted transfer is sent without its hint', () => {
    const c = REVIEW_CASES.find((x) => x.hint !== undefined)!;
    const review = describeTransaction(fromHex(c.body_hex), SIGNER);
    expect(review.tokenIdentity).toBeNull();
    expect(review.fields.slice(4, 6).map((f) => [f.label, f.value])).toEqual([
      ['Address type', 'Token accounts'],
      ['Token identity', 'Not provided by transaction'],
    ]);
    expect(review.fields.map((f) => f.label)).not.toContain('Token mint');
  });

  it('covers every transfer kind, the hinted review and blind cases', () => {
    const kinds = REVIEW_CASES
      .map((c) => describeTransaction(fromHex(c.body_hex), SIGNER, { tokenHint: tokenHint(c) }))
      .map((r) =>
        r.transfer === null
          ? 'blind'
          : `${r.transfer.checked !== null ? 'checked ' : ''}${r.tokenIdentity !== null ? 'hinted' : r.transfer.kind}`,
      );
    expect(new Set(kinds)).toEqual(
      new Set(['native', 'token', 'wallet', 'hinted', 'checked token', 'checked hinted', 'blind']),
    );
  });
});
