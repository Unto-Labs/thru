import { create } from "@bufbuild/protobuf";
import {
  type Filter,
  type PageRequest,
  PageRequestSchema,
  type ConsensusStatus,
  type Block,
  type BlockView,
  type ListBlocksRequest,
  ListBlocksRequestSchema,
  type StreamBlocksRequest,
  StreamBlocksRequestSchema,
  type StreamBlocksResponse,
} from "@thru/proto";
import type { BlockSource } from "../chain-client";
import { ReplayStream } from "../replay-stream";
import { NOOP_LOGGER } from "../logger";
import type { ReplayLogger, Slot } from "../types";
import { backfillPage, combineFilters, mapAsyncIterable, slotLiteralFilter } from "./helpers";

export interface BlockReplayOptions {
  client: BlockSource;
  startSlot: Slot;
  safetyMargin?: bigint;
  pageSize?: number;
  filter?: Filter;
  view?: BlockView;
  minConsensus?: ConsensusStatus;
  logger?: ReplayLogger;
  resubscribeOnEnd?: boolean;
}

const DEFAULT_PAGE_SIZE = 128;
const DEFAULT_SAFETY_MARGIN = 32n;
const PAGE_ORDER_ASC = "slot asc";

export function createBlockReplay(options: BlockReplayOptions): ReplayStream<Block, string> {
  const safetyMargin = options.safetyMargin ?? DEFAULT_SAFETY_MARGIN;
  const logger = options.logger ?? NOOP_LOGGER;

  const fetchBackfill = async ({
    startSlot,
    cursor,
  }: {
    startSlot: Slot;
    cursor?: string;
  }) => {
    const page = create(PageRequestSchema, {
      pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
      orderBy: PAGE_ORDER_ASC,
      pageToken: cursor,
    });

    const mergedFilter = combineFilters(slotLiteralFilter("block.header.slot", startSlot), options.filter);
    logger.debug?.("block backfill request", {
      startSlot: startSlot.toString(),
      cursor,
      pageSize: page.pageSize,
    });

    let response;
    try {
      response = await options.client.listBlocks(
        create(ListBlocksRequestSchema, {
          filter: mergedFilter,
          page,
          view: options.view,
          minConsensus: options.minConsensus,
        }),
      );
    } catch (err) {
      logger.error("block backfill request failed", {
        startSlot: startSlot.toString(),
        cursor,
        err,
      });
      throw err;
    }

    return backfillPage(response.blocks, response.page);
  };

  const subscribeLive = (startSlot: Slot): AsyncIterable<Block> => {
    const request = create(StreamBlocksRequestSchema, {
      startSlot,
      filter: options.filter,
      view: options.view,
      minConsensus: options.minConsensus,
    });
    return mapAsyncIterable(
      options.client.streamBlocks(request),
      (resp: StreamBlocksResponse) => resp.block,
    );
  };

  return new ReplayStream<Block, string>({
    startSlot: options.startSlot,
    safetyMargin,
    fetchBackfill,
    subscribeLive,
    extractSlot: (block) => block.header?.slot ?? 0n,
    logger: options.logger,
    resubscribeOnEnd: options.resubscribeOnEnd,
  });
}
