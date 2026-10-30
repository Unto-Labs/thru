import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  useWindowDimensions,
} from "react-native";
import BottomSheet, { BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import type BottomSheetType from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  WebView,
  type WebViewMessageEvent,
  type WebView as WebViewType,
} from "react-native-webview";
import { ErrorCode } from "../../protocol";
import { getShellHtml } from "../provider/shell";
import type { WebViewRefLike } from "../provider/WebViewBridge";
import { useThru } from "./hooks/useThru";
import { enableWebAuthnSupport } from "./android-webauthn";
import { ApplePayWidget } from "./ApplePayWidget";
import {
  CoinbasePaymentHost,
  type CoinbasePaymentHostState,
} from "./coinbase-payment-host";
import { useWalletTheme } from "../../react/useWalletTheme";

/* The sheet chrome the wallet document cannot draw (the area behind the
   WebView, the handle, the loading state), per wallet theme. Mirrors
   @thru/design/mobile's theme colors, which this package cannot depend on. */
const SHEET_CHROME = {
  light: {
    background: "#f9fbfb",
    handle: "#cdd5db",
    title: "#172b29",
    detail: "#4b635f",
  },
  dark: {
    background: "#181b1b",
    handle: "#436465",
    title: "#f9fbfb",
    detail: "#b6cece",
  },
} as const;
const DEFAULT_SNAP_POINTS: (string | number)[] = ["50%", "85%"];
const DEFAULT_FIT_CONTENT_MAX_SHEET_RATIO = 0.75;
const DEFAULT_FIT_CONTENT_MIN_SHEET_RATIO = 0;
const SHEET_HANDLE_HEIGHT = 10;
const NATIVE_COINBASE_PAYMENT_MESSAGE = "wallet:coinbase-payment";
const NATIVE_DEPOSIT_LIFECYCLE_MESSAGE = "wallet:deposit-lifecycle";
const NATIVE_COINBASE_PAYMENT_EVENT = "thru:coinbase-onramp-event";
const NATIVE_CONTENT_HEIGHT_MESSAGE = "wallet:content-height";
const NATIVE_BOTTOM_INSET_PARAM = "tn_native_bottom_inset";

function appendNativeHostParams(urlValue: string, bottomInset: number): string {
  try {
    const url = new URL(urlValue);
    url.searchParams.set("tn_native_platform", Platform.OS);
    url.searchParams.set(
      NATIVE_BOTTOM_INSET_PARAM,
      String(Math.max(0, Math.ceil(bottomInset))),
    );
    return url.toString();
  } catch {
    return urlValue;
  }
}

export interface ThruWalletSheetProps {
  /** Detents in @gorhom format. Default: ['50%', '85%']. */
  snapPoints?: (string | number)[];
  /** Initial detent index when opening. Default: first detent. */
  initialOpenIndex?: number;
  /** Optional override for the bottom sheet background colour (default follows the wallet theme). */
  backgroundColor?: string;
}

export interface ThruWalletSheetHandle {
  /** Imperatively open to a specific snap index. */
  expand: (index?: number) => void;
  /** Imperatively close the sheet. */
  close: () => void;
}

export const ThruWalletSheet = forwardRef<
  ThruWalletSheetHandle,
  ThruWalletSheetProps
