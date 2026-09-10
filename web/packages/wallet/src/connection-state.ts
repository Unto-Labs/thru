import {
  normalizeWalletAccountResult,
  type AppMetadata,
  type ConnectResult,
  type WalletAccount,
} from "./interfaces";
import type { GetConnectionStateResult } from "./protocol";
import {
  getDefaultBrowserWalletSDKStorage,
  resolveWalletSDKStorageKey,
  withWalletSDKStorageErrors,
  WalletSDKStorageError,
  type WalletSDKStorage,
} from "./storage";
import type { TelemetryClient } from "./telemetry";

export type WalletAvailabilityStatus =
  "checking" | "connected" | "disconnected" | "error";

export interface WalletAvailability {
  status: WalletAvailabilityStatus;
  isConnected: boolean;
  hasPasskey: boolean;
  hasWalletAccount: boolean;
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
  metadata: AppMetadata | null;
  error: Error | null;
}

export const CHECKING_WALLET_AVAILABILITY: WalletAvailability = {
  status: "checking",
  isConnected: false,
  hasPasskey: false,
  hasWalletAccount: false,
  accounts: [],
  selectedAccount: null,
  metadata: null,
  error: null,
};

export function walletAvailabilityFromConnectResult(
  result: ConnectResult,
  selectedAccount?: WalletAccount | null,
): WalletAvailability {
  const active = normalizeWalletAccountResult(result, selectedAccount ?? null);
  const isConnected = active.accounts.length > 0 && !!active.selectedAccount;
  return {
    status: isConnected ? "connected" : "disconnected",
    isConnected,
    hasPasskey: isConnected,
    hasWalletAccount: isConnected,
    accounts: active.accounts,
    selectedAccount: active.selectedAccount,
    metadata: isConnected ? (result.metadata ?? null) : null,
    error: null,
  };
}

export function walletAvailabilityFromConnectionState(
  state: GetConnectionStateResult,
): WalletAvailability {
  const active = normalizeWalletAccountResult(state);
  const hasWalletAccount = state.hasWalletAccount ?? active.accounts.length > 0;
  const isConnected = active.accounts.length > 0 && !!active.selectedAccount;
  return {
    status: isConnected ? "connected" : "disconnected",
    isConnected,
    hasPasskey: state.hasPasskey,
    hasWalletAccount,
    accounts: isConnected ? active.accounts : [],
    selectedAccount: isConnected ? active.selectedAccount : null,
    metadata: isConnected ? state.metadata : null,
    error: null,
  };
}

export function walletAvailabilityFromError(
  error: unknown,
): WalletAvailability {
  return {
    status: "error",
    isConnected: false,
    hasPasskey: false,
    hasWalletAccount: false,
    accounts: [],
    selectedAccount: null,
    metadata: null,
    error:
      error instanceof Error
        ? error
        : new Error("Wallet availability check failed"),
  };
}

export function disconnectedWalletAvailability(
  previous?: WalletAvailability,
): WalletAvailability {
  return {
    status: "disconnected",
    isConnected: false,
    hasPasskey: previous?.hasPasskey ?? false,
    hasWalletAccount: previous?.hasWalletAccount ?? false,
    accounts: [],
    selectedAccount: null,
    metadata: null,
    error: null,
  };
}

export function connectionResultFromState(
  state: GetConnectionStateResult,
): ConnectResult | null {
  const availability = walletAvailabilityFromConnectionState(state);
  if (availability.status !== "connected") return null;
  return {
    accounts: availability.accounts,
    selectedAccount: availability.selectedAccount,
    status: "completed",
    metadata: availability.metadata ?? undefined,
  };
}

/** @deprecated Use WalletSDKStorage. */
export type ConnectionStorage = WalletSDKStorage;

export interface ConnectionHint {
  version: 1;
  selectedAccountAddress: string;
  savedAt: string;
}

interface StoredConnectionHint {
  version?: unknown;
  selectedAccountAddress?: unknown;
  savedAt?: unknown;
}

const CONNECTION_HINT_VERSION = 1;

export function resolveConnectionHintStorageKey(params: {
  walletOrigin: string;
  appOrigin: string;
  storageKey?: string;
}): string {
  return resolveWalletSDKStorageKey({ ...params, kind: "connection-hint" });
}

export class ConnectionHintStore {
  private readonly storage: ConnectionStorage;
  constructor(
    storage: ConnectionStorage,
    private readonly key: string,
    telemetry?: Pick<TelemetryClient, "record">,
  ) {
    this.storage = withWalletSDKStorageErrors(storage, "connection-hint", telemetry);
  }

  async read(): Promise<ConnectionHint | null> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as StoredConnectionHint;
      if (
        parsed.version !== CONNECTION_HINT_VERSION ||
        typeof parsed.selectedAccountAddress !== "string" ||
        parsed.selectedAccountAddress.length === 0
      ) {
        await this.storage.removeItem(this.key);
        return null;
      }

      return {
        version: CONNECTION_HINT_VERSION,
        selectedAccountAddress: parsed.selectedAccountAddress,
        savedAt:
          typeof parsed.savedAt === "string"
            ? parsed.savedAt
            : new Date(0).toISOString(),
      };
    } catch (error) {
      if (error instanceof WalletSDKStorageError) throw error;
      await this.storage.removeItem(this.key);
      return null;
    }
  }

  async write(params: { selectedAccountAddress: string }): Promise<void> {
    const hint: ConnectionHint = {
      version: CONNECTION_HINT_VERSION,
      selectedAccountAddress: params.selectedAccountAddress,
      savedAt: new Date().toISOString(),
    };
    await this.storage.setItem(this.key, JSON.stringify(hint));
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.key);
  }
}

export function getDefaultBrowserConnectionStorage(): ConnectionStorage | null {
  return getDefaultBrowserWalletSDKStorage();
}
