import { describe, expect, it } from "vitest";
import {
  COINBASE_ONRAMP_EVENT_NAMES,
  isTrustedCoinbasePaymentUrl,
  parseCoinbaseEventName,
  shouldCloseCoinbasePayment,
  supportsCoinbaseApplePay,
} from "./coinbase-webview";

const LIFECYCLE_EVENTS = [
  ["onramp_api.load_pending", false],
  ["onramp_api.load_success", false],
  ["onramp_api.load_error", true],
  ["onramp_api.commit_success", false],
  ["onramp_api.commit_error", true],
  ["onramp_api.cancel", true],
  ["onramp_api.polling_start", false],
  ["onramp_api.polling_success", true],
  ["onramp_api.polling_error", true],
] as const;

describe("Coinbase payment WebView", () => {
  it.each(LIFECYCLE_EVENTS)(
    "accepts %s and applies its terminal behavior",
    (eventName, shouldClose) => {
      const rawData = JSON.stringify({ eventName, data: {} });

      expect(parseCoinbaseEventName(rawData)).toBe(eventName);
      expect(shouldCloseCoinbasePayment(eventName)).toBe(shouldClose);
    },
  );

  it("keeps the lifecycle allowlist in sync with the transition cases", () => {
    expect(COINBASE_ONRAMP_EVENT_NAMES).toEqual(
      LIFECYCLE_EVENTS.map(([eventName]) => eventName),
    );
  });

  it.each([
    "not-json",
    "null",
    "{}",
    JSON.stringify({ eventName: 42 }),
    JSON.stringify({ eventName: "onramp_api.unknown" }),
  ])("rejects malformed or unknown lifecycle data: %s", (rawData) => {
    expect(parseCoinbaseEventName(rawData)).toBeNull();
  });

  it.each([
    "https://coinbase.com/pay",
    "https://pay.coinbase.com/v2/api-onramp/apple-pay",
    "https://nested.pay.coinbase.com/path",
  ])("accepts a trusted Coinbase payment URL: %s", (url) => {
    expect(isTrustedCoinbasePaymentUrl(url)).toBe(true);
  });

  it.each([
    "http://pay.coinbase.com/path",
    "https://coinbase.com.evil.example/path",
    "https://evilcoinbase.com/path",
    "https://example.com/path",
    "not-a-url",
  ])("rejects an untrusted payment URL: %s", (url) => {
    expect(isTrustedCoinbasePaymentUrl(url)).toBe(false);
  });

  it("requires iOS 16 or newer while leaving other platforms unchanged", () => {
    expect(supportsCoinbaseApplePay("ios", "15.7.9")).toBe(false);
    expect(supportsCoinbaseApplePay("ios", "16.0")).toBe(true);
    expect(supportsCoinbaseApplePay("ios", "26.5.2")).toBe(true);
    expect(supportsCoinbaseApplePay("ios", "unknown")).toBe(false);
    expect(supportsCoinbaseApplePay("android", 28)).toBe(true);
  });
});
