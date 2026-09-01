import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { DEFAULT_ACCOUNT_VIEW, DEFAULT_BLOCK_VIEW, DEFAULT_MIN_CONSENSUS } from "../defaults";
import { toStreamAccountUpdate, type StreamAccountUpdate } from "../domain/accounts";
import { Block } from "../domain/blocks";
import { ChainEvent } from "../domain/events";
import { Filter, FilterParamValue } from "../domain/filters";
import { HeightSnapshot } from "../domain/height";
import { Pubkey, Signature, type PubkeyInput, type SignatureInput } from "../domain/primitives";
import type { StreamTransactionUpdate, TrackTransactionUpdate } from "../domain/transactions";
import { toStreamTransactionUpdate, toTrackTransactionUpdate } from "../domain/transactions";
import {
    ConsensusStatus,
    type AccountView,
    type BlockView,
    type NodeRecord,
    StreamAccountUpdatesRequestSchema,
    StreamBlocksRequestSchema,
    StreamEventsRequestSchema,
    StreamHeightRequestSchema,
    StreamNodeRecordsRequestSchema,
    StreamSlotMetricsRequestSchema,
    type StreamSlotMetricsResponse,
    StreamTransactionsRequestSchema,
    TrackTransactionRequestSchema,
} from "@thru/sdk/proto";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

