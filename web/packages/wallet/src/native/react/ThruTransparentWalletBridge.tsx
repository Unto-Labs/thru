/* Hidden native wallet WebView for transparent integrations. Hosts compose
   this alongside <ThruProvider config={{ walletExperience: "transparent" }}>
   so wallet requests can run without opening bottom-sheet UI. */

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  WebView,
  type WebViewMessageEvent,
  type WebView as WebViewType,
} from "react-native-webview";
import { getShellHtml } from "../provider/shell";
import type { NativeSDK } from "../NativeSDK";
import type { WebViewRefLike } from "../provider/WebViewBridge";
import { enableWebAuthnSupport } from "./android-webauthn";
import { ThruContext } from "./ThruContext";

type WebViewLoadEndEvent = Parameters<
  NonNullable<ComponentProps<typeof WebView>["onLoadEnd"]>
>[0];

export interface ThruTransparentWalletBridgeProps {
  wallet?: NativeSDK | null;
  style?: StyleProp<ViewStyle>;
  webViewProps?: Partial<ComponentProps<typeof WebView>>;
}

export function ThruTransparentWalletBridge({
  wallet: walletProp,
  style,
  webViewProps,
}: ThruTransparentWalletBridgeProps) {
  const thruContext = useContext(ThruContext);
  const wallet = walletProp ?? thruContext?.wallet ?? null;
  const webViewRef = useRef<WebViewType | null>(null);
  const webViewNativeTagRef = useRef<number | null>(null);
  const didRefreshWalletAvailabilityRef = useRef(false);
  const [isFocusSurfaceActive, setIsFocusSurfaceActive] = useState(false);

  const attachIfReady = useCallback(() => {
    if (!wallet || !webViewRef.current) return;
    const ref: WebViewRefLike = {
      injectJavaScript: (script: string) => {
        webViewRef.current?.injectJavaScript(script);
      },
    };
    wallet.attachWebView(ref);
  }, [wallet]);

  const enableAndroidWebAuthnIfNeeded = useCallback(async () => {
    if (Platform.OS !== "android") return false;
    const enabled = await enableWebAuthnSupport(webViewNativeTagRef.current);
    webViewRef.current?.injectJavaScript(
      "window.dispatchEvent(new Event('thru:native-webauthn-ready')); true;",
    );
    return enabled;
  }, []);

  const focusWebViewDocument = useCallback(() => {
    const webView = webViewRef.current as (WebViewType & {
      requestFocus?: () => void;
    }) | null;
    webView?.requestFocus?.();
    webViewRef.current?.injectJavaScript(
      "try { window.focus(); document.body && document.body.focus && document.body.focus(); } catch (_) {} true;",
    );
  }, []);

  const refreshWalletAvailabilityIfReady = useCallback(() => {
    if (!wallet || didRefreshWalletAvailabilityRef.current) return;
    didRefreshWalletAvailabilityRef.current = true;
    void wallet.refreshWalletAvailability();
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    wallet.setUiHandlers({
      onShowRequested: () => {
        setIsFocusSurfaceActive(true);
      },
      onHideRequested: () => {
        setIsFocusSurfaceActive(false);
      },
    });
    return () => {
      wallet.clearUiHandlers();
    };
  }, [focusWebViewDocument, wallet]);

  useEffect(() => {
    if (!isFocusSurfaceActive) return;
    const timers = [0, 50, 120, 250, 500].map((delay) =>
      setTimeout(focusWebViewDocument, delay),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [focusWebViewDocument, isFocusSurfaceActive]);

  const webViewSource = useMemo(() => {
    if (!wallet) return null;
    if (Platform.OS === "ios" && wallet.getIosWebViewMode() === "direct") {
      return { uri: wallet.getIframeSrc() };
    }
    return {
      html: getShellHtml({
        walletUrl: wallet.getIframeSrc(),
        walletOrigin: wallet.getWalletOrigin(),
      }),
      baseUrl: wallet.getWalletOrigin(),
    };
  }, [wallet]);

  const isDirectWalletSource = Boolean(
    wallet &&
      Platform.OS === "ios" &&
      wallet.getIosWebViewMode() === "direct",
  );

  useEffect(() => {
    didRefreshWalletAvailabilityRef.current = false;
  }, [webViewSource]);

  const handleWebViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const target = (event.nativeEvent as { target?: unknown }).target;
      webViewNativeTagRef.current =
        typeof target === "number" ? target : webViewNativeTagRef.current;
      void enableAndroidWebAuthnIfNeeded();
      webViewProps?.onLayout?.(event);
    },
    [enableAndroidWebAuthnIfNeeded, webViewProps],
  );

  const handleLoadEnd = useCallback(
    (event: WebViewLoadEndEvent) => {
      attachIfReady();
      if (isDirectWalletSource) {
        void enableAndroidWebAuthnIfNeeded().finally(
          refreshWalletAvailabilityIfReady,
        );
      } else {
        void enableAndroidWebAuthnIfNeeded();
      }
      webViewProps?.onLoadEnd?.(event);
    },
    [
      attachIfReady,
      enableAndroidWebAuthnIfNeeded,
      isDirectWalletSource,
      refreshWalletAvailabilityIfReady,
      webViewProps,
    ],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let shouldRefreshAfterBridgeReady = false;
      let shouldCollapseFocusSurface = false;
      try {
        const data = JSON.parse(event.nativeEvent.data) as {
          id?: unknown;
          success?: unknown;
          type?: string;
        };
        shouldRefreshAfterBridgeReady = data.type === "iframe:ready";
        shouldCollapseFocusSurface =
          typeof data.id === "string" && typeof data.success === "boolean";
      } catch {
        /* Let the bridge ignore malformed messages. */
      }

      if (shouldCollapseFocusSurface) {
        setIsFocusSurfaceActive(false);
      }

      wallet?.onMessage({
        nativeEvent: { data: event.nativeEvent.data },
      });
      webViewProps?.onMessage?.(event);

      if (shouldRefreshAfterBridgeReady) {
        void enableAndroidWebAuthnIfNeeded().finally(
          refreshWalletAvailabilityIfReady,
        );
      }
    },
    [
      enableAndroidWebAuthnIfNeeded,
      refreshWalletAvailabilityIfReady,
      wallet,
      webViewProps,
    ],
  );

  if (!webViewSource) return null;

  return (
    <View
      collapsable={false}
      pointerEvents={isFocusSurfaceActive ? "auto" : "none"}
      style={[
        styles.container,
        isFocusSurfaceActive ? styles.activeContainer : null,
        style,
      ]}
    >
      <WebView
        {...webViewProps}
        ref={webViewRef}
        source={webViewSource}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        webviewDebuggingEnabled={__DEV__}
        sharedCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        limitsNavigationsToAppBoundDomains={isDirectWalletSource}
        onLoadStart={(event) => {
          attachIfReady();
          void enableAndroidWebAuthnIfNeeded();
          webViewProps?.onLoadStart?.(event);
        }}
        onLoadEnd={handleLoadEnd}
        onLayout={handleWebViewLayout}
        onMessage={handleMessage}
        style={[
          styles.webview,
          isFocusSurfaceActive ? styles.activeWebview : null,
          webViewProps?.style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 1,
    left: 0,
    opacity: 0,
    overflow: "hidden",
    position: "absolute",
    top: 0,
    width: 1,
  },
  activeContainer: {
    bottom: 0,
    height: "100%",
    opacity: 1,
    right: 0,
    width: "100%",
    zIndex: 2147483647,
  },
  webview: {
    backgroundColor: "transparent",
    height: 1,
    width: 1,
  },
  activeWebview: {
    flex: 1,
    height: "100%",
    width: "100%",
  },
});
