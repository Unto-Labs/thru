import { TELEMETRY_EVENTS } from '@thru/observability';
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
  type ManageAccountsResult,
  type PrepareDepositPayload,
  type ThruNetwork,
} from './protocol';
import {
  ensureDepositAccountForWallet,
  formatDepositAmount,
  getDepositAccountStateForWallet,
  waitForDepositBalanceForWallet,
  type DepositAccountState,
  type DepositsApi,
  type EnsureDepositAccountParams,
  type GetDepositAccountStateParams,
  type SignDepositTransactionPayload,
  type WaitForDepositBalanceParams,
} from './deposit';
import {
  SigningSessionDescriptorStore,
  getDefaultBrowserSigningSessionStorage,
  resolveSigningSessionStorageKey,
  type SigningSessionStorage,
} from './signing-sessions';
import { createThruClient, Thru } from '@thru/sdk/client';
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

export interface BrowserSDKConfig {
  iframeUrl?: string;
  /** Share sanitized operational diagnostics with Thru. Defaults to true. */
  telemetryEnabled?: boolean;
  /** Opaque host-app-provided label stamped on telemetry for cross-session
      correlation (e.g. the app's own user or install ID). Never minted or
      interpreted by the SDK. */
  appContextId?: string;
  /** Bounded host-app-provided dimensions stamped on telemetry events
      (at most 5 short keys/values). Never interpreted by the SDK. */
  appContext?: TelemetryAppContext;
  addressTypes?: AddressTypeValue[];
  rpcUrl?: string;
  network?: ThruNetwork;
  depositUiConfig?: DepositUiConfig;
  signingSessionStorage?: SigningSessionStorage | false;
  signingSessionStorageKey?: string;
  transactionSigningScheme?: TransactionSigningScheme;
  deposits?: {
    providers: string[];
  };
}

export interface ConnectOptions {
  metadata?: ConnectMetadataInput;
  /** Custom name for a passkey created during this connect flow. */
  passkeyName?: string;
}

export type SDKEvent = 'connect' | 'disconnect' | 'lock' | 'error' | 'accountChanged';

export type EventCallback = (...args: any[]) => void;

/**
 * Browser SDK - Main entry point for dApp developers
 * Wraps EmbeddedProvider with a clean, simple API
 */
export class BrowserSDK {
  private provider: EmbeddedProvider;
  private telemetry: TelemetryClient;
  private eventListeners = new Map<SDKEvent, Set<EventCallback>>();
  private initialized = false;
  private thruClient: Thru;
  private defaultNetwork?: ThruNetwork;
  private depositProviders: ReadonlySet<string>;
  private connectInFlight: Promise<ConnectResult> | null = null;
  private lastConnectResult: ConnectResult | null = null;

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
    const storage =
      config.signingSessionStorage === false
        ? null
        : config.signingSessionStorage ?? getDefaultBrowserSigningSessionStorage();
    const signingSessions = storage
      ? new SigningSessionDescriptorStore(
          storage,
          resolveSigningSessionStorageKey({
            walletOrigin,
            appOrigin,
            storageKey: config.signingSessionStorageKey,
          }),
        )
      : undefined;

    try {
      this.provider = new EmbeddedProvider({
        iframeUrl,
        addressTypes: config.addressTypes || [AddressType.THRU],
        signingSessions,
        network: config.network,
        depositUiConfig: config.depositUiConfig,
        telemetry: this.telemetry,
      });
    } catch (error) {
      /* Never upload to a wallet origin that failed provider validation. */
      this.telemetry.discard();
      throw error;
    }
    this.telemetry.record(TELEMETRY_EVENTS.SDK_CONSTRUCTED);
    this.defaultNetwork = config.network;
    this.depositProviders = new Set(config.deposits?.providers ?? ['unifold']);

    this.thruClient = createThruClient({
      baseUrl: config.rpcUrl,
    });

