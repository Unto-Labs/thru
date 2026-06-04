import { create } from "@bufbuild/protobuf";
import {
  type Filter,
  type PageRequest,
  PageRequestSchema,
  type ConsensusStatus,
  type Transaction,
  type ListTransactionsRequest,
  ListTransactionsRequestSchema,
  type StreamTransactionsRequest,
  StreamTransactionsRequestSchema,
  type StreamTransactionsResponse,
} from "@thru/sdk/proto";
import type { TransactionSource } from "../chain-client";
import { ReplayStream } from "../replay-stream";
import type { ReplayLogger, Slot } from "../types";
import { closeIfCloseable, resolveClient } from "../types";
import { backfillPage, combineFilters, mapAsyncIterable, slotLiteralFilter } from "./helpers";

export interface TransactionReplayOptions {
  /** Client instance for initial connection. Optional if clientFactory provided. */
  client?: TransactionSource;
  /** Factory to create fresh clients on reconnection. Enables robust reconnection. */
  clientFactory?: () => TransactionSource;
  startSlot: Slot;
  safetyMargin?: bigint;
  pageSize?: number;
  filter?: Filter;
  minConsensus?: ConsensusStatus;
  returnEvents?: boolean;
  logger?: ReplayLogger;
  resubscribeOnEnd?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_PAGE_SIZE = 256;
const DEFAULT_SAFETY_MARGIN = 64n;
const PAGE_ORDER_ASC = "slot asc";

export function createTransactionReplay(
  options: TransactionReplayOptions,
): ReplayStream<Transaction, string> {
  const safetyMargin = options.safetyMargin ?? DEFAULT_SAFETY_MARGIN;
  let currentClient = resolveClient(options, "TransactionReplayOptions");

  const createFetchBackfill = (client: TransactionSource) => async ({
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

    const mergedFilter = combineFilters(slotLiteralFilter("transaction.slot", startSlot), options.filter);
    const response = await client.listTransactions(
      create(ListTransactionsRequestSchema, {
        filter: mergedFilter,
        page,
        minConsensus: options.minConsensus,
        returnEvents: options.returnEvents,
      }),
    );

    return backfillPage(response.transactions, response.page);
  };

  const createSubscribeLive = (client: TransactionSource) => (startSlot: Slot): AsyncIterable<Transaction> => {
    const mergedFilter = combineFilters(slotLiteralFilter("transaction.slot", startSlot), options.filter);
    const request = create(StreamTransactionsRequestSchema, {
      filter: mergedFilter,
      minConsensus: options.minConsensus,
    });
    return mapAsyncIterable(
      client.streamTransactions(request),
      (resp: StreamTransactionsResponse) => resp.transaction,
    );
  };

  const onReconnect = options.clientFactory
    ? () => {
        const newClient = options.clientFactory!();
        currentClient = newClient;
        return {
          subscribeLive: createSubscribeLive(currentClient),
          fetchBackfill: createFetchBackfill(currentClient),
          dispose: () => closeIfCloseable(newClient),
        };
      }
    : undefined;

  return new ReplayStream<Transaction, string>({
    startSlot: options.startSlot,
    safetyMargin,
    fetchBackfill: createFetchBackfill(currentClient),
    subscribeLive: createSubscribeLive(currentClient),
    extractSlot: (tx) => tx.slot ?? 0n,
    extractKey: transactionKey,
    logger: options.logger,
    resubscribeOnEnd: options.resubscribeOnEnd,
    signal: options.signal,
    onReconnect,
    dispose: options.clientFactory
      ? () => closeIfCloseable(currentClient)
      : undefined,
  });
}

function transactionKey(tx: Transaction): string {
  const signatureBytes = tx.signature?.value;
  if (signatureBytes && signatureBytes.length) return bytesToHex(signatureBytes);
  const slotPart = tx.slot?.toString() ?? "0";
  const offsetPart = tx.blockOffset?.toString() ?? "0";
  return `${slotPart}:${offsetPart}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
