import { networkStorageKey } from "./networks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { providerConfigs, providerInstances } = vi.hoisted(() => ({
  providerConfigs: [] as Array<{
    iframeUrl?: string;
    telemetry?: unknown;
    theme?: string;
  }>,
  providerInstances: [] as any[],
}));

vi.mock("./provider/EmbeddedProvider", () => ({
  EmbeddedProvider: class {
    private handlers = new Map<string, Set<(data?: unknown) => void>>();
    private accounts: any[] = [];
    private selectedAccount: any = null;
    private connected = false;
    theme = "light";
    themeChanges: string[] = [];
    connectionState: any = {
      isAuthorized: false,
      isConnected: false,
      isUnlocked: false,
      hasPasskey: false,
      hasWalletAccount: false,
      accounts: [],
      selectedAccount: null,
      metadata: null,
    };
    connectionStateRequests: any[] = [];

    constructor(config: {
      iframeUrl?: string;
      telemetry?: unknown;
      theme?: string;
    }) {
      this.theme = config.theme ?? "light";
      providerConfigs.push(config);
      providerInstances.push(this);
    }

    getTheme(): string {
      return this.theme;
    }

    setTheme(theme: string): void {
      this.theme = theme;
      this.themeChanges.push(theme);
    }

    on(event: string, callback: (data?: unknown) => void): void {
      const listeners = this.handlers.get(event) ?? new Set();
      listeners.add(callback);
      this.handlers.set(event, listeners);
    }

    emit(event: string, data?: unknown): void {
      this.handlers.get(event)?.forEach((callback) => callback(data));
    }

    async initialize(): Promise<void> {}

    async getConnectionState(options?: unknown): Promise<any> {
      this.connectionStateRequests.push(options);
      if (
        this.connectionState.isAuthorized &&
        this.connectionState.isConnected
      ) {
        this.accounts = this.connectionState.accounts;
        this.selectedAccount = this.connectionState.selectedAccount;
        this.connected = this.accounts.length > 0 && !!this.selectedAccount;
      }
      return this.connectionState;
    }

    isConnected(): boolean {
      return this.connected;
    }

    getAccounts(): any[] {
      return this.accounts;
    }

    getSelectedAccount(): any {
      return this.selectedAccount;
    }

    clearConnection(): void {
      this.accounts = [];
      this.selectedAccount = null;
      this.connected = false;
    }

    async disconnect(): Promise<void> {
      this.clearConnection();
      this.emit("disconnect", {});
    }

    primeTelemetryContext(): void {}

    setTelemetryAppContextId(): void {}

    setTelemetryContext(): void {}

    async prepareDeposit(): Promise<never> {
      throw new Error("prepareDeposit mock not configured");
    }

    destroy(): void {}
  },
}));

import { BrowserSDK } from "./BrowserSDK";
import { EMBEDDED_PROVIDER_EVENTS } from "./protocol";
import { TransactionSigningScheme } from "./transaction-signing-scheme";
import { SecureStoreTestStorage } from "./test-utils/secure-store";
import { stubColorSchemeMedia } from "./test-utils/match-media";

interface QueuedTelemetryEvent {
  event: string;
  appMode?: string;
  operation?: string;
  outcome?: string;
}

function queuedTelemetryEvents(sdk: BrowserSDK): QueuedTelemetryEvent[] {
  return (
    sdk as unknown as {
      telemetry: { queue: { snapshot: () => QueuedTelemetryEvent[] } };
    }
  ).telemetry.queue.snapshot();
}

class MockStorage extends SecureStoreTestStorage {}

const ACCOUNT_A = {
  accountType: "thru",
  address: "account-a",
  label: "Account A",
};

const ACCOUNT_B = {
  accountType: "thru",
  address: "account-b",
  label: "Account B",
};

