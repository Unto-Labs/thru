import type {
  ResolvedWalletNetwork,
  WalletNetworkSelection,
} from "../networks";
import type { TelemetryAppContext } from "../observability";
import type {
  AppMetadata,
  ConnectResult,
  ThruSigningContext,
  WalletAccount,
} from "../interfaces";
import type { WalletRestoreEnvelope, WalletRestoreRecord } from "./connectionRestore";

export const POST_MESSAGE_REQUEST_TYPES = {
  GET_NETWORK: "getNetwork",
  SWITCH_NETWORK: "switchNetwork",
  NETWORK_OPERATION: "networkOperation",
  CONNECT: "connect",
  CREATE_ACCOUNT: "createAccount",
  DISCONNECT: "disconnect",
  SIGN_MESSAGE: "signMessage",
  SIGN_TRANSACTION: "signTransaction",
  SIGN_PASSKEY_CHALLENGE: "signPasskeyChallenge",
  GET_ACCOUNTS: "getAccounts",
  GET_CONNECTION_STATE: "getConnectionState",
  GET_SIGNING_CONTEXT: "getSigningContext",
  SELECT_ACCOUNT: "selectAccount",
  MANAGE_ACCOUNTS: "manageAccounts",
  ACCOUNT_MENU: "accountMenu",
  CREATE_SIGNING_SESSION: "createSigningSession",
  CREATE_SIGNING_SESSION_INSTRUCTION: "createSigningSessionInstruction",
  CONFIRM_SIGNING_SESSION: "confirmSigningSession",
  REVOKE_SIGNING_SESSION: "revokeSigningSession",
  PREPARE_DEPOSIT: "prepareDeposit",
  DEPOSIT: "deposit",
} as const;

export type RequestType =
  (typeof POST_MESSAGE_REQUEST_TYPES)[keyof typeof POST_MESSAGE_REQUEST_TYPES];

export const EMBEDDED_PROVIDER_EVENTS = {
  NETWORK_CHANGED: "network_changed",
  CONNECT_START: "connect_start",
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  CONNECT_ERROR: "connect_error",
  ERROR: "error",
  UI_SHOW: "ui_show",
  /**
   * The wallet's UI is going away. `exitMs` is how long its exit animation
   * runs; the host stops routing pointer events at once and hides the frame
   * once the animation has played.
   */
  UI_HIDE: "ui_hide",
  ACCOUNT_CHANGED: "account_changed",
  /* Add funds lifecycle, so a host can react (refresh a balance, toast)
     without waiting on the deposit() promise. `deposit:pending` fires as soon
     as the money is committed — card payment authorized, or crypto transfer
     detected — while the sheet is still open; it is sent at most once per
     deposit. */
  DEPOSIT_OPENED: "deposit:opened",
  DEPOSIT_PENDING: "deposit:pending",
  DEPOSIT_COMPLETED: "deposit:completed",
  DEPOSIT_CANCELLED: "deposit:cancelled",
} as const;

export interface UiHideEventPayload {
  exitMs?: number;
}

/** Which Add funds rail a deposit runs on. */
export type DepositMethod = "crypto" | "card";

/**
 * The rail a deposit event reports: an Add funds rail, or `faucet` for the
 * test faucet the wallet offers in developer mode. Apps can't open the faucet
 * directly; the user picks it in the chooser.
 */
export type DepositEventMethod = DepositMethod | "faucet";

export interface DepositOpenedEventPayload {
  /** Undefined while the user is still on the chooser. */
  method?: DepositEventMethod;
  destination: DepositDestination;
}

export interface DepositPendingEventPayload {
  method: DepositEventMethod;
  destination: DepositDestination;
  providerDepositId?: string;
}

export interface DepositCompletedEventPayload {
  method: DepositEventMethod;
  destination: DepositDestination;
  /** Formatted amount credited, e.g. "250.00". */
  amount: string;
  /** Raw (base-unit) amount credited, when observed. */
  amountRaw?: string;
  /** Asset the deposit lands as (the destination symbol). */
  asset: string;
  /** Thru mint transaction id, when surfaced. */
  txId?: string;
  providerDepositId?: string;
}

export interface DepositCancelledEventPayload {
  method?: DepositEventMethod;
  destination: DepositDestination;
}

