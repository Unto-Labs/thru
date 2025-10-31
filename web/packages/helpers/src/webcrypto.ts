export function getWebCrypto(): Crypto {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    return cryptoObj;
  }

  throw new Error('Web Crypto API is unavailable. Provide a polyfill exposing globalThis.crypto.');
}
