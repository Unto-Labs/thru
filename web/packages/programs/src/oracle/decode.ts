import { encodeAddress } from "@thru/sdk/helpers";
import type {
  FeedName64,
  OracleFeedCommonData,
} from "./abi/thru/program/oracle/types";
import type { OracleFeedCommon } from "./types";

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

export function decodeFeedName(name: FeedName64): string {
  const bytes = name.asUint8Array();
  const terminator = bytes.indexOf(0);
  return TEXT_DECODER.decode(
    terminator === -1 ? bytes : bytes.subarray(0, terminator),
  );
}

export function decodeCommonFeedData(
  common: OracleFeedCommonData,
): OracleFeedCommon {
  return {
    maxStalenessNs: common.get_max_staleness_ns(),
    lastUpdateNs: common.get_last_update_ns(),
    adminAddress: encodeAddress(
      Uint8Array.from(common.get_admin_address().get_bytes()),
    ),
    reporterAddress: encodeAddress(
      Uint8Array.from(common.get_reporter_address().get_bytes()),
    ),
    feedName: decodeFeedName(common.get_feed_name()),
  };
}