export type EmbeddedProviderEvent =
  (typeof EMBEDDED_PROVIDER_EVENTS)[keyof typeof EMBEDDED_PROVIDER_EVENTS];

export const POST_MESSAGE_EVENT_TYPE = "event" as const;

export const IFRAME_READY_EVENT = "iframe:ready" as const;

/**
 * What the wallet can do beyond the base protocol, declared in the ready
 * handshake so an older wallet keeps the older host behaviour.
 */
export interface IframeReadyCapabilities {
  /**
   * The wallet announces `ui_hide` when its UI closes, so the host may leave
   * the frame visible after a response until the exit animation has played.
   */
  managedHide?: boolean;
  networkSwitching?: boolean;
}

export interface IframeReadyData {
  ready: true;
  network?: ResolvedWalletNetwork;
  networkGeneration?: number;
  capabilities?: IframeReadyCapabilities;
}

/**
 * Host -> wallet control message carrying the current host-app telemetry
 * correlation values. Fire-and-forget: the wallet never responds, and the
 * values only affect telemetry, never wallet behaviour.
 */
export const TELEMETRY_CONTEXT_MESSAGE_TYPE = "telemetry:context" as const;

export interface TelemetryContextMessage {
  type: typeof TELEMETRY_CONTEXT_MESSAGE_TYPE;
  origin: string;
  frameId: string;
  /** Absent clears the label the wallet received at load. */
  appContextId?: string;
  /** Absent clears the dimensions the wallet received at load. */
  appContext?: TelemetryAppContext;
}

/**
 * Host -> wallet control message carrying the host's resolved color scheme.
 * Fire-and-forget: sent when the host theme changes (and again when a wallet
 * document reloads) so open and future wallet surfaces restyle without the
 * frame reloading. The load-time value rides on the `tn_theme` URL param.
 */
export const WALLET_THEME_MESSAGE_TYPE = "wallet:theme" as const;

export interface WalletThemeMessage {
  type: typeof WALLET_THEME_MESSAGE_TYPE;
  origin: string;
  frameId: string;
  theme: WalletTheme;
}

export function isWalletThemeMessage(
  value: unknown,
): value is WalletThemeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<WalletThemeMessage>;
  return (
    message.type === WALLET_THEME_MESSAGE_TYPE &&
    typeof message.origin === "string" &&
    typeof message.frameId === "string" &&
    (message.theme === "light" || message.theme === "dark")
  );
}

/**
 * Host -> wallet control message carrying the host's developer mode. Like
 * `wallet:theme` it is fire-and-forget: sent when the host changes it (and
 * again when a wallet document reloads). The load-time value rides on the
 * `tn_developer_mode` URL param. The wallet turns developer mode on when the
 * host or its own account-menu switch asks for it.
 */
export const WALLET_DEVELOPER_MODE_MESSAGE_TYPE = "wallet:developer-mode" as const;

/** Frame URL param for the load-time developer mode: `1` when on, absent when off. */
export const WALLET_DEVELOPER_MODE_SEARCH_PARAM = "tn_developer_mode" as const;

export interface WalletDeveloperModeMessage {
  type: typeof WALLET_DEVELOPER_MODE_MESSAGE_TYPE;
  origin: string;
  frameId: string;
  enabled: boolean;
}

export function isWalletDeveloperModeMessage(
  value: unknown,
): value is WalletDeveloperModeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<WalletDeveloperModeMessage>;
  return (
    message.type === WALLET_DEVELOPER_MODE_MESSAGE_TYPE &&
    typeof message.origin === "string" &&
    typeof message.frameId === "string" &&
    typeof message.enabled === "boolean"
  );
}

export const DEFAULT_IFRAME_URL = "http://localhost:3010/embedded";

const REQUEST_ID_PREFIX = "req";

export const createRequestId = (prefix: string = REQUEST_ID_PREFIX): string => {
  const random = Math.random().toString(36).slice(2, 11);
  return `${prefix}_${Date.now()}_${random}`;
};

interface BaseRequest {
  networkScope?: string;
  networkGeneration?: number;
  id: string;
  origin: string;
}

export interface ConnectRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.CONNECT;
  payload: ConnectRequestPayload;
}

