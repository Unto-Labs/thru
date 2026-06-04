/* Thin TypeScript shim over the Android Expo Module that wires
 * react-native-webview to androidx.webkit's
 * `setWebAuthnSupport`. On non-Android platforms (iOS, web)
 * this is a no-op - WKWebView gets WebAuthn for free once the host
 * declares `WKAppBoundDomains` (handled by our Expo config plugin). */

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/* `requireOptionalNativeModule` returns null when the module isn't
 * linked (e.g. Expo Go without the dev client, or non-Android). */
interface ThruWebViewBridgeNativeModule {
  enableWebAuthnSupport: (viewTag?: number | null) => Promise<boolean>;
}

const Native = requireOptionalNativeModule(
  'ThruWebViewBridge'
) as ThruWebViewBridgeNativeModule | null;

/**
 * Tell the mounted WebView to route WebAuthn calls through Credential
 * Manager. Returns true if the call landed, false on
 * platforms where it isn't needed or supported.
 *
 * Idempotent; safe to call on every WebView mount.
 */
export async function enableWebAuthnSupport(viewTag?: number | null): Promise<boolean> {
  if (Platform.OS !== 'android') return false; /* iOS / web: no-op. */
  if (!Native) return false; /* Module not linked (Expo Go fallback). */
  try {
    return await Native.enableWebAuthnSupport(viewTag);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[@thru/wallet/native/react] enableWebAuthnSupport failed:', err);
    return false;
  }
}
