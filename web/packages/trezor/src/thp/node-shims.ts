/**
 * The parts of Node's `crypto` and `Buffer` that `@trezor/protocol` uses, on
 * `@noble/*` and the `buffer` package, so that the bundle runs in any page
 * without the application's bundler supplying Node built-ins (B3).
 *
 * Only what the library calls is here, with the algorithms it calls them
 * with: SHA-256 and SHA-512 hashes, HMAC-SHA-256, AES-256-GCM with a 12-byte
 * nonce, and random bytes. Anything else throws.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer/';

import { copyBytes } from '../bytes';

export { Buffer };

type Data = Uint8Array | string;

function toBytes(data: Data): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data;
}

/** A copy, so that the result never aliases a hash's or a cipher's own memory. */
function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

// ---- randomness ----

let randomSource: ((length: number) => Uint8Array) | undefined;

/**
 * What a call of {@link setRandomBytesSource} must say to be accepted: the
 * function exists for tests, and an application must not call it by accident.
 */
export type RandomSourceTestOnly = { readonly forTests: true };

/**
 * FOR TESTS ONLY. Replaces the source of `randomBytes` (a scripted one in the
 * vector tests: the Rust host's test builds script their randomness the same
 * way); `undefined` restores the platform's `crypto.getRandomValues`. It is
 * exported because the vector tests run against the built browser bundle, and
 * it is never needed to use the package. A call without the explicit
 * `{ forTests: true }` as its second argument throws and changes nothing, so
 * the default source cannot be replaced by accident (code of the same page
 * could replace `crypto.getRandomValues` itself; this does not defend against
 * that, only against a mistake).
 */
export function setRandomBytesSource(
  source: ((length: number) => Uint8Array) | undefined,
  testOnly: RandomSourceTestOnly,
): void {
  if ((testOnly as { forTests?: unknown } | undefined)?.forTests !== true) {
    throw new Error('setRandomBytesSource is for tests only: pass { forTests: true } as its second argument');
  }
  randomSource = source;
}

export function randomBytes(length: number): Buffer {
  if (randomSource) {
    const bytes = randomSource(length);
    if (bytes.length !== length) {
      throw new Error(`scripted random source returned ${bytes.length} bytes, wanted ${length}`);
    }
    return Buffer.from(bytes);
  }
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return toBuffer(out);
}

// ---- hashes ----

type HashName = 'sha256' | 'sha512';

const HASHES = { sha256, sha512 } as const;

function hashOf(name: string): (typeof HASHES)[HashName] {
  if (name !== 'sha256' && name !== 'sha512') {
    throw new Error(`unsupported hash algorithm: ${name}`);
  }
  return HASHES[name];
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function createHash(algorithm: string) {
  const hash = hashOf(algorithm);
  const chunks: Uint8Array[] = [];
  const api = {
    update(data: Data) {
      chunks.push(copyBytes(toBytes(data)));
      return api;
    },
    digest(): Buffer {
      return toBuffer(hash(concat(chunks)));
    },
  };
  return api;
}

export function createHmac(algorithm: string, key: Data) {
  const hash = hashOf(algorithm);
  const keyBytes = copyBytes(toBytes(key));
  const chunks: Uint8Array[] = [];
  const api = {
    update(data: Data) {
      chunks.push(copyBytes(toBytes(data)));
      return api;
    },
    digest(): Buffer {
      return toBuffer(hmac(hash, keyBytes, concat(chunks)));
    },
  };
  return api;
}

// ---- AES-256-GCM ----

const TAG_LENGTH = 16;

function checkGcmParams(algorithm: string, key: Uint8Array, iv: Uint8Array): void {
  if (algorithm !== 'aes-256-gcm') {
    throw new Error(`unsupported cipher: ${algorithm}`);
  }
  if (key.length !== 32) throw new Error('invalid key length');
  if (iv.length !== 12) throw new Error('invalid iv length');
}

/**
 * Node's streaming cipher interface over the one-shot AES-GCM of
 * `@noble/ciphers`. The library calls `setAAD`, then `update` once, then
 * `final` and `getAuthTag`; a second `update` is refused instead of giving a
 * wrong tag.
 */
export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  checkGcmParams(algorithm, key, iv);
  const keyBytes = copyBytes(key);
  const nonce = copyBytes(iv);
  let aad = new Uint8Array(0);
  let tag: Uint8Array | undefined;
  let updated = false;

  const seal = (plaintext: Uint8Array): Uint8Array => {
    const sealed = gcm(keyBytes, nonce, aad).encrypt(plaintext);
    tag = sealed.slice(sealed.length - TAG_LENGTH);
    return sealed.subarray(0, sealed.length - TAG_LENGTH);
  };

  return {
    setAAD(data: Uint8Array): void {
      if (updated) throw new Error('setAAD after update');
      aad = copyBytes(data);
    },
    update(data: Data): Buffer {
      if (updated) throw new Error('streaming AES-GCM update is not supported');
      updated = true;
      return toBuffer(seal(toBytes(data)));
    },
    final(): Buffer {
      if (!updated) {
        updated = true;
        seal(new Uint8Array(0));
      }
      return Buffer.alloc(0);
    },
    getAuthTag(): Buffer {
      if (!tag) throw new Error('auth tag is not available before final');
      return toBuffer(tag);
    },
  };
}

export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  checkGcmParams(algorithm, key, iv);
  const keyBytes = copyBytes(key);
  const nonce = copyBytes(iv);
  let aad = new Uint8Array(0);
  let authTag: Uint8Array | undefined;
  let updated = false;
  let failed = false;

  return {
    setAAD(data: Uint8Array): void {
      if (updated) throw new Error('setAAD after update');
      aad = copyBytes(data);
    },
    setAuthTag(tag: Uint8Array): void {
      if (tag.length !== TAG_LENGTH) throw new Error('invalid authentication tag length');
      authTag = copyBytes(tag);
    },
    update(data: Data): Buffer {
      if (updated) throw new Error('streaming AES-GCM update is not supported');
      if (!authTag) throw new Error('setAuthTag must be called before update');
      updated = true;
      const ciphertext = toBytes(data);
      const sealed = new Uint8Array(ciphertext.length + TAG_LENGTH);
      sealed.set(ciphertext, 0);
      sealed.set(authTag, ciphertext.length);
      try {
        return toBuffer(gcm(keyBytes, nonce, aad).decrypt(sealed));
      } catch {
        // Node reports a bad tag from `final`, after `update` has returned.
        failed = true;
        return Buffer.alloc(0);
      }
    },
    final(): Buffer {
      if (failed || !updated) {
        throw new Error('Unsupported state or unable to authenticate data');
      }
      return Buffer.alloc(0);
    },
  };
}
