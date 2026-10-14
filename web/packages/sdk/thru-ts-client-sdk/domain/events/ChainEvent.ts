import type { Event as QueryEvent } from "@thru/sdk/proto";
import type { StreamEventsResponse } from "@thru/sdk/proto";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampToNanoseconds } from "../../utils/utils";

export interface ChainEventParams {
    id: string;
    transactionSignature?: Uint8Array;
    program?: Uint8Array;
    payload?: Uint8Array;
    slot?: bigint;
    callIndex?: number;
    programIndex?: number;
    payloadSize?: number;
    timestampNs?: bigint;
    blockTimestampNs?: bigint;
    feePayer?: Uint8Array;
    blockOffset?: number;
}

export class ChainEvent {
    readonly id: string;
    readonly transactionSignature?: Uint8Array;
    readonly program?: Uint8Array;
    readonly payload?: Uint8Array;
    readonly slot?: bigint;
    readonly callIndex?: number;
    readonly programIndex?: number;
    readonly payloadSize?: number;
    /** Time the node published the live event; set only by fromStream. */
    readonly timestampNs?: bigint;
    /** Header time of the block holding the event. */
    readonly blockTimestampNs?: bigint;
    readonly feePayer?: Uint8Array;
    readonly blockOffset?: number;

    constructor(params: ChainEventParams) {
        if (!params.id) {
            throw new Error("ChainEvent id is required");
        }
        this.id = params.id;
        this.transactionSignature = copyBytes(params.transactionSignature);
        this.program = copyBytes(params.program);
        this.payload = copyBytes(params.payload);
        this.slot = params.slot;
        this.callIndex = params.callIndex;
        this.programIndex = params.programIndex;
        this.payloadSize = params.payloadSize;
        this.timestampNs = params.timestampNs;
        this.blockTimestampNs = params.blockTimestampNs;
        this.feePayer = copyBytes(params.feePayer);
        this.blockOffset = params.blockOffset;
    }

    static fromQuery(proto: QueryEvent): ChainEvent {
        return new ChainEvent({
            id: proto.eventId,
            transactionSignature: proto.transactionSignature?.value,
            program: proto.program?.value,
            payload: proto.payload,
            slot: proto.slot,
            callIndex: proto.callIdx,
            programIndex: proto.programIdx,
            payloadSize: proto.payloadSize,
            blockTimestampNs: optionalNanoseconds(proto.timestamp),
            feePayer: proto.feePayer?.value,
            blockOffset: proto.blockOffset,
        });
    }

    static fromStream(proto: StreamEventsResponse): ChainEvent {
        return new ChainEvent({
            id: proto.eventId,
            transactionSignature: proto.signature?.value,
            program: proto.program?.value,
            payload: proto.payload,
            slot: proto.slot,
            callIndex: proto.callIdx,
            timestampNs: timestampToNanoseconds(proto.timestamp),
            blockTimestampNs: optionalNanoseconds(proto.blockTimestamp),
            programIndex: proto.programIdx,
            feePayer: proto.feePayer?.value,
            blockOffset: proto.blockOffset,
        });
    }
}

function optionalNanoseconds(timestamp?: Timestamp): bigint | undefined {
    return timestamp ? timestampToNanoseconds(timestamp) : undefined;
}

function copyBytes(input?: Uint8Array): Uint8Array | undefined {
    if (!input) {
        return undefined;
    }
    const copy = new Uint8Array(input.length);
    copy.set(input);
    return copy;
}
