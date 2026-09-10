import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { providerConfigs, providerInstances } = vi.hoisted(() => ({
  providerConfigs: [] as Array<{ iframeUrl?: string; telemetry?: unknown }>,
  providerInstances: [] as any[],
}));

vi.mock("./provider/EmbeddedProvider", () => ({
  EmbeddedProvider: class {
    private handlers = new Map<string, Set<(data?: unknown) => void>>();
    private accounts: any[] = [];
    private selectedAccount: any = null;
    private connected = false;
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

    constructor(config: { iframeUrl?: string; telemetry?: unknown }) {
      providerConfigs.push(config);
      providerInstances.push(this);
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
      if (this.connectionState.isAuthorized && this.connectionState.isConnected) {
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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  providerInstances.length = 0;
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

  it("exposes the unified connection, account, session, and deposit contracts", () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded",
      storage: false,
    });

    expect(sdk.connection).toEqual(expect.objectContaining({
      connect: expect.any(Function),
      disconnect: expect.any(Function),
      getState: expect.any(Function),
      refresh: expect.any(Function),
    }));
    expect(sdk.accounts).toEqual(expect.objectContaining({
      getSelected: expect.any(Function),
      select: expect.any(Function),
      manage: expect.any(Function),
    }));
    expect(sdk.sessions.getActive).toBeTypeOf("function");
    expect(sdk.sessions.renewSession).toBeTypeOf("function");
    expect(sdk.deposits.waitForDeposit).toBeTypeOf("function");
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

describe("BrowserSDK connection restoration", () => {
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

    await sdk.connect({ metadata: { appId: "clob-demo", appName: "CLOB Demo" } });
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
      "connection-hint",
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
    storage.values.set('thru.wallet.connection-hint.v1:https%3A%2F%2Fapp.tid.sh:unknown', JSON.stringify({ version: 1, selectedAccountAddress: ACCOUNT_A.address }));
    storage.values.set('thru.wallet.signing-sessions.v1:https%3A%2F%2Fapp.tid.sh:unknown', JSON.stringify({ version: 1, sessions: [] }));
    const sdk = new BrowserSDK({
      iframeUrl: 'https://app.tid.sh/embedded', storage,
      metadata: { appId: 'clob-demo', appName: 'CLOB Demo' },
    });
    const provider = providerInstances[0];
    provider.connectionState = { isAuthorized: true, isConnected: true, hasPasskey: true, hasWalletAccount: true, accounts: [ACCOUNT_B], selectedAccount: ACCOUNT_B, metadata: { appId: 'clob-demo', appName: 'CLOB Demo' } };
    await sdk.initialize();
    expect(provider.connectionStateRequests).toEqual([{ metadata: { appId: 'clob-demo', appName: 'CLOB Demo' } }]);
    expect(sdk.getWalletAvailability()).toMatchObject({ status: 'connected', selectedAccount: ACCOUNT_B });
    expect([...storage.values.keys()].filter(key => key.startsWith('thru.wallet.connection-hint.v2.'))).toHaveLength(1);
    expect([...storage.values.keys()].filter(key => key.includes('.v1:'))).toHaveLength(2);
    sdk.destroy();
  });

  it("does not auto-restore after an explicit disconnect", async () => {
    const storage = new MockStorage();
    storage.setItem(
      "connection-hint",
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

    expect(storage.values.has("connection-hint")).toBe(false);

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
