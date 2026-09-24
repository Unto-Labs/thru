import {
  normalizeWalletAccountResult,
  type AppMetadata,
  type ConnectResult,
  type WalletAccount,
} from "./interfaces";
import type { GetConnectionStateResult } from "./protocol";
import {
  isWalletRestoreRecordShape,
  type WalletRestoreRecord,
} from "./protocol/connectionRestore";
import {
  getDefaultBrowserWalletSDKStorage,
  resolveWalletSDKStorageKey,
  withWalletSDKStorageErrors,
  WalletSDKStorageError,
  type WalletSDKStorage,
} from "./storage";
import type { TelemetryClient } from "./telemetry";
import type { ResolvedWalletNetwork } from "./networks";

export type WalletAvailabilityStatus =
  "checking" | "connected" | "disconnected" | "error";

export interface WalletAvailability {
  network?: ResolvedWalletNetwork;
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
    ...(result.network ? { network: result.network } : {}),
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
    ...(state.network ? { network: state.network } : {}),
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
    ...(previous?.network ? { network: previous.network } : {}),
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
    ...(availability.network ? { network: availability.network } : {}),
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
  /**
   * The wallet's restore record for this address, if it issued one. Opaque
   * to the SDK; sent back to the wallet so it can rebuild an authorization
   * its own storage lost. See protocol/connectionRestore.ts.
   */
  restore?: WalletRestoreRecord;
}

interface StoredConnectionHint {
  version?: unknown;
  selectedAccountAddress?: unknown;
  savedAt?: unknown;
  restore?: unknown;
}

const CONNECTION_HINT_VERSION = 1;

export function resolveConnectionHintStorageKey(params: {
  walletOrigin: string;
  appOrigin: string;
  storageKey?: string;
}): string {
  return resolveWalletSDKStorageKey({ ...params, kind: "connection-hint" });
}

/** Null when the stored value is not a hint; a malformed record is dropped, the address kept. */
function parseConnectionHint(raw: string): ConnectionHint | null {
  const parsed = JSON.parse(raw) as StoredConnectionHint;
  if (
    parsed.version !== CONNECTION_HINT_VERSION ||
    typeof parsed.selectedAccountAddress !== "string" ||
    parsed.selectedAccountAddress.length === 0
  ) {
    return null;
  }
  const restore = isWalletRestoreRecordShape(parsed.restore) ? parsed.restore : undefined;
  return {
    version: CONNECTION_HINT_VERSION,
    selectedAccountAddress: parsed.selectedAccountAddress,
    savedAt:
      typeof parsed.savedAt === "string"
        ? parsed.savedAt
        : new Date(0).toISOString(),
    ...(restore ? { restore } : {}),
  };
}

export class ConnectionHintStore {
  private readonly storage: ConnectionStorage;
  /** The adapter as given, for the synchronous peek. */
  private readonly rawStorage: ConnectionStorage;
  constructor(
    storage: ConnectionStorage,
    private readonly key: string,
    telemetry?: Pick<TelemetryClient, "record">,
  ) {
    this.rawStorage = storage;
    this.storage = withWalletSDKStorageErrors(storage, "connection-hint", telemetry);
  }

  async read(): Promise<ConnectionHint | null> {
    const scope = this.storage.networkScope?.();
    const raw = await this.storage.getItem(this.key);
    if (scope !== this.storage.networkScope?.())
      throw Object.assign(new Error("Wallet network changed; reconnect."), {
        code: "NETWORK_CHANGED",
      });
    if (!raw) return null;

    try {
      const hint = parseConnectionHint(raw);
      if (!hint) {
        await this.storage.removeItem(this.key);
        return null;
      }
      return hint;
    } catch (error) {
      if (error instanceof WalletSDKStorageError) throw error;
      await this.storage.removeItem(this.key);
      return null;
    }
  }

  /**
   * The hint without waiting: whether a launch has something to restore,
   * before the wallet has answered. Null for an adapter that cannot answer
   * synchronously (a native SecureStore) and on any failure; never writes.
   */
  peek(): ConnectionHint | null {
    try {
      const raw = this.rawStorage.getItem(this.key);
      if (typeof raw !== "string" || raw.length === 0) return null;
      return parseConnectionHint(raw);
    } catch {
      return null;
    }
  }

  /**
   * Remember the selected address. `restore` replaces the wallet's record;
   * `null` drops it; leaving it out keeps the stored record only while it
   * is for the same address, so a switch never restores the wrong account.
   */
  async write(params: {
    selectedAccountAddress: string;
    restore?: WalletRestoreRecord | null;
  }): Promise<void> {
    let restore: WalletRestoreRecord | undefined;
    if (params.restore) {
      restore = params.restore;
    } else if (params.restore === undefined) {
      const previous = await this.read();
      restore =
        previous?.restore &&
        previous.restore.account.publicKey === params.selectedAccountAddress
          ? previous.restore
          : undefined;
    }
    const hint: ConnectionHint = {
      version: CONNECTION_HINT_VERSION,
      selectedAccountAddress: params.selectedAccountAddress,
      savedAt: new Date().toISOString(),
      ...(restore ? { restore } : {}),
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
