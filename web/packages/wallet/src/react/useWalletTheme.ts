import { useCallback, useSyncExternalStore } from "react";
import type { WalletTheme } from "../protocol";

/** What both BrowserSDK and NativeSDK expose for theme observation. */
export interface WalletThemeSource {
  getTheme(): WalletTheme;
  on(event: "themeChanged", callback: () => void): void;
  off(event: "themeChanged", callback: () => void): void;
}

/** The SDK's resolved wallet theme, re-rendering when it changes; light without an SDK. */
export function useWalletTheme(wallet: WalletThemeSource | null | undefined): WalletTheme {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!wallet) return () => {};
      wallet.on("themeChanged", onChange);
      return () => wallet.off("themeChanged", onChange);
    },
    [wallet],
  );
  const read = useCallback((): WalletTheme => wallet?.getTheme() ?? "light", [wallet]);
  return useSyncExternalStore(subscribe, read, read);
}
