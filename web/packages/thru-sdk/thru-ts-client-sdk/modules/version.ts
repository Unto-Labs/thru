import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { GetVersionRequestSchema, type GetVersionResponse } from "../proto/thru/services/v1/query_service_pb";

export function getVersion(ctx: ThruClientContext): Promise<GetVersionResponse> {
    const request = create(GetVersionRequestSchema, {});
    return ctx.query.getVersion(request);
}

