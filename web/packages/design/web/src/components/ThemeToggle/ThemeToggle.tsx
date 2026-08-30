"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { cn } from "../../utils";
import type { ColorScheme } from "../wallet/ThemeSwitch/ThemeSwitch";
import "./ThemeToggle.css";

const THEME_RETOKENIZE_MS = 1180;

type ThemeViewTransition = {
  finished: Promise<void>;
  skipTransition?: () => void;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ThemeViewTransition;
};

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

export interface UseColorSchemeOptions {
  /** localStorage key holding the visitor's choice. App-scoped, so switching
   *  themes on one surface never rewrites another's stored preference. */
  storageKey: string;
  /** Scheme the server rendered, used until localStorage is read. */
  defaultScheme?: ColorScheme;
  /** Animated mask revealing the new theme where View Transitions exist. */
  maskImage?: string;
}

export interface ColorSchemeControls {
  theme: ColorScheme;
  /** Toggle to the other scheme, animating out from the pointer position. */
  toggle: (event: { clientX: number; clientY: number }) => void;
}

/**
 * useColorScheme owns the `data-theme` attribute on `<html>`, its localStorage
 * persistence, and the switch animation: a View Transition revealed through the
 * mask GIF where supported, the staggered `retokenize` re-paint otherwise, and
 * an instant switch under `prefers-reduced-motion`.
 *
 * Exposed separately from `ThemeToggle` because surfaces also read the scheme
 * to swap themed assets (the explorer's light/dark wordmark).
 */
export function useColorScheme({
  storageKey,
  defaultScheme = "dark",
  maskImage = "/theme-mask-placeholder-a.gif",
}: UseColorSchemeOptions): ColorSchemeControls {
  const [theme, setTheme] = React.useState<ColorScheme>(defaultScheme);
  const transitionTimerRef = React.useRef<number | null>(null);
  const transitionIdRef = React.useRef(0);
  const activeTransitionRef = React.useRef<ThemeViewTransition | null>(null);

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
    window.localStorage.setItem(storageKey, theme);
  }, [storageKey, theme]);

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

  const clearTransition = (root: HTMLElement) => {
    delete root.dataset.themeTransition;
    root.style.removeProperty("--theme-transition-mask-image");
    root.style.removeProperty("--theme-transition-x");
    root.style.removeProperty("--theme-transition-y");
  };

  const toggle = (event: { clientX: number; clientY: number }) => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const viewTransitionDocument = document as ViewTransitionDocument;

    if (transitionTimerRef.current != null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    if (reduceMotion) {
      clearTransition(root);
      applyTheme(nextTheme);
      return;
    }

    root.style.setProperty("--theme-transition-x", `${event.clientX}px`);
    root.style.setProperty("--theme-transition-y", `${event.clientY}px`);

    if (viewTransitionDocument.startViewTransition) {
      activeTransitionRef.current?.skipTransition?.();
      const transitionId = transitionIdRef.current + 1;
      transitionIdRef.current = transitionId;
      root.dataset.themeTransition = "gif-mask";
      /* The query string restarts the GIF on every switch. */
      root.style.setProperty(
        "--theme-transition-mask-image",
        `url("${maskImage}?transition=${transitionId}")`,
      );

      const transition = viewTransitionDocument.startViewTransition(() => {
        flushSync(() => applyTheme(nextTheme));
      });
      activeTransitionRef.current = transition;

      transition.finished.finally(() => {
        if (transitionIdRef.current !== transitionId) return;
        activeTransitionRef.current = null;
        clearTransition(root);
      });
      return;
    }

    root.dataset.themeTransition = "retokenize";
    applyTheme(nextTheme);

    transitionTimerRef.current = window.setTimeout(() => {
      clearTransition(root);
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
 * ThemeToggle — the square Sun/Moon dark-mode switcher worn by every Thru web
 * surface. Presentational: pair it with `useColorScheme`, which owns the
 * scheme so a surface can also read it (themed assets) without a second source
 * of truth.
 *
 *   const { theme, toggle } = useColorScheme({ storageKey: "thru-scan-theme" });
 *   <ThemeToggle theme={theme} onToggle={toggle} />
 */
export function ThemeToggle({ theme, onToggle, className, ...props }: ThemeToggleProps) {
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      className={cn("tds-theme-toggle", className)}
      aria-label={label}
      title={label}
      onClick={onToggle}
      {...props}
    >
      <Sun
        className={cn(
          "tds-theme-toggle__icon",
          theme === "light" && "tds-theme-toggle__icon--active",
        )}
      />
      <Moon
        className={cn(
          "tds-theme-toggle__icon",
          theme === "dark" && "tds-theme-toggle__icon--active",
        )}
      />
    </button>
  );
}
