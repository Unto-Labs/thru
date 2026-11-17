import type { Account } from "@thru/sdk";
import {
  OracleFeedAccount,
  type OracleBooleanFeedData,
  type OraclePriceFeedData,
} from "./abi/thru/program/oracle/types";
import { decodeCommonFeedData } from "./decode";
import type { OracleBooleanFeed, OracleFeed, OraclePriceFeed } from "./types";
import { decodeAccountRoot } from "../utils/account-root";

/**
 * Decodes Oracle program account data through its account root. Byte 0 is
 * the account type (price feed or boolean feed); returns null for any other
 * type or a buffer whose size does not match that type exactly.
 */
export function decodeOracleFeedAccount(data: Uint8Array): OracleFeedAccount | null {
  return decodeAccountRoot(data, (bytes) => OracleFeedAccount.from_array(bytes));
}

export function parseOracleFeedAccount(
  account: Account | Uint8Array,
): OracleFeed {
  const data = account instanceof Uint8Array ? account : account.data?.data;
  if (!data) throw new Error("Oracle feed account data is missing");

  const feed = decodeOracleFeedAccount(data);
  if (!feed) {
    throw new Error(
      `Not an Oracle feed account: account type ${data[0]}, ${data.length} bytes`,
    );
  }
  const payload = feed.payload();
  const price = payload.asPriceFeedV1();
  if (price) return parsePriceFeed(price);
  return parseBooleanFeed(payload.asBoolFeedV1());
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
