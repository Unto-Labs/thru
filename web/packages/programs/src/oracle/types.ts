export interface OracleFeedCommon {
  maxStalenessNs: bigint;
  lastUpdateNs: bigint;
  adminAddress: string;
  reporterAddress: string;
  feedName: string;
}

export interface OraclePriceFeed {
  kind: "price";
  common: OracleFeedCommon;
  price: bigint;
  maxVarianceBps: number;
  exponent: number;
}

export interface OracleBooleanFeed {
  kind: "boolean";
  common: OracleFeedCommon;
  value: boolean;
}

export type OracleFeed = OraclePriceFeed | OracleBooleanFeed;

export interface OraclePriceUpdateEvent {
  kind: "priceUpdate";
  feedName: string;
  feedAddress: string;
  oldPrice: bigint;
  newPrice: bigint;
  timestampNs: bigint;
}

export interface OracleBooleanUpdateEvent {
  kind: "booleanUpdate";
  feedName: string;
  feedAddress: string;
  oldValue: boolean;
  newValue: boolean;
  timestampNs: bigint;
}

export type OracleEvent = OraclePriceUpdateEvent | OracleBooleanUpdateEvent;
