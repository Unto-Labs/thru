import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { GetHeightRequestSchema, GetHeightResponse } from "../proto/thru/services/v1/query_service_pb";

export function getBlockHeight(ctx: ThruClientContext): Promise<GetHeightResponse> {
    const request = create(GetHeightRequestSchema);
    return ctx.query.getHeight(request);
}
