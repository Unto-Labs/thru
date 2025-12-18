import { Filter } from "../proto/thru/common/v1/filters_pb";
import { PageRequest } from "../proto/thru/common/v1/pagination_pb";
import { Event, ListEventsRequest } from "../proto/thru/services/v1/query_service_pb";
import {
  StreamEventsRequest,
  type StreamEventsResponse,
} from "../proto/thru/services/v1/streaming_service_pb";
import type { EventSource } from "../chain-client";
import { ReplayStream } from "../replay-stream";
import type { ReplayLogger, Slot } from "../types";
import { backfillPage, combineFilters, mapAsyncIterable, slotLiteralFilter } from "./helpers";

export interface EventReplayOptions {
  client: EventSource;
  startSlot: Slot;
  safetyMargin?: bigint;
  pageSize?: number;
  filter?: Filter;
  logger?: ReplayLogger;
  resubscribeOnEnd?: boolean;
}

const DEFAULT_PAGE_SIZE = 512;
const DEFAULT_SAFETY_MARGIN = 64n;
const PAGE_ORDER_ASC = "slot asc";

export function createEventReplay(options: EventReplayOptions): ReplayStream<Event, string> {
  const safetyMargin = options.safetyMargin ?? DEFAULT_SAFETY_MARGIN;

  const fetchBackfill = async ({
    startSlot,
    cursor,
  }: {
    startSlot: Slot;
    cursor?: string;
  }) => {
    const page = new PageRequest({
      pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
      orderBy: PAGE_ORDER_ASC,
      pageToken: cursor,
    });

    const baseFilter = slotLiteralFilter("event.slot", startSlot);
    const mergedFilter = combineFilters(baseFilter, options.filter);
    const response = await options.client.listEvents(
      new ListEventsRequest({
        filter: mergedFilter,
        page,
      }),
    );

    return backfillPage(response.events, response.page);
  };

  const subscribeLive = (startSlot: Slot): AsyncIterable<Event> => {
    const mergedFilter = combineFilters(slotLiteralFilter("event.slot", startSlot), options.filter);
    const request = new StreamEventsRequest({
      filter: mergedFilter,
    });
    return mapAsyncIterable(
      options.client.streamEvents(request),
      (resp: StreamEventsResponse) => streamResponseToEvent(resp),
    );
  };

  return new ReplayStream<Event, string>({
    startSlot: options.startSlot,
    safetyMargin,
    fetchBackfill,
    subscribeLive,
    extractSlot: (event) => event.slot ?? 0n,
    extractKey: eventKey,
    logger: options.logger,
    resubscribeOnEnd: options.resubscribeOnEnd,
  });
}

function streamResponseToEvent(resp: StreamEventsResponse): Event {
  return new Event({
    eventId: resp.eventId,
    transactionSignature: resp.signature,
    program: resp.program,
    payload: resp.payload,
    slot: resp.slot,
    callIdx: resp.callIdx,
    timestamp: resp.timestamp,
  });
}

function eventKey(event: Event): string {
  if (event.eventId) return event.eventId;
  const slotPart = event.slot?.toString() ?? "0";
  return `${slotPart}:${event.callIdx ?? 0}`;
}
