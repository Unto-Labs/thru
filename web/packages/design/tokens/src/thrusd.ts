/** Approved winged Monorail mark. Geometry is shared by web and native. */
export const THRUSD_DOLLAR_PATH = "M81.5 40H52l-8 9v8l8 9h24l8 9v8l-8 9H44";
export const THRUSD_STEM_PATH = "M64 24v80";
export const THRUSD_WINGS_PATH = "M24 52h12M29 67h7M92 52h12M92 67h7";
export const THRUSD_RED = "#d33c43";
export const isThruUsdSymbol = (symbol: string): boolean =>
  ["$", "THRUSD", "THRUUSD"].includes(symbol.trim().toUpperCase());