    // Forward provider events to SDK events
    this.setupEventForwarding();
  }

  /**
   * Set or clear the opaque host-app correlation label on later telemetry
   * events from this SDK instance (the embedded wallet keeps the label it
   * received at construction).
   */
  setAppContextId(appContextId: string | null): void {
    this.telemetry.setAppContextId(appContextId);
  }

  /**
   * Replace or clear the host-app dimensions on later telemetry events from
   * this SDK instance (the embedded wallet keeps the context it received at
   * construction).
   */
  setContext(context: TelemetryAppContext | null): void {
    this.telemetry.setContext(context);
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
    } catch (error) {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_INITIALIZE_FAILED, {
        operation: 'initialize',
        outcome: 'error',
        severity: 'error',
        durationMs: Date.now() - startedAt,
        errorCode: getTelemetryErrorCode(error),
        message: error,
      });
      throw error;
    }
  }

  /**
   * Connect to wallet
   * Shows wallet modal and requests connection
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
        const metadata = this.resolveMetadata(options?.metadata);
        const passkeyName = sanitizePasskeyName(options?.passkeyName);
        const providerOptions =
          metadata || passkeyName
            ? {
                ...(metadata ? { metadata } : {}),
                ...(passkeyName ? { passkeyName } : {}),
              }
            : undefined;
        const result = await this.provider.connect(providerOptions);
        this.lastConnectResult = result;
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

  /**
   * Get all accounts
   */
  getAccounts(): WalletAccount[] {
    const accounts = this.provider.getAccounts();
    this.refreshCachedAccounts(accounts);
    return accounts;
  }

  getSelectedAccount(): WalletAccount | null {
    return this.provider.getSelectedAccount();
  }

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
    return account;
  }

  async manageAccounts(): Promise<ManageAccountsResult> {
    const startedAt = Date.now();
    this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_MANAGEMENT_STARTED, {
      operation: 'manage_accounts',
    });
    const result = await this.provider.manageAccounts();
    this.refreshCachedAccounts(result.accounts, result.selectedAccount);
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
    return this.provider.prepareDeposit({
      ...payload,
      network: payload.network ?? this.defaultNetwork,
    });
  }

  /**
   * Open the wallet's Deposit ("Add funds") screen for a token account.
   * Resolves with the terminal UX state once the user completes or cancels.
   *
   * @deprecated Use `deposits.open()`.
   */
  async deposit(payload: DepositRequestPayload): Promise<DepositResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    const providerId = payload.providerId ?? 'unifold';
    if (!this.depositProviders.has(providerId)) {
      throw new Error(`Deposit provider is not configured: ${providerId}`);
    }
    return this.provider.deposit({ ...payload, providerId });
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

  /** @deprecated Use `deposits.waitForBalance()`. */
  async waitForDepositBalance(
    params: WaitForDepositBalanceParams
  ): Promise<DepositAccountState> {
    if (!this.initialized) {
      await this.initialize();
    }
    const { destination, walletAddress } =
      await this.resolveDepositDestination(params.destination);
    return waitForDepositBalanceForWallet({
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

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.LOCK, (data: any) => {
      this.telemetry.record(TELEMETRY_EVENTS.SDK_WALLET_LOCKED, {
        operation: 'lock',
        outcome: 'locked',
      });
      this.emit('lock', data);
      this.emit('disconnect', { reason: 'locked' });
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, (data: any) => {
      const account = data?.account ?? data;
      this.telemetry.record(TELEMETRY_EVENTS.SDK_ACCOUNT_CHANGED, {
        operation: 'account_changed',
        outcome: account ? 'selected' : 'cleared',
        walletAddress: account?.address,
      });
      this.refreshCachedAccounts(this.provider.getAccounts(), account ?? null);
      this.emit('accountChanged', account);
    });
  }

  /**
   * Destroy SDK and cleanup
   */
  destroy(): void {
    this.telemetry.record(TELEMETRY_EVENTS.SDK_DESTROYED, {
      operation: 'destroy',
      outcome: 'success',
    });
    this.provider.destroy();
    this.eventListeners.clear();
    this.initialized = false;
    this.connectInFlight = null;
    this.lastConnectResult = null;
    this.telemetry.destroy();
  }

  private resolveMetadata(input?: ConnectMetadataInput): ConnectMetadataInput | undefined {
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
    const expected = await this.prepareDeposit(
      destination
        ? {
            network: destination.network,
            depositTarget: destination.depositTarget,
          }
        : DepositTarget.Credits
    );
    if (destination) {
      assertDepositDestinationMatches(destination, expected);
    }
    return { destination: expected, walletAddress: selectedAccount.address };
  }

  private signDepositTransaction(
    payload: SignDepositTransactionPayload
  ): Promise<string> {
    return this.thru.signTransaction({
      walletAddress: payload.walletAddress,
      programAddress: payload.programAddress,
      instructionData: payload.trailingInstructionData,
      readWriteAddresses: payload.readWriteAddresses,
      readOnlyAddresses: payload.readOnlyAddresses,
      review: payload.review,
    });
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
}

function assertDepositDestinationMatches(
  actual: DepositDestination,
  expected: DepositDestination
): void {
  const mismatches = (Object.keys(expected) as Array<keyof DepositDestination>)
    .filter((key) => actual[key] !== expected[key]);
  if (mismatches.length > 0) {
    throw new Error(
      `Prepared deposit destination no longer matches wallet config: ${mismatches.join(', ')}`
    );
  }
}
