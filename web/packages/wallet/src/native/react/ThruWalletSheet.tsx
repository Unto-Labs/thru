/* Bottom-sheet host for the wallet WebView. Auto-opens on UI_SHOW (or
   any provider lifecycle that calls requestShow), auto-closes on
   request resolution / DISCONNECT / LOCK. Mirrors how the iframe's
   IframeManager.show()/hide() couples to UI_SHOW today. */

import {
  Component,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Image,
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
import { getShellHtml } from "../provider/shell";
import type { WebViewRefLike } from "../provider/WebViewBridge";
import QRCodeStyledImport from "react-native-qrcode-styled";
import { useThru } from "./hooks/useThru";
import { enableWebAuthnSupport } from "./android-webauthn";

const DEFAULT_SHEET_BACKGROUND_COLOR = "#f9fbfb";
const DEFAULT_SNAP_POINTS: (string | number)[] = ["50%", "85%"];
const DEFAULT_FIT_CONTENT_MAX_SHEET_RATIO = 0.75;
const DEFAULT_FIT_CONTENT_MIN_SHEET_RATIO = 0;
const SHEET_HANDLE_HEIGHT = 10;
const NATIVE_CONTENT_HEIGHT_MESSAGE = "wallet:content-height";
const NATIVE_SCREEN_BRIGHTNESS_MESSAGE = "wallet:screen-brightness";
const NATIVE_PAIR_DEVICE_QR_MESSAGE = "wallet:pair-device-qr";
const NATIVE_PAIR_DEVICE_QR_STATUS_MESSAGE = "wallet:pair-device-qr-status";
const NATIVE_BOTTOM_INSET_PARAM = "tn_native_bottom_inset";
const NATIVE_QR_IMPORT_UNAVAILABLE_REASON =
  "react-native-qrcode-styled component unavailable";
const NATIVE_QR_DARK_COLOR = "#151b1e";
const NATIVE_QR_ACCENT_COLOR = "#239f97";
const NATIVE_QR_ACCENT_DARK_COLOR = "#0a766f";
const NATIVE_QR_GRADIENT = {
  type: "linear" as const,
  options: {
    colors: [
      NATIVE_QR_DARK_COLOR,
      NATIVE_QR_ACCENT_DARK_COLOR,
      NATIVE_QR_ACCENT_COLOR,
    ],
    start: [0, 0] as [number, number],
    end: [1, 1] as [number, number],
    locations: [0, 0.55, 1],
  },
};
const NATIVE_QR_OUTER_EYE_OPTIONS = {
  borderRadius: "34%",
  color: NATIVE_QR_DARK_COLOR,
};
const NATIVE_QR_INNER_EYE_OPTIONS = {
  borderRadius: "50%",
  color: NATIVE_QR_ACCENT_COLOR,
  scale: 0.86,
};
const NATIVE_QR_WARMUP_DATA = "thru:qr-warmup";

type BrightnessModule = typeof import("expo-brightness");
type PreviousScreenBrightnessState = {
  brightness: number;
  didSetSystemBrightness: boolean;
  systemBrightness: number | null;
  systemBrightnessMode: Awaited<
    ReturnType<BrightnessModule["getSystemBrightnessModeAsync"]>
  > | null;
  wasUsingSystemBrightness: boolean | null;
};
type PairDeviceQrFrame = {
  top: number;
  left: number;
  width: number;
  height: number;
};
type PairDeviceQrState = {
  approveUrl: string;
  frame: PairDeviceQrFrame;
  qrDataUrl?: string;
};
type PairDeviceQrRenderStatus = "rendering" | "ready" | "unavailable";
type QRCodeStyledComponent = ComponentType<{
  data: string;
  size: number;
  padding?: number;
  color?: string;
  gradient?: object;
  pieceScale?: number;
  pieceCornerType?: "rounded" | "cut";
  pieceBorderRadius?: number | `${number}%`;
  pieceLiquidRadius?: number | `${number}%`;
  isPiecesGlued?: boolean;
  outerEyesOptions?: object;
  innerEyesOptions?: object;
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  style?: object;
}>;

let brightnessModulePromise: Promise<BrightnessModule | null> | null = null;

function getBrightnessModule(): Promise<BrightnessModule | null> {
  brightnessModulePromise ??= import("expo-brightness").catch((error) => {
    console.warn(
      "[ThruWalletSheet] expo-brightness is unavailable in this native build:",
      error,
    );
    return null;
  });
  return brightnessModulePromise;
}

async function getPreviousScreenBrightnessState(
  brightness: BrightnessModule,
): Promise<PreviousScreenBrightnessState> {
  const previousState: PreviousScreenBrightnessState = {
    brightness: await brightness.getBrightnessAsync(),
    didSetSystemBrightness: false,
    systemBrightness: null,
    systemBrightnessMode: null,
    wasUsingSystemBrightness: null,
  };

  if (Platform.OS !== "android") return previousState;

  const [systemBrightness, systemBrightnessMode, wasUsingSystemBrightness] =
    await Promise.all([
      brightness.getSystemBrightnessAsync().catch(() => null),
      brightness.getSystemBrightnessModeAsync().catch(() => null),
      brightness.isUsingSystemBrightnessAsync().catch(() => null),
    ]);
  previousState.systemBrightness = systemBrightness;
  previousState.systemBrightnessMode = systemBrightnessMode;
  previousState.wasUsingSystemBrightness = wasUsingSystemBrightness;

  return previousState;
}

function isReactComponentLike(input: unknown): input is ComponentType<unknown> {
  if (typeof input === "function") return true;
  if (typeof input !== "object" || input === null) return false;

  const reactType = (input as { $$typeof?: unknown }).$$typeof;
  return (
    reactType === Symbol.for("react.forward_ref") ||
    reactType === Symbol.for("react.memo") ||
    reactType === Symbol.for("react.lazy")
  );
}

function resolveQRCodeComponent(
  module: unknown,
  namedExport: string,
): ComponentType<unknown> | null {
  const seen = new Set<unknown>();
  const candidates = [module];

  for (let idx = 0; idx < candidates.length; idx++) {
    const candidate = candidates[idx];
    if (isReactComponentLike(candidate)) return candidate;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      seen.has(candidate)
    ) {
      continue;
    }

    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    candidates.push(record[namedExport], record.default);
  }

  return null;
}

