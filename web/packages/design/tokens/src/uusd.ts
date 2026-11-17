/* Generic placeholder for the Unto dollar until UUSD's logomark ships. */
export const UUSD_PLACEHOLDER_COLOR = "#6b7280";
export const isUusdSymbol = (symbol: string): boolean =>
  ["$", "USD", "UUSD", "THRUSD", "THRUUSD"].includes(symbol.trim().toUpperCase());
