import { TELEMETRY_EVENTS, type TelemetryAppContext } from '../observability';
import { getErrorCode } from '../internal/telemetry-fields';
import {
  AddressType,
  normalizeWalletAccountResult,
  resolveWalletAccountByAddress,
} from '../interfaces';
import type {
  AddressType as AddressTypeValue,
  ConnectResult,
  IThruChain,
  WalletAccount,
} from '../interfaces';
import {
  DEFAULT_IFRAME_URL,
  EMBEDDED_PROVIDER_EVENTS,
  POST_MESSAGE_REQUEST_TYPES,
  createRequestId,
  type ConnectMetadataInput,
  type ConnectRequestPayload,
  type DepositDestination,
  type DepositRequestMessagePayload,
  type DepositResult,
  type DepositUiConfig,
  type GetConnectionStateResult,
  type ManageAccountsResult,
  type AccountMenuPayload,
  type AccountMenuResult,
  type WalletTheme,
  type PrepareDepositPayload,
  type SelectAccountPayload,
  type ThruNetwork,
  normalizeConnectionStateResult,
} from '../protocol';
import { connectionResultFromState } from '../connection-state';
import { IframeManager } from './IframeManager';
import { EmbeddedThruChain } from './chains/ThruChain';
import type { SigningSessionDescriptorStore } from '../signing-sessions';
import type { TelemetryClient } from '../telemetry';

export interface EmbeddedProviderConfig {
  iframeUrl?: string;
  /** The host page's color scheme; the wallet frames draw to match. */
  theme?: WalletTheme;
  addressTypes?: AddressTypeValue[];
  signingSessions?: SigningSessionDescriptorStore;
  broadcastTransaction?: (signedTransaction: string) => Promise<unknown>;
  network?: ThruNetwork;
  depositUiConfig?: DepositUiConfig;
  /** Shared SDK telemetry client. @internal */
  telemetry?: TelemetryClient;
}

export interface ConnectOptions {
  metadata?: ConnectMetadataInput;
  passkeyName?: string;
  preferredAccountAddress?: string;
  intent?: ConnectRequestPayload['intent'];
}

/**
 * Main embedded provider class
 * Manages iframe lifecycle, connection state, and chain-specific interfaces
 */
export class EmbeddedProvider {
  private iframeManager: IframeManager;
  private _thruChain?: IThruChain;
  private connected = false;
  private accounts: WalletAccount[] = [];
  private selectedAccount: WalletAccount | null = null;
  private eventListeners = new Map<string, Set<Function>>();
  private inlineMode = false;
  private defaultNetwork?: ThruNetwork;
  private depositUiConfig?: DepositUiConfig;
  private telemetry?: TelemetryClient;
  constructor(config: EmbeddedProviderConfig) {
    const iframeUrl = config.iframeUrl || DEFAULT_IFRAME_URL;
    this.telemetry = config.telemetry;
    this.iframeManager = new IframeManager(iframeUrl, this.telemetry, { theme: config.theme });
    this.defaultNetwork = config.network;
    this.depositUiConfig = config.depositUiConfig;
    this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_CONSTRUCTED, {
      source: 'sdk',
      severity: 'debug',
    });

    // Set up event forwarding from iframe
    this.iframeManager.onEvent = (eventType: string, payload: any) => {
      this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_EVENT_RECEIVED, {
        source: 'bridge',
        operation: eventType,
      });
      this.emit(eventType, payload);

      if (eventType === EMBEDDED_PROVIDER_EVENTS.UI_SHOW) {
        if (this.inlineMode) {
          this.iframeManager.showInline();
        } else {
          this.iframeManager.showModal();
        }
        return;
      }

