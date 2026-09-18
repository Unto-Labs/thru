import type { PasskeyClientCapabilities } from './types';

const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;
const DEBUG = globalProcess?.env?.NEXT_PUBLIC_PASSKEY_DEBUG === '1';

let cachedClientCapabilities: PasskeyClientCapabilities | null | undefined;
let clientCapabilitiesPromise: Promise<PasskeyClientCapabilities | null> | null = null;
const inlineRefusals = new Map<PasskeyPromptAction, PasskeyRestrictionReason>();

export function markInlinePasskeyRefused(
  action: PasskeyPromptAction,
  reason: PasskeyRestrictionReason
): void {
  inlineRefusals.set(action, reason);
}

export function resetInlinePasskeyRefusal(): void {
  inlineRefusals.clear();
}

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

  const getClientCapabilities = (
    window.PublicKeyCredential as {
      getClientCapabilities?: () => Promise<PasskeyClientCapabilities>;
    }
  ).getClientCapabilities;

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

export type PasskeyRestrictionReason =
  'policy-denied' | 'unsupported-create' | 'ancestor-restriction';

export class PasskeyIframeRestrictionError extends Error {
  readonly name = 'PasskeyIframeRestrictionError';
  constructor(
    readonly action: PasskeyPromptAction,
    readonly reason: PasskeyRestrictionReason
  ) {
    super(
      reason === 'unsupported-create'
        ? 'This browser needs a separate window to create a passkey.'
        : 'This browser cannot use passkeys inside the embedded wallet.'
    );
  }
}

type Policy = { allowsFeature?: (name: string) => boolean };

export function getPermissionsPolicyAllowsFeature(feature: string): boolean | null {
  if (typeof document === 'undefined') return null;
  const doc = document as Document & { permissionsPolicy?: Policy; featurePolicy?: Policy };
  const policy =
    typeof doc.permissionsPolicy?.allowsFeature === 'function'
      ? doc.permissionsPolicy
      : doc.featurePolicy;
  if (typeof policy?.allowsFeature !== 'function') return null;
  try {
    return policy.allowsFeature.call(policy, feature);
  } catch {
    return null;
  }
}

function isCrossOriginIframe(): boolean {
  if (!isInIframe()) return false;
  try {
    // Check every ancestor, including a same-origin top with a cross-origin intermediate frame.
    let ancestor = window.parent;
    while (ancestor !== window) {
      if (ancestor.location.origin !== window.location.origin) return true;
      if (ancestor === ancestor.parent) break;
      ancestor = ancestor.parent;
    }
    return false;
  } catch {
    return true;
  }
}

function isKnownWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Includes iOS browsers backed by WebKit, but excludes Chromium/Firefox desktop.
  return /AppleWebKit/i.test(ua) && !/(Chrome|Chromium|Edg|OPR|Android)\//i.test(ua);
}

/** Synchronous and independent of asynchronous authenticator capability probes. */
export function getPasskeyRestriction(
  action: PasskeyPromptAction
): PasskeyIframeRestrictionError | null {
  if (!isInIframe()) return null;
  const remembered = inlineRefusals.get(action);
  if (remembered) return new PasskeyIframeRestrictionError(action, remembered);
  if (getPermissionsPolicyAllowsFeature(`publickey-credentials-${action}`) === false) {
    return new PasskeyIframeRestrictionError(action, 'policy-denied');
  }
  if (action === 'create' && isCrossOriginIframe() && isKnownWebKit()) {
    return new PasskeyIframeRestrictionError(action, 'unsupported-create');
  }
  return null;
}

export async function getPasskeyPromptMode(
  action: PasskeyPromptAction
): Promise<'inline' | 'popup'> {
  return getPasskeyRestriction(action) ? 'popup' : 'inline';
}

export async function shouldUsePasskeyPopup(action: PasskeyPromptAction): Promise<boolean> {
  return Boolean(getPasskeyRestriction(action));
}

/** Compatibility helper: implicit routing must never open speculative windows. */
export function maybePreopenPopup(
  _action: PasskeyPromptAction,
  _openPopupFn: () => Window
): Window | null {
  return null;
}

export function classifyIframeRestriction(
  error: unknown,
  action: PasskeyPromptAction
): PasskeyIframeRestrictionError | null {
  if (!isInIframe()) return null;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message).toLowerCase()
      : '';
  if (name === 'AbortError' || /cancel|aborted/.test(message)) return null;
  if (
    message.includes("invalid 'sameoriginwithancestors' value") ||
    message.includes('origin of the document is not the same as its ancestors')
  ) {
    return new PasskeyIframeRestrictionError(action, 'ancestor-restriction');
  }
  if (
    (name === 'NotAllowedError' || name === 'SecurityError') &&
    /permissions?[ -]policy/.test(message)
  ) {
    return new PasskeyIframeRestrictionError(action, 'policy-denied');
  }
  return null;
}

export function shouldFallbackToPopup(error: unknown): boolean {
  return Boolean(classifyIframeRestriction(error, 'get'));
}
