"use client";

import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { BrowserSDK, type BrowserSDKConfig } from "../BrowserSDK";
import type { AccountMenuPayload, AccountMenuResult } from "../protocol";
import { ThruContext } from "./ThruContext";
import { useWalletSDKController } from "./useWalletSDKController";

export interface ThruProviderProps {
  children: ReactNode;
  config: BrowserSDKConfig;
}

/** Browser wrapper around the shared wallet React controller. */
export function ThruProvider({ children, config }: ThruProviderProps) {
  const sdk = useMemo(() => new BrowserSDK(config), []);
  const controller = useWalletSDKController(sdk);

  useEffect(() => {
    void sdk.initialize().catch(controller.captureError);
    return () => sdk.destroy();
    /* SDK configuration is intentionally fixed for the provider lifetime. */
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

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
