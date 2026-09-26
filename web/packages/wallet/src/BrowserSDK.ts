import {
  withWalletNetwork,
  networkScopedStorage,
  type ResolvedWalletNetwork,
  type WalletNetworkSelection,
} from './networks';
import { TELEMETRY_EVENTS } from './observability';
import { AddressType, normalizeActiveWalletAccounts } from './interfaces';
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
  ErrorCode,
  DepositTarget,
  type ConnectMetadataInput,
  sanitizePasskeyName,
  type DepositDestination,
  type DepositRequestPayload,
  type DepositResult,
  type DepositUiConfig,
  type GetConnectionStateResult,
  type WalletRestoreRecord,
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
  /**
   * Developer mode (default off): the wallet shows raw errors with a Copy
   * action, runs card purchases on Coinbase's sandbox, and offers the test
   * faucet in Add funds. The wallet also has its own switch in its account
   * menu; either one turns it on. Change it later with setDeveloperMode().
   */
  developerMode?: boolean;
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
  /** Absolute RPC URLs select the wallet network too. A root-relative app
   * proxy (e.g. /api/grpc) is only an SDK transport; use walletNetwork to
   * select its underlying network, or retain the wallet deployment default. */
  rpcUrl?: string;
  walletNetwork?: WalletNetworkSelection;
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

/** What a restore asks the wallet with: the hint's address and its record. */
type RestoreConnectOptions = ConnectOptions & {
  preferredAccountAddress?: string;
  restore?: WalletRestoreRecord;
};

export type SDKEvent =
  | 'networkChanged'
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

type StandaloneNavigator = Navigator & { standalone?: boolean };

const PWA_DISPLAY_MODES = [
  'standalone',
  'fullscreen',
  'minimal-ui',
  'window-controls-overlay',
] as const;

type PwaDisplayMode = (typeof PWA_DISPLAY_MODES)[number];

function getPwaDisplayMode(): PwaDisplayMode | null {
  if (typeof window === 'undefined') return null;

  if (typeof window.matchMedia === 'function') {
    for (const mode of PWA_DISPLAY_MODES) {
      try {
        if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
      } catch {
        /* A broken media-query implementation must not affect SDK startup. */
      }
    }
  }

  return typeof navigator !== 'undefined' &&
    (navigator as StandaloneNavigator).standalone === true
    ? 'standalone'
    : null;
}

/**
 * Browser SDK - Main entry point for dApp developers
 * Wraps EmbeddedProvider with a clean, simple API
 */
