import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import {
    GetSlotMetricsRequestSchema,
    type GetSlotMetricsResponse,
    ListSlotMetricsRequestSchema,
    type ListSlotMetricsResponse,
} from "@thru/proto";

export interface ListSlotMetricsOptions {
    startSlot: bigint;
    endSlot?: bigint;
    limit?: number;
}

export async function getSlotMetrics(
    ctx: ThruClientContext,
    slot: bigint,
): Promise<GetSlotMetricsResponse> {
    const request = create(GetSlotMetricsRequestSchema, { slot });
    return ctx.query.getSlotMetrics(request, withCallOptions(ctx));
}

export async function listSlotMetrics(
    ctx: ThruClientContext,
    options: ListSlotMetricsOptions,
): Promise<ListSlotMetricsResponse> {
    const request = create(ListSlotMetricsRequestSchema, {
        startSlot: options.startSlot,
        endSlot: options.endSlot,
        limit: options.limit,
    });
    return ctx.query.listSlotMetrics(request, withCallOptions(ctx));
}
