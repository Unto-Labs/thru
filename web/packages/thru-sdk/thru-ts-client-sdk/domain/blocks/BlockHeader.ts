import type { Timestamp } from "@bufbuild/protobuf/wkt";

import type { BlockHeader as ProtoBlockHeader } from "../../proto/thru/core/v1/block_pb";

export interface BlockHeaderParams {
    slot: bigint;
    version: number;
    headerSignature?: Uint8Array;
    producer?: Uint8Array;
    expiryTimestamp?: Timestamp;
    startSlot: bigint;
    expiryAfter?: number;
    maxBlockSize?: number;
    maxComputeUnits?: bigint;
    maxStateUnits?: number;
    price?: bigint;
    blockHash?: Uint8Array;
}

export class BlockHeader {
    readonly slot: bigint;
    readonly version: number;
    readonly headerSignature?: Uint8Array;
    readonly producer?: Uint8Array;
    readonly expiryTimestamp?: Timestamp;
    readonly startSlot: bigint;
    readonly expiryAfter?: number;
    readonly maxBlockSize?: number;
    readonly maxComputeUnits?: bigint;
    readonly maxStateUnits?: number;
    readonly price?: bigint;
    readonly blockHash?: Uint8Array;

    constructor(params: BlockHeaderParams) {
        this.slot = params.slot;
        this.version = params.version;
        this.headerSignature = copyBytes(params.headerSignature);
        this.producer = copyBytes(params.producer);
        this.expiryTimestamp = params.expiryTimestamp;
        this.startSlot = params.startSlot;
        this.expiryAfter = params.expiryAfter;
        this.maxBlockSize = params.maxBlockSize;
        this.maxComputeUnits = params.maxComputeUnits;
        this.maxStateUnits = params.maxStateUnits;
        this.price = params.price;
        this.blockHash = copyBytes(params.blockHash);
    }

    static fromProto(proto: ProtoBlockHeader): BlockHeader {
        return new BlockHeader({
            slot: proto.slot ?? 0n,
            version: proto.version ?? 0,
            headerSignature: proto.headerSignature?.value,
            producer: proto.producer?.value,
            expiryTimestamp: proto.expiryTimestamp,
            startSlot: proto.startSlot ?? 0n,
            expiryAfter: proto.expiryAfter,
            maxBlockSize: proto.maxBlockSize,
            maxComputeUnits: proto.maxComputeUnits,
            maxStateUnits: proto.maxStateUnits,
            price: proto.price,
            blockHash: proto.blockHash?.value,
        });
    }

    withBlockHash(blockHash: Uint8Array): BlockHeader {
        return new BlockHeader({
            slot: this.slot,
            version: this.version,
            headerSignature: this.headerSignature,
            producer: this.producer,
            expiryTimestamp: this.expiryTimestamp,
            startSlot: this.startSlot,
            expiryAfter: this.expiryAfter,
            maxBlockSize: this.maxBlockSize,
            maxComputeUnits: this.maxComputeUnits,
            maxStateUnits: this.maxStateUnits,
            price: this.price,
            blockHash,
        });
    }
}

function copyBytes(bytes?: Uint8Array): Uint8Array | undefined {
    if (!bytes) return undefined;
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    return out;
}