      if (eventType === EMBEDDED_PROVIDER_EVENTS.DISCONNECT) {
        this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_CONNECTION_CLEARED, {
          source: 'sdk',
          operation: eventType,
          outcome: 'disconnected',
        });
        this.clearConnection();
        return;
      }

      if (eventType === EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED) {
        const account =
          (payload && (payload.account as WalletAccount | undefined)) || null;
        this.refreshAccountCache(account ?? null);
        this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_ACCOUNT_CHANGED, {
          source: 'sdk',
          operation: 'account_changed',
          outcome: account ? 'selected' : 'cleared',
          walletAddress: account?.address,
        });
      }
    };

    // Create chain instances
    const addressTypes = config.addressTypes || [AddressType.THRU];
    if (addressTypes.includes(AddressType.THRU)) {
      this._thruChain = new EmbeddedThruChain(
        this.iframeManager,
        this,
        config.signingSessions,
        config.broadcastTransaction,
      );
    }
  }

  /** Record the load-time correlation values already carried by the iframe URL. */
  primeTelemetryContext(
    appContextId: string | null,
    context: TelemetryAppContext | null,
  ): void {
    this.iframeManager.primeTelemetryContext(appContextId, context);
  }

  /** Set or clear the correlation label carried by wallet telemetry. */
  setTelemetryAppContextId(value: string | null): void {
    this.iframeManager.setTelemetryAppContextId(value);
  }

  /** Set or clear the host-app dimensions carried by wallet telemetry. */
  setTelemetryContext(value: TelemetryAppContext | null): void {
    this.iframeManager.setTelemetryContext(value);
  }

  /**
   * Initialize the provider (must be called before use)
   * Creates iframe and waits for it to be ready
   */
  async initialize(): Promise<void> {
    await this.iframeManager.createIframe();
  }

  getWalletOrigin(): string {
    return this.iframeManager.getWalletOrigin();
  }

  /**
   * Mount the wallet iframe inline in a container (for inline connect button).
   */
  async mountInline(container: HTMLElement): Promise<void> {
    this.inlineMode = true;
    await this.iframeManager.mountInline(container);
  }

  /**
   * Connect to wallet
   * Shows iframe modal and requests connection
   */
  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    // Emit connecting event
    this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT_START, {});

    try {
      if (this.inlineMode) {
        this.iframeManager.showInline();
      } else {
        this.iframeManager.showModal();
      }

      const payload: ConnectRequestPayload = {};

      if (options?.metadata) {
        payload.metadata = options.metadata;
      }
      if (options?.preferredAccountAddress) {
        payload.preferredAccountAddress = options.preferredAccountAddress;
      }
      if (options?.intent) {
        payload.intent = options.intent;
      }

      if (options?.passkeyName) {
        payload.passkeyName = options.passkeyName;
      }

      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.CONNECT,
        payload,
        origin: window.location.origin,
      });

      const result = normalizeWalletAccountResult(response.result);
      this.connected = true;
      this.accounts = result.accounts;
      this.selectedAccount = result.selectedAccount;
      this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_CONNECTED, {
        source: 'sdk',
        operation: 'connect',
        outcome: 'success',
        walletAddress: result.selectedAccount?.address,
      });

      // Emit success event
      this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT, result);

      // Hide iframe after successful connection
      if (!this.inlineMode) {
        this.iframeManager.hide();
      }

      return result;
    } catch (error) {
      /* A cancelled sign-in settles only once the wallet sheet has animated
         away, so the host's "Signing in…" state lasts through the exit. */
      if (!this.inlineMode) {
        await this.iframeManager.hide();
      }
      this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT_ERROR, { error });
      this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_CONNECT_FAILED, {
        source: 'sdk',
        operation: 'connect',
        outcome: 'error',
        severity: 'error',
        errorCode: getErrorCode(error),
        message: error,
      });
      throw error;
    }
  }

  async getConnectionState(
    options?: ConnectOptions,
  ): Promise<GetConnectionStateResult> {
    const payload: ConnectRequestPayload = {};
    if (options?.metadata) payload.metadata = options.metadata;
    if (options?.preferredAccountAddress) {
      payload.preferredAccountAddress = options.preferredAccountAddress;
    }

    const response = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE,
      payload,
      origin: window.location.origin,
    });
    const state = normalizeConnectionStateResult(response.result);
    const result = connectionResultFromState(state);
    if (result) {
      this.hydrateConnection(result, state.selectedAccount?.address ?? null);
    } else {
      this.clearConnection();
    }
    return state;
  }

  /**
   * Disconnect from wallet
   */
  async disconnect(): Promise<void> {
    try {
      await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.DISCONNECT,
        origin: window.location.origin,
      });

      this.clearConnection();
      this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_DISCONNECTED, {
        source: 'sdk',
        operation: 'disconnect',
        outcome: 'success',
      });
      this.emit(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, {});
    } catch (error) {
      this.clearConnection();
      this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_DISCONNECT_FAILED, {
        source: 'sdk',
        operation: 'disconnect',
        outcome: 'error',
        severity: 'error',
        errorCode: getErrorCode(error),
        message: error,
      });
      this.emit(EMBEDDED_PROVIDER_EVENTS.ERROR, { error });
      throw error;
    } finally {
      if (!this.inlineMode) {
        this.iframeManager.hide();
      }
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get accounts
   */
  getAccounts(): WalletAccount[] {
    return this.accounts;
  }

  getSelectedAccount(): WalletAccount | null {
    return this.selectedAccount;
  }

  hydrateConnection(
    result: ConnectResult,
    selectedAccountAddress?: string | null,
  ): void {
    const selectedAccount =
      resolveWalletAccountByAddress(result.accounts, selectedAccountAddress) ??
      result.selectedAccount ??
      null;
    const normalized = normalizeWalletAccountResult(result, selectedAccount);
    this.connected = true;
    this.accounts = normalized.accounts;
    this.selectedAccount = normalized.selectedAccount;
  }

  async selectAccount(publicKey: string): Promise<WalletAccount> {
    if (!this.connected) {
      throw new Error("Wallet not connected");
    }

    const knownAccount =
      this.accounts.find((acc) => acc.address === publicKey) ?? null;
    if (!knownAccount) {
      console.warn(
        "[EmbeddedProvider] Selecting account not present in local cache",
      );
    }
    const payload: SelectAccountPayload = { publicKey };

    const response = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.SELECT_ACCOUNT,
      payload,
      origin: window.location.origin,
    });

    const account = response.result.account;

    this.refreshAccountCache(account);
    this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_ACCOUNT_SELECTED, {
      source: 'sdk',
      operation: 'select_account',
      outcome: 'success',
      walletAddress: account.address,
    });
    return account;
  }

  async manageAccounts(): Promise<ManageAccountsResult> {
    if (!this.connected) {
      throw new Error("Wallet not connected");
    }

    if (this.inlineMode) {
      this.iframeManager.showInline();
    } else {
      this.iframeManager.showModal();
    }

    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS,
        origin: window.location.origin,
      });

      const result = response.result;
      this.selectedAccount = result.selectedAccount;
      this.accounts = this.selectedAccount ? [this.selectedAccount] : [];
      if (this.selectedAccount) {
        this.emit(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, {
          account: this.selectedAccount,
        });
      }
      return result;
    } finally {
      if (!this.inlineMode) {
        this.iframeManager.hide();
      }
    }
  }

  getTheme(): WalletTheme {
    return this.iframeManager.getTheme();
  }

  /** Restyle the wallet frames for a new host color scheme, without a reload. */
  setTheme(theme: WalletTheme): void {
    this.iframeManager.setTheme(theme);
  }

  /**
   * Open the wallet's account menu inside its frame, anchored under the host's
   * account chip. Resolves when the menu closes; a switch or an account
   * manager run comes back with the resulting accounts.
   */
  async openAccountMenu(payload: AccountMenuPayload): Promise<AccountMenuResult> {
    if (!this.connected) {
      throw new Error("Wallet not connected");
    }

    if (this.inlineMode) {
      this.iframeManager.showInline();
    } else {
      this.iframeManager.showModal();
    }

    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.ACCOUNT_MENU,
        payload,
        origin: window.location.origin,
      });
      const result = response.result;
      if (result.accounts) {
        const normalized = normalizeWalletAccountResult({
          accounts: result.accounts,
          selectedAccount: result.selectedAccount ?? null,
        });
        this.accounts = normalized.accounts;
        this.selectedAccount = normalized.selectedAccount;
        if (this.selectedAccount) {
          this.emit(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, {
            account: this.selectedAccount,
          });
        }
      }
      return result;
    } finally {
      if (!this.inlineMode) {
        await this.iframeManager.hide();
      }
    }
  }

  /**
   * Derive the deposit destination inside the wallet iframe, where the selected
   * wallet account is authoritative.
   */
  async prepareDeposit(
    depositTargetOrPayload?: PrepareDepositPayload['depositTarget'] | PrepareDepositPayload
  ): Promise<DepositDestination> {
    const payload =
      typeof depositTargetOrPayload === 'string'
        ? { depositTarget: depositTargetOrPayload }
        : depositTargetOrPayload ?? {};
    const response = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT,
      payload: { ...payload, network: payload.network ?? this.defaultNetwork },
      origin: window.location.origin,
    });

    return response.result;
  }

  /**
   * Open the wallet's Deposit ("Add funds") screen for a token account and
   * resolve once the user completes or cancels the flow. The wallet runs the
   * third-party deposit widget; crediting is authoritative on the server
   * webhook, so the returned result only reports the terminal UX state.
   */
  async deposit(payload: DepositRequestMessagePayload): Promise<DepositResult> {
    if (this.inlineMode) {
      this.iframeManager.showInline();
    } else {
      this.iframeManager.showModal();
    }

    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.DEPOSIT,
        payload: {
          ...payload,
          ...(payload.destination || payload.network || !this.defaultNetwork
            ? {}
            : { network: this.defaultNetwork }),
          ...(this.depositUiConfig
            ? { resolvedDepositUiConfig: this.depositUiConfig }
            : {}),
        },
        origin: window.location.origin,
      });

      return response.result;
    } finally {
      if (!this.inlineMode) {
        this.iframeManager.hide();
      }
    }
  }

  /**
   * Get Thru chain API
   */
  get thru(): IThruChain {
    if (!this._thruChain) {
      throw new Error("Thru chain not enabled in provider config");
    }
    return this._thruChain;
  }

  /**
   * Event emitter: on
   */
  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Event emitter: off
   */
  off(event: string, callback: Function): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: string, data?: any): void {
    this.eventListeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  /**
   * Get iframe manager (for chain implementations)
   * @internal
   */
  getIframeManager(): IframeManager {
    return this.iframeManager;
  }

  /**
   * Destroy provider and cleanup
   */
  destroy(): void {
    this.telemetry?.record(TELEMETRY_EVENTS.PROVIDER_DESTROYED, {
      source: 'sdk',
      severity: 'debug',
    });
    this.iframeManager.destroy();
    this.eventListeners.clear();
    this.clearConnection();
  }

  private refreshAccountCache(account: WalletAccount | null): void {
    if (!account) {
      this.accounts = [];
      this.selectedAccount = null;
      return;
    }

    this.accounts = [account];
    this.selectedAccount = account;
  }

  clearConnection(): void {
    this.connected = false;
    this.accounts = [];
    this.selectedAccount = null;
  }
}

