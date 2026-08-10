import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  WebView,
  type WebViewMessageEvent,
  type WebView as WebViewType,
} from "react-native-webview";
import {
  COINBASE_APPLE_PAY_CLICK_SCRIPT,
  buildCoinbaseApplePayButtonVisibilityScript,
  isCoinbaseApplePaySandboxUrl,
  isTrustedCoinbasePaymentUrl,
  parseCoinbaseApplePayAutoClickMessage,
  parseCoinbaseEventName,
} from "./coinbase-webview";

/* This adapter follows Coinbase's mobile reference widget:
   https://github.com/mlion-cb/onramp-v2-mobile-demo/blob/master/components/onramp/ApplePayWidget.tsx

   It can hide the rendered apple-pay-button while trying the reference's
   programmatic click. Coinbase's current Headless Onramp guidance still
   requires a physical press, so the bounded fallback removes that style and
   reveals Coinbase's button instead of stranding the user. Safari 16+ permits
   Apple Pay and injected scripts in the same WKWebView. */

const FALLBACK_DELAY_MS = 5_000;

type WebViewShouldStartRequest = Parameters<
  NonNullable<ComponentProps<typeof WebView>["onShouldStartLoadWithRequest"]>
>[0];

interface ApplePayWidgetProps {
  paymentUrl: string;
  topInset: number;
  /** Home-indicator inset; keeps Coinbase's own pay button off the edge. */
  bottomInset?: number;
  hideApplePayButton?: boolean;
  onCancel: () => void;
  onCoinbaseMessage: (event: WebViewMessageEvent) => void;
  onLoadError: (message: string, errorCode: string) => void;
}

export function ApplePayWidget({
  paymentUrl,
  topInset,
  bottomInset = 0,
  hideApplePayButton = true,
  onCancel,
  onCoinbaseMessage,
  onLoadError,
}: ApplePayWidgetProps) {
  const webViewRef = useRef<WebViewType | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sandboxUi = isCoinbaseApplePaySandboxUrl(paymentUrl);
  const [hasCommitted, setHasCommitted] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  const clearFallbackTimer = useCallback(() => {
    if (!fallbackTimerRef.current) return;
    clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }, []);

  const revealFallback = useCallback(() => {
    clearFallbackTimer();
    webViewRef.current?.injectJavaScript(
      buildCoinbaseApplePayButtonVisibilityScript(false),
    );
    setShowFallback(true);
  }, [clearFallbackTimer]);

  const armFallback = useCallback(() => {
    clearFallbackTimer();
    fallbackTimerRef.current = setTimeout(revealFallback, FALLBACK_DELAY_MS);
  }, [clearFallbackTimer, revealFallback]);

  useEffect(() => () => clearFallbackTimer(), [clearFallbackTimer]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const { data, url } = event.nativeEvent;
      if (!isTrustedCoinbasePaymentUrl(url)) return;

      const autoClickMessage = parseCoinbaseApplePayAutoClickMessage(data);
      if (autoClickMessage) {
        if (
          autoClickMessage.status === "button-not-found" ||
          (autoClickMessage.status === "clicked" && sandboxUi)
        ) {
          revealFallback();
        } else {
          armFallback();
        }
        return;
      }

      const eventName = parseCoinbaseEventName(data);
      if (!eventName) return;
      if (eventName === "onramp_api.load_success") {
        webViewRef.current?.injectJavaScript(
          `${buildCoinbaseApplePayButtonVisibilityScript(
            hideApplePayButton,
          )}\n${COINBASE_APPLE_PAY_CLICK_SCRIPT}`,
        );
        /* Ten 500ms attempts finish before this safety fallback fires. A
           received "clicked" message re-arms from the actual click time. */
        armFallback();
      } else if (eventName === "onramp_api.commit_success") {
        clearFallbackTimer();
        setHasCommitted(true);
        setShowFallback(false);
      } else if (
        eventName === "onramp_api.cancel" ||
        eventName === "onramp_api.load_error" ||
        eventName === "onramp_api.commit_error" ||
        eventName === "onramp_api.polling_success" ||
        eventName === "onramp_api.polling_error"
      ) {
        clearFallbackTimer();
        setShowFallback(false);
      }

      onCoinbaseMessage(event);
    },
    [
      armFallback,
      clearFallbackTimer,
      hideApplePayButton,
      onCoinbaseMessage,
      revealFallback,
      sandboxUi,
    ],
  );

  const handleShouldStartLoad = useCallback(
    (request: WebViewShouldStartRequest) => {
      if (request.isTopFrame === false || request.url === "about:blank") {
        return true;
      }
      const trusted = isTrustedCoinbasePaymentUrl(request.url);
      if (!trusted) {
        console.warn(
          "[ApplePayWidget] Blocked top-frame navigation away from Coinbase",
        );
      }
      return trusted;
    },
    [],
  );

  return (
    <View
      style={[styles.overlay, { paddingTop: topInset, paddingBottom: bottomInset }]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>
          {hasCommitted ? "Processing" : "Apple Pay"}
        </Text>
        {!hasCommitted ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel Coinbase payment"
            hitSlop={8}
            onPress={onCancel}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.body}>
        {!showFallback ? (
          <View
            style={styles.opening}
            accessibilityRole="progressbar"
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator size="small" color="#b52f36" />
            <Text style={styles.openingText}>
              {hasCommitted ? "Processing…" : "Opening Apple Pay…"}
            </Text>
          </View>
        ) : null}
        <View
          style={showFallback ? styles.visiblePayment : styles.hiddenPayment}
          pointerEvents={showFallback ? "auto" : "none"}
          accessibilityElementsHidden={!showFallback}
          importantForAccessibility={
            showFallback ? "auto" : "no-hide-descendants"
          }
        >
          <WebView
            ref={webViewRef}
            source={{ uri: paymentUrl }}
            originWhitelist={["https://*"]}
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically
            domStorageEnabled
            webviewDebuggingEnabled={__DEV__}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            paymentRequestEnabled={Platform.OS === "android"}
            limitsNavigationsToAppBoundDomains={Platform.OS === "ios"}
            mixedContentMode="never"
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onMessage={handleMessage}
            onError={() =>
              onLoadError(
                "The Coinbase payment view could not be loaded.",
                "WEBVIEW_ERROR",
              )
            }
            onHttpError={({ nativeEvent }) =>
              onLoadError(
                `Coinbase returned HTTP ${nativeEvent.statusCode}. Try again.`,
                "WEBVIEW_HTTP_ERROR",
              )
            }
            onContentProcessDidTerminate={() =>
              onLoadError(
                "The Coinbase payment view was interrupted. Try again.",
                "WEBVIEW_TERMINATED",
              )
            }
            style={styles.webView}
          />
          {showFallback ? (
            <Text style={styles.hint} accessibilityLiveRegion="polite">
              {sandboxUi
                ? "Confirm the simulated payment in Coinbase's sandbox popup."
                : "If the Apple Pay sheet didn't open, tap Coinbase's payment button above."}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#ffffff",
    zIndex: 2,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#d8dfe3",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  title: {
    color: "#151b1e",
    fontSize: 16,
    fontWeight: "600",
  },
  cancelButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 64,
  },
  cancelText: {
    color: "#b52f36",
    fontSize: 16,
    fontWeight: "600",
  },
  body: {
    flex: 1,
  },
  opening: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
  },
  openingText: {
    color: "#56636a",
    fontSize: 15,
  },
  visiblePayment: {
    flex: 1,
    gap: 12,
    padding: 16,
  },
  hiddenPayment: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    zIndex: -1,
  },
  webView: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  hint: {
    color: "#56636a",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
});
