'use client';

import { getPasskeyErrorMessage, isEmbeddedContext } from '@/lib/wallet/utils';
import { useSession } from '@/providers/SessionProvider';
import { hexToBytes } from '@thru/passkey';
import { AddressType } from '@thru/chain-interfaces';
import type { DerivedAccount } from '@/types/account';
import {
  createDefaultProfileStore,
  loadPasskeyProfiles,
  savePasskeyProfiles,
  type PasskeyMetadata,
  type PasskeyProfileStore,
  updatePasskeyLastUsed,
  updateProfilePasskey,
} from '@thru/wallet-store';
import {
  isWebAuthnSupported,
  preloadPasskeyClientCapabilities,
  registerPasskey,
  shouldUsePasskeyPopup,
  signWithPasskey,
  signWithStoredPasskey,
} from '@thru/passkey';
import type { PasskeyPopupContext } from '@thru/passkey';
import { AccountStorage } from '@thru/wallet-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface PasskeyAuthContextState {
  isInitialized: boolean;
  walletExists: boolean;
  isPasskeySupported: boolean;
  hasPasskey: boolean;
  passkeyError: string | null;
  isRegisteringPasskey: boolean;
  isSigningWithPasskey: boolean;
  currentPasskey: PasskeyMetadata | null;
  passkeyPublicKey: { x: Uint8Array; y: Uint8Array } | null;
  passkeyStore: PasskeyProfileStore | null;
  registerPasskey: (alias: string) => Promise<boolean>;
  signInWithPasskey: (context?: PasskeyPopupContext) => Promise<boolean>;
  shouldUsePasskeyPopup: () => Promise<boolean>;
  clearPasskeyError: () => void;
  applyPasskeyStoreUpdate: (
    updated: PasskeyProfileStore,
    fallback?: PasskeyMetadata | null,
    options?: { persist?: boolean }
  ) => void;
}

export const PasskeyAuthContext = createContext<PasskeyAuthContextState | null>(null);

export function usePasskeyAuth(): PasskeyAuthContextState {
  const context = useContext(PasskeyAuthContext);
  if (!context) {
    throw new Error('usePasskeyAuth must be used within PasskeyAuthProvider');
  }
  return context;
}

/**
 * Callback ref for post-sign-in account loading.
 * Populated by WalletProviders composition root after AccountProvider mounts.
 */
export type PostSignInHandler = (popupAccounts: DerivedAccount[] | null) => Promise<void>;

interface PasskeyAuthProviderProps {
  children: React.ReactNode;
  postSignInHandlerRef?: React.MutableRefObject<PostSignInHandler | null>;
}

