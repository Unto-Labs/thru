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
  POST_MESSAGE_REQUEST_TYPES,
  createRequestId,
  type ConnectMetadataInput,
  type ConnectRequestPayload,
  type CreateAccountPayload,
  type CreateAccountResult,
  type EmbeddedProviderEvent,
  type GetConnectionStateResult,
  type ManageAccountsResult,
  type SelectAccountPayload,
  normalizeConnectionStateResult,
} from "../../protocol";
import { NativeThruChain } from "./chains/ThruChain";
import type { SigningSessionDescriptorStore } from "../../signing-sessions";
import {
  WebViewBridge,
  type WebViewMessageEventLike,
  type WebViewRefLike,
} from "./WebViewBridge";
import { resolveSessionExpirySeconds } from "../../signing-sessions";
import type { ThruSigningSessionCreateOptions } from "../../interfaces";

const DEFAULT_WALLET_URL = "https://app.tid.sh/embedded/native";
const DEFAULT_ORIGIN = "thru-mobile://app";
const TRANSPARENT_FOCUS_SETTLE_MS = 500;

export interface NativeProviderConfig {
  /** app.tid.sh/embedded/native URL to load. */
  walletUrl?: string;
  /** Standard bottom-sheet wallet or transparent auto-signing wallet. */
  walletExperience?: "standard" | "transparent";
  /** Caller-supplied dapp origin. Stamped on every postMessage so
      wallet's ConnectedAppsStorage can scope per-host. */
  origin?: string;
  /** Default app metadata used by trusted transparent requests. */
  metadata?: ConnectMetadataInput;
  addressTypes?: AddressTypeValue[];
  signingSessions?: SigningSessionDescriptorStore;
}

export interface ConnectOptions {
  metadata?: ConnectMetadataInput;
  preferredAccountAddress?: string;
  intent?: ConnectRequestPayload["intent"];
}

export interface CreateAccountOptions {
  accountName?: string;
  metadata?: ConnectMetadataInput;
  createSigningSession?: Omit<ThruSigningSessionCreateOptions, "walletAddress" | "review">;
}

export type NativeProviderEvent = EmbeddedProviderEvent;
export type NativeProviderEventCallback = (data?: unknown) => void;

/**
 * RN-side analog of `web/packages/embedded-provider/src/EmbeddedProvider.ts`.
 * Same public surface (connect/disconnect/sign/getAccounts/etc.) over a
 * WebView+iframe bridge instead of a same-origin iframe. Visibility is
 * delegated to the host (ThruWalletSheet) via `requestShow` /
 * `requestHide` callbacks - bottom sheet logic stays in the React layer.
 */
export class NativeProvider {
  private readonly bridge: WebViewBridge;
  private readonly origin: string;
  private readonly transparent: boolean;
  private _thruChain?: IThruChain;
  private connected = false;
  private accounts: WalletAccount[] = [];
  private selectedAccount: WalletAccount | null = null;
  private isSurfaceShown = false;
  private readonly eventListeners = new Map<
    string,
    Set<NativeProviderEventCallback>
  >();

  /** Set by the host bottom sheet to react to UI_SHOW / completion. */
  public onShowRequested?: () => void;
  public onHideRequested?: () => void;

  constructor(config: NativeProviderConfig = {}) {
    const walletUrl = config.walletUrl ?? DEFAULT_WALLET_URL;
    this.origin = config.origin ?? DEFAULT_ORIGIN;
    this.transparent = config.walletExperience === "transparent";
    this.bridge = new WebViewBridge({ walletUrl });

    this.bridge.onEvent = (eventType, payload) => {
      if (this.transparent && eventType === EMBEDDED_PROVIDER_EVENTS.UI_SHOW) {
        return;
      }

      this.emit(eventType as NativeProviderEvent, payload);

      if (eventType === EMBEDDED_PROVIDER_EVENTS.UI_SHOW) {
        this.requestShow();
        return;
      }

      if (
        eventType === EMBEDDED_PROVIDER_EVENTS.DISCONNECT ||
        eventType === EMBEDDED_PROVIDER_EVENTS.LOCK
      ) {
        this.clearConnection();
        this.requestHide();
        return;
      }

      if (eventType === EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED) {
        const account =
          (payload as { account?: WalletAccount } | null | undefined)
            ?.account ?? null;
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
      );
    }
  }

  /** Hand the bridge a WebView ref. Required before connect/sign. */
  attachWebView(ref: WebViewRefLike): void {
    this.bridge.attachWebView(ref);
  }

  /** Mark a direct top-level WebView wallet document as ready. */
  markWebViewReady(): void {
    this.bridge.markReady();
  }

