/**
 * specs/ledger/app-thru-apdu.md §3.4: P1 is the chunk index, never wraps, and
 * P1 = 0x00 always starts a new session. Small chunk sizes must not make the
 * planners emit P1 > 255, which serializes as 0x00. Audit A-023 (round 1):
 * the planners now fail closed instead.
 */
import { describe, expect, it } from 'vitest';

import { InvalidRequestError } from '../errors';
import { serializeApdu, signMessageApdus, signTxnApdus, type ApduCommand } from '../protocol/apdu';
import { CHUNK_INDEX_MAX, CHUNK_SIZE_MIN, MSG_MAX, TXN_BODY_MAX } from '../protocol/constants';

const PATH0 = "m/44'/8478'/0'/0'";

function assertNoWrap(apdus: readonly ApduCommand[]): void {
  for (const a of apdus) {
    expect(a.p1).toBeLessThanOrEqual(0xff);
    expect(serializeApdu(a)[2]).toBe(a.p1);
  }
}

describe('APDU planners never wrap P1 (§3.4)', () => {
  it('signTxnApdus with chunkSize 100 on a 32704-byte body fails closed', () => {
    expect(() => signTxnApdus(PATH0, new Uint8Array(32704).fill(1), 100)).toThrow(InvalidRequestError);
  });

  it('signMessageApdus with chunkSize 1 on a 300-byte message fails closed', () => {
    expect(() => signMessageApdus(PATH0, new Uint8Array(300).fill(0x41), 1)).toThrow(InvalidRequestError);
  });

  it(`rejects chunk sizes below ${CHUNK_SIZE_MIN} even for short streams`, () => {
    expect(() => signTxnApdus(PATH0, new Uint8Array(200).fill(1), CHUNK_SIZE_MIN - 1)).toThrow(InvalidRequestError);
    expect(() => signMessageApdus(PATH0, new Uint8Array(10).fill(0x41), 17)).toThrow(InvalidRequestError);
  });

  it(`rejects a stream that needs more than ${CHUNK_INDEX_MAX} data chunks`, () => {
    /* 128 * 255 = 32640: the largest body at the minimum chunk size. */
    const fits = signTxnApdus(PATH0, new Uint8Array(CHUNK_SIZE_MIN * CHUNK_INDEX_MAX).fill(1), CHUNK_SIZE_MIN);
    expect(fits).toHaveLength(1 + CHUNK_INDEX_MAX);
    assertNoWrap(fits);
    expect(() =>
      signTxnApdus(PATH0, new Uint8Array(CHUNK_SIZE_MIN * CHUNK_INDEX_MAX + 1).fill(1), CHUNK_SIZE_MIN),
    ).toThrow(InvalidRequestError);
    expect(() => signMessageApdus(PATH0, new Uint8Array(MSG_MAX).fill(0x41), CHUNK_SIZE_MIN)).toThrow(
      InvalidRequestError,
    );
  });

  it('accepts the maximum body and message at 129..255 bytes per chunk', () => {
    for (const size of [129, 200, 255]) {
      assertNoWrap(signTxnApdus(PATH0, new Uint8Array(TXN_BODY_MAX).fill(1), size));
      const plan = signMessageApdus(PATH0, new Uint8Array(MSG_MAX).fill(0x41), size);
      assertNoWrap([plan.header, ...plan.pass1, ...plan.pass2]);
    }
  });

  it('serializeApdu refuses a hand-built command whose P1 does not fit a byte', () => {
    const bad: ApduCommand = { cla: 0xe0, ins: 0x07, p1: 256, p2: 0x80, data: new Uint8Array([1]) };
    expect(() => serializeApdu(bad)).toThrow();
  });
});
