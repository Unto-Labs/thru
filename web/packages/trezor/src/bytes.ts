/** Small byte helpers shared by the package. */

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * An owning copy of `value`: a new array with its own memory. `slice` is not
 * one for a Node `Buffer` (or the package's `Buffer`): there it is a view that
 * shares memory with the original, so a caller who changes its `Buffer` while a
 * request waits would change what is sent. Every place that keeps bytes across
 * an `await`, or past the end of the call that was given them, copies with this.
 */
export function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  // `new Uint8Array(undefined)` is an empty array, not an error: a value that is not bytes must not turn into an empty body.
  if (!(value instanceof Uint8Array)) throw new TypeError('expected bytes (a Uint8Array)');
  return new Uint8Array(value);
}

/**
 * Strict hex decoding: even length, hex digits only, no prefix. The error says
 * what is wrong with the text and never quotes it: the text may be a private
 * key.
 */
export function fromHex(hex: string): Uint8Array {
  if (typeof hex !== 'string') throw new Error('invalid hex string: not text');
  if (hex.length % 2 !== 0) throw new Error('invalid hex string: odd length');
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error('invalid hex string: not only hex digits');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Strict standard base64 (RFC 4648, with padding), as the app image files are written. */
export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error('invalid base64');
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const c = text[i + j];
      n = (n << 6) | (c === '=' ? 0 : BASE64_ALPHABET.indexOf(c));
    }
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
