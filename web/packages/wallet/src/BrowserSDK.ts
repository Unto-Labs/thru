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
import { EmbeddedProvider } from './provider/EmbeddedProvider';
import {
  DEFAULT_IFRAME_URL,
  EMBEDDED_PROVIDER_EVENTS,
  DepositTarget,
  type ConnectMetadataInput,
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

export interface BrowserSDKConfig {
  iframeUrl?: string;
  addressTypes?: AddressTypeValue[];
  rpcUrl?: string;
  network?: ThruNetwork;
  depositUiConfig?: DepositUiConfig;
  signingSessionStorage?: SigningSessionStorage | false;
  signingSessionStorageKey?: string;
}

export interface ConnectOptions {
  metadata?: ConnectMetadataInput;
}

export type SDKEvent = 'connect' | 'disconnect' | 'lock' | 'error' | 'accountChanged';

export type EventCallback = (...args: any[]) => void;

/**
 * Browser SDK - Main entry point for dApp developers
 * Wraps EmbeddedProvider with a clean, simple API
 */
export class BrowserSDK {
  private provider: EmbeddedProvider;
  private eventListeners = new Map<SDKEvent, Set<EventCallback>>();
  private initialized = false;
  private thruClient: Thru;
  private defaultNetwork?: ThruNetwork;
  private connectInFlight: Promise<ConnectResult> | null = null;
  private lastConnectResult: ConnectResult | null = null;

  readonly deposits: DepositsApi = {
    prepare: (targetOrPayload) => this.prepareDeposit(targetOrPayload),
    ensureAccount: (params) => this.ensureDepositAccount(params),
    open: (payload) => this.deposit(payload),
    getAccountState: (params) => this.getDepositAccountState(params),
    waitForBalance: (params) => this.waitForDepositBalance(params),
    formatAmount: (amountRaw, destination) =>
      this.formatDepositAmount(amountRaw, destination),
  };

  constructor(config: BrowserSDKConfig = {}) {
    const iframeUrl = config.iframeUrl;
    const walletOrigin = new URL(iframeUrl ?? DEFAULT_IFRAME_URL).origin;
    const appOrigin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'unknown';
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

    this.provider = new EmbeddedProvider({
      iframeUrl,
      addressTypes: config.addressTypes || [AddressType.THRU],
      signingSessions,
      network: config.network,
      depositUiConfig: config.depositUiConfig,
    });
    this.defaultNetwork = config.network;

    this.thruClient = createThruClient({
      baseUrl: config.rpcUrl,
    });

    // Forward provider events to SDK events
    this.setupEventForwarding();
  }

  /**
   * Initialize the SDK (creates iframe)
   * Must be called before using the SDK
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.provider.initialize();
    this.initialized = true;
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
      return this.connectInFlight;
    }

    if (this.lastConnectResult && this.provider.isConnected()) {
      return this.lastConnectResult;
    }

    this.emit('connect', { status: 'connecting' });

    const inFlight = (async () => {
      try {
        const metadata = this.resolveMetadata(options?.metadata);
        const providerOptions = metadata ? { metadata } : undefined;
        const result = await this.provider.connect(providerOptions);
        this.lastConnectResult = result;
        this.emit('connect', result);
        return result;
      } catch (error) {
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
    try {
      await this.provider.disconnect();
      this.emit('disconnect', {});
      this.lastConnectResult = null;
    } catch (error) {
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
    const account = await this.provider.selectAccount(publicKey);
    this.refreshCachedAccounts(this.provider.getAccounts(), account);
    return account;
  }

  async manageAccounts(): Promise<ManageAccountsResult> {
    const result = await this.provider.manageAccounts();
    this.refreshCachedAccounts(result.accounts, result.selectedAccount);
    this.emit('accountChanged', result.selectedAccount);
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
    return this.provider.deposit({
      ...payload,
      network: payload.network ?? this.defaultNetwork,
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
      this.emit('disconnect', data);
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ERROR, (data: any) => {
      this.emit('error', data);
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.LOCK, (data: any) => {
      this.emit('lock', data);
      this.emit('disconnect', { reason: 'locked' });
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, (data: any) => {
      const account = data?.account ?? data;
      this.refreshCachedAccounts(this.provider.getAccounts(), account ?? null);
      this.emit('accountChanged', account);
    });
  }

  /**
   * Destroy SDK and cleanup
   */
  destroy(): void {
    this.provider.destroy();
    this.eventListeners.clear();
    this.initialized = false;
    this.connectInFlight = null;
    this.lastConnectResult = null;
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
