import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { StateProofRequestSchema } from "../proto/thru/core/v1/state_pb";
import { GenerateStateProofRequestSchema, GenerateStateProofResponse } from "../proto/thru/services/v1/query_service_pb";
import { GenerateStateProofOptions } from "../types/types";
import { toPubkey } from "./helpers";

export function generateStateProof(
    ctx: ThruClientContext,
    options: GenerateStateProofOptions,
): Promise<GenerateStateProofResponse> {
    const request = create(StateProofRequestSchema, {
        address: options.address ? toPubkey(options.address, "address") : undefined,
        proofType: options.proofType,
        targetSlot: options.targetSlot,
    });
    const schemaRequest = create(GenerateStateProofRequestSchema, { request });
    return ctx.query.generateStateProof(schemaRequest);
}
