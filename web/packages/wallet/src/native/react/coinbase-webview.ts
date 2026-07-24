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

export function parseCoinbaseEventName(rawData: string): string | null {
  try {
    const value = JSON.parse(rawData) as { eventName?: unknown };
    return typeof value.eventName === "string" &&
      COINBASE_ONRAMP_EVENT_NAME_SET.has(value.eventName)
      ? value.eventName
      : null;
  } catch {
    return null;
  }
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
