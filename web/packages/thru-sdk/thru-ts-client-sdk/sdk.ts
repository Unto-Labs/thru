import { TransactionBuilder } from "./domain/transactions";

// ============================================================================
// Namespace Exports (for module functions)
// ============================================================================
export * as accounts from "./modules/accounts";
export * as blocks from "./modules/blocks";
export * as chain from "./modules/chain";
export * as consensus from "./modules/consensus";
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
export { Pubkey, Signature } from "./domain/primitives";
export { StateProof } from "./domain/proofs";
export { Transaction, TransactionStatusSnapshot } from "./domain/transactions";
export { VersionInfo } from "./domain/version";
export {
  deriveAddress,
  deriveProgramAddress
} from "./modules/helpers";
export { collectStream, firstStreamValue, forEachStreamValue } from "./modules/streaming";
export {
  ConsensusStatus,
  FilterParamValueSchema,
  FilterSchema,
  AccountView,
  BlockView,
  ExecutionStatus,
  TransactionView,
  TransactionVmError
} from "@thru/proto";
export { TransactionBuilder };
export { signWithDomain, verifyWithDomain, SignatureDomain } from "./domain/transactions/domain-signing";

// ============================================================================
// Type Exports - Common Types
// ============================================================================
    export type { PageRequestParams, PageResponseParams } from "./domain/pagination";
  export type { PubkeyInput, SignatureInput } from "./domain/primitives";
  export type { VersionContextInput } from "./modules/consensus";
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
  DeriveAddressInput,
  DeriveAddressResult,
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
  InstructionContext
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