beforeEach(() => {
  providerConfigs.length = 0;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  providerInstances.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("BrowserSDK RPC configuration", () => {
  it.each(["/api/grpc", "https://node.example"])(
    "uses the trimmed RPC URL in the client: %s",
    (rpcUrl) => {
      const sdk = new BrowserSDK({ rpcUrl: ` \t${rpcUrl} \n` });
      expect(sdk.getThru().ctx.baseUrl).toBe(rpcUrl);
      sdk.destroy();
    },
  );
  it("accepts a root-relative app proxy during SSR without treating it as a node", () => {
    vi.stubGlobal("window", undefined);
    const sdk = new BrowserSDK({ rpcUrl: "/api/grpc" });
    const params = new URL(providerConfigs[0].iframeUrl!).searchParams;
    expect(sdk.getThru().ctx.baseUrl).toBe("/api/grpc");
    expect(params.has("tn_wallet_network")).toBe(false);
    expect(params.has("tn_expected_rpc")).toBe(false);
    sdk.destroy();
  });

  it("keeps an app proxy separate from the explicitly selected wallet network", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example" } });
    const sdk = new BrowserSDK({ rpcUrl: "/api/grpc", walletNetwork: "betanet" });
    const params = new URL(providerConfigs[0].iframeUrl!).searchParams;
    expect(sdk.getThru().ctx.baseUrl).toBe("/api/grpc");
    expect(JSON.parse(params.get("tn_wallet_network")!)).toBe("betanet");
    expect(params.has("tn_expected_rpc")).toBe(false);
    sdk.destroy();
  });

  it("still validates custom nodes and forwards absolute legacy RPC selections", () => {
    expect(() => new BrowserSDK({ walletNetwork: { rpcUrl: "/api/grpc" } })).toThrow();
    expect(() => new BrowserSDK({ rpcUrl: "//other.example/rpc" })).toThrow();
    const sdk = new BrowserSDK({ rpcUrl: "https://node.example" });
    const params = new URL(providerConfigs[0].iframeUrl!).searchParams;
    expect(JSON.parse(params.get("tn_wallet_network")!)).toEqual({ rpcUrl: "https://node.example" });
    expect(params.get("tn_expected_rpc")).toBe("https://node.example");
    sdk.destroy();
  });
});

describe("BrowserSDK theme", () => {
  it("draws for the configured theme and defaults to light", () => {
    new BrowserSDK();
    new BrowserSDK({ theme: "dark" });
    expect(providerConfigs.map((config) => config.theme)).toEqual([
      "light",
      "dark",
    ]);
  });

  it("follows the OS setting live under system", () => {
    const media = stubColorSchemeMedia(true);
    const sdk = new BrowserSDK({ theme: "system" });
    const provider = providerInstances[0];
    const changes: string[] = [];
    sdk.on("themeChanged", (theme) => changes.push(theme));

    expect(providerConfigs[0].theme).toBe("dark");
    expect(sdk.getTheme()).toBe("dark");
    expect(sdk.getThemePreference()).toBe("system");

    media.setDark(false);
    expect(provider.themeChanges).toEqual(["light"]);
    expect(changes).toEqual(["light"]);

    sdk.destroy();
    expect(media.listeners.size).toBe(0);
  });

  it("switches in place and only watches the OS while asked to", () => {
    const media = stubColorSchemeMedia(false);
    const sdk = new BrowserSDK({ theme: "light" });
    const provider = providerInstances[0];
    const changes: string[] = [];
    sdk.on("themeChanged", (theme) => changes.push(theme));
    expect(media.listeners.size).toBe(0);

    sdk.setTheme("dark");
    sdk.setTheme("dark");
    expect(provider.themeChanges).toEqual(["dark"]);
    expect(changes).toEqual(["dark"]);

    sdk.setTheme("system");
    expect(media.listeners.size).toBe(1);
    expect(sdk.getTheme()).toBe("light");

    sdk.setTheme("dark");
    expect(media.listeners.size).toBe(0);
    media.setDark(false);
    expect(changes).toEqual(["dark", "light", "dark"]);
    sdk.destroy();
  });
});

describe("BrowserSDK PWA telemetry", () => {
  const installedDisplayModes = [
    "standalone",
    "fullscreen",
    "minimal-ui",
    "window-controls-overlay",
  ] as const;

  function stubWindow(options: { displayMode?: string } = {}) {
    const listeners = new Map<string, Set<() => void>>();
    const addEventListener = vi.fn((type: string, listener: () => void) => {
      const registered = listeners.get(type) ?? new Set();
      registered.add(listener);
      listeners.set(type, registered);
    });
    const removeEventListener = vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    });
    vi.stubGlobal("window", {
      location: { origin: "https://wallet-app.test" },
      matchMedia: vi.fn((query: string) => ({
        matches: query === `(display-mode: ${options.displayMode})`,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      addEventListener,
      removeEventListener,
    });
    vi.stubGlobal("matchMedia", window.matchMedia);
    return { listeners, removeEventListener };
  }

  it.each(installedDisplayModes)(
    "records an installed PWA launch in %s display mode",
    (displayMode) => {
    stubWindow({ displayMode });
      vi.stubGlobal("navigator", {});
    const sdk = new BrowserSDK({
        iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
    });

    expect(queuedTelemetryEvents(sdk)).toContainEqual(
      expect.objectContaining({
          event: "pwa.launched",
          operation: "launch",
        outcome: displayMode,
      }),
    );
      expect(
        queuedTelemetryEvents(sdk).every(({ appMode }) => appMode === "pwa"),
      ).toBe(true);
      expect(
        new URL(providerConfigs[0]?.iframeUrl ?? "").searchParams.get(
          "tn_telemetry_app_mode",
        ),
      ).toBe("pwa");
      sdk.destroy();
    },
  );

  it("recognizes the legacy iOS standalone flag", () => {
    stubWindow();
    vi.stubGlobal("navigator", { standalone: true });
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
    });

    expect(queuedTelemetryEvents(sdk).map(({ event }) => event)).toContain(
      "pwa.launched",
    );
    sdk.destroy();
  });

  it("records a completed install and removes its listener on destroy", () => {
    const browser = stubWindow();
    vi.stubGlobal("navigator", {});
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
    });

    browser.listeners.get("appinstalled")?.forEach((listener) => listener());
    expect(
      queuedTelemetryEvents(sdk).every(({ appMode }) => appMode === "browser"),
    ).toBe(true);
    expect(queuedTelemetryEvents(sdk)).toContainEqual(
      expect.objectContaining({
        event: "pwa.install_completed",
        operation: "install",
        outcome: "installed",
      }),
    );

    sdk.destroy();
    expect(browser.listeners.get("appinstalled")?.size ?? 0).toBe(0);
    expect(browser.removeEventListener).toHaveBeenCalledWith(
      "appinstalled",
      expect.any(Function),
    );
  });
});

