/**
 * Thru Mobile design tokens — transcribed 1:1 from the imported Claude Design
 * project (design/thru-mobile.dc.html + thru-mobile-tokens.css). Units are
 * pt (RN dp). Square radii everywhere except the pill.
 */

export const palette = {
  stone: {
    0: "#F9FBFB", 100: "#EAF2F2", 200: "#D1E1E1", 300: "#B6CECE",
    400: "#81A7A7", 500: "#729D9D", 600: "#436465", 700: "#334747", 800: "#181B1B",
  },
  brick: { 100: "#FADFE1", 200: "#F6ACB0", 300: "#ED787E", 400: "#D33C43", 500: "#BE2E35" },
  saffron: { 100: "#FEF4E7", 200: "#FCD9B0", 300: "#FFC377", 400: "#FFAD42" },
  ocean: { 100: "#DDF4FD", 200: "#8CD4F2", 300: "#2EA0C8", 400: "#0279B1" },
  forest: { 100: "#D9F2F1", 200: "#75D1CC", 300: "#239F97", 400: "#0A766F" },
  sand: { 100: "#F6E6D4", 200: "#E2C5A4", 300: "#C98F69", 400: "#DDB8A0" },
  red: { bright: "#FF4750", hot: "#FF3D3D" },
} as const;

export const color = {
  bg: palette.stone[0],
  bgMuted: palette.stone[100],
  bgInset: palette.stone[200],
  bgInverse: palette.stone[800],
  fg: palette.stone[800],
  fgMuted: palette.stone[600],
  fgSubtle: palette.stone[400],
  fgInverse: palette.stone[0],
  border: palette.stone[200],
  borderStrong: palette.stone[300],
  accent: palette.brick[400],
  accentSoft: palette.brick[100],
  destructive: palette.brick[400],
  scrim: "rgba(24, 27, 27, 0.64)",
  error: palette.red.bright,
} as const;

/* Mobile type ramp (px = pt). Buttons/labels/meta are MONO per the kit. */
export const text = {
  xxs: 11, xs: 12, sm: 13, base: 15, md: 17, lg: 20, xl: 24, xxl: 28, xxxl: 34, display: 44,
} as const;

/* expo-google-fonts family names (loaded in App). */
export const font = {
  sans: "InterTight_400Regular",
  sansMedium: "InterTight_500Medium",
  sansSemiBold: "InterTight_600SemiBold",
  sansBold: "InterTight_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
  monoSemiBold: "JetBrainsMono_600SemiBold",
} as const;

export const touch = {
  hitMin: 44,
  controlSm: 36,
  controlMd: 48,
  controlLg: 56,
  navH: 52,
  tabH: 56,
  cellH: 56,
  cellHLg: 64,
  screenX: 16,
  gutter: 12,
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 40, 8: 56 } as const;

export const radius = { none: 0, sheet: 12, pill: 999 } as const;
