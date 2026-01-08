import type { PartialMessage } from "@bufbuild/protobuf";
import { ListBlocksResponse } from "@thru/proto";
import { StreamBlocksResponse } from "@thru/proto";
import { PageResponse } from "@thru/proto";
import type { Filter } from "@thru/proto";
import type { BlockSource } from "../chain-client";
import { Block, BlockHeader } from "@thru/proto";
import type { ListBlocksRequest } from "@thru/proto";
import type { StreamBlocksRequest } from "@thru/proto";
import type { Slot } from "../types";

export interface SimulatedChainOptions {
  historySlots: Slot[];
  liveSlots: Slot[];
  pageDelayMs?: number;
  streamDelayMs?: number;
  streamErrorAfter?: number;
  streamErrorLimit?: number;
}

interface BlockRecord {
  slot: Slot;
  block: Block;
}

const DEFAULT_PAGE_DELAY = 0;
const DEFAULT_STREAM_DELAY = 0;

export class SimulatedChain implements BlockSource {
  private readonly history: BlockRecord[];
  private readonly live: BlockRecord[];
  private readonly pageDelayMs: number;
  private readonly streamDelayMs: number;
  private readonly streamErrorAfter?: number;
  private readonly streamErrorLimit: number;
  private streamErrorsEmitted = 0;

  constructor(options: SimulatedChainOptions) {
    this.history = options.historySlots.map((slot) => ({
      slot,
      block: makeBlock(slot),
    }));
    this.live = options.liveSlots.map((slot) => ({
      slot,
      block: makeBlock(slot),
    }));
    this.pageDelayMs = options.pageDelayMs ?? DEFAULT_PAGE_DELAY;
    this.streamDelayMs = options.streamDelayMs ?? DEFAULT_STREAM_DELAY;
    this.streamErrorAfter = options.streamErrorAfter;
    this.streamErrorLimit = options.streamErrorLimit ?? 1;
  }

  async listBlocks(
    request: PartialMessage<ListBlocksRequest>,
  ): Promise<ListBlocksResponse> {
    await delay(this.pageDelayMs);
    const minSlot = extractStartSlot(request.filter);
    const order = (request.page?.orderBy ?? "slot asc").toLowerCase();
    const ascending = !order.includes("desc");
    const filtered = this.history.filter((entry) => entry.slot >= minSlot);
    const ordered = ascending ? filtered : [...filtered].reverse();
    const startIdx = request.page?.pageToken ? Number(request.page.pageToken) : 0;
    const pageSize = request.page?.pageSize ?? ordered.length;
    const slice = ordered.slice(startIdx, startIdx + pageSize);
    const nextIndex = startIdx + slice.length;
    const nextPageToken = nextIndex < ordered.length ? String(nextIndex) : undefined;
    return new ListBlocksResponse({
      blocks: slice.map((entry) => entry.block),
      page: new PageResponse({
        nextPageToken,
        totalSize: BigInt(ordered.length),
      }),
    });
  }

  streamBlocks(
    request: PartialMessage<StreamBlocksRequest>,
  ): AsyncIterable<StreamBlocksResponse> {
    const startSlot = (request.startSlot ?? 0n) as Slot;
    const data = this.live.filter((entry) => entry.slot >= startSlot);
    const delayMs = this.streamDelayMs;
    const shouldFail =
      this.streamErrorAfter !== undefined && this.streamErrorsEmitted < this.streamErrorLimit;
    const errorAfter = shouldFail ? this.streamErrorAfter : undefined;
    return {
      [Symbol.asyncIterator]: () => this.createStreamIterator(data, delayMs, errorAfter),
    };
  }

  private async *createStreamIterator(
    entries: BlockRecord[],
    delayMs: number,
    errorAfter?: number,
  ): AsyncGenerator<StreamBlocksResponse> {
    let delivered = 0;
    for (const entry of entries) {
      await delay(delayMs);
      if (errorAfter !== undefined && delivered >= errorAfter) {
        this.streamErrorsEmitted += 1;
        throw new Error("simulated stream failure");
      }
      yield new StreamBlocksResponse({ block: entry.block });
      delivered += 1;
    }
  }
}

function makeBlock(slot: Slot): Block {
  return new Block({
    header: new BlockHeader({ slot }),
  });
}

function extractStartSlot(filter?: PartialMessage<Filter>): Slot {
  const param = filter?.params?.start_slot;
  if (param?.kind?.case === "uintValue") return param.kind.value;
  return 0n;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
