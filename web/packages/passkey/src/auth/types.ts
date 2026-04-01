import type { StoreApi, UseBoundStore } from 'zustand';

export interface PasskeyApiUser<TExtra = Record<string, never>> {
  id: string;
  publicKey: string;
  tokenAccountAddress?: string | null;
  extras?: TExtra;
}

export interface PasskeyAuthApiResponse<TExtra = Record<string, never>> {
  success: boolean;
  user: PasskeyApiUser<TExtra>;
}

export interface PasskeyUser<TExtra = Record<string, never>> {
  id: string;
  displayName: string;
  tokenAccountAddress?: string | null;
  extras?: TExtra;
}

export interface PasskeyAuthConfig {
  apiUrl: string;
  alias?: string;
  rpId?: string;
  rpName?: string;
}

export interface PasskeyAuthState<TExtra = Record<string, never>> {
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  hasExistingPasskey: boolean;
  needsNewPasskey: boolean;
  error: string | null;
  user: PasskeyUser<TExtra> | null;
  address: string | null;
  activeCredentialId: string | null;
}

export interface PasskeyAuthActions<TExtra = Record<string, never>> {
  initialize: () => Promise<void>;
  createWallet: () => Promise<boolean>;
  unlockWithPasskey: () => Promise<boolean>;
  recoverWithDiscoverablePasskey: () => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  dismissNewPasskey: () => void;
}

export type PasskeyAuthStore<TExtra = Record<string, never>> =
  PasskeyAuthState<TExtra> & PasskeyAuthActions<TExtra>;

export type PasskeyAuthBoundStore<TExtra = Record<string, never>> = UseBoundStore<
  StoreApi<PasskeyAuthStore<TExtra>>
>;
