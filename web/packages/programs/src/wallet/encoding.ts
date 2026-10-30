import { hexToBytes as sharedHexToBytes } from '@thru/sdk/helpers';

export { bytesEqual, compareBytes, uniqueAccounts } from '../helpers/bytes';

export function arrayBufferToBase64Url(buffer: ArrayBuffer | SharedArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let base64 = '';
  for (let i = 0; i < bytes.length; i++) {
    base64 += String.fromCharCode(bytes[i]);
  }
  return btoa(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  const slice = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return arrayBufferToBase64Url(slice);
}

export function bytesToBase64(bytes: Uint8Array): string {
  type BufferLike = {
    from(value: Uint8Array): { toString(encoding: 'base64'): string };
  };
  const globalBuffer =
    typeof globalThis !== 'undefined' ? (globalThis as { Buffer?: BufferLike }).Buffer : undefined;
  if (globalBuffer) {
    return globalBuffer.from(bytes).toString('base64');
  }

  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  throw new Error('Base64 encoding is not supported in this environment');
}

export function base64UrlToBytes(base64Url: string): Uint8Array {
  return new Uint8Array(base64UrlToArrayBuffer(base64Url));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  return sharedHexToBytes(hex);
}
