import { create } from "@bufbuild/protobuf";

import { BytesLike, Pubkey } from "@thru/helpers";
import type { ThruClientContext } from "../core/client";
import { DEFAULT_ACCOUNT_VIEW, DEFAULT_BLOCK_VIEW, DEFAULT_MIN_CONSENSUS } from "../defaults";
import type { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";
import type { Filter } from "../proto/thru/common/v1/filters_pb";
import type { AccountView } from "../proto/thru/core/v1/account_pb";
import type { BlockView } from "../proto/thru/core/v1/block_pb";
import {
    StreamAccountUpdatesRequestSchema,
    type StreamAccountUpdatesResponse,
    StreamBlocksRequestSchema,
    type StreamBlocksResponse,
    StreamEventsRequestSchema,
    type StreamEventsResponse,
    StreamTransactionsRequestSchema,
    type StreamTransactionsResponse,
    TrackTransactionRequestSchema,
    type TrackTransactionResponse,
} from "../proto/thru/services/v1/streaming_service_pb";
import { toPubkey, toSignature as toSignatureMessage } from "./helpers";

export interface TrackTransactionOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface StreamBlocksOptions {
    startSlot?: bigint;
    filter?: Filter;
    view?: BlockView;
    minConsensus?: ConsensusStatus;
    signal?: AbortSignal;
}

export function streamBlocks(
    ctx: ThruClientContext,
    options: StreamBlocksOptions = {},
): AsyncIterable<StreamBlocksResponse> {
    const request = create(StreamBlocksRequestSchema, {
        startSlot: options.startSlot,
        filter: options.filter,
        view: options.view ?? DEFAULT_BLOCK_VIEW,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });

    return ctx.streaming.streamBlocks(request, {
        signal: options.signal,
    });
}

export interface StreamAccountUpdatesOptions {
    view?: AccountView;
    filter?: Filter;
    signal?: AbortSignal;
}

export function streamAccountUpdates(
    ctx: ThruClientContext,
    address: Pubkey,
    options: StreamAccountUpdatesOptions = {},
): AsyncIterable<StreamAccountUpdatesResponse> {
    const request = create(StreamAccountUpdatesRequestSchema, {
        address: toPubkey(address, "address"),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        filter: options.filter,
    });

    return ctx.streaming.streamAccountUpdates(request, {
        signal: options.signal,
    });
}

export interface StreamTransactionsOptions {
    filter?: Filter;
    minConsensus?: ConsensusStatus;
    signal?: AbortSignal;
}

export function streamTransactions(
    ctx: ThruClientContext,
    options: StreamTransactionsOptions = {},
): AsyncIterable<StreamTransactionsResponse> {
    const request = create(StreamTransactionsRequestSchema, {
        filter: options.filter,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });

    return ctx.streaming.streamTransactions(request, {
        signal: options.signal,
    });
}

export interface StreamEventsOptions {
    filter?: Filter;
    signal?: AbortSignal;
}

export function streamEvents(
    ctx: ThruClientContext,
    options: StreamEventsOptions = {},
): AsyncIterable<StreamEventsResponse> {
    const request = create(StreamEventsRequestSchema, {
        filter: options.filter,
    });

    return ctx.streaming.streamEvents(request, {
        signal: options.signal,
    });
}

export function trackTransaction(
    ctx: ThruClientContext,
    signature: BytesLike,
    options: TrackTransactionOptions = {},
): AsyncIterable<TrackTransactionResponse> {
    const timeoutMs = options.timeoutMs;
    const request = create(TrackTransactionRequestSchema, {
        signature: toSignatureMessage(signature),
        timeout:
            timeoutMs != null
                ? {
                    seconds: BigInt(Math.floor(timeoutMs / 1000)),
                    nanos: (timeoutMs % 1000) * 1_000_000,
                }
                : undefined,
    });

    return ctx.streaming.trackTransaction(request, {
        signal: options.signal,
    });
}