export function PasskeyAuthProvider({ children, postSignInHandlerRef }: PasskeyAuthProviderProps) {
  const { resetLockTimer, setIsUnlocked, ephemeralPasskeySessionRef, isUnlocked } = useSession();

  const [isInitialized, setIsInitialized] = useState(false);
  const [walletExists, setWalletExists] = useState(false);
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);
  const [isSigningWithPasskey, setIsSigningWithPasskey] = useState(false);
  const [passkeyStore, setPasskeyStore] = useState<PasskeyProfileStore | null>(null);
  const [currentPasskey, setCurrentPasskey] = useState<PasskeyMetadata | null>(null);

  const hasPasskey = Boolean(currentPasskey);

  const passkeyPublicKey = useMemo(() => {
    if (!currentPasskey) return null;
    if (currentPasskey.publicKeyX.length !== 64 || currentPasskey.publicKeyY.length !== 64) {
      return null;
    }
    return {
      x: hexToBytes(currentPasskey.publicKeyX),
      y: hexToBytes(currentPasskey.publicKeyY),
    };
  }, [currentPasskey]);

  const applyPasskeyStoreUpdate = useCallback(
    (
      updated: PasskeyProfileStore,
      fallback: PasskeyMetadata | null = null,
      options?: { persist?: boolean }
    ) => {
      if (options?.persist !== false) {
        savePasskeyProfiles(updated).then((ok) => {
          if (!ok) {
            console.warn('[PasskeyAuthProvider] Failed to persist passkey profile update');
          }
        });
      }
      setPasskeyStore(updated);
      const nextPasskey = updated.profiles[updated.selectedIndex]?.passkey ?? fallback;
      setCurrentPasskey(nextPasskey ?? null);
    },
    []
  );

  // Initialize passkey support and wallet state on mount
  useEffect(() => {
    const supported = isWebAuthnSupported();
    setIsPasskeySupported(supported);
    if (supported) {
      preloadPasskeyClientCapabilities();
    }

    const initializeWallet = async () => {
      try {
        let store = await loadPasskeyProfiles();
        if (!store) {
          store = createDefaultProfileStore();
          await savePasskeyProfiles(store);
        }

        setPasskeyStore(store);

        const activePasskey = store.profiles[store.selectedIndex]?.passkey ?? null;
        setCurrentPasskey(activePasskey);
        setWalletExists(Boolean(activePasskey));

        // Integrity check: accounts exist but no profile has a passkey
        if (activePasskey === null) {
          try {
            const hasAccounts = await AccountStorage.hasAccounts();
            const anyProfileHasPasskey = store.profiles.some(p => p.passkey !== null);
            if (hasAccounts && !anyProfileHasPasskey) {
              console.warn('[PasskeyAuthProvider] Accounts found but no passkey profile — you may need to re-register');
            }
          } catch {
            // Non-critical check, ignore errors
          }
        }

        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize wallet:', error);
        setIsInitialized(true);
      }
    };

    initializeWallet();
  }, []);

  useEffect(() => {
    setWalletExists(Boolean(currentPasskey));
  }, [currentPasskey]);

  const clearPasskeyError = useCallback(() => {
    setPasskeyError(null);
  }, []);

  const registerPasskeyForProfile = useCallback(
    async (alias: string): Promise<boolean> => {
      if (!passkeyStore) {
        setPasskeyError('No passkey profile available');
        return false;
      }

      if (!isPasskeySupported) {
        setPasskeyError('WebAuthn is not supported in this browser');
        return false;
      }

      const trimmedAlias = alias.trim();
      if (!trimmedAlias) {
        setPasskeyError('Passkey name is required');
        return false;
      }

      const profileIndex = passkeyStore.selectedIndex;
      const profile = passkeyStore.profiles[profileIndex];
      if (!profile) {
        setPasskeyError('No profile selected');
        return false;
      }

      if (profile.passkey) {
        setPasskeyError('This profile already has a passkey registered');
        return false;
      }

      setIsRegisteringPasskey(true);
      setPasskeyError(null);

      try {
        const result = await registerPasskey(trimmedAlias, profile.id, 'wallet.thru.org');
        const now = new Date().toISOString();

        const passkeyMetadata: PasskeyMetadata = {
          credentialId: result.credentialId,
          publicKeyX: result.publicKeyX,
          publicKeyY: result.publicKeyY,
          rpId: result.rpId,
          label: trimmedAlias,
          createdAt: now,
          lastUsedAt: now,
        };

        const updated = updateProfilePasskey(passkeyStore, profileIndex, passkeyMetadata);
        const persist = !isEmbeddedContext();
        if (persist) {
          const saved = await savePasskeyProfiles(updated);
          if (!saved) {
            setPasskeyError('Passkey created but could not be saved — it may not persist');
          }
        }
        applyPasskeyStoreUpdate(updated, passkeyMetadata, { persist: false });
        if (!persist) {
          ephemeralPasskeySessionRef.current = true;
        }
        setWalletExists(true);

        return true;
      } catch (err) {
        setPasskeyError(getPasskeyErrorMessage(err, 'registration'));
        return false;
      } finally {
        setIsRegisteringPasskey(false);
      }
    },
    [applyPasskeyStoreUpdate, ephemeralPasskeySessionRef, isPasskeySupported, passkeyStore]
  );

  const signInWithPasskeyFn = useCallback(
    async (context?: PasskeyPopupContext): Promise<boolean> => {
      if (!isPasskeySupported) {
        setPasskeyError('WebAuthn is not supported in this browser');
        return false;
      }

      setIsSigningWithPasskey(true);
      setPasskeyError(null);

      try {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        let popupAccounts: DerivedAccount[] | null = null;

        if (isEmbeddedContext()) {
          const store = passkeyStore ?? createDefaultProfileStore();
          const profiles = store.profiles;
          const preferred = profiles[store.selectedIndex]?.passkey ??
            profiles.reduce<PasskeyMetadata | null>((latest, p) => {
              if (!p.passkey) return latest;
              if (!latest || p.passkey.lastUsedAt > latest.lastUsedAt) return p.passkey;
              return latest;
            }, null);
          const allPasskeys = profiles
            .map(p => p.passkey)
            .filter((p): p is PasskeyMetadata => p !== null);

          const popupResult = await signWithStoredPasskey(
            challenge,
            'wallet.thru.org',
            preferred,
            allPasskeys,
            context,
          );
          const passkeyForSession = popupResult.passkey;
          let storeForSession = passkeyStore ?? createDefaultProfileStore();
          const profileIndex = storeForSession.selectedIndex;
          storeForSession = updateProfilePasskey(storeForSession, profileIndex, passkeyForSession);
          const updated = updatePasskeyLastUsed(storeForSession, profileIndex);
          applyPasskeyStoreUpdate(updated, passkeyForSession, { persist: false });
          ephemeralPasskeySessionRef.current = true;

          if (popupResult.accounts && popupResult.accounts.length > 0) {
            popupAccounts = popupResult.accounts.map((account) => ({
              ...account,
              createdAt: account.createdAt ? new Date(account.createdAt) : new Date(),
              label: account.label ?? `Account ${account.index + 1}`,
              addressType: account.addressType ?? AddressType.THRU,
            })) as DerivedAccount[];
          }
        } else {
          let activeStore = passkeyStore;
          let activePasskey = currentPasskey;

          if (!activeStore || !activePasskey) {
            try {
              const store = await loadPasskeyProfiles();
              if (store) {
                setPasskeyStore(store);
                const nextPasskey = store.profiles[store.selectedIndex]?.passkey ?? null;
                setCurrentPasskey(nextPasskey);
                if (nextPasskey) {
                  setWalletExists(true);
                  activeStore = store;
                  activePasskey = nextPasskey;
                }
              }
            } catch (error) {
              const message = getPasskeyErrorMessage(error, 'authentication');
              setPasskeyError(`Failed to load passkey profile (${message})`);
              return false;
            }
          }

          if (!activeStore || !activePasskey) {
            setPasskeyError('No passkey registered for this profile');
            return false;
          }

          await signWithPasskey(activePasskey.credentialId, challenge, activePasskey.rpId);
          const updated = updatePasskeyLastUsed(activeStore, activeStore.selectedIndex);
          applyPasskeyStoreUpdate(updated, activePasskey);
        }

        setIsUnlocked(true);
        resetLockTimer();

        // Delegate account loading to the post-sign-in handler
        if (postSignInHandlerRef?.current) {
          await postSignInHandlerRef.current(popupAccounts);
        }

        return true;
      } catch (err) {
        setPasskeyError(getPasskeyErrorMessage(err, 'authentication', { includeNotFound: true }));
        return false;
      } finally {
        setIsSigningWithPasskey(false);
      }
    },
    [
      applyPasskeyStoreUpdate,
      currentPasskey,
      ephemeralPasskeySessionRef,
      isPasskeySupported,
      passkeyStore,
      postSignInHandlerRef,
      resetLockTimer,
      setIsUnlocked,
    ]
  );

  const shouldUsePasskeyPopupForSignin = useCallback(async (): Promise<boolean> => {
    return shouldUsePasskeyPopup('get');
  }, []);

  // Handle lock event: clear ephemeral passkey state when wallet locks
  const prevUnlockedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (prevUnlockedRef.current === true && !isUnlocked) {
      // Wallet was just locked
      if (ephemeralPasskeySessionRef.current) {
        ephemeralPasskeySessionRef.current = false;
        setPasskeyStore(null);
        setCurrentPasskey(null);
      }
    }
    prevUnlockedRef.current = isUnlocked;
  }, [isUnlocked, ephemeralPasskeySessionRef]);

  const value: PasskeyAuthContextState = {
    isInitialized,
    walletExists,
    isPasskeySupported,
    hasPasskey,
    passkeyError,
    isRegisteringPasskey,
    isSigningWithPasskey,
    currentPasskey,
    passkeyPublicKey,
    passkeyStore,
    registerPasskey: registerPasskeyForProfile,
    signInWithPasskey: signInWithPasskeyFn,
    shouldUsePasskeyPopup: shouldUsePasskeyPopupForSignin,
    clearPasskeyError,
    applyPasskeyStoreUpdate,
  };

  return <PasskeyAuthContext.Provider value={value}>{children}</PasskeyAuthContext.Provider>;
}
