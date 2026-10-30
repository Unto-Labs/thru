/* The FIDO Alliance passkey mark, Mark A (FIDO_Passkey_mark_A_black.svg),
   used under the FIDO usage agreement. Geometry is shared by web and native.
   The four `d` strings are the official file's, byte for byte apart from
   collapsed whitespace: never redraw, simplify or run them through SVGO.
   The source's two-tone shading collapses to one flat colour (FIDO rule). */

export const PASSKEY_ICON_VIEWBOX = "0 0 216 216";

export const PASSKEY_ICON_PATHS = [
  "M172.32,96.79c0,13.78-8.48,25.5-20.29,29.78l7.14,11.83l-10.57,13l10.57,12.71l-17.04,22.87l-12.01-12.82v-25.9v-22.56c-10.68-4.85-18.15-15.97-18.15-28.91c0-17.4,13.51-31.51,30.18-31.51C158.81,65.28,172.32,79.39,172.32,96.79z M142.14,101.61c4.02,0,7.28-3.4,7.28-7.6c0-4.2-3.26-7.61-7.28-7.61s-7.28,3.4-7.28,7.61C134.85,98.21,138.12,101.61,142.14,101.61z",
  "M172.41,96.88c0,13.62-8.25,25.23-19.83,29.67l6.58,11.84l-9.73,13l9.73,12.71l-17.03,23.05v-25.9v-32.77v-26.87c4.02,0,7.28-3.41,7.28-7.6c0-4.2-3.26-7.61-7.28-7.61V65.28C158.86,65.28,172.41,79.43,172.41,96.88z",
  "M120.24,131.43c-9.75-8-16.3-20.3-17.2-34.27H50.8c-10.96,0-19.84,9.01-19.84,20.13v25.17c0,5.56,4.44,10.07,9.92,10.07h69.44c5.48,0,9.92-4.51,9.92-10.07V131.43z",
  "M73.16,91.13c-2.42-0.46-4.82-0.89-7.11-1.86C57.4,85.64,52.36,78.95,50.73,69.5c-1.12-6.47-0.59-12.87,2.03-18.92c3.72-8.6,10.39-13.26,19.15-14.84c5.24-0.94,10.46-0.73,15.5,1.15c7.59,2.82,12.68,8.26,15.03,16.24c2.38,8.05,2.03,16.1-1.56,23.72c-3.72,7.96-10.21,12.23-18.42,13.9c-0.68,0.14-1.37,0.27-2.05,0.41C78,91.13,75.58,91.13,73.16,91.13z",
] as const;

/** Paths 1–3 of the source are `fill-rule="evenodd"`; path 4 is nonzero. */
export const PASSKEY_ICON_EVENODD = [true, true, true, false] as const;

/** FIDO minimum: 24 × 24 including the file's built-in padding. */
export const PASSKEY_ICON_MIN_SIZE = 24;

/** FIDO's attribution line, shown somewhere user-reachable on every surface. */
export const PASSKEY_ICON_ATTRIBUTION = "The passkey icon is a trademark of FIDO Alliance, Inc.";

/** Clamp a requested size to the FIDO minimum. */
export const passkeyIconSize = (size: number | undefined): number =>
  Math.max(PASSKEY_ICON_MIN_SIZE, Number.isFinite(size) ? (size as number) : PASSKEY_ICON_MIN_SIZE);
