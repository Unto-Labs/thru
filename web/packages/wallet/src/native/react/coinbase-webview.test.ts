import { describe, expect, it, vi } from "vitest";
import {
  COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
  COINBASE_APPLE_PAY_BUTTON_WAIT_TIMEOUT_MS,
  COINBASE_APPLE_PAY_CLICK_SCRIPT,
  COINBASE_ONRAMP_EVENT_NAMES,
  COINBASE_PAYMENT_SIGNAL_TIMEOUT_MS,
  COINBASE_PAYMENT_STALL_ESCAPE_TIMEOUT_MS,
  buildCoinbaseApplePayButtonVisibilityScript,
  canCancelCoinbasePayment,
  coinbasePaymentEscape,
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

  it.each([
    "sheet-presented",
    "presentation-not-started",
    "button-not-found",
    "instrumentation-unavailable",
  ] as const)(
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
    JSON.stringify({
      type: "onramp_api.load_success",
      status: "sheet-presented",
    }),
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

  it("builds a signal-driven auto-click script without forcing Coinbase features", () => {
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).toContain(
      "api-onramp-apple-pay-button",
    );
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).toContain("button.click()");
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).toContain(
      "originalBegin.apply(this, arguments)",
    );
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).not.toContain("forceFeature");
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).not.toContain("display: none");
    expect(COINBASE_APPLE_PAY_CLICK_SCRIPT).toContain(
      `}, ${COINBASE_APPLE_PAY_BUTTON_WAIT_TIMEOUT_MS});`,
    );
  });

  function executeApplePayClickScript({
    begin,
    getButton = true,
    invokeBegin = true,
    observationAvailable = true,
  }: {
    begin?: (this: unknown, value: string) => unknown;
    getButton?: boolean;
    invokeBegin?: boolean;
    observationAvailable?: boolean;
  } = {}) {
    const messages: Array<{ type: string; status: string }> = [];
    const receiver = { kind: "session" };
    const args: [string] = ["payment-request"];
    let beginResult: unknown;
    let beginError: unknown;
    let buttonMounted = getButton;
    let mutationCallback: (() => void) | null = null;
    const watchdogs = new Map<number, () => void>();
    let nextWatchdogHandle = 1;
    function ApplePaySession() {}
    if (begin) ApplePaySession.prototype.begin = begin;

    class MutationObserver {
      constructor(callback: () => void) {
        mutationCallback = callback;
      }
      disconnect = vi.fn();
      observe = vi.fn();
    }

    const windowObject = {
      ApplePaySession,
      ...(observationAvailable ? { MutationObserver } : {}),
      ReactNativeWebView: {
        postMessage: (message: string) => messages.push(JSON.parse(message)),
      },
      setTimeout: (callback: () => void) => {
        const handle = nextWatchdogHandle++;
        watchdogs.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle: number) => {
        watchdogs.delete(handle);
      },
    } as Record<string, unknown>;
    const click = vi.fn(() => {
      if (!invokeBegin) return;
      try {
        beginResult = ApplePaySession.prototype.begin.apply(receiver, args);
      } catch (error) {
        beginError = error;
        throw error;
      }
    });
    const button = { click };
    const documentObject = {
      documentElement: {},
      getElementById: () => (buttonMounted ? button : null),
    };
    const runScript = new Function(
      "window",
      "document",
      COINBASE_APPLE_PAY_CLICK_SCRIPT,
    );
    runScript(windowObject, documentObject);

    return {
      args,
      click,
      get beginError() {
        return beginError;
      },
      get beginResult() {
        return beginResult;
      },
      messages,
      mountButton: () => {
        buttonMounted = true;
        mutationCallback?.();
      },
      pendingWatchdogCount: () => watchdogs.size,
      runWatchdogs: () => {
        const callbacks = [...watchdogs.values()];
        watchdogs.clear();
        for (const callback of callbacks) callback();
      },
      receiver,
      runScript: () => runScript(windowObject, documentObject),
    };
  }

  it("reports presentation while preserving begin receiver, arguments, and return value", () => {
    const expectedResult = { started: true };
    const begin = vi.fn(function (this: unknown, value: string) {
      return expectedResult;
    });
    const execution = executeApplePayClickScript({
      begin,
    });

    expect(execution.beginResult).toBe(expectedResult);
    expect(begin).toHaveBeenCalledOnce();
    expect(begin.mock.instances[0]).toBe(execution.receiver);
    expect(begin.mock.calls[0]).toEqual(execution.args);
    expect(execution.messages).toEqual([
      {
        type: COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
        status: "sheet-presented",
      },
    ]);
  });

  it("preserves errors thrown by the original begin method", () => {
    const expectedError = new Error("Apple Pay failed");
    const execution = executeApplePayClickScript({
      begin: () => {
        throw expectedError;
      },
    });

    expect(execution.beginError).toBe(expectedError);
    expect(execution.messages).toEqual([
      {
        status: "presentation-not-started",
        type: COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
      },
    ]);
  });

  it("reports definitive auto-click failures without an elapsed-time fallback", () => {
    const notStarted = executeApplePayClickScript({
      begin: () => undefined,
      invokeBegin: false,
    });
    expect(notStarted.messages[notStarted.messages.length - 1]?.status).toBe(
      "presentation-not-started",
    );

    const unavailable = executeApplePayClickScript();
    expect(unavailable.messages).toEqual([
      {
        type: COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
        status: "instrumentation-unavailable",
      },
    ]);

    const missingButton = executeApplePayClickScript({
      begin: () => undefined,
      getButton: false,
      observationAvailable: false,
    });
    expect(
      missingButton.messages[missingButton.messages.length - 1]?.status,
    ).toBe("button-not-found");
  });

  it("waits for a delayed Coinbase button without cancelling the payment", () => {
    const begin = vi.fn(() => undefined);
    const execution = executeApplePayClickScript({
      begin,
      getButton: false,
    });

    expect(execution.click).not.toHaveBeenCalled();
    expect(execution.messages).toEqual([]);
    expect(execution.pendingWatchdogCount()).toBe(1);

    execution.mountButton();

    expect(execution.click).toHaveBeenCalledOnce();
    expect(begin).toHaveBeenCalledOnce();
    expect(execution.messages[execution.messages.length - 1]?.status).toBe(
      "sheet-presented",
    );
    /* The bounded wait is cleared by the click so it can never interrupt the
       presented sheet. */
    expect(execution.pendingWatchdogCount()).toBe(0);
  });

  it("reports a missing button once the bounded wait elapses", () => {
    const execution = executeApplePayClickScript({
      begin: () => undefined,
      getButton: false,
    });

    execution.runWatchdogs();

    expect(execution.click).not.toHaveBeenCalled();
    expect(execution.messages).toEqual([
      {
        type: COINBASE_APPLE_PAY_AUTO_CLICK_MESSAGE,
        status: "button-not-found",
      },
    ]);
  });

  it("does not click or notify twice when the injected script runs again", () => {
    const begin = vi.fn(() => undefined);
    const execution = executeApplePayClickScript({ begin });

    execution.runScript();

    expect(execution.click).toHaveBeenCalledOnce();
    expect(begin).toHaveBeenCalledOnce();
    expect(execution.messages).toHaveLength(1);
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

  it("cancels a payment that never reports any lifecycle progress", () => {
    expect(coinbasePaymentEscape("pending", false)).toEqual({
      action: "cancel",
      delayMs: COINBASE_PAYMENT_SIGNAL_TIMEOUT_MS,
    });
  });

  it("reveals Coinbase's controls rather than cancelling a presented sheet", () => {
    expect(coinbasePaymentEscape("presented", false)).toEqual({
      action: "reveal",
      delayMs: COINBASE_PAYMENT_STALL_ESCAPE_TIMEOUT_MS,
    });
    expect(COINBASE_PAYMENT_STALL_ESCAPE_TIMEOUT_MS).toBeGreaterThan(
      COINBASE_PAYMENT_SIGNAL_TIMEOUT_MS,
    );
  });

  it("keeps bounding a committed payment but no longer offers a cancel", () => {
    expect(coinbasePaymentEscape("committed", false)).toEqual({
      action: "reveal",
      delayMs: COINBASE_PAYMENT_STALL_ESCAPE_TIMEOUT_MS,
    });
    expect(canCancelCoinbasePayment("committed")).toBe(false);
    expect(canCancelCoinbasePayment("presented")).toBe(true);
    expect(canCancelCoinbasePayment("pending")).toBe(true);
  });

  it("stops bounding the silence once the flow settles or an escape is visible", () => {
    expect(coinbasePaymentEscape("settled", false)).toBeNull();
    expect(coinbasePaymentEscape("pending", true)).toBeNull();
    expect(coinbasePaymentEscape("presented", true)).toBeNull();
  });

  it("requires iOS 16 or newer while leaving other platforms unchanged", () => {
    expect(supportsCoinbaseApplePay("ios", "15.7.9")).toBe(false);
    expect(supportsCoinbaseApplePay("ios", "16.0")).toBe(true);
    expect(supportsCoinbaseApplePay("ios", "26.5.2")).toBe(true);
    expect(supportsCoinbaseApplePay("ios", "unknown")).toBe(false);
    expect(supportsCoinbaseApplePay("android", 28)).toBe(true);
  });
});
