export { ChainClient } from "./chain-client";
export type {
  AccountSource,
  BlockSource,
  ChainClientOptions,
  EventSource,
  ReplayDataSource,
  TransactionSource,
} from "./chain-client";

export { createBlockReplay } from "./replay/block-replay";
export type { BlockReplayOptions } from "./replay/block-replay";

export { createTransactionReplay } from "./replay/transaction-replay";
export type { TransactionReplayOptions } from "./replay/transaction-replay";

export { createEventReplay } from "./replay/event-replay";
export type { EventReplayOptions } from "./replay/event-replay";

export { createAccountReplay, createAccountsByOwnerReplay, AccountSeqTracker, MultiAccountReplay } from "./account-replay";
export type {
  AccountReplayEvent,
  AccountReplayOptions,
  AccountState,
  BlockFinishedEvent,
  AccountsByOwnerReplayOptions,
} from "./account-replay";

export { PageAssembler, PAGE_SIZE } from "./page-assembler";
export type { AssembledAccount, PageAssemblerOptions } from "./page-assembler";

export { ReplayStream } from "./replay-stream";

export type { ReplayConfig, ReplayLogger, ReplayMetrics, Slot } from "./types";

export { createConsoleLogger, NOOP_LOGGER } from "./logger";

export { ConsoleSink } from "./sinks/console";
export type { ReplaySink, ReplaySinkContext, ReplaySinkMeta } from "./sinks/replay-sink";

// Proto types for event filtering and processing
export type { Event } from "@thru/proto";
export type { Filter, FilterParamValue } from "@thru/proto";
export { FilterSchema, FilterParamValueSchema } from "@thru/proto";
export type { Pubkey as ProtoPubkey, Signature as ProtoSignature } from "@thru/proto";

// Account proto types - AccountView is an enum (value), others are types
export { AccountView } from "@thru/proto";
export type { Account, AccountMeta, AccountPage, AccountFlags } from "@thru/proto";
export type {
  StreamAccountUpdatesRequest,
  StreamAccountUpdatesResponse,
  AccountUpdate,
  BlockFinished,
} from "@thru/proto";

