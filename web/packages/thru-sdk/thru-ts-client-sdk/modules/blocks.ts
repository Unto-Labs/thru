import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { DEFAULT_BLOCK_VIEW, DEFAULT_MIN_CONSENSUS } from "../defaults";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";
import type { Filter } from "../proto/thru/common/v1/filters_pb";
import type { PageRequest } from "../proto/thru/common/v1/pagination_pb";
import { Block, BlockView, RawBlock } from "../proto/thru/core/v1/block_pb";
import {
    GetBlockRequestSchema,
    GetRawBlockRequestSchema,
    ListBlocksRequestSchema,
    ListBlocksResponse,
} from "../proto/thru/services/v1/query_service_pb";
import { isSlotSelector } from "../utils/utils";
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

export function getBlock(
    ctx: ThruClientContext,
    selector: BlockSelector,
    options: BlockQueryOptions = {},
): Promise<Block> {
    const request = create(GetBlockRequestSchema, {
        selector: isSlotSelector(selector)
            ? { case: "slot", value: typeof selector.slot === "bigint" ? selector.slot : BigInt(selector.slot) }
            : { case: "blockHash", value: toBlockHash(selector.blockHash) },
        view: options.view ?? DEFAULT_BLOCK_VIEW,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getBlock(request);
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

export function listBlocks(
    ctx: ThruClientContext,
    options: ListBlocksOptions = {},
): Promise<ListBlocksResponse> {
    const request = create(ListBlocksRequestSchema, {
        filter: options.filter,
        page: options.page,
        view: options.view ?? DEFAULT_BLOCK_VIEW,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.listBlocks(request);
}
