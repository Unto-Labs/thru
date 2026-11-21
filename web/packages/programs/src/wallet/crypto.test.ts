import { describe, expect, it } from 'vitest';
import { parseDerSignature } from './crypto';

/** r = 1, s = 2, the shortest well formed DER signature. */
const valid = () => new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);

/** A P-256 shaped signature: both components 32 bytes, s in the high half. */
const full = () =>
  new Uint8Array([
    0x30, 0x44, 0x02, 0x20, ...new Uint8Array(32).fill(0x01), 0x02, 0x20, ...new Uint8Array(32).fill(0x02),
  ]);

describe('parseDerSignature', () => {
  it('splits a short signature into 32-byte components', () => {
    const { r, s } = parseDerSignature(valid());
    expect(r).toHaveLength(32);
    expect(s).toHaveLength(32);
    expect(r[31]).toBe(1);
    expect(s[31]).toBe(2);
  });

  it('accepts a full-size signature and strips a 0x00 sign byte', () => {
    const { r, s } = parseDerSignature(full());
    expect(r).toEqual(new Uint8Array(32).fill(0x01));
    expect(s).toEqual(new Uint8Array(32).fill(0x02));

    const signed = new Uint8Array([
      0x30, 0x26, 0x02, 0x21, 0x00, ...new Uint8Array(32).fill(0x03), 0x02, 0x01, 0x04,
    ]);
    expect(parseDerSignature(signed).r).toEqual(new Uint8Array(32).fill(0x03));
  });

  /* Uint8Array.slice clamps silently, so before the bounds checks these inputs
     parsed to a wrong r/s instead of throwing. */
  it.each([
    ['empty', new Uint8Array()],
    ['tag only', new Uint8Array([0x30])],
    ['no body', new Uint8Array([0x30, 0x06])],
    ['truncated body', new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02])],
    ['sequence longer than the input', new Uint8Array([0x30, 0x08, 0x02, 0x01, 0x01, 0x02, 0x01])],
    ['r length past the sequence', new Uint8Array([0x30, 0x03, 0x02, 0x05, 0x01])],
    ['s length past the sequence', new Uint8Array([0x30, 0x04, 0x02, 0x01, 0x01, 0x02, 0x05])],
    ['zero-length r', new Uint8Array([0x30, 0x05, 0x02, 0x00, 0x02, 0x01, 0x02])],
    ['zero-length s', new Uint8Array([0x30, 0x05, 0x02, 0x01, 0x01, 0x02, 0x00])],
    ['an oversized r', new Uint8Array([0x30, 0x27, 0x02, 0x22, ...new Uint8Array(34).fill(1), 0x02, 0x01, 0x02])],
    ['a missing s tag', new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x03, 0x01, 0x02])],
    ['a long-form length', new Uint8Array([0x30, 0x81, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02])],
  ])('rejects %s', (_name, der) => {
    expect(() => parseDerSignature(der)).toThrow(/Invalid DER signature/);
  });

  it('rejects a non-sequence', () => {
    const der = valid();
    der[0] = 0x31;
    expect(() => parseDerSignature(der)).toThrow('not a sequence');
  });
});
