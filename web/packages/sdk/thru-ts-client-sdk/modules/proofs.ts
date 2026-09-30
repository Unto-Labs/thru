import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { Pubkey } from "../domain/primitives";
import { StateProof } from "../domain/proofs";
import {
    StateProofRequestSchema,
    GenerateStateProofRequestSchema,
    GenerateStateProofResponse,
    GetStateRootsRequestSchema,
    type GetStateRootsResponse,
    BatchGenerateStateProofsRequestSchema,
} from "@thru/sdk/proto";
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

export interface GenerateStateProofsOptions {
    requests: readonly Omit<GenerateStateProofOptions, "targetSlot">[];
    targetSlot?: bigint;
    signal?: AbortSignal;
}

export type StateProofOutcome = { proof: StateProof; error?: never } | { proof?: never; error: ConnectError };

/** Positional results, including duplicates and per-account errors; chunks at the RPC's 1000-request limit. */
export async function generateStateProofs(
    ctx: ThruClientContext,
    options: GenerateStateProofsOptions,
): Promise<StateProofOutcome[]> {
    const results: StateProofOutcome[] = [];
    let targetSlot = options.targetSlot ?? 0n;
    for (let offset = 0; offset < options.requests.length; offset += 1000) {
        const requests = options.requests.slice(offset, offset + 1000).map(request => create(StateProofRequestSchema, {
            address: request.address ? Pubkey.from(request.address).toProtoPubkey() : undefined,
            proofType: request.proofType,
            // The batch endpoint rejects per-request targetSlot, including explicit zero.
        }));
        const response = await ctx.query.batchGenerateStateProofs(
            create(BatchGenerateStateProofsRequestSchema, { requests, targetSlot }),
            { ...withCallOptions(ctx), ...(options.signal ? { signal: options.signal } : {}) },
        );
        if (response.results.length !== requests.length) throw new Error("Batch state proof response has the wrong result count");
        for (const result of response.results) {
            if (result.proof && !result.errorCode) {
                const proof = StateProof.fromProto(result.proof);
                // Pin later chunks once the server supplies a usable root. If an
                // entire chunk failed, a later chunk may still select its own root.
                if (!targetSlot) targetSlot = proof.slot;
                results.push({ proof });
            } else if (!result.proof && result.errorCode) {
                results.push({ error: new ConnectError(result.errorMessage ?? "State proof unavailable", result.errorCode as Code) });
            } else throw new Error("Batch state proof result must contain either a proof or an error");
        }
    }
    return results;
}

export interface GetStateRootsOptions {
    slot?: bigint;
}

export async function getStateRoots(
    ctx: ThruClientContext,
    options: GetStateRootsOptions = {},
): Promise<GetStateRootsResponse> {
    const request = create(GetStateRootsRequestSchema, {
        slot: options.slot,
    });
    return ctx.query.getStateRoots(request, withCallOptions(ctx));
}
