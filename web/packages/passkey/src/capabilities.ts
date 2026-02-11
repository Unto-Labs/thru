import type { PasskeyClientCapabilities } from './types';

const DEBUG = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PASSKEY_DEBUG === '1';

let cachedClientCapabilities: PasskeyClientCapabilities | null | undefined;
let clientCapabilitiesPromise: Promise<PasskeyClientCapabilities | null> | null = null;

export function isWebAuthnSupported(): boolean {
  const supported =
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined';

  if (DEBUG) {
    console.log('[Passkey] WebAuthn support check:', {
      window: typeof window !== 'undefined',
      PublicKeyCredential:
        typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined',
      credentials:
        typeof window !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.credentials !== 'undefined',
      supported,
    });
  }

  return supported;
}

async function fetchPasskeyClientCapabilities(): Promise<PasskeyClientCapabilities | null> {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential === 'undefined') {
    return null;
  }

  const getClientCapabilities = (window.PublicKeyCredential as {
    getClientCapabilities?: () => Promise<PasskeyClientCapabilities>;
  }).getClientCapabilities;

  if (typeof getClientCapabilities !== 'function') {
    return null;
  }

  try {
    const capabilities = await getClientCapabilities.call(window.PublicKeyCredential);
    if (DEBUG) {
      console.log('[Passkey] WebAuthn client capabilities:', capabilities);
    }
    return capabilities ?? null;
  } catch (error) {
    if (DEBUG) {
      console.warn('[Passkey] Failed to read client capabilities:', error);
    }
    return null;
  }
}

export function preloadPasskeyClientCapabilities(): void {
  if (cachedClientCapabilities !== undefined || clientCapabilitiesPromise) {
    return;
  }

  clientCapabilitiesPromise = fetchPasskeyClientCapabilities().then((capabilities) => {
    cachedClientCapabilities = capabilities;
    return capabilities;
  });
}

export async function getPasskeyClientCapabilities(): Promise<PasskeyClientCapabilities | null> {
  if (cachedClientCapabilities !== undefined) {
    return cachedClientCapabilities;
  }

  if (!clientCapabilitiesPromise) {
    preloadPasskeyClientCapabilities();
  }

  if (!clientCapabilitiesPromise) {
    cachedClientCapabilities = null;
    return null;
  }

  const capabilities = await clientCapabilitiesPromise;
  cachedClientCapabilities = capabilities;
  return capabilities;
}

export function getCachedPasskeyClientCapabilities(): PasskeyClientCapabilities | null | undefined {
  return cachedClientCapabilities;
}

export function isInIframe(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export type PasskeyPromptAction = 'get' | 'create';

export async function shouldUsePasskeyPopup(action: PasskeyPromptAction): Promise<boolean> {
  if (!isInIframe()) {
    return false;
  }
  const mode = await getPasskeyPromptMode(action);
  return mode === 'popup';
}

type PasskeyPromptMode = 'inline' | 'popup';

function getPermissionsPolicyAllowsFeature(feature: string): boolean | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const policy = (document as { permissionsPolicy?: { allowsFeature?: (name: string) => boolean } })
    .permissionsPolicy;
  const featurePolicy = (document as { featurePolicy?: { allowsFeature?: (name: string) => boolean } })
    .featurePolicy;
  const allowsFeature = policy?.allowsFeature || featurePolicy?.allowsFeature;

  if (typeof allowsFeature !== 'function') {
    return null;
  }

  try {
    return allowsFeature(feature);
  } catch {
    return null;
  }
}

function getCachedPromptMode(action: PasskeyPromptAction): PasskeyPromptMode | 'unknown' {
  if (!isInIframe()) {
    return 'inline';
  }

  if (cachedClientCapabilities === undefined && !clientCapabilitiesPromise) {
    preloadPasskeyClientCapabilities();
  }

  const feature =
    action === 'create' ? 'publickey-credentials-create' : 'publickey-credentials-get';
  const policyAllows = getPermissionsPolicyAllowsFeature(feature);
  const capabilities = getCachedPasskeyClientCapabilities();
  const supportsInline =
    capabilities?.passkeyPlatformAuthenticator === true ||
    capabilities?.userVerifyingPlatformAuthenticator === true;

  if (policyAllows === false) {
    return 'popup';
  }

  if (capabilities === undefined) {
    return 'unknown';
  }

  if (!supportsInline) {
    return 'popup';
  }

  return 'inline';
}

export async function getPasskeyPromptMode(action: PasskeyPromptAction): Promise<PasskeyPromptMode> {
  if (!isInIframe()) {
    return 'inline';
  }

  const feature =
    action === 'create' ? 'publickey-credentials-create' : 'publickey-credentials-get';
  const policyAllows = getPermissionsPolicyAllowsFeature(feature);
  const capabilities = await getPasskeyClientCapabilities();
  const supportsInline =
    capabilities?.passkeyPlatformAuthenticator === true ||
    capabilities?.userVerifyingPlatformAuthenticator === true;

  if (DEBUG) {
    console.log('[Passkey] Prompt mode check:', {
      action,
      policyAllows,
      supportsInline,
      capabilities,
    });
  }

  if (!supportsInline) {
    return 'popup';
  }

  if (policyAllows === false) {
    return 'popup';
  }

  return 'inline';
}

export function maybePreopenPopup(action: PasskeyPromptAction, openPopupFn: () => Window): Window | null {
  const cachedMode = getCachedPromptMode(action);
  if (cachedMode !== 'popup') {
    return null;
  }

  try {
    return openPopupFn();
  } catch {
    return null;
  }
}

export function shouldFallbackToPopup(error: unknown): boolean {
  if (!isInIframe()) {
    return false;
  }

  const name =
    error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message)
      : '';
  const normalized = `${name} ${message}`.toLowerCase();

  if (
    normalized.includes('cancel') ||
    normalized.includes('canceled') ||
    normalized.includes('cancelled') ||
    normalized.includes('user canceled') ||
    normalized.includes('user cancelled') ||
    normalized.includes('aborted')
  ) {
    return false;
  }

  if (normalized.includes('securityerror')) {
    return true;
  }

  if (normalized.includes('notallowederror')) {
    if (
      normalized.includes('permission') ||
      normalized.includes('policy') ||
      normalized.includes('iframe') ||
      normalized.includes('frame')
    ) {
      return true;
    }
  }

  return false;
}
