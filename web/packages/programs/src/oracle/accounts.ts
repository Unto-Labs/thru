import type { Account } from "@thru/sdk";
import {
  OracleFeedAccount,
  type OracleBooleanFeedData,
  type OraclePriceFeedData,
} from "./abi/thru/program/oracle/types";
import { ORACLE_FEED_TYPE_BOOLEAN, ORACLE_FEED_TYPE_PRICE } from "./constants";
import { decodeCommonFeedData } from "./decode";
import type { OracleBooleanFeed, OracleFeed, OraclePriceFeed } from "./types";

const PRICE_FEED_ACCOUNT_LENGTH = 161;
const BOOLEAN_FEED_ACCOUNT_LENGTH = 146;

export function parseOracleFeedAccount(
  account: Account | Uint8Array,
): OracleFeed {
  const data = account instanceof Uint8Array ? account : account.data?.data;
  if (!data) throw new Error("Oracle feed account data is missing");

  const feedType = data[0];
  const expectedLength =
    feedType === ORACLE_FEED_TYPE_PRICE
      ? PRICE_FEED_ACCOUNT_LENGTH
      : feedType === ORACLE_FEED_TYPE_BOOLEAN
        ? BOOLEAN_FEED_ACCOUNT_LENGTH
        : null;
  if (expectedLength === null)
    throw new Error(`Unknown Oracle feed type: ${feedType}`);
  if (data.length !== expectedLength) {
    throw new Error(
      `Malformed Oracle feed account: expected ${expectedLength} bytes, got ${data.length}`,
    );
  }

  const feed = OracleFeedAccount.from_array(data);
  if (!feed) throw new Error("Malformed Oracle feed account");

  if (feedType === ORACLE_FEED_TYPE_PRICE)
    return parsePriceFeed(feed.data().asPrice());
  return parseBooleanFeed(feed.data().asBoolean());
}

function parsePriceFeed(data: OraclePriceFeedData | null): OraclePriceFeed {
  if (!data) throw new Error("Malformed Oracle price feed account");
  return {
    kind: "price",
    common: decodeCommonFeedData(data.get_common()),
    price: data.get_price(),
    maxVarianceBps: data.get_max_variance_bps(),
    exponent: data.get_exponent(),
  };
}

function parseBooleanFeed(
  data: OracleBooleanFeedData | null,
): OracleBooleanFeed {
  if (!data) throw new Error("Malformed Oracle boolean feed account");
  const value = data.get_value();
  if (value > 1) throw new Error(`Invalid Oracle boolean value: ${value}`);
  return {
    kind: "boolean",
    common: decodeCommonFeedData(data.get_common()),
    value: value === 1,
  };
}