  /** Pass through the WebView's `onMessage` event handler. */
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

  /** Wait for the iframe's IFRAME_READY_EVENT handshake. */
  async initialize(): Promise<void> {
    await this.bridge.awaitReady();
  }

  /** Open or focus the wallet host surface. Transparent hosts use this
      to give WKWebView a focused document for WebAuthn without showing
      wallet UI. */
  async requestShow(): Promise<void> {
    if (this.transparent) {
      if (!this.isSurfaceShown) {
        this.isSurfaceShown = true;
        this.onShowRequested?.();
      }
      await new Promise((resolve) =>
        setTimeout(resolve, TRANSPARENT_FOCUS_SETTLE_MS),
      );
      return;
    }
    if (this.isSurfaceShown) return;
    this.isSurfaceShown = true;
    this.onShowRequested?.();
  }

  /** Close the wallet UI (called internally; also exposed for host). */
  requestHide(): void {
    this.isSurfaceShown = false;
    this.onHideRequested?.();
  }

  /** Reject pending requests after a user-driven native sheet dismiss. */
  rejectPendingRequests(message?: string): void {
    this.bridge.rejectPendingRequests(message);
  }

  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT_START, {});
    try {
      await this.requestShow();
      const payload: ConnectRequestPayload = {};
      if (options?.metadata) payload.metadata = options.metadata;
      if (options?.preferredAccountAddress) {
        payload.preferredAccountAddress = options.preferredAccountAddress;
      }
      if (options?.intent) payload.intent = options.intent;

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
      this.connected = true;
      this.accounts = result.accounts;
      this.selectedAccount = result.selectedAccount;

      this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT, result);
      this.requestHide();
      return result;
    } catch (error) {
      this.requestHide();
      this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT_ERROR, { error });
      throw error;
    }
  }

  async createAccount(
    options?: CreateAccountOptions,
  ): Promise<CreateAccountResult> {
    try {
      await this.requestShow();
      const payload: CreateAccountPayload = {};
      if (options?.accountName) payload.accountName = options.accountName;
      if (options?.metadata) payload.metadata = options.metadata;
      if (options?.createSigningSession) {
        payload.createSigningSession = {
          expiresAt: String(resolveSessionExpirySeconds(options.createSigningSession)),
        };
      }

      const response = await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.CREATE_ACCOUNT,
        payload,
        origin: this.origin,
      });

      const normalized = normalizeWalletAccountResult(
        response.result,
        response.result.selectedAccount ?? response.result.account,
      );
      const selectedAccount =
        normalized.selectedAccount ?? response.result.account;
      if (!selectedAccount) {
        throw new Error("Wallet did not return a created account");
      }
      const result: CreateAccountResult = {
        ...response.result,
        accounts: normalized.accounts,
        selectedAccount,
        account: selectedAccount,
      };
      this.connected = true;
      this.accounts = result.accounts;
      this.selectedAccount = result.selectedAccount;

      this.emit(EMBEDDED_PROVIDER_EVENTS.CONNECT, {
        accounts: result.accounts,
        selectedAccount: result.selectedAccount,
        status: "completed",
        metadata: options?.metadata,
      });
      this.emit(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, {
        account: result.selectedAccount,
      });
      this.requestHide();
      return result;
    } catch (error) {
      this.requestHide();
      this.emit(EMBEDDED_PROVIDER_EVENTS.ERROR, { error });
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
      result.hasPasskey &&
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
    try {
      await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.DISCONNECT,
        origin: this.origin,
      });
      this.clearConnection();
      this.emit(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, {});
    } catch (error) {
      this.clearConnection();
      this.emit(EMBEDDED_PROVIDER_EVENTS.ERROR, { error });
      throw error;
    } finally {
      this.requestHide();
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  isTransparent(): boolean {
    return this.transparent;
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

  clearConnection(): void {
    this.connected = false;
    this.accounts = [];
    this.selectedAccount = null;
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
    try {
      await this.requestShow();
      const response = await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS,
        origin: this.origin,
      });

      const result = normalizeWalletAccountResult(response.result);
      this.accounts = result.accounts;
      this.selectedAccount = result.selectedAccount;
      this.requestHide();
      return result;
    } catch (error) {
      this.requestHide();
      this.emit(EMBEDDED_PROVIDER_EVENTS.ERROR, { error });
      throw error;
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

  /** Internal: used by NativeThruChain. */
  getBridge(): WebViewBridge {
    return this.bridge;
  }

  destroy(): void {
    this.bridge.destroy();
    this.eventListeners.clear();
    this.clearConnection();
  }

  private emit(event: NativeProviderEvent, data?: unknown): void {
    this.eventListeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        // eslint-disable-next-line no-console
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
}
