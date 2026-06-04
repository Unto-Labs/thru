import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import {
    GetNodeStatusRequestSchema,
    type GetNodeStatusResponse,
    GetNodePubkeyRequestSchema,
    type GetNodePubkeyResponse,
    GetNodeRecordsRequestSchema,
    type GetNodeRecordsResponse,
} from "@thru/sdk/proto";

export async function getNodeStatus(
    ctx: ThruClientContext,
): Promise<GetNodeStatusResponse> {
    const request = create(GetNodeStatusRequestSchema, {});
    return ctx.query.getNodeStatus(request, withCallOptions(ctx));
}

export async function getNodePubkey(
    ctx: ThruClientContext,
): Promise<GetNodePubkeyResponse> {
    const request = create(GetNodePubkeyRequestSchema, {});
    return ctx.query.getNodePubkey(request, withCallOptions(ctx));
}

export async function getNodeRecords(
    ctx: ThruClientContext,
): Promise<GetNodeRecordsResponse> {
    const request = create(GetNodeRecordsRequestSchema, {});
    return ctx.query.getNodeRecords(request, withCallOptions(ctx));
}