>(function ThruWalletSheet(
  { snapPoints, initialOpenIndex, backgroundColor: backgroundColorOverride },
  ref,
) {
  const { wallet } = useThru();
  const chrome = SHEET_CHROME[useWalletTheme(wallet)];
  const backgroundColor = backgroundColorOverride ?? chrome.background;
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetType>(null);
  const webViewRef = useRef<WebViewType | null>(null);
  const webViewNativeTagRef = useRef<number | null>(null);
  const [coinbase, setCoinbase] = useState<CoinbasePaymentHostState>({
    active: false,
    payment: null,
  });
  const forwardCoinbaseEvent = useCallback((rawData: string) => {
    const message = { type: NATIVE_COINBASE_PAYMENT_EVENT, data: rawData };
    webViewRef.current?.injectJavaScript(`(function () {
      var message = ${JSON.stringify(message)};
      if (typeof window.__pushIn === 'function') window.__pushIn(message);
      else window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_COINBASE_PAYMENT_EVENT)}, { detail: message.data }));
    })(); true;`);
  }, []);
  const coinbaseHost = useMemo(
    () => new CoinbasePaymentHost(forwardCoinbaseEvent, setCoinbase),
    [forwardCoinbaseEvent],
  );
  useEffect(() => () => coinbaseHost.reset(), [coinbaseHost, wallet]);

  const didRefreshWalletAvailabilityRef = useRef(false);
  const isProviderClosingRef = useRef(false);
  const isSurfaceRequestedRef = useRef(false);
  const isSheetOpenRef = useRef(false);
  const containerLayoutState = useSharedValue({
    height,
    offset: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  const [shellHtml, setShellHtml] = useState<string | null>(null);
  const [directWalletUrl, setDirectWalletUrl] = useState<string | null>(null);
  const [hasBridgeMessage, setHasBridgeMessage] = useState(false);
  const [walletLoadStatus, setWalletLoadStatus] = useState("Loading wallet...");
  const [webViewError, setWebViewError] = useState<string | null>(null);
  const [webContentHeight, setWebContentHeight] = useState<number | null>(null);
  const [webContentMaxSheetRatio, setWebContentMaxSheetRatio] = useState(
    DEFAULT_FIT_CONTENT_MAX_SHEET_RATIO,
  );
  const [webContentMinSheetRatio, setWebContentMinSheetRatio] = useState(
    DEFAULT_FIT_CONTENT_MIN_SHEET_RATIO,
  );
  const shouldFitContent = !snapPoints || snapPoints.length === 0;
  const configuredSnapPoints = useMemo(
    () =>
      snapPoints && snapPoints.length > 0 ? snapPoints : DEFAULT_SNAP_POINTS,
    [snapPoints],
  );
  const memoSnapPoints = useMemo(() => {
    if (!shouldFitContent || webContentHeight == null)
      return configuredSnapPoints;

    const maxSheetHeight = Math.floor(height * webContentMaxSheetRatio);
    const minSheetHeight = Math.floor(
      height * Math.min(webContentMinSheetRatio, webContentMaxSheetRatio),
    );
    const fittedSheetHeight = Math.min(
      Math.max(webContentHeight + SHEET_HANDLE_HEIGHT, minSheetHeight),
      maxSheetHeight,
    );

    if (fittedSheetHeight >= maxSheetHeight - 1) {
      return [maxSheetHeight];
    }

    return [fittedSheetHeight, maxSheetHeight];
  }, [
    configuredSnapPoints,
    height,
    shouldFitContent,
    webContentHeight,
    webContentMaxSheetRatio,
    webContentMinSheetRatio,
  ]);
  const openIndex = Math.max(
    0,
    Math.min(initialOpenIndex ?? 0, memoSnapPoints.length - 1),
  );
  const snapToSheetIndex = useCallback(
    (index: number) => {
      const maxIndex = Math.max(0, memoSnapPoints.length - 1);
      sheetRef.current?.snapToIndex(Math.max(0, Math.min(index, maxIndex)));
    },
    [memoSnapPoints.length],
  );

  useEffect(() => {
    containerLayoutState.value = {
      height,
      offset: { top: 0, bottom: 0, left: 0, right: 0 },
    };
  }, [containerLayoutState, height]);

  useEffect(() => {
    if (!wallet) return;
    const walletUrl = appendNativeHostParams(
      wallet.getIframeSrc(),
      insets.bottom,
    );
    const useDirectWallet =
      Platform.OS === "ios" && wallet.getIosWebViewMode() === "direct";
    if (useDirectWallet) {
      setDirectWalletUrl(walletUrl);
      setShellHtml(null);
    } else {
      const html = getShellHtml({
        walletUrl,
        walletOrigin: wallet.getWalletOrigin(),
      });
      setShellHtml(html);
      setDirectWalletUrl(null);
    }
    setHasBridgeMessage(false);
    setWalletLoadStatus("Loading wallet...");
    setWebViewError(null);
    setWebContentHeight(null);
    setWebContentMaxSheetRatio(DEFAULT_FIT_CONTENT_MAX_SHEET_RATIO);
    setWebContentMinSheetRatio(DEFAULT_FIT_CONTENT_MIN_SHEET_RATIO);
    didRefreshWalletAvailabilityRef.current = false;
  }, [insets.bottom, wallet]);

  const isDirectWalletSource = directWalletUrl !== null;

  /* react-native-webview leaves Android WebAuthn off; iOS WKWebView gets it
     from WKAppBoundDomains, which our Expo config plugin sets. */
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

  const handleWebViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const target = (event.nativeEvent as { target?: unknown }).target;
      webViewNativeTagRef.current =
        typeof target === "number" ? target : webViewNativeTagRef.current;
      void enableAndroidWebAuthnIfNeeded();
    },
    [enableAndroidWebAuthnIfNeeded],
  );

  const refreshWalletAvailabilityIfReady = useCallback(() => {
    if (!wallet || didRefreshWalletAvailabilityRef.current) return;
    didRefreshWalletAvailabilityRef.current = true;
    void wallet.restoreConnection();
  }, [wallet]);

  const handleLoadEnd = useCallback(() => {
    wallet?.recordWebViewLoadEnded();
    attachIfReady();
    if (isDirectWalletSource) {
      wallet?.markWebViewReady();
      setHasBridgeMessage(true);
      setWebViewError(null);
      void enableAndroidWebAuthnIfNeeded().finally(
        refreshWalletAvailabilityIfReady,
      );
    }
  }, [
    attachIfReady,
    enableAndroidWebAuthnIfNeeded,
    isDirectWalletSource,
    refreshWalletAvailabilityIfReady,
    wallet,
  ]);

  useEffect(() => {
    if (!wallet) return;
    wallet.setUiHandlers({
      onShowRequested: () => {
        isSurfaceRequestedRef.current = true;
        // A previous close animation can still report -1 while reopening.
        // Keep its guard until the new open index is observed.
        snapToSheetIndex(openIndex);
      },
      onHideRequested: () => {
        isSurfaceRequestedRef.current = false;
        coinbaseHost.reset();
        isProviderClosingRef.current = true;
        sheetRef.current?.close();
      },
    });
    return () => {
      wallet.clearUiHandlers();
    };
  }, [wallet, openIndex, snapToSheetIndex, coinbaseHost]);

  useEffect(() => {
    if (!isSheetOpenRef.current) return;
    const animationFrame = requestAnimationFrame(() => {
      snapToSheetIndex(openIndex);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [height, memoSnapPoints, openIndex, snapToSheetIndex]);

  const walletOrigin = wallet?.getWalletOrigin();
  const webViewSource = useMemo(() => {
    if (directWalletUrl) return { uri: directWalletUrl };
    if (shellHtml) {
      return { html: shellHtml, baseUrl: walletOrigin ?? "about:blank" };
    }
    return null;
  }, [directWalletUrl, shellHtml, walletOrigin]);

  useEffect(() => {
    if (!webViewSource) return;
    attachIfReady();
    void enableAndroidWebAuthnIfNeeded();
  }, [attachIfReady, enableAndroidWebAuthnIfNeeded, webViewSource]);

  const limitsNavigationsToAppBoundDomains =
    Platform.OS === "ios" && isDirectWalletSource;

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let shouldRefreshAfterBridgeReady = false;
      try {
        const data = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          data?: {
            paymentUrl?: unknown;
            fitContent?: boolean;
            height?: number;
            maxSheetRatio?: number;
            minSheetRatio?: number;
            mode?: string;
            src?: string;
          };
        };
        if (data.type === NATIVE_COINBASE_PAYMENT_MESSAGE) {
          if (!isSurfaceRequestedRef.current) return;
          coinbaseHost.open(
            data.data?.paymentUrl,
            Platform.OS,
            Platform.Version,
          );
          return;
        }
        if (data.type === NATIVE_DEPOSIT_LIFECYCLE_MESSAGE) return;
        if (data.type === NATIVE_CONTENT_HEIGHT_MESSAGE) {
          const nextMaxSheetRatio = data.data?.maxSheetRatio;
          const nextMinSheetRatio = data.data?.minSheetRatio;
          setWebContentMaxSheetRatio(
            typeof nextMaxSheetRatio === "number" &&
              Number.isFinite(nextMaxSheetRatio) &&
              nextMaxSheetRatio > 0 &&
              nextMaxSheetRatio <= 1
              ? nextMaxSheetRatio
              : DEFAULT_FIT_CONTENT_MAX_SHEET_RATIO,
          );
          setWebContentMinSheetRatio(
            typeof nextMinSheetRatio === "number" &&
              Number.isFinite(nextMinSheetRatio) &&
              nextMinSheetRatio >= 0 &&
              nextMinSheetRatio <= 1
              ? nextMinSheetRatio
              : DEFAULT_FIT_CONTENT_MIN_SHEET_RATIO,
          );
          if (data.data?.fitContent === false) {
            setWebContentHeight(null);
            return;
          }
          const nextHeight = data.data?.height;
          if (
            typeof nextHeight === "number" &&
            Number.isFinite(nextHeight) &&
            nextHeight > 0
          ) {
            setWebContentHeight(Math.ceil(nextHeight));
          }
          return;
        }
        if (data.type === "shell:loading") {
          setWalletLoadStatus("Loading wallet iframe...");
          return;
        }
        if (data.type === "shell:iframe-load") {
          setWebViewError(null);
          setWalletLoadStatus(
            "Wallet iframe loaded. Waiting for wallet app...",
          );
          return;
        }
        if (data.type === "shell:iframe-error") {
          if (hasBridgeMessage) {
            console.warn(
              "[ThruWalletSheet] Ignoring post-ready wallet iframe error:",
              data.data,
            );
            return;
          }
          setWebViewError(
            `Wallet iframe failed to load${data.data?.src ? `: ${data.data.src}` : ""}`,
          );
          return;
        }
        if (data.type === "iframe:ready") {
          setHasBridgeMessage(true);
          setWebViewError(null);
          shouldRefreshAfterBridgeReady = true;
        }
      } catch {
        /* Let the bridge ignore malformed messages. */
      }
      wallet?.onMessage({
        nativeEvent: { data: event.nativeEvent.data },
      });
      if (shouldRefreshAfterBridgeReady) {
        void enableAndroidWebAuthnIfNeeded().finally(
          refreshWalletAvailabilityIfReady,
        );
      }
    },
    [
      coinbaseHost,
      enableAndroidWebAuthnIfNeeded,
      hasBridgeMessage,
      refreshWalletAvailabilityIfReady,
      wallet,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      expand: (index?: number) => snapToSheetIndex(index ?? openIndex),
      close: () => sheetRef.current?.close(),
    }),
    [openIndex, snapToSheetIndex],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      isSheetOpenRef.current = index !== -1;
      if (index !== -1) {
        isProviderClosingRef.current = false;
        return;
      }
      if (isProviderClosingRef.current) {
        isProviderClosingRef.current = false;
        return;
      }
      wallet?.rejectPendingRequests();
      webViewRef.current?.injectJavaScript(
        "window.dispatchEvent(new Event('thru:native-sheet-dismiss')); true;",
      );
    },
    [wallet],
  );

  const renderHandle = useCallback(
    () => (
      <View style={[styles.handleContainer, { backgroundColor }]}>
        <View
          style={[styles.handleIndicator, { backgroundColor: chrome.handle }]}
        />
      </View>
    ),
    [backgroundColor, chrome],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.38}
        pressBehavior={coinbase.active ? "none" : "close"}
      />
    ),
    [coinbase.active],
  );

  return (
    <>
      <BottomSheet
        ref={sheetRef}
        accessible={false}
        index={-1}
        snapPoints={memoSnapPoints}
        containerLayoutState={containerLayoutState}
        enableDynamicSizing={false}
        enableContentPanningGesture={false}
        handleComponent={renderHandle}
        backdropComponent={renderBackdrop}
        enablePanDownToClose={!coinbase.active}
        onChange={handleSheetChange}
        backgroundStyle={{ backgroundColor }}
      >
        <View style={[styles.body, { backgroundColor }]}>
          {webViewSource ? (
            <WebView
              ref={webViewRef}
              source={webViewSource}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              keyboardDisplayRequiresUserAction={false}
              pointerEvents={coinbase.active ? "none" : "auto"}
              accessible={coinbase.active ? false : undefined}
              accessibilityElementsHidden={coinbase.active}
              importantForAccessibility={
                coinbase.active ? "no-hide-descendants" : "auto"
              }
              webviewDebuggingEnabled={__DEV__}
              nestedScrollEnabled
              sharedCookiesEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              /* iOS WKWebView: direct wallet pages need app-bound
               navigation so WebAuthn and injected JS run in the
               WKAppBoundDomains context configured by the host app. */
              limitsNavigationsToAppBoundDomains={
                limitsNavigationsToAppBoundDomains
              }
              onLoadStart={() => {
                wallet?.recordWebViewLoadStarted();
                attachIfReady();
                void enableAndroidWebAuthnIfNeeded();
              }}
              onLoadEnd={handleLoadEnd}
              onLayout={handleWebViewLayout}
              onError={(event) => {
                const description =
                  event.nativeEvent.description ||
                  "Wallet WebView failed to load";
                wallet?.recordWebViewTransportError(
                  event.nativeEvent.code,
                  description,
                );
                if (hasBridgeMessage) {
                  console.warn(
                    "[ThruWalletSheet] Ignoring post-ready WebView error:",
                    event.nativeEvent,
                  );
                  return;
                }
                setWebViewError(description);
                console.warn("[ThruWalletSheet] WebView error:", description);
              }}
              onHttpError={(event) => {
                const status = event.nativeEvent.statusCode;
                const description = `Wallet returned HTTP ${status}`;
                wallet?.recordWebViewHttpError(status);
                if (hasBridgeMessage) {
                  console.warn(
                    "[ThruWalletSheet] Ignoring post-ready WebView HTTP error:",
                    event.nativeEvent,
                  );
                  return;
                }
                setWebViewError(description);
                console.warn(
                  "[ThruWalletSheet] WebView HTTP error:",
                  description,
                );
              }}
              onContentProcessDidTerminate={() => {
                wallet?.recordWebViewContentProcessTerminated();
                coinbaseHost.reset();
                wallet?.rejectPendingRequests(
                  "The wallet stopped unexpectedly. Try again.",
                  ErrorCode.UNKNOWN_ERROR,
                );
              }}
              onMessage={handleMessage}
              style={[styles.webview, { backgroundColor }]}
            />
          ) : null}
          {webViewSource &&
          ((!isDirectWalletSource && !hasBridgeMessage) || webViewError) ? (
            <View
              pointerEvents="none"
              style={[styles.loadingOverlay, { backgroundColor }]}
            >
              <Text style={[styles.loadingTitle, { color: chrome.title }]}>
                {webViewError ? "Wallet failed to load" : walletLoadStatus}
              </Text>
              {webViewError ? (
                <Text style={[styles.loadingDetail, { color: chrome.detail }]}>
                  {webViewError}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </BottomSheet>
      {coinbase.active ? (
        <View style={styles.applePayOverlay}>
          <View
            accessible={false}
            onStartShouldSetResponder={() => true}
            style={StyleSheet.absoluteFill}
          />
          {coinbase.payment ? (
            <ApplePayWidget
              key={coinbase.payment.id}
              paymentUrl={coinbase.payment.url}
              topInset={Math.max(insets.top, 12)}
              bottomInset={insets.bottom}
              hideApplePayButton
              onCancel={() => coinbaseHost.cancel(coinbase.payment!.id)}
              onCoinbaseMessage={(event) =>
                coinbaseHost.receive(
                  coinbase.payment!.id,
                  event.nativeEvent.url,
                  event.nativeEvent.data,
                )
              }
              onLoadError={(message, code) =>
                coinbaseHost.loadError(coinbase.payment!.id, message, code)
              }
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  applePayOverlay: { ...StyleSheet.absoluteFill, zIndex: 2147483647 },
  body: { flex: 1 },
  handleContainer: {
    alignItems: "center",
    height: SHEET_HANDLE_HEIGHT,
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  handleIndicator: {
    borderRadius: 999,
    height: 4,
    width: 42,
  },
  loadingDetail: {
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 280,
    textAlign: "center",
  },
  loadingOverlay: {
    alignItems: "center",
    bottom: 0,
    gap: 8,
    justifyContent: "center",
    left: 0,
    padding: 24,
    position: "absolute",
    right: 0,
    top: 0,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  webview: { flex: 1, backgroundColor: "transparent" },
});
