import { encodeAddress } from "@thru/sdk/helpers";
import {
  OracleEvent as AbiOracleEvent,
  type BooleanUpdateEventData,
  type PriceUpdateEventData,
} from "./abi/thru/program/oracle/types";
import {
  ORACLE_EVENT_TYPE_BOOLEAN_UPDATE,
  ORACLE_EVENT_TYPE_PRICE_UPDATE,
} from "./constants";
import { decodeFeedName } from "./decode";
import type {
  OracleBooleanUpdateEvent,
  OracleEvent,
  OraclePriceUpdateEvent,
} from "./types";

const PRICE_UPDATE_EVENT_LENGTH = 121;
const BOOLEAN_UPDATE_EVENT_LENGTH = 107;

export function parseOracleEvent(data: Uint8Array): OracleEvent {
  const eventType = data[0];
  const expectedLength =
    eventType === ORACLE_EVENT_TYPE_PRICE_UPDATE
      ? PRICE_UPDATE_EVENT_LENGTH
      : eventType === ORACLE_EVENT_TYPE_BOOLEAN_UPDATE
        ? BOOLEAN_UPDATE_EVENT_LENGTH
        : null;
  if (expectedLength === null)
    throw new Error(`Unknown Oracle event type: ${eventType}`);
  if (data.length !== expectedLength) {
    throw new Error(
      `Malformed Oracle event: expected ${expectedLength} bytes, got ${data.length}`,
    );
  }

  const event = AbiOracleEvent.from_array(data);
  if (!event) throw new Error("Malformed Oracle event");

  if (eventType === ORACLE_EVENT_TYPE_PRICE_UPDATE)
    return parsePriceEvent(event.data().asPriceUpdate());
  return parseBooleanEvent(event.data().asBooleanUpdate());
}

function parsePriceEvent(
  data: PriceUpdateEventData | null,
): OraclePriceUpdateEvent {
  if (!data) throw new Error("Malformed Oracle price update event");
  return {
    kind: "priceUpdate",
    feedName: decodeFeedName(data.get_feed_name()),
    feedAddress: encodeAddress(
      Uint8Array.from(data.get_feed_address().get_bytes()),
    ),
    oldPrice: data.get_old_price(),
    newPrice: data.get_new_price(),
    timestampNs: data.get_timestamp_ns(),
  };
}

function parseBooleanEvent(
  data: BooleanUpdateEventData | null,
): OracleBooleanUpdateEvent {
  if (!data) throw new Error("Malformed Oracle boolean update event");
  const oldValue = data.get_old_value();
  const newValue = data.get_new_value();
  if (oldValue > 1)
    throw new Error(`Invalid Oracle boolean value: ${oldValue}`);
  if (newValue > 1)
    throw new Error(`Invalid Oracle boolean value: ${newValue}`);
  return {
    kind: "booleanUpdate",
    feedName: decodeFeedName(data.get_feed_name()),
    feedAddress: encodeAddress(
      Uint8Array.from(data.get_feed_address().get_bytes()),
    ),
    oldValue: oldValue === 1,
    newValue: newValue === 1,
    timestampNs: data.get_timestamp_ns(),
  };
}
