import { TransactionBuilder } from "./transactions";

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
export { deriveProgramAddress, toPubkey } from "./modules/helpers";
export { ConsensusStatus } from "./proto/thru/common/v1/consensus_pb";
export {
    FilterParamValueSchema,
    FilterSchema
} from "./proto/thru/common/v1/filters_pb";
export { Transaction as SdkTransaction } from "./transactions";
export { TransactionBuilder };

// ============================================================================
// Type Exports - Common Types
// ============================================================================
    export type { Pubkey } from "@thru/helpers";

// ============================================================================
// Type Exports - Proto/Protocol Types
// ============================================================================
export type {
    Filter,
    FilterParamValue
} from "./proto/thru/common/v1/filters_pb";

// ============================================================================
// Type Exports - Accounts Module
// ============================================================================
export type {
    AccountQueryOptions,
    CreateAccountOptions,
    ListAccountsOptions,
    RawAccountQueryOptions
} from "./modules/accounts";

// ============================================================================
// Type Exports - Blocks Module
// ============================================================================
export type {
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
export type { TrackTransactionOptions } from "./modules/streaming";

// ============================================================================
// Type Exports - Transactions Module
// ============================================================================
export type {
    BatchSendTransactionsOptions,
    BuildAndSignTransactionOptions,
    BuildTransactionOptions,
    InstructionData,
    ListTransactionsForAccountOptions,
    RawTransactionQueryOptions,
    TransactionAccountsConfig,
    TransactionFeePayerConfig,
    TransactionHeaderConfig,
    TransactionQueryOptions
} from "./modules/transactions";
export type { SignedTransactionResult } from "./transactions";
export type {
    InstructionContext,
    ProgramIdentifier
} from "./transactions/types";

// ============================================================================
// Type Exports - Proofs Module
// ============================================================================
export type { GenerateStateProofOptions } from "./types/types";
