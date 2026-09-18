import { TELEMETRY_EVENTS } from './observability';
import {
  AddressType,
  normalizeActiveWalletAccounts,
} from './interfaces';
import type {
  AddressType as AddressTypeValue,
  ConnectResult,
  IThruChain,
  WalletAccount,
} from './interfaces';
import { getErrorCode as getTelemetryErrorCode } from './internal/telemetry-fields';
import { EmbeddedProvider } from './provider/EmbeddedProvider';
import {
  DEFAULT_IFRAME_URL,
  EMBEDDED_PROVIDER_EVENTS,
  DepositTarget,
  type ConnectMetadataInput,
  sanitizePasskeyName,
  type DepositDestination,
  type DepositRequestPayload,
  type DepositResult,
  type DepositUiConfig,
  type GetConnectionStateResult,
  type ManageAccountsResult,
  type AccountMenuPayload,
  type AccountMenuResult,
  type WalletTheme,
  type WalletThemePreference,
  type PrepareDepositPayload,
  type ThruNetwork,
} from './protocol';
import {
  normalizeWalletThemePreference,
  readSystemTheme,
  resolveWalletTheme,
  watchSystemTheme,
} from './theme';
import {
  createPreparedDepositSnapshot,
  ensureDepositAccountForWallet,
  createDepositsApi,
  formatDepositAmount,
  getDepositAccountStateForWallet,
  getReusablePreparedDepositDestination,
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
} from './deposit';
import {
  SigningSessionDescriptorStore,
  getDefaultBrowserSigningSessionStorage,
  resolveSigningSessionStorageKey,
  type SigningSessionStorage,
} from './signing-sessions';
import type { WalletSDKStorage } from './storage';
import type {
  AccountsApi,
  ConnectionApi,
  SigningSessionsApi,
  WalletConnectOptions,
  WalletSDK,
} from './sdk-contract';
import { createThruClient, Thru } from '@thru/sdk/client';
import { base64ToBytes } from './encoding';
import {
  type TransactionSigningScheme,
  withTransactionSigningScheme,
} from './transaction-signing-scheme';
import {
  TelemetryClient,
  WALLET_SDK_VERSION,
  createTelemetrySessionId,
  withTelemetryParameters,
  type TelemetryAppContext,
} from './telemetry';
import {
  CHECKING_WALLET_AVAILABILITY,
  ConnectionHintStore,
  connectionResultFromState,
  disconnectedWalletAvailability,
  getDefaultBrowserConnectionStorage,
  resolveConnectionHintStorageKey,
  walletAvailabilityFromConnectResult,
  walletAvailabilityFromConnectionState,
  walletAvailabilityFromError,
  type ConnectionStorage,
  type WalletAvailability,
} from './connection-state';

export interface BrowserSDKConfig {
  iframeUrl?: string;
  /**
   * The color scheme the wallet's sheets and menus draw for (default light):
   * `light`, `dark`, or `system` to follow the OS setting. Change it later
   * with setTheme().
   */
  theme?: WalletThemePreference;
  /** Share sanitized operational diagnostics with Thru. Defaults to true. */
  telemetryEnabled?: boolean;
  /** Opaque host-app-provided label stamped on telemetry for cross-session
      correlation (e.g. the app's own user or install ID). Never minted or
      interpreted by the SDK. */
  appContextId?: string;
  /** Bounded host-app-provided dimensions stamped on telemetry events
      (at most 5 short keys/values). Never interpreted by the SDK. */
  appContext?: TelemetryAppContext;
  metadata?: ConnectMetadataInput;
  autoRestore?: boolean;
  storage?: WalletSDKStorage | false;
  /** @deprecated Use storage. */
  connectionStorage?: ConnectionStorage | false;
  connectionStorageKey?: string;
  addressTypes?: AddressTypeValue[];
  rpcUrl?: string;
  network?: ThruNetwork;
  depositUiConfig?: DepositUiConfig;
  /** @deprecated Use storage. */
  signingSessionStorage?: SigningSessionStorage | false;
  signingSessionStorageKey?: string;
  transactionSigningScheme?: TransactionSigningScheme;
  deposits?: {
    providers: string[];
  };
}

