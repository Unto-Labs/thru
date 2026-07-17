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
}

export interface CreateAccountOptions {
  accountName?: string;
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
  onShowRequested?: () => void;
  onHideRequested?: () => void;
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
  private readonly signingSessions?: SigningSessionDescriptorStore;

  readonly deposits: DepositsApi = {
    prepare: (targetOrPayload) => this.prepareDeposit(targetOrPayload),
    ensureAccount: (params) => this.ensureDepositAccount(params),
    open: (payload) => this.deposit(payload),
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
    const walletUrl =
      config.walletUrl ??
      (this.walletExperience === "transparent"
        ? DEFAULT_TRANSPARENT_WALLET_URL
        : DEFAULT_NATIVE_WALLET_URL);
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
    this.provider = new NativeProvider({
      walletUrl,
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
    this.setupEventForwarding();
  }

  /** Hand the WebView ref to the underlying provider/bridge. */
  attachWebView(ref: WebViewRefLike): void {
    this.provider.attachWebView(ref);
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
    if (this.initialized) return;
    await this.provider.initialize();
    this.initialized = true;
  }

  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    const isAccountSwitch = options?.intent === "switch-account";
    if (this.connectInFlight) return this.connectInFlight;
    if (
      !isAccountSwitch &&
      this.lastConnectResult &&
      this.provider.isConnected()
    ) {
      return this.lastConnectResult;
    }

    this.emit("connect", { status: "connecting" });

    const inFlight = (async () => {
      try {
        await this.provider.requestShow();
        if (!this.initialized) await this.initialize();

        const metadata = this.resolveMetadata(options?.metadata);
        const preferredAccountAddress = isAccountSwitch
          ? null
          : (options?.preferredAccountAddress ??
            (await this.readSelectedAccountAddress()));
        const providerOptions =
          metadata || preferredAccountAddress || options?.intent
            ? {
                ...(metadata ? { metadata } : {}),
                ...(preferredAccountAddress ? { preferredAccountAddress } : {}),
                ...(options?.intent ? { intent: options.intent } : {}),
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
        this.emit("connect", activeResult);
        return activeResult;
      } catch (error) {
        this.provider.requestHide();
        if (isUserRejectedError(error) && !isAccountSwitch) {
          this.provider.clearConnection();
          this.lastConnectResult = null;
          await this.clearPersistedConnection();
          this.clearAuthorizedAvailability();
          this.emit("disconnect", { reason: "user_rejected" });
        }
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
      await this.provider.requestShow();
      if (!this.initialized) await this.initialize();

      const metadata = this.resolveMetadata(options.metadata);
      const result = await this.provider.createAccount({
        ...(options.accountName ? { accountName: options.accountName } : {}),
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
      this.provider.requestHide();
      this.emit("error", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.provider.disconnect();
      this.emit("disconnect", {});
      this.lastConnectResult = null;
      await this.persistSelectedAccountAddress(null);
      await this.clearPersistedConnection();
      this.clearAuthorizedAvailability();
    } catch (error) {
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
      | PrepareDepositPayload["depositTarget"]
      | PrepareDepositPayload,
  ): Promise<DepositDestination> {
    if (!this.initialized) await this.initialize();
    const payload =
      typeof depositTargetOrPayload === "string"
        ? { depositTarget: depositTargetOrPayload }
        : (depositTargetOrPayload ?? {});
    return this.provider.prepareDeposit({
      ...payload,
      network: payload.network ?? this.defaultNetwork,
    });
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
    return this.provider.deposit({
      ...payload,
      network: payload.network ?? this.defaultNetwork,
    });
  }

  /** @deprecated Use `deposits.ensureAccount()`. */
  async ensureDepositAccount(
    params: EnsureDepositAccountParams = {},
  ): Promise<DepositAccountState> {
    if (!this.initialized) await this.initialize();
    const { destination, walletAddress } =
      await this.resolveDepositDestination(params.destination);
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
    const { destination, walletAddress } =
      await this.resolveDepositDestination(params.destination);
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
    const { destination, walletAddress } =
      await this.resolveDepositDestination(params.destination);
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
    this.provider.destroy();
    this.eventListeners.clear();
    this.initialized = false;
    this.connectInFlight = null;
    this.lastConnectResult = null;
    this.walletAvailability = CHECKING_WALLET_AVAILABILITY;
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
    const expected = await this.prepareDeposit(
      destination
        ? {
            network: destination.network,
            depositTarget: destination.depositTarget,
          }
        : DepositTarget.Credits,
    );
    if (destination) {
      assertDepositDestinationMatches(destination, expected);
    }
    return { destination: expected, walletAddress: selectedAccount.address };
  }

  private signDepositTransaction(
    payload: SignDepositTransactionPayload,
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
      this.lastConnectResult = null;
      this.clearAuthorizedAvailability();
      this.emit("disconnect", data);
    });
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ERROR, (data) => {
      this.emit("error", data);
    });
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.LOCK, (data) => {
      this.lastConnectResult = null;
      this.clearAuthorizedAvailability();
      this.emit("lock", data);
      this.emit("disconnect", { reason: "locked" });
    });
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, (data) => {
      const payload = data as { account?: WalletAccount } | undefined;
      const account = payload?.account ?? null;
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

function assertDepositDestinationMatches(
  actual: DepositDestination,
  expected: DepositDestination,
): void {
  const mismatches = (Object.keys(expected) as Array<keyof DepositDestination>)
    .filter((key) => actual[key] !== expected[key]);
  if (mismatches.length > 0) {
    throw new Error(
      `Prepared deposit destination no longer matches wallet config: ${mismatches.join(", ")}`,
    );
  }
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
