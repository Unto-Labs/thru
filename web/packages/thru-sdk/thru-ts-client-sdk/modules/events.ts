import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { DEFAULT_VERSION_CONTEXT } from "../defaults";
import type { VersionContext } from "../proto/thru/common/v1/consensus_pb";
import { ChainEvent } from "../domain/events";
import { GetEventRequestSchema, Event as QueryEvent } from "../proto/thru/services/v1/query_service_pb";

export interface GetEventOptions {
    versionContext?: VersionContext;
}

export function getEvent(ctx: ThruClientContext, eventId: string, options: GetEventOptions = {}): Promise<ChainEvent> {
    if (!eventId) {
        throw new Error("eventId is required");
    }
    const request = create(GetEventRequestSchema, {
        eventId,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
    });
    return ctx.query.getEvent(request).then((proto: QueryEvent) => ChainEvent.fromQuery(proto));
}
