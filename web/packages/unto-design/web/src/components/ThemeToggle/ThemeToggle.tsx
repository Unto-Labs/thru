"use client";

import * as React from "react";
import { cn } from "../../utils";
import "./ThemeToggle.css";

const THEME_RETOKENIZE_MS = 1180;

const Sun = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const Moon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

export type ColorScheme = "light" | "dark";

export interface UseColorSchemeOptions {
  /** localStorage key holding the visitor's choice. App-scoped, so switching
   *  themes on one surface never rewrites another's stored preference. */
  storageKey: string;
  /** Scheme the server rendered, used until localStorage is read. */
  defaultScheme?: ColorScheme;
}

export interface ColorSchemeControls {
  theme: ColorScheme;
  /** Toggle to the other scheme. */
  toggle: () => void;
}

/**
 * useColorScheme owns the `data-theme` attribute on `<html>`, its localStorage
 * persistence, and the switch animation: a staggered `retokenize` re-paint, or
 * an instant switch under `prefers-reduced-motion`.
 *
 * Exposed separately from `ThemeToggle` because surfaces also read the scheme
 * to swap themed assets (the explorer's light/dark wordmark).
 */
export function useColorScheme({
  storageKey,
  defaultScheme = "dark",
}: UseColorSchemeOptions): ColorSchemeControls {
  const [theme, setTheme] = React.useState<ColorScheme>(defaultScheme);
  const transitionTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") {
      /* One-shot sync FROM localStorage after hydration — the server always
         renders the default scheme, so reading during render would mismatch. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(stored);
    }
  }, [storageKey]);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Persist only explicit toggles below: writing the default here can erase
    // the saved choice when Strict Mode replays mount effects.
  }, [theme]);

  React.useEffect(() => {
    return () => {
      if (transitionTimerRef.current != null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const applyTheme = (nextTheme: ColorScheme) => {
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(storageKey, nextTheme);
    setTheme(nextTheme);
  };

  const toggle = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;

    if (transitionTimerRef.current != null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      delete root.dataset.themeTransition;
      applyTheme(nextTheme);
      return;
    }

    root.dataset.themeTransition = "retokenize";
    applyTheme(nextTheme);

    transitionTimerRef.current = window.setTimeout(() => {
      delete root.dataset.themeTransition;
      transitionTimerRef.current = null;
    }, THEME_RETOKENIZE_MS);
  };

  return { theme, toggle };
}

export interface ThemeToggleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onToggle"> {
  /** Current scheme, from `useColorScheme`. */
  theme: ColorScheme;
  /** Toggle handler, from `useColorScheme`. */
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * ThemeToggle — the Sun/Moon dark-mode switcher. Presentational: pair it with
 * `useColorScheme`, which owns the scheme.
 *
 *   const { theme, toggle } = useColorScheme({ storageKey: "unto-scan-theme" });
 *   <ThemeToggle theme={theme} onToggle={toggle} />
 */
export function ThemeToggle({ theme, onToggle, className, ...props }: ThemeToggleProps) {
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      className={cn("uds-theme-toggle", className)}
      aria-label={label}
      title={label}
      onClick={onToggle}
      {...props}
    >
      <Sun
        className={cn(
          "uds-theme-toggle__icon",
          theme === "light" && "uds-theme-toggle__icon--active",
        )}
      />
      <Moon
        className={cn(
          "uds-theme-toggle__icon",
          theme === "dark" && "uds-theme-toggle__icon--active",
        )}
      />
    </button>
  );
}
