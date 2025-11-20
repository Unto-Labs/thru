import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { HeightSnapshot } from "../domain/height";
import { GetHeightRequestSchema, GetHeightResponse } from "../proto/thru/services/v1/query_service_pb";

export function getBlockHeight(ctx: ThruClientContext): Promise<HeightSnapshot> {
    const request = create(GetHeightRequestSchema);
    return ctx.query.getHeight(request, withCallOptions(ctx)).then((proto: GetHeightResponse) => HeightSnapshot.fromProto(proto));
}