const RESOLVED_QR_CODE_STYLED = resolveQRCodeComponent(
  QRCodeStyledImport,
  "QRCodeStyled",
) as QRCodeStyledComponent | null;

function parsePairDeviceQrFrame(input: unknown): PairDeviceQrFrame | null {
  if (!input || typeof input !== "object") return null;
  const frame = input as Partial<PairDeviceQrFrame>;
  const { top, left, width, height } = frame;
  if (
    typeof top !== "number" ||
    typeof left !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(left) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { top, left, width, height };
}

function getPairDeviceQrStatusScript(
  status: PairDeviceQrRenderStatus,
  approveUrl: string,
  reason?: string,
): string {
  const message = JSON.stringify({
    type: NATIVE_PAIR_DEVICE_QR_STATUS_MESSAGE,
    data: { status, approveUrl, reason },
  });

  return `
    (function () {
      var message = ${JSON.stringify(message)};
      try {
        var parsed = JSON.parse(message);
        if (typeof window.__pushIn === 'function') {
          window.__pushIn(parsed);
        } else {
          window.dispatchEvent(new MessageEvent('message', {
            data: parsed,
            origin: window.location.origin
          }));
        }
      } catch (error) {}
    })();
    true;
  `;
}

class OptionalNativeQrBoundary extends Component<
  {
    children: ReactNode;
    onError: (error: unknown) => void;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function appendNativeBottomInset(
  urlValue: string,
  bottomInset: number,
): string {
  try {
    const url = new URL(urlValue);
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
  /** Optional override for the bottom sheet background colour. */
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
  {
    snapPoints,
    initialOpenIndex,
    backgroundColor = DEFAULT_SHEET_BACKGROUND_COLOR,
  },
  ref,
) {
  const { wallet } = useThru();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetType>(null);
  const webViewRef = useRef<WebViewType | null>(null);
  const webViewNativeTagRef = useRef<number | null>(null);
  const brightnessQueueRef = useRef<Promise<void>>(Promise.resolve());
  const previousScreenBrightnessRef =
    useRef<PreviousScreenBrightnessState | null>(null);
  const didRefreshWalletAvailabilityRef = useRef(false);
  const isProviderClosingRef = useRef(false);
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
  const [pairDeviceQr, setPairDeviceQr] = useState<PairDeviceQrState | null>(
    null,
  );
  const [QRCodeStyled, setQRCodeStyled] =
    useState<QRCodeStyledComponent | null>(() => RESOLVED_QR_CODE_STYLED);
  const [isNativeQrUnavailable, setIsNativeQrUnavailable] = useState(
    () => RESOLVED_QR_CODE_STYLED === null,
  );
  const [nativeQrUnavailableReason, setNativeQrUnavailableReason] = useState<
    string | null
  >(() =>
    RESOLVED_QR_CODE_STYLED ? null : NATIVE_QR_IMPORT_UNAVAILABLE_REASON,
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

  const enqueueBrightnessTask = useCallback((task: () => Promise<void>) => {
    const queuedTask = brightnessQueueRef.current.then(task, task);
    brightnessQueueRef.current = queuedTask.catch(() => {});
  }, []);

  const restoreScreenBrightness = useCallback(() => {
    enqueueBrightnessTask(async () => {
      const previousState = previousScreenBrightnessRef.current;
      previousScreenBrightnessRef.current = null;
      if (!previousState) return;

      try {
        const brightness = await getBrightnessModule();
        if (!brightness) return;
        if (Platform.OS === "android") {
          if (
            previousState.didSetSystemBrightness &&
            previousState.systemBrightness !== null
          ) {
            try {
              await brightness.setSystemBrightnessAsync(
                previousState.systemBrightness,
              );
              if (previousState.systemBrightnessMode !== null) {
                await brightness.setSystemBrightnessModeAsync(
                  previousState.systemBrightnessMode,
                );
              }
            } catch {
              /* Fall back to restoring the current activity brightness. */
            }
          }
          if (previousState.wasUsingSystemBrightness) {
            try {
              await brightness.restoreSystemBrightnessAsync();
              return;
            } catch {
              /* Fall back to restoring the saved activity brightness. */
            }
          }
        }
        await brightness.setBrightnessAsync(previousState.brightness);
      } catch (error) {
        console.warn(
          "[ThruWalletSheet] Failed to restore screen brightness:",
          error,
        );
      }
    });
  }, [enqueueBrightnessTask]);

  const maximizeScreenBrightness = useCallback(() => {
    enqueueBrightnessTask(async () => {
      try {
        const brightness = await getBrightnessModule();
        if (!brightness) return;
        if (previousScreenBrightnessRef.current == null) {
          previousScreenBrightnessRef.current =
            await getPreviousScreenBrightnessState(brightness);
        }
        await brightness.setBrightnessAsync(1);
        if (Platform.OS === "android") {
          try {
            await brightness.setSystemBrightnessAsync(1);
            if (previousScreenBrightnessRef.current) {
              previousScreenBrightnessRef.current.didSetSystemBrightness = true;
            }
          } catch {
            /* Activity brightness above still maximizes the visible app. */
          }
        }
      } catch (error) {
        console.warn(
          "[ThruWalletSheet] Failed to maximize screen brightness:",
          error,
        );
      }
    });
  }, [enqueueBrightnessTask]);

  const sendPairDeviceQrStatus = useCallback(
    (
      status: PairDeviceQrRenderStatus,
      approveUrl: string,
      reason?: string | null,
    ) => {
      webViewRef.current?.injectJavaScript(
        getPairDeviceQrStatusScript(status, approveUrl, reason ?? undefined),
      );
    },
    [],
  );

  const handleNativeQrError = useCallback(
    (error: unknown) => {
      console.warn("[ThruWalletSheet] Failed to render native QR:", error);
      const reason =
        error instanceof Error
          ? `react-native-qrcode-styled render failed: ${error.message}`
          : "react-native-qrcode-styled render failed";
      if (pairDeviceQr) {
        sendPairDeviceQrStatus("unavailable", pairDeviceQr.approveUrl, reason);
      }
      setNativeQrUnavailableReason(reason);
      setIsNativeQrUnavailable(true);
      setPairDeviceQr(null);
    },
    [pairDeviceQr, sendPairDeviceQrStatus],
  );

  useEffect(() => {
    containerLayoutState.value = {
      height,
      offset: { top: 0, bottom: 0, left: 0, right: 0 },
    };
  }, [containerLayoutState, height]);

  useEffect(() => {
    return () => {
      restoreScreenBrightness();
    };
  }, [restoreScreenBrightness]);

  /* Build the wallet source once the SDK is available. Android and iOS
     default to the shell iframe so the native SDK reuses the same wallet
     postMessage protocol as web iframe consumers. */
  useEffect(() => {
    if (!wallet) return;
    const walletUrl = appendNativeBottomInset(
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
    setPairDeviceQr(null);
    setQRCodeStyled(() => RESOLVED_QR_CODE_STYLED);
    setNativeQrUnavailableReason(
      RESOLVED_QR_CODE_STYLED ? null : NATIVE_QR_IMPORT_UNAVAILABLE_REASON,
    );
    setIsNativeQrUnavailable(RESOLVED_QR_CODE_STYLED === null);
    didRefreshWalletAvailabilityRef.current = false;
  }, [insets.bottom, wallet]);

  useEffect(() => {
    if (!pairDeviceQr) return;
    if (pairDeviceQr.qrDataUrl || (QRCodeStyled && !isNativeQrUnavailable)) {
      sendPairDeviceQrStatus("ready", pairDeviceQr.approveUrl);
    } else if (isNativeQrUnavailable) {
      sendPairDeviceQrStatus(
        "unavailable",
        pairDeviceQr.approveUrl,
        nativeQrUnavailableReason,
      );
    }
  }, [
    QRCodeStyled,
    isNativeQrUnavailable,
    nativeQrUnavailableReason,
    pairDeviceQr,
    sendPairDeviceQrStatus,
  ]);

  const isDirectWalletSource = directWalletUrl !== null;

  /* Hand the WebView ref to the SDK once both exist. We expose only
     the shape NativeProvider needs (injectJavaScript). Also flip the
     Android WebView's WebAuthn support on, since react-native-webview
     doesn't do it for us. iOS is a no-op (WKWebView WebAuthn is
     governed by WKAppBoundDomains, set by our Expo config plugin). */
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
    void wallet.refreshWalletAvailability();
  }, [wallet]);

  const handleLoadEnd = useCallback(() => {
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

  /* Wire show/hide callbacks through the SDK's provider so UI_SHOW from
     the wallet expands the sheet and request resolution closes it. */
  useEffect(() => {
    if (!wallet) return;
    wallet.setUiHandlers({
      onShowRequested: () => {
        isProviderClosingRef.current = false;
        snapToSheetIndex(openIndex);
      },
      onHideRequested: () => {
        isProviderClosingRef.current = true;
        sheetRef.current?.close();
      },
    });
    return () => {
      wallet.clearUiHandlers();
    };
  }, [wallet, openIndex, snapToSheetIndex]);

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
            approveUrl?: string;
            fitContent?: boolean;
            frame?: unknown;
            height?: number;
            maxSheetRatio?: number;
            minSheetRatio?: number;
            mode?: string;
            qrDataUrl?: string;
            src?: string;
            visible?: boolean;
          };
        };
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
        if (data.type === NATIVE_PAIR_DEVICE_QR_MESSAGE) {
          if (data.data?.visible === false) {
            setPairDeviceQr(null);
            return;
          }
          const approveUrl = data.data?.approveUrl;
          const frame = parsePairDeviceQrFrame(data.data?.frame);
          if (typeof approveUrl === "string" && approveUrl && frame) {
            const qrDataUrl =
              typeof data.data?.qrDataUrl === "string" &&
              data.data.qrDataUrl.startsWith("data:image/")
                ? data.data.qrDataUrl
                : undefined;
            if (isNativeQrUnavailable) {
              sendPairDeviceQrStatus(
                "unavailable",
                approveUrl,
                nativeQrUnavailableReason,
              );
              return;
            }
            setPairDeviceQr({ approveUrl, frame, qrDataUrl });
            sendPairDeviceQrStatus("rendering", approveUrl);
          }
          return;
        }
        if (data.type === NATIVE_SCREEN_BRIGHTNESS_MESSAGE) {
          if (data.data?.mode === "max") {
            maximizeScreenBrightness();
          } else if (data.data?.mode === "restore") {
            restoreScreenBrightness();
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
      enableAndroidWebAuthnIfNeeded,
      hasBridgeMessage,
      isNativeQrUnavailable,
      nativeQrUnavailableReason,
      maximizeScreenBrightness,
      refreshWalletAvailabilityIfReady,
      restoreScreenBrightness,
      sendPairDeviceQrStatus,
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
      if (index !== -1) return;
      restoreScreenBrightness();
      setPairDeviceQr(null);
      if (isProviderClosingRef.current) {
        isProviderClosingRef.current = false;
        return;
      }
      wallet?.rejectPendingRequests();
      webViewRef.current?.injectJavaScript(
        "window.dispatchEvent(new Event('thru:native-sheet-dismiss')); true;",
      );
    },
    [restoreScreenBrightness, wallet],
  );

  const pairDeviceQrSize = pairDeviceQr
    ? Math.max(
        96,
        Math.floor(
          Math.min(pairDeviceQr.frame.width, pairDeviceQr.frame.height) - 32,
        ),
      )
    : 0;
  const pairDeviceQrBadgeFontSize = Math.max(16, pairDeviceQrSize * 0.1);
  const renderHandle = useCallback(
    () => (
      <View style={[styles.handleContainer, { backgroundColor }]}>
        <View style={styles.handleIndicator} />
      </View>
    ),
    [backgroundColor],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.38}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={memoSnapPoints}
      containerLayoutState={containerLayoutState}
      enableDynamicSizing={false}
      enableContentPanningGesture={false}
      handleComponent={renderHandle}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      onChange={handleSheetChange}
      backgroundStyle={{ backgroundColor }}
    >
      <View style={[styles.body, { backgroundColor }]}>
        {QRCodeStyled ? (
          <View
            collapsable={false}
            pointerEvents="none"
            style={styles.nativeQrWarmup}
          >
            <QRCodeStyled
              data={NATIVE_QR_WARMUP_DATA}
              size={64}
              color={NATIVE_QR_DARK_COLOR}
              errorCorrectionLevel="L"
              padding={0}
              pieceScale={1.025}
            />
          </View>
        ) : null}
        {webViewSource ? (
          <WebView
            ref={webViewRef}
            source={webViewSource}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
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
              attachIfReady();
              void enableAndroidWebAuthnIfNeeded();
            }}
            onLoadEnd={handleLoadEnd}
            onLayout={handleWebViewLayout}
            onError={(event) => {
              const description =
                event.nativeEvent.description ||
                "Wallet WebView failed to load";
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
            <Text style={styles.loadingTitle}>
              {webViewError ? "Wallet failed to load" : walletLoadStatus}
            </Text>
            {webViewError ? (
              <Text style={styles.loadingDetail}>{webViewError}</Text>
            ) : null}
          </View>
        ) : null}
        {pairDeviceQr && (pairDeviceQr.qrDataUrl || QRCodeStyled) ? (
          <View
            pointerEvents="none"
            style={[
              styles.nativeQrOverlay,
              {
                height: pairDeviceQr.frame.height,
                left: pairDeviceQr.frame.left,
                top: pairDeviceQr.frame.top,
                width: pairDeviceQr.frame.width,
              },
            ]}
          >
            <OptionalNativeQrBoundary
              key={pairDeviceQr.approveUrl}
              onError={handleNativeQrError}
            >
              <View style={styles.nativeQrCard}>
                {pairDeviceQr.qrDataUrl ? (
                  <Image
                    resizeMode="contain"
                    source={{ uri: pairDeviceQr.qrDataUrl }}
                    style={[
                      styles.nativeQrImage,
                      {
                        height: pairDeviceQrSize,
                        width: pairDeviceQrSize,
                      },
                    ]}
                  />
                ) : QRCodeStyled ? (
                  <View
                    style={[
                      styles.nativeQrStyledFallback,
                      {
                        height: pairDeviceQrSize,
                        width: pairDeviceQrSize,
                      },
                    ]}
                  >
                    <QRCodeStyled
                      data={pairDeviceQr.approveUrl}
                      size={pairDeviceQrSize}
                      color={NATIVE_QR_DARK_COLOR}
                      gradient={NATIVE_QR_GRADIENT}
                      errorCorrectionLevel="H"
                      innerEyesOptions={NATIVE_QR_INNER_EYE_OPTIONS}
                      isPiecesGlued
                      outerEyesOptions={NATIVE_QR_OUTER_EYE_OPTIONS}
                      padding={0}
                      pieceBorderRadius="42%"
                      pieceCornerType="rounded"
                      pieceLiquidRadius="30%"
                      pieceScale={1.02}
                      style={styles.nativeQrSvg}
                    />
                    <View style={styles.nativeQrFallbackBadge}>
                      <Text
                        style={[
                          styles.nativeQrFallbackBadgeText,
                          {
                            fontSize: pairDeviceQrBadgeFontSize,
                            lineHeight: pairDeviceQrBadgeFontSize * 1.05,
                          },
                        ]}
                      >
                        J
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </OptionalNativeQrBoundary>
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  body: { flex: 1 },
  handleContainer: {
    alignItems: "center",
    height: SHEET_HANDLE_HEIGHT,
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  handleIndicator: {
    backgroundColor: "#cdd5db",
    borderRadius: 999,
    height: 4,
    width: 42,
  },
  loadingDetail: {
    color: "#4b635f",
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
    color: "#172b29",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  nativeQrCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#dbe4e8",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: "center",
  },
  nativeQrOverlay: {
    elevation: 16,
    position: "absolute",
    zIndex: 16,
  },
  nativeQrImage: {
    backgroundColor: "#ffffff",
  },
  nativeQrFallbackBadge: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#ffffff",
    borderColor: "#d1e1e1",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    left: "41.5%",
    position: "absolute",
    top: "41.5%",
    width: "17%",
  },
  nativeQrFallbackBadgeText: {
    color: NATIVE_QR_ACCENT_DARK_COLOR,
    fontWeight: "700",
    includeFontPadding: false,
    textAlign: "center",
  },
  nativeQrStyledFallback: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    justifyContent: "center",
  },
  nativeQrSvg: {
    backgroundColor: "#ffffff",
  },
  nativeQrWarmup: {
    height: 64,
    left: -128,
    opacity: 0,
    position: "absolute",
    top: -128,
    width: 64,
    zIndex: -1,
  },
  webview: { flex: 1, backgroundColor: "transparent" },
});