export class BrowserSDK implements WalletSDK {
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
      throw new Error('Add funds unavailable on this network');
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
    this.thruClient = createThruClient({
      baseUrl: network.transportUrl ?? network.rpcUrl,
      transactionSigningScheme: network.transactionSigningScheme,
    });
    this.setWalletAvailability(disconnectedWalletAvailability());
    if (previous) this.emit('disconnect', { reason: 'network_changed' });
    this.emit('networkChanged', network);
  }

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
  private stopWatchingPwaInstall: (() => void) | null = null;

  readonly connection: ConnectionApi = {
    connect: (options) => this.connect(options),
    disconnect: () => this.disconnect(),
    getState: () => this.getWalletAvailability(),
    refresh: (options) => this.refreshWalletAvailability(options),
    hasRememberedConnection: () => this.hasRememberedConnection(),
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
    getProviders: async () => this.availableDepositProviders(),
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

  /**
   * Turn this app's developer mode on or off. Open and future wallet
   * surfaces follow; the wallet is not reloaded. Turning it off leaves the
   * wallet's own account-menu switch as it was.
   */
  setDeveloperMode(enabled: boolean): void {
    this.provider.setDeveloperMode(enabled === true);
  }

  constructor(config: BrowserSDKConfig = {}) {
    this.requiresNetworkProtocol = config.walletNetwork !== undefined;
    // A same-origin app proxy does not identify its upstream network and must
    // not be resolved against the hosted wallet's origin (or during SSR).
    const rpcUrl = config.rpcUrl?.trim();
    const appProxy =
      rpcUrl?.startsWith('/') && !rpcUrl.startsWith('//') && !rpcUrl.includes('\\');
    const configuredIframeUrl = withWalletNetwork(
      withTransactionSigningScheme(
      config.iframeUrl ?? DEFAULT_IFRAME_URL,
      config.transactionSigningScheme,
      ),
      config.walletNetwork,
      appProxy ? undefined : rpcUrl,
      JSON.stringify([
        typeof window === 'undefined' ? '' : window.location.origin,
        config.metadata?.appId ?? '',
      ]),
    );
    const telemetryEnabled = config.telemetryEnabled ?? true;
    const telemetrySessionId = createTelemetrySessionId();
    const pwaDisplayMode = getPwaDisplayMode();
    const appMode = pwaDisplayMode ? 'pwa' : 'browser';
    const iframeUrl = withTelemetryParameters(
      configuredIframeUrl,
      telemetryEnabled,
      telemetrySessionId,
      config.appContextId,
      config.appContext,
      appMode,
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
        appMode,
        network: config.network,
      },
    });
    const defaultStorage =
      config.storage === false
        ? null
        : (config.storage ?? getDefaultBrowserSigningSessionStorage());
    const storage =
      config.signingSessionStorage === false
        ? null
        : (config.signingSessionStorage ?? defaultStorage);
    const signingSessions = storage
      ? new SigningSessionDescriptorStore(
          networkScopedStorage(
          storage,
            () => this.activeNetwork?.scope ?? 'pending',
          ),
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
        : (config.connectionStorage ??
          defaultStorage ??
          getDefaultBrowserConnectionStorage());

    this.thruClient = createThruClient({
      baseUrl: rpcUrl,
      transactionSigningScheme: config.transactionSigningScheme,
    });

    this.themePreference = normalizeWalletThemePreference(config.theme);
    this.systemTheme = readSystemTheme();

    try {
      this.provider = new EmbeddedProvider({
        iframeUrl,
        theme: resolveWalletTheme(this.themePreference, this.systemTheme),
        developerMode: config.developerMode === true,
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
    this.startPwaTelemetry(pwaDisplayMode);
    this.defaultNetwork = config.network;
    this.defaultMetadata = config.metadata;
    this.autoRestore = config.autoRestore ?? true;
    this.connectionHints = connectionStorage
      ? new ConnectionHintStore(
          networkScopedStorage(
          connectionStorage,
            () => this.activeNetwork?.scope ?? 'pending',
          ),
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
    this.provider.setTelemetryAppContextId(
      this.telemetry.getAppContextId() ?? null,
    );
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
      if (
        this.requiresNetworkProtocol &&
        !this.provider.supportsNetworkSwitching()
      )
        throw new Error(
          'Wallet network selection requires a compatible hosted wallet.',
        );
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
        restore: hint?.restore,
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
      this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECT_STARTED, {
        operation: 'connect',
      });
      try {
        const hint = await this.readConnectionHint();
        const metadata = this.resolveMetadata(
          options?.metadata ?? this.defaultMetadata,
        );
        const passkeyName = sanitizePasskeyName(options?.passkeyName);
        const providerOptions = {
          ...(metadata ? { metadata } : {}),
          ...(passkeyName ? { passkeyName } : {}),
          ...((options?.preferredAccountAddress ?? hint?.selectedAccountAddress)
            ? {
                preferredAccountAddress:
                  options?.preferredAccountAddress ??
                  hint?.selectedAccountAddress,
              }
            : {}),
          ...(options?.intent ? { intent: options.intent } : {}),
          /* A wallet whose own store is empty rebuilds this host's
             authorization from the record, and connects without a ceremony. */
          ...(hint?.restore ? { restore: hint.restore } : {}),
        };
        const scope = this.activeNetwork?.scope;
        const { restore, ...result } = await this.provider.connect(providerOptions);
        if (scope !== this.activeNetwork?.scope)
          throw new Error('Wallet network changed; reconnect.');
        this.lastConnectResult = result;
        await this.persistSelectedAccount(result.selectedAccount?.address ?? null, restore);
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
    /* The hint goes before the wallet is asked: a host quit between the
       wallet revoking the session and this clear would otherwise leave a
       record that restores the session the user just left. It comes back
       only when the wallet says it kept the session (the user cancelled the
       sign-out). Any other failure leaves it cleared: a lost answer, a
       timeout or a revoke error cannot be told apart from a sign-out whose
       response never arrived, and a cleared hint only costs the next launch
       a passkey, while a restored one would replay the session the user
       just left. */
    const previousHint = await this.readConnectionHint();
    try {
      await this.connectionHints?.clear();
    } catch {
      // A hint that cannot be cleared is reported by the storage adapter.
    }
    try {
      await this.provider.disconnect();
      this.telemetry.record(TELEMETRY_EVENTS.SDK_DISCONNECT_COMPLETED, {
        operation: 'disconnect',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });
      this.emit('disconnect', {});
      this.lastConnectResult = null;
      await this.signingSessions?.clear();
      this.setWalletAvailability(
        disconnectedWalletAvailability(this.walletAvailability),
      );
    } catch (error) {
      if (previousHint && getTelemetryErrorCode(error) === ErrorCode.USER_REJECTED) {
        await this.connectionHints
          ?.write({
            selectedAccountAddress: previousHint.selectedAccountAddress,
            restore: previousHint.restore ?? null,
          })
          .catch(() => {});
      }
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
    options?: RestoreConnectOptions,
  ): Promise<GetConnectionStateResult | null> {
    try {
      if (!this.initialized) {
        await this.provider.initialize();
        this.initialized = true;
      }
      const metadata = this.resolveMetadata(options?.metadata ?? this.defaultMetadata);
      /* Read at send time rather than kept in memory: another tab of this
         host may have signed out (and cleared it) since this one loaded. */
      const restore = options?.restore ?? (await this.readConnectionHint())?.restore;
      const state = await this.provider.getConnectionState({
        ...(metadata ? { metadata } : {}),
        ...(options?.preferredAccountAddress
          ? { preferredAccountAddress: options.preferredAccountAddress }
          : {}),
        ...(restore ? { restore } : {}),
      });
      const availability = walletAvailabilityFromConnectionState(state);
      this.setWalletAvailability(availability);
      await this.applyConnectionState(state, metadata, { sentRestore: Boolean(restore) });
      return state;
    } catch (error) {
      this.setWalletAvailability(walletAvailabilityFromError(error));
      this.emit('error', error);
      return null;
    }
  }

  async refreshWalletAvailability(
    options?: RestoreConnectOptions,
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
    const { account, restore } = await this.provider.selectAccount(publicKey);
    this.refreshCachedAccounts(this.provider.getAccounts(), account);
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_SELECTION_COMPLETED, {
      operation: 'select_account',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      walletAddress: account.address,
    });
    await this.persistSelectedAccount(account.address, restore);
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
    /* The record is for the host's storage, never for the host's code. */
    const { restore, ...result } = await this.provider.manageAccounts();
    this.refreshCachedAccounts(
      result.selectedAccount ? [result.selectedAccount] : [],
      result.selectedAccount,
    );
    await this.persistSelectedAccount(result.selectedAccount?.address ?? null, restore);
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
  async openAccountMenu(
    options: AccountMenuPayload,
  ): Promise<AccountMenuResult> {
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_MANAGEMENT_STARTED, {
      operation: 'account_menu',
    });
    const { restore, ...result } = await this.provider.openAccountMenu(options);
    if (result.action === 'signed-out') {
      /* The wallet's disconnect event clears this too, but not before the
         menu's response arrives; a host quit in between would otherwise
         restore the session the user just left. */
      await this.connectionHints?.clear().catch(() => {});
    }
    if (result.accounts) {
      this.refreshCachedAccounts(result.accounts, result.selectedAccount ?? null);
      if (result.selectedAccount?.address) {
        await this.persistSelectedAccount(result.selectedAccount.address, restore);
      }
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
    depositTargetOrPayload?:
      PrepareDepositPayload['depositTarget'] | PrepareDepositPayload,
  ): Promise<DepositDestination> {
    if (!this.initialized) {
      await this.initialize();
    }
    const payload =
      typeof depositTargetOrPayload === 'string'
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
    this.assertDepositNetwork(payload.destination?.network);
    if (!this.availableDepositProviders().length)
      throw new Error('Add funds unavailable on this network');
    const providerId =
      payload.providerId ??
      (payload.method === 'card'
        ? 'coinbase'
        : payload.method === 'crypto' || payload.destination
          ? 'unifold'
          : undefined);
    if (
      providerId !== undefined &&
      !this.availableDepositProviders().includes(providerId)
    ) {
      throw new Error(`Deposit provider is not configured: ${providerId}`);
    }
    return this.provider.deposit({
      ...payload,
      ...(providerId ? { providerId } : {}),
      ...(payload.amount && !payload.paymentAmount
        ? { paymentAmount: payload.amount }
        : {}),
      enabledProviders: this.availableDepositProviders(),
    });
  }

  /** @deprecated Use `deposits.ensureAccount()`. */
  async ensureDepositAccount(
    params: EnsureDepositAccountParams = {},
  ): Promise<DepositAccountState> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.provider.withNetworkOperation(async () => {
      this.assertDepositNetwork(params.destination?.network);
      const { destination, walletAddress } = await this.resolveDepositDestination(
        params.destination,
      );
      return ensureDepositAccountForWallet({
        thru: this.thruClient,
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
    if (!this.initialized) {
      await this.initialize();
    }
    return this.provider.withNetworkOperation(async () => {
      this.assertDepositNetwork(params.destination?.network);
      const { destination, walletAddress } = await this.resolveDepositDestination(
        params.destination,
      );
      return getDepositAccountStateForWallet({
        thru: this.thruClient,
        walletAddress,
        destination,
      });
    });
  }

  /** @deprecated Use `deposits.waitForDeposit()`. */
  async waitForDepositBalance(
    params: WaitForDepositParams,
  ): Promise<DepositAccountState> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.provider.withNetworkOperation(async () => {
      this.assertDepositNetwork(params.destination?.network);
      const { destination, walletAddress } = await this.resolveDepositDestination(
        params.destination,
      );
      return waitForDepositForWallet({
        thru: this.thruClient,
        walletAddress,
        destination,
        minimumBalanceRaw: params.minimumBalanceRaw,
        signature: params.signature,
      });
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
    this.eventListeners.get(event)?.forEach((callback) => {
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
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.NETWORK_CHANGED, (data: any) =>
      this.applyNetwork(data),
    );
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
      this.setWalletAvailability(
        disconnectedWalletAvailability(this.walletAvailability),
      );
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
    this.stopWatchingPwaInstall?.();
    this.stopWatchingPwaInstall = null;
    this.provider.destroy();
    this.eventListeners.clear();
    this.initialized = false;
    this.connectInFlight = null;
    this.lastConnectResult = null;
    this.telemetry.destroy();
    this.walletAvailability = CHECKING_WALLET_AVAILABILITY;
  }

  private startPwaTelemetry(displayMode: PwaDisplayMode | null): void {
    if (typeof window === 'undefined') return;

    if (displayMode) {
      this.telemetry.record(TELEMETRY_EVENTS.PWA_LAUNCHED, {
        operation: 'launch',
        outcome: displayMode,
      });
    }

    if (typeof window.addEventListener !== 'function') return;
    const handleInstalled = () => {
      this.telemetry.record(TELEMETRY_EVENTS.PWA_INSTALL_COMPLETED, {
        operation: 'install',
        outcome: 'installed',
      });
    };
    window.addEventListener('appinstalled', handleInstalled);
    this.stopWatchingPwaInstall = () => {
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }

  private resolveMetadata(
    input?: ConnectMetadataInput,
  ): ConnectMetadataInput | undefined {
    input = input ?? this.defaultMetadata;
    const defaultOrigin =
      typeof window !== 'undefined' ? window.location.origin : undefined;
    if (!defaultOrigin && !input) {
      return undefined;
    }

    const appId = input?.appId || defaultOrigin;
    const appName = input?.appName || this.deriveAppName(defaultOrigin ?? appId);

    const metadata: ConnectMetadataInput = {};
    if (appId) metadata.appId = appId;
    if (appName) metadata.appName = appName;
    if (input?.imageUrl) metadata.imageUrl = input.imageUrl;

    return metadata;
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
    destination?: DepositDestination,
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

  private refreshCachedAccounts(
    accounts: WalletAccount[],
    selectedAccount?: WalletAccount | null,
  ): void {
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
    if (this.activeNetwork) availability = { ...availability, network: this.activeNetwork };
    this.walletAvailability = availability;
    this.emit('availabilityChanged', availability);
  }

  private async applyConnectionState(
    state: GetConnectionStateResult,
    requestedMetadata?: ConnectMetadataInput,
    options: { sentRestore?: boolean } = {},
  ): Promise<void> {
    const result = connectionResultFromState(state);
    if (!result) {
      const wasConnected =
        this.provider.isConnected() || !!this.lastConnectResult;
      this.provider.clearConnection();
      this.lastConnectResult = null;
      if (wasConnected) this.emit('disconnect', { reason: 'state_unavailable' });
      if (options.sentRestore) {
        /* The wallet would not take the record (signed out there, another
           network, another account): do not offer it again every launch. */
        await this.connectionHints?.clear().catch(() => {});
        this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECTION_RESTORE_REJECTED, {
          operation: 'restore',
          outcome: 'rejected',
        });
      }
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
    if (state.restoredFromHost) {
      /* The wallet rebuilt this authorization from the record, so whatever
         else it held for this host is gone, signing-session keys included.
         Drop their descriptors here or the first signing tries a dead session
         before falling back to the passkey. */
      await this.signingSessions?.clear().catch(() => {});
    }
    await this.persistSelectedAccount(
      normalized.selectedAccount?.address ?? null,
      state.restore,
    );
    this.telemetry.record(TELEMETRY_EVENTS.SDK_CONNECTION_RESTORE_RECORDED, {
      operation: 'restore',
      outcome: state.restoredFromHost ? 'rehydrated' : state.restore ? 'stored' : 'absent',
    });
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

  /**
   * Whether the host's storage holds a connection the wallet can rebuild,
   * before the wallet is asked. Only a hint carrying the wallet's restore
   * record counts: an address-only hint (from before records existed) cannot
   * restore anything once the wallet's own storage is gone, and opening the
   * signed-in shell on it would only bounce back to the sign-in screen.
   */
  hasRememberedConnection(): boolean {
    return Boolean(this.connectionHints?.peek()?.restore);
  }

  /**
   * Remember the selected address, and the wallet's restore record for it
   * when the wallet sent one. Without a record the store keeps the one it
   * has only while the address is unchanged.
   */
  private async persistSelectedAccount(
    selectedAccountAddress: string | null,
    restore?: WalletRestoreRecord,
  ): Promise<void> {
    if (!this.connectionHints) return;
    try {
      if (!selectedAccountAddress) {
        await this.connectionHints.clear();
        return;
      }
      await this.connectionHints.write({
        selectedAccountAddress,
        ...(restore ? { restore } : {}),
      });
    } catch {
      // A failed preference write must not undo wallet authorization.
    }
  }
}
