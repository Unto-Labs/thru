import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { GetChainInfoRequestSchema, type GetChainInfoResponse } from "@thru/proto";

export async function getChainInfo(ctx: ThruClientContext): Promise<GetChainInfoResponse> {
    const request = create(GetChainInfoRequestSchema);
    return ctx.query.getChainInfo(request, withCallOptions(ctx));
}

export async function getChainId(ctx: ThruClientContext): Promise<number> {
    const response = await getChainInfo(ctx);
    return response.chainId;
}