describe("BrowserSDK transaction signing scheme", () => {
  it("revalidates a prepared destination after the selected account changes", async () => {
    const firstDestination = {
      network: "alphanet",
      depositTarget: "credits",
      tokenAccountAddress: "ta_first_token_account",
      mintAddress: "ta_mint",
      tokenProgramAddress: "ta_token_program",
      symbol: "THRUSD",
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
    vi.spyOn(internals.provider, "getSelectedAccount").mockImplementation(
      () => ({
      address: selectedAddress,
      }),
    );
    const prepare = vi
      .spyOn(internals.provider, "prepareDeposit")
      .mockResolvedValueOnce(firstDestination)
      .mockResolvedValueOnce(secondDestination);

    const prepared = await sdk.prepareDeposit();
    const reused = await internals.resolveDepositDestination(prepared);

    expect(reused).toEqual({
      destination: { ...firstDestination, symbol: "$" },
      walletAddress: "ta_first_wallet",
    });
    expect(reused.destination).not.toBe(prepared);
    expect(prepare).toHaveBeenCalledOnce();

    selectedAddress = "ta_second_wallet";
    await expect(internals.resolveDepositDestination(prepared)).rejects.toThrow(
      "Prepared deposit destination no longer matches wallet config: tokenAccountAddress",
    );
    expect(prepare).toHaveBeenCalledTimes(2);
    sdk.destroy();
  });

  it("exposes the unified connection, account, session, and deposit contracts", () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      storage: false,
    });

    expect(sdk.connection).toEqual(
      expect.objectContaining({
      connect: expect.any(Function),
      disconnect: expect.any(Function),
      getState: expect.any(Function),
      refresh: expect.any(Function),
      }),
    );
    expect(sdk.accounts).toEqual(
      expect.objectContaining({
      getSelected: expect.any(Function),
      select: expect.any(Function),
      manage: expect.any(Function),
      }),
    );
    expect(sdk.sessions.getActive).toBeTypeOf("function");
    expect(sdk.sessions.renewSession).toBeTypeOf("function");
    expect(sdk.deposits.waitForDeposit).toBeTypeOf("function");
    sdk.destroy();
  });

  it("prepares a faucet-only destination but rejects paid deposits and other networks", async () => {
    const sdk = new BrowserSDK({ iframeUrl: "https://app.tid.sh/embedded", signingSessionStorage: false });
    const internals = sdk as unknown as {
      initialized: boolean;
      activeNetwork: { id: string; depositConfigured: boolean; depositProviders: string[] };
      provider: { prepareDeposit: (payload: unknown) => Promise<never> };
    };
    internals.initialized = true;
    internals.activeNetwork = { id: "betanet", depositConfigured: true, depositProviders: [] };
    const prepare = vi.spyOn(internals.provider, "prepareDeposit").mockResolvedValue({ network: "betanet" } as never);
    await expect(sdk.deposits.prepare({ network: "betanet" as never })).resolves.toMatchObject({ network: "betanet" });
    expect(prepare).toHaveBeenCalledOnce();
    expect(await sdk.deposits.getProviders()).toEqual([]);
    await expect(sdk.deposits.open({})).rejects.toThrow();
    await expect(sdk.deposits.prepare({ network: "alphanet" as never })).rejects.toThrow("Add funds unavailable");
    internals.activeNetwork.depositConfigured = false;
    await expect(sdk.deposits.prepare({ network: "betanet" as never })).rejects.toThrow("Add funds unavailable");
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
    expect(iframeUrl.searchParams.get("tn_telemetry")).toBe("1");
    expect(iframeUrl.searchParams.get("tn_telemetry_session")).toBeTruthy();

    sdk.destroy();
  });

  it("enables hosted-wallet telemetry by default with one SDK session ID", () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
    });

    const iframeUrl = new URL(providerConfigs[0]?.iframeUrl ?? "");
    expect(iframeUrl.searchParams.get("tn_telemetry")).toBe("1");
    expect(iframeUrl.searchParams.get("tn_telemetry_session")).toMatch(
      /^[\w.:-]+$/,
    );
    expect(iframeUrl.searchParams.get("tn_telemetry_app_mode")).toBe("browser");
    expect(providerConfigs[0]?.telemetry).toBeDefined();
    sdk.destroy();
  });

  it("propagates an explicit telemetry opt-out to the hosted wallet", () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
      telemetryEnabled: false,
    });

    const iframeUrl = new URL(providerConfigs[0]?.iframeUrl ?? "");
    expect(iframeUrl.searchParams.get("tn_telemetry")).toBe("0");
    expect(iframeUrl.searchParams.get("tn_telemetry_session")).toBeTruthy();
    sdk.destroy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not upload telemetry when provider construction rejects a wallet URL", () => {
    /* The real provider performs origin validation. This mock models that
       constructor failure so the SDK cleanup behavior stays covered here. */
    const untrusted = "https://evil.example/embedded";
    const originalPush = providerConfigs.push.bind(providerConfigs);
    const pushSpy = vi
      .spyOn(providerConfigs, "push")
      .mockImplementation((config) => {
      if (config.iframeUrl?.startsWith(untrusted)) {
          throw new Error("Untrusted iframe origin");
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

describe("BrowserSDK connection restoration", () => {
  it("drops legacy appUrl fields before sending connection metadata", async () => {
    const metadata = {
      appId: "legacy-app",
      appName: "Claimed App",
      appUrl: "https://trusted.example",
    };
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
      metadata,
    });
    const provider = providerInstances[0];
    provider.connect = vi.fn().mockResolvedValue({
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      status: "completed",
    });
    await sdk.connect({ metadata });
    expect(provider.connect).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { appId: "legacy-app", appName: "Claimed App" },
    }));
    sdk.destroy();
  });

  it("restores connect-time app metadata when construction metadata is omitted", async () => {
    const storage = new MockStorage();
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
      connectionStorage: storage,
    });
    const provider = providerInstances[0];
    provider.connect = vi.fn().mockResolvedValue({
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      status: "completed",
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    });

    await sdk.connect({
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    });
    sdk.destroy();

    const reloaded = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
      connectionStorage: storage,
    });
    const reloadedProvider = providerInstances[1];
    reloadedProvider.connectionState = {
      isAuthorized: true,
      isConnected: true,
      isUnlocked: true,
      hasPasskey: true,
      hasWalletAccount: true,
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    };

    await reloaded.initialize();

    expect(reloadedProvider.connectionStateRequests).toEqual([
      {
        preferredAccountAddress: ACCOUNT_B.address,
      },
    ]);
    expect(reloaded.getWalletAvailability()).toMatchObject({
      status: "connected",
      selectedAccount: ACCOUNT_B,
    });
  });

  it("asks the wallet to restore the preferred account on initialize", async () => {
    const storage = new MockStorage();
    storage.setItem(
      networkStorageKey("connection-hint", "pending"),
      JSON.stringify({
        version: 1,
        appId: "clob-demo",
        appOrigin: "unknown",
        walletOrigin: "https://app.tid.sh",
        selectedAccountAddress: ACCOUNT_B.address,
        autoRestore: true,
        savedAt: new Date().toISOString(),
      }),
    );
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
      connectionStorage: storage,
      connectionStorageKey: "connection-hint",
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    });
    const provider = providerInstances[0];
    provider.connectionState = {
      isAuthorized: true,
      isConnected: true,
      isUnlocked: false,
      hasPasskey: false,
      hasWalletAccount: true,
      accounts: [ACCOUNT_A, ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      metadata: {
        appId: "clob-demo",
        appName: "CLOB Demo",
        appUrl: "https://clob.example",
      },
    };

    await sdk.initialize();

    expect(provider.connectionStateRequests).toEqual([
      {
        metadata: { appId: "clob-demo", appName: "CLOB Demo" },
        preferredAccountAddress: ACCOUNT_B.address,
      },
    ]);
    expect(sdk.getWalletAvailability()).toMatchObject({
      status: "connected",
      selectedAccount: ACCOUNT_B,
    });
    expect(sdk.getSelectedAccount()).toEqual(ACCOUNT_B);
  });

  it("discovers an existing approval without a stored hint", async () => {
    const storage = new MockStorage();
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false,
      connectionStorage: storage,
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    });
    const provider = providerInstances[0];

    await sdk.initialize();

    expect(provider.connectionStateRequests).toEqual([
      { metadata: { appId: "clob-demo", appName: "CLOB Demo" } },
    ]);
    expect(sdk.getWalletAvailability().status).toBe("disconnected");
  });

  it("ignores old default entries and restores only the wallet-confirmed account", async () => {
    const storage = new MockStorage();
    storage.values.set(
      "thru.wallet.connection-hint.v1:https%3A%2F%2Fapp.tid.sh:unknown",
      JSON.stringify({ version: 1, selectedAccountAddress: ACCOUNT_A.address }),
    );
    storage.values.set(
      "thru.wallet.signing-sessions.v1:https%3A%2F%2Fapp.tid.sh:unknown",
      JSON.stringify({ version: 1, sessions: [] }),
    );
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      storage,
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    });
    const provider = providerInstances[0];
    provider.connectionState = {
      isAuthorized: true,
      isConnected: true,
      hasPasskey: true,
      hasWalletAccount: true,
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    };
    await sdk.initialize();
    expect(provider.connectionStateRequests).toEqual([
      { metadata: { appId: "clob-demo", appName: "CLOB Demo" } },
    ]);
    expect(sdk.getWalletAvailability()).toMatchObject({
      status: "connected",
      selectedAccount: ACCOUNT_B,
    });
    expect(
      [...storage.values.keys()].filter((key) =>
        key.startsWith("thru.wallet.connection-hint.v2."),
      ),
    ).toHaveLength(1);
    expect(
      [...storage.values.keys()].filter((key) => key.includes(".v1:")),
    ).toHaveLength(2);
    sdk.destroy();
  });

  it("does not auto-restore after an explicit disconnect", async () => {
    const storage = new MockStorage();
    storage.setItem(
      networkStorageKey("connection-hint", "pending"),
      JSON.stringify({
        version: 1,
        appId: "clob-demo",
        appOrigin: "unknown",
        walletOrigin: "https://app.tid.sh",
        selectedAccountAddress: ACCOUNT_B.address,
        autoRestore: true,
        savedAt: new Date().toISOString(),
      }),
    );
    const config = {
      iframeUrl: "https://app.tid.sh/embedded",
      signingSessionStorage: false as const,
      connectionStorage: storage,
      connectionStorageKey: "connection-hint",
      metadata: { appId: "clob-demo" },
    };
    const sdk = new BrowserSDK(config);
    const provider = providerInstances[0];
    provider.connectionState = {
      isAuthorized: true,
      isConnected: true,
      isUnlocked: true,
      hasPasskey: true,
      hasWalletAccount: true,
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      metadata: {
        appId: "clob-demo",
        appName: "CLOB Demo",
        appUrl: "https://clob.example",
      },
    };
    await sdk.initialize();
    await sdk.disconnect();

    expect(
      storage.values.has(networkStorageKey("connection-hint", "pending")),
    ).toBe(false);

    const reloaded = new BrowserSDK(config);
    const reloadedProvider = providerInstances[1];
    reloadedProvider.connectionState = {
      ...provider.connectionState,
      isAuthorized: false,
      isConnected: false,
      accounts: [],
      selectedAccount: null,
      metadata: null,
    };
    await reloaded.initialize();

    expect(reloadedProvider.connectionStateRequests).toHaveLength(1);
    expect(reloaded.getWalletAvailability().status).toBe("disconnected");
  });
});

