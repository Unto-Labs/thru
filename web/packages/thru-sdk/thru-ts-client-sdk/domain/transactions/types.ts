import { Pubkey, PubkeyInput, Signature } from "../primitives";

export interface ResourceLimits {
    computeUnits?: number;
    stateUnits?: number;
    memoryUnits?: number;
}

export interface OptionalProofs {
    feePayerStateProof?: Uint8Array;
    feePayerAccountMetaRaw?: Uint8Array;
}

export interface TransactionHeaderInput extends ResourceLimits {
    fee: bigint;
    nonce: bigint;
    startSlot: bigint;
    expiryAfter?: number;
    chainId?: number;
    flags?: number;
}

export interface TransactionAccountsInput {
    readWriteAccounts?: PubkeyInput[];
    readOnlyAccounts?: PubkeyInput[];
}

/**
 * Context provided to instruction data functions.
 * Contains all transaction accounts in their final sorted order and helper functions
 * for looking up account indexes.
 */
export interface InstructionContext {
    /** All accounts in final transaction order: [feePayer, program, ...readWrite, ...readOnly] */
    accounts: Pubkey[];
    /** Get the index of an account by its public key. Throws if account is not found in transaction. */
    getAccountIndex: (pubkey: PubkeyInput) => number;
}


export interface FeePayerInput {
    publicKey: PubkeyInput;
    privateKey?: Uint8Array;
}

/**
 * Function that builds instruction data with access to the final account ordering.
 * Use this when your instruction data contains account indices.
 */
export type InstructionDataBuilder = (context: InstructionContext) => Uint8Array | string;

export interface BuildTransactionParams {
    feePayer: FeePayerInput;
    program: PubkeyInput;
    header: TransactionHeaderInput;
    accounts?: TransactionAccountsInput;
    /**
     * Static instruction data. Use this when your instruction data does not
     * contain account indices, or when you've pre-computed the indices.
     */
    instructionData?: Uint8Array | string;
    /**
     * Builder function that receives the final account ordering.
     * Use this when your instruction data contains account indices to ensure
     * they match the post-sort transaction layout.
     *
     * @example
     * ```typescript
     * buildInstructionData: ({ getAccountIndex }) => {
     *   return buildMyInstruction(
     *     getAccountIndex(configAddress),
     *     getAccountIndex(trancheAddress),
     *   );
     * }
     * ```
     */
    buildInstructionData?: InstructionDataBuilder;
    proofs?: OptionalProofs;
}

export interface BuiltTransactionResult {
    transaction: TransactionLike;
}

export interface SignedTransactionResult extends BuiltTransactionResult {
    signature: Signature;
    rawTransaction: Uint8Array;
}

// Forward declaration to avoid circular imports in type layer
export interface TransactionLike {
    toWire(): Uint8Array;
}
