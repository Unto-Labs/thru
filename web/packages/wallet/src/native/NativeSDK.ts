import { TELEMETRY_EVENTS } from "../observability";
import { getErrorCode, getErrorMessage } from "../internal/telemetry-fields";
import {
  AddressType,
  type AppMetadata,
  type AddressType as AddressTypeValue,
  type ConnectResult,
  type IThruChain,
  type ThruSigningSessionCreateOptions,
  type ThruSigningSessionDescriptor,
  type WalletAccount,
  normalizeActiveWalletAccounts,
  normalizeWalletAccountResult,
} from "../interfaces";
import {
  EMBEDDED_PROVIDER_EVENTS,
  DepositTarget,
  ErrorCode,
  sanitizePasskeyName,
  type ConnectMetadataInput,
  type ConnectRequestPayload,
  type CreateAccountResult,
  type DepositDestination,
  type DepositRequestPayload,
  type DepositResult,
  type DepositUiConfig,
  type GetConnectionStateResult,
  type ManageAccountsResult,
  type PrepareDepositPayload,
  type SigningSessionDescriptorPayload,
  type ThruNetwork,
  normalizeConnectionStateResult,
} from "../protocol";
import {
  createPreparedDepositSnapshot,
  ensureDepositAccountForWallet,
  formatDepositAmount,
  getReusablePreparedDepositDestination,
  getDepositAccountStateForWallet,
  getValidatedDepositDestination,
  signDepositTransactionWithActiveSession,
  waitForDepositBalanceForWallet,
  type DepositAccountState,
  type DepositsApi,
  type EnsureDepositAccountParams,
  type GetDepositAccountStateParams,
  type PreparedDepositSnapshot,
  type SignDepositTransactionPayload,
  type WaitForDepositBalanceParams,
} from "../deposit";
import { NativeProvider } from "./provider/NativeProvider";
import type {
  WebViewMessageEventLike,
  WebViewRefLike,
} from "./provider/WebViewBridge";
import type { Thru } from "@thru/sdk/client";
import {
  SigningSessionDescriptorStore,
  resolveSigningSessionStorageKey,
} from "../signing-sessions";
import { createNativeThruClient } from "./rpc";
import {
  type TransactionSigningScheme,
  withTransactionSigningScheme,
} from "../transaction-signing-scheme";
import {
  TelemetryClient,
  WALLET_SDK_VERSION,
  createTelemetrySessionId,
  type TelemetryAppContext,
} from "../telemetry";

export type IosWebViewMode = "direct" | "shell-iframe";
export type NativeWalletExperience = "standard" | "transparent";

export type WalletAvailability =
  | {
      status: "checking";
      isAuthorized: false;
      isConnected: false;
      isUnlocked: false;
      hasPasskey: false;
      hasWalletAccount: false;
      accounts: WalletAccount[];
      selectedAccount: null;
      metadata: null;
      error: null;
    }
  | {
      status: "ready";
      isAuthorized: boolean;
      isConnected: boolean;
      isUnlocked: boolean;
      hasPasskey: boolean;
      hasWalletAccount: boolean;
      accounts: WalletAccount[];
      selectedAccount: WalletAccount | null;
      metadata: AppMetadata | null;
      error: null;
    }
  | {
      status: "error";
      isAuthorized: false;
      isConnected: false;
      isUnlocked: false;
      hasPasskey: false;
      hasWalletAccount: false;
      accounts: WalletAccount[];
      selectedAccount: null;
      metadata: null;
      error: Error;
    };

export interface NativeSDKConfig {
  walletUrl?: string;
  /** Share privacy-safe operational diagnostics with Thru. Default: true. */
  telemetryEnabled?: boolean;
  /** Opaque host-app-provided label stamped on telemetry for cross-session
      correlation (e.g. the app's own user or install ID). Never minted or
      interpreted by the SDK. */
  appContextId?: string;
  /** Bounded host-app-provided dimensions stamped on telemetry events
      (at most 5 short keys/values). Never interpreted by the SDK. */
  appContext?: TelemetryAppContext;
  /** Wallet presentation loaded in the native WebView. Transparent mode
      signs in without opening the native wallet sheet. */
  walletExperience?: NativeWalletExperience;
  /** Stamped on every postMessage so wallet's ConnectedAppsStorage can
      scope per-host. Default: 'thru-mobile://app'. */
  origin?: string;
  /** Default app metadata used for connection and transparent hydration. */
  metadata?: ConnectMetadataInput;
  rpcUrl?: string;
  network?: ThruNetwork;
  depositUiConfig?: DepositUiConfig;
  addressTypes?: AddressTypeValue[];
  /** iOS-only host mode. Shell iframe is the default; direct is kept
      as an escape hatch for real-device passkey/WebAuthn comparisons. */
  iosWebViewMode?: IosWebViewMode;
  /** Optional host-provided persistent storage (SecureStore,
      AsyncStorage, localStorage-compatible adapter, etc.). */
  storage?: NativeSDKStorage;
  /** Override the legacy connection snapshot key cleared from `storage`. */
  storageKey?: string;
  /** Override the key used to remember the app-local selected account. */
  selectedAccountStorageKey?: string;
  /** Override the key used for app-local signing session descriptors. */
  signingSessionStorageKey?: string;
  transactionSigningScheme?: TransactionSigningScheme;
  deposits?: {
    providers: string[];
  };
}

