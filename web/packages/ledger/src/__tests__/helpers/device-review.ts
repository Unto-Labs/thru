/**
 * Review cases from the device app's functional-test builders
 * (`device-review-cases.json`; provenance in its `_source`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fromHex, type TokenHint } from '../../protocol';

export interface ReviewCase {
  readonly name: string;
  readonly body_hex: string;
  /** The device reviews the body in clear (no blind-signing setting needed). */
  readonly clear: boolean;
  /** The device's transfer fields, before the envelope fields. */
  readonly transfer_fields?: readonly (readonly [string, string])[];
  /** Every field the device shows, transcribed from its snapshots. */
  readonly fields?: readonly (readonly [string, string])[];
  readonly hint?: {
    readonly mint: string;
    readonly recipient_owner: string;
    readonly recipient_seed: string;
    readonly source_seed: string;
  };
}

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./device-review-cases.json', import.meta.url)), 'utf8'),
) as { signer_pubkey_hex: string; cases: ReviewCase[] };

/** Fee payer of every case: the corpus key for `m/44'/8478'/0'/0'`. */
export const REVIEW_SIGNER = fromHex(FIXTURE.signer_pubkey_hex);

export const REVIEW_CASES: readonly ReviewCase[] = FIXTURE.cases;

export function reviewCaseHint(c: ReviewCase): TokenHint | undefined {
  if (c.hint === undefined) return undefined;
  return {
    mint: fromHex(c.hint.mint),
    recipientOwner: fromHex(c.hint.recipient_owner),
    recipientSeed: fromHex(c.hint.recipient_seed),
    sourceSeed: fromHex(c.hint.source_seed),
  };
}
