/**
 * Pairing by code entry, the computations of it (the message flow is in
 * `client.ts`). CPace and the code check are `@trezor/protocol`; what the
 * library does not guard is here (plan B2, the four guards):
 *
 * - a low-order device key gives an all-zero shared secret, which the library
 *   hashes and goes on with; the host stops (`low_order_point`);
 * - the generator string has one length byte per part, so a code or a
 *   handshake hash over 127 bytes cannot be expressed (`input_too_long`), and
 *   the library's own string is fixed to a code of six digits and gives a wrong
 *   key silently for any other length (`invalid_code`).
 *
 * The device's commitment and the code it derives are checked with the same
 * two messages the Rust host gives.
 */
import { sha256 } from '@noble/hashes/sha2.js';

import { equalBytes, toHex } from './bytes';
import { TrezorPairingError } from './errors';
import { Buffer } from './thp/node-shims';
import { thp, thpCrypto } from './thp/library';

type NodeBuffer = globalThis.Buffer;
const nb = (bytes: Uint8Array): NodeBuffer => Buffer.from(bytes) as unknown as NodeBuffer;

/** The longest code or handshake hash the generator string can carry. */
export const CPACE_MAX_INPUT = 127;
/** Length of a pairing code. */
export const CODE_LEN = 6;
/** Bytes of the random challenge the host sends. */
export const CHALLENGE_LEN = 32;

export type CpaceExchange = {
  /** Sent to the device. */
  hostPublicKey: Uint8Array;
  /** SHA-256 of the shared secret: sent to the device as the proof that the host knows the code. */
  tag: Uint8Array;
};

/** `true` for exactly six ASCII digits. */
export function isPairingCode(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}

/**
 * The host side of CPace for the six digits `code` on the channel with
 * `handshakeHash`. Draws one random private key.
 */
export function cpaceExchange(
  code: string,
  handshakeHash: Uint8Array,
  devicePublicKey: Uint8Array,
): CpaceExchange {
  const codeBytes = new TextEncoder().encode(code);
  if (codeBytes.length > CPACE_MAX_INPUT || handshakeHash.length > CPACE_MAX_INPUT) {
    throw new TrezorPairingError('input_too_long', 'the code or the handshake hash is too long for CPace');
  }
  if (!isPairingCode(code)) {
    throw new TrezorPairingError('invalid_code', `the pairing code is ${CODE_LEN} digits`);
  }
  if (devicePublicKey.length !== 32) {
    throw new TrezorPairingError('malformed_key', 'the device sent a malformed CPace key');
  }
  const keys = thp.getCpaceHostKeys(code as never, nb(handshakeHash));
  const shared = thpCrypto.curve25519(keys.privateKey, nb(devicePublicKey));
  if (shared.every((byte) => byte === 0)) {
    throw new TrezorPairingError(
      'low_order_point',
      'CPace shared secret is all zeros (low-order device public key)',
    );
  }
  const tag = thp.getSharedSecret(nb(devicePublicKey), keys.privateKey);
  return { hostPublicKey: Uint8Array.from(keys.publicKey), tag: Uint8Array.from(tag) };
}

/**
 * After the device reveals its secret: checks that it hashes to the
 * commitment the device made first, and that it yields the digits that were
 * typed. A difference is a pairing failure; its error carries no cause and
 * none of the digits.
 */
export function verifyCodeEntry(
  input: { handshakeHash: Uint8Array; commitment: Uint8Array; challenge: Uint8Array },
  code: string,
  secret: Uint8Array,
): void {
  if (!equalBytes(sha256(secret), input.commitment)) {
    throw new TrezorPairingError('commitment_mismatch', "the device's secret does not match its commitment");
  }
  try {
    thp.validateCodeEntryTag(
      {
        handshakeHash: nb(input.handshakeHash),
        handshakeCommitment: nb(input.commitment),
        codeEntryChallenge: nb(input.challenge),
      } as never,
      code,
      toHex(secret),
    );
  } catch {
    // The guarded check already drops the library's error, which quotes the digits; this one is typed.
    throw new TrezorPairingError('code_mismatch', 'the code does not belong to this connection');
  }
}
