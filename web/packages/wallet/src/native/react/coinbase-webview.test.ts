import { describe, expect, it } from "vitest";
import {
  COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
  COINBASE_APPLE_PAY_CLICK_SCRIPT,
  COINBASE_ONRAMP_EVENT_NAMES,
  buildCoinbaseApplePayButtonVisibilityScript,
  isCoinbaseApplePaySandboxUrl,
  isTrustedCoinbasePaymentUrl,
  parseCoinbaseApplePayAutoClickMessage,
  parseCoinbaseEventName,
  parseCoinbaseWebViewEvent,
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
    "https://coinbase.com@evil.example/path",
    "not-a-url",
  ])("rejects an untrusted payment URL: %s", (url) => {
    expect(isTrustedCoinbasePaymentUrl(url)).toBe(false);
  });

  it("detects only Coinbase sandbox payment URLs", () => {
    expect(
      isCoinbaseApplePaySandboxUrl(
        "https://pay.coinbase.com/apple-pay?useApplePaySandbox=true",
      ),
    ).toBe(true);
    expect(
      isCoinbaseApplePaySandboxUrl(
        "https://pay.coinbase.com/apple-pay?useApplePaySandbox=false",
      ),
    ).toBe(false);
    expect(
      isCoinbaseApplePaySandboxUrl(
        "https://coinbase.com.evil.example/apple-pay?useApplePaySandbox=true",
      ),
    ).toBe(false);
  });

  it.each(["clicked", "button-not-found"] as const)(
    "accepts the %s private auto-click control message",
    (status) => {
      expect(
        parseCoinbaseApplePayAutoClickMessage(
          JSON.stringify({
            type: COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
            status,
          }),
        ),
      ).toEqual({
        type: COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
        status,
      });
    },
  );

  it.each([
    "not-json",
    JSON.stringify({
      type: COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
      status: "unknown",
    }),
    JSON.stringify({ type: "onramp_api.load_success", status: "clicked" }),
    "x".repeat(16_385),
  ])("rejects an invalid auto-click control message", (rawData) => {
    expect(parseCoinbaseApplePayAutoClickMessage(rawData)).toBeNull();
  });

  it("rejects oversized Coinbase lifecycle messages", () => {
    expect(
      parseCoinbaseEventName(
        JSON.stringify({
          eventName: "onramp_api.load_success",
          data: { padding: "x".repeat(16_385) },
        }),
      ),
    ).toBeNull();
  });

  it("preserves bounded Coinbase lifecycle payload fields", () => {
    expect(
      parseCoinbaseWebViewEvent(
        JSON.stringify({
          eventName: "onramp_api.polling_success",
          data: {
            txHash: "0x1234",
            purchaseAmount: "20",
            fiatAmount: "20.00",
            currency: { fiat: "USD", crypto: "USDC" },
          },
        }),
      ),
    ).toEqual({
      eventName: "onramp_api.polling_success",
      data: {
        txHash: "0x1234",
        purchaseAmount: "20",
        fiatAmount: "20.00",
        currency: { fiat: "USD", crypto: "USDC" },
      },
    });
  });

  it("builds a bounded auto-click script without forcing Coinbase features", () => {
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).toContain(
      "api-onramp-apple-pay-button",
    );
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).toContain("attempt < 10");
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).toContain("button.click()");
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).not.toContain("forceFeature");
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).not.toContain("display: none");
  });

  it("toggles the rendered Apple Pay button without removing the fallback", () => {
    const hideScript = buildCoinbaseApplePayButtonVisibilityScript(true);
    const showScript = buildCoinbaseApplePayButtonVisibilityScript(false);

    expect(hideScript).toContain(
      "apple-pay-button { display: none !important; }",
    );
    expect(showScript).toContain("style.remove()");
    expect(showScript).not.toContain("display: none");
  });

  it("requires iOS 16 or newer while leaving other platforms unchanged", () => {
    expect(supportsCoinbaseApplePay("ios", "15.7.9")).toBe(false);
    expect(supportsCoinbaseApplePay("ios", "16.0")).toBe(true);
    expect(supportsCoinbaseApplePay("ios", "26.5.2")).toBe(true);
    expect(supportsCoinbaseApplePay("ios", "unknown")).toBe(false);
    expect(supportsCoinbaseApplePay("android", 28)).toBe(true);
  });
});
