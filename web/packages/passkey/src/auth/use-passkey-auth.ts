import { bytesToHex } from '@thru/passkey-manager';
import { create } from 'zustand';
import { classifyPasskeyError } from '../mobile/errors';
import {
  authenticateWithDiscoverablePasskey,
  registerPasskey,
  signWithPasskey,
} from '../mobile/passkey';
import {
  clearPasskeyMetadata,
  clearSession,
  getStoredAddress,
  getStoredPasskeyMetadata,
  getStoredUserId,
  hasStoredPasskey,
  hasStoredWallet,
  storePasskeyMetadata,
  storeWalletInfo,
  touchPasskeyLastUsedAt,
} from '../mobile/storage';
import type {
  PasskeyAuthApiResponse,
  PasskeyAuthBoundStore,
  PasskeyAuthConfig,
  PasskeyAuthStore,
  PasskeyUser,
} from './types';

const storeCache = new Map<string, PasskeyAuthBoundStore<any>>();

function createStoreKey(config: PasskeyAuthConfig): string {
  return [config.apiUrl, config.alias ?? '', config.rpId ?? '', config.rpName ?? ''].join('::');
}

function buildDisplayName(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function toPasskeyUser<TExtra>(
  user: PasskeyAuthApiResponse<TExtra>['user']
): PasskeyUser<TExtra> {
  return {
    id: user.id,
    displayName: buildDisplayName(user.publicKey),
    tokenAccountAddress: user.tokenAccountAddress ?? null,
    extras: user.extras,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await readJson<Record<string, unknown>>(response);
  if (!response.ok || data.success !== true) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'Request failed'
    );
  }

  return data as unknown as T;
}

async function getCurrentUser<TExtra>(
  apiUrl: string,
  address: string
): Promise<PasskeyAuthApiResponse<TExtra> | null> {
  const response = await fetch(`${apiUrl}/auth/me`, {
    headers: {
      'Content-Type': 'application/json',
      'x-wallet-address': address,
    },
  });

  if (response.status === 404) return null;

  const data = await readJson<Record<string, unknown>>(response);
  if (!response.ok || data.success !== true) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'Failed to fetch current user'
    );
  }

  return data as unknown as PasskeyAuthApiResponse<TExtra>;
}

