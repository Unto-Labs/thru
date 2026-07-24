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
  Pressable,
  Platform,
  StyleSheet,
  Text,
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
  parseCoinbaseEventName,
  shouldCloseCoinbasePayment,
  supportsCoinbaseApplePay,
} from "./coinbase-webview";
import { ThruContext } from "./ThruContext";

const NATIVE_COINBASE_PAYMENT_MESSAGE = "wallet:coinbase-payment";
const NATIVE_DEPOSIT_LIFECYCLE_MESSAGE = "wallet:deposit-lifecycle";
const NATIVE_COINBASE_PAYMENT_EVENT = "thru:coinbase-onramp-event";

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
    const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(
      NATIVE_COINBASE_PAYMENT_EVENT,
    )}, { detail: ${JSON.stringify(rawData)} })); true;`;
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
            if (!supportsCoinbaseApplePay(Platform.OS, Platform.Version)) {
              forwardCoinbaseEvent(
                JSON.stringify({
                  eventName: "onramp_api.load_error",
                  data: {
                    errorCode: "IOS_VERSION_UNSUPPORTED",
                    errorMessage:
                      "Coinbase Apple Pay requires iOS 16 or later.",
                  },
                }),
              );
              return;
            }
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
      const eventName = parseCoinbaseEventName(rawData);
      if (!eventName) return;
      if (__DEV__) {
        let errorCode: string | undefined;
        let errorMessage: string | undefined;
        try {
          const payload = JSON.parse(rawData) as {
            data?: { errorCode?: unknown; errorMessage?: unknown };
          };
          if (typeof payload.data?.errorCode === "string") {
            errorCode = payload.data.errorCode.slice(0, 128);
          }
          if (typeof payload.data?.errorMessage === "string") {
            errorMessage = payload.data.errorMessage.slice(0, 512);
          }
        } catch {
          /* parseCoinbaseEventName already validated the event envelope. */
        }
        console.info("[ThruTransparentWalletBridge] Coinbase payment event", {
          eventName,
          errorCode,
          errorMessage,
        });
      }
      forwardCoinbaseEvent(rawData);
      if (shouldCloseCoinbasePayment(eventName)) {
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
        <View
          style={[
            styles.coinbasePaymentOverlay,
            { paddingTop: Math.max(safeAreaInsets.top, 12) },
          ]}
        >
          <View style={styles.coinbasePaymentHeader}>
            <Text style={styles.coinbasePaymentTitle}>Coinbase sandbox</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel Coinbase payment"
              hitSlop={8}
              onPress={closeCoinbasePayment}
              style={styles.coinbaseCancelButton}
            >
              <Text style={styles.coinbaseCancelText}>Cancel</Text>
            </Pressable>
          </View>
          <WebView
            source={{ uri: coinbasePaymentUrl }}
            originWhitelist={["*"]}
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically
            domStorageEnabled
            webviewDebuggingEnabled={__DEV__}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            paymentRequestEnabled={Platform.OS === "android"}
            limitsNavigationsToAppBoundDomains={Platform.OS === "ios"}
            onShouldStartLoadWithRequest={(request) => {
              if (
                request.isTopFrame === false ||
                request.url === "about:blank"
              ) {
                return true;
              }
              return isTrustedCoinbasePaymentUrl(request.url);
            }}
            onMessage={handleCoinbaseMessage}
            onError={() =>
              forwardCoinbaseLoadError(
                "The Coinbase payment view could not be loaded.",
                "WEBVIEW_ERROR",
              )
            }
            onHttpError={({ nativeEvent }) =>
              forwardCoinbaseLoadError(
                `Coinbase returned HTTP ${nativeEvent.statusCode}. Try again.`,
                "WEBVIEW_HTTP_ERROR",
              )
            }
            onContentProcessDidTerminate={() =>
              forwardCoinbaseLoadError(
                "The Coinbase payment view was interrupted. Try again.",
                "WEBVIEW_TERMINATED",
              )
            }
            style={styles.coinbasePaymentWebView}
          />
        </View>
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
  coinbasePaymentOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#ffffff",
    zIndex: 2,
  },
  coinbasePaymentHeader: {
    alignItems: "center",
    borderBottomColor: "#d8dfe3",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  coinbasePaymentTitle: {
    color: "#151b1e",
    fontSize: 16,
    fontWeight: "600",
  },
  coinbaseCancelButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 64,
  },
  coinbaseCancelText: {
    color: "#b52f36",
    fontSize: 16,
    fontWeight: "600",
  },
  coinbasePaymentWebView: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
});
