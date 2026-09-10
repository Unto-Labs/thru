import { useCallback, useEffect, useRef } from "react";
import type {
  CreateAccountOptions,
  NativeSDK,
  SignInOptions,
} from "../../NativeSDK";
import { useThru } from "./useThru";
import { waitForWallet } from "./waitForWallet";

/** Native-only passkey sign-in and account-creation operations. */
export function useNativeOnboarding() {
  const { wallet } = useThru();
  const walletRef = useRef<NativeSDK | null>(wallet);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  const signIn = useCallback(async (options: SignInOptions) => {
    const sdk = walletRef.current ?? (await waitForWallet(() => walletRef.current));
    return sdk.nativeOnboarding.signIn(options);
  }, []);

  const createAccount = useCallback(async (options?: CreateAccountOptions) => {
    const sdk = walletRef.current ?? (await waitForWallet(() => walletRef.current));
    return sdk.nativeOnboarding.createAccount(options);
  }, []);

  return { signIn, createAccount };
}