export interface DisconnectRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.DISCONNECT;
  payload?: undefined;
}

export interface CreateAccountRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.CREATE_ACCOUNT;
  payload: CreateAccountPayload;
}

export interface SignMessageRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.SIGN_MESSAGE;
  payload: SignMessagePayload;
}

export interface SignTransactionRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION;
  payload: SignTransactionPayload;
}

export interface SignPasskeyChallengeRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE;
  payload: SignPasskeyChallengePayload;
}

export interface GetAccountsRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS;
  payload?: undefined;
}

export interface GetConnectionStateRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE;
  payload: ConnectRequestPayload;
}

export interface GetSigningContextRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.GET_SIGNING_CONTEXT;
  payload?: undefined;
}

export interface SelectAccountRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.SELECT_ACCOUNT;
  payload: SelectAccountPayload;
}

export interface ManageAccountsRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS;
  payload?: undefined;
}

/** The host page's resolved color scheme; the wallet frames draw to match. */
export type WalletTheme = "light" | "dark";

/** What a host asks for: a fixed scheme, or `system` to follow the OS setting. */
export type WalletThemePreference = WalletTheme | "system";

/** Viewport rect of the host control the account menu anchors to. */
export interface AccountMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Ask the wallet to draw its account menu inside its (full-viewport) frame,
 * anchored under the host's account chip. The wallet owns switching, adding
 * accounts, and signing out; the host only supplies display hints.
 */
export interface AccountMenuPayload {
  anchor: AccountMenuAnchor;
  /** Which edge of the anchor the menu aligns to (default right). */
  align?: "left" | "right";
  /** Network label shown in the menu header, e.g. "alphanet". */
  network?: string;
  /** Explorer page of the current account. */
  explorerUrl?: string;
  /** Formatted balances by address, as the host displays them. */
  balances?: Record<string, string>;
  /** Draw the menu for a light or dark host page (default: the frame's theme). */
  theme?: WalletTheme;
}

export interface AccountMenuRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.ACCOUNT_MENU;
  payload: AccountMenuPayload;
}

export interface CreateSigningSessionRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION;
  payload: CreateSigningSessionPayload;
}

export interface CreateSigningSessionInstructionRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION;
  payload: CreateSigningSessionInstructionPayload;
}

export interface ConfirmSigningSessionRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION;
  payload: ConfirmSigningSessionPayload;
}

export interface RevokeSigningSessionRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.REVOKE_SIGNING_SESSION;
  payload: RevokeSigningSessionPayload;
}

export interface PrepareDepositRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT;
  payload: PrepareDepositPayload;
}

export interface DepositRequestMessage extends BaseRequest {
  type: typeof POST_MESSAGE_REQUEST_TYPES.DEPOSIT;
  payload: DepositRequestMessagePayload;
}

export interface GetNetworkRequestMessage extends BaseRequest {
  type: "getNetwork";
  payload?: undefined;
}
export interface SwitchNetworkRequestMessage extends BaseRequest {
  type: "switchNetwork";
  payload: WalletNetworkSelection;
}
export interface NetworkOperationRequestMessage extends BaseRequest {
  type: "networkOperation";
  payload: { operationId: string; busy: boolean };
}
export type PostMessageRequest =
  | GetNetworkRequestMessage
  | SwitchNetworkRequestMessage
  | NetworkOperationRequestMessage
  | ConnectRequestMessage
  | CreateAccountRequestMessage
  | DisconnectRequestMessage
  | SignMessageRequestMessage
  | SignTransactionRequestMessage
  | SignPasskeyChallengeRequestMessage
  | GetAccountsRequestMessage
  | GetConnectionStateRequestMessage
  | GetSigningContextRequestMessage
  | SelectAccountRequestMessage
  | ManageAccountsRequestMessage
  | AccountMenuRequestMessage
  | CreateSigningSessionRequestMessage
  | CreateSigningSessionInstructionRequestMessage
  | ConfirmSigningSessionRequestMessage
  | RevokeSigningSessionRequestMessage
  | PrepareDepositRequestMessage
  | DepositRequestMessage;

export interface DisconnectResult {
  // Empty object keeps compatibility with existing consumers expecting a success payload
}

