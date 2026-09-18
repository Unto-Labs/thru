/* Host color-scheme resolution shared by the browser and native SDKs. Free of
 * DOM and React Native imports: `matchMedia` is read off globalThis when it
 * exists, so this also loads (as a no-op watcher) under React Native. */

import type { WalletTheme, WalletThemePreference } from './protocol';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** Coerce an untyped config or prop value; anything unknown draws light. */
export function normalizeWalletThemePreference(value: unknown): WalletThemePreference {
  return value === 'dark' || value === 'system' ? value : 'light';
}

/** The scheme the wallet draws for, given the host's choice and the OS setting. */
export function resolveWalletTheme(
  preference: WalletThemePreference,
  systemTheme: WalletTheme,
): WalletTheme {
  return preference === 'system' ? systemTheme : preference;
}

/** The OS/browser color scheme now; light where it cannot be read (SSR, React Native). */
export function readSystemTheme(): WalletTheme {
  return getDarkSchemeQuery()?.matches ? 'dark' : 'light';
}

/**
 * Call `onChange` whenever the OS/browser color scheme flips. Returns the
 * unsubscribe; a no-op where `matchMedia` is unavailable.
 */
export function watchSystemTheme(onChange: (theme: WalletTheme) => void): () => void {
  const query = getDarkSchemeQuery();
  if (!query) return () => {};
  const listener = (event: { matches: boolean }) => onChange(event.matches ? 'dark' : 'light');
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  /* Safari before 14 only has the deprecated listener API. */
  query.addListener?.(listener);
  return () => query.removeListener?.(listener);
}

function getDarkSchemeQuery(): MediaQueryList | null {
  const matchMedia = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof matchMedia !== 'function') return null;
  try {
    return matchMedia.call(globalThis, DARK_SCHEME_QUERY);
  } catch {
    return null;
  }
}
