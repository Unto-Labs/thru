import { describe, expect, it } from "vitest";
import {
  ConnectionHintStore,
  connectionResultFromState,
  disconnectedWalletAvailability,
  walletAvailabilityFromConnectionState,
  resolveConnectionHintStorageKey,
} from "./connection-state";

const ACCOUNT_A = {
  accountType: "thru" as const,
  address: "account-a",
  label: "Account A",
};

const ACCOUNT_B = {
  accountType: "thru" as const,
  address: "account-b",
  label: "Account B",
};

class MockStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("shared wallet connection state", () => {
  it("restores a selected account without exposing legacy lock state", () => {
    const state = {
      network: { id: 'betanet', name: 'Betanet', rpcUrl: 'https://rpc.betanet.thru.org', chainId: 2, scope: 'preset:betanet:2', custom: false },
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

    expect(walletAvailabilityFromConnectionState(state)).toMatchObject({
      network: state.network,
      status: "connected",
      selectedAccount: ACCOUNT_B,
    });
    expect(connectionResultFromState(state)).toMatchObject({
      network: state.network,
      accounts: [ACCOUNT_B],
      selectedAccount: ACCOUNT_B,
    });
  });

  it("trusts a selected account without checking authorization flags", () => {
    const availability = walletAvailabilityFromConnectionState({
      isAuthorized: false,
      isConnected: false,
      isUnlocked: false,
      hasPasskey: true,
      hasWalletAccount: true,
      accounts: [ACCOUNT_A],
      selectedAccount: ACCOUNT_A,
      metadata: null,
    });

    expect(availability).toMatchObject({
      status: "connected",
      isConnected: true,
      accounts: [ACCOUNT_A],
      selectedAccount: ACCOUNT_A,
    });
  });

  it("clears the selected account on disconnect", () => {
    const connected = walletAvailabilityFromConnectionState({
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
    });

    expect(disconnectedWalletAvailability(connected)).toMatchObject({
      status: "disconnected",
      selectedAccount: null,
    });
  });
});

describe("ConnectionHintStore", () => {
  it("namespaces default keys by wallet and app origin", () => {
    const first = resolveConnectionHintStorageKey({
      walletOrigin: "https://wallet.example",
      appOrigin: "https://clob-a.example",
    });
    const second = resolveConnectionHintStorageKey({
      walletOrigin: "https://wallet.example",
      appOrigin: "https://clob-b.example",
    });
    expect(first).not.toBe(second);
  });

  it("reads the previous mobile hint format", async () => {
    const storage = new MockStorage();
    storage.setItem(
      "hint",
      JSON.stringify({
        version: 1,
        origin: "thru-mobile://clob",
        walletOrigin: "https://app.tid.sh",
        selectedAccountAddress: ACCOUNT_B.address,
        savedAt: "2026-08-27T00:00:00.000Z",
      }),
    );
    const store = new ConnectionHintStore(storage, "hint");

    await expect(store.read()).resolves.toMatchObject({
      version: 1,
      selectedAccountAddress: ACCOUNT_B.address,
    });
  });

  it("trusts a valid hint without checking per-app metadata", async () => {
    const storage = new MockStorage();
    storage.setItem(
      "hint",
      JSON.stringify({
        version: 1,
        appId: "clob-demo",
        appOrigin: "https://other.example",
        walletOrigin: "https://app.tid.sh",
        selectedAccountAddress: ACCOUNT_B.address,
        autoRestore: true,
        savedAt: "2026-08-27T00:00:00.000Z",
      }),
    );
    const store = new ConnectionHintStore(storage, "hint");

    await expect(store.read()).resolves.toMatchObject({
      selectedAccountAddress: ACCOUNT_B.address,
    });
    expect(storage.values.has("hint")).toBe(true);
  });

  it("deletes the selected-account hint", async () => {
    const storage = new MockStorage();
    const store = new ConnectionHintStore(storage, "hint");
    await store.write({ selectedAccountAddress: ACCOUNT_B.address });

    await store.clear();

    expect(storage.values.size).toBe(0);
  });
});

describe("ConnectionHintStore restore record", () => {
  const RECORD_B = {
    v: 1 as const,
    chainId: 1,
    appId: "https://clob.example",
    origin: "https://clob.example",
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

  it("stores the wallet's record next to the selected address and reads it back", async () => {
    const storage = new MockStorage();
    const store = new ConnectionHintStore(storage, "hint");

    await store.write({ selectedAccountAddress: ACCOUNT_B.address, restore: RECORD_B });

    await expect(store.read()).resolves.toMatchObject({
      selectedAccountAddress: ACCOUNT_B.address,
      restore: RECORD_B,
    });
  });

  it("keeps the record when the same address is written again without one", async () => {
    const storage = new MockStorage();
    const store = new ConnectionHintStore(storage, "hint");
    await store.write({ selectedAccountAddress: ACCOUNT_B.address, restore: RECORD_B });

    await store.write({ selectedAccountAddress: ACCOUNT_B.address });

    await expect(store.read()).resolves.toMatchObject({ restore: RECORD_B });
  });

  it("drops the record when another address is selected", async () => {
    const storage = new MockStorage();
    const store = new ConnectionHintStore(storage, "hint");
    await store.write({ selectedAccountAddress: ACCOUNT_B.address, restore: RECORD_B });

    await store.write({ selectedAccountAddress: ACCOUNT_A.address });

    const hint = await store.read();
    expect(hint?.selectedAccountAddress).toBe(ACCOUNT_A.address);
    expect(hint?.restore).toBeUndefined();
  });

  it("drops the record when null is written", async () => {
    const storage = new MockStorage();
    const store = new ConnectionHintStore(storage, "hint");
    await store.write({ selectedAccountAddress: ACCOUNT_B.address, restore: RECORD_B });

    await store.write({ selectedAccountAddress: ACCOUNT_B.address, restore: null });

    expect((await store.read())?.restore).toBeUndefined();
  });

  it("reads a hint written before records existed", async () => {
    const storage = new MockStorage();
    storage.setItem(
      "hint",
      JSON.stringify({
        version: 1,
        selectedAccountAddress: ACCOUNT_B.address,
        savedAt: "2026-08-27T00:00:00.000Z",
      }),
    );
    const store = new ConnectionHintStore(storage, "hint");

    const hint = await store.read();
    expect(hint?.selectedAccountAddress).toBe(ACCOUNT_B.address);
    expect(hint).not.toHaveProperty("restore");
  });

  it("keeps the address and ignores a record it cannot make sense of", async () => {
    const storage = new MockStorage();
    storage.setItem(
      "hint",
      JSON.stringify({
        version: 1,
        selectedAccountAddress: ACCOUNT_B.address,
        savedAt: "2026-08-27T00:00:00.000Z",
        restore: { v: 1, account: "not-an-account" },
      }),
    );
    const store = new ConnectionHintStore(storage, "hint");

    const hint = await store.read();
    expect(hint?.selectedAccountAddress).toBe(ACCOUNT_B.address);
    expect(hint?.restore).toBeUndefined();
    expect(storage.values.has("hint")).toBe(true);
  });

  it("peeks synchronously without touching storage", async () => {
    const storage = new MockStorage();
    const store = new ConnectionHintStore(storage, "hint");
    expect(store.peek()).toBeNull();

    await store.write({ selectedAccountAddress: ACCOUNT_B.address, restore: RECORD_B });

    expect(store.peek()).toMatchObject({
      selectedAccountAddress: ACCOUNT_B.address,
      restore: RECORD_B,
    });
    storage.setItem("hint", "not json");
    expect(store.peek()).toBeNull();
    expect(storage.values.get("hint")).toBe("not json");
  });

  it("peek returns null for an adapter that answers asynchronously", () => {
    const asyncStorage = {
      getItem: async () => JSON.stringify({ version: 1, selectedAccountAddress: "a" }),
      setItem: async () => {},
      removeItem: async () => {},
    };
    const store = new ConnectionHintStore(asyncStorage, "hint");
    expect(store.peek()).toBeNull();
  });
});
