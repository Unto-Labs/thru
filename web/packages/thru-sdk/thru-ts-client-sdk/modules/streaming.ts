import { create } from "@bufbuild/protobuf";

import { BytesLike, Pubkey } from "@thru/helpers";
import type { ThruClientContext } from "../core/client";
import { DEFAULT_ACCOUNT_VIEW, DEFAULT_BLOCK_VIEW, DEFAULT_MIN_CONSENSUS } from "../defaults";
import { toStreamAccountUpdate, type StreamAccountUpdate } from "../domain/accounts";
import { Block } from "../domain/blocks";
import { ChainEvent } from "../domain/events";
import { Filter } from "../domain/filters";
import type { TrackTransactionUpdate } from "../domain/transactions";
import { Transaction, toTrackTransactionUpdate } from "../domain/transactions";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";
import type { AccountView } from "../proto/thru/core/v1/account_pb";
import type { BlockView } from "../proto/thru/core/v1/block_pb";
import {
    StreamAccountUpdatesRequestSchema,
    StreamBlocksRequestSchema,
    StreamEventsRequestSchema,
    StreamTransactionsRequestSchema,
    TrackTransactionRequestSchema,
} from "../proto/thru/services/v1/streaming_service_pb";
import { toPubkey, toSignature as toSignatureMessage } from "./helpers";

export type { TrackTransactionUpdate } from "../domain/transactions";

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

export interface StreamBlocksResult {
    block: Block;
}

export function streamBlocks(
    ctx: ThruClientContext,
    options: StreamBlocksOptions = {},
): AsyncIterable<StreamBlocksResult> {
    const request = create(StreamBlocksRequestSchema, {
        startSlot: options.startSlot,
        filter: options.filter?.toProto(),
        view: options.view ?? DEFAULT_BLOCK_VIEW,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });

    const iterable = ctx.streaming.streamBlocks(request, {
        signal: options.signal,
    });

    async function* mapper() {
        for await (const response of iterable) {
            if (!response.block) {
                continue;
            }
            yield { block: Block.fromProto(response.block) };
        }
    }

    return mapper();
}

export interface StreamAccountUpdatesOptions {
    view?: AccountView;
    filter?: Filter;
    signal?: AbortSignal;
}

export interface StreamAccountUpdatesResult {
    update: StreamAccountUpdate;
}

export function streamAccountUpdates(
    ctx: ThruClientContext,
    address: Pubkey,
    options: StreamAccountUpdatesOptions = {},
): AsyncIterable<StreamAccountUpdatesResult> {
    const request = create(StreamAccountUpdatesRequestSchema, {
        address: toPubkey(address, "address"),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        filter: options.filter?.toProto(),
    });

    const iterable = ctx.streaming.streamAccountUpdates(request, {
        signal: options.signal,
    });

    async function* mapper() {
        for await (const response of iterable) {
            const update = toStreamAccountUpdate(response);
            if (!update) {
                continue;
            }
            yield { update };
        }
    }

    return mapper();
}

export interface StreamTransactionsOptions {
    filter?: Filter;
    minConsensus?: ConsensusStatus;
    signal?: AbortSignal;
}

export interface StreamTransactionsResult {
    transaction: Transaction;
}

export function streamTransactions(
    ctx: ThruClientContext,
    options: StreamTransactionsOptions = {},
): AsyncIterable<StreamTransactionsResult> {
    const request = create(StreamTransactionsRequestSchema, {
        filter: options.filter?.toProto(),
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });

    const iterable = ctx.streaming.streamTransactions(request, {
        signal: options.signal,
    });

    async function* mapper() {
        for await (const response of iterable) {
            if (!response.transaction) {
                continue;
            }
            yield { transaction: Transaction.fromProto(response.transaction) };
        }
    }

    return mapper();
}

export interface StreamEventsOptions {
    filter?: Filter;
    signal?: AbortSignal;
}

export interface StreamEventsResult {
    event: ChainEvent;
}

export function streamEvents(
    ctx: ThruClientContext,
    options: StreamEventsOptions = {},
): AsyncIterable<StreamEventsResult> {
    const request = create(StreamEventsRequestSchema, {
        filter: options.filter?.toProto(),
    });

    const iterable = ctx.streaming.streamEvents(request, {
        signal: options.signal,
    });

    async function* mapper() {
        for await (const response of iterable) {
            yield { event: ChainEvent.fromStream(response) };
        }
    }

    return mapper();
}

export function trackTransaction(
    ctx: ThruClientContext,
    signature: BytesLike,
    options: TrackTransactionOptions = {},
): AsyncIterable<TrackTransactionUpdate> {
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

    const iterable = ctx.streaming.trackTransaction(request, {
        signal: options.signal,
    });

    async function* mapper() {
        for await (const response of iterable) {
            yield toTrackTransactionUpdate(response);
        }
    }

    return mapper();
}
