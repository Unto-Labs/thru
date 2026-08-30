import { getWebCrypto } from "@thru/sdk/helpers";

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let different = 0;
  for (let index = 0; index < a.length; index += 1) {
    different |= a[index] ^ b[index];
  }

  return different === 0;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function uniqueAccounts(accounts: Uint8Array[]): Uint8Array[] {
  const unique: Uint8Array[] = [];
  for (const account of accounts) {
    if (!unique.some((candidate) => bytesEqual(candidate, account))) {
      unique.push(account);
    }
  }
  return unique;
}

export function bytesToHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export function readU32le(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const crypto = getWebCrypto();
  const digestInput = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
}
