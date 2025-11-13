import { TransactionBuilder } from "./domain/transactions";

// ============================================================================
// Namespace Exports (for module functions)
// ============================================================================
export * as accounts from "./modules/accounts";
export * as blocks from "./modules/blocks";
export * as events from "./modules/events";
export * as height from "./modules/height";
export * as keys from "./modules/keys";
export * as proofs from "./modules/proofs";
export * as streaming from "./modules/streaming";
export * as transactions from "./modules/transactions";

// ============================================================================
// Value Exports (classes, enums, functions)
// ============================================================================
export { Account } from "./domain/accounts";
export { Block } from "./domain/blocks";
export { ChainEvent } from "./domain/events";
export { Filter, FilterParamValue } from "./domain/filters";
export { HeightSnapshot } from "./domain/height";
export { PageRequest, PageResponse } from "./domain/pagination";
export { StateProof } from "./domain/proofs";
export { Transaction, TransactionStatusSnapshot } from "./domain/transactions";
export { VersionInfo } from "./domain/version";
export { deriveProgramAddress, toPubkey } from "./modules/helpers";
export { ConsensusStatus } from "./proto/thru/common/v1/consensus_pb";
export {
  FilterParamValueSchema,
  FilterSchema
} from "./proto/thru/common/v1/filters_pb";
export { AccountView } from "./proto/thru/core/v1/account_pb";
export { BlockView, ExecutionStatus } from "./proto/thru/core/v1/block_pb";
export { TransactionView, TransactionVmError } from "./proto/thru/core/v1/transaction_pb";
export { TransactionBuilder };

// ============================================================================
// Type Exports - Common Types
// ============================================================================
    export type { Pubkey } from "@thru/helpers";
  export type { PageRequestParams, PageResponseParams } from "./domain/pagination";
// ============================================================================
// Type Exports - Proto/Protocol Types
// ============================================================================

// ============================================================================
// Type Exports - Accounts Module
// ============================================================================
export type {
  AccountQueryOptions, CreateAccountOptions,
  ListAccountsOptions,
  RawAccountQueryOptions
} from "./modules/accounts";

// ============================================================================
// Type Exports - Blocks Module
// ============================================================================
export type {
  BlockList,
  BlockQueryOptions,
  ListBlocksOptions,
  RawBlockQueryOptions
} from "./modules/blocks";

// ============================================================================
// Type Exports - Events Module
// ============================================================================
export type { GetEventOptions } from "./modules/events";

// ============================================================================
// Type Exports - Helpers Module
// ============================================================================
export type {
  BlockSelector,
  DeriveProgramAddressOptions,
  DeriveProgramAddressResult
} from "./modules/helpers";

// ============================================================================
// Type Exports - Keys Module
// ============================================================================
export type { GeneratedKeyPair } from "./modules/keys";

// ============================================================================
// Type Exports - Streaming Module
// ============================================================================
export type { StreamAccountUpdate } from "./domain/accounts";
export type { HeightSnapshotParams } from "./domain/height/HeightSnapshot";
export type {
  StreamAccountUpdatesOptions,
  StreamAccountUpdatesResult,
  StreamBlocksOptions,
  StreamBlocksResult,
  StreamEventsOptions,
  StreamEventsResult, StreamTransactionsOptions,
  StreamTransactionsResult, StreamTransactionUpdate, TrackTransactionOptions,
  TrackTransactionUpdate
} from "./modules/streaming";

// ============================================================================
// Type Exports - Transactions Module
// ============================================================================
export type {
  SignedTransactionResult,
  TransactionExecutionEvent,
  TransactionExecutionResultData
} from "./domain/transactions";
export type {
  InstructionContext,
  ProgramIdentifier
} from "./domain/transactions/types";
export type {
  BatchSendTransactionsOptions,
  BuildAndSignTransactionOptions,
  BuildTransactionOptions,
  InstructionData,
  ListTransactionsForAccountOptions, RawTransactionQueryOptions,
  TransactionAccountsConfig,
  TransactionFeePayerConfig,
  TransactionHeaderConfig, TransactionList, TransactionQueryOptions
} from "./modules/transactions";

// ============================================================================
// Type Exports - Proofs Module
// ============================================================================
export type { GenerateStateProofOptions } from "./types/types";
