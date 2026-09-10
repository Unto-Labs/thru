export { NativeSDK } from './NativeSDK';
export {
  TRANSACTION_SIGNING_SCHEME_SEARCH_PARAM,
  TransactionSigningScheme,
  withTransactionSigningScheme,
} from '../transaction-signing-scheme';
export type {
  EventCallback,
  ConnectOptions,
  CreateAccountOptions,
  IosWebViewMode,
  NativeSDKConfig,
  NativeSDKStorage,
  NativeSDKUiHandlers,
  NativeWalletExperience,
  RestoreConnectionOptions,
  SDKEvent,
  SignInOptions,
} from './NativeSDK';
export type {
  WalletAvailability,
  WalletAvailabilityStatus,
} from '../connection-state';

export { AddressType, ThruTransactionEncoding } from '../interfaces';
export type {
  AppMetadata,
  ConnectResult,
  IThruChain,
  SignMessageParams,
  SignMessageResult,
  ThruPasskeyChallengeIntent,
  ThruPasskeyChallengeSignature,
  ThruSigningContext,
  ThruSigningSession,
  ThruSigningSessionCreateOptions,
  ThruSigningSessionDescriptor,
  ThruSigningSessionRenewOptions,
  ThruSigningSessionTimestamp,
  ThruTransactionIntent,
  WalletAccount,
} from '../interfaces';
export type { SigningSessionStorage } from '../signing-sessions';
export type { WalletSDKStorage } from '../storage';
export { WalletSDKStorageError } from '../storage';
export type {
  AccountsApi,
  ConnectionApi,
  SigningSessionsApi,
  WalletConnectOptions,
  WalletSDK,
} from '../sdk-contract';

export {
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
  POST_MESSAGE_REQUEST_TYPES,
} from '../protocol';
export type {
  ConnectMetadataInput,
  CreateAccountResult,
  DepositDestination,
  DepositFundingMethod,
  DepositRequestPayload,
  DepositResult,
  DepositUiConfig,
  GetConnectionStateResult,
  ManageAccountsResult,
  PrepareDepositPayload,
} from '../protocol';
export { DepositTarget, ThruNetwork } from '../protocol';
export type {
  DepositAccountState,
  DepositsApi,
  EnsureDepositAccountParams,
  GetDepositAccountStateParams,
  WaitForDepositParams,
} from '../deposit';
export { DepositTransactionError, formatDepositAmount } from '../deposit';
