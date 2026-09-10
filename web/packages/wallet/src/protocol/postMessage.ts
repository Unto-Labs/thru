import type { TelemetryAppContext } from "../observability";
import type {
  AppMetadata,
  ConnectResult,
  ThruSigningContext,
  WalletAccount,
} from "../interfaces";

export const POST_MESSAGE_REQUEST_TYPES = {
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
} as const;

export interface UiHideEventPayload {
  exitMs?: number;
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
}

export interface IframeReadyData {
  ready: true;
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

export const DEFAULT_IFRAME_URL = "http://localhost:3010/embedded";

const REQUEST_ID_PREFIX = "req";

export const createRequestId = (prefix: string = REQUEST_ID_PREFIX): string => {
  const random = Math.random().toString(36).slice(2, 11);
  return `${prefix}_${Date.now()}_${random}`;
};

interface BaseRequest {
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

/** Viewport rect of the host control the account menu anchors to. */
/** The host page's color scheme; the wallet frames draw to match. */
export type WalletTheme = "light" | "dark";

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

export type PostMessageRequest =
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
  isAuthorized: boolean;
  isConnected: boolean;
  /** @deprecated Authentication is action-based; compatibility responses return true. */
  isUnlocked?: boolean;
  hasPasskey: boolean;
  hasWalletAccount: boolean;
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
  metadata: AppMetadata | null;
}

export interface SelectAccountPayload {
  publicKey: string;
}

export interface SelectAccountResult {
  account: WalletAccount;
}

export interface ManageAccountsResult {
  selectedAccount: WalletAccount | null;
}

export type AccountMenuAction = "closed" | "switched" | "accounts-updated" | "signed-out";

export interface AccountMenuResult {
  action: AccountMenuAction;
  /** Present after a switch or after the account manager ran. */
  accounts?: WalletAccount[];
  selectedAccount?: WalletAccount | null;
}

type RequestResultMap = {
  [POST_MESSAGE_REQUEST_TYPES.CONNECT]: ConnectResult;
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
  Devnet = "devnet",
  SweepsStagingNet = "sweeps-staging-net",
  Sweepnet = "sweepnet",
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

/** Funding surface to open for an Unifold deposit. */
export type DepositFundingMethod = "crypto" | "stripe_link";

/** Provider-neutral request for a prepared token destination. */
export interface DepositRequestPayload {
  /** Defaults to Unifold so existing `deposits.open({ destination })` callers keep working. */
  providerId?: string;
  /**
   * Unifold funding surface. Omitted values preserve the historical crypto
   * transfer flow so existing callers never receive a new method chooser.
   */
  fundingMethod?: DepositFundingMethod;
  destination: DepositDestination;
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
