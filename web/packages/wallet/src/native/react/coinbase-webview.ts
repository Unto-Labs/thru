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

export const COINBASE_APPLE_PAY_CLICK_SCRIPT = `
(function() {
  if (window.__thruApplePayAutoClickStarted) return true;
  window.__thruApplePayAutoClickStarted = true;

  function notify(status) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: '${COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE}',
      status: status
    }));
  }

  function tryClick(attempt) {
    var button = document.getElementById('api-onramp-apple-pay-button');
    if (button) {
      button.click();
      notify('clicked');
      return;
    }
    if (attempt < 10) {
      setTimeout(function() { tryClick(attempt + 1); }, 500);
      return;
    }
    notify('button-not-found');
  }

  tryClick(1);
})();
true;
`;

export interface CoinbaseApplePayAutoClickMessage {
  type: typeof COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE;
  status: "clicked" | "button-not-found";
}

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
      (value.status !== "clicked" && value.status !== "button-not-found")
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
