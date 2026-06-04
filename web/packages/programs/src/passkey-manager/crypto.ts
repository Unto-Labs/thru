/**
 * P-256 curve order and half-order for low-S normalization.
 */
export const P256_N =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const P256_HALF_N = P256_N >> 1n;

/**
 * Parse DER-encoded ECDSA signature to get r and s components.
 */
export function parseDerSignature(der: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  if (der[0] !== 0x30) throw new Error('Invalid DER signature');

  let offset = 2;

  if (der[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;

  const rLen = der[offset++];
  let r: Uint8Array = der.slice(offset, offset + rLen);
  offset += rLen;

  if (der[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;

  const sLen = der[offset++];
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
