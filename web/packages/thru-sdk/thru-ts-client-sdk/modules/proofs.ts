import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { Pubkey } from "../domain/primitives";
import { StateProof } from "../domain/proofs";
import {
    StateProofRequestSchema,
    GenerateStateProofRequestSchema,
    GenerateStateProofResponse,
} from "@thru/proto";
import { GenerateStateProofOptions } from "../types/types";

export async function generateStateProof(
    ctx: ThruClientContext,
    options: GenerateStateProofOptions,
): Promise<StateProof> {
    // If targetSlot is undefined or 0, let the server auto-select the latest
    // available state root slot. This avoids race conditions where the client
    // requests a slot that hasn't been ingested into ClickHouse yet.
    const targetSlot = options.targetSlot ?? 0n;

    const request = create(StateProofRequestSchema, {
        address: options.address ? Pubkey.from(options.address).toProtoPubkey() : undefined,
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
