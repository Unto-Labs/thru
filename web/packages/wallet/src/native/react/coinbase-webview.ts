export const COINBASE_ONRAMP_EVENT_NAMES = [
  "onramp_api.load_pending",
  "onramp_api.load_success",
  "onramp_api.load_error",
  "onramp_api.commit_success",
  "onramp_api.commit_error",
  "onramp_api.cancel",
  "onramp_api.polling_start",
  "onramp_api.polling_success",
  "onramp_api.polling_error",
] as const;

const COINBASE_ONRAMP_EVENT_NAME_SET = new Set<string>(
  COINBASE_ONRAMP_EVENT_NAMES,
);

const COINBASE_TERMINAL_EVENT_NAMES = new Set<string>([
  "onramp_api.load_error",
  "onramp_api.commit_error",
  "onramp_api.cancel",
  "onramp_api.polling_success",
  "onramp_api.polling_error",
]);

export const COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE =
  "thru:coinbase-apple-pay-auto-click";

const COINBASE_APPLE_PAY_BUTTON_STYLE_ID =
  "thru-coinbase-apple-pay-button-visibility";

export function buildCoinbaseApplePayButtonVisibilityScript(
  hidden: boolean,
): string {
  if (!hidden) {
    return `
(function() {
  var style = document.getElementById('${COINBASE_APPLE_PAY_BUTTON_STYLE_ID}');
  if (style) style.remove();
})();
true;
`;
  }
  return `
(function() {
  var styleId = '${COINBASE_APPLE_PAY_BUTTON_STYLE_ID}';
  var style = document.getElementById(styleId);
  if (!style && document.head) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  if (style) {
    style.textContent = 'apple-pay-button { display: none !important; }';
  }
})();
true;
`;
}

/* Upper bound on how long the injected script waits for Coinbase's Apple Pay
   control to mount before giving up, so the host always gets a terminal
   status. */
export const COINBASE_APPLE_PAY_BUTTON_WAIT_TIMEOUT_MS = 15_000;

/* Upper bound on how long the host waits for Coinbase to report any lifecycle
   progress before treating the payment as unreachable. It covers the cases the
   injected script cannot: a page that never emits `onramp_api.load_success`,
   so the script is never injected at all. */
export const COINBASE_PAYMENT_SIGNAL_TIMEOUT_MS = 20_000;

/* Upper bound on how long a presented Apple Pay sheet may go without a
   terminal event before Coinbase's own controls are revealed. Revealing rather
   than cancelling keeps a slow authentication intact while still giving the
   user a way out of an otherwise invisible surface. */
export const COINBASE_PAYMENT_STALL_ESCAPE_TIMEOUT_MS = 90_000;

export type CoinbasePaymentProgress =
  | "pending"
  | "presented"
  | "committed"
  | "settled";

/* A committed payment has already been charged, so the host can no longer
   cancel it: `closeCoinbasePayment` ignores the request. */
export function canCancelCoinbasePayment(
  progress: CoinbasePaymentProgress,
): boolean {
  return progress !== "committed";
}

export interface CoinbasePaymentEscape {
  /** `reveal` surfaces Coinbase's own controls; `cancel` abandons the payment. */
  action: "cancel" | "reveal";
  delayMs: number;
}

/* Describes how a silent payment surface releases the user, given how far the
   flow has progressed and whether a visible escape is already on screen. */
export function coinbasePaymentEscape(
  progress: CoinbasePaymentProgress,
  fallbackVisible: boolean,
): CoinbasePaymentEscape | null {
  if (progress === "settled" || fallbackVisible) return null;
  if (progress === "presented" || progress === "committed") {
    return {
      action: "reveal",
      delayMs: COINBASE_PAYMENT_STALL_ESCAPE_TIMEOUT_MS,
    };
  }
  return { action: "cancel", delayMs: COINBASE_PAYMENT_SIGNAL_TIMEOUT_MS };
}

