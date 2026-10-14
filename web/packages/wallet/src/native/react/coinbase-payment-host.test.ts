import { describe, expect, it, vi } from "vitest";
import {
  CoinbasePaymentHost,
  type CoinbasePaymentHostState,
} from "./coinbase-payment-host";

const URL = "https://pay.coinbase.com/payment/test";
function setup() {
  let state: CoinbasePaymentHostState = { active: false, payment: null };
  const forward = vi.fn();
  const host = new CoinbasePaymentHost(forward, (next) => {
    state = next;
  });
  const open = () => {
    host.open(URL, "ios", "26.5");
    return state.payment!.id;
  };
  const receive = (id: number, eventName: string, url = URL) =>
    host.receive(
      id,
      url,
      JSON.stringify({ eventName, data: { orderId: "test" } }),
    );
  return { host, forward, open, receive, state: () => state };
}

describe("standard sheet Coinbase payment host", () => {
  it.each([
    "http://pay.coinbase.com/a",
    "https://coinbase.com.evil.test/a",
    "not a url",
  ])("rejects an untrusted payment URL %s", (url) => {
    const { host, forward, state } = setup();
    host.open(url, "ios", 26);
    expect(state().active).toBe(false);
    expect(forward).not.toHaveBeenCalled();
  });

  it.each([
    ["android", 36, "APPLE_PAY_PLATFORM_UNSUPPORTED"],
    ["ios", 15, "IOS_VERSION_UNSUPPORTED"],
  ] as const)(
    "returns control to the sheet on unsupported %s %s",
    (platform, version, errorCode) => {
      const { host, forward, state } = setup();
      host.open(URL, platform, version);
      expect(state().active).toBe(false);
      expect(JSON.parse(forward.mock.calls[0][0])).toMatchObject({
        eventName: "onramp_api.load_error",
        data: { errorCode },
      });
    },
  );

  it("keeps a committed payment alive and forwards completion exactly once", () => {
    const { host, forward, open, receive, state } = setup();
    const id = open();
    receive(id, "onramp_api.load_success");
    receive(id, "onramp_api.commit_success");
    receive(id, "onramp_api.commit_success");
    receive(id, "onramp_api.cancel");
    host.cancel(id);
    expect(state().payment?.id).toBe(id);
    receive(id, "onramp_api.polling_success");
    receive(id, "onramp_api.polling_success");
    expect(
      forward.mock.calls.map(([raw]) => JSON.parse(raw).eventName),
    ).toEqual([
      "onramp_api.load_success",
      "onramp_api.commit_success",
      "onramp_api.polling_success",
    ]);
    expect(state()).toEqual({ active: true, payment: null });
    host.reset();
    expect(state().active).toBe(false);
  });

  it("ignores malformed events and events from an untrusted navigated page", () => {
    const { host, forward, open, receive, state } = setup();
    const id = open();
    receive(id, "onramp_api.polling_success", "https://evil.test");
    receive(id, "unknown");
    host.receive(id, URL, "not json");
    expect(forward).not.toHaveBeenCalled();
    expect(state().payment?.id).toBe(id);
  });

  it("cancels once and permits reopening without accepting old callbacks", () => {
    const { host, forward, open, receive, state } = setup();
    const oldId = open();
    host.cancel(oldId);
    host.cancel(oldId);
    expect(forward).toHaveBeenCalledOnce();
    const newId = open();
    host.cancel(oldId);
    host.loadError(oldId, "late failure", "LATE");
    receive(oldId, "onramp_api.polling_success");
    expect(state().payment?.id).toBe(newId);
    expect(forward).toHaveBeenCalledOnce();
  });

  it("invalidates callbacks on dismissal or request timeout", () => {
    const { host, forward, open, receive, state } = setup();
    const oldId = open();
    host.reset();
    const newId = open();
    receive(oldId, "onramp_api.cancel");
    receive(oldId, "onramp_api.commit_success");
    host.loadError(oldId, "late", "LOAD");
    expect(forward).not.toHaveBeenCalled();
    expect(state().payment?.id).toBe(newId);
  });

  it.each([
    "onramp_api.load_error",
    "onramp_api.commit_error",
    "onramp_api.polling_error",
  ])("releases the payment overlay for retry after %s", (event) => {
    const { open, receive, state } = setup();
    receive(open(), event);
    expect(state()).toEqual({ active: false, payment: null });
    expect(open()).toBeGreaterThan(1);
  });

  it("reports a transport error once, then allows another payment", () => {
    const { host, forward, open, state } = setup();
    const id = open();
    host.loadError(id, "HTTP 503", "HTTP_503");
    host.loadError(id, "duplicate", "HTTP_503");
    expect(forward).toHaveBeenCalledOnce();
    expect(JSON.parse(forward.mock.calls[0][0])).toMatchObject({
      eventName: "onramp_api.load_error",
      data: { errorCode: "HTTP_503" },
    });
    expect(state().active).toBe(false);
    open();
    expect(state().active).toBe(true);
  });
});
