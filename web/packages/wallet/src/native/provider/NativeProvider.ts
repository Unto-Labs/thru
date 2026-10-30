import { withNetworkOperation } from "../../network-operations";
import type { WalletNetworkSelection } from "../../networks";
import {
  TELEMETRY_EVENTS,
  type TelemetryAppContext,
} from "../../observability";
import {
  AddressType,
  normalizeWalletAccountResult,
  resolveWalletAccountByAddress,
  type AddressType as AddressTypeValue,
  type ConnectResult,
  type IThruChain,
  type WalletAccount,
} from "../../interfaces";
import {
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
  POST_MESSAGE_REQUEST_TYPES,
  createRequestId,
  type ConnectMetadataInput,
  type ConnectRequestPayload,
  type DepositDestination,
  type DepositRequestPayload,
  type DepositResult,
  type DepositUiConfig,
  type EmbeddedProviderEvent,
  type GetConnectionStateResult,
  type ManageAccountsResult,
  type PrepareDepositPayload,
  type SelectAccountPayload,
  type ThruNetwork,
  normalizeConnectionStateResult,
} from "../../protocol";
import { NativeThruChain } from "./chains/ThruChain";
import type { SigningSessionDescriptorStore } from "../../signing-sessions";
import {
  WebViewBridge,
  type NativeTelemetryFields,
  type NativeTelemetryRecorder,
  type WebViewMessageEventLike,
  type WebViewRefLike,
} from "./WebViewBridge";
import type { WalletTheme } from "../../protocol";

const DEFAULT_WALLET_URL = "https://app.tid.sh/embedded/native";
const DEFAULT_ORIGIN = "thru-mobile://app";

export interface NativeProviderConfig {
  walletUrl?: string;
  telemetryEnabled?: boolean;
  telemetrySessionId?: string;
  telemetryAppContextId?: string;
  telemetryContext?: TelemetryAppContext;
  telemetry?: NativeTelemetryRecorder;
  origin?: string;
  metadata?: ConnectMetadataInput;
  addressTypes?: AddressTypeValue[];
  signingSessions?: SigningSessionDescriptorStore;
  broadcastTransaction?: (signedTransaction: string) => Promise<unknown>;
  network?: ThruNetwork;
  depositUiConfig?: DepositUiConfig;
  theme?: WalletTheme;
  developerMode?: boolean;
}

export interface ConnectOptions {
  metadata?: ConnectMetadataInput;
  preferredAccountAddress?: string;
  intent?: ConnectRequestPayload["intent"];
  passkeyName?: string;
}

export type NativeProviderEvent = EmbeddedProviderEvent;
export type NativeProviderEventCallback = (data?: unknown) => void;

