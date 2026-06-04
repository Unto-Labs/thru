package org.thru.walletnative

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

/**
 * Bridges react-native-webview's `WebView` to androidx.webkit's
 * `WebSettingsCompat.setWebAuthenticationSupport`, which is required
 * for `navigator.credentials.create/get` to succeed inside the WebView.
 * This module does not create or read passkeys itself; it only flips the
 * WebView setting so the wallet page can own the WebAuthn request.
 *
 * react-native-webview does not call this itself today
 * (https://github.com/react-native-webview/react-native-webview/issues/3807),
 * so the host (ThruWalletSheet) calls our `enableWebAuthnSupport`
 * function after the WebView mounts.
 *
 * The Gradle deps (`androidx.webkit:webkit:1.14.0`,
 * `androidx.credentials:credentials*`) are pulled in by our Expo
 * config plugin; no extra host-app wiring required.
 */
class ThruWebViewBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ThruWebViewBridge")

    /**
     * Resolve the mounted react-native-webview by native view tag, find
     * the WebView inside it, and enable WebAuthn support on it.
     * Returns true if the call landed; false if the feature isn't
     * supported on this WebView (e.g. ancient WebView version), no
     * view tag was provided, or no WebView was found.
     */
    AsyncFunction("enableWebAuthnSupport") { viewTag: Int? ->
      runBlocking {
        withContext(Dispatchers.Main) {
          val rootView = appContext.currentActivity?.window?.decorView
            ?: return@withContext false
          val targetView = viewTag?.let { rootView.findViewById<View>(it) }
            ?: return@withContext false
          val webView = findWebView(targetView)
            ?: return@withContext false

          if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            return@withContext false
          }
          WebSettingsCompat.setWebAuthenticationSupport(
            webView.settings,
            WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP,
          )
          true
        }
      }
    }
  }

  /** react-native-webview wraps the WebView in an RNCWebView container;
   *  walk the descendants to find the first WebView. */
  private fun findWebView(view: View?): WebView? {
    if (view == null) return null
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }
}
