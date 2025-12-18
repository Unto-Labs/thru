import type { PartialMessage } from "@bufbuild/protobuf";
import { Filter } from "../proto/thru/common/v1/filters_pb";
import { PageResponse } from "../proto/thru/common/v1/pagination_pb";
import { Transaction } from "../proto/thru/core/v1/transaction_pb";
import { ListTransactionsResponse } from "../proto/thru/services/v1/query_service_pb";
import { StreamTransactionsResponse } from "../proto/thru/services/v1/streaming_service_pb";
import type { TransactionSource } from "../chain-client";
import type { ListTransactionsRequest } from "../proto/thru/services/v1/query_service_pb";
import type { StreamTransactionsRequest } from "../proto/thru/services/v1/streaming_service_pb";
import type { Slot } from "../types";

export interface SimulatedTransactionSourceOptions {
  history: Transaction[];
  live: Transaction[];
  pageDelayMs?: number;
  streamDelayMs?: number;
  streamErrorAfter?: number;
  streamErrorLimit?: number;
}

interface TransactionRecord {
  slot: Slot;
  tx: Transaction;
}

const DEFAULT_PAGE_DELAY = 0;
const DEFAULT_STREAM_DELAY = 0;

export class SimulatedTransactionSource implements TransactionSource {
  private readonly history: TransactionRecord[];
  private readonly live: TransactionRecord[];
  private readonly pageDelayMs: number;
  private readonly streamDelayMs: number;
  private readonly streamErrorAfter?: number;
  private readonly streamErrorLimit: number;
  private streamErrorsEmitted = 0;

  readonly streamStartSlots: Slot[] = [];

  constructor(options: SimulatedTransactionSourceOptions) {
    this.history = options.history.map((tx) => ({
      slot: extractSlot(tx),
      tx,
    }));
    this.live = options.live.map((tx) => ({
      slot: extractSlot(tx),
      tx,
    }));
    this.pageDelayMs = options.pageDelayMs ?? DEFAULT_PAGE_DELAY;
    this.streamDelayMs = options.streamDelayMs ?? DEFAULT_STREAM_DELAY;
    this.streamErrorAfter = options.streamErrorAfter;
    this.streamErrorLimit = options.streamErrorLimit ?? 1;
  }

  async listTransactions(
    request: PartialMessage<ListTransactionsRequest>,
  ): Promise<ListTransactionsResponse> {
    await delay(this.pageDelayMs);
    const minSlot = extractMinSlot(request.filter);
    const filtered = this.history.filter((entry) => entry.slot >= minSlot);
    const ordered = filtered.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
    const startIdx = request.page?.pageToken ? Number(request.page.pageToken) : 0;
    const pageSize = request.page?.pageSize ?? ordered.length;
    const slice = ordered.slice(startIdx, startIdx + pageSize);
    const nextIndex = startIdx + slice.length;
    const nextPageToken = nextIndex < ordered.length ? String(nextIndex) : undefined;
    return new ListTransactionsResponse({
      transactions: slice.map((entry) => entry.tx),
      page: new PageResponse({
        nextPageToken,
        totalSize: BigInt(ordered.length),
      }),
    });
  }

  streamTransactions(
    request: PartialMessage<StreamTransactionsRequest>,
  ): AsyncIterable<StreamTransactionsResponse> {
    const minSlot = extractMinSlot(request.filter);
    this.streamStartSlots.push(minSlot);
    const data = this.live.filter((entry) => entry.slot >= minSlot);
    const delayMs = this.streamDelayMs;
    const shouldFail =
      this.streamErrorAfter !== undefined && this.streamErrorsEmitted < this.streamErrorLimit;
    const errorAfter = shouldFail ? this.streamErrorAfter : undefined;
    return {
      [Symbol.asyncIterator]: () => this.createStreamIterator(data, delayMs, errorAfter),
    };
  }

  private async *createStreamIterator(
    entries: TransactionRecord[],
    delayMs: number,
    errorAfter?: number,
  ): AsyncGenerator<StreamTransactionsResponse> {
    let delivered = 0;
    for (const entry of entries) {
      await delay(delayMs);
      if (errorAfter !== undefined && delivered >= errorAfter) {
        this.streamErrorsEmitted += 1;
        throw new Error("simulated transaction stream failure");
      }
      yield new StreamTransactionsResponse({ transaction: entry.tx });
      delivered += 1;
    }
  }
}

function extractSlot(tx: Transaction): Slot {
  return tx.slot ?? 0n;
}

function extractMinSlot(filter?: PartialMessage<Filter>): Slot {
  const param = filter?.params?.start_slot;
  if (param?.kind?.case === "uintValue") return param.kind.value;
  const expr = filter?.expression ?? "";
  const match = expr.match(/uint\((\d+)\)/);
  if (match) return BigInt(match[1]);
  return 0n;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
