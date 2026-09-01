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

    primeTelemetryContext(): void {}

    setTelemetryAppContextId(): void {}

    setTelemetryContext(): void {}

    getSelectedAccount(): { address: string } | null {
      return null;
    }

    async prepareDeposit(): Promise<never> {
      throw new Error("prepareDeposit mock not configured");
    }

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
  it("revalidates a prepared destination after the selected account changes", async () => {
    const firstDestination = {
      network: "alphanet",
      depositTarget: "credits",
      tokenAccountAddress: "ta_first_token_account",
      mintAddress: "ta_mint",
      tokenProgramAddress: "ta_token_program",
      symbol: "CREDITS",
      decimals: 6,
    };
    const secondDestination = {
      ...firstDestination,
      tokenAccountAddress: "ta_second_token_account",
    };
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
    });
    const internals = sdk as unknown as {
      initialized: boolean;
      provider: {
        prepareDeposit: (payload: unknown) => Promise<typeof firstDestination>;
        getSelectedAccount: () => { address: string } | null;
      };
      resolveDepositDestination: (
        destination: typeof firstDestination,
      ) => Promise<{
        destination: typeof firstDestination;
        walletAddress: string;
      }>;
    };
    internals.initialized = true;
    let selectedAddress = "ta_first_wallet";
    vi.spyOn(internals.provider, "getSelectedAccount").mockImplementation(() => ({
      address: selectedAddress,
    }));
    const prepare = vi
      .spyOn(internals.provider, "prepareDeposit")
      .mockResolvedValueOnce(firstDestination)
      .mockResolvedValueOnce(secondDestination);

    const prepared = await sdk.prepareDeposit();
    const reused = await internals.resolveDepositDestination(prepared);

    expect(reused).toEqual({
      destination: firstDestination,
      walletAddress: "ta_first_wallet",
    });
    expect(reused.destination).not.toBe(prepared);
    expect(prepare).toHaveBeenCalledOnce();

    selectedAddress = "ta_second_wallet";
    await expect(
      internals.resolveDepositDestination(prepared),
    ).rejects.toThrow(
      "Prepared deposit destination no longer matches wallet config: tokenAccountAddress",
    );
    expect(prepare).toHaveBeenCalledTimes(2);
    sdk.destroy();
  });

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
