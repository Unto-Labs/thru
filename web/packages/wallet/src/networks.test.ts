import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALLET_NETWORKS,
  normalizeWalletRpc,
  parseWalletNetworks,
  resolveWalletNetworkSelection,
  walletNetworkScope,
  withWalletNetwork,
  networkScopedStorage,
  networkStorageKey,
  formatWalletNetworkLabel,
} from "./networks";

describe("wallet network selection", () => {
  it("identifies custom nodes by hostname even when their alias matches a preset", () => {
    expect(formatWalletNetworkLabel({
      custom: true, rpcUrl: "https://PRIVATE.example:8443/rpc", name: "Alphanet",
    })).toBe("Custom · private.example:8443 (Alphanet)");
    expect(formatWalletNetworkLabel({ custom: true, rpcUrl: "https://node.example" }))
      .toBe("Custom · node.example");
    expect(formatWalletNetworkLabel({ custom: true, rpcUrl: "invalid", name: "Alphanet" }))
      .toBe("Custom · invalid RPC URL");
    expect(formatWalletNetworkLabel(resolveWalletNetworkSelection("alphanet", DEFAULT_WALLET_NETWORKS)))
      .toBe("Alphanet");
  });
  it("resolves presets and normalizes a compatible rpcUrl input to its preset", () => {
    expect(
      resolveWalletNetworkSelection(
        { rpcUrl: "https://RPC.BETANET.thru.org/" },
        DEFAULT_WALLET_NETWORKS,
      ),
    ).toMatchObject({ id: "betanet", custom: false });
    expect(
      resolveWalletNetworkSelection("alphanet", DEFAULT_WALLET_NETWORKS).rpcUrl,
    ).toBe("https://rpc.alphanet.thru.org");
  });
  it.each([
    "file:///tmp/rpc",
    "javascript:alert(1)",
    "https://user:pass@node.example",
    "https://node.example?rpc=x",
    "https://node.example/#secret",
    "not a url",
  ])("rejects invalid endpoint %s", (value) => {
    expect(() => normalizeWalletRpc(value)).toThrow();
  });
  it("rejects invalid catalogs and unknown presets", () => {
    for (const value of [
      "[]",
      "{}",
      '[{"slug":"custom","displayName":"Custom","rpc":"https://x"}]',
      JSON.stringify([DEFAULT_WALLET_NETWORKS[0], DEFAULT_WALLET_NETWORKS[0]]),
    ])
      expect(() => parseWalletNetworks(value)).toThrow();
    expect(() =>
      resolveWalletNetworkSelection("typo", DEFAULT_WALLET_NETWORKS),
    ).toThrow("Unknown");
  });
  it("keeps two private chains sharing a numeric chain ID separate", () => {
    const a = resolveWalletNetworkSelection(
      { rpcUrl: "https://a.example" },
      [],
    );
    const b = resolveWalletNetworkSelection(
      { rpcUrl: "https://b.example" },
      [],
    );
    expect(walletNetworkScope(a, 1)).not.toBe(walletNetworkScope(b, 1));
    expect(() => walletNetworkScope(a, 0)).toThrow();
  });
  it("passes one default to the wallet and preserves the legacy deposit selector", () => {
    const url = new URL(
      withWalletNetwork(
        "https://wallet.example/embedded?network=secondary-net",
        "betanet",
        undefined,
        "app-a",
      ),
    );
    expect(JSON.parse(url.searchParams.get("tn_wallet_network")!)).toBe(
      "betanet",
    );
    expect(url.searchParams.get("network")).toBe("secondary-net");
    expect(url.searchParams.get("tn_network_app")).toBe("app-a");
    const legacy = new URL(
      withWalletNetwork(
        "https://wallet.example/embedded",
        undefined,
        "https://node.example/",
      ),
    );
    expect(JSON.parse(legacy.searchParams.get("tn_wallet_network")!)).toEqual({
      rpcUrl: "https://node.example/",
    });
  });
  it("never restores unscoped hints and keeps storage keys valid for SecureStore", async () => {
    const values = new Map([["session", "legacy-session"]]);
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
    let scope = "custom:https://a.example:1";
    const scoped = networkScopedStorage(storage, () => scope);
    expect(await scoped.getItem("session")).toBeNull();
    await scoped.setItem("session", "a");
    scope = "custom:https://b.example:1";
    expect(await scoped.getItem("session")).toBeNull();
    expect(networkStorageKey("session", scope)).toMatch(/^[a-zA-Z0-9._-]+$/);
    scope = "custom:https://a.example:1";
    expect(await scoped.getItem("session")).toBe("a");
  });
});

it('rejects a session-store read that outlives its network rather than copying it', async () => {
  const { SigningSessionDescriptorStore } = await import('./signing-sessions');
  let resolve!: (value: string) => void;
  let scope = 'a';
  const writes: string[] = [];
  const adapter = networkScopedStorage({
    getItem: () => new Promise<string>((r) => { resolve = r; }),
    setItem: (key: string) => { writes.push(key); },
    removeItem: () => {},
  }, () => scope);
  const store = new SigningSessionDescriptorStore(adapter, 'session');
  const reading = store.list();
  scope = 'b'; resolve(JSON.stringify({ version: 1, sessions: [] }));
  await expect(reading).rejects.toMatchObject({ code: 'NETWORK_CHANGED' });
  expect(writes).toEqual([]);
});
