import { BOOTSTRAP_PROGRAM_ADDRESSES } from "../bootstrap-addresses";

export const ORACLE_PROGRAM_ADDRESS = BOOTSTRAP_PROGRAM_ADDRESSES.oracle;

export { decodeOracleFeedAccount, parseOracleFeedAccount } from "./accounts";
export { deriveOracleFeedAddress, normalizeOracleFeedSeed } from "./derivation";
export { oracleProgramErrorFromCode, OracleProgramError } from "./errors";
export { parseOracleEvent } from "./events";

export {
  ORACLE_ACCOUNT_TYPE_BOOL_FEED_V1,
  ORACLE_ACCOUNT_TYPE_PRICE_FEED_V1,
  ORACLE_EVENT_TYPE_BOOLEAN_UPDATE,
  ORACLE_EVENT_TYPE_PRICE_UPDATE,
  ORACLE_FEED_SEED_LENGTH,
  ORACLE_FEED_TYPE_BOOLEAN,
  ORACLE_FEED_TYPE_PRICE,
} from "./constants";

export type {
  OracleBooleanFeed,
  OracleBooleanUpdateEvent,
  OracleEvent,
  OracleFeed,
  OracleFeedCommon,
  OraclePriceFeed,
  OraclePriceUpdateEvent,
} from "./types";
