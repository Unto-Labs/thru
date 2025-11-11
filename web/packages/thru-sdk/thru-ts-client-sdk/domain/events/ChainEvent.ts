import type { Event as QueryEvent } from "../../proto/thru/services/v1/query_service_pb";
import type { StreamEventsResponse } from "../../proto/thru/services/v1/streaming_service_pb";
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
    readonly timestampNs?: bigint;

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
        });
    }

    static fromStream(proto: StreamEventsResponse): ChainEvent {
        const id = normalizeStreamEventId(proto.eventId);
        return new ChainEvent({
            id,
            transactionSignature: proto.signature?.value,
            program: proto.program?.value,
            payload: proto.payload,
            slot: proto.slot,
            callIndex: proto.callIdx,
            timestampNs: timestampToNanoseconds(proto.timestamp),
        });
    }
}

function copyBytes(input?: Uint8Array): Uint8Array | undefined {
    if (!input) {
        return undefined;
    }
    const copy = new Uint8Array(input.length);
    copy.set(input);
    return copy;
}

function normalizeStreamEventId(id: string): string {
    const parts = id.split(":" );
    if (parts.length >= 4) {
        return parts.slice(0, 4).join(":" );
    }
    return id;
}
