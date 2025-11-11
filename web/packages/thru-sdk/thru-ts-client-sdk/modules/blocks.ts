import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { DEFAULT_BLOCK_VIEW, DEFAULT_MIN_CONSENSUS } from "../defaults";
import { Block } from "../domain/blocks";
import { Filter } from "../domain/filters";
import { PageRequest, PageResponse } from "../domain/pagination";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";
import { BlockView, RawBlock } from "../proto/thru/core/v1/block_pb";
import {
    GetBlockRequestSchema,
    GetRawBlockRequestSchema,
    ListBlocksRequestSchema,
    ListBlocksResponse as ProtoListBlocksResponse,
} from "../proto/thru/services/v1/query_service_pb";
import { isSlotSelector } from "../utils/utils";
import { BLOCK_HEADER_SIZE } from "../wire-format";
import type { BlockSelector } from "./helpers";
import { toBlockHash } from "./helpers";

export interface BlockQueryOptions {
    view?: BlockView;
    minConsensus?: ConsensusStatus;
}

export interface RawBlockQueryOptions {
    minConsensus?: ConsensusStatus;
}

export interface ListBlocksOptions {
    filter?: Filter;
    page?: PageRequest;
    view?: BlockView;
    minConsensus?: ConsensusStatus;
}

export interface BlockList {
    blocks: Block[];
    page?: PageResponse;
}

export async function getBlock(
    ctx: ThruClientContext,
    selector: BlockSelector,
    options: BlockQueryOptions = {},
): Promise<Block> {
    // Get proto block
    const request = create(GetBlockRequestSchema, {
        selector: isSlotSelector(selector)
            ? { case: "slot", value: typeof selector.slot === "bigint" ? selector.slot : BigInt(selector.slot) }
            : { case: "blockHash", value: toBlockHash(selector.blockHash) },
        view: options.view ?? DEFAULT_BLOCK_VIEW,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    const proto = await ctx.query.getBlock(request);
    const protoBlock = Block.fromProto(proto);

    // Try to enrich with raw block metadata (block time, attestor payment) when available.
    try {
        const rawBlock = await getRawBlock(ctx, selector);
        const rawBytes = rawBlock?.rawBlock;
        if (rawBytes && rawBytes.length >= BLOCK_HEADER_SIZE) {
            const rawBlockParsed = Block.fromWire(rawBytes);
            if (rawBlockParsed.blockTimeNs !== undefined) {
                protoBlock.blockTimeNs = rawBlockParsed.blockTimeNs;
            }
            if (rawBlockParsed.attestorPayment !== undefined) {
                protoBlock.attestorPayment = rawBlockParsed.attestorPayment;
            }
        }
    } catch (error) {
        console.debug("blocks.getBlock: failed to enrich with raw block", error);   
    }

    return protoBlock;
}

export function getRawBlock(
    ctx: ThruClientContext,
    selector: BlockSelector,
    options: RawBlockQueryOptions = {},
): Promise<RawBlock> {
    const request = create(GetRawBlockRequestSchema, {
        selector: isSlotSelector(selector)
            ? { case: "slot", value: typeof selector.slot === "bigint" ? selector.slot : BigInt(selector.slot) }
            : { case: "blockHash", value: toBlockHash(selector.blockHash) },
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getRawBlock(request);
}

export async function listBlocks(
    ctx: ThruClientContext,
    options: ListBlocksOptions = {},
): Promise<BlockList> {
    const request = create(ListBlocksRequestSchema, {
        filter: options.filter?.toProto(),
        page: options.page?.toProto(),
        view: options.view ?? DEFAULT_BLOCK_VIEW,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    const response: ProtoListBlocksResponse = await ctx.query.listBlocks(request);
    return {
        blocks: response.blocks.map((proto) => Block.fromProto(proto)),
        page: PageResponse.fromProto(response.page),
    };
}