export interface CreateAccountPayload {
  accountName?: string;
  /** App-provided name for the passkey created for this account. */
  passkeyName?: string;
  metadata?: ConnectMetadataInput;
  createSigningSession?: {
    expiresAt: string;
  };
}

export interface CreateAccountResult {
  account: WalletAccount;
  accounts: WalletAccount[];
  selectedAccount: WalletAccount;
  signature: string | null;
  vmError: string | null;
  userErrorCode: string | null;
  executionResult: string | null;
  signingSession?: SigningSessionDescriptorPayload;
}

export interface GetAccountsResult {
  accounts: WalletAccount[];
}

export interface GetConnectionStateResult {
  network?: ResolvedWalletNetwork;
  isAuthorized: boolean;
  isConnected: boolean;
  /** @deprecated Authentication is action-based; compatibility responses return true. */
  isUnlocked?: boolean;
  hasPasskey: boolean;
  hasWalletAccount: boolean;
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
  metadata: AppMetadata | null;
  /** Present when authorized: what the host keeps to restore this connection. */
  restore?: WalletRestoreRecord;
  /**
   * The wallet rebuilt this authorization from the host's record because its
   * own store was empty. Anything else the wallet held for the host, such as
   * signing-session keys, is gone too.
   */
  restoredFromHost?: boolean;
}

export interface SelectAccountPayload {
  publicKey: string;
}

export interface SelectAccountResult {
  account: WalletAccount;
  /** The host's restore record for the account now selected, when the wallet
      holds an authorization for it; absent when it does not, so the host
      keeps no record that would restore the wrong account. */
  restore?: WalletRestoreRecord;
}

export interface ManageAccountsResult {
  selectedAccount: WalletAccount | null;
  /** See SelectAccountResult.restore. */
  restore?: WalletRestoreRecord;
}

/** `deposit`: the user picked "Add funds"; the host follows up with `deposit()`. */
export type AccountMenuAction =
  "closed" | "switched" | "accounts-updated" | "signed-out" | "deposit";

export interface AccountMenuResult {
  action: AccountMenuAction;
  /** Present after a switch or after the account manager ran. */
  accounts?: WalletAccount[];
  selectedAccount?: WalletAccount | null;
  /** See SelectAccountResult.restore. */
  restore?: WalletRestoreRecord;
}

type RequestResultMap = {
  getNetwork: ResolvedWalletNetwork;
  switchNetwork: ResolvedWalletNetwork;
  networkOperation: { acknowledged: true };
  [POST_MESSAGE_REQUEST_TYPES.CONNECT]: ConnectResult & WalletRestoreEnvelope;
  [POST_MESSAGE_REQUEST_TYPES.CREATE_ACCOUNT]: CreateAccountResult;
  [POST_MESSAGE_REQUEST_TYPES.DISCONNECT]: DisconnectResult;
  [POST_MESSAGE_REQUEST_TYPES.SIGN_MESSAGE]: SignMessageResult;
  [POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION]: SignTransactionResult;
  [POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE]: SignPasskeyChallengeResult;
  [POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS]: GetAccountsResult;
  [POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE]: GetConnectionStateResult;
  [POST_MESSAGE_REQUEST_TYPES.GET_SIGNING_CONTEXT]: GetSigningContextResult;
  [POST_MESSAGE_REQUEST_TYPES.SELECT_ACCOUNT]: SelectAccountResult;
  [POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS]: ManageAccountsResult;
  [POST_MESSAGE_REQUEST_TYPES.ACCOUNT_MENU]: AccountMenuResult;
  [POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION]: CreateSigningSessionResult;
  [POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION]: CreateSigningSessionInstructionResult;
  [POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION]: ConfirmSigningSessionResult;
  [POST_MESSAGE_REQUEST_TYPES.REVOKE_SIGNING_SESSION]: RevokeSigningSessionResult;
  [POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT]: DepositDestination;
  [POST_MESSAGE_REQUEST_TYPES.DEPOSIT]: DepositResult;
};

