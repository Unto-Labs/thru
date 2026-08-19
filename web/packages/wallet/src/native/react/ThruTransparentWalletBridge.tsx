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
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
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
import { isTransparentContentPresentationReason } from "../provider/NativeProvider";
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
/* The wallet page animates its own sheet in, so the surface only fades on the
   way out — long enough to not read as a cut, short enough that the host app
   is not left waiting for the screen back. */
const SURFACE_EXIT_DURATION_MS = 160;

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
  const coinbasePaymentClosingRef = useRef(false);
  const hideRequestedRef = useRef(false);
  const [isFocusSurfaceActive, setIsFocusSurfaceActive] = useState(false);
  const [isSurfaceExpanded, setIsSurfaceExpanded] = useState(false);
  const [isSurfacePresented, setIsSurfacePresented] = useState(false);
  const [isCoinbasePaymentActive, setIsCoinbasePaymentActive] = useState(false);
  const [coinbasePaymentUrl, setCoinbasePaymentUrl] = useState<string | null>(
    null,
  );
  const isSurfacePresentedRef = useRef(false);
  const exitGenerationRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const surfaceOpacity = useRef(new Animated.Value(0)).current;

  const clearCoinbasePaymentState = useCallback(() => {
    coinbasePaymentCommittedRef.current = false;
    coinbasePaymentClosingRef.current = false;
    setCoinbasePaymentUrl(null);
    setIsCoinbasePaymentActive(false);
  }, []);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reducedMotionRef.current = enabled;
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        reducedMotionRef.current = enabled;
      },
    );
    return () => {
      subscription.remove();
    };
  }, []);

  const setSurfacePresented = useCallback((presented: boolean) => {
    isSurfacePresentedRef.current = presented;
    setIsSurfacePresented(presented);
  }, []);

  /* Claim the full-screen surface while keeping it invisible. Deposit auth
     needs a full-screen WKWebView before any wallet pixels exist, and
     swallowing taps behind nothing would freeze the host app. */
  const preloadSurface = useCallback(() => {
    exitGenerationRef.current += 1;
    surfaceOpacity.stopAnimation();
    surfaceOpacity.setValue(0);
    setIsSurfaceExpanded(true);
    setSurfacePresented(false);
    setIsFocusSurfaceActive(true);
  }, [setSurfacePresented, surfaceOpacity]);

  /* No entrance animation here: the wallet page animates its own sheet in, so
     the surface it is drawn on only has to be there in time. */
  const revealSurface = useCallback(() => {
    exitGenerationRef.current += 1;
    surfaceOpacity.stopAnimation();
    surfaceOpacity.setValue(1);
    setIsSurfaceExpanded(true);
    setSurfacePresented(true);
    setIsFocusSurfaceActive(true);
  }, [setSurfacePresented, surfaceOpacity]);

  const collapseSurface = useCallback(() => {
    surfaceOpacity.setValue(0);
    setIsSurfaceExpanded(false);
    setSurfacePresented(false);
    hideRequestedRef.current = false;
    clearCoinbasePaymentState();
  }, [clearCoinbasePaymentState, setSurfacePresented, surfaceOpacity]);

  const dismissSurface = useCallback(() => {
    const generation = ++exitGenerationRef.current;
    setIsFocusSurfaceActive(false);
    surfaceOpacity.stopAnimation();
    if (!isSurfacePresentedRef.current || reducedMotionRef.current) {
      collapseSurface();
      return;
    }
    Animated.timing(surfaceOpacity, {
      toValue: 0,
      duration: SURFACE_EXIT_DURATION_MS,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      /* A request that reopens the surface mid-exit bumps the generation, which
         makes this completion stale rather than a collapse of live content. */
      if (!finished || generation !== exitGenerationRef.current) return;
      collapseSurface();
    });
  }, [collapseSurface, surfaceOpacity]);

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
        if (hideRequestedRef.current) {
          clearCoinbasePaymentState();
        }
        hideRequestedRef.current = false;
        if (
          isTransparentContentPresentationReason(reason) ||
          reason !== "deposit-open"
        ) {
          revealSurface();
        } else {
          /* Reveal the deposit surface only once the wallet's UI_SHOW event
             confirms that the stepped sheet has actually rendered. Other flows
             (including connect) present visibly straight away. */
          preloadSurface();
        }
      },
      onHideRequested: (reason) => {
        if (__DEV__) {
          console.info("[ThruTransparentWalletBridge] wallet surface hidden", {
            reason,
          });
        }
        hideRequestedRef.current = true;
        dismissSurface();
      },
    });
    return () => {
      wallet.clearUiHandlers();
    };
  }, [
    clearCoinbasePaymentState,
    dismissSurface,
    preloadSurface,
    revealSurface,
    wallet,
  ]);

  useEffect(
    () => () => {
      exitGenerationRef.current += 1;
      surfaceOpacity.stopAnimation();
    },
    [surfaceOpacity],
  );

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

  /* Keep the WebView itself clear of the keyboard, rather than telling the web
     layer how much of its viewport is covered.

     The distinction matters. Sizing the page's own fixed overlay leaves the
     WebView full-height, so WebKit still sees a focused field sitting behind
     the keyboard and scrolls the document to reveal it — and on iOS a
     `position: fixed` element travels with that scroll, dragging the sheet off
     the top of the screen. Shrinking the frame removes the cause: nothing is
     obscured, so there is nothing to scroll, and `100dvh` inside the page is
     already the usable height.

     Measure from `screenY`, not `height`. The keyboard's frame includes its
     input accessory view (the QuickType bar, or "Hide My Email" on an email
     field), which occludes the page just as much; and on the way out the
     keyboard is offscreen, where a non-zero `height` would still be reported
     but the overlap is correctly zero.

     iOS only: Android resizes the whole activity for the keyboard
     (`adjustResize`), so this View is already short by that much and insetting
     it again would subtract the keyboard twice. */
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;

    /* `WillChangeFrame` also covers an accessory view appearing on an already
       open keyboard, which `WillShow` alone would miss. */
    const subscriptions = [
      Keyboard.addListener("keyboardWillChangeFrame", (event) => {
        const keyboardTop = event.endCoordinates?.screenY;
        const screenHeight = Dimensions.get("screen").height;
        setKeyboardInset(
          keyboardTop === undefined
            ? 0
            : Math.max(0, Math.round(screenHeight - keyboardTop)),
        );
      }),
      Keyboard.addListener("keyboardWillHide", () => setKeyboardInset(0)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

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
            coinbasePaymentClosingRef.current = false;
            setIsCoinbasePaymentActive(true);
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
    if (
      coinbasePaymentCommittedRef.current ||
      coinbasePaymentClosingRef.current
    ) {
      return;
    }
    coinbasePaymentClosingRef.current = true;
    const rawData = JSON.stringify({
      eventName: "onramp_api.cancel",
      data: {},
    });
    forwardCoinbaseEvent(rawData);
    setCoinbasePaymentUrl(null);
    /* The host gave up on the provider, so hand the screen back to the wallet
       instead of waiting for a page that may never ask to be hidden. */
    setIsCoinbasePaymentActive(false);
  }, [forwardCoinbaseEvent]);

  const handleCoinbaseMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (coinbasePaymentClosingRef.current) return;
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
      } else if (
        eventName === "onramp_api.cancel" ||
        eventName === "onramp_api.polling_success"
      ) {
        coinbasePaymentClosingRef.current = true;
      }
      forwardCoinbaseEvent(normalizedRawData);
      if (shouldCloseCoinbasePayment(eventName)) {
        coinbasePaymentCommittedRef.current = false;
        setCoinbasePaymentUrl(null);
        if (
          eventName === "onramp_api.load_error" ||
          eventName === "onramp_api.commit_error" ||
          eventName === "onramp_api.polling_error"
        ) {
          setIsCoinbasePaymentActive(false);
        }
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
      coinbasePaymentClosingRef.current = false;
      setCoinbasePaymentUrl(null);
      setIsCoinbasePaymentActive(false);
    },
    [forwardCoinbaseEvent],
  );

  if (!webViewSource) return null;

  return (
    <Animated.View
      collapsable={false}
      /* An expanded surface only claims touches once it has something to show:
         the deposit preload is full-screen while still invisible, and swallowing
         taps there would freeze the host app behind nothing. */
      pointerEvents={
        isSurfaceExpanded && (isSurfacePresented || isCoinbasePaymentActive)
          ? "auto"
          : "none"
      }
      style={[
        styles.container,
        isSurfaceExpanded ? styles.activeContainer : null,
        isFocusSurfaceActive && keyboardInset > 0
          ? { paddingBottom: keyboardInset }
          : null,
        isCoinbasePaymentActive ? styles.applePayContainer : null,
        { opacity: surfaceOpacity },
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
        /* iOS ignores a programmatic focus() unless this is false, so without
           it an embedded form cannot raise the keyboard when it opens a field
           the user has already committed to — they would have to tap twice. */
        keyboardDisplayRequiresUserAction={false}
        /* This surface is a fixed overlay: the document is exactly the size of
           the webview and never scrolls. Left to its defaults the scroll view
           still reacts to the keyboard — it takes a bottom content inset and
           scrolls to reveal the focused field — and because iOS positions
           `position: fixed` against the layout viewport, that scroll drags the
           sheet up off the top of the screen. The keyboard is already handled
           by insetting this view's frame, so the scroll view has no work to do
           and is told not to invent any. Content that scrolls inside the sheet
           uses its own overflow container, which is unaffected. */
        scrollEnabled={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        limitsNavigationsToAppBoundDomains={isDirectWalletSource}
        pointerEvents={
          isCoinbasePaymentActive ? "none" : webViewProps?.pointerEvents
        }
        /* Only ever force this container to be a single accessibility element
           while the payment surface owns the screen; leaving it unset keeps the
           document's own accessibility tree reachable. */
        accessible={isCoinbasePaymentActive ? false : webViewProps?.accessible}
        accessibilityElementsHidden={isCoinbasePaymentActive}
        importantForAccessibility={
          isCoinbasePaymentActive ? "no-hide-descendants" : "auto"
        }
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
          isSurfaceExpanded ? styles.activeWebview : null,
          webViewProps?.style,
          isCoinbasePaymentActive ? styles.suspendedWalletWebview : null,
        ]}
      />
      {isCoinbasePaymentActive ? (
        <View
          accessible={false}
          onStartShouldSetResponder={() => true}
          style={styles.applePayInteractionShield}
        />
      ) : null}
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 1,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    top: 0,
    width: 1,
  },
  activeContainer: {
    bottom: 0,
    height: "100%",
    right: 0,
    width: "100%",
    zIndex: 2147483647,
  },
  applePayContainer: {
    backgroundColor: "transparent",
  },
  applePayInteractionShield: {
    backgroundColor: "transparent",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  webview: {
    backgroundColor: "transparent",
    height: 1,
    width: 1,
  },
  /* Sized by the flex parent rather than a fixed 100%, so the container's
     keyboard padding actually shortens the WebView instead of being painted
     over by a child that insists on the full height. */
  activeWebview: {
    flex: 1,
    width: "100%",
  },
  suspendedWalletWebview: {
    opacity: 0,
  },
});
