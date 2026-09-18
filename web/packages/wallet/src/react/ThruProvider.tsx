"use client";

import { type ReactNode, useCallback, useEffect, useMemo } from "react";
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
}

/** Browser wrapper around the shared wallet React controller. */
export function ThruProvider({ children, config, theme }: ThruProviderProps) {
  const requestedTheme = theme ?? config.theme ?? "light";
  /* Built with the requested theme so the wallet frame's first load already
     draws in it. */
  const sdk = useMemo(() => new BrowserSDK({ ...config, theme: requestedTheme }), []);
  const controller = useWalletSDKController(sdk);

  useEffect(() => {
    void sdk.initialize().catch(controller.captureError);
    return () => sdk.destroy();
    /* SDK configuration is intentionally fixed for the provider lifetime. */
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  /* The one live setting: keyed on the requested string, so a new config
     object identity alone never re-applies it. Also re-arms the `system`
     watcher after a Strict Mode destroy. */
  useEffect(() => {
    sdk.setTheme(requestedTheme);
  }, [sdk, requestedTheme]);

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