interface ResponseErrorPayload {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

type SuccessResponse<TType extends RequestType> = {
  id: string;
  success: true;
  result: RequestResultMap[TType];
};

type ErrorResponse = {
  id: string;
  success: false;
  error: ResponseErrorPayload;
};

export type PostMessageResponse<TType extends RequestType = RequestType> =
  SuccessResponse<TType> | ErrorResponse;

export type SuccessfulPostMessageResponse<
  TType extends RequestType = RequestType,
> = Extract<PostMessageResponse<TType>, { success: true }>;

export type InferPostMessageResponse<TRequest extends PostMessageRequest> =
  PostMessageResponse<TRequest["type"]>;

export type InferSuccessfulPostMessageResponse<
  TRequest extends PostMessageRequest,
> = SuccessfulPostMessageResponse<TRequest["type"]>;

export interface PostMessageEvent<
  TEvent extends EmbeddedProviderEvent = EmbeddedProviderEvent,
  TData = any,
> {
  type: typeof POST_MESSAGE_EVENT_TYPE;
  event: TEvent;
  data?: TData;
}

export const ErrorCode = {
  NETWORK_CHANGED: "NETWORK_CHANGED",
  USER_REJECTED: "USER_REJECTED",
  SIGNING_SESSION_UNAVAILABLE: "SIGNING_SESSION_UNAVAILABLE",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  ALREADY_CONNECTED: "ALREADY_CONNECTED",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  ACCOUNT_CHANGED: "ACCOUNT_CHANGED",
  INVALID_TRANSACTION: "INVALID_TRANSACTION",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ConnectMetadataInput = Partial<AppMetadata>;

export type ConnectIntent = "default" | "switch-account";

export interface ConnectRequestPayload {
  metadata?: ConnectMetadataInput;
  preferredAccountAddress?: string;
  intent?: ConnectIntent;
  /** App-provided name for a passkey created during this connect flow. */
  passkeyName?: string;
  /**
   * The restore record the wallet issued on an earlier connection, held by
   * the host. The wallet consults it only when its own store has no
   * authorization for this host.
   */
  restore?: WalletRestoreRecord;
}

/** WebAuthn user.name is capped by authenticators; keep names comfortably short. */
export const MAX_PASSKEY_NAME_LENGTH = 64;

export function sanitizePasskeyName(name?: string): string | undefined {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim().slice(0, MAX_PASSKEY_NAME_LENGTH).trim();
  return trimmed || undefined;
}

export type { AppMetadata, ConnectResult };

export interface SignMessagePayload {
  message: string | number[];
  accountIndex?: number;
}

export interface SignMessageResult {
  signature: number[];
  publicKey: string;
}

/**
 * Wallet-managed instruction signing intent.
 *
 * Dapps provide the instruction data and account context. The wallet owns
 * signing strategy details such as passkey validation, fee payer choice,
 * account ordering, headers, nonces, and final wire layout. Review metadata
 * is treated as untrusted display-only data.
 */
export interface SignTransactionPayload {
  walletAddress?: string;
  programAddress: string;
  instructionData: string;
  readWriteAddresses?: string[];
  readOnlyAddresses?: string[];
  review?: TransactionReviewPayload;
  signingSessionId?: string;
}

export interface SignTransactionResult {
  signedTransaction: string;
}

export interface SignPasskeyChallengePayload {
  /** base64url-encoded challenge bytes from a backend passkey-manager flow. */
  challenge: string;
  /** Optional expected wallet address for the selected transparent account. */
  walletAddress?: string;
}

export interface SignPasskeyChallengeResult {
  signatureR: string;
  signatureS: string;
  authenticatorData: string;
  clientDataJSON: string;
  /** Active on-chain passkey authority used for this assertion. */
  authIdx: number;
  /** WebAuthn relying-party id bound into authenticatorData. */
  rpId: string;
}

export interface CreateSigningSessionPayload {
  walletAddress?: string;
  expiresAt: string;
  review?: TransactionReviewPayload;
}

export interface CreateSigningSessionInstructionPayload {
  walletAddress?: string;
  expiresAt: string;
  walletAccountIdx: number;
}

export interface SigningSessionDescriptorPayload {
  id: string;
  walletAddress: string;
  publicKey: string;
  authIdx: number;
  expiresAt: string;
  createdAt: string;
}

export interface CreateSigningSessionResult {
  session: SigningSessionDescriptorPayload;
}

export interface CreateSigningSessionInstructionResult {
  session: SigningSessionDescriptorPayload;
  programAddress: string;
  instructionData: string;
}

export interface ConfirmSigningSessionPayload {
  sessionId: string;
}

export interface ConfirmSigningSessionResult {
  session: SigningSessionDescriptorPayload;
}

export interface RevokeSigningSessionPayload {
  sessionId: string;
}

export interface RevokeSigningSessionResult {
  // Empty object keeps compatibility with existing consumers expecting a success payload
}

export enum ThruNetwork {
  Alphanet = "alphanet",
  Betanet = "betanet",
  Devnet = "devnet",
}

export enum DepositTarget {
  /** THRUSD retains the legacy wire value for backend compatibility. */
  THRUSD = "credits",
}

export interface DepositDestination {
  network: ThruNetwork;
  depositTarget: DepositTarget;
  tokenAccountAddress: string;
  mintAddress: string;
  tokenProgramAddress: string;
  symbol: string;
  decimals: number;
}

export type DepositUiThemeMode = "light" | "dark" | "auto";

export interface DepositUiThemeColors {
  background: string;
  card: string;
  cardHover: string;
  foreground: string;
  foregroundMuted: string;
  foregroundSubtle: string;
  border: string;
  borderSecondary: string;
  primary: string;
  primaryForeground: string;
  success: string;
  successBackground: string;
  warning: string;
  warningBackground: string;
  error: string;
  errorBackground: string;
  overlay: string;
}

export type DepositUiCustomThemeColors = Partial<DepositUiThemeColors>;

export interface DepositUiThemeConfig {
  light?: DepositUiCustomThemeColors;
  dark?: DepositUiCustomThemeColors;
}

export interface DepositUiFontConfig {
  regular?: string;
  medium?: string;
  semibold?: string;
  bold?: string;
}

export interface DepositUiHeaderTokens {
  titleColor: string;
  buttonColor: string;
}

export interface DepositUiCardTokens {
  backgroundColor: string;
  titleColor: string;
  subtitleColor: string;
  labelColor: string;
  headerColor: string;
  labelRightColor: string;
  labelHighlightRightColor: string;
  textRightColor: string;
  subtextRightColor: string;
  rowLeftLabel: string;
  rowRightLabel: string;
  iconColor: string;
  iconBackgroundColor: string;
  actionColor: string;
  actionIcon: string;
  descriptionColor: string;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
}

export interface DepositUiInputTokens {
  backgroundColor: string;
  textColor: string;
  placeholderColor: string;
  borderColor: string;
  borderRadius: number;
  borderWidth: number;
}

export interface DepositUiButtonTokens {
  primaryBackground: string;
  primaryText: string;
  secondaryBackground: string;
  secondaryText: string;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
}

export interface DepositUiContainerTokens {
  titleColor: string;
  subtitleColor: string;
  actionColor: string;
  actionTitle: string;
  buttonColor: string;
  buttonTitleColor: string;
  iconBackgroundColor: string;
  iconColor: string;
  borderRadius: number;
}

export interface DepositUiSearchTokens {
  backgroundColor: string;
  inputColor: string;
  placeholderColor: string;
}

export interface DepositUiListTokens {
  titleSectionColor: string;
  rowBorderRadius: number;
}

export interface DepositUiComponentOverrides {
  header?: Partial<DepositUiHeaderTokens>;
  card?: Partial<DepositUiCardTokens>;
  input?: Partial<DepositUiInputTokens>;
  button?: Partial<DepositUiButtonTokens>;
  container?: Partial<DepositUiContainerTokens>;
  search?: Partial<DepositUiSearchTokens>;
  list?: Partial<DepositUiListTokens>;
}

export interface DepositUiComponentConfig extends DepositUiComponentOverrides {
  light?: DepositUiComponentOverrides;
  dark?: DepositUiComponentOverrides;
}

export interface DepositUiConfig {
  appearance?: DepositUiThemeMode;
  accentColor?: string;
  theme?: DepositUiThemeConfig;
  fontFamily?: string;
  fonts?: DepositUiFontConfig;
  components?: DepositUiComponentConfig;
}

export interface PrepareDepositPayload {
  /** Defaults to the configured credits target for the provider network. */
  depositTarget?: DepositTarget;
  /** Resolved provider network. SDK/provider code fills this before crossing the iframe bridge. */
  network?: ThruNetwork;
}

export interface CoinbaseDepositCustomerInput {
  email: string;
  phoneNumber: string;
  phoneNumberVerifiedAt: string;
  agreementAcceptedAt: string;
}

/**
 * Optional prefill for the contact details an onramp provider collects. Each
 * field stands alone: a dApp that only knows the user's email may send just
 * that, and the wallet still asks for whatever is missing.
 */
export interface DepositContactPrefill {
  email?: string;
  /** E.164 US phone number, for example "+12055555555". */
  phoneNumber?: string;
}

/** Funding surface to open for a deposit (`card` is the Coinbase rail). */
export type DepositFundingMethod = "crypto" | "stripe_link" | "card";

/**
 * Request to open the wallet's Add funds sheet.
 *
 *   thru.deposit({})                         → the chooser (crypto / card)
 *   thru.deposit({ method: "card", amount: "50" }) → straight into a rail
 *
 * `destination` is optional: the wallet derives the connected account's
 * configured token account itself. Legacy callers that pass `providerId` +
 * `destination` go straight into that provider's rail.
 */
export interface DepositRequestPayload {
  /** Provider to open (`unifold` | `coinbase`); derived from `method` when omitted. */
  providerId?: string;
  /**
   * Unifold funding surface. Omitted values preserve the historical crypto
   * transfer flow so existing callers never receive a new method chooser.
   */
  fundingMethod?: DepositFundingMethod;
  /** Rail to open directly; omit for the chooser. */
  method?: DepositMethod;
  /** Account the funds should land in; must be the connected account. */
  to?: string;
  /** Suggested USD amount for the card rail (alias of `paymentAmount`). */
  amount?: string;
  /** Prepared token destination; the wallet derives it when omitted. */
  destination?: DepositDestination;
  paymentAmount?: string;
  /** Prefills the onramp screen; the user can still edit every value. */
  contact?: DepositContactPrefill;
  customer?: CoinbaseDepositCustomerInput;
}

/**
 * Coinbase-compatible contact details. Kept as a standalone public type for
 * callers that validate contact input before constructing a richer customer
 * payload.
 */
export interface CoinbaseOnrampContact {
  email: string;
  /** E.164 phone number, for example "+12055555555". */
  phoneNumber: string;
}
export type DepositRequestMessagePayload = DepositRequestPayload & {
  /** Internal wallet bridge field resolved from provider mount-time config. */
  resolvedDepositUiConfig?: DepositUiConfig;
  /** Providers the host SDK enables; the chooser offers their intersection with the wallet's own config. */
  enabledProviders?: string[];
  /** Provider network to derive the destination on when none was prepared (filled by the SDK). */
  network?: ThruNetwork;
};

export interface DepositResult {
  /**
   * Terminal UX state of the deposit:
   * - "completed": the balance increase was observed; the deposit is credited.
   * - "cancelled": the user dismissed the flow before committing funds; nothing
   *   was deposited.
   * - "pending": funds reached the treasury (the transfer committed) but the
   *   balance increase wasn't observed before the wallet stopped waiting. The
   *   server webhook still mints asynchronously, so the dApp should keep polling
   *   its balance rather than treat this as a cancellation.
   */
  status: "completed" | "cancelled" | "pending";
  /** Raw (base-unit) amount the balance increased by, when known. */
  mintedAmountRaw?: string;
  /** Thru mint transaction id, when surfaced to the client. */
  signature?: string;
  /** Provider execution id, when the provider has assigned one. */
  providerDepositId?: string;
}

export interface TransactionReviewSimulation {
  before?: string;
  after?: string;
}

export interface TransactionReviewAbiReflection {
  label?: string;
  kind?: string | null;
  typeName?: string;
  value?: unknown;
  rawHex?: string;
  source?: string;
  error?: string;
}

export interface TransactionReviewPayload {
  appName?: string;
  programAddress?: string;
  abiName?: string;
  instruction?: string;
  simulation?: TransactionReviewSimulation;
  abiReflection?: TransactionReviewAbiReflection;
}

export interface GetSigningContextResult {
  signingContext: ThruSigningContext;
}
