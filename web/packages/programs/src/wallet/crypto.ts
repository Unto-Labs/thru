/**
 * P-256 curve order and half-order for low-S normalization.
 */
export const P256_N =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const P256_HALF_N = P256_N >> 1n;

/** A component's declared length may exceed the 33 bytes a P-256 value takes
    (a 0x00 sign byte plus 32); anything longer is malformed DER, not a
    signature. */
const MAX_DER_COMPONENT_LENGTH = 33;

function derByte(der: Uint8Array, offset: number, end: number, what: string): number {
  if (offset >= end) throw new Error(`Invalid DER signature: truncated ${what}`);
  return der[offset]!;
}

/**
 * Parse DER-encoded ECDSA signature to get r and s components.
 *
 * The sequence length and both INTEGER lengths are bounds checked, because
 * `Uint8Array.prototype.slice` clamps silently: an unchecked parse of
 * truncated input produces a wrong r/s instead of failing.  Only the short
 * length form is accepted (a P-256 signature is at most 72 bytes and WebAuthn
 * authenticators emit the short form); bytes trailing the declared sequence
 * are ignored, the declared lengths bound the parse.
 */
export function parseDerSignature(der: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  if (der.length < 2 || der[0] !== 0x30) throw new Error('Invalid DER signature: not a sequence');

  const sequenceLength = der[1]!;
  if (sequenceLength > 0x7f) throw new Error('Invalid DER signature: unsupported sequence length form');
  const end = 2 + sequenceLength;
  if (end > der.length) throw new Error('Invalid DER signature: truncated sequence');

  let offset = 2;

  if (derByte(der, offset, end, 'r tag') !== 0x02) throw new Error('Invalid DER signature: r is not an INTEGER');
  offset++;

  const rLen = derByte(der, offset, end, 'r length');
  offset++;
  if (rLen === 0 || rLen > MAX_DER_COMPONENT_LENGTH || offset + rLen > end) {
    throw new Error('Invalid DER signature: bad r length');
  }
  let r: Uint8Array = der.slice(offset, offset + rLen);
  offset += rLen;

  if (derByte(der, offset, end, 's tag') !== 0x02) throw new Error('Invalid DER signature: s is not an INTEGER');
  offset++;

  const sLen = derByte(der, offset, end, 's length');
  offset++;
  if (sLen === 0 || sLen > MAX_DER_COMPONENT_LENGTH || offset + sLen > end) {
    throw new Error('Invalid DER signature: bad s length');
  }
  let s: Uint8Array = der.slice(offset, offset + sLen);

  r = normalizeSignatureComponent(r);
  s = normalizeSignatureComponent(s);

  return { r, s };
}

/**
 * Ensure S is in the lower half of the curve order (BIP-62 / SEC1 compliance).
 */
export function normalizeLowS(s: Uint8Array): Uint8Array {
  const sValue = bytesToBigIntBE(s);
  if (sValue > P256_HALF_N) {
    return bigIntToBytesBE(P256_N - sValue, 32);
  }
  return s;
}

/**
 * Normalize signature component to exactly 32 bytes.
 */
export function normalizeSignatureComponent(component: Uint8Array): Uint8Array {
  if (component.length === 32) return component;

  if (component.length > 32) {
    if (component[0] === 0x00 && component.length === 33) {
      return component.slice(1);
    }
    throw new Error('Invalid signature component length');
  }

  const normalized = new Uint8Array(32);
  normalized.set(component, 32 - component.length);
  return normalized;
}

export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

export function bigIntToBytesBE(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
