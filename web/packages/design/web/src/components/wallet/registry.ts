/* Chain / token registry — muted, on-brand Thru-palette colors (from
   thru-design). ChainIcon, TokenIcon, and Balance look up here so badges read
   on-palette by default; callers can still override color/glyph per instance. */

export interface AssetMeta {
  name: string;
  short: string;
  color: string;
  glyph: string;
}

export const CHAINS: Record<number, AssetMeta> = {
  1: { name: "Ethereum", short: "ETH", color: "#436465", glyph: "Ξ" },
  10: { name: "Optimism", short: "OP", color: "#d33c43", glyph: "OP" },
  137: { name: "Polygon", short: "POL", color: "#0a766f", glyph: "P" },
  8453: { name: "Base", short: "BASE", color: "#0279b1", glyph: "B" },
  42161: { name: "Arbitrum", short: "ARB", color: "#334747", glyph: "A" },
  84532: { name: "Base Sepolia", short: "BASE", color: "#2ea0c8", glyph: "B" },
  11155420: { name: "OP Sepolia", short: "OP", color: "#ed787e", glyph: "OP" },
};

export const TOKENS: Record<string, AssetMeta> = {
  ETH: { name: "Ether", short: "ETH", color: "#436465", glyph: "Ξ" },
  USDC: { name: "USD Coin", short: "USDC", color: "#0279b1", glyph: "$" },
  USDT: { name: "Tether", short: "USDT", color: "#0a766f", glyph: "₮" },
  WBTC: { name: "Wrapped BTC", short: "WBTC", color: "#ffad42", glyph: "₿" },
  EXP: { name: "Experiment", short: "EXP", color: "#181b1b", glyph: "X" },
};

export const chainMeta = (chainId: number): AssetMeta =>
  CHAINS[chainId] ?? { name: `Chain ${chainId}`, short: "?", color: "var(--color-surface-lower)", glyph: "?" };

export const tokenMeta = (symbol: string): AssetMeta =>
  TOKENS[symbol] ?? { name: symbol, short: symbol, color: "var(--color-surface-lower)", glyph: symbol[0] ?? "?" };
