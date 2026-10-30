"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { BrowserSDK, type BrowserSDKConfig } from "../BrowserSDK";
import type {
  AccountMenuPayload,
  AccountMenuResult,
  WalletThemePreference,
} from "../protocol";
import { ThruContext } from "./ThruContext";
import { useWalletSDKController } from "./useWalletSDKController";

export interface ThruProviderProps {
  children: ReactNode;
  config: BrowserSDKConfig;
  /**
   * The color scheme the wallet's sheets and menus draw for: `light`, `dark`,
   * or `system` to follow the OS setting. Unlike `config`, changes apply
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

export function ThruProvider({ children, config, theme, developerMode }: ThruProviderProps) {
  const requestedTheme = theme ?? config.theme ?? "light";
  const requestedDeveloperMode = developerMode ?? config.developerMode ?? false;
  /* Built with the requested theme and developer mode so the wallet frame's
     first load already has them. */
  const [sdk] = useState(
    () =>
      new BrowserSDK({
        ...config,
        theme: requestedTheme,
        developerMode: requestedDeveloperMode,
      }),
  );
  const controller = useWalletSDKController(sdk);

  useEffect(() => {
    void sdk.initialize().catch(controller.captureError);
    return () => sdk.destroy();
  }, [sdk, controller.captureError]);

  /* The one live setting: keyed on the requested string, so a new config
     object identity alone never re-applies it. Also re-arms the `system`
     watcher after a Strict Mode destroy. */
  useEffect(() => {
    sdk.setTheme(requestedTheme);
  }, [sdk, requestedTheme]);

  useEffect(() => {
    sdk.setDeveloperMode(requestedDeveloperMode);
  }, [sdk, requestedDeveloperMode]);

  const openAccountMenu = useCallback(
    async (options: AccountMenuPayload): Promise<AccountMenuResult> => {
      try {
        const result = await sdk.openAccountMenu(options);
        if (result.accounts) {
          controller.syncFromSDK(result.selectedAccount ?? null);
        }
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
        openAccountMenu,
      }}
    >
      {children}
    </ThruContext.Provider>
  );
}
