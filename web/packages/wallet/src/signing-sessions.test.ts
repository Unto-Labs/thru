import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SigningSessionDescriptorStore,
  assertSigningSessionWalletAccountIdx,
  resolveSessionExpirySeconds,
  resolveSigningSessionStorageKey,
} from "./signing-sessions";

class MemoryStorage {
  values = new Map<string, string>();

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

describe("signing session descriptor storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scopes default storage keys by wallet origin and app origin", () => {
    const appA = resolveSigningSessionStorageKey({
      walletOrigin: "https://wallet.example",
      appOrigin: "https://app-a.example",
    });
    const appB = resolveSigningSessionStorageKey({
      walletOrigin: "https://wallet.example",
      appOrigin: "https://app-b.example",
    });

    expect(appA).not.toBe(appB);
    expect(appA).toContain(encodeURIComponent("https://wallet.example"));
    expect(appA).toContain(encodeURIComponent("https://app-a.example"));
  });

  it("stores only active sessions and prunes expired descriptors locally", async () => {
    const storage = new MemoryStorage();
    const store = new SigningSessionDescriptorStore(storage, "sessions");

    await store.save({
      id: "expired",
      walletAddress: "wallet",
      publicKey: "expired-pubkey",
      authIdx: 1,
      expiresAt: Math.floor(Date.now() / 1000) - 1,
      createdAt: Math.floor(Date.now() / 1000) - 10,
    });
    await store.save({
      id: "active",
      walletAddress: "wallet",
      publicKey: "active-pubkey",
      authIdx: 2,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      createdAt: Math.floor(Date.now() / 1000),
    });

    expect(await store.get("expired")).toBeNull();
    expect(await store.get("active")).toMatchObject({
      id: "active",
      publicKey: "active-pubkey",
      authIdx: 2,
    });
    expect(await store.list()).toHaveLength(1);
  });

  it("replaces a descriptor with the same session id", async () => {
    const store = new SigningSessionDescriptorStore(new MemoryStorage(), "sessions");
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    await store.save({
      id: "session",
      walletAddress: "wallet-a",
      publicKey: "pubkey-a",
      authIdx: 1,
      expiresAt,
      createdAt: Math.floor(Date.now() / 1000),
    });
    await store.save({
      id: "session",
      walletAddress: "wallet-b",
      publicKey: "pubkey-b",
      authIdx: 2,
      expiresAt,
      createdAt: Math.floor(Date.now() / 1000),
    });

    expect(await store.list()).toEqual([
      expect.objectContaining({
        id: "session",
        walletAddress: "wallet-b",
        publicKey: "pubkey-b",
        authIdx: 2,
      }),
    ]);
  });

  it("replaces older descriptors for the same wallet when saving a usable session", async () => {
    const store = new SigningSessionDescriptorStore(new MemoryStorage(), "sessions");
    const nowSeconds = Math.floor(Date.now() / 1000);

    await store.save({
      id: "old-wallet-a",
      walletAddress: "wallet-a",
      publicKey: "old-pubkey",
      authIdx: 1,
      expiresAt: nowSeconds + 60,
      createdAt: nowSeconds,
    });
    await store.save({
      id: "wallet-b",
      walletAddress: "wallet-b",
      publicKey: "wallet-b-pubkey",
      authIdx: 2,
      expiresAt: nowSeconds + 60,
      createdAt: nowSeconds,
    });
    await store.saveReplacingWalletSessions({
      id: "new-wallet-a",
      walletAddress: "wallet-a",
      publicKey: "new-pubkey",
      authIdx: 3,
      expiresAt: nowSeconds + 120,
      createdAt: nowSeconds + 1,
    });

    expect(await store.list()).toEqual([
      expect.objectContaining({
        id: "wallet-b",
        walletAddress: "wallet-b",
      }),
      expect.objectContaining({
        id: "new-wallet-a",
        walletAddress: "wallet-a",
        publicKey: "new-pubkey",
        authIdx: 3,
      }),
    ]);
    expect(await store.get("old-wallet-a")).toBeNull();
  });

  it("accepts exactly one of durationSeconds or expiresAt", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    expect(resolveSessionExpirySeconds({ durationSeconds: 30 })).toBe(nowSeconds + 30);
    expect(resolveSessionExpirySeconds({ expiresAt: String(nowSeconds + 45) })).toBe(
      nowSeconds + 45,
    );
    expect(() => resolveSessionExpirySeconds({})).toThrow(
      "Provide exactly one of durationSeconds or expiresAt",
    );
    expect(() =>
      resolveSessionExpirySeconds({ durationSeconds: 1, expiresAt: nowSeconds + 1 }),
    ).toThrow("Provide exactly one of durationSeconds or expiresAt");
  });

  it("rejects invalid signing session wallet account indexes", () => {
    expect(() => assertSigningSessionWalletAccountIdx(2)).not.toThrow();
    expect(() => assertSigningSessionWalletAccountIdx(0)).toThrow(
      "walletAccountIdx must be an account index between 2 and 65535",
    );
    expect(() => assertSigningSessionWalletAccountIdx(1.5)).toThrow(
      "walletAccountIdx must be an account index between 2 and 65535",
    );
    expect(() => assertSigningSessionWalletAccountIdx(0x10000)).toThrow(
      "walletAccountIdx must be an account index between 2 and 65535",
    );
  });
});
