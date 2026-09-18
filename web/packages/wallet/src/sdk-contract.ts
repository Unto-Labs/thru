import type {
  ConnectResult,
  IThruChain,
  ThruSigningSession,
  WalletAccount,
} from "./interfaces";
import type {
  ConnectMetadataInput,
  ConnectRequestPayload,
  ManageAccountsResult,
  WalletTheme,
  WalletThemePreference,
} from "./protocol";
import type { DepositsApi } from "./deposit";
import type {
  ThruSigningSessionCreateOptions,
  ThruSigningSessionRenewOptions,
} from "./interfaces";
import type { WalletAvailability } from "./connection-state";

export interface WalletConnectOptions {
  metadata?: ConnectMetadataInput;
  preferredAccountAddress?: string;
  intent?: ConnectRequestPayload["intent"];
  /** Custom name for a passkey created during this connect flow. */
  passkeyName?: string;
}

export interface ConnectionApi {
  connect(options?: WalletConnectOptions): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  getState(): WalletAvailability;
  refresh(options?: WalletConnectOptions): Promise<WalletAvailability>;
}

export interface AccountsApi {
  getSelected(): WalletAccount | null;
  select(address: string): Promise<WalletAccount>;
  manage(): Promise<ManageAccountsResult>;
}

export interface SigningSessionsApi {
  create(options: ThruSigningSessionCreateOptions): Promise<ThruSigningSession>;
  renewSession(
    options: ThruSigningSessionRenewOptions,
  ): Promise<ThruSigningSession>;
  get(id: string): Promise<ThruSigningSession | null>;
  list(): Promise<ThruSigningSession[]>;
  getActive(walletAddress?: string): Promise<ThruSigningSession | null>;
  revoke(id: string): Promise<void>;
}

export interface WalletSDK {
  initialize(): Promise<void>;
  readonly connection: ConnectionApi;
  readonly accounts: AccountsApi;
  readonly sessions: SigningSessionsApi;
  readonly deposits: DepositsApi;
  readonly thru: IThruChain;
  /** The resolved color scheme the wallet's surfaces draw for. */
  getTheme(): WalletTheme;
  /** The scheme the host asked for, which may be `system`. */
  getThemePreference(): WalletThemePreference;
  /** Restyle the wallet's open and future surfaces in place, without a reload. */
  setTheme(theme: WalletThemePreference): void;
  destroy(): void;
}