export type { StreamTransactionUpdate, TrackTransactionUpdate } from "../domain/transactions";

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

    const iterable = ctx.streaming.streamBlocks(request, withCallOptions(ctx, { signal: options.signal }));

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
    address: PubkeyInput,
    options: StreamAccountUpdatesOptions = {},
): AsyncIterable<StreamAccountUpdatesResult> {
    // Build address filter - StreamAccountUpdatesRequest now uses filter-based approach
    const addressBytes = Pubkey.from(address).toBytes();
    const addressFilter = new Filter({
        expression: "account_address.value == params.address",
        params: {
            address: FilterParamValue.bytes(addressBytes),
        },
    });

    // Merge with user-provided filter if any
    let mergedFilter = addressFilter;
    if (options.filter) {
        // Combine expressions and params
        const combinedParams: { [key: string]: FilterParamValue } = {};
        for (const [key, value] of addressFilter.entries()) {
            combinedParams[key] = value;
        }
        for (const [key, value] of options.filter.entries()) {
            combinedParams[key] = value;
        }
        mergedFilter = new Filter({
            expression: `(${addressFilter.expression}) && (${options.filter.expression})`,
            params: combinedParams,
        });
    }

    const request = create(StreamAccountUpdatesRequestSchema, {
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        filter: mergedFilter.toProto(),
    });

    const iterable = ctx.streaming.streamAccountUpdates(request, withCallOptions(ctx, { signal: options.signal }));

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

export type StreamTransactionsResult = StreamTransactionUpdate;

export function streamTransactions(
    ctx: ThruClientContext,
    options: StreamTransactionsOptions = {},
): AsyncIterable<StreamTransactionsResult> {
    const request = create(StreamTransactionsRequestSchema, {
        filter: options.filter?.toProto(),
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });

    const iterable = ctx.streaming.streamTransactions(request, withCallOptions(ctx, { signal: options.signal }));

    async function* mapper(): AsyncGenerator<StreamTransactionsResult> {
        for await (const response of iterable) {
            if (!response.transaction) {
                continue;
            }
            try {
                yield toStreamTransactionUpdate(response.transaction);
            } catch (err) {
                console.error("streamTransactions: failed to decode transaction update", err);
            }
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

    const iterable = ctx.streaming.streamEvents(request, withCallOptions(ctx, { signal: options.signal }));

    async function* mapper() {
        for await (const response of iterable) {
            yield { event: ChainEvent.fromStream(response) };
        }
    }

    return mapper();
}

export function trackTransaction(
    ctx: ThruClientContext,
    signature: SignatureInput,
    options: TrackTransactionOptions = {},
): AsyncIterable<TrackTransactionUpdate> {
    const timeoutMs = options.timeoutMs;
    const request = create(TrackTransactionRequestSchema, {
        signature: Signature.from(signature).toProtoSignature(),
        timeout:
            timeoutMs != null
                ? {
                    seconds: BigInt(Math.floor(timeoutMs / 1000)),
                    nanos: (timeoutMs % 1000) * 1_000_000,
                }
                : undefined,
    });

    const iterable = ctx.streaming.trackTransaction(request, withCallOptions(ctx, { signal: options.signal }));

    async function* mapper() {
        for await (const response of iterable) {
            yield toTrackTransactionUpdate(response);
        }
    }

    return mapper();
}

export interface StreamHeightOptions {
    signal?: AbortSignal;
}

export interface StreamHeightResult {
    height: HeightSnapshot;
}

export function streamHeight(
    ctx: ThruClientContext,
    options: StreamHeightOptions = {},
): AsyncIterable<StreamHeightResult> {
    const request = create(StreamHeightRequestSchema, {});

    const iterable = ctx.streaming.streamHeight(request, withCallOptions(ctx, { signal: options.signal }));

    async function* mapper() {
        for await (const response of iterable) {
            yield { height: HeightSnapshot.fromProto(response) };
        }
    }

    return mapper();
}

export interface StreamSlotMetricsOptions {
    startSlot?: bigint;
    signal?: AbortSignal;
    /**
     * Ask the server for the slot's compressed-state trie root.
     *
     * Off by default: the commitment costs bandwidth on every slot and most
     * consumers never read it.
     */
    includeCompressedStateRoot?: boolean;
    /**
     * Ask the server for the slot's active-state hash. Off by default, same
     * reasoning as {@link StreamSlotMetricsOptions.includeCompressedStateRoot}.
     */
    includeActiveStateHash?: boolean;
}

export interface StreamSlotMetricsResult {
    slot: bigint;
    collectedFees: bigint;
    globalActivatedStateCounter: bigint;
    globalDeactivatedStateCounter: bigint;
    blockTimestamp?: Timestamp;
    /**
     * Total compute units consumed by this block.
     *
     * Zero for an empty block, and also zero when the node could not attribute
     * this slot's execution results to it. The wire cannot distinguish the two
     * cases, so do not read zero as "the block did no work".
     */
    consumedComputeUnits: bigint;
    /**
     * Total state units consumed by this block.
     *
     * Same zero caveat as {@link StreamSlotMetricsResult.consumedComputeUnits}.
     */
    consumedStateUnits: number;
    /**
     * The compressed-state trie root as of this slot: the commitment account
     * state proofs are verified against.
     *
     * The server sends exactly 32 bytes. This is a pass-through of whatever
     * arrived -- unlike the Rust client, the SDK does not reject a
     * wrong-length value -- so a consumer doing byte comparisons should check
     * the length rather than assume it.
     *
     * Undefined unless requested, and undefined even then when: the node
     * reported no execution state for the slot; the server predates the field;
     * the node behind a supporting server predates the wire flag that marks a
     * terminator as post-execution; or that terminator was truncated. Those
     * cases are not distinguishable from one another on the wire.
     *
     * An all-zero VALUE is legitimate and means something different from
     * undefined: the trie is empty until compression warms up, and a slot that
     * compressed nothing repeats the previous root.
     */
    compressedStateRoot?: Uint8Array;
    /**
     * The active-state hash as of this slot: 32 bytes over the live account set
     * and this slot's block context. Same presence rules as
     * {@link StreamSlotMetricsResult.compressedStateRoot}.
     *
     * Because that block context contains the compressed-state root, this hash
     * transitively commits to it -- the two fields agreeing is not an
     * independent check of either.
     */
    activeStateHash?: Uint8Array;
}

/* Compile-time guard: every property the generated StreamSlotMetricsResponse
   carries must be surfaced by StreamSlotMetricsResult. Adding a proto field
   without widening the result type stops this file compiling, and the error
   names the missing key. This asserts over generated object keys, not protobuf
   wire fields — the two coincide only because this message has no oneof. */
type _UnmappedSlotMetricsKeys = Exclude<
    Exclude<keyof StreamSlotMetricsResponse, "$typeName" | "$unknown">,
    keyof StreamSlotMetricsResult
>;
type _AssertNever<T extends never> = T;
type _StreamSlotMetricsCoverage = _AssertNever<_UnmappedSlotMetricsKeys>;

export function streamSlotMetrics(
    ctx: ThruClientContext,
    options: StreamSlotMetricsOptions = {},
): AsyncIterable<StreamSlotMetricsResult> {
    const request = create(StreamSlotMetricsRequestSchema, {
        startSlot: options.startSlot,
        includeCompressedStateRoot: options.includeCompressedStateRoot ?? false,
        includeActiveStateHash: options.includeActiveStateHash ?? false,
    });

    const iterable = ctx.streaming.streamSlotMetrics(request, withCallOptions(ctx, { signal: options.signal }));

    async function* mapper() {
        for await (const response of iterable) {
            /* One assignment per proto field, including the ones that may be
               undefined: the key must always be present so the schema-coverage
               test can see it. */
            yield {
                slot: response.slot,
                collectedFees: response.collectedFees,
                globalActivatedStateCounter: response.globalActivatedStateCounter,
                globalDeactivatedStateCounter: response.globalDeactivatedStateCounter,
                blockTimestamp: response.blockTimestamp,
                consumedComputeUnits: response.consumedComputeUnits,
                consumedStateUnits: response.consumedStateUnits,
                compressedStateRoot: response.compressedStateRoot,
                activeStateHash: response.activeStateHash,
            };
        }
    }

    return mapper();
}

export type StreamNodeRecordsResult =
    | { type: "record"; record: NodeRecord }
    | { type: "finished" };

export interface StreamNodeRecordsOptions {
    signal?: AbortSignal;
}

export function streamNodeRecords(
    ctx: ThruClientContext,
    options: StreamNodeRecordsOptions = {},
): AsyncIterable<StreamNodeRecordsResult> {
    const request = create(StreamNodeRecordsRequestSchema, {});

    const iterable = ctx.streaming.streamNodeRecords(request, withCallOptions(ctx, { signal: options.signal }));

    async function* mapper(): AsyncGenerator<StreamNodeRecordsResult> {
        for await (const response of iterable) {
            if (response.message.case === "record") {
                yield { type: "record", record: response.message.value };
            } else if (response.message.case === "finished") {
                yield { type: "finished" };
            }
        }
    }

    return mapper();
}

export interface CollectStreamOptions {
    limit?: number;
    signal?: AbortSignal;
}

export async function collectStream<T>(
    iterable: AsyncIterable<T>,
    options: CollectStreamOptions = {},
): Promise<T[]> {
    const { limit, signal } = options;
    throwIfAborted(signal);
    if (limit != null && limit <= 0) {
        return [];
    }
    const results: T[] = [];
    let count = 0;
    for await (const value of iterable) {
        throwIfAborted(signal);
        results.push(value);
        count += 1;
        if (limit != null && count >= limit) {
            break;
        }
    }
    return results;
}

export async function firstStreamValue<T>(
    iterable: AsyncIterable<T>,
    options: { signal?: AbortSignal } = {},
): Promise<T | undefined> {
    const values = await collectStream(iterable, { ...options, limit: 1 });
    return values[0];
}

export async function forEachStreamValue<T>(
    iterable: AsyncIterable<T>,
    handler: (value: T, index: number) => void | Promise<void>,
    options: { signal?: AbortSignal } = {},
): Promise<void> {
    let index = 0;
    for await (const value of iterable) {
        throwIfAborted(options.signal);
        await handler(value, index++);
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal) {
        return;
    }
    if (signal.aborted) {
        const reason = signal.reason;
        if (reason instanceof Error) {
            throw reason;
        }
        if (reason !== undefined) {
            throw new Error(String(reason));
        }
        throw new DOMException("The operation was aborted.", "AbortError");
    }
}
