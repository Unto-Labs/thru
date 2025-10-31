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

export interface TransactionContentInput {
    instructions?: Uint8Array;
    proofs?: OptionalProofs;
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
    content?: TransactionContentInput;
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