export interface SignInOptions {
  app_id: string;
  app_display_name: string;
  app_url?: string;
  image_url?: string;
  intent?: ConnectOptions["intent"];
}

export interface ConnectOptions {
  metadata?: ConnectMetadataInput;
  preferredAccountAddress?: string;
  intent?: ConnectRequestPayload["intent"];
  /** Custom name for a passkey created during this connect flow. */
  passkeyName?: string;
}

export interface CreateAccountOptions {
  accountName?: string;
  /** Custom name for the passkey created for this account. */
  passkeyName?: string;
  metadata?: ConnectMetadataInput;
  createSigningSession?: Omit<
    ThruSigningSessionCreateOptions,
    "walletAddress" | "review"
  >;
}

export interface RestoreConnectionOptions {
  hydrate?: boolean;
}

export type SDKEvent =
  | "connect"
  | "disconnect"
  | "lock"
  | "error"
  | "accountChanged"
  | "availabilityChanged";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventCallback = (...args: any[]) => void;

export interface NativeSDKStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export interface NativeSDKUiHandlers {
  onShowRequested?: (reason?: string) => void;
  onHideRequested?: (reason?: string) => void;
}

const DEFAULT_STORAGE_KEY = "thru.native-sdk.connection.v1";
const SELECTED_ACCOUNT_STORAGE_KEY_SUFFIX = ".selected-account.v1";
const SIGNING_SESSION_STORAGE_KEY_SUFFIX = ".signing-sessions.v1";
const DEFAULT_NATIVE_WALLET_URL = "https://app.tid.sh/embedded/native";
const DEFAULT_TRANSPARENT_WALLET_URL =
  "https://app.tid.sh/embedded/native/transparent";

const CHECKING_WALLET_AVAILABILITY: WalletAvailability = {
  status: "checking",
  isAuthorized: false,
  isConnected: false,
  isUnlocked: false,
  hasPasskey: false,
  hasWalletAccount: false,
  accounts: [],
  selectedAccount: null,
  metadata: null,
  error: null,
};

function completeAppMetadata(
  metadata: ConnectMetadataInput | AppMetadata | null | undefined,
): AppMetadata | undefined {
  if (!metadata?.appId || !metadata.appName || !metadata.appUrl) {
    return undefined;
  }
  return {
    appId: metadata.appId,
    appName: metadata.appName,
    appUrl: metadata.appUrl,
    ...(metadata.imageUrl ? { imageUrl: metadata.imageUrl } : {}),
  };
}

function signingSessionDescriptorFromWire(
  session: SigningSessionDescriptorPayload,
): ThruSigningSessionDescriptor {
  return {
    id: session.id,
    walletAddress: session.walletAddress,
    publicKey: session.publicKey,
    authIdx: session.authIdx,
    expiresAt: Number(BigInt(session.expiresAt)),
    createdAt: Number(BigInt(session.createdAt)),
  };
}

interface PersistedSelectedAccountSnapshot {
  version: 1;
  origin: string;
  walletOrigin: string;
  savedAt: string;
  selectedAccountAddress: string;
}

/**
 * NativeSDK - mobile mirror of `@thru/wallet`'s `BrowserSDK`.
 * Public surface matches verbatim except `mountInline(HTMLElement)` is
 * replaced by `attachWebView(WebViewRefLike)` since the host bottom
 * sheet owns the WebView lifecycle.
 */
export class NativeSDK {
  private provider: NativeProvider;
  private eventListeners = new Map<SDKEvent, Set<EventCallback>>();
  private initialized = false;
  private thruClient: Thru | null = null;
  private rpcUrl: string | undefined;
  private connectInFlight: Promise<ConnectResult> | null = null;
  private lastConnectResult: ConnectResult | null = null;
  private walletAvailability: WalletAvailability = CHECKING_WALLET_AVAILABILITY;
  private readonly origin: string;
  private readonly storage?: NativeSDKStorage;
  private readonly storageKey: string;
  private readonly selectedAccountStorageKey: string;
  private readonly iosWebViewMode: IosWebViewMode;
  private readonly walletExperience: NativeWalletExperience;
  private readonly defaultMetadata?: ConnectMetadataInput;
  private readonly defaultNetwork?: ThruNetwork;
  private readonly depositProviders: ReadonlySet<string>;
  private readonly signingSessions?: SigningSessionDescriptorStore;
  private readonly telemetry: TelemetryClient;
  private readonly preparedDepositSnapshots = new WeakMap<
    DepositDestination,
    PreparedDepositSnapshot
  >();

  readonly deposits: DepositsApi = {
    prepare: (targetOrPayload) => this.prepareDeposit(targetOrPayload),
    ensureAccount: (params) => this.ensureDepositAccount(params),
    open: (payload) => this.deposit(payload),
    getProviders: async () => [...this.depositProviders],
    getAccountState: (params) => this.getDepositAccountState(params),
    waitForBalance: (params) => this.waitForDepositBalance(params),
    formatAmount: (amountRaw, destination) =>
      this.formatDepositAmount(amountRaw, destination),
  };

  constructor(config: NativeSDKConfig = {}) {
    this.origin = config.origin ?? "thru-mobile://app";
    this.rpcUrl = config.rpcUrl;
    this.storage = config.storage;
    this.storageKey = config.storageKey ?? DEFAULT_STORAGE_KEY;
    this.selectedAccountStorageKey =
      config.selectedAccountStorageKey ??
      `${this.storageKey}${SELECTED_ACCOUNT_STORAGE_KEY_SUFFIX}`;
    this.iosWebViewMode = config.iosWebViewMode ?? "shell-iframe";
    this.walletExperience = config.walletExperience ?? "standard";
    this.defaultMetadata = config.metadata;
    this.defaultNetwork = config.network;
    this.depositProviders = new Set(config.deposits?.providers ?? ['unifold']);
    const walletUrl = withTransactionSigningScheme(
      config.walletUrl ??
        (this.walletExperience === "transparent"
          ? DEFAULT_TRANSPARENT_WALLET_URL
          : DEFAULT_NATIVE_WALLET_URL),
      config.transactionSigningScheme,
    );
    const telemetrySessionId = createTelemetrySessionId();
    this.telemetry = new TelemetryClient({
      enabled: config.telemetryEnabled ?? true,
      walletUrl,
      sessionId: telemetrySessionId,
      appContextId: config.appContextId,
      appContext: config.appContext,
      source: "sdk",
      context: {
        appOrigin: this.origin,
        sdkVersion: WALLET_SDK_VERSION,
        platform: "react-native",
        ...(config.network ? { network: config.network } : {}),
      },
    });
    const walletOrigin = new URL(walletUrl).origin;
    const signingSessions = this.storage
      ? new SigningSessionDescriptorStore(
          this.storage,
          resolveSigningSessionStorageKey({
            walletOrigin,
            appOrigin: this.origin,
            storageKey:
              config.signingSessionStorageKey ??
              `${this.storageKey}${SIGNING_SESSION_STORAGE_KEY_SUFFIX}`,
          }),
        )
      : undefined;
    this.signingSessions = signingSessions;
    try {
      this.provider = new NativeProvider({
        walletUrl,
        telemetryEnabled: config.telemetryEnabled ?? true,
        telemetrySessionId,
        telemetryAppContextId: this.telemetry.getAppContextId(),
        telemetryContext: this.telemetry.getContext(),
        telemetry: (event, fields) =>
          this.telemetry.record(event, { ...fields, source: "bridge" }),
        origin: this.origin,
        metadata: this.defaultMetadata
          ? this.resolveMetadata(this.defaultMetadata)
          : undefined,
        addressTypes: config.addressTypes ?? [AddressType.THRU],
        signingSessions,
        walletExperience: this.walletExperience,
        network: config.network,
        depositUiConfig: config.depositUiConfig,
      });
    } catch (error) {
      this.telemetry.discard();
      throw error;
    }
    this.setupEventForwarding();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_CONSTRUCTED, {
      severity: "info",
      outcome: "created",
      operation: this.walletExperience,
    });
  }

  /**
   * Set or clear the opaque host-app correlation label. Applies to later
   * events from this SDK instance and from the wallet WebView, including one
   * already loaded.
   */
  setAppContextId(appContextId: string | null): void {
    this.telemetry.setAppContextId(appContextId);
    this.provider.setTelemetryAppContextId(
      this.telemetry.getAppContextId() ?? null,
    );
  }

  /**
   * Replace or clear the host-app dimensions. Applies to later events from
   * this SDK instance and from the wallet WebView, including one already
   * loaded.
   */
  setContext(context: TelemetryAppContext | null): void {
    this.telemetry.setContext(context);
    this.provider.setTelemetryContext(this.telemetry.getContext() ?? null);
  }

  /** Hand the WebView ref to the underlying provider/bridge. */
  attachWebView(ref: WebViewRefLike): void {
    this.provider.attachWebView(ref);
  }

  /** Record a wallet WebView load without collecting its URL. */
  recordWebViewLoadStarted(): void {
    this.provider.recordWebViewLoadStarted();
  }

  /** Record the WebView's load-end callback. */
  recordWebViewLoadEnded(): void {
    this.provider.recordWebViewLoadEnded();
  }

  /** Record a native WebView transport error through telemetry sanitization. */
  recordWebViewTransportError(
    code: number | undefined,
    description: string,
  ): void {
    this.provider.recordWebViewTransportError(code, description);
  }

  /** Record a WebView HTTP error without collecting its URL. */
  recordWebViewHttpError(statusCode: number): void {
    this.provider.recordWebViewHttpError(statusCode);
  }

  /** Record an iOS WebKit content-process termination. */
  recordWebViewContentProcessTerminated(): void {
    this.provider.recordWebViewContentProcessTerminated();
  }

  /** Mark a direct top-level WebView wallet document as ready. */
  markWebViewReady(): void {
    this.provider.markWebViewReady();
  }

  /** Bind to the WebView's `onMessage` handler. */
  onMessage = (event: WebViewMessageEventLike): void => {
    this.provider.onMessage(event);
  };

  /** Build the URL to load inside the shell <iframe>. */
  getIframeSrc(): string {
    return this.provider.getIframeSrc();
  }

  /** Wallet origin (e.g. https://app.tid.sh). */
  getWalletOrigin(): string {
    return this.provider.getWalletOrigin();
  }

  /** Bind host UI lifecycle handlers used by custom WebView hosts. */
  setUiHandlers(handlers: NativeSDKUiHandlers): void {
    this.provider.onShowRequested = handlers.onShowRequested;
    this.provider.onHideRequested = handlers.onHideRequested;
  }

  clearUiHandlers(): void {
    this.provider.onShowRequested = undefined;
    this.provider.onHideRequested = undefined;
  }

  /** Reject in-flight wallet requests after a user-driven host dismiss. */
  rejectPendingRequests(message?: string): void {
    this.provider.rejectPendingRequests(message);
  }

  /** iOS WebView host mode. Non-iOS hosts should ignore this value. */
  getIosWebViewMode(): IosWebViewMode {
    return this.iosWebViewMode;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_CACHED, {
        severity: "debug",
        outcome: "already_initialized",
      });
      return;
    }
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_STARTED, {
      severity: "info",
      outcome: "started",
    });
    try {
      await this.provider.initialize();
      this.initialized = true;
      this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_COMPLETED, {
        severity: "info",
        durationMs: Date.now() - startedAt,
        outcome: "success",
      });
    } catch (error) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_FAILED, {
        severity: "error",
        durationMs: Date.now() - startedAt,
        outcome: "error",
        ...getTelemetryErrorFields(error),
      });
      throw error;
    }
  }

  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    const isAccountSwitch = options?.intent === "switch-account";
    if (this.connectInFlight) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_REUSED, {
        severity: "debug",
        outcome: "in_flight",
        operation: options?.intent ?? "default",
      });
      return this.connectInFlight;
    }
    if (
      !isAccountSwitch &&
      this.lastConnectResult &&
      this.provider.isConnected() &&
      this.walletAvailability.isUnlocked
    ) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_CACHED, {
        severity: "debug",
        outcome: "cached",
        walletAddress: this.lastConnectResult.selectedAccount?.address,
      });
      return this.lastConnectResult;
    }

    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_STARTED, {
      severity: "info",
      outcome: "started",
      operation: options?.intent ?? "default",
    });
    this.emit("connect", { status: "connecting" });

    const inFlight = (async () => {
      try {
        if (!this.initialized) await this.initialize();

        const metadata = this.resolveMetadata(options?.metadata);
        const preferredAccountAddress = isAccountSwitch
          ? null
          : (options?.preferredAccountAddress ??
            (await this.readSelectedAccountAddress()));
        const passkeyName = sanitizePasskeyName(options?.passkeyName);
        const providerOptions =
          metadata || preferredAccountAddress || options?.intent || passkeyName
            ? {
                ...(metadata ? { metadata } : {}),
                ...(preferredAccountAddress ? { preferredAccountAddress } : {}),
                ...(options?.intent ? { intent: options.intent } : {}),
                ...(passkeyName ? { passkeyName } : {}),
              }
            : undefined;
        const result = await this.provider.connect(providerOptions);
        if (!isAccountSwitch) {
          await this.applyPreferredSelectedAccount(result.accounts);
        }
        const selectedAccount =
          this.provider.getSelectedAccount() ?? result.selectedAccount ?? null;
        const activeResult = normalizeWalletAccountResult(
          {
            ...result,
            accounts: this.provider.getAccounts(),
            selectedAccount,
          },
          selectedAccount,
        );
        this.lastConnectResult = activeResult;
        await this.persistSelectedAccountAddress(
          activeResult.selectedAccount?.address ?? null,
        );
        await this.clearPersistedConnection();
        this.setWalletAvailability(
          walletAvailabilityFromConnectResult(activeResult),
        );
        this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_COMPLETED, {
          severity: "info",
          durationMs: Date.now() - startedAt,
          outcome: "success",
          operation: options?.intent ?? "default",
          walletAddress: activeResult.selectedAccount?.address,
        });
        this.emit("connect", activeResult);
        return activeResult;
      } catch (error) {
        if (isUserRejectedError(error) && !isAccountSwitch) {
          this.provider.clearConnection();
          this.lastConnectResult = null;
          await this.clearPersistedConnection();
          this.clearAuthorizedAvailability();
          this.emit("disconnect", { reason: "user_rejected" });
        }
        this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_FAILED, {
          severity: isUserRejectedError(error) ? "warn" : "error",
          durationMs: Date.now() - startedAt,
          outcome: isUserRejectedError(error) ? "user_rejected" : "error",
          operation: options?.intent ?? "default",
          ...getTelemetryErrorFields(error),
        });
        this.emit("error", error);
        throw error;
      } finally {
        this.connectInFlight = null;
      }
    })();

    this.connectInFlight = inFlight;
    return inFlight;
  }

  async signIn(options: SignInOptions): Promise<ConnectResult> {
    return this.connect({
      metadata: this.resolveSignInMetadata(options),
      ...(options.intent ? { intent: options.intent } : {}),
    });
  }

  async createAccount(
    options: CreateAccountOptions = {},
  ): Promise<CreateAccountResult> {
    this.emit("connect", { status: "connecting" });

    try {
      if (!this.initialized) await this.initialize();

      const metadata = this.resolveMetadata(options.metadata);
      const passkeyName = sanitizePasskeyName(options.passkeyName);
      const result = await this.provider.createAccount({
        ...(options.accountName ? { accountName: options.accountName } : {}),
        ...(passkeyName ? { passkeyName } : {}),
        ...(metadata ? { metadata } : {}),
        ...(options.createSigningSession
          ? { createSigningSession: options.createSigningSession }
          : {}),
      });
      const selectedAccount = result.selectedAccount ?? result.account;
      const activeResult: CreateAccountResult = {
        ...result,
        accounts: this.provider.getAccounts(),
        selectedAccount,
        account: selectedAccount,
      };
      const completedResult: ConnectResult = {
        accounts: activeResult.accounts,
        selectedAccount: activeResult.selectedAccount,
        status: "completed",
        metadata: completeAppMetadata(metadata),
      };
      this.lastConnectResult = completedResult;
      await this.persistSelectedAccountAddress(
        activeResult.selectedAccount.address,
      );
      if (activeResult.signingSession) {
        if (!this.signingSessions) {
          throw new Error("NativeSDKStorage is required for signing sessions");
        }
        await this.signingSessions.saveReplacingWalletSessions(
          signingSessionDescriptorFromWire(activeResult.signingSession),
        );
      }
      await this.clearPersistedConnection();
      this.setWalletAvailability(
        walletAvailabilityFromConnectResult(completedResult),
      );
      this.emit("connect", completedResult);
      this.emit("accountChanged", activeResult.selectedAccount);
      return activeResult;
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_DISCONNECT_STARTED, {
      operation: "disconnect",
      outcome: "started",
    });
    try {
      await this.provider.disconnect();
      this.emit("disconnect", {});
      this.lastConnectResult = null;
      await this.persistSelectedAccountAddress(null);
      await this.clearPersistedConnection();
      this.clearAuthorizedAvailability();
      this.telemetry.record(TELEMETRY_EVENTS.SDK_DISCONNECT_COMPLETED, {
        operation: "disconnect",
        outcome: "success",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_DISCONNECT_FAILED, {
        operation: "disconnect",
        outcome: "error",
        severity: "error",
        durationMs: Date.now() - startedAt,
        ...getTelemetryErrorFields(error),
      });
      this.emit("error", error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.provider.isConnected();
  }

  getWalletAvailability(): WalletAvailability {
    return this.walletAvailability;
  }

  async restoreConnection(
    options: RestoreConnectionOptions = {},
  ): Promise<ConnectResult | null> {
    void options;
    await this.clearPersistedConnection();
    return null;
  }

  async syncConnectionState(
    options?: ConnectOptions,
  ): Promise<GetConnectionStateResult | null> {
    try {
      const state = await this.requestConnectionState(options);
      this.setWalletAvailability(walletAvailabilityFromConnectionState(state));
      await this.applyConnectionState(state);
      return state;
    } catch (error) {
      this.setWalletAvailability(walletAvailabilityFromError(error));
      this.emit("error", error);
      return null;
    }
  }

  async refreshWalletAvailability(
    options?: ConnectOptions,
  ): Promise<WalletAvailability> {
    try {
      const state = await this.requestConnectionState(options);
      const availability = walletAvailabilityFromConnectionState(state);
      this.setWalletAvailability(availability);
      await this.applyConnectionState(state);
      return availability;
    } catch (error) {
      const availability = walletAvailabilityFromError(error);
      this.setWalletAvailability(availability);
      this.emit("error", error);
      return availability;
    }
  }

  getAccounts(): WalletAccount[] {
    const accounts = this.provider.getAccounts();
    const activeAccounts = this.refreshCachedAccounts(
      accounts,
      this.provider.getSelectedAccount(),
    );
    return activeAccounts;
  }

  getSelectedAccount(): WalletAccount | null {
    return this.provider.getSelectedAccount();
  }

  async selectAccount(publicKey: string): Promise<WalletAccount> {
    const account = await this.provider.selectAccount(publicKey);
    this.refreshCachedAccounts(this.provider.getAccounts(), account);
    await this.persistSelectedAccountAddress(account.address);
    return account;
  }

  async manageAccounts(): Promise<ManageAccountsResult> {
    if (!this.initialized) await this.initialize();
    const result = await this.provider.manageAccounts();
    const activeResult = normalizeWalletAccountResult(result);
    const selectedAccount = activeResult.selectedAccount ?? null;
    this.refreshCachedAccounts(activeResult.accounts, selectedAccount);
    await this.persistSelectedAccountAddress(selectedAccount?.address ?? null);
    if (this.lastConnectResult) {
      this.setWalletAvailability(
        walletAvailabilityFromConnectResult(this.lastConnectResult),
      );
    }
    this.emit("accountChanged", selectedAccount);
    return activeResult;
  }

  /** @deprecated Use `deposits.prepare()`. */
  async prepareDeposit(
    depositTargetOrPayload?:
      PrepareDepositPayload["depositTarget"] | PrepareDepositPayload,
  ): Promise<DepositDestination> {
    if (!this.initialized) await this.initialize();
    const payload =
      typeof depositTargetOrPayload === "string"
        ? { depositTarget: depositTargetOrPayload }
        : (depositTargetOrPayload ?? {});
    const selectedAccountBefore = this.provider.getSelectedAccount();
    const destination = await this.provider.prepareDeposit({
      ...payload,
      network: payload.network ?? this.defaultNetwork,
    });
    const selectedAccountAfter = this.provider.getSelectedAccount();
    if (
      selectedAccountBefore &&
      selectedAccountAfter?.address === selectedAccountBefore.address
    ) {
      this.preparedDepositSnapshots.set(
        destination,
        createPreparedDepositSnapshot(
          destination,
          selectedAccountAfter.address,
        ),
      );
    }
    return destination;
  }

  /**
   * Open the wallet's Deposit ("Add funds") screen for a token account.
   * Mirror of `BrowserSDK.deposit`; delegates to the provider, which shows the
   * wallet surface for the flow and tears it down afterward.
   *
   * @deprecated Use `deposits.open()`.
   */
  async deposit(payload: DepositRequestPayload): Promise<DepositResult> {
    if (!this.initialized) await this.initialize();
    const providerId = payload.providerId ?? 'unifold';
    if (!this.depositProviders.has(providerId)) {
      throw new Error(`Deposit provider is not configured: ${providerId}`);
    }
    return this.provider.deposit({ ...payload, providerId });
  }

  /** @deprecated Use `deposits.ensureAccount()`. */
  async ensureDepositAccount(
    params: EnsureDepositAccountParams = {},
  ): Promise<DepositAccountState> {
    if (!this.initialized) await this.initialize();
    const { destination, walletAddress } = await this.resolveDepositDestination(
      params.destination,
    );
    return ensureDepositAccountForWallet({
      thru: this.getThru(),
      walletAddress,
      destination,
      signTransaction: (payload) => this.signDepositTransaction(payload),
    });
  }

  /** @deprecated Use `deposits.getAccountState()`. */
  async getDepositAccountState(
    params: GetDepositAccountStateParams = {},
  ): Promise<DepositAccountState> {
    if (!this.initialized) await this.initialize();
    const { destination, walletAddress } = await this.resolveDepositDestination(
      params.destination,
    );
    return getDepositAccountStateForWallet({
      thru: this.getThru(),
      walletAddress,
      destination,
    });
  }

  /** @deprecated Use `deposits.waitForBalance()`. */
  async waitForDepositBalance(
    params: WaitForDepositBalanceParams,
  ): Promise<DepositAccountState> {
    if (!this.initialized) await this.initialize();
    const { destination, walletAddress } = await this.resolveDepositDestination(
      params.destination,
    );
    return waitForDepositBalanceForWallet({
      thru: this.getThru(),
      walletAddress,
      destination,
      minimumBalanceRaw: params.minimumBalanceRaw,
      signature: params.signature,
    });
  }

  /** @deprecated Use `deposits.formatAmount()`. */
  formatDepositAmount = formatDepositAmount;

  get thru(): IThruChain {
    return this.provider.thru;
  }

  on(event: SDKEvent, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: SDKEvent, callback: EventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  once(event: SDKEvent, callback: EventCallback): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = (...args: any[]) => {
      callback(...args);
      this.off(event, wrapped);
    };
    this.on(event, wrapped);
  }

  destroy(): void {
    this.telemetry.record(TELEMETRY_EVENTS.SDK_DESTROYED, {
      severity: "info",
      outcome: "destroyed",
    });
    this.provider.destroy();
    this.eventListeners.clear();
    this.initialized = false;
    this.connectInFlight = null;
    this.lastConnectResult = null;
    this.walletAvailability = CHECKING_WALLET_AVAILABILITY;
    this.telemetry.destroy();
  }

  /** Lazily-instantiated Thru chain client. */
  public getThru(): Thru {
    if (!this.thruClient) {
      this.thruClient = createNativeThruClient(this.rpcUrl);
    }
    return this.thruClient;
  }

  private async resolveDepositDestination(
    destination?: DepositDestination,
  ): Promise<{ destination: DepositDestination; walletAddress: string }> {
    const selectedAccount = this.provider.getSelectedAccount();
    if (!selectedAccount) {
      throw new Error("Wallet not connected");
    }
    if (destination) {
      const snapshot = this.preparedDepositSnapshots.get(destination);
      if (snapshot) {
        const canonicalDestination = getReusablePreparedDepositDestination(
          destination,
          snapshot,
          selectedAccount.address,
        );
        if (canonicalDestination) {
          return {
            destination: canonicalDestination,
            walletAddress: selectedAccount.address,
          };
        }
      }
    }
    const expected = await this.prepareDeposit(
      destination
        ? {
            network: destination.network,
            depositTarget: destination.depositTarget,
          }
        : DepositTarget.Credits,
    );
    return {
      destination: destination
        ? getValidatedDepositDestination(destination, expected)
        : expected,
      walletAddress: selectedAccount.address,
    };
  }

  private signDepositTransaction(
    payload: SignDepositTransactionPayload,
  ): Promise<string> {
    return signDepositTransactionWithActiveSession(this.thru, payload);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emit(event: SDKEvent, data?: any): void {
    this.eventListeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[NativeSDK] listener error for ${event}:`, err);
      }
    });
  }

  private setupEventForwarding(): void {
    /* CONNECT is emitted from connect() directly (with the resolved
       ConnectResult), so don't double-emit here. */
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, (data) => {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECTION_DISCONNECTED, {
        severity: "info",
        outcome: "disconnected",
      });
      this.lastConnectResult = null;
      this.clearAuthorizedAvailability();
      this.emit("disconnect", data);
    });
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ERROR, (data) => {
      this.emit("error", data);
    });
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.LOCK, (data) => {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECTION_LOCKED, {
        severity: "info",
        outcome: "locked",
      });
      this.lastConnectResult = null;
      this.clearAuthorizedAvailability();
      this.emit("lock", data);
      this.emit("disconnect", { reason: "locked" });
    });
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, (data) => {
      const payload = data as { account?: WalletAccount } | undefined;
      const account = payload?.account ?? null;
      this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_CHANGED, {
        severity: "info",
        outcome: account ? "selected" : "cleared",
        walletAddress: account?.address,
      });
      this.refreshCachedAccounts(this.provider.getAccounts(), account);
      if (account) void this.persistSelectedAccountAddress(account.address);
      this.emit("accountChanged", account);
    });
  }

  private async requestConnectionState(
    options?: ConnectOptions,
  ): Promise<GetConnectionStateResult> {
    if (!this.initialized) await this.initialize();

    const metadata =
      options?.metadata ??
      this.lastConnectResult?.metadata ??
      this.defaultMetadata ??
      undefined;
    const providerOptions = metadata
      ? { metadata: this.resolveMetadata(metadata) }
      : undefined;
    const preferredAccountAddress =
      options?.preferredAccountAddress ??
      (await this.readSelectedAccountAddress());
    const nextProviderOptions =
      providerOptions || preferredAccountAddress
        ? {
            ...(providerOptions ?? {}),
            ...(preferredAccountAddress ? { preferredAccountAddress } : {}),
          }
        : undefined;
    const state = await this.provider.getConnectionState(nextProviderOptions);
    return normalizeConnectionStateResult(state);
  }

  private async applyConnectionState(
    state: GetConnectionStateResult,
  ): Promise<void> {
    if (state.isAuthorized && state.hasPasskey && state.accounts.length > 0) {
      const result: ConnectResult = {
        accounts: state.accounts,
        selectedAccount: state.selectedAccount,
        status: "completed",
        metadata: state.metadata ?? undefined,
      };
      const activeResult = normalizeWalletAccountResult(result);
      this.lastConnectResult = activeResult;
      await this.persistSelectedAccountAddress(
        this.provider.getSelectedAccount()?.address ??
          activeResult.selectedAccount?.address ??
          null,
      );
      await this.clearPersistedConnection();
      this.emit("connect", activeResult);
      return;
    }

    const wasConnected =
      this.provider.isConnected() || !!this.lastConnectResult;
    this.provider.clearConnection();
    this.lastConnectResult = null;
    await this.clearPersistedConnection();
    if (wasConnected) {
      this.emit("disconnect", { reason: "state_unavailable" });
    }
  }

  private setWalletAvailability(availability: WalletAvailability): void {
    this.walletAvailability = availability;
    this.emit("availabilityChanged", availability);
  }

  private clearAuthorizedAvailability(): void {
    const previous =
      this.walletAvailability.status === "ready"
        ? this.walletAvailability
        : null;
    this.setWalletAvailability({
      status: "ready",
      isAuthorized: false,
      isConnected: false,
      isUnlocked: false,
      hasPasskey: previous?.hasPasskey ?? false,
      hasWalletAccount: previous?.hasWalletAccount ?? false,
      accounts: [],
      selectedAccount: null,
      metadata: null,
      error: null,
    });
  }

  private resolveMetadata(
    input?: ConnectMetadataInput,
  ): ConnectMetadataInput | undefined {
    const effectiveInput = input ?? this.defaultMetadata;
    if (!effectiveInput) {
      /* On RN we have no window.location.origin; require explicit
         metadata, but stamp the configured origin as appId so the
         wallet can scope per-host. */
      return { appId: this.origin };
    }
    const metadata: ConnectMetadataInput = {
      appId: effectiveInput.appId ?? this.origin,
    };
    if (effectiveInput.appUrl) metadata.appUrl = effectiveInput.appUrl;
    if (effectiveInput.appName) metadata.appName = effectiveInput.appName;
    if (effectiveInput.imageUrl) metadata.imageUrl = effectiveInput.imageUrl;
    return metadata;
  }

  private resolveSignInMetadata(options: SignInOptions): ConnectMetadataInput {
    const metadata: ConnectMetadataInput = {
      appId: options.app_id,
      appName: options.app_display_name,
    };
    if (options.app_url) metadata.appUrl = options.app_url;
    if (options.image_url) metadata.imageUrl = options.image_url;
    return metadata;
  }

  private refreshCachedAccounts(
    accounts: WalletAccount[],
    selectedAccount?: WalletAccount | null,
  ): WalletAccount[] {
    const active = normalizeActiveWalletAccounts(accounts, selectedAccount);
    const nextAccounts = active.accounts;
    const nextSelectedAccount = active.selectedAccount;
    if (this.lastConnectResult && this.provider.isConnected()) {
      this.lastConnectResult = {
        ...this.lastConnectResult,
        accounts: nextAccounts,
        selectedAccount: nextSelectedAccount,
      };
      if (nextSelectedAccount) {
        void this.persistSelectedAccountAddress(nextSelectedAccount.address);
      }
    }
    return nextAccounts;
  }

  private async applyPreferredSelectedAccount(
    accounts: WalletAccount[],
  ): Promise<void> {
    const preferredAddress = await this.readSelectedAccountAddress();
    if (!preferredAddress) return;
    if (!accounts.some((account) => account.address === preferredAddress)) {
      return;
    }
    if (this.provider.getSelectedAccount()?.address === preferredAddress) {
      return;
    }

    try {
      await this.provider.selectAccount(preferredAddress);
    } catch (error) {
      console.warn("[NativeSDK] Failed to restore selected account:", error);
    }
  }

  private async persistSelectedAccountAddress(
    selectedAccountAddress: string | null,
  ): Promise<void> {
    if (!this.storage) return;
    try {
      if (!selectedAccountAddress) {
        await this.storage.removeItem(this.selectedAccountStorageKey);
        return;
      }

      const snapshot: PersistedSelectedAccountSnapshot = {
        version: 1,
        origin: this.origin,
        walletOrigin: this.provider.getWalletOrigin(),
        savedAt: new Date().toISOString(),
        selectedAccountAddress,
      };
      await this.storage.setItem(
        this.selectedAccountStorageKey,
        JSON.stringify(snapshot),
      );
    } catch (error) {
      console.warn("[NativeSDK] Failed to persist selected account:", error);
    }
  }

  private async clearPersistedConnection(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.removeItem(this.storageKey);
    } catch (error) {
      console.warn("[NativeSDK] Failed to clear connection state:", error);
    }
  }

  private async readSelectedAccountAddress(): Promise<string | null> {
    if (!this.storage) return null;

    try {
      const raw = await this.storage.getItem(this.selectedAccountStorageKey);
      if (!raw) return null;

      const parsed = JSON.parse(
        raw,
      ) as Partial<PersistedSelectedAccountSnapshot>;
      if (
        parsed.version !== 1 ||
        parsed.origin !== this.origin ||
        parsed.walletOrigin !== this.provider.getWalletOrigin() ||
        typeof parsed.selectedAccountAddress !== "string" ||
        parsed.selectedAccountAddress.length === 0
      ) {
        await this.storage.removeItem(this.selectedAccountStorageKey);
        return null;
      }

      return parsed.selectedAccountAddress;
    } catch (error) {
      console.warn("[NativeSDK] Failed to restore selected account:", error);
      try {
        await this.storage.removeItem(this.selectedAccountStorageKey);
      } catch {
        /* best effort */
      }
      return null;
    }
  }
}

function getTelemetryErrorFields(error: unknown): {
  errorCode: string;
  message: string;
} {
  return {
    errorCode: getErrorCode(error) ?? ErrorCode.UNKNOWN_ERROR,
    message: getErrorMessage(error, "Unknown native wallet error"),
  };
}

function walletAvailabilityFromConnectResult(
  result: ConnectResult,
  selectedAccount?: WalletAccount | null,
): WalletAvailability {
  const active = normalizeWalletAccountResult(result, selectedAccount ?? null);
  const hasActiveAccount = active.accounts.length > 0;
  return {
    status: "ready",
    isAuthorized: hasActiveAccount,
    isConnected: hasActiveAccount,
    isUnlocked: true,
    hasPasskey: hasActiveAccount,
    hasWalletAccount: hasActiveAccount,
    accounts: active.accounts,
    selectedAccount: active.selectedAccount,
    metadata: result.metadata ?? null,
    error: null,
  };
}

function walletAvailabilityFromConnectionState(
  state: GetConnectionStateResult,
): WalletAvailability {
  const active = normalizeConnectionStateResult(state);
  const hasWalletAccount =
    (state as Partial<GetConnectionStateResult>).hasWalletAccount ??
    state.accounts.length > 0;
  return {
    status: "ready",
    isAuthorized: state.isAuthorized,
    isConnected: state.isAuthorized && state.isConnected,
    isUnlocked: state.isUnlocked,
    hasPasskey: state.hasPasskey,
    hasWalletAccount,
    accounts: active.accounts,
    selectedAccount: active.selectedAccount,
    metadata: state.isAuthorized ? state.metadata : null,
    error: null,
  };
}

function walletAvailabilityFromError(error: unknown): WalletAvailability {
  return {
    status: "error",
    isAuthorized: false,
    isConnected: false,
    isUnlocked: false,
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

function isUserRejectedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === ErrorCode.USER_REJECTED;
}
