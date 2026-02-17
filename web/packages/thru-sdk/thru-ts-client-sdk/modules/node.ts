import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import {
    GetNodePubkeyRequestSchema,
    type GetNodePubkeyResponse,
    GetNodeRecordsRequestSchema,
    type GetNodeRecordsResponse,
} from "@thru/proto";

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
