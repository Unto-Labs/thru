import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import {
  NativeSDK,
  type CreateAccountOptions,
  type NativeSDKConfig,
} from "../NativeSDK";
import type { CreateAccountResult } from "../../protocol";
import { useWalletSDKController } from "../../react/useWalletSDKController";
import { ThruContext } from "./ThruContext";

export interface ThruProviderProps {
  children: ReactNode;
  config: NativeSDKConfig;
}

/** Native wrapper around the shared wallet React controller. */
export function ThruProvider({ children, config }: ThruProviderProps) {
  const sdk = useMemo(() => new NativeSDK(config), []);
  const controller = useWalletSDKController(sdk);

  useEffect(() => () => sdk.destroy(), [sdk]);

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
