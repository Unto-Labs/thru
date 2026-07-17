export { NativeSDK } from './NativeSDK';
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
  WalletAvailability,
} from './NativeSDK';

export {
  AddressType,
  ThruTransactionEncoding,
} from '../interfaces';
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
  ThruSigningSessionInstruction,
  ThruSigningSessionInstructionCreateOptions,
  ThruSigningSessionTimestamp,
  ThruTransactionIntent,
  WalletAccount,
} from '../interfaces';
export type { SigningSessionStorage } from '../signing-sessions';

export {
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
  POST_MESSAGE_REQUEST_TYPES,
} from '../protocol';
export type {
  ConnectMetadataInput,
  CreateAccountResult,
  DepositDestination,
  DepositRequestPayload,
  DepositResult,
  DepositUiConfig,
  GetConnectionStateResult,
  ManageAccountsResult,
  PrepareDepositPayload,
} from '../protocol';
export {
  DepositTarget,
  ThruNetwork,
} from '../protocol';
export type {
  DepositAccountState,
  DepositsApi,
  EnsureDepositAccountParams,
  GetDepositAccountStateParams,
  WaitForDepositBalanceParams,
} from '../deposit';
export {
  DepositTransactionError,
  formatDepositAmount,
} from '../deposit';
