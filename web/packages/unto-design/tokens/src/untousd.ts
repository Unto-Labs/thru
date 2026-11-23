/** Winged Monorail mark path, shared by web and native. */
export const UNTOUSD_DOLLAR_PATH = "M81.5 40H52l-8 9v8l8 9h24l8 9v8l-8 9H44";
export const UNTOUSD_STEM_PATH = "M64 24v80";
export const UNTOUSD_WINGS_PATH = "M24 52h12M29 67h7M92 52h12M92 67h7";
export const UNTOUSD_RED = "#d33c43";
export const isUntoUsdSymbol = (symbol: string): boolean =>
  ["$", "UNTOUSD"].includes(symbol.trim().toUpperCase());
