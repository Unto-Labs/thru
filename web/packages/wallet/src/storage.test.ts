import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionHintStore,
  resolveConnectionHintStorageKey,
} from "./connection-state";
import {
  SigningSessionDescriptorStore,
  resolveSigningSessionStorageKey,
} from "./signing-sessions";
import {
  WalletSDKStorageError,
  withWalletSDKStorageErrors,
  getDefaultBrowserWalletSDKStorage,
  type WalletSDKStorage,
} from "./storage";
import { SecureStoreTestStorage } from "./test-utils/secure-store";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  ["account", resolveConnectionHintStorageKey],
  ["session", resolveSigningSessionStorageKey],
] as const)("%s storage names", (_name, resolveKey) => {
  it("encodes origins as UTF-8 hex with no collisions or forbidden characters", () => {
    const origins = [
      "https://wallet.example:3010",
      "https://wallet.example",
      "thru-mobile://app",
      "https://é.example",
      "https://e.example",
      "a.b",
      "a_b",
      "",
      "!%:/()",
    ];
    const keys = origins.flatMap((walletOrigin) =>
      origins.map((appOrigin) => resolveKey({ walletOrigin, appOrigin })),
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(resolveKey({ walletOrigin: "é", appOrigin: "😀" })).toMatch(
      /\.v2\.c3a9\.f09f9880$/,
    );
  });

  it("preserves explicit overrides without encoding or migration", () => {
    expect(
      resolveKey({
        walletOrigin: "wallet",
        appOrigin: "app",
        storageKey: "custom:key%",
      }),
    ).toBe("custom:key%");
  });
});

it("ignores old defaults and reuses newly saved state across store instances", async () => {
  const storage = new SecureStoreTestStorage();
  const scope = {
    walletOrigin: "https://wallet.example",
    appOrigin: "thru-mobile://app",
  };
  const oldHintKey = `thru.wallet.connection-hint.v1:${encodeURIComponent(scope.walletOrigin)}:${encodeURIComponent(scope.appOrigin)}`;
  const oldSessionKey = oldHintKey.replace(
    "connection-hint",
    "signing-sessions",
  );
  storage.values.set(
    oldHintKey,
    JSON.stringify({ version: 1, selectedAccountAddress: "old-account" }),
  );
  storage.values.set(
    oldSessionKey,
    JSON.stringify({ version: 1, sessions: [{ id: "old-session" }] }),
  );
  const original = new Map(storage.values);
  const hintKey = resolveConnectionHintStorageKey(scope);
  const sessionKey = resolveSigningSessionStorageKey(scope);
  expect(hintKey).not.toBe(sessionKey);
  const hints = new ConnectionHintStore(storage, hintKey);
  const sessions = new SigningSessionDescriptorStore(storage, sessionKey);
  await expect(hints.read()).resolves.toBeNull();
  await expect(sessions.list()).resolves.toEqual([]);
  expect(storage.values).toEqual(original);
  await hints.write({ selectedAccountAddress: "account-b" });
  const descriptor = {
    id: "replacement",
    walletAddress: "account-b",
    publicKey: "public",
    authIdx: 2,
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  };
  await sessions.save(descriptor);
  await expect(
    new ConnectionHintStore(storage, hintKey).read(),
  ).resolves.toMatchObject({ selectedAccountAddress: "account-b" });
  await expect(
    new SigningSessionDescriptorStore(storage, sessionKey).getActive(
      "account-b",
    ),
  ).resolves.toEqual(descriptor);
});

describe.each(["getItem", "setItem", "removeItem"] as const)(
  "%s failures",
  (operation) => {
    it.each([false, true])(
      "preserves the cause and reports only safe fields (async=%s)",
      async (asyncFailure) => {
        const cause = new Error("secret stored value must not reach logs");
        const storage: WalletSDKStorage = new SecureStoreTestStorage();
        storage[operation] = (() => {
          if (asyncFailure) return Promise.reject(cause);
          throw cause;
        }) as never;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const record = vi.fn();
        const adapter = withWalletSDKStorageErrors(
          storage,
          "signing-sessions",
          { record },
        );
        const error = await Promise.resolve(
          adapter[operation]("key", "value"),
        ).catch((error) => error);
        expect(error).toBeInstanceOf(WalletSDKStorageError);
        expect(error).toMatchObject({
          code: "SDK_STORAGE_ERROR",
          operation,
          category: "signing-sessions",
          cause,
        });
        expect(error.cause).toBe(cause);
        expect(record).toHaveBeenCalledWith(
          "sdk.storage_failed",
          expect.objectContaining({
            errorCode: "SDK_STORAGE_ERROR",
            operation: `storage.signing-sessions.${operation}`,
          }),
        );
        expect(
          JSON.stringify([warn.mock.calls, record.mock.calls, error]),
        ).not.toContain(cause.message);
      },
    );
  },
);

it("does not retry failed corruption cleanup or disguise it as empty storage", async () => {
  const storage = new SecureStoreTestStorage();
  storage.setItem("hint", "null");
  const remove = vi.spyOn(storage, "removeItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(
    new ConnectionHintStore(storage, "hint").read(),
  ).rejects.toMatchObject({
    code: "SDK_STORAGE_ERROR",
    operation: "removeItem",
  });
  expect(remove).toHaveBeenCalledTimes(1);
});

it("reports blocked browser localStorage through the same error contract", async () => {
  const cause = new Error("Browser storage denied");
  vi.stubGlobal("window", {
    get localStorage() {
      throw cause;
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const storage = getDefaultBrowserWalletSDKStorage();
  expect(storage).not.toBeNull();
  await expect(
    new ConnectionHintStore(storage!, "hint").read(),
  ).rejects.toMatchObject({
    code: "SDK_STORAGE_ERROR",
    operation: "getItem",
    cause,
  });
});
