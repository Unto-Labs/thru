import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
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
  canCancelCoinbasePayment,
  coinbasePaymentEscape,
  isCoinbaseApplePaySandboxUrl,
  isTrustedCoinbasePaymentUrl,
  parseCoinbaseApplePayAutoClickMessage,
  parseCoinbaseEventName,
  shouldCloseCoinbasePayment,
  type CoinbasePaymentProgress,
} from "./coinbase-webview";

/* This adapter follows Coinbase's mobile reference widget:
   https://github.com/mlion-cb/onramp-v2-mobile-demo/blob/master/components/onramp/ApplePayWidget.tsx

   It hides the rendered apple-pay-button while trying the reference's
   programmatic click. Production keeps this WebView mounted but transparent
   after ApplePaySession.begin() presents the system sheet. Explicit sandbox
   URLs retain the visible Coinbase control for local testing. */

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
  const sandboxUi = isCoinbaseApplePaySandboxUrl(paymentUrl);
  const [showFallback, setShowFallback] = useState(false);
  const [progress, setProgress] = useState<CoinbasePaymentProgress>("pending");
  const [lastSignalAt, setLastSignalAt] = useState(() => Date.now());

  /* The transparent surface swallows every touch while this widget is mounted,
     so a provider that goes quiet would otherwise leave the user on a blank,
     unresponsive screen. Bound the silence, measured from the last sign of life
     from Coinbase. */
  useEffect(() => {
    const escape = coinbasePaymentEscape(progress, showFallback);
    if (!escape) return;
    const timer = setTimeout(
      () => {
        if (escape.action !== "reveal") {
          onCancel();
          return;
        }
        /* The auto-click hid Coinbase's own control, so reveal it before
           telling the user to finish the payment there. */
        webViewRef.current?.injectJavaScript(
          buildCoinbaseApplePayButtonVisibilityScript(false),
        );
        setShowFallback(true);
      },
      Math.max(0, escape.delayMs - (Date.now() - lastSignalAt)),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [lastSignalAt, onCancel, progress, showFallback]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const { data, url } = event.nativeEvent;
      if (!isTrustedCoinbasePaymentUrl(url)) return;

      const autoClickMessage = parseCoinbaseApplePayAutoClickMessage(data);
      if (autoClickMessage) {
        if (autoClickMessage.status === "sheet-presented") {
          setProgress("presented");
          setLastSignalAt(Date.now());
        } else {
          onCancel();
        }
        return;
      }

      const eventName = parseCoinbaseEventName(data);
      if (!eventName) return;
      /* Anything short of a terminal event only proves the provider is still
         alive, so it restarts the silence bound rather than releasing it. A
         commit is charged but not terminal: it still needs a bound, and it can
         no longer be cancelled. */
      if (shouldCloseCoinbasePayment(eventName)) setProgress("settled");
      else {
        if (eventName === "onramp_api.commit_success") setProgress("committed");
        setLastSignalAt(Date.now());
      }
      if (eventName === "onramp_api.load_success") {
        if (sandboxUi) {
          webViewRef.current?.injectJavaScript(
            buildCoinbaseApplePayButtonVisibilityScript(false),
          );
          setShowFallback(true);
        } else {
          webViewRef.current?.injectJavaScript(
            `${buildCoinbaseApplePayButtonVisibilityScript(
              hideApplePayButton,
            )}\n${COINBASE_APPLE_PAY_CLICK_SCRIPT}`,
          );
        }
      } else if (
        eventName === "onramp_api.commit_success" ||
        eventName === "onramp_api.cancel" ||
        eventName === "onramp_api.load_error" ||
        eventName === "onramp_api.commit_error" ||
        eventName === "onramp_api.polling_success" ||
        eventName === "onramp_api.polling_error"
      ) {
        setShowFallback(false);
      }

      onCoinbaseMessage(event);
    },
    [
      hideApplePayButton,
      onCancel,
      onCoinbaseMessage,
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
      accessible={false}
      onStartShouldSetResponder={() => true}
      style={[
        styles.overlay,
        showFallback ? styles.fallbackOverlay : null,
        showFallback
          ? { paddingTop: topInset, paddingBottom: bottomInset }
          : null,
      ]}
    >
      {showFallback ? (
        <View style={styles.header}>
          <Text style={styles.title}>Apple Pay</Text>
          {canCancelCoinbasePayment(progress) ? (
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
      ) : null}
      <View style={styles.body}>
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
                : canCancelCoinbasePayment(progress)
                  ? "Finish the payment in Coinbase, or cancel to go back."
                  : "Your payment went through. Coinbase is still confirming it."}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "transparent",
    zIndex: 2,
  },
  fallbackOverlay: {
    backgroundColor: "#ffffff",
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
  visiblePayment: {
    flex: 1,
    gap: 12,
    padding: 16,
  },
  hiddenPayment: {
    ...StyleSheet.absoluteFill,
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
