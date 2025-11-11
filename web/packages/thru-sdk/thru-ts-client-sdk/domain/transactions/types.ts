import { BytesLike } from "@thru/helpers";

export type Bytes32 = Uint8Array;
export type Bytes64 = Uint8Array;

export type AccountAddress = Bytes32;

export type ProgramIdentifier = BytesLike;

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
    flags?: number;
}

export interface TransactionAccountsInput {
    readWriteAccounts?: AccountAddress[];
    readOnlyAccounts?: AccountAddress[];
}

/**
 * Context provided to instruction data functions.
 * Contains all transaction accounts in their final sorted order and helper functions
 * for looking up account indexes.
 */
export interface InstructionContext {
    /** All accounts in final transaction order: [feePayer, program, ...readWrite, ...readOnly] */
    accounts: AccountAddress[];
    /** Get the index of an account by its public key. Throws if account is not found in transaction. */
    getAccountIndex: (pubkey: AccountAddress) => number;
}



export interface FeePayerInput {
    publicKey: AccountAddress;
    privateKey?: Bytes32;
}

export interface BuildTransactionParams {
    feePayer: FeePayerInput;
    program: ProgramIdentifier;
    header: TransactionHeaderInput;
    accounts?: TransactionAccountsInput;
    instructionData?: BytesLike;
    proofs?: OptionalProofs;
}

export interface BuiltTransactionResult {
    transaction: TransactionLike;
}

export interface SignedTransactionResult extends BuiltTransactionResult {
    signature: Bytes64;
    rawTransaction: Uint8Array;
}

// Forward declaration to avoid circular imports in type layer
export interface TransactionLike {
    toWire(): Uint8Array;
}
