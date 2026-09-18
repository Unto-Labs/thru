/* Chain / token registry — muted, on-brand Thru-palette colors (from
   thru-design). ChainIcon, TokenIcon, and Balance look up here so badges read
   on-palette by default; callers can still override color/glyph per instance.
   Chains that ship a brand logo carry it as `logo` (a data URI) and ChainIcon
   draws that instead of the glyph disc. */

import { NETWORK_LOGOS } from "./assets/logos";

export interface AssetMeta {
  name: string;
  short: string;
  color: string;
  glyph: string;
  /** Brand logo (image URL / data URI); drawn in place of the glyph disc. */
  logo?: string;
}

/* Non-EVM chains use their SLIP-0044 coin type as the id (Bitcoin 0,
   Solana 501) so this stays a numeric map next to the EVM chain ids. */
export const CHAIN_ID_BITCOIN = 0;
export const CHAIN_ID_SOLANA = 501;

export const CHAINS: Record<number, AssetMeta> = {
  [CHAIN_ID_BITCOIN]: { name: "Bitcoin", short: "BTC", color: "#ffad42", glyph: "₿", logo: NETWORK_LOGOS.bitcoin },
  1: { name: "Ethereum", short: "ETH", color: "#436465", glyph: "Ξ", logo: NETWORK_LOGOS.ethereum },
  10: { name: "Optimism", short: "OP", color: "#d33c43", glyph: "OP" },
  137: { name: "Polygon", short: "POL", color: "#0a766f", glyph: "P" },
  [CHAIN_ID_SOLANA]: { name: "Solana", short: "SOL", color: "#0a766f", glyph: "S", logo: NETWORK_LOGOS.solana },
  8453: { name: "Base", short: "BASE", color: "#0279b1", glyph: "B", logo: NETWORK_LOGOS.base },
  42161: { name: "Arbitrum", short: "ARB", color: "#334747", glyph: "A", logo: NETWORK_LOGOS.arbitrum },
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
