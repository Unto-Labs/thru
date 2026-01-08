import type { StateProof as CoreStateProof } from "@thru/proto";

export class StateProof {
    readonly proof: Uint8Array;
    readonly slot: bigint;

    constructor(params: { proof: Uint8Array; slot: bigint }) {
        this.proof = copyBytes(params.proof);
        this.slot = params.slot;
    }

    static fromProto(proto: CoreStateProof): StateProof {
        return new StateProof({
            proof: proto.proof,
            slot: proto.slot ?? 0n,
        });
    }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy;
}

