/**
 * Thru design tokens as a platform-neutral TypeScript object.
 *
 * This is the same source of truth as `tokens.css`, but expressed as plain
 * values so non-CSS targets (React Native / `StyleSheet`) can consume them —
 * RN cannot resolve CSS custom properties, so semantic tokens are pre-resolved
 * to concrete hex here.
 *
 * Canon: Unto-Labs/thru-web. Keep this file and `tokens.css` in lockstep.
 */

export const palette = {
  steel: {
    0: "#f7f8f8", 100: "#eaeef0", 200: "#cdd5db", 300: "#a4b3bc",
    400: "#7e93a0", 500: "#5b6f7b", 600: "#43515b", 700: "#2b353b", 800: "#151b1e",
  },
  teal: {
    0: "#f9fbfb", 100: "#eaf2f2", 200: "#d1e1e1", 300: "#a9c3c5",
    400: "#81a7a7", 500: "#5e8787", 600: "#456063", 700: "#2d3e3e", 800: "#151e1e",
  },
  brick: { 100: "#fbdadc", 200: "#f6acb0", 300: "#ed787e", 400: "#d33c43" },
  sky: { 100: "#cfeffc", 200: "#8cd4f2", 300: "#28a3d7", 400: "#0279b1" },
  grass: { 100: "#c2ebe8", 200: "#75d1cc", 300: "#239f97", 400: "#0a766f" },
  yellow: { 100: "#fdefdd", 200: "#fde0ba", 300: "#fbc784", 400: "#ffad42" },
  tan: { 100: "#f6ebe5", 200: "#ebd5c7", 300: "#ddb8a0", 400: "#c98f69" },
  sand: { 100: "#f6ebe5", 200: "#ebd5c7", 300: "#ddb8a0", 400: "#c98f69" },
  golden: "#ffffbd",
  red: { bright: "#ff4750", hot: "#ff3d3d" },
} as const;

export const color = {
  text: {
    primary: palette.steel[800],
    secondary: palette.teal[600],
    tertiary: palette.steel[400],
    brand: palette.brick[400],
    disabled: palette.steel[300],
    primaryInverse: palette.teal[0],
    secondaryInverse: palette.teal[200],
    tertiaryInverse: palette.teal[400],
    disabledInverse: palette.steel[600],
  },
  border: {
    primary: palette.teal[800],
    secondary: palette.teal[400],
    tertiary: palette.teal[200],
    strong: palette.teal[300],
    brand: palette.brick[400],
    disabled: palette.steel[300],
  },
  danger: {
    text: palette.red.hot,
    border: palette.red.bright,
    surface: palette.red.bright,
  },
  surface: {
    higher: palette.teal[0],
    primary: palette.teal[100],
    lower: palette.teal[200],
    disabled: palette.steel[100],
    higherInverse: palette.teal[600],
    primaryInverse: palette.teal[700],
    lowerInverse: palette.steel[800],
    brick: palette.brick[400],
    sky: palette.sky[400],
    grass: palette.grass[400],
    yellow: palette.yellow[400],
    tan: palette.tan[400],
    sand: palette.sand[400],
  },
} as const;

export const font = {
  sans: '"Inter Tight", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },
  lineHeight: { tight: 1.0, snug: 1.1, body: 1.4, loose: 1.6 },
  tracking: { display: "-0.5px", tight: "-0.25px", normal: "0", utility: "0.02em" },
} as const;

export const space = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 40, 8: 56, 9: 80, 10: 120,
} as const;

export const radius = { none: 0, xs: 2, sm: 4, md: 8, pill: 999 } as const;

export const breakpoint = { sm: 600, md: 840, lg: 1200, xl: 1600 } as const;

export const motion = {
  duration: { fast: 120, med: 200, slow: 320 },
  ease: {
    standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    out: "cubic-bezier(0, 0, 0.2, 1)",
  },
} as const;

export const shadow = {
  sm: "0 1px 2px rgba(21, 30, 30, 0.08)",
  md: "0 4px 12px rgba(21, 30, 30, 0.12)",
  lg: "0 12px 32px rgba(21, 30, 30, 0.18)",
} as const;

export const tokens = { palette, color, font, space, radius, breakpoint, motion, shadow } as const;
export default tokens;
