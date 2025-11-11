import type { BlockFooter as ProtoBlockFooter } from "../../proto/thru/core/v1/block_pb";
import { ExecutionStatus } from "../../proto/thru/core/v1/block_pb";

export interface BlockFooterParams {
    signature?: Uint8Array;
    status: ExecutionStatus;
    consumedComputeUnits: bigint;
    consumedStateUnits: number;
}

export class BlockFooter {
    readonly signature?: Uint8Array;
    readonly status: ExecutionStatus;
    readonly consumedComputeUnits: bigint;
    readonly consumedStateUnits: number;

    constructor(params: BlockFooterParams) {
        this.signature = copyBytes(params.signature);
        this.status = params.status;
        this.consumedComputeUnits = params.consumedComputeUnits;
        this.consumedStateUnits = params.consumedStateUnits;
    }

    static fromProto(proto: ProtoBlockFooter): BlockFooter {
        return new BlockFooter({
            signature: proto.signature?.value,
            status: proto.status ?? ExecutionStatus.UNSPECIFIED,
            consumedComputeUnits: proto.consumedComputeUnits ?? 0n,
            consumedStateUnits: proto.consumedStateUnits ?? 0,
        });
    }
}

function copyBytes(bytes?: Uint8Array): Uint8Array | undefined {
    if (!bytes) return undefined;
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    return out;
}

