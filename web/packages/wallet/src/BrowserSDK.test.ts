import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { providerConfigs } = vi.hoisted(() => ({
  providerConfigs: [] as Array<{ iframeUrl?: string; telemetry?: unknown }>,
}));

vi.mock("./provider/EmbeddedProvider", () => ({
  EmbeddedProvider: class {
    constructor(config: { iframeUrl?: string; telemetry?: unknown }) {
      providerConfigs.push(config);
    }

    on(): void {}

    destroy(): void {}
  },
}));

import { BrowserSDK } from "./BrowserSDK";
import { TransactionSigningScheme } from "./transaction-signing-scheme";

beforeEach(() => {
  providerConfigs.length = 0;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => vi.unstubAllGlobals());

describe("BrowserSDK transaction signing scheme", () => {
  it("returns only the dapp-configured deposit provider IDs", async () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
      deposits: { providers: ["unifold", "coinbase"] },
    });

    expect(await sdk.deposits.getProviders()).toEqual(["unifold", "coinbase"]);
    sdk.destroy();
  });

  it("propagates legacy mode to the hosted-wallet URL", () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded?existing=1",
      signingSessionStorage: false,
      transactionSigningScheme: TransactionSigningScheme.Legacy,
    });

    const iframeUrl = new URL(providerConfigs[0]?.iframeUrl ?? "");
    expect(iframeUrl.searchParams.get("existing")).toBe("1");
    expect(iframeUrl.searchParams.get("tn_transaction_signing_scheme")).toBe(
      "legacy",
    );
    expect(iframeUrl.searchParams.get('tn_telemetry')).toBe('1');
    expect(iframeUrl.searchParams.get('tn_telemetry_session')).toBeTruthy();

    sdk.destroy();
  });

  it('enables hosted-wallet telemetry by default with one SDK session ID', () => {
    const sdk = new BrowserSDK({
      iframeUrl: 'https://app.tid.sh/embedded',
      signingSessionStorage: false,
    });

    const iframeUrl = new URL(providerConfigs[0]?.iframeUrl ?? '');
    expect(iframeUrl.searchParams.get('tn_telemetry')).toBe('1');
    expect(iframeUrl.searchParams.get('tn_telemetry_session')).toMatch(/^[\w.:-]+$/);
    expect(providerConfigs[0]?.telemetry).toBeDefined();
    sdk.destroy();
  });

  it('propagates an explicit telemetry opt-out to the hosted wallet', () => {
    const sdk = new BrowserSDK({
      iframeUrl: 'https://app.tid.sh/embedded',
      signingSessionStorage: false,
      telemetryEnabled: false,
    });

    const iframeUrl = new URL(providerConfigs[0]?.iframeUrl ?? '');
    expect(iframeUrl.searchParams.get('tn_telemetry')).toBe('0');
    expect(iframeUrl.searchParams.get('tn_telemetry_session')).toBeTruthy();
    sdk.destroy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not upload telemetry when provider construction rejects a wallet URL', () => {
    /* The real provider performs origin validation. This mock models that
       constructor failure so the SDK cleanup behavior stays covered here. */
    const untrusted = 'https://evil.example/embedded';
    const originalPush = providerConfigs.push.bind(providerConfigs);
    const pushSpy = vi.spyOn(providerConfigs, 'push').mockImplementation((config) => {
      if (config.iframeUrl?.startsWith(untrusted)) {
        throw new Error('Untrusted iframe origin');
      }
      return originalPush(config);
    });

    expect(
      () =>
        new BrowserSDK({
          iframeUrl: untrusted,
          signingSessionStorage: false,
        }),
    ).toThrow(/Untrusted iframe origin/);
    expect(fetch).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });
});