export function createPasskeyAuthStore<TExtra = Record<string, never>>(
  config: PasskeyAuthConfig
): PasskeyAuthBoundStore<TExtra> {
  const resolvedAlias = config.alias ?? 'Thru Wallet';

  return create<PasskeyAuthStore<TExtra>>((set, get) => ({
    isAuthenticated: false,
    isLoading: false,
    isInitialized: false,
    hasExistingPasskey: false,
    needsNewPasskey: false,
    error: null,
    user: null,
    address: null,
    activeCredentialId: null,

    initialize: async () => {
      try {
        const hasPasskey = await hasStoredPasskey();

        if (hasPasskey) {
          const storedAddress = await getStoredAddress();
          if (storedAddress) {
            const user = await Promise.race([
              getCurrentUser<TExtra>(config.apiUrl, storedAddress),
              new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 2000)
              ),
            ]).catch(() => undefined);

            if (user === null) {
              await clearSession();
              await clearPasskeyMetadata();
              set({ isInitialized: true, hasExistingPasskey: false });
              return;
            }
          } else {
            const metadata = await getStoredPasskeyMetadata();
            if (metadata && !metadata.publicKeyX && !metadata.publicKeyY) {
              await clearPasskeyMetadata();
              set({ isInitialized: true, hasExistingPasskey: false });
              return;
            }
          }
        }

        set({ isInitialized: true, hasExistingPasskey: hasPasskey });
      } catch (error) {
        console.error('Failed to initialize passkey auth:', error);
        set({ isInitialized: true, error: 'Failed to initialize wallet' });
      }
    },

    createWallet: async () => {
      set({ isLoading: true, error: null, needsNewPasskey: false });

      try {
        const tempId = `user-${Date.now()}`;
        const { credentialId, publicKeyX, publicKeyY, rpId } =
          await registerPasskey(resolvedAlias, tempId, {
            rpId: config.rpId,
            rpName: config.rpName,
          });

        const now = new Date().toISOString();
        const pubkeyXHex = bytesToHex(publicKeyX);
        const pubkeyYHex = bytesToHex(publicKeyY);

        await storePasskeyMetadata({
          credentialId,
          publicKeyX: pubkeyXHex,
          publicKeyY: pubkeyYHex,
          rpId,
          createdAt: now,
          lastUsedAt: now,
        });

        const response = await postJson<PasskeyAuthApiResponse<TExtra>>(
          `${config.apiUrl}/auth/register-passkey-wallet`,
          {
            pubkeyX: pubkeyXHex,
            pubkeyY: pubkeyYHex,
            credentialId,
          }
        );

        const walletAddress = response.user.publicKey;
        await storeWalletInfo(
          walletAddress,
          response.user.id,
          response.user.tokenAccountAddress ?? undefined
        );

        set({
          isLoading: false,
          isAuthenticated: true,
          hasExistingPasskey: true,
          activeCredentialId: credentialId,
          address: walletAddress,
          user: toPasskeyUser(response.user),
        });

        return true;
      } catch (error) {
        if (classifyPasskeyError(error) === 'USER_CANCELLED') {
          set({ isLoading: false });
          return false;
        }

        console.error('Failed to create passkey wallet:', error);
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to create wallet',
        });
        return false;
      }
    },

    unlockWithPasskey: async () => {
      set({ isLoading: true, error: null, needsNewPasskey: false });

      try {
        const metadata = await getStoredPasskeyMetadata();
        if (!metadata) throw new Error('No stored passkey found');

        await signWithPasskey(
          metadata.credentialId,
          crypto.getRandomValues(new Uint8Array(32)),
          metadata.rpId
        );
        await touchPasskeyLastUsedAt().catch((error) => {
          console.warn('Failed to update passkey last-used timestamp:', error);
        });

        const hasWallet = await hasStoredWallet();
        let walletAddress: string;
        let userId: string;
        let tokenAccountAddress: string | undefined;
        let response: PasskeyAuthApiResponse<TExtra> | null = null;

        if (hasWallet) {
          const storedAddress = await getStoredAddress();
          const storedUserId = await getStoredUserId();
          if (!storedAddress || !storedUserId) {
            throw new Error('Incomplete wallet data');
          }

          walletAddress = storedAddress;
          userId = storedUserId;

          const current = await getCurrentUser<TExtra>(config.apiUrl, walletAddress);
          if (current) {
            response = current;
            tokenAccountAddress = current.user.tokenAccountAddress ?? undefined;
          } else if (metadata.publicKeyX && metadata.publicKeyY) {
            response = await postJson<PasskeyAuthApiResponse<TExtra>>(
              `${config.apiUrl}/auth/register-passkey-wallet`,
              {
                pubkeyX: metadata.publicKeyX,
                pubkeyY: metadata.publicKeyY,
                credentialId: metadata.credentialId,
              }
            );
            walletAddress = response.user.publicKey;
            userId = response.user.id;
            tokenAccountAddress = response.user.tokenAccountAddress ?? undefined;
            await storeWalletInfo(walletAddress, userId, tokenAccountAddress);
          } else {
            await clearSession();
            await clearPasskeyMetadata();
            set({ isLoading: false, hasExistingPasskey: false, error: null });
            return false;
          }
        } else if (metadata.publicKeyX && metadata.publicKeyY) {
          response = await postJson<PasskeyAuthApiResponse<TExtra>>(
            `${config.apiUrl}/auth/register-passkey-wallet`,
            {
              pubkeyX: metadata.publicKeyX,
              pubkeyY: metadata.publicKeyY,
              credentialId: metadata.credentialId,
            }
          );
          walletAddress = response.user.publicKey;
          userId = response.user.id;
          tokenAccountAddress = response.user.tokenAccountAddress ?? undefined;
          await storeWalletInfo(walletAddress, userId, tokenAccountAddress);
        } else {
          const recovered = await postJson<PasskeyAuthApiResponse<TExtra>>(
            `${config.apiUrl}/auth/recover-passkey-wallet`,
            { credentialId: metadata.credentialId }
          ).catch(() => null);

          if (!recovered) {
            await clearSession();
            await clearPasskeyMetadata();
            set({ isLoading: false, hasExistingPasskey: false, error: null });
            return false;
          }

          response = recovered;
          walletAddress = recovered.user.publicKey;
          userId = recovered.user.id;
          tokenAccountAddress = recovered.user.tokenAccountAddress ?? undefined;
          await storeWalletInfo(walletAddress, userId, tokenAccountAddress);
        }

        set({
          isLoading: false,
          isAuthenticated: true,
          activeCredentialId: metadata.credentialId,
          address: walletAddress,
          user: response ? toPasskeyUser(response.user) : get().user,
        });

        return true;
      } catch (error) {
        console.error('Failed to unlock with passkey:', error);
        const kind = classifyPasskeyError(error);

        if (kind === 'USER_CANCELLED') {
          set({ isLoading: false });
        } else if (kind === 'NOT_FOUND') {
          await clearPasskeyMetadata();
          set({ isLoading: false, hasExistingPasskey: false, error: null });
        } else {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to unlock',
          });
        }

        return false;
      }
    },

    recoverWithDiscoverablePasskey: async () => {
      set({ isLoading: true, error: null, needsNewPasskey: false });

      try {
        const discovered = await authenticateWithDiscoverablePasskey({
          rpId: config.rpId,
        });

        if (!discovered) {
          set({ isLoading: false });
          return false;
        }

        const response = await postJson<PasskeyAuthApiResponse<TExtra>>(
          `${config.apiUrl}/auth/recover-passkey-wallet`,
          { credentialId: discovered.credentialId }
        ).catch(() => null);

        if (!response) {
          set({ isLoading: false, needsNewPasskey: true });
          return false;
        }

        const walletAddress = response.user.publicKey;
        const userId = response.user.id;
        const tokenAccountAddress = response.user.tokenAccountAddress ?? undefined;
        const now = new Date().toISOString();

        await storePasskeyMetadata({
          credentialId: discovered.credentialId,
          publicKeyX: '',
          publicKeyY: '',
          rpId: discovered.rpId,
          createdAt: now,
          lastUsedAt: now,
        });
        await storeWalletInfo(walletAddress, userId, tokenAccountAddress);

        set({
          isLoading: false,
          isAuthenticated: true,
          hasExistingPasskey: true,
          activeCredentialId: discovered.credentialId,
          address: walletAddress,
          user: toPasskeyUser(response.user),
        });

        return true;
      } catch (error) {
        console.error('Failed to recover with discoverable passkey:', error);
        set({
          isLoading: false,
          error:
            error instanceof Error ? error.message : 'Failed to recover wallet',
        });
        return false;
      }
    },

    logout: async () => {
      try {
        await clearSession();
      } catch (error) {
        console.error('Failed to clear passkey session:', error);
      }

      set({
        isAuthenticated: false,
        needsNewPasskey: false,
        user: null,
        address: null,
        activeCredentialId: null,
      });
    },

    clearError: () => set({ error: null }),
    dismissNewPasskey: () => set({ needsNewPasskey: false }),
  }));
}

export function getPasskeyAuthStore<TExtra = Record<string, never>>(
  config: PasskeyAuthConfig
): PasskeyAuthBoundStore<TExtra> {
  const key = createStoreKey(config);
  const cached = storeCache.get(key) as PasskeyAuthBoundStore<TExtra> | undefined;
  if (cached) return cached;

  const store = createPasskeyAuthStore<TExtra>(config);
  storeCache.set(key, store);
  return store;
}

export function usePasskeyAuth<TExtra = Record<string, never>>(
  config: PasskeyAuthConfig
): PasskeyAuthStore<TExtra> {
  return getPasskeyAuthStore<TExtra>(config)();
}
