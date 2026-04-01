import * as SecureStore from 'expo-secure-store';
import type { PasskeyMetadata } from '@thru/passkey-manager';

const SECURE_STORE_OPTS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

const PASSKEY_CREDENTIAL_ID_KEY = 'thru_passkey_credential_id';
const PASSKEY_PUBLIC_KEY_X_KEY = 'thru_passkey_pubkey_x';
const PASSKEY_PUBLIC_KEY_Y_KEY = 'thru_passkey_pubkey_y';
const PASSKEY_RP_ID_KEY = 'thru_passkey_rp_id';
const PASSKEY_LABEL_KEY = 'thru_passkey_label';
const PASSKEY_CREATED_AT_KEY = 'thru_passkey_created_at';
const PASSKEY_LAST_USED_AT_KEY = 'thru_passkey_last_used_at';

const ADDRESS_KEY = 'thru_address';
const USER_ID_KEY = 'thru_user_id';
const TOKEN_ACCOUNT_KEY = 'thru_token_account';

export async function storePasskeyMetadata(metadata: PasskeyMetadata): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(PASSKEY_CREDENTIAL_ID_KEY, metadata.credentialId, SECURE_STORE_OPTS),
    SecureStore.setItemAsync(PASSKEY_PUBLIC_KEY_X_KEY, metadata.publicKeyX, SECURE_STORE_OPTS),
    SecureStore.setItemAsync(PASSKEY_PUBLIC_KEY_Y_KEY, metadata.publicKeyY, SECURE_STORE_OPTS),
    SecureStore.setItemAsync(PASSKEY_RP_ID_KEY, metadata.rpId, SECURE_STORE_OPTS),
    SecureStore.setItemAsync(PASSKEY_LABEL_KEY, metadata.label ?? '', SECURE_STORE_OPTS),
    SecureStore.setItemAsync(PASSKEY_CREATED_AT_KEY, metadata.createdAt, SECURE_STORE_OPTS),
    SecureStore.setItemAsync(PASSKEY_LAST_USED_AT_KEY, metadata.lastUsedAt, SECURE_STORE_OPTS),
  ]);
}

export async function getStoredPasskeyMetadata(): Promise<PasskeyMetadata | null> {
  const credentialId = await SecureStore.getItemAsync(PASSKEY_CREDENTIAL_ID_KEY);
  if (!credentialId) return null;

  const [publicKeyX, publicKeyY, rpId, label, createdAt, lastUsedAt] = await Promise.all([
    SecureStore.getItemAsync(PASSKEY_PUBLIC_KEY_X_KEY),
    SecureStore.getItemAsync(PASSKEY_PUBLIC_KEY_Y_KEY),
    SecureStore.getItemAsync(PASSKEY_RP_ID_KEY),
    SecureStore.getItemAsync(PASSKEY_LABEL_KEY),
    SecureStore.getItemAsync(PASSKEY_CREATED_AT_KEY),
    SecureStore.getItemAsync(PASSKEY_LAST_USED_AT_KEY),
  ]);

  if (!rpId || !createdAt) return null;

  return {
    credentialId,
    publicKeyX: publicKeyX ?? '',
    publicKeyY: publicKeyY ?? '',
    rpId,
    label: label || undefined,
    createdAt,
    lastUsedAt: lastUsedAt ?? createdAt,
  };
}

export async function touchPasskeyLastUsedAt(lastUsedAt = new Date().toISOString()): Promise<string> {
  await SecureStore.setItemAsync(PASSKEY_LAST_USED_AT_KEY, lastUsedAt, SECURE_STORE_OPTS);
  return lastUsedAt;
}

export async function hasStoredPasskey(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PASSKEY_CREDENTIAL_ID_KEY)) !== null;
}

export async function clearPasskeyMetadata(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(PASSKEY_CREDENTIAL_ID_KEY),
    SecureStore.deleteItemAsync(PASSKEY_PUBLIC_KEY_X_KEY),
    SecureStore.deleteItemAsync(PASSKEY_PUBLIC_KEY_Y_KEY),
    SecureStore.deleteItemAsync(PASSKEY_RP_ID_KEY),
    SecureStore.deleteItemAsync(PASSKEY_LABEL_KEY),
    SecureStore.deleteItemAsync(PASSKEY_CREATED_AT_KEY),
    SecureStore.deleteItemAsync(PASSKEY_LAST_USED_AT_KEY),
  ]);
}

export async function storeWalletInfo(
  address: string,
  userId: string,
  tokenAccountAddress?: string
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ADDRESS_KEY, address, SECURE_STORE_OPTS),
    SecureStore.setItemAsync(USER_ID_KEY, userId, SECURE_STORE_OPTS),
    tokenAccountAddress
      ? SecureStore.setItemAsync(TOKEN_ACCOUNT_KEY, tokenAccountAddress, SECURE_STORE_OPTS)
      : SecureStore.deleteItemAsync(TOKEN_ACCOUNT_KEY),
  ]);
}

export async function hasStoredWallet(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ADDRESS_KEY)) !== null;
}

export async function getStoredAddress(): Promise<string | null> {
  return SecureStore.getItemAsync(ADDRESS_KEY);
}

export async function getStoredUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_ID_KEY);
}

export async function getStoredTokenAccount(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_ACCOUNT_KEY);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ADDRESS_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
    SecureStore.deleteItemAsync(TOKEN_ACCOUNT_KEY),
  ]);
}