export interface ConnectOptions extends WalletConnectOptions {}

export type SDKEvent =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'accountChanged'
  | 'availabilityChanged'
  /* Add funds lifecycle (see DepositOpenedEventPayload and friends). */
  | 'deposit:opened'
  | 'deposit:pending'
  | 'deposit:completed'
  | 'deposit:cancelled'
  /* The resolved wallet theme changed (a setTheme() call, or the OS setting
     under `system`); the listener receives the new WalletTheme. */
  | 'themeChanged';

export type EventCallback = (...args: any[]) => void;

/**
 * Browser SDK - Main entry point for dApp developers
 * Wraps EmbeddedProvider with a clean, simple API
 */
export class BrowserSDK implements WalletSDK {
  private provider: EmbeddedProvider;
  private telemetry: TelemetryClient;
  private eventListeners = new Map<SDKEvent, Set<EventCallback>>();
  private initialized = false;
  private thruClient: Thru;
  private defaultNetwork?: ThruNetwork;
  private depositProviders: ReadonlySet<string>;
  private connectInFlight: Promise<ConnectResult> | null = null;
  private lastConnectResult: ConnectResult | null = null;
  private readonly preparedDepositSnapshots = new WeakMap<
    DepositDestination,
    PreparedDepositSnapshot
  >();
  private walletAvailability: WalletAvailability = CHECKING_WALLET_AVAILABILITY;
  private readonly defaultMetadata?: ConnectMetadataInput;
  private readonly autoRestore: boolean;
  private readonly connectionHints?: ConnectionHintStore;
  private readonly signingSessions?: SigningSessionDescriptorStore;
  private themePreference: WalletThemePreference = 'light';
  private systemTheme: WalletTheme = 'light';
  private stopWatchingSystemTheme: (() => void) | null = null;

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

  readonly deposits: DepositsApi = createDepositsApi({
    prepare: (targetOrPayload) => this.prepareDeposit(targetOrPayload),
    ensureAccount: (params) => this.ensureDepositAccount(params),
    open: (payload) => this.deposit(payload),
    getProviders: async () => [...this.depositProviders],
    getAccountState: (params) => this.getDepositAccountState(params),
    waitForDeposit: (params) => this.waitForDepositBalance(params),
    formatAmount: (amountRaw, destination) =>
      this.formatDepositAmount(amountRaw, destination),
  });

  private readonly iframeUrl: string;

  /** The wallet URL this SDK loads (with its signing-scheme / telemetry query). */
  getIframeUrl(): string {
    return this.iframeUrl;
  }

  /** The resolved color scheme the wallet frames draw for. */
  getTheme(): WalletTheme {
    return this.provider.getTheme();
  }

  /** The scheme the host asked for, which may be `system`. */
  getThemePreference(): WalletThemePreference {
    return this.themePreference;
  }

  /**
   * Change the color scheme the wallet draws for: `light`, `dark`, or
   * `system` to follow the OS setting. Open and future wallet surfaces
   * restyle in place; the wallet is not reloaded.
   */
  setTheme(theme: WalletThemePreference): void {
    this.themePreference = normalizeWalletThemePreference(theme);
    this.syncSystemThemeWatcher();
    this.applyTheme();
  }