export const COINBASE_APPLE_PAY_CLICK_SCRIPT = `
(function() {
  if (window.__thruApplePayAutoClickStarted) return true;
  window.__thruApplePayAutoClickStarted = true;
  window.__thruApplePaySheetPresented = false;

  function notify(status) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: '${COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE}',
      status: status
    }));
  }

  function instrumentApplePayPresentation() {
    var ApplePaySessionConstructor = window.ApplePaySession;
    var prototype = ApplePaySessionConstructor && ApplePaySessionConstructor.prototype;
    var originalBegin = prototype && prototype.begin;
    if (!prototype || typeof originalBegin !== 'function') return false;

    function thruApplePayBegin() {
      var result = originalBegin.apply(this, arguments);
      if (!window.__thruApplePaySheetPresented) {
        window.__thruApplePaySheetPresented = true;
        notify('sheet-presented');
      }
      return result;
    }

    try {
      prototype.begin = thruApplePayBegin;
      return prototype.begin === thruApplePayBegin;
    } catch (_) {
      return false;
    }
  }

  function clickApplePay(button) {
    try {
      button.click();
    } catch (_) {
      notify('presentation-not-started');
      return;
    }
    if (!window.__thruApplePaySheetPresented) {
      notify('presentation-not-started');
    }
  }

  if (!instrumentApplePayPresentation()) {
    notify('instrumentation-unavailable');
    return true;
  }

  var observer = null;
  var watchdog = null;

  function stopWaiting() {
    if (observer) observer.disconnect();
    if (watchdog !== null && typeof window.clearTimeout === 'function') {
      window.clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function clickWhenReady() {
    var button = document.getElementById('api-onramp-apple-pay-button');
    if (!button) return false;
    stopWaiting();
    clickApplePay(button);
    return true;
  }

  if (clickWhenReady()) return true;

  var Observer = window.MutationObserver || window.WebKitMutationObserver;
  var root = document.documentElement || document.body;
  if (!Observer || !root) {
    notify('button-not-found');
    return true;
  }

  try {
    observer = new Observer(function() {
      clickWhenReady();
    });
    observer.observe(root, { childList: true, subtree: true });
    /* The wait for the button is bounded so a control that never renders
       cannot leave the host stuck behind its invisible payment overlay. The
       watchdog is cleared before the click, so it can never interrupt a
       presented sheet while the user authenticates. */
    if (typeof window.setTimeout === 'function') {
      watchdog = window.setTimeout(function() {
        watchdog = null;
        if (observer) observer.disconnect();
        if (!window.__thruApplePaySheetPresented) notify('button-not-found');
      }, ${COINBASE_APPLE_PAY_BUTTON_WAIT_TIMEOUT_MS});
    }
    // Close the lookup/observe race.
    clickWhenReady();
  } catch (_) {
    stopWaiting();
    notify('button-not-found');
  }
})();
true;
`;

export interface CoinbaseApplePayAutoClickMessage {
  type: typeof COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE;
  status:
    | "sheet-presented"
    | "presentation-not-started"
    | "button-not-found"
    | "instrumentation-unavailable";
}

const COINBASE_APPLE_PAY_AUTO_CLICK_STATUSES = new Set<
  CoinbaseApplePayAutoClickMessage["status"]
>([
  "sheet-presented",
  "presentation-not-started",
  "button-not-found",
  "instrumentation-unavailable",
]);

export interface CoinbaseWebViewEvent {
  eventName: string;
  data: Record<string, unknown>;
}

export function isTrustedCoinbasePaymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "coinbase.com" || hostname.endsWith(".coinbase.com"))
    );
  } catch {
    return false;
  }
}

export function isCoinbaseApplePaySandboxUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      isTrustedCoinbasePaymentUrl(value) &&
      url.searchParams.get("useApplePaySandbox") === "true"
    );
  } catch {
    return false;
  }
}

export function parseCoinbaseApplePayAutoClickMessage(
  rawData: string,
): CoinbaseApplePayAutoClickMessage | null {
  if (rawData.length > 16_384) return null;
  try {
    const value = JSON.parse(
      rawData,
    ) as Partial<CoinbaseApplePayAutoClickMessage>;
    if (
      value.type !== COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE ||
      !value.status ||
      !COINBASE_APPLE_PAY_AUTO_CLICK_STATUSES.has(value.status)
    ) {
      return null;
    }
    return value as CoinbaseApplePayAutoClickMessage;
  } catch {
    return null;
  }
}

export function parseCoinbaseWebViewEvent(
  rawData: string,
): CoinbaseWebViewEvent | null {
  if (rawData.length > 16_384) return null;
  try {
    const value = JSON.parse(rawData) as {
      eventName?: unknown;
      data?: unknown;
    };
    if (
      typeof value.eventName !== "string" ||
      !COINBASE_ONRAMP_EVENT_NAME_SET.has(value.eventName)
    ) {
      return null;
    }
    const data =
      value.data && typeof value.data === "object" && !Array.isArray(value.data)
        ? (value.data as Record<string, unknown>)
        : {};
    return { eventName: value.eventName, data };
  } catch {
    return null;
  }
}

export function parseCoinbaseEventName(rawData: string): string | null {
  return parseCoinbaseWebViewEvent(rawData)?.eventName ?? null;
}

export function shouldCloseCoinbasePayment(eventName: string): boolean {
  return COINBASE_TERMINAL_EVENT_NAMES.has(eventName);
}

export function supportsCoinbaseApplePay(
  platformOS: string,
  platformVersion: string | number,
): boolean {
  if (platformOS !== "ios") return true;
  const majorVersion = Number.parseInt(String(platformVersion), 10);
  return Number.isFinite(majorVersion) && majorVersion >= 16;
}