export class NativeProvider {
  withNetworkOperation<T>(operation: () => Promise<T>): Promise<T> {
    return withNetworkOperation(this.bridge, this.origin, operation);
  }
  supportsNetworkSwitching() {
    return this.bridge.supportsNetworkSwitching();
  }
  getNetwork() {
    return this.bridge.getNetwork();
  }
  async switchNetwork(selection: WalletNetworkSelection) {
    if (!this.bridge.supportsNetworkSwitching())
      throw new Error("This wallet does not support network switching.");
    const response = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.SWITCH_NETWORK,
      payload: selection,
      origin: this.origin,
    });
    await this.bridge.waitForNetwork(
      response.result.scope,
      response.result.name,
    );
    return response.result;
  }

  private readonly bridge: WebViewBridge;
  private readonly origin: string;
  private _thruChain?: IThruChain;
  private connected = false;
  private accounts: WalletAccount[] = [];
  private selectedAccount: WalletAccount | null = null;
  private defaultNetwork?: ThruNetwork;
  private depositUiConfig?: DepositUiConfig;
  private isSurfaceShown = false;
  private readonly surfaceRequests = new Set<symbol>();
  private connectionRevision = 0;
  private readonly telemetry?: NativeTelemetryRecorder;
  private readonly eventListeners = new Map<
    string,
    Set<NativeProviderEventCallback>
  >();

  public onShowRequested?: (reason?: string) => void;
  public onHideRequested?: (reason?: string) => void;

  constructor(config: NativeProviderConfig = {}) {
    const walletUrl = config.walletUrl ?? DEFAULT_WALLET_URL;
    this.origin = config.origin ?? DEFAULT_ORIGIN;
    this.defaultNetwork = config.network;
    this.depositUiConfig = config.depositUiConfig;
    this.telemetry = config.telemetry;
    this.bridge = new WebViewBridge({
      walletUrl,
      telemetryEnabled: config.telemetryEnabled ?? true,
      telemetrySessionId: config.telemetrySessionId,
      telemetryAppContextId: config.telemetryAppContextId,
      telemetryContext: config.telemetryContext,
      telemetry: config.telemetry,
      theme: config.theme,
      developerMode: config.developerMode,
    });
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_PROVIDER_CONSTRUCTED, {
      severity: "info",
      outcome: "created",
      ...(config.network ? { network: config.network } : {}),
    });

    this.bridge.onEvent = (eventType, payload) => {
      this.emit(eventType as NativeProviderEvent, payload);

      if (eventType === EMBEDDED_PROVIDER_EVENTS.UI_SHOW) {
        // UI_SHOW is a notification inside a request, not another request lease.
        // Ignore delayed events after cancellation/completion so they cannot reopen UI.
        if (this.surfaceRequests.size > 0) this.showSurface(eventType);
        return;
      }

      if (eventType === EMBEDDED_PROVIDER_EVENTS.NETWORK_CHANGED) {
        this.clearConnection();
        return;
      }

      if (eventType === EMBEDDED_PROVIDER_EVENTS.DISCONNECT) {
        this.clearConnection();
        this.closeSurface(eventType);
        return;
      }

      if (eventType === EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED) {
        const account =
          (payload as { account?: WalletAccount } | null | undefined)
            ?.account ?? null;
        this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_ACCOUNT_CHANGED, {
          severity: "info",
          outcome: account ? "selected" : "cleared",
          walletAddress: account?.address,
        });
        this.refreshAccountCache(account);
      }
    };

    const addressTypes = config.addressTypes ?? [AddressType.THRU];
    if (addressTypes.includes(AddressType.THRU)) {
      this._thruChain = new NativeThruChain(
        this.bridge,
        this,
        this.origin,
        config.signingSessions,
        config.broadcastTransaction,
      );
    }
  }

  setTelemetryAppContextId(value: string | null): void {
    this.bridge.setTelemetryAppContextId(value);
  }

  setTelemetryContext(value: TelemetryAppContext | null): void {
    this.bridge.setTelemetryContext(value);
  }

  getTheme(): WalletTheme {
    return this.bridge.getTheme();
  }

  setTheme(theme: WalletTheme): void {
    this.bridge.setTheme(theme);
  }

  setDeveloperMode(enabled: boolean): void {
    this.bridge.setDeveloperMode(enabled);
  }

  /** Hand the bridge a WebView ref. Required before connect/sign. */
  attachWebView(ref: WebViewRefLike): void {
    this.bridge.attachWebView(ref);
  }

  recordWebViewLoadStarted(): void {
    this.bridge.recordWebViewLoadStarted();
  }

  recordWebViewLoadEnded(): void {
    this.bridge.recordWebViewLoadEnded();
  }

  recordWebViewTransportError(
    code: number | undefined,
    description: string,
  ): void {
    this.bridge.recordWebViewTransportError(code, description);
  }

  recordWebViewHttpError(statusCode: number): void {
    this.bridge.recordWebViewHttpError(statusCode);
  }

  recordWebViewContentProcessTerminated(): void {
    this.bridge.recordWebViewContentProcessTerminated();
  }

  markWebViewReady(): void {
    this.bridge.markReady();
  }

  onMessage = (event: WebViewMessageEventLike): void => {
    this.bridge.onMessage(event);
  };

  /** Build the URL to load inside the shell <iframe>. The host shell
      template should substitute this for WALLET_URL_PLACEHOLDER. */
  getIframeSrc(): string {
    return this.bridge.getIframeSrc();
  }

  /** Wallet origin (e.g. https://app.tid.sh). The shell template
      should substitute this for WALLET_ORIGIN_PLACEHOLDER. */
  getWalletOrigin(): string {
    return this.bridge.walletOrigin;
  }

  async initialize(): Promise<void> {
    await this.bridge.awaitReady();
  }

  /** Hold the standard sheet open for this request, including nested deposit work. */
  async requestShow(reason = "request-started"): Promise<symbol> {
    const request = Symbol(reason);
    this.surfaceRequests.add(request);
    this.showSurface(reason);
    return request;
  }

  /** Release only this request. A late completion must not close a newer sheet. */
  requestHide(reason: string, request: symbol): void {
    if (!this.surfaceRequests.delete(request) || this.surfaceRequests.size > 0)
      return;
    this.hideSurface(reason);
  }

  private showSurface(reason: string): void {
    if (this.isSurfaceShown) return;
    this.isSurfaceShown = true;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_SURFACE_SHOWN, {
      severity: "info",
      operation: reason,
      outcome: "shown",
    });
    this.onShowRequested?.(reason);
  }

  private hideSurface(reason: string): void {
    if (!this.isSurfaceShown) return;
    this.isSurfaceShown = false;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_SURFACE_HIDDEN, {
      severity: "info",
      operation: reason,
      outcome: "hidden",
    });
    this.onHideRequested?.(reason);
  }

  private closeSurface(reason: string): void {
    this.surfaceRequests.clear();
    this.hideSurface(reason);
  }

  /** Reject pending requests after a user-driven sheet dismiss, invalidating old leases. */
  rejectPendingRequests(message?: string, code?: ErrorCode): void {
    this.closeSurface("user-dismissed");
    this.bridge.rejectPendingRequests(message, code);
  }

  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT_START, {});
    const surface = await this.requestShow("connect-open");
    try {
      const payload: ConnectRequestPayload = {};
      if (options?.metadata) payload.metadata = options.metadata;
      if (options?.preferredAccountAddress) {
        payload.preferredAccountAddress = options.preferredAccountAddress;
      }
      if (options?.intent) payload.intent = options.intent;
      if (options?.passkeyName) payload.passkeyName = options.passkeyName;

      const response = await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.CONNECT,
        payload,
        origin: this.origin,
      });

      const result = normalizeWalletAccountResult(response.result);
      if (!result.selectedAccount) {
        throw new Error("Wallet did not return an account");
      }
      this.hydrateConnection(result, result.selectedAccount.address);

      this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT, result);
      this.requestHide("connect-settled", surface);
      return result;
    } catch (error) {
      this.requestHide("connect-error", surface);
      this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT_ERROR, { error });
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

    const response = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE,
      payload,
      origin: this.origin,
    });

    const result = normalizeConnectionStateResult(response.result);

    if (
      result.isAuthorized &&
      result.isConnected &&
      result.accounts.length > 0
    ) {
      this.hydrateConnection(
        {
          accounts: result.accounts,
          status: "completed",
          metadata: result.metadata ?? undefined,
          selectedAccount: result.selectedAccount,
        },
        result.selectedAccount?.address ?? null,
      );
    } else {
      this.clearConnection();
    }

    return result;
  }

  async disconnect(): Promise<void> {
    const connectionRevision = this.connectionRevision;
    const surface = await this.requestShow("disconnect-open");
    try {
      await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.DISCONNECT,
        origin: this.origin,
      });
      if (connectionRevision !== this.connectionRevision) return;
      this.clearConnection();
      this.emit(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, {});
    } catch (error) {
      if (connectionRevision === this.connectionRevision) {
        this.emit(EMBEDDED_PROVIDER_EVENTS.ERROR, { error });
      }
      throw error;
    } finally {
      this.requestHide("disconnect-settled", surface);
    }
  }

  isConnected(): boolean {
    return this.connected;
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
    this.connectionRevision++;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_CONNECTION_HYDRATED, {
      severity: "info",
      outcome: "connected",
      walletAddress: this.selectedAccount?.address,
    });
  }

  clearConnection(): void {
    const walletAddress = this.selectedAccount?.address;
    this.connected = false;
    this.accounts = [];
    this.selectedAccount = null;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_CONNECTION_CLEARED, {
      severity: "info",
      outcome: "disconnected",
      walletAddress,
    });
  }

  getAccounts(): WalletAccount[] {
    return this.accounts;
  }

  getSelectedAccount(): WalletAccount | null {
    return this.selectedAccount;
  }

  async selectAccount(publicKey: string): Promise<WalletAccount> {
    if (!this.connected) throw new Error("Wallet not connected");
    const payload: SelectAccountPayload = { publicKey };
    const response = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.SELECT_ACCOUNT,
      payload,
      origin: this.origin,
    });
    const account = response.result.account;
    this.refreshAccountCache(account);
    return account;
  }

  async manageAccounts(): Promise<ManageAccountsResult> {
    if (!this.connected) throw new Error("Wallet not connected");
    const surface = await this.requestShow("manage-accounts-open");
    try {
      const response = await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS,
        origin: this.origin,
      });

      const result = response.result;
      this.selectedAccount = result.selectedAccount;
      this.accounts = this.selectedAccount ? [this.selectedAccount] : [];
      this.requestHide("manage-accounts-settled", surface);
      return result;
    } catch (error) {
      this.requestHide("manage-accounts-error", surface);
      this.emit(EMBEDDED_PROVIDER_EVENTS.ERROR, { error });
      throw error;
    }
  }

  async prepareDeposit(
    depositTargetOrPayload?:
      PrepareDepositPayload["depositTarget"] | PrepareDepositPayload,
  ): Promise<DepositDestination> {
    const payload =
      typeof depositTargetOrPayload === "string"
        ? { depositTarget: depositTargetOrPayload }
        : (depositTargetOrPayload ?? {});
    const response = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT,
      payload: { ...payload, network: payload.network ?? this.defaultNetwork },
      origin: this.origin,
    });
    return response.result;
  }

  async deposit(payload: DepositRequestPayload): Promise<DepositResult> {
    const surface = await this.requestShow("deposit-open");
    try {
      const response = await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.DEPOSIT,
        payload: {
          ...payload,
          ...(this.depositUiConfig
            ? { resolvedDepositUiConfig: this.depositUiConfig }
            : {}),
        },
        origin: this.origin,
      });
      return response.result;
    } catch (error) {
      this.emit(EMBEDDED_PROVIDER_EVENTS.ERROR, { error });
      throw error;
    } finally {
      this.requestHide("deposit-settled", surface);
    }
  }

  get thru(): IThruChain {
    if (!this._thruChain) {
      throw new Error("Thru chain not enabled in provider config");
    }
    return this._thruChain;
  }

  on(event: NativeProviderEvent, cb: NativeProviderEventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(cb);
  }

  off(event: NativeProviderEvent, cb: NativeProviderEventCallback): void {
    this.eventListeners.get(event)?.delete(cb);
  }

  getBridge(): WebViewBridge {
    return this.bridge;
  }

  destroy(): void {
    this.closeSurface("destroyed");
    this.bridge.destroy();
    this.eventListeners.clear();
    this.clearConnection();
  }

  private emit(event: NativeProviderEvent, data?: unknown): void {
    this.eventListeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error(`[NativeProvider] listener error for ${event}:`, err);
      }
    });
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

  private recordTelemetry(event: string, fields?: NativeTelemetryFields): void {
    try {
      this.telemetry?.(event, { frameId: this.bridge.frameId, ...fields });
    } catch {
      /* Telemetry must never affect wallet behavior. */
    }
  }
}
