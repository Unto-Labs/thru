import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { StateProof } from "../domain/proofs";
import { StateProofRequestSchema } from "../proto/thru/core/v1/state_pb";
import { GenerateStateProofRequestSchema, GenerateStateProofResponse } from "../proto/thru/services/v1/query_service_pb";
import { GenerateStateProofOptions } from "../types/types";
import { getBlockHeight } from "./height";
import { toPubkey } from "./helpers";

export async function generateStateProof(
    ctx: ThruClientContext,
    options: GenerateStateProofOptions,
): Promise<StateProof> {
    let targetSlot = options.targetSlot;
    if (targetSlot === undefined) {
        const height = await getBlockHeight(ctx);
        targetSlot = height.finalized;
    }

    const request = create(StateProofRequestSchema, {
        address: options.address ? toPubkey(options.address, "address") : undefined,
        proofType: options.proofType,
        targetSlot,
    });
    const schemaRequest = create(GenerateStateProofRequestSchema, { request });
    const response: GenerateStateProofResponse = await ctx.query.generateStateProof(
        schemaRequest,
        withCallOptions(ctx),
    );
    if (!response.proof) {
        throw new Error("State proof response missing proof");
    }
    return StateProof.fromProto(response.proof);
}