describe("BrowserSDK restore record", () => {
  const RESTORE_B = {
    v: 1 as const,
    chainId: 1,
    appId: "unknown",
    origin: "unknown",
    account: {
      index: 1,
      publicKey: ACCOUNT_B.address,
      label: ACCOUNT_B.label,
      path: ACCOUNT_B.label,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    app: { connectedAt: 1_780_000_000 },
    issuedAt: "2026-09-22T00:00:00.000Z",
  };
  const AUTHORIZED_B = {
    isAuthorized: true,
    isConnected: true,
    isUnlocked: true,
    hasPasskey: false,
    hasWalletAccount: true,
    accounts: [ACCOUNT_B],
    selectedAccount: ACCOUNT_B,
    metadata: { appId: "clob-demo", appName: "CLOB Demo", appUrl: "https://clob.example" },
  };
  const UNAUTHORIZED = {
    isAuthorized: false,
    isConnected: false,
    isUnlocked: true,
    hasPasskey: false,
    hasWalletAccount: false,
    accounts: [],
    selectedAccount: null,
    metadata: null,
  };

  function seedHint(storage: MockStorage, restore?: typeof RESTORE_B) {
    storage.setItem(
      networkStorageKey("connection-hint", "pending"),
      JSON.stringify({
        version: 1,
        selectedAccountAddress: ACCOUNT_B.address,
        savedAt: "2026-09-22T00:00:00.000Z",
        ...(restore ? { restore } : {}),
      }),
    );
  }

  function readHint(storage: MockStorage) {
    const raw = storage.values.get(networkStorageKey("connection-hint", "pending"));
    return raw ? JSON.parse(raw) : null;
  }

  function createSdk(storage: MockStorage) {
    return new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      storage,
      connectionStorageKey: "connection-hint",
      signingSessionStorageKey: "sessions",
      metadata: { appId: "clob-demo", appName: "CLOB Demo" },
    });
  }

  it("sends the stored record with the connection-state request on initialize", async () => {
    const storage = new MockStorage();
    seedHint(storage, RESTORE_B);
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = AUTHORIZED_B;

    await sdk.initialize();

    expect(provider.connectionStateRequests).toEqual([
      {
        metadata: { appId: "clob-demo", appName: "CLOB Demo" },
        preferredAccountAddress: ACCOUNT_B.address,
        restore: RESTORE_B,
      },
    ]);
  });

  it("persists the record the wallet issues with an authorized state", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };

    expect(sdk.hasRememberedConnection()).toBe(false);
    await sdk.initialize();

    expect(readHint(storage)).toMatchObject({
      selectedAccountAddress: ACCOUNT_B.address,
      restore: RESTORE_B,
    });
    expect(sdk.hasRememberedConnection()).toBe(true);
    expect(sdk.connection.hasRememberedConnection?.()).toBe(true);

    /* An address-only hint cannot rebuild anything once the wallet's own
       storage is gone; opening the signed-in shell on it would only bounce. */
    seedHint(storage);
    expect(sdk.hasRememberedConnection()).toBe(false);
    expect(queuedTelemetryEvents(sdk)).toContainEqual(
      expect.objectContaining({ event: "sdk.connection.restore_recorded", outcome: "stored" }),
    );
  });

  it("clears the hint when the wallet does not take the record it was sent", async () => {
    const storage = new MockStorage();
    seedHint(storage, RESTORE_B);
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = UNAUTHORIZED;

    await sdk.initialize();

    expect(storage.values.has(networkStorageKey("connection-hint", "pending"))).toBe(false);
    expect(sdk.getWalletAvailability().status).toBe("disconnected");
    expect(sdk.hasRememberedConnection()).toBe(false);
    expect(queuedTelemetryEvents(sdk)).toContainEqual(
      expect.objectContaining({ event: "sdk.connection.restore_rejected" }),
    );
  });

  it("keeps a hint that carried no record when the wallet answers unauthorized", async () => {
    const storage = new MockStorage();
    seedHint(storage);
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = UNAUTHORIZED;

    await sdk.initialize();

    expect(readHint(storage)).toMatchObject({ selectedAccountAddress: ACCOUNT_B.address });
    expect(queuedTelemetryEvents(sdk)).not.toContainEqual(
      expect.objectContaining({ event: "sdk.connection.restore_rejected" }),
    );
  });

  it("persists the record connect() returns without exposing it to the host", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connect = vi.fn().mockResolvedValue({
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      status: "completed",
      metadata: AUTHORIZED_B.metadata,
      restore: RESTORE_B,
    });
    const connectEvents: unknown[] = [];
    sdk.on("connect", (payload: unknown) => connectEvents.push(payload));

    const result = await sdk.connect();

    expect(result).not.toHaveProperty("restore");
    expect(result.selectedAccount).toEqual(ACCOUNT_B);
    expect(connectEvents[connectEvents.length - 1]).not.toHaveProperty("restore");
    expect(readHint(storage)).toMatchObject({
      selectedAccountAddress: ACCOUNT_B.address,
      restore: RESTORE_B,
    });
  });

  it("sends the stored record with connect() for a wallet whose store is empty", async () => {
    const storage = new MockStorage();
    seedHint(storage, RESTORE_B);
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = UNAUTHORIZED;
    provider.connect = vi.fn().mockResolvedValue({
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
      status: "completed",
      metadata: AUTHORIZED_B.metadata,
    });
    /* The restore on initialize is rejected and clears the hint; seed it
       again so connect() reads a record, as a tab that never restored does. */
    await sdk.initialize();
    seedHint(storage, RESTORE_B);

    await sdk.connect();

    expect(provider.connect).toHaveBeenCalledWith(
      expect.objectContaining({ restore: RESTORE_B, preferredAccountAddress: ACCOUNT_B.address }),
    );
  });

  it("drops the record when the wallet switches to another account", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };
    await sdk.initialize();

    provider.emit(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, { account: ACCOUNT_A });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const hint = readHint(storage);
    expect(hint.selectedAccountAddress).toBe(ACCOUNT_A.address);
    expect(hint).not.toHaveProperty("restore");
  });

  it("drops signing-session descriptors when the wallet rebuilt the connection from the record", async () => {
    const storage = new MockStorage();
    seedHint(storage, RESTORE_B);
    const nowSeconds = Math.floor(Date.now() / 1000);
    storage.setItem(
      networkStorageKey("sessions", "pending"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "session-1",
            walletAddress: ACCOUNT_B.address,
            publicKey: "session-key",
            authIdx: 2,
            expiresAt: nowSeconds + 3600,
            createdAt: nowSeconds,
          },
        ],
      }),
    );
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B, restoredFromHost: true };

    await sdk.initialize();

    expect(storage.values.has(networkStorageKey("sessions", "pending"))).toBe(false);
    expect(readHint(storage)).toMatchObject({ restore: RESTORE_B });
    expect(queuedTelemetryEvents(sdk)).toContainEqual(
      expect.objectContaining({ event: "sdk.connection.restore_recorded", outcome: "rehydrated" }),
    );
  });

  it("keeps signing-session descriptors on an ordinary restore", async () => {
    const storage = new MockStorage();
    const nowSeconds = Math.floor(Date.now() / 1000);
    storage.setItem(
      networkStorageKey("sessions", "pending"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "session-1",
            walletAddress: ACCOUNT_B.address,
            publicKey: "session-key",
            authIdx: 2,
            expiresAt: nowSeconds + 3600,
            createdAt: nowSeconds,
          },
        ],
      }),
    );
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };

    await sdk.initialize();

    expect(storage.values.has(networkStorageKey("sessions", "pending"))).toBe(true);
  });

  it("clears the hint as soon as the account menu reports a sign-out", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };
    await sdk.initialize();
    expect(sdk.hasRememberedConnection()).toBe(true);
    provider.openAccountMenu = vi.fn().mockResolvedValue({ action: "signed-out" });

    await sdk.openAccountMenu({ anchor: { x: 0, y: 0, width: 0, height: 0 } });

    expect(storage.values.has(networkStorageKey("connection-hint", "pending"))).toBe(false);
    expect(sdk.hasRememberedConnection()).toBe(false);
  });

  it("keeps the record the wallet issues with a menu switch and drops it without one", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };
    await sdk.initialize();
    const RESTORE_A = { ...RESTORE_B, account: { ...RESTORE_B.account, index: 0, publicKey: ACCOUNT_A.address } };
    provider.openAccountMenu = vi
      .fn()
      .mockResolvedValueOnce({
        action: "switched",
        accounts: [ACCOUNT_A],
        selectedAccount: ACCOUNT_A,
        restore: RESTORE_A,
      })
      .mockResolvedValueOnce({ action: "switched", accounts: [ACCOUNT_B], selectedAccount: ACCOUNT_B });

    const switched = await sdk.openAccountMenu({ anchor: { x: 0, y: 0, width: 0, height: 0 } });
    expect(switched).not.toHaveProperty("restore");
    expect(readHint(storage)).toMatchObject({
      selectedAccountAddress: ACCOUNT_A.address,
      restore: RESTORE_A,
    });

    await sdk.openAccountMenu({ anchor: { x: 0, y: 0, width: 0, height: 0 } });
    const hint = readHint(storage);
    expect(hint.selectedAccountAddress).toBe(ACCOUNT_B.address);
    expect(hint).not.toHaveProperty("restore");
  });

  it("keeps the record returned by manage accounts and select account", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = AUTHORIZED_B;
    await sdk.initialize();
    provider.manageAccounts = vi.fn().mockResolvedValue({ selectedAccount: ACCOUNT_B, restore: RESTORE_B });

    const managed = await sdk.manageAccounts();
    expect(managed).not.toHaveProperty("restore");
    expect(readHint(storage)).toMatchObject({ restore: RESTORE_B });

    const RESTORE_A = { ...RESTORE_B, account: { ...RESTORE_B.account, index: 0, publicKey: ACCOUNT_A.address } };
    provider.selectAccount = vi.fn().mockResolvedValue({ account: ACCOUNT_A, restore: RESTORE_A });
    await expect(sdk.selectAccount(ACCOUNT_A.address)).resolves.toEqual(ACCOUNT_A);
    expect(readHint(storage)).toMatchObject({
      selectedAccountAddress: ACCOUNT_A.address,
      restore: RESTORE_A,
    });
  });

  it("clears the hint before asking the wallet to sign out and restores it if the wallet refuses", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };
    await sdk.initialize();
    let hintWhenAsked: unknown = "unread";
    provider.disconnect = vi.fn(async () => {
      hintWhenAsked = readHint(storage);
      throw Object.assign(new Error("User rejected the request"), {
        code: "USER_REJECTED",
      });
    });

    await expect(sdk.disconnect()).rejects.toThrow("User rejected");

    expect(hintWhenAsked).toBeNull();
    expect(readHint(storage)).toMatchObject({
      selectedAccountAddress: ACCOUNT_B.address,
      restore: RESTORE_B,
    });
    expect(sdk.hasRememberedConnection()).toBe(true);

    provider.disconnect = vi.fn(async () => {
      provider.clearConnection();
      provider.emit("disconnect", {});
    });
    await sdk.disconnect();
    expect(storage.values.has(networkStorageKey("connection-hint", "pending"))).toBe(false);
    expect(sdk.hasRememberedConnection()).toBe(false);
  });

  it("keeps the hint cleared when the sign-out answer is lost", async () => {
    const storage = new MockStorage();
    const sdk = createSdk(storage);
    const provider = providerInstances[0];
    provider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };
    await sdk.initialize();
    expect(sdk.hasRememberedConnection()).toBe(true);

    /* The wallet signed out but its answer never arrived: the bridge reports
       a timeout with no wallet error code. */
    provider.disconnect = vi.fn(async () => {
      throw new Error("Request timeout - wallet did not respond");
    });
    await expect(sdk.disconnect()).rejects.toThrow("Request timeout");
    expect(storage.values.has(networkStorageKey("connection-hint", "pending"))).toBe(false);
    expect(sdk.hasRememberedConnection()).toBe(false);

    /* A revoke error on the wallet side is not a kept session either. */
    const again = createSdk(storage);
    const againProvider = providerInstances[providerInstances.length - 1];
    againProvider.connectionState = { ...AUTHORIZED_B, restore: RESTORE_B };
    await again.initialize();
    expect(again.hasRememberedConnection()).toBe(true);
    againProvider.disconnect = vi.fn(async () => {
      throw Object.assign(new Error("Failed to revoke dApp authorization"), {
        code: "UNKNOWN_ERROR",
      });
    });
    await expect(again.disconnect()).rejects.toThrow("Failed to revoke");
    expect(storage.values.has(networkStorageKey("connection-hint", "pending"))).toBe(false);
    expect(again.hasRememberedConnection()).toBe(false);
  });

  it("answers no remembered connection without a connection store", () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      connectionStorage: false,
      signingSessionStorage: false,
    });
    expect(sdk.hasRememberedConnection()).toBe(false);
  });
});
