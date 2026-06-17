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
  CREATE_SIGNING_SESSION: "createSigningSession",
  CREATE_SIGNING_SESSION_INSTRUCTION: "createSigningSessionInstruction",
  CONFIRM_SIGNING_SESSION: "confirmSigningSession",
  REVOKE_SIGNING_SESSION: "revokeSigningSession",
} as const;

export type RequestType =
  (typeof POST_MESSAGE_REQUEST_TYPES)[keyof typeof POST_MESSAGE_REQUEST_TYPES];

export const EMBEDDED_PROVIDER_EVENTS = {
  CONNECT_START: "connect_start",
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  CONNECT_ERROR: "connect_error",
  ERROR: "error",
  LOCK: "lock",
  UI_SHOW: "ui_show",
  ACCOUNT_CHANGED: "account_changed",
} as const;

export type EmbeddedProviderEvent =
  (typeof EMBEDDED_PROVIDER_EVENTS)[keyof typeof EMBEDDED_PROVIDER_EVENTS];

export const POST_MESSAGE_EVENT_TYPE = "event" as const;

export const IFRAME_READY_EVENT = "iframe:ready" as const;

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
  | CreateSigningSessionRequestMessage
  | CreateSigningSessionInstructionRequestMessage
  | ConfirmSigningSessionRequestMessage
  | RevokeSigningSessionRequestMessage;

export interface DisconnectResult {
  // Empty object keeps compatibility with existing consumers expecting a success payload
}

export interface CreateAccountPayload {
  accountName?: string;
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
  isUnlocked: boolean;
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
  accounts: WalletAccount[];
  selectedAccount: WalletAccount | null;
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
  [POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION]: CreateSigningSessionResult;
  [POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION]: CreateSigningSessionInstructionResult;
  [POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION]: ConfirmSigningSessionResult;
  [POST_MESSAGE_REQUEST_TYPES.REVOKE_SIGNING_SESSION]: RevokeSigningSessionResult;
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
  | SuccessResponse<TType>
  | ErrorResponse;

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
  WALLET_LOCKED: "WALLET_LOCKED",
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
