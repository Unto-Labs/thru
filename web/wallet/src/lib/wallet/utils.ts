export const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
};

export const base64ToUint8Array = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const isWalletDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('thru-wallet-debug') === '1';
};

export const walletDebug = (...args: unknown[]): void => {
  if (isWalletDebugEnabled()) {
    console.log('[wallet debug]', ...args);
  }
};

export const formatU64Hex = (value: bigint): string => `0x${value.toString(16).padStart(16, '0')}`;

export const toSignedU64 = (value: bigint): bigint => {
  const maxSigned = (1n << 63n) - 1n;
  return value > maxSigned ? value - (1n << 64n) : value;
};

export type PasskeyAction = 'registration' | 'authentication';

export const isEmbeddedContext = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export const getPasskeyErrorMessage = (
  err: unknown,
  action: PasskeyAction,
  options?: { includeNotFound?: boolean }
): string => {
  const fallback =
    action === 'registration' ? 'Passkey registration failed' : 'Passkey authentication failed';
  const cancelled =
    action === 'registration'
      ? 'Passkey registration was cancelled'
      : 'Passkey authentication was cancelled';
  const message = err instanceof Error ? err.message : fallback;
  const name =
    err && typeof err === 'object' && 'name' in err
      ? String((err as { name?: unknown }).name)
      : '';
  const normalized = `${name} ${message}`.toLowerCase();
  const detailed = name ? `${name}: ${message}` : message;

  if (normalized.includes('notallowederror') || normalized.includes('cancelled')) {
    return `${cancelled}${name || message ? ` (${detailed})` : ''}`;
  }
  if (normalized.includes('securityerror')) {
    return `Security error: passkeys require HTTPS or localhost${name || message ? ` (${detailed})` : ''}`;
  }
  if (normalized.includes('notsupportederror') || normalized.includes('not supported')) {
    return `WebAuthn is not supported in this browser${name || message ? ` (${detailed})` : ''}`;
  }
  if (
    options?.includeNotFound &&
    (normalized.includes('invalidstateerror') || normalized.includes('not found'))
  ) {
    return `Passkey not found on this device${name || message ? ` (${detailed})` : ''}`;
  }

  return `${fallback}${name || message ? ` (${detailed})` : ''}`;
};

export const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
export const CLEAR_ACCOUNTS_ONCE_KEY = 'thru-wallet-clear-accounts-v1';
