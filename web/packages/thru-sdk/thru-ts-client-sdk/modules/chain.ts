import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { GetChainInfoRequestSchema } from "@thru/proto";

export async function getChainId(ctx: ThruClientContext): Promise<number> {
    const request = create(GetChainInfoRequestSchema);
    const response = await ctx.query.getChainInfo(request, withCallOptions(ctx));
    return response.chainId;
}