  constructor(config: BrowserSDKConfig = {}) {
    const configuredIframeUrl = withTransactionSigningScheme(
      config.iframeUrl ?? DEFAULT_IFRAME_URL,
      config.transactionSigningScheme,
    );
    const telemetryEnabled = config.telemetryEnabled ?? true;
    const telemetrySessionId = createTelemetrySessionId();
    const iframeUrl = withTelemetryParameters(
      configuredIframeUrl,
      telemetryEnabled,
      telemetrySessionId,
      config.appContextId,
      config.appContext,
    );
    this.iframeUrl = iframeUrl;
    const walletOrigin = new URL(iframeUrl).origin;
    const appOrigin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'unknown';
    this.telemetry = new TelemetryClient({
      enabled: telemetryEnabled,
      walletUrl: configuredIframeUrl,
      sessionId: telemetrySessionId,
      appContextId: config.appContextId,
      appContext: config.appContext,
      source: 'sdk',
      context: {
        appOrigin,
        sdkVersion: WALLET_SDK_VERSION,
        platform: 'browser',
        network: config.network,
      },
    });
    const defaultStorage =
      config.storage === false
        ? null
        : config.storage ?? getDefaultBrowserSigningSessionStorage();
    const storage =
      config.signingSessionStorage === false
        ? null
        : config.signingSessionStorage ?? defaultStorage;
    const signingSessions = storage
      ? new SigningSessionDescriptorStore(
          storage,
          resolveSigningSessionStorageKey({
            walletOrigin,
            appOrigin,
            storageKey: config.signingSessionStorageKey,
          }),
          this.telemetry,
        )
      : undefined;
    this.signingSessions = signingSessions;
    const connectionStorage =
      config.connectionStorage === false
        ? null
        : config.connectionStorage ?? defaultStorage ?? getDefaultBrowserConnectionStorage();

    this.thruClient = createThruClient({
      baseUrl: config.rpcUrl,
    });

    this.themePreference = normalizeWalletThemePreference(config.theme);
    this.systemTheme = readSystemTheme();

    try {
      this.provider = new EmbeddedProvider({
        iframeUrl,
        theme: resolveWalletTheme(this.themePreference, this.systemTheme),
        addressTypes: config.addressTypes || [AddressType.THRU],
        signingSessions,
        broadcastTransaction: (signedTransaction) =>
          this.thruClient.transactions.send(base64ToBytes(signedTransaction)),
        network: config.network,
        depositUiConfig: config.depositUiConfig,
        telemetry: this.telemetry,
      });
    } catch (error) {
      /* Never upload to a wallet origin that failed provider validation. */
      this.telemetry.discard();
      throw error;
    }
    this.provider.primeTelemetryContext(
      this.telemetry.getAppContextId() ?? null,
      this.telemetry.getContext() ?? null,
    );
    this.telemetry.record(TELEMETRY_EVENTS.SDK_CONSTRUCTED);
    this.defaultNetwork = config.network;
    this.defaultMetadata = config.metadata;
    this.autoRestore = config.autoRestore ?? true;
    this.connectionHints = connectionStorage
      ? new ConnectionHintStore(
          connectionStorage,
          resolveConnectionHintStorageKey({
            walletOrigin,
            appOrigin,
            storageKey: config.connectionStorageKey,
          }),
          this.telemetry,
        )
      : undefined;
    this.depositProviders = new Set(config.deposits?.providers ?? ['unifold']);

    // Forward provider events to SDK events
    this.setupEventForwarding();
    this.syncSystemThemeWatcher();
  }

  /* Follow the OS setting only while the host asks for `system`. */
  private syncSystemThemeWatcher(): void {
    if (this.themePreference !== 'system') {
      this.stopWatchingSystemTheme?.();
      this.stopWatchingSystemTheme = null;
      return;
    }
    if (this.stopWatchingSystemTheme) return;
    this.systemTheme = readSystemTheme();
    this.stopWatchingSystemTheme = watchSystemTheme((systemTheme) => {
      this.systemTheme = systemTheme;
      this.applyTheme();
    });
  }

  private applyTheme(): void {
    const theme = resolveWalletTheme(this.themePreference, this.systemTheme);
    if (theme === this.provider.getTheme()) return;
    this.provider.setTheme(theme);
    this.emit('themeChanged', theme);
  }

