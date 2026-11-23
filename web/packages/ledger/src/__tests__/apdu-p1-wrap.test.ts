/**
 * Audit U4/T4: the exported chunk planners must never emit a chunk index
 * that does not fit the one-byte P1 field (app-thru-apdu.md §3.4, §7.2,
 * §8.2). A P1 of 256 serializes as 0x00, which the device treats as
 * "SIGN_* with P1 = 0: clear the old session, process chunk 0" (§10.2), so a
 * chunk of the body would silently restart a new session mid-stream.
 */
import { describe, expect, it } from 'vitest';

import { serializeApdu, signMessageApdus, signTxnApdus } from '../protocol';

const PATH0 = "m/44'/8478'/0'/0'";

describe('chunk planners keep P1 within one byte', () => {
  it('signTxnApdus never emits a body chunk whose P1 wraps to 0', () => {
    /* 5000-byte body at 17 bytes per chunk -> 295 body chunks. */
    const body = new Uint8Array(5000).fill(1);
    let apdus: ReturnType<typeof signTxnApdus>;
    try {
      apdus = signTxnApdus(PATH0, body, 17);
    } catch {
      return; /* fail closed: acceptable fix */
    }
    for (const a of apdus) expect(a.p1).toBeLessThanOrEqual(0xff);
    const restarts = apdus.slice(1).filter((a) => serializeApdu(a)[2] === 0);
    expect(restarts).toHaveLength(0);
  });

  it('signMessageApdus never emits a pass chunk whose P1 wraps to 0', () => {
    const msg = new Uint8Array(21 * 300).fill(2);
    let plan: ReturnType<typeof signMessageApdus>;
    try {
      plan = signMessageApdus(PATH0, msg, 21);
    } catch {
      return;
    }
    const all = [...plan.pass1, ...plan.pass2];
    for (const a of all) expect(a.p1).toBeLessThanOrEqual(0xff);
    const restarts = all.filter((a) => serializeApdu(a)[2] === 0);
    expect(restarts).toHaveLength(0);
  });
});
