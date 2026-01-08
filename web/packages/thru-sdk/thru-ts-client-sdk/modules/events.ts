import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { DEFAULT_MIN_CONSENSUS, DEFAULT_VERSION_CONTEXT } from "../defaults";
import { ChainEvent } from "../domain/events";
import { Filter } from "../domain/filters";
import { PageRequest, PageResponse } from "../domain/pagination";
import {
    type ConsensusStatus,
    type VersionContext,
    GetEventRequestSchema,
    ListEventsRequestSchema,
    type ListEventsResponse as ProtoListEventsResponse,
    Event as QueryEvent,
} from "@thru/proto";

export interface GetEventOptions {
    versionContext?: VersionContext;
}

export interface ListEventsOptions {
    filter?: Filter;
    page?: PageRequest;
    versionContext?: VersionContext;
    minConsensus?: ConsensusStatus;
}

export interface EventList {
    events: ChainEvent[];
    page?: PageResponse;
}

export function getEvent(ctx: ThruClientContext, eventId: string, options: GetEventOptions = {}): Promise<ChainEvent> {
    if (!eventId) {
        throw new Error("eventId is required");
    }
    const request = create(GetEventRequestSchema, {
        eventId,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
    });
    return ctx.query.getEvent(request, withCallOptions(ctx)).then((proto: QueryEvent) => ChainEvent.fromQuery(proto));
}

export function listEvents(
    ctx: ThruClientContext,
    options: ListEventsOptions = {},
): Promise<EventList> {
    const request = create(ListEventsRequestSchema, {
        filter: options.filter?.toProto(),
        page: options.page?.toProto(),
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.listEvents(request, withCallOptions(ctx)).then((response: ProtoListEventsResponse) => ({
        events: response.events.map((proto) => ChainEvent.fromQuery(proto)),
        page: PageResponse.fromProto(response.page),
    }));
}
