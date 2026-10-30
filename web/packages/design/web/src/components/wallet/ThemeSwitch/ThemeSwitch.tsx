import * as React from "react";
import { cn } from "../../../utils";
import "./ThemeSwitch.css";

export type ColorScheme = "light" | "dark";

export interface ThemeSwitchProps {
  colorScheme: ColorScheme;
  /** Called with the next scheme when toggled. */
  onChange: (scheme: ColorScheme) => void;
  /** Sun (light) icon node — self-contained, bring your own. */
  lightIcon?: React.ReactNode;
  /** Moon (dark) icon node. */
  darkIcon?: React.ReactNode;
  className?: string;
}

export function ThemeSwitch({
  colorScheme,
  onChange,
  lightIcon,
  darkIcon,
  className,
}: ThemeSwitchProps) {
  const isDark = colorScheme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle color scheme"
      className={cn("tds-theme-switch", className)}
      data-checked={isDark ? "" : undefined}
      data-unchecked={isDark ? undefined : ""}
      onClick={() => onChange(isDark ? "light" : "dark")}
    >
      <span className="tds-theme-switch__icon">{lightIcon}</span>
      <span className="tds-theme-switch__icon">{darkIcon}</span>
    </button>
  );
}
