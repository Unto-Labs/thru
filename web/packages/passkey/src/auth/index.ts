export type {
  PasskeyApiUser,
  PasskeyAuthApiResponse,
  PasskeyUser,
  PasskeyAuthConfig,
  PasskeyAuthState,
  PasskeyAuthActions,
  PasskeyAuthStore,
  PasskeyAuthBoundStore,
} from './types';

export { executePasskeyTransaction } from './execute-tx';

export { addAuthorityToAccount, addDeviceToAccount } from './add-device';
export type {
  AddAuthorityParams,
  AddDeviceParams,
  AddDeviceResult,
  AnyThruClient,
  PasskeyChallengeSigner,
  TxExecutor,
  TxExecutorParams,
  TxExecutorResult,
} from './add-device';

export {
  createPasskeyAuthStore,
  getPasskeyAuthStore,
  usePasskeyAuth,
} from './use-passkey-auth';
