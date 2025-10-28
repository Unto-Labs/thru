import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import type { VersionContext } from "../proto/thru/common/v1/consensus_pb";
import { Event, GetEventRequestSchema } from "../proto/thru/services/v1/query_service_pb";

export interface GetEventOptions {
    versionContext?: VersionContext;
}

export function getEvent(ctx: ThruClientContext, eventId: string, options: GetEventOptions = {}): Promise<Event> {
    if (!eventId) {
        throw new Error("eventId is required");
    }
    const request = create(GetEventRequestSchema, {
        eventId,
        versionContext: options.versionContext,
    });
    return ctx.query.getEvent(request);
}
