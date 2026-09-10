import type { TelemetryClient } from "./telemetry";

/**
 * Persistent storage used by the SDK for non-secret app-local state.
 *
 * Browser integrations normally use localStorage. Native integrations inject
 * a SecureStore-compatible adapter. Wallet approvals and private signing keys
 * never use this interface.
 */
export interface WalletSDKStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

/** Shared browser/native names; v2 intentionally does not read old defaults. */
export function resolveWalletSDKStorageKey(params: {
  kind: "connection-hint" | "signing-sessions";
  walletOrigin: string;
  appOrigin: string;
  storageKey?: string;
}): string {
  if (params.storageKey) return params.storageKey;
  const hex = (value: string) =>
    Array.from(new TextEncoder().encode(value), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  return `thru.wallet.${params.kind}.v2.${hex(params.walletOrigin)}.${hex(params.appOrigin)}`;
}

export type WalletSDKStorageOperation = keyof WalletSDKStorage;
export type WalletSDKStorageCategory =
  "connection-hint" | "signing-sessions" | "connection";

/** Values and keys are deliberately excluded from diagnostic fields. */
export class WalletSDKStorageError extends Error {
  readonly code = "SDK_STORAGE_ERROR";
  readonly cause: unknown;
  readonly causeName: string;
  walletOperationCompleted = false;

  constructor(
    readonly operation: WalletSDKStorageOperation,
    readonly category: WalletSDKStorageCategory,
    cause: unknown,
  ) {
    super(`Wallet SDK storage ${operation} failed`);
    this.name = "WalletSDKStorageError";
    // Only standard exception names may enter telemetry. Custom adapter names
    // and messages can contain stored values; the complete cause stays local.
    const name =
      cause && typeof cause === "object"
        ? (cause as { name?: unknown }).name
        : undefined;
    this.causeName =
      typeof name === "string" &&
      [
        "Error",
        "TypeError",
        "SecurityError",
        "QuotaExceededError",
        "InvalidStateError",
        "NotAllowedError",
      ].includes(name)
        ? name
        : "UnknownStorageError";
    // Preserve the original cause for debugging, but not JSON logging.
    Object.defineProperty(this, "cause", { value: cause, enumerable: false });
  }
}

export function withWalletSDKStorageErrors(
  storage: WalletSDKStorage,
  category: WalletSDKStorageCategory,
  telemetry?: Pick<TelemetryClient, "record">,
): WalletSDKStorage {
  async function run<T>(
    operation: WalletSDKStorageOperation,
    action: () => T | Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (cause) {
      const error = new WalletSDKStorageError(operation, category, cause);
      // Adapter error messages can contain stored values. Never log raw causes.
      try {
        console.warn("[WalletSDK] Storage operation failed", {
          code: error.code,
          operation,
          category,
          causeName: error.causeName,
        });
        telemetry?.record("sdk.storage_failed", {
          severity: "error",
          operation: `storage.${category}.${operation}`,
          outcome: "error",
          errorCode: error.code,
          message: `${error.message}; cause: ${error.causeName}`,
        });
      } catch {
        // Diagnostics must never replace the original storage failure.
      }
      throw error;
    }
  }
  return {
    getItem: (key) => run("getItem", () => storage.getItem(key)),
    setItem: (key, value) => run("setItem", () => storage.setItem(key, value)),
    removeItem: (key) => run("removeItem", () => storage.removeItem(key)),
  };
}

export function getDefaultBrowserWalletSDKStorage(): WalletSDKStorage | null {
  if (typeof window === "undefined") return null;
  // Access lazily so denied localStorage access reaches the same typed error
  // reporting path as getItem/setItem failures, rather than silently disabling it.
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
}
