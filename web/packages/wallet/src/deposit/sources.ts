import type { DepositSource } from "../protocol";

/** A network the wallet's crypto rail accepts deposits from. */
export interface CryptoDepositSource extends DepositSource {
  /** `${chainType}:${chainId}`, lower case. */
  key: string;
  /** What the network is called on screen, such as "Base". */
  name: string;
}

/* The wallet's crypto rail and every host read this one list. The order is the
   rail's; `symbol` is the token the rail preselects on that network. */
export const CRYPTO_DEPOSIT_SOURCES: readonly CryptoDepositSource[] = [
  { key: "ethereum:8453", chainType: "ethereum", chainId: "8453", name: "Base", symbol: "USDC" },
  { key: "ethereum:1", chainType: "ethereum", chainId: "1", name: "Ethereum", symbol: "ETH" },
  { key: "solana:mainnet", chainType: "solana", chainId: "mainnet", name: "Solana", symbol: "USDC" },
  { key: "ethereum:42161", chainType: "ethereum", chainId: "42161", name: "Arbitrum", symbol: "USDC" },
  { key: "ethereum:137", chainType: "ethereum", chainId: "137", name: "Polygon", symbol: "USDC" },
  { key: "bitcoin:mainnet", chainType: "bitcoin", chainId: "mainnet", name: "Bitcoin", symbol: "BTC" },
];

/** Tokens the crypto rail accepts. */
export const CRYPTO_DEPOSIT_SYMBOLS = ["USDC", "USDT", "ETH", "BTC"] as const;

/** Tokens the rail accepts only on some networks. */
export const CRYPTO_DEPOSIT_KEYS_BY_SYMBOL: Readonly<Record<string, readonly string[]>> = {
  ETH: ["ethereum:1", "ethereum:8453", "ethereum:42161", "ethereum:137"],
  BTC: ["bitcoin:mainnet"],
};

/** The network the rail opens on when the host names none. */
export const CRYPTO_DEPOSIT_PREFERRED_KEY = "ethereum:8453";
