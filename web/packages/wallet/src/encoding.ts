const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_LOOKUP: readonly number[] = (() => {
  // Dense 128-entry table: O(1) lookup, no Map allocation, -1 = invalid.
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decodes standard base64 (RFC 4648) into bytes.
 *
 * Strict on purpose: this runs on the signature↔wire boundary (a signed
 * transaction decoded here must be byte-identical to what the wallet signed),
 * so any non-canonical input is rejected rather than silently coerced.
 *
 * Rejects: characters outside the alphabet, `=` anywhere but as trailing
 * padding of the final quartet, over-/under-padding, and non-zero tail bits
 * that a canonical encoder would never emit.
 */
export function base64ToBytes(value: string): Uint8Array {
  const s = value.replace(/\s+/g, "");
  if (s.length === 0) return new Uint8Array();
  if (s.length % 4 !== 0) {
    // Standard base64 is always a whole number of quartets once padded;
    // an unpadded remainder of 1 is impossible, 2/3 require explicit `=`.
    throw new Error("Invalid base64: length is not a multiple of 4");
  }

  let padding = 0;
  if (s[s.length - 1] === "=") padding = s[s.length - 2] === "=" ? 2 : 1;

  const out = new Uint8Array((s.length / 4) * 3 - padding);
  let o = 0;

  for (let i = 0; i < s.length; i += 4) {
    const lastQuartet = i + 4 === s.length;

    const c0 = s.charCodeAt(i);
    const c1 = s.charCodeAt(i + 1);
    const c2 = s.charCodeAt(i + 2);
    const c3 = s.charCodeAt(i + 3);

    const a = c0 < 128 ? BASE64_LOOKUP[c0] : -1;
    const b = c1 < 128 ? BASE64_LOOKUP[c1] : -1;
    // `=` is only ever legal in the final quartet, positions 3 and/or 4.
    const cIsPad = lastQuartet && s[i + 2] === "=";
    const dIsPad = lastQuartet && s[i + 3] === "=";
    const c = cIsPad ? 0 : c2 < 128 ? BASE64_LOOKUP[c2] : -1;
    const d = dIsPad ? 0 : c3 < 128 ? BASE64_LOOKUP[c3] : -1;

    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error("Invalid base64: illegal character or misplaced padding");
    }
    // `xxx=` is legal; `xx=x` is not.
    if (cIsPad && !dIsPad) {
      throw new Error("Invalid base64: malformed padding");
    }
    // Canonical-form check: bits that padding discards must be zero.
    if (dIsPad && !cIsPad && (d = 0, (c & 0b0011) !== 0)) {
      throw new Error("Invalid base64: non-canonical trailing bits");
    }
    if (cIsPad && (b & 0b1111) !== 0) {
      throw new Error("Invalid base64: non-canonical trailing bits");
    }

    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (chunk >> 16) & 0xff;
    if (!cIsPad) out[o++] = (chunk >> 8) & 0xff;
    if (!dIsPad) out[o++] = chunk & 0xff;
  }

  return out;
}