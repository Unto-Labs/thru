import {
  withWalletNetwork,
  networkScopedStorage,
  type ResolvedWalletNetwork,
  type WalletNetworkSelection,
} from "../networks";
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
  type WalletTheme,
  type WalletThemePreference,
} from "../protocol";
import { normalizeWalletThemePreference, resolveWalletTheme } from "../theme";
import {
  createPreparedDepositSnapshot,
  ensureDepositAccountForWallet,
  createDepositsApi,
  formatDepositAmount,
  getReusablePreparedDepositDestination,
  getDepositAccountStateForWallet,
  getValidatedDepositDestination,
  signDepositTransactionWithActiveSession,
  waitForDepositForWallet,
  type DepositAccountState,
  type DepositsApi,
  type EnsureDepositAccountParams,
  type GetDepositAccountStateParams,
  type PreparedDepositSnapshot,
  type SignDepositTransactionPayload,
  type WaitForDepositParams,
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
import { base64ToBytes } from "../encoding";
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
import {
  CHECKING_WALLET_AVAILABILITY,
  ConnectionHintStore,
  connectionResultFromState,
  disconnectedWalletAvailability,
  walletAvailabilityFromConnectResult,
  walletAvailabilityFromConnectionState,
  walletAvailabilityFromError,
  resolveConnectionHintStorageKey,
  type WalletAvailability,
} from "../connection-state";
import {
  WalletSDKStorageError,
  withWalletSDKStorageErrors,
  type WalletSDKStorage,
} from "../storage";
import type {
  AccountsApi,
  ConnectionApi,
  SigningSessionsApi,
  WalletConnectOptions,
  WalletSDK,
} from "../sdk-contract";

export type IosWebViewMode = "direct" | "shell-iframe";
export type NativeWalletExperience = "standard" | "transparent";

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
  /**
   * The color scheme the wallet's sheets draw for (default light): `light`,
   * `dark`, or `system`. React Native has no matchMedia, so `system` resolves
   * from setSystemTheme(), which ThruProvider feeds from useColorScheme().
   * Change it later with setTheme().
   */
  theme?: WalletThemePreference;
  /**
   * Developer mode (default off): the wallet shows raw errors with a Copy
   * action, runs card purchases on Coinbase's sandbox, and offers the test
   * faucet in Add funds. The wallet's own account-menu switch also turns it
   * on. Change it later with setDeveloperMode().
   */
  developerMode?: boolean;
  autoRestore?: boolean;
  rpcUrl?: string;
  walletNetwork?: WalletNetworkSelection;
  network?: ThruNetwork;
  depositUiConfig?: DepositUiConfig;
  addressTypes?: AddressTypeValue[];
  /** iOS-only host mode. Shell iframe is the default; direct is kept
      as an escape hatch for real-device passkey/WebAuthn comparisons. */
  iosWebViewMode?: IosWebViewMode;
  /** Optional host-provided persistent storage (SecureStore,
      AsyncStorage, localStorage-compatible adapter, etc.). */
  storage?: WalletSDKStorage;
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
  image_url?: string;
  intent?: ConnectOptions["intent"];
}

export interface ConnectOptions extends WalletConnectOptions {}

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

export type RestoreConnectionOptions = Record<string, never>;

export type SDKEvent =
  | "networkChanged"
  | "connect"
  | "disconnect"
  | "error"
  | "accountChanged"
  | "availabilityChanged"
  /* The resolved wallet theme changed; the listener receives the WalletTheme. */
  | "themeChanged";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventCallback = (...args: any[]) => void;

/** @deprecated Use WalletSDKStorage. */
export type NativeSDKStorage = WalletSDKStorage;

export interface NativeSDKUiHandlers {
  onShowRequested?: (reason?: string) => void;
  onHideRequested?: (reason?: string) => void;
}

const DEFAULT_STORAGE_KEY = "thru.native-sdk.connection.v1";
const DEFAULT_NATIVE_WALLET_URL = "https://app.tid.sh/embedded/native";
const DEFAULT_TRANSPARENT_WALLET_URL =
  "https://app.tid.sh/embedded/native/transparent";

function completeAppMetadata(
  metadata: ConnectMetadataInput | AppMetadata | null | undefined,
  origin: string,
): AppMetadata | undefined {
  if (!metadata?.appId || !metadata.appName) {
    return undefined;
  }
  return {
    appId: metadata.appId,
    appName: metadata.appName,
    appUrl: origin,
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

/**
 * NativeSDK - mobile mirror of `@thru/wallet`'s `BrowserSDK`.
 * Public surface matches verbatim except `mountInline(HTMLElement)` is
 * replaced by `attachWebView(WebViewRefLike)` since the host bottom
 * sheet owns the WebView lifecycle.
 */
export class NativeSDK implements WalletSDK {
  private readonly requiresNetworkProtocol: boolean;
  private activeNetwork: ResolvedWalletNetwork | null = null;
  getNetwork(): ResolvedWalletNetwork | null {
    return this.activeNetwork;
  }
  async switchNetwork(
    selection: WalletNetworkSelection,
  ): Promise<ResolvedWalletNetwork> {
    if (!this.initialized) await this.initialize();
    const network = await this.provider.switchNetwork(selection);
    this.applyNetwork(network);
    return network;
  }
  private availableDepositProviders(): string[] {
    return [...this.depositProviders].filter(
      (id) =>
        !this.activeNetwork ||
        this.activeNetwork.depositProviders?.includes(id),
    );
  }
  private assertDepositNetwork(requested?: string): void {
    if (
      this.activeNetwork &&
      (!(this.activeNetwork.depositConfigured ?? this.activeNetwork.depositProviders?.length) ||
        (requested && requested !== this.activeNetwork.id))
    )
      throw new Error("Add funds unavailable on this network");
  }
  private applyNetwork(network: ResolvedWalletNetwork): void {
    if (
      this.activeNetwork?.scope === network.scope &&
      this.activeNetwork.rpcUrl === network.rpcUrl &&
      this.activeNetwork.name === network.name
    )
      return;
    const previous = this.activeNetwork;
    this.activeNetwork = network;
    this.lastConnectResult = null;
    this.rpcUrl = network.transportUrl ?? network.rpcUrl;
    this.thruClient = null;
    this.setWalletAvailability(disconnectedWalletAvailability());
    if (previous) this.emit("disconnect", { reason: "network_changed" });
    this.emit("networkChanged", network);
  }

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
  private readonly connectionHints?: ConnectionHintStore;
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
  private readonly autoRestore: boolean;
  private themePreference: WalletThemePreference = "light";
  private systemTheme: WalletTheme = "light";

  readonly connection: ConnectionApi = {
    connect: (options) => this.connect(options),
    disconnect: () => this.disconnect(),
    getState: () => this.getWalletAvailability(),
    refresh: (options) => this.refreshWalletAvailability(options),
  };

  readonly accounts: AccountsApi = {
    getSelected: () => this.getSelectedAccount(),
    select: (address) => this.selectAccount(address),
    manage: () => this.manageAccounts(),
  };

  readonly sessions: SigningSessionsApi = {
    create: (options) => this.thru.createSigningSession(options),
    renewSession: (options) => this.thru.renewSession(options),
    get: (id) => this.thru.getSigningSession(id),
    list: () => this.thru.getSigningSessions(),
    getActive: (walletAddress) =>
      this.thru.getActiveSigningSession(walletAddress),
    revoke: (id) => this.thru.revokeSigningSession(id),
  };

  readonly nativeOnboarding = {
    signIn: (options: SignInOptions) => this.signIn(options),
    createAccount: (options?: CreateAccountOptions) =>
      this.createAccount(options),
  };

  readonly deposits: DepositsApi = createDepositsApi({
    prepare: (targetOrPayload) => this.prepareDeposit(targetOrPayload),
    ensureAccount: (params) => this.ensureDepositAccount(params),
    open: (payload) => this.deposit(payload),
    getProviders: async () => this.availableDepositProviders(),
    getAccountState: (params) => this.getDepositAccountState(params),
    waitForDeposit: (params) => this.waitForDepositBalance(params),
    formatAmount: (amountRaw, destination) =>
      this.formatDepositAmount(amountRaw, destination),
  });

  constructor(config: NativeSDKConfig = {}) {
    this.requiresNetworkProtocol = config.walletNetwork !== undefined;
    this.origin = config.origin ?? "thru-mobile://app";
    this.rpcUrl = config.rpcUrl;
    this.storage = config.storage
      ? networkScopedStorage(
          config.storage,
          () => this.activeNetwork?.scope ?? "pending",
        )
      : undefined;
    this.storageKey = config.storageKey ?? DEFAULT_STORAGE_KEY;
    this.iosWebViewMode = config.iosWebViewMode ?? "shell-iframe";
    this.walletExperience = config.walletExperience ?? "standard";
    this.defaultMetadata = config.metadata;
    this.autoRestore = config.autoRestore ?? true;
    this.defaultNetwork = config.network;
    this.depositProviders = new Set(config.deposits?.providers ?? ["unifold"]);
    const walletUrl = withWalletNetwork(
      withTransactionSigningScheme(
      config.walletUrl ??
        (this.walletExperience === "transparent"
          ? DEFAULT_TRANSPARENT_WALLET_URL
          : DEFAULT_NATIVE_WALLET_URL),
      config.transactionSigningScheme,
      ),
      config.walletNetwork,
      config.rpcUrl,
      JSON.stringify([this.origin, config.metadata?.appId ?? ""]),
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
    this.selectedAccountStorageKey =
      config.selectedAccountStorageKey ??
      resolveConnectionHintStorageKey({
        walletOrigin,
        appOrigin: this.origin,
      });
    this.connectionHints = this.storage
      ? new ConnectionHintStore(
          this.storage,
          this.selectedAccountStorageKey,
          this.telemetry,
        )
      : undefined;
    const signingSessions = this.storage
      ? new SigningSessionDescriptorStore(
          this.storage,
          resolveSigningSessionStorageKey({
            walletOrigin,
            appOrigin: this.origin,
            storageKey: config.signingSessionStorageKey,
          }),
          this.telemetry,
        )
      : undefined;
    this.signingSessions = signingSessions;
    this.themePreference = normalizeWalletThemePreference(config.theme);
    try {
      this.provider = new NativeProvider({
        walletUrl,
        theme: resolveWalletTheme(this.themePreference, this.systemTheme),
        developerMode: config.developerMode === true,
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
        broadcastTransaction: (signedTransaction) =>
          this.getThru().transactions.send(base64ToBytes(signedTransaction)),
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

  /** The resolved color scheme the wallet WebView draws for. */
  getTheme(): WalletTheme {
    return this.provider.getTheme();
  }

  /** The scheme the host asked for, which may be `system`. */
  getThemePreference(): WalletThemePreference {
    return this.themePreference;
  }

  /**
   * Change the color scheme the wallet draws for: `light`, `dark`, or
   * `system`. A loaded wallet restyles in place; it is not reloaded.
   */
  setTheme(theme: WalletThemePreference): void {
    this.themePreference = normalizeWalletThemePreference(theme);
    this.applyTheme();
  }

  /**
   * Report the OS color scheme that `system` resolves to. ThruProvider feeds
   * this from useColorScheme(); hosts driving NativeSDK directly call it from
   * React Native's Appearance API.
   */
  setSystemTheme(theme: WalletTheme): void {
    this.systemTheme = theme === "dark" ? "dark" : "light";
    this.applyTheme();
  }

  /**
   * Turn this app's developer mode on or off. A loaded wallet follows in
   * place; it is not reloaded. Turning it off leaves the wallet's own
   * account-menu switch as it was.
   */
  setDeveloperMode(enabled: boolean): void {
    this.provider.setDeveloperMode(enabled === true);
  }

  private applyTheme(): void {
    const theme = resolveWalletTheme(this.themePreference, this.systemTheme);
    if (theme === this.provider.getTheme()) return;
    this.provider.setTheme(theme);
    this.emit("themeChanged", theme);
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
      if (
        this.requiresNetworkProtocol &&
        !this.provider.supportsNetworkSwitching()
      )
        throw new Error(
          "Wallet network selection requires a compatible hosted wallet.",
        );
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

  /** @deprecated Use `connection.connect()`. */
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
      this.provider.isConnected()
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
        const scope = this.activeNetwork?.scope;
        const result = await this.provider.connect(providerOptions);
        if (scope !== this.activeNetwork?.scope)
          throw new Error("Wallet network changed; reconnect.");
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

  /** @deprecated Use `nativeOnboarding.signIn()`. */
  async signIn(options: SignInOptions): Promise<ConnectResult> {
    return this.connect({
      metadata: this.resolveSignInMetadata(options),
      ...(options.intent ? { intent: options.intent } : {}),
    });
  }

  /** @deprecated Use `nativeOnboarding.createAccount()`. */
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
        metadata: completeAppMetadata(metadata, this.origin),
      };
      this.lastConnectResult = completedResult;
      await this.persistSelectedAccountAddress(
        activeResult.selectedAccount.address,
      );
      if (activeResult.signingSession) {
        if (!this.signingSessions) {
          throw new Error("NativeSDKStorage is required for signing sessions");
        }
        try {
          await this.signingSessions.saveReplacingWalletSessions(
            signingSessionDescriptorFromWire(activeResult.signingSession),
          );
        } catch (error) {
          if (error instanceof WalletSDKStorageError) {
            error.walletOperationCompleted = true;
          }
          throw error;
        }
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

  /** @deprecated Use `connection.disconnect()`. */
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
      await this.connectionHints?.clear();
      await this.signingSessions?.clear();
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

  async restoreConnection(): Promise<ConnectResult | null> {
    await this.clearPersistedConnection();
    if (!this.autoRestore) {
      this.clearAuthorizedAvailability();
      return null;
    }
    await this.signingSessions?.list();
    const availability = await this.refreshWalletAvailability();
    return availability.status === "connected" ? this.lastConnectResult : null;
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

  /** @deprecated Use `accounts.getSelected()`. */
  getSelectedAccount(): WalletAccount | null {
    return this.provider.getSelectedAccount();
  }

  /** @deprecated Use `accounts.select()`. */
  async selectAccount(publicKey: string): Promise<WalletAccount> {
    const account = await this.provider.selectAccount(publicKey);
    this.refreshCachedAccounts(this.provider.getAccounts(), account);
    await this.persistSelectedAccountAddress(account.address);
    if (this.lastConnectResult) {
      this.setWalletAvailability(
        walletAvailabilityFromConnectResult(this.lastConnectResult, account),
      );
    }
    return account;
  }

  /** @deprecated Use `accounts.manage()`. */
  async manageAccounts(): Promise<ManageAccountsResult> {
    if (!this.initialized) await this.initialize();
    const result = await this.provider.manageAccounts();
    const selectedAccount = result.selectedAccount ?? null;
    this.refreshCachedAccounts(
      selectedAccount ? [selectedAccount] : [],
      selectedAccount,
    );
    await this.persistSelectedAccountAddress(selectedAccount?.address ?? null);
    if (this.lastConnectResult) {
      this.setWalletAvailability(
        walletAvailabilityFromConnectResult(this.lastConnectResult),
      );
    }
    this.emit("accountChanged", selectedAccount);
    return result;
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
    this.assertDepositNetwork(payload.network);
    const selectedAccountBefore = this.provider.getSelectedAccount();
    const destination = await this.provider.prepareDeposit({
      ...payload,
      network:
        payload.network ??
        (this.activeNetwork?.id as ThruNetwork | undefined) ??
        this.defaultNetwork,
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
    this.assertDepositNetwork(payload.destination?.network);
    const providerId = payload.providerId ?? "unifold";
    if (!this.availableDepositProviders().includes(providerId)) {
      throw new Error(`Deposit provider is not configured: ${providerId}`);
    }
    return this.provider.deposit({ ...payload, providerId });
  }

  /** @deprecated Use `deposits.ensureAccount()`. */
  async ensureDepositAccount(
    params: EnsureDepositAccountParams = {},
  ): Promise<DepositAccountState> {
    if (!this.initialized) await this.initialize();
    return this.provider.withNetworkOperation(async () => {
      this.assertDepositNetwork(params.destination?.network);
      const { destination, walletAddress } = await this.resolveDepositDestination(
        params.destination,
      );
      return ensureDepositAccountForWallet({
        thru: this.getThru(),
        walletAddress,
        destination,
        signTransaction: (payload) => this.signDepositTransaction(payload),
      });
    });
  }

  /** @deprecated Use `deposits.getAccountState()`. */
  async getDepositAccountState(
    params: GetDepositAccountStateParams = {},
  ): Promise<DepositAccountState> {
    if (!this.initialized) await this.initialize();
    return this.provider.withNetworkOperation(async () => {
      this.assertDepositNetwork(params.destination?.network);
      const { destination, walletAddress } = await this.resolveDepositDestination(
        params.destination,
      );
      return getDepositAccountStateForWallet({
        thru: this.getThru(),
        walletAddress,
        destination,
      });
    });
  }

  /** @deprecated Use `deposits.waitForDeposit()`. */
  async waitForDepositBalance(
    params: WaitForDepositParams,
  ): Promise<DepositAccountState> {
    if (!this.initialized) await this.initialize();
    return this.provider.withNetworkOperation(async () => {
      this.assertDepositNetwork(params.destination?.network);
      const { destination, walletAddress } = await this.resolveDepositDestination(
        params.destination,
      );
      return waitForDepositForWallet({
        thru: this.getThru(),
        walletAddress,
        destination,
        minimumBalanceRaw: params.minimumBalanceRaw,
        signature: params.signature,
      });
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
      this.thruClient = createNativeThruClient(
        this.rpcUrl,
        this.activeNetwork?.transactionSigningScheme,
      );
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
        : DepositTarget.THRUSD,
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
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.NETWORK_CHANGED, (data: any) =>
      this.applyNetwork(data),
    );
    /* CONNECT is emitted from connect() directly (with the resolved
       ConnectResult), so don't double-emit here. */
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, (data) => {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECTION_DISCONNECTED, {
        severity: "info",
        outcome: "disconnected",
      });
      this.lastConnectResult = null;
      void this.connectionHints?.clear();
      this.clearAuthorizedAvailability();
      this.emit("disconnect", data);
    });
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ERROR, (data) => {
      this.emit("error", data);
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
    return this.provider.getConnectionState(nextProviderOptions);
  }

  private async applyConnectionState(
    state: GetConnectionStateResult,
  ): Promise<void> {
    const result = connectionResultFromState(state);
    if (result) {
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
    if (this.activeNetwork) availability = { ...availability, network: this.activeNetwork };
    this.walletAvailability = availability;
    this.emit("availabilityChanged", availability);
  }

  private clearAuthorizedAvailability(): void {
    this.setWalletAvailability(
      disconnectedWalletAvailability(this.walletAvailability),
    );
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
    if (effectiveInput.appName) metadata.appName = effectiveInput.appName;
    if (effectiveInput.imageUrl) metadata.imageUrl = effectiveInput.imageUrl;
    return metadata;
  }

  private resolveSignInMetadata(options: SignInOptions): ConnectMetadataInput {
    const metadata: ConnectMetadataInput = {
      appId: options.app_id,
      appName: options.app_display_name,
    };
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
    if (!this.connectionHints) return;
    try {
      if (!selectedAccountAddress) {
        await this.connectionHints.clear();
        return;
      }

      await this.connectionHints.write({
        selectedAccountAddress,
      });
    } catch {
      // Already reported by the shared storage adapter without stored values.
    }
  }

  private async clearPersistedConnection(): Promise<void> {
    if (!this.storage) return;
    try {
      await withWalletSDKStorageErrors(
        this.storage,
        "connection",
        this.telemetry,
      ).removeItem(this.storageKey);
    } catch {
      // Legacy snapshot cleanup is best effort.
    }
  }

  private async readSelectedAccountAddress(): Promise<string | null> {
    if (!this.connectionHints) return null;

    try {
      return (
        (await this.connectionHints.read())?.selectedAccountAddress ?? null
      );
    } catch {
      // A transient read failure is not evidence that the hint is corrupt.
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

function isUserRejectedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === ErrorCode.USER_REJECTED;
}
