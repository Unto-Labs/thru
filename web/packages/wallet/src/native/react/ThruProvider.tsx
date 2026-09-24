import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useColorScheme } from "react-native";
import {
  NativeSDK,
  type CreateAccountOptions,
  type NativeSDKConfig,
} from "../NativeSDK";
import type {
  CreateAccountResult,
  WalletTheme,
  WalletThemePreference,
} from "../../protocol";
import { useWalletSDKController } from "../../react/useWalletSDKController";
import { ThruContext } from "./ThruContext";

export interface ThruProviderProps {
  children: ReactNode;
  config: NativeSDKConfig;
  /**
   * The color scheme the wallet's sheets draw for: `light`, `dark`, or
   * `system` to follow the device setting. Unlike `config`, changes apply
   * live. Falls back to `config.theme`, then light.
   */
  theme?: WalletThemePreference;
  /**
   * Ask the wallet for developer mode: raw errors, Coinbase's sandbox for
   * card purchases, and the test faucet in Add funds. Changes apply live.
   * Falls back to `config.developerMode`, then off.
   */
  developerMode?: boolean;
}

/** Native wrapper around the shared wallet React controller. */
export function ThruProvider({ children, config, theme, developerMode }: ThruProviderProps) {
  const requestedTheme = theme ?? config.theme ?? "light";
  const requestedDeveloperMode = developerMode ?? config.developerMode ?? false;
  const systemTheme: WalletTheme = useColorScheme() === "dark" ? "dark" : "light";
  const sdk = useMemo(() => {
    const instance = new NativeSDK(config);
    /* Resolve before any wallet WebView builds its URL, so the first load
       already draws in the right scheme. */
    instance.setSystemTheme(systemTheme);
    instance.setTheme(requestedTheme);
    instance.setDeveloperMode(requestedDeveloperMode);
    return instance;
  }, []);
  const controller = useWalletSDKController(sdk);

  useEffect(() => () => sdk.destroy(), [sdk]);

  useEffect(() => {
    sdk.setSystemTheme(systemTheme);
  }, [sdk, systemTheme]);

  useEffect(() => {
    sdk.setTheme(requestedTheme);
  }, [sdk, requestedTheme]);

  useEffect(() => {
    sdk.setDeveloperMode(requestedDeveloperMode);
  }, [sdk, requestedDeveloperMode]);

  const createAccount = useCallback(
    async (options?: CreateAccountOptions): Promise<CreateAccountResult> => {
      try {
        const result = await sdk.nativeOnboarding.createAccount(options);
        controller.syncFromSDK(result.selectedAccount);
        return result;
      } catch (error) {
        controller.captureError(error);
        throw error;
      }
    },
    [controller, sdk],
  );

  return (
    <ThruContext.Provider
      value={{
        wallet: sdk,
        thru: sdk.getThru(),
        ...controller,
        createAccount,
      }}
    >
      {children}
    </ThruContext.Provider>
  );
}
