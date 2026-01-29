import { create } from "@bufbuild/protobuf";
import {
  type Filter,
  type PageRequest,
  PageRequestSchema,
  type Event,
  EventSchema,
  type ListEventsRequest,
  ListEventsRequestSchema,
  type StreamEventsRequest,
  StreamEventsRequestSchema,
  type StreamEventsResponse,
} from "@thru/proto";
import type { EventSource } from "../chain-client";
import { ReplayStream } from "../replay-stream";
import type { ReplayLogger, Slot } from "../types";
import { resolveClient } from "../types";
import { backfillPage, combineFilters, mapAsyncIterable, slotLiteralFilter } from "./helpers";

export interface EventReplayOptions {
  /** Client instance for initial connection. Optional if clientFactory provided. */
  client?: EventSource;
  /** Factory to create fresh clients on reconnection. Enables robust reconnection. */
  clientFactory?: () => EventSource;
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

  // Resolve initial client - either from options or from factory
  let currentClient = resolveClient(options, "EventReplayOptions");

  const createFetchBackfill = (client: EventSource) => async ({
    startSlot,
    cursor,
  }: {
    startSlot: Slot;
    cursor?: string;
  }) => {
    const page = create(PageRequestSchema, {
      pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
      orderBy: PAGE_ORDER_ASC,
      pageToken: cursor,
    });

    const baseFilter = slotLiteralFilter("event.slot", startSlot);
    const mergedFilter = combineFilters(baseFilter, options.filter);
    const response = await client.listEvents(
      create(ListEventsRequestSchema, {
        filter: mergedFilter,
        page,
      }),
    );

    return backfillPage(response.events, response.page);
  };

  const createSubscribeLive = (client: EventSource) => (startSlot: Slot): AsyncIterable<Event> => {
    const mergedFilter = combineFilters(slotLiteralFilter("event.slot", startSlot), options.filter);
    const request = create(StreamEventsRequestSchema, {
      filter: mergedFilter,
    });
    return mapAsyncIterable(
      client.streamEvents(request),
      (resp: StreamEventsResponse) => streamResponseToEvent(resp),
    );
  };

  // Reconnection handler - creates fresh client and returns new data source functions
  const onReconnect = options.clientFactory
    ? () => {
        currentClient = options.clientFactory!();
        return {
          subscribeLive: createSubscribeLive(currentClient),
          fetchBackfill: createFetchBackfill(currentClient),
        };
      }
    : undefined;

  return new ReplayStream<Event, string>({
    startSlot: options.startSlot,
    safetyMargin,
    fetchBackfill: createFetchBackfill(currentClient),
    subscribeLive: createSubscribeLive(currentClient),
    extractSlot: (event) => event.slot ?? 0n,
    extractKey: eventKey,
    logger: options.logger,
    resubscribeOnEnd: options.resubscribeOnEnd,
    onReconnect,
  });
}

function streamResponseToEvent(resp: StreamEventsResponse): Event {
  return create(EventSchema, {
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