  /**
   * Set or clear the opaque host-app correlation label on later telemetry
   * events from this SDK instance and from the embedded wallet.
   */
  setAppContextId(appContextId: string | null): void {
    this.telemetry.setAppContextId(appContextId);
    this.provider.setTelemetryAppContextId(this.telemetry.getAppContextId() ?? null);
  }

  /**
   * Replace or clear the host-app dimensions on later telemetry events from
   * this SDK instance and from the embedded wallet.
   */
  setContext(context: TelemetryAppContext | null): void {
    this.telemetry.setContext(context);
    this.provider.setTelemetryContext(this.telemetry.getContext() ?? null);
  }

  /**
   * Initialize the SDK (creates iframe)
   * Must be called before using the SDK
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_SKIPPED, {
        severity: 'debug',
        operation: 'initialize',
        outcome: 'already_initialized',
      });
      return;
    }

    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_STARTED, {
      operation: 'initialize',
    });
    try {
      await this.provider.initialize();
      this.initialized = true;
      this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_COMPLETED, {
        operation: 'initialize',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });

      if (!this.autoRestore) {
        this.setWalletAvailability(disconnectedWalletAvailability());
        return;
      }

      const hint = await this.readConnectionHint();
      await this.signingSessions?.list();
      await this.refreshWalletAvailability({
        metadata: this.defaultMetadata,
        preferredAccountAddress: hint?.selectedAccountAddress,
      });
    } catch (error) {
      this.setWalletAvailability(walletAvailabilityFromError(error));
      this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_FAILED, {
        operation: 'initialize',
        outcome: 'error',
        severity: 'error',
        durationMs: Date.now() - startedAt,
        errorCode: getTelemetryErrorCode(error),
        message: error,
      });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Connect to wallet
   * Shows wallet modal and requests connection
   * @deprecated Use `connection.connect()`.
   */
  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    // Auto-initialize if not done yet
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.connectInFlight) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_REUSED, {
        severity: 'debug',
        operation: 'connect',
        outcome: 'in_flight',
      });
      return this.connectInFlight;
    }

    if (this.lastConnectResult && this.provider.isConnected()) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_REUSED, {
        severity: 'debug',
        operation: 'connect',
        outcome: 'already_connected',
        walletAddress: this.lastConnectResult.selectedAccount?.address,
      });
      return this.lastConnectResult;
    }

    this.emit('connect', { status: 'connecting' });

    const inFlight = (async () => {
      const startedAt = Date.now();
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_STARTED, { operation: 'connect' });
      try {
        const hint = await this.readConnectionHint();
        const metadata = this.resolveMetadata(options?.metadata ?? this.defaultMetadata);
        const passkeyName = sanitizePasskeyName(options?.passkeyName);
        const providerOptions = {
          ...(metadata ? { metadata } : {}),
          ...(passkeyName ? { passkeyName } : {}),
          ...(options?.preferredAccountAddress ?? hint?.selectedAccountAddress
            ? {
                preferredAccountAddress:
                  options?.preferredAccountAddress ?? hint?.selectedAccountAddress,
              }
            : {}),
          ...(options?.intent ? { intent: options.intent } : {}),
        };
        const result = await this.provider.connect(providerOptions);
        this.lastConnectResult = result;
        await this.persistSelectedAccount(result.selectedAccount?.address ?? null);
        this.setWalletAvailability(walletAvailabilityFromConnectResult(result));
        this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_COMPLETED, {
          operation: 'connect',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
          walletAddress: result.selectedAccount?.address,
        });
        this.emit('connect', result);
        return result;
      } catch (error) {
        this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_FAILED, {
          operation: 'connect',
          outcome: 'error',
          severity: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: getTelemetryErrorCode(error),
          message: error,
        });
        this.emit('error', error);
        throw error;
      } finally {
        this.connectInFlight = null;
      }
    })();

    this.connectInFlight = inFlight;
    return inFlight;
  }

  /**
   * Mount the wallet iframe inline in a container.
   */
  async mountInline(container: HTMLElement): Promise<void> {
    await this.provider.mountInline(container);
  }

  /**
   * Disconnect from wallet
   * @deprecated Use `connection.disconnect()`.
   */
  async disconnect(): Promise<void> {
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_DISCONNECT_STARTED, {
      operation: 'disconnect',
    });
    try {
      await this.provider.disconnect();
      this.telemetry.record(TELEMETRY_EVENTS.SDK_DISCONNECT_COMPLETED, {
        operation: 'disconnect',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });
      this.emit('disconnect', {});
      this.lastConnectResult = null;
      await this.connectionHints?.clear();
      await this.signingSessions?.clear();
      this.setWalletAvailability(disconnectedWalletAvailability(this.walletAvailability));
    } catch (error) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_DISCONNECT_FAILED, {
        operation: 'disconnect',
        outcome: 'error',
        severity: 'error',
        durationMs: Date.now() - startedAt,
        errorCode: getTelemetryErrorCode(error),
        message: error,
      });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.provider.isConnected();
  }

  getWalletAvailability(): WalletAvailability {
    return this.walletAvailability;
  }

  async syncConnectionState(
    options?: ConnectOptions & { preferredAccountAddress?: string },
  ): Promise<GetConnectionStateResult | null> {
    try {
      if (!this.initialized) {
        await this.provider.initialize();
        this.initialized = true;
      }
      const metadata = this.resolveMetadata(options?.metadata ?? this.defaultMetadata);
      const state = await this.provider.getConnectionState({
        ...(metadata ? { metadata } : {}),
        ...(options?.preferredAccountAddress
          ? { preferredAccountAddress: options.preferredAccountAddress }
          : {}),
      });
      const availability = walletAvailabilityFromConnectionState(state);
      this.setWalletAvailability(availability);
      await this.applyConnectionState(state, metadata);
      return state;
    } catch (error) {
      this.setWalletAvailability(walletAvailabilityFromError(error));
      this.emit('error', error);
      return null;
    }
  }

  async refreshWalletAvailability(
    options?: ConnectOptions & { preferredAccountAddress?: string },
  ): Promise<WalletAvailability> {
    await this.syncConnectionState(options);
    return this.walletAvailability;
  }

  /** @deprecated Use `accounts.getSelected()`. */
  getSelectedAccount(): WalletAccount | null {
    return this.provider.getSelectedAccount();
  }

  /** @deprecated Use `accounts.select()`. */
  async selectAccount(publicKey: string): Promise<WalletAccount> {
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_SELECTION_STARTED, {
      operation: 'select_account',
      walletAddress: publicKey,
    });
    const account = await this.provider.selectAccount(publicKey);
    this.refreshCachedAccounts(this.provider.getAccounts(), account);
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_SELECTION_COMPLETED, {
      operation: 'select_account',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      walletAddress: account.address,
    });
    await this.persistSelectedAccount(account.address);
    if (this.lastConnectResult) {
      this.setWalletAvailability(
        walletAvailabilityFromConnectResult(this.lastConnectResult, account),
      );
    }
    return account;
  }

  /** @deprecated Use `accounts.manage()`. */
  async manageAccounts(): Promise<ManageAccountsResult> {
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_MANAGEMENT_STARTED, {
      operation: 'manage_accounts',
    });
    const result = await this.provider.manageAccounts();
    this.refreshCachedAccounts(
      result.selectedAccount ? [result.selectedAccount] : [],
      result.selectedAccount,
    );
    await this.persistSelectedAccount(result.selectedAccount?.address ?? null);
    if (this.lastConnectResult) {
      this.setWalletAvailability(
        walletAvailabilityFromConnectResult(
          this.lastConnectResult,
          result.selectedAccount,
        ),
      );
    }
    this.emit('accountChanged', result.selectedAccount);
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_MANAGEMENT_COMPLETED, {
      operation: 'manage_accounts',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      walletAddress: result.selectedAccount?.address,
    });
    return result;
  }

  /**
   * Open the wallet's own account menu, drawn inside its frame under the
   * host's account chip. The wallet handles switching, adding accounts, and
   * signing out; the cached accounts follow the result.
   */
  async openAccountMenu(options: AccountMenuPayload): Promise<AccountMenuResult> {
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_MANAGEMENT_STARTED, {
      operation: 'account_menu',
    });
    const result = await this.provider.openAccountMenu(options);
    if (result.accounts) {
      this.refreshCachedAccounts(result.accounts, result.selectedAccount ?? null);
      this.emit('accountChanged', result.selectedAccount ?? null);
    }
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_MANAGEMENT_COMPLETED, {
      operation: 'account_menu',
      outcome: result.action,
      durationMs: Date.now() - startedAt,
      walletAddress: result.selectedAccount?.address,
    });
    return result;
  }

  /**
   * Derive a canonical deposit destination for the configured provider network.
   * The returned object can be independently polled by the dApp and must be
   * passed unchanged to deposit().
   *
   * @deprecated Use `deposits.prepare()`.
   */
  async prepareDeposit(
    depositTargetOrPayload?: PrepareDepositPayload['depositTarget'] | PrepareDepositPayload
  ): Promise<DepositDestination> {
    if (!this.initialized) {
      await this.initialize();
    }
    const payload =
      typeof depositTargetOrPayload === 'string'
        ? { depositTarget: depositTargetOrPayload }
        : depositTargetOrPayload ?? {};
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
        createPreparedDepositSnapshot(destination, selectedAccountAfter.address)
      );
    }
    return destination;
  }

  /**
   * Open the wallet's Deposit ("Add funds") screen for a token account.
   * Resolves with the terminal UX state once the user completes or cancels.
   *
   * @deprecated Use `deposits.open()`.
   */
  async deposit(payload: DepositRequestPayload = {}): Promise<DepositResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    /* `method` picks the rail; an explicit providerId (legacy callers) wins.
       Neither → the wallet shows its chooser, restricted to the providers
       this SDK enables. */
    const providerId =
      payload.providerId ??
      (payload.method === 'card'
        ? 'coinbase'
        : payload.method === 'crypto' || payload.destination
          ? 'unifold'
          : undefined);
    if (providerId !== undefined && !this.depositProviders.has(providerId)) {
      throw new Error(`Deposit provider is not configured: ${providerId}`);
    }
    return this.provider.deposit({
      ...payload,
      ...(providerId ? { providerId } : {}),
      ...(payload.amount && !payload.paymentAmount ? { paymentAmount: payload.amount } : {}),
      enabledProviders: [...this.depositProviders],
    });
  }

  /** @deprecated Use `deposits.ensureAccount()`. */
  async ensureDepositAccount(
    params: EnsureDepositAccountParams = {}
  ): Promise<DepositAccountState> {
    if (!this.initialized) {
      await this.initialize();
    }
    const { destination, walletAddress } =
      await this.resolveDepositDestination(params.destination);
    return ensureDepositAccountForWallet({
      thru: this.thruClient,
      walletAddress,
      destination,
      signTransaction: (payload) => this.signDepositTransaction(payload),
    });
  }

  /** @deprecated Use `deposits.getAccountState()`. */
  async getDepositAccountState(
    params: GetDepositAccountStateParams = {}
  ): Promise<DepositAccountState> {
    if (!this.initialized) {
      await this.initialize();
    }
    const { destination, walletAddress } =
      await this.resolveDepositDestination(params.destination);
    return getDepositAccountStateForWallet({
      thru: this.thruClient,
      walletAddress,
      destination,
    });
  }

  /** @deprecated Use `deposits.waitForDeposit()`. */
  async waitForDepositBalance(
    params: WaitForDepositParams
  ): Promise<DepositAccountState> {
    if (!this.initialized) {
      await this.initialize();
    }
    const { destination, walletAddress } =
      await this.resolveDepositDestination(params.destination);
    return waitForDepositForWallet({
      thru: this.thruClient,
      walletAddress,
      destination,
      minimumBalanceRaw: params.minimumBalanceRaw,
      signature: params.signature,
    });
  }

  /** @deprecated Use `deposits.formatAmount()`. */
  formatDepositAmount = formatDepositAmount;

  /**
   * Get Thru chain API (iframe-backed signer)
   */
  get thru(): IThruChain {
    return this.provider.thru;
  }

  /**
   * Event emitter: on
   */
  on(event: SDKEvent, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Event emitter: off
   */
  off(event: SDKEvent, callback: EventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  /**
   * Event emitter: once (listen once and auto-remove)
   */
  once(event: SDKEvent, callback: EventCallback): void {
    const wrappedCallback = (...args: any[]) => {
      callback(...args);
      this.off(event, wrappedCallback);
    };
    this.on(event, wrappedCallback);
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: SDKEvent, data?: any): void {
    this.eventListeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in SDK event listener for ${event}:`, error);
      }
    });
  }

  /**
   * Set up event forwarding from provider to SDK
   */
  private setupEventForwarding(): void {
    // Forward all relevant provider events to SDK events
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.CONNECT, (data: any) => {
      // Already handled in connect() method
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, (data: any) => {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_WALLET_DISCONNECTED, {
        operation: 'disconnect',
        outcome: 'wallet_event',
      });
      this.lastConnectResult = null;
      void this.connectionHints?.clear();
      this.setWalletAvailability(disconnectedWalletAvailability(this.walletAvailability));
      this.emit('disconnect', data);
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ERROR, (data: any) => {
      const error = data?.error ?? data;
      this.telemetry.record(TELEMETRY_EVENTS.SDK_WALLET_ERROR, {
        severity: 'error',
        outcome: 'error',
        errorCode: getTelemetryErrorCode(error),
        message: error,
      });
      this.emit('error', data);
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, (data: any) => {
      const account = data?.account ?? data;
      this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_CHANGED, {
        operation: 'account_changed',
        outcome: account ? 'selected' : 'cleared',
        walletAddress: account?.address,
      });
      this.refreshCachedAccounts(this.provider.getAccounts(), account ?? null);
      if (account?.address) void this.persistSelectedAccount(account.address);
      if (this.lastConnectResult) {
        this.setWalletAvailability(
          walletAvailabilityFromConnectResult(this.lastConnectResult, account),
        );
      }
      this.emit('accountChanged', account);
    });

    /* The wallet reports the Add funds lifecycle as it happens; the
       deposit() promise still resolves with the terminal state. */
    for (const event of [
      EMBEDDED_PROVIDER_EVENTS.DEPOSIT_OPENED,
      EMBEDDED_PROVIDER_EVENTS.DEPOSIT_PENDING,
      EMBEDDED_PROVIDER_EVENTS.DEPOSIT_COMPLETED,
      EMBEDDED_PROVIDER_EVENTS.DEPOSIT_CANCELLED,
    ] as const) {
      this.provider.on(event, (data: any) => this.emit(event, data));
    }
  }

  /**
   * Destroy SDK and cleanup
   */
  destroy(): void {
    this.telemetry.record(TELEMETRY_EVENTS.SDK_DESTROYED, {
      operation: 'destroy',
      outcome: 'success',
    });
    this.stopWatchingSystemTheme?.();
    this.stopWatchingSystemTheme = null;
    this.provider.destroy();
    this.eventListeners.clear();
    this.initialized = false;
    this.connectInFlight = null;
    this.lastConnectResult = null;
    this.telemetry.destroy();
    this.walletAvailability = CHECKING_WALLET_AVAILABILITY;
  }

  private resolveMetadata(input?: ConnectMetadataInput): ConnectMetadataInput | undefined {
    input = input ?? this.defaultMetadata;
    const defaultOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
    if (!defaultOrigin && !input) {
      return undefined;
    }

    const appId = input?.appId || defaultOrigin;
    const appUrl = this.resolveAppUrl(defaultOrigin, input?.appUrl);
    const appName = input?.appName || this.deriveAppName(appUrl ?? appId);

    const metadata: ConnectMetadataInput = {};
    if (appId) metadata.appId = appId;
    if (appUrl) metadata.appUrl = appUrl;
    if (appName) metadata.appName = appName;
    if (input?.imageUrl) metadata.imageUrl = input.imageUrl;

    return metadata;
  }

  private resolveAppUrl(defaultOrigin?: string, providedUrl?: string): string | undefined {
    const candidate = providedUrl || defaultOrigin;
    if (!candidate) {
      return undefined;
    }

    try {
      const url = new URL(candidate, defaultOrigin);
      return url.toString();
    } catch {
      return defaultOrigin;
    }
  }

  private deriveAppName(source?: string): string | undefined {
    if (!source) {
      return undefined;
    }

    try {
      const hostname = new URL(source).hostname;
      return hostname || source;
    } catch {
      return source;
    }
  }

  public getThru(): Thru {
    return this.thruClient;
  }

  private async resolveDepositDestination(
    destination?: DepositDestination
  ): Promise<{ destination: DepositDestination; walletAddress: string }> {
    const selectedAccount = this.provider.getSelectedAccount();
    if (!selectedAccount) {
      throw new Error('Wallet not connected');
    }
    if (destination) {
      const snapshot = this.preparedDepositSnapshots.get(destination);
      if (snapshot) {
        const canonicalDestination = getReusablePreparedDepositDestination(
          destination,
          snapshot,
          selectedAccount.address
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
        : DepositTarget.THRUSD
    );
    return {
      destination: destination
        ? getValidatedDepositDestination(destination, expected)
        : expected,
      walletAddress: selectedAccount.address,
    };
  }

  private signDepositTransaction(
    payload: SignDepositTransactionPayload
  ): Promise<string> {
    return signDepositTransactionWithActiveSession(this.thru, payload);
  }

  private refreshCachedAccounts(accounts: WalletAccount[], selectedAccount?: WalletAccount | null): void {
    const active = normalizeActiveWalletAccounts(accounts, selectedAccount);

    if (this.lastConnectResult) {
      this.lastConnectResult = {
        ...this.lastConnectResult,
        accounts: active.accounts,
        selectedAccount: active.selectedAccount,
      };
    }
  }

  private setWalletAvailability(availability: WalletAvailability): void {
    this.walletAvailability = availability;
    this.emit('availabilityChanged', availability);
  }

  private async applyConnectionState(
    state: GetConnectionStateResult,
    requestedMetadata?: ConnectMetadataInput,
  ): Promise<void> {
    const result = connectionResultFromState(state);
    if (!result) {
      const wasConnected = this.provider.isConnected() || !!this.lastConnectResult;
      this.provider.clearConnection();
      this.lastConnectResult = null;
      if (wasConnected) this.emit('disconnect', { reason: 'state_unavailable' });
      return;
    }

    const normalized = normalizeActiveWalletAccounts(
      result.accounts,
      result.selectedAccount,
    );
    this.lastConnectResult = {
      ...result,
      accounts: normalized.accounts,
      selectedAccount: normalized.selectedAccount,
    };
    await this.persistSelectedAccount(
      normalized.selectedAccount?.address ?? null,
    );
    this.emit('connect', this.lastConnectResult);
  }

  private async readConnectionHint() {
    try {
      return (await this.connectionHints?.read()) ?? null;
    } catch {
      // The storage adapter has already recorded value-free diagnostics.
      return null;
    }
  }

  private async persistSelectedAccount(
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
      // A failed preference write must not undo wallet authorization.
    }
  }
}
