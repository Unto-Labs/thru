import type { BlockFooter as ProtoBlockFooter } from "@thru/proto";
import { ExecutionStatus } from "@thru/proto";

export interface BlockFooterParams {
    signature?: Uint8Array;
    status: ExecutionStatus;
    consumedComputeUnits: bigint;
    consumedStateUnits: number;
    attestorPayment: bigint;
}

export class BlockFooter {
    readonly signature?: Uint8Array;
    readonly status: ExecutionStatus;
    readonly consumedComputeUnits: bigint;
    readonly consumedStateUnits: number;
    readonly attestorPayment: bigint;

    constructor(params: BlockFooterParams) {
        this.signature = copyBytes(params.signature);
        this.status = params.status;
        this.consumedComputeUnits = params.consumedComputeUnits;
        this.consumedStateUnits = params.consumedStateUnits;
        this.attestorPayment = params.attestorPayment;
    }

    static fromProto(proto: ProtoBlockFooter): BlockFooter {
        return new BlockFooter({
            signature: proto.signature?.value,
            status: proto.status ?? ExecutionStatus.UNSPECIFIED,
            consumedComputeUnits: proto.consumedComputeUnits ?? 0n,
            consumedStateUnits: proto.consumedStateUnits ?? 0,
            attestorPayment: proto.attestorPayment ?? 0n,
        });
    }
}

function copyBytes(bytes?: Uint8Array): Uint8Array | undefined {
    if (!bytes) return undefined;
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    return out;
}
