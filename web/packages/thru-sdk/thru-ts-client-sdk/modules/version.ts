import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { VersionInfo } from "../domain/version";
import { GetVersionRequestSchema, type GetVersionResponse } from "../proto/thru/services/v1/query_service_pb";

export function getVersion(ctx: ThruClientContext): Promise<VersionInfo> {
    const request = create(GetVersionRequestSchema);
    return ctx.query
        .getVersion(request, withCallOptions(ctx))
        .then((response: GetVersionResponse) => VersionInfo.fromProto(response));
}

