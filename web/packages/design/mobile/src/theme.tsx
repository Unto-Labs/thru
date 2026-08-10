/**
 * Light/dark theming for the Thru Mobile kit.
 *
 * The two palettes are transcribed 1:1 from the `--tm-*` custom properties in
 * the imported Claude Design project (`design/thru-mobile.dc.html` and the
 * "Add Cash Flow" project's `CashScreen.dc.html`). `tokens.ts` keeps exporting
 * the flat light `color` object so existing call sites keep working; anything
 * that needs to follow the theme reads `useTheme()` or builds its stylesheet
 * with `makeStyles()`.
 */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { palette } from "./tokens";

export type ThemeName = "light" | "dark";

/** What the app stores; "system" follows the OS appearance setting. */
export type ThemePreference = ThemeName | "system";

export interface ThemeColors {
  /* Surfaces */
  bg: string;
  bgMuted: string;
  bgInset: string;
  bgInverse: string;
  /* Text */
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  fgInverse: string;
  /** Pressed state for a primary (inverse) surface. */
  fgPress: string;
  /* Lines */
  border: string;
  borderStrong: string;
  /* Brand */
  accent: string;
  accentSoft: string;
  destructive: string;
  /** Foreground on an accent/brand fill. */
  onBrand: string;
  /** Foreground on a warm (saffron/sand) fill. */
  onWarm: string;
  brickSoft: string;
  brickStrong: string;
  /* Status */
  oceanSoft: string;
  ocean: string;
  forestSoft: string;
  forest: string;
  saffronSoft: string;
  saffron: string;
  /** Validation red — the same bright red in both themes, per the design. */
  error: string;
  /* Overlays */
  scrim: string;
  sheetShadow: string;
}

export const lightColors: ThemeColors = {
  bg: "#F9FBFB",
  bgMuted: "#EAF2F2",
  bgInset: "#D1E1E1",
  bgInverse: "#181B1B",
  fg: "#181B1B",
  fgMuted: "#436465",
  fgSubtle: "#81A7A7",
  fgInverse: "#F9FBFB",
  fgPress: "#000000",
  border: "#D1E1E1",
  borderStrong: "#B6CECE",
  accent: "#D33C43",
  accentSoft: "#FADFE1",
  destructive: "#D33C43",
  onBrand: "#F9FBFB",
  onWarm: "#181B1B",
  brickSoft: "#FADFE1",
  brickStrong: "#F6ACB0",
  oceanSoft: "#DDF4FD",
  ocean: "#0279B1",
  forestSoft: "#D9F2F1",
  forest: "#0A766F",
  saffronSoft: "#FEF4E7",
  saffron: "#8A5A00",
  error: palette.red.bright,
  scrim: "rgba(24,27,27,0.64)",
  sheetShadow: "rgba(24,27,27,0.18)",
};

export const darkColors: ThemeColors = {
  bg: "#181B1B",
  bgMuted: "#334747",
  bgInset: "#436465",
  bgInverse: "#F9FBFB",
  fg: "#F9FBFB",
  fgMuted: "#B6CECE",
  fgSubtle: "#729D9D",
  fgInverse: "#181B1B",
  fgPress: "#EAF2F2",
  border: "#334747",
  borderStrong: "#436465",
  accent: "#ED787E",
  accentSoft: "#334747",
  destructive: "#ED787E",
  onBrand: "#F9FBFB",
  onWarm: "#181B1B",
  brickSoft: "#334747",
  brickStrong: "#BE2E35",
  oceanSoft: "#0279B1",
  ocean: "#8CD4F2",
  forestSoft: "#0A766F",
  forest: "#75D1CC",
  saffronSoft: "#4A3A1E",
  saffron: "#FFC377",
  error: palette.red.bright,
  scrim: "rgba(0,0,0,0.72)",
  sheetShadow: "rgba(0,0,0,0.5)",
};

export interface Theme {
  name: ThemeName;
  colors: ThemeColors;
  isDark: boolean;
}

export const lightTheme: Theme = {
  name: "light",
  colors: lightColors,
  isDark: false,
};
export const darkTheme: Theme = {
  name: "dark",
  colors: darkColors,
  isDark: true,
};

export const themes: Record<ThemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

/* Defaulting to light keeps components rendered outside a provider looking
   exactly like they did before theming existed. */
const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({
  preference = "system",
  children,
}: {
  preference?: ThemePreference;
  children: ReactNode;
}) {
  const systemScheme = useColorScheme();
  const theme = useMemo(() => {
    if (preference === "light" || preference === "dark") return themes[preference];
    return systemScheme === "dark" ? darkTheme : lightTheme;
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Builds a `useStyles()` hook from a factory that takes the theme's colors.
 * The sheet is created once per theme and cached, so switching themes does not
 * re-run `StyleSheet.create` and unrelated renders stay allocation-free.
 *
 * ```ts
 * const useStyles = makeStyles((c) => ({ row: { backgroundColor: c.bg } }));
 * ```
 */
export function makeStyles<T extends NamedStyles<T>>(
  factory: (colors: ThemeColors, theme: Theme) => T & NamedStyles<T>
): () => T {
  const cache = new Map<ThemeName, T>();
  return function useStyles(): T {
    const theme = useTheme();
    const cached = cache.get(theme.name);
    if (cached) return cached;
    const created = StyleSheet.create(factory(theme.colors, theme));
    cache.set(theme.name, created);
    return created;
  };
}
