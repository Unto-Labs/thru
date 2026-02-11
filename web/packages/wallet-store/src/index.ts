export { AccountStorage } from './account-store';
export { ConnectedAppsStorage } from './connected-apps-store';
export { getUnifiedDB } from './db';
export {
  type ConnectedAppData,
  StoreName,
  DB_NAME,
  DB_VERSION,
} from './schema';
export { type StoredAccount } from './types';
export {
  loadPasskeyProfiles,
  savePasskeyProfiles,
  createDefaultProfileStore,
  updateProfilePasskey,
  updatePasskeyLastUsed,
  type PasskeyMetadata,
  type PasskeyProfile,
  type PasskeyProfileStore,
} from './passkey-profiles';
