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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  WebView,
  type WebViewMessageEvent,
  type WebView as WebViewType,
} from "react-native-webview";
import { getShellHtml } from "../provider/shell";
import type { NativeSDK } from "../NativeSDK";
import type { WebViewRefLike } from "../provider/WebViewBridge";
import { enableWebAuthnSupport } from "./android-webauthn";
import {
  isTrustedCoinbasePaymentUrl,
  parseCoinbaseWebViewEvent,
  shouldCloseCoinbasePayment,
  supportsCoinbaseApplePay,
} from "./coinbase-webview";
import { ApplePayWidget } from "./ApplePayWidget";
import { ThruContext } from "./ThruContext";

const NATIVE_COINBASE_PAYMENT_MESSAGE = "wallet:coinbase-payment";
const NATIVE_DEPOSIT_LIFECYCLE_MESSAGE = "wallet:deposit-lifecycle";
const NATIVE_COINBASE_PAYMENT_EVENT = "thru:coinbase-onramp-event";
const NATIVE_PLATFORM_SEARCH_PARAM = "tn_native_platform";
/* The transparent WebView covers the full screen, so the wallet page cannot
   derive the system insets itself (env(safe-area-inset-*) is 0 without
   viewport-fit=cover). Hand them over explicitly. */
const NATIVE_BOTTOM_INSET_SEARCH_PARAM = "tn_native_bottom_inset";
const NATIVE_TOP_INSET_SEARCH_PARAM = "tn_native_top_inset";

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
  const safeAreaInsets = useSafeAreaInsets();
  const webViewRef = useRef<WebViewType | null>(null);
  const webViewNativeTagRef = useRef<number | null>(null);
  const didRefreshWalletAvailabilityRef = useRef(false);
  const coinbasePaymentCommittedRef = useRef(false);
  const [isFocusSurfaceActive, setIsFocusSurfaceActive] = useState(false);
  const [coinbasePaymentUrl, setCoinbasePaymentUrl] = useState<string | null>(
    null,
  );

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
    const webView = webViewRef.current as
      | (WebViewType & {
          requestFocus?: () => void;
        })
      | null;
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
      onShowRequested: (reason) => {
        if (__DEV__) {
          console.info("[ThruTransparentWalletBridge] wallet surface shown", {
            reason,
          });
        }
        setIsFocusSurfaceActive(true);
      },
      onHideRequested: (reason) => {
        if (__DEV__) {
          console.info("[ThruTransparentWalletBridge] wallet surface hidden", {
            reason,
          });
        }
        coinbasePaymentCommittedRef.current = false;
        setCoinbasePaymentUrl(null);
        setIsFocusSurfaceActive(false);
      },
    });
    return () => {
      wallet.clearUiHandlers();
    };
  }, [wallet]);

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
    const walletFrameUrl = new URL(wallet.getIframeSrc());
    walletFrameUrl.searchParams.set(NATIVE_PLATFORM_SEARCH_PARAM, Platform.OS);
    walletFrameUrl.searchParams.set(
      NATIVE_BOTTOM_INSET_SEARCH_PARAM,
      String(Math.max(0, Math.ceil(safeAreaInsets.bottom))),
    );
    walletFrameUrl.searchParams.set(
      NATIVE_TOP_INSET_SEARCH_PARAM,
      String(Math.max(0, Math.ceil(safeAreaInsets.top))),
    );
    const walletFrameSrc = walletFrameUrl.toString();
    if (Platform.OS === "ios" && wallet.getIosWebViewMode() === "direct") {
      return { uri: walletFrameSrc };
    }
    return {
      html: getShellHtml({
        walletUrl: walletFrameSrc,
        walletOrigin: wallet.getWalletOrigin(),
      }),
      baseUrl: wallet.getWalletOrigin(),
    };
  }, [safeAreaInsets.bottom, safeAreaInsets.top, wallet]);

  const isDirectWalletSource = Boolean(
    wallet && Platform.OS === "ios" && wallet.getIosWebViewMode() === "direct",
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
        wallet?.markWebViewReady();
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
      wallet,
      webViewProps,
    ],
  );

  const forwardCoinbaseEvent = useCallback((rawData: string) => {
    const relayMessage = {
      type: NATIVE_COINBASE_PAYMENT_EVENT,
      data: rawData,
    };
    const script = `(function () {
      var message = ${JSON.stringify(relayMessage)};
      if (typeof window.__pushIn === 'function') {
        window.__pushIn(message);
      } else {
        window.dispatchEvent(new CustomEvent(${JSON.stringify(
          NATIVE_COINBASE_PAYMENT_EVENT,
        )}, { detail: message.data }));
      }
    })(); true;`;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let shouldRefreshAfterBridgeReady = false;
      try {
        const data = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          data?: { paymentUrl?: unknown };
        };
        if (data.type === NATIVE_COINBASE_PAYMENT_MESSAGE) {
          const paymentUrl = data.data?.paymentUrl;
          if (
            typeof paymentUrl === "string" &&
            isTrustedCoinbasePaymentUrl(paymentUrl)
          ) {
            if (
              Platform.OS !== "ios" ||
              !supportsCoinbaseApplePay(Platform.OS, Platform.Version)
            ) {
              forwardCoinbaseEvent(
                JSON.stringify({
                  eventName: "onramp_api.load_error",
                  data: {
                    errorCode:
                      Platform.OS === "ios"
                        ? "IOS_VERSION_UNSUPPORTED"
                        : "APPLE_PAY_PLATFORM_UNSUPPORTED",
                    errorMessage:
                      Platform.OS === "ios"
                        ? "Coinbase Apple Pay requires iOS 16 or later."
                        : "Coinbase Apple Pay is only available in the iOS wallet.",
                  },
                }),
              );
              return;
            }
            coinbasePaymentCommittedRef.current = false;
            setCoinbasePaymentUrl(paymentUrl);
          } else {
            console.warn(
              "[ThruTransparentWalletBridge] Rejected an invalid Coinbase payment URL",
            );
          }
          return;
        }
        if (data.type === NATIVE_DEPOSIT_LIFECYCLE_MESSAGE) {
          if (__DEV__) {
            console.info(
              "[ThruTransparentWalletBridge] deposit lifecycle",
              data.data,
            );
          }
          webViewProps?.onMessage?.(event);
          return;
        }
        shouldRefreshAfterBridgeReady = data.type === "iframe:ready";
      } catch {
        /* Let the bridge ignore malformed messages. */
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
      forwardCoinbaseEvent,
      refreshWalletAvailabilityIfReady,
      wallet,
      webViewProps,
    ],
  );

  const closeCoinbasePayment = useCallback(() => {
    if (coinbasePaymentCommittedRef.current) return;
    const rawData = JSON.stringify({
      eventName: "onramp_api.cancel",
      data: {},
    });
    forwardCoinbaseEvent(rawData);
    setCoinbasePaymentUrl(null);
  }, [forwardCoinbaseEvent]);

  const handleCoinbaseMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const rawData = event.nativeEvent.data;
      if (!isTrustedCoinbasePaymentUrl(event.nativeEvent.url)) return;
      const payload = parseCoinbaseWebViewEvent(rawData);
      if (!payload) return;
      const { eventName, data } = payload;
      const errorCode =
        typeof data.errorCode === "string"
          ? data.errorCode.slice(0, 128)
          : undefined;
      const errorMessage =
        typeof data.errorMessage === "string"
          ? data.errorMessage.slice(0, 512)
          : undefined;
      const normalizedRawData = JSON.stringify(payload);
      if (__DEV__) {
        console.info("[ThruTransparentWalletBridge] Coinbase payment event", {
          eventName,
          errorCode,
          errorMessage,
        });
      }
      if (eventName === "onramp_api.commit_success") {
        coinbasePaymentCommittedRef.current = true;
      }
      forwardCoinbaseEvent(normalizedRawData);
      if (shouldCloseCoinbasePayment(eventName)) {
        coinbasePaymentCommittedRef.current = false;
        setCoinbasePaymentUrl(null);
      }
    },
    [forwardCoinbaseEvent],
  );

  const forwardCoinbaseLoadError = useCallback(
    (message: string, errorCode: string) => {
      forwardCoinbaseEvent(
        JSON.stringify({
          eventName: "onramp_api.load_error",
          data: { errorCode, errorMessage: message },
        }),
      );
      coinbasePaymentCommittedRef.current = false;
      setCoinbasePaymentUrl(null);
    },
    [forwardCoinbaseEvent],
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
        onError={(event) => {
          console.error("[ThruTransparentWalletBridge] wallet WebView error", {
            description: event.nativeEvent.description,
            code: event.nativeEvent.code,
          });
          webViewProps?.onError?.(event);
        }}
        onHttpError={(event) => {
          console.error(
            "[ThruTransparentWalletBridge] wallet WebView HTTP error",
            {
              statusCode: event.nativeEvent.statusCode,
              url: event.nativeEvent.url,
            },
          );
          webViewProps?.onHttpError?.(event);
        }}
        onContentProcessDidTerminate={(event) => {
          console.error(
            "[ThruTransparentWalletBridge] wallet WebView content process terminated",
          );
          wallet?.rejectPendingRequests("Wallet WebView was interrupted");
          webViewProps?.onContentProcessDidTerminate?.(event);
        }}
        onLayout={handleWebViewLayout}
        onMessage={handleMessage}
        style={[
          styles.webview,
          isFocusSurfaceActive ? styles.activeWebview : null,
          webViewProps?.style,
        ]}
      />
      {coinbasePaymentUrl ? (
        <ApplePayWidget
          key={coinbasePaymentUrl}
          paymentUrl={coinbasePaymentUrl}
          topInset={Math.max(safeAreaInsets.top, 12)}
          bottomInset={safeAreaInsets.bottom}
          hideApplePayButton
          onCancel={closeCoinbasePayment}
          onCoinbaseMessage={handleCoinbaseMessage}
          onLoadError={forwardCoinbaseLoadError}
        />
      ) : null}
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
