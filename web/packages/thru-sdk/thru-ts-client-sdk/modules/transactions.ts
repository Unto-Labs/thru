import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import {
    DEFAULT_COMPUTE_UNITS,
    DEFAULT_EXPIRY_AFTER,
    DEFAULT_FEE,
    DEFAULT_MEMORY_UNITS,
    DEFAULT_MIN_CONSENSUS,
    DEFAULT_STATE_UNITS,
    DEFAULT_TRANSACTION_VIEW,
    DEFAULT_VERSION_CONTEXT,
} from "../defaults";
import { Filter } from "../domain/filters";
import { PageRequest, PageResponse } from "../domain/pagination";
import {
    type BuildTransactionParams,
    type InstructionContext,
    Transaction as LocalTransaction,
    type OptionalProofs,
    type ProgramIdentifier,
    type SignedTransactionResult,
    Transaction,
    type TransactionAccountsInput,
    TransactionBuilder,
    type TransactionHeaderInput,
    TransactionStatusSnapshot,
} from "../domain/transactions";
import { parseAccountIdentifier, parseInstructionData, resolveProgramIdentifier } from "../domain/transactions/utils";
import type { ConsensusStatus, VersionContext } from "../proto/thru/common/v1/consensus_pb";
import { AccountView } from "../proto/thru/core/v1/account_pb";
import { RawTransaction, TransactionView } from "../proto/thru/core/v1/transaction_pb";
import {
    BatchSendTransactionsRequestSchema,
    type BatchSendTransactionsResponse,
    SendTransactionRequestSchema,
} from "../proto/thru/services/v1/command_service_pb";
import {
    GetRawTransactionRequestSchema,
    GetTransactionRequestSchema,
    GetTransactionStatusRequestSchema,
    ListTransactionsForAccountRequestSchema,
    type ListTransactionsForAccountResponse as ProtoListTransactionsForAccountResponse,
} from "../proto/thru/services/v1/query_service_pb";
import { toSignature } from "./helpers";

import { BytesLike, encodeSignature, Pubkey } from "@thru/helpers";
import { getAccount } from "./accounts";
import { getBlockHeight } from "./height";
import { toPubkey } from "./helpers";

export interface TransactionFeePayerConfig {
    publicKey: Pubkey;
    privateKey?: Uint8Array;
}

export interface TransactionAccountsConfig {
    readWrite?: Pubkey[];
    readOnly?: Pubkey[];
}

export interface TransactionHeaderConfig {
    fee?: bigint;
    nonce?: bigint;
    startSlot?: bigint;
    expiryAfter?: number;
    computeUnits?: number;
    stateUnits?: number;
    memoryUnits?: number;
    flags?: number;
}
/**
 * Instruction data can be either:
 * - A Uint8Array directly
 * - A function that takes an InstructionContext and returns a Uint8Array
 */
export type InstructionData = Uint8Array | ((context: InstructionContext) => Promise<Uint8Array>);

export interface BuildTransactionOptions {
    feePayer: TransactionFeePayerConfig;
    program: ProgramIdentifier;
    header?: TransactionHeaderConfig;
    accounts?: TransactionAccountsConfig;
    instructionData?: InstructionData | BytesLike;
    feePayerStateProof?: Uint8Array;
    feePayerAccountMetaRaw?: Uint8Array;
}

export interface BuildAndSignTransactionOptions extends BuildTransactionOptions {
    feePayer: TransactionFeePayerConfig & { privateKey: Uint8Array };
}

export interface TransactionQueryOptions {
    view?: TransactionView;
    versionContext?: VersionContext;
    minConsensus?: ConsensusStatus;
}

export interface RawTransactionQueryOptions {
    versionContext?: VersionContext;
    minConsensus?: ConsensusStatus;
}

export interface ListTransactionsForAccountOptions {
    filter?: Filter;
    page?: PageRequest;
    transactionOptions?: TransactionQueryOptions;
}

export interface TransactionList {
    transactions: Transaction[];
    page?: PageResponse;
}

export async function getTransaction(
    ctx: ThruClientContext,
    signature: BytesLike,
    options: TransactionQueryOptions = {},
): Promise<Transaction> {
    const request = create(GetTransactionRequestSchema, {
        signature: toSignature(signature),
        view: options.view ?? DEFAULT_TRANSACTION_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    const proto = await ctx.query.getTransaction(request);
    return Transaction.fromProto(proto);
}

export async function getRawTransaction(
    ctx: ThruClientContext,
    signature: BytesLike,
    options: RawTransactionQueryOptions = {},
): Promise<RawTransaction> {
    const request = create(GetRawTransactionRequestSchema, {
        signature: toSignature(signature),
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getRawTransaction(request);
}

export async function getTransactionStatus(ctx: ThruClientContext, signature: BytesLike): Promise<TransactionStatusSnapshot> {
    const request = create(GetTransactionStatusRequestSchema, {
        signature: toSignature(signature),
    });
    const proto = await ctx.query.getTransactionStatus(request);
    return TransactionStatusSnapshot.fromProto(proto);
}

export async function listTransactionsForAccount(
    ctx: ThruClientContext,
    account: Pubkey,
    options: ListTransactionsForAccountOptions = {},
): Promise<TransactionList> {
    const request = create(ListTransactionsForAccountRequestSchema, {
        account: toPubkey(account, "account"),
        filter: options.filter?.toProto(),
        page: options.page?.toProto(),
    });
    const response: ProtoListTransactionsForAccountResponse = await ctx.query.listTransactionsForAccount(request);
    const transactions = await Promise.all(
        response.signatures.map((signatureMessage) => {
            if (!signatureMessage.value) {
                throw new Error("ListTransactionsForAccount returned an empty signature");
            }
            return getTransaction(ctx, signatureMessage.value, options.transactionOptions);
        }),
    );
    return {
        transactions,
        page: PageResponse.fromProto(response.page),
    };
}

export async function buildTransaction(
    ctx: ThruClientContext,
    options: BuildTransactionOptions,
): Promise<LocalTransaction> {
    const builder = createTransactionBuilder();
    const params = await createBuildParams(ctx, options);
    return builder.build(params);
}

export async function buildAndSignTransaction(
    ctx: ThruClientContext,
    options: BuildAndSignTransactionOptions,
): Promise<SignedTransactionResult> {
    const builder = createTransactionBuilder();
    const params = await createBuildParams(ctx, options);
    if (!params.feePayer.privateKey) {
        throw new Error("Fee payer private key is required to sign the transaction");
    }
    return builder.buildAndSign(params);
}

export async function sendTransaction(
    ctx: ThruClientContext,
    transaction: LocalTransaction | Uint8Array,
): Promise<string> {
    const raw = transaction instanceof Uint8Array ? transaction : transaction.toWire();
    return sendRawTransaction(ctx, raw);
}

export interface BatchSendTransactionsOptions {
    numRetries?: number;
}

export async function batchSendTransactions(
    ctx: ThruClientContext,
    transactions: (LocalTransaction | Uint8Array)[],
    options: BatchSendTransactionsOptions = {},
): Promise<BatchSendTransactionsResponse> {
    const rawTransactions = transactions.map((tx) =>
        tx instanceof Uint8Array ? tx : tx.toWire(),
    );
    const request = create(BatchSendTransactionsRequestSchema, {
        rawTransactions,
        numRetries: options.numRetries ?? 0,
    });
    return ctx.command.batchSendTransactions(request);
}

async function sendRawTransaction(ctx: ThruClientContext, rawTransaction: Uint8Array): Promise<string> {
    const request = create(SendTransactionRequestSchema, { rawTransaction });
    const response = await ctx.command.sendTransaction(request);
    if (!response.signature?.value) {
        throw new Error("No signature returned from sendTransaction");
    }
    return encodeSignature(response.signature.value);
}

function createTransactionBuilder(): TransactionBuilder {
    return new TransactionBuilder();
}

async function createBuildParams(
    ctx: ThruClientContext,
    options: BuildTransactionOptions,
): Promise<BuildTransactionParams> {
    const feePayerPublicKey = parseAccountIdentifier(options.feePayer.publicKey, "feePayer.publicKey");
    const program = resolveProgramIdentifier(options.program);
    const header = await createTransactionHeader(ctx, options.header ?? {}, feePayerPublicKey);
    const accounts = parseAccounts(options.accounts);
    
    // Create context for function resolution
    const context = createInstructionContext(feePayerPublicKey, program, accounts);
    
    // Resolve instruction data (functions get resolved here)
    const instructionData = await resolveInstructionData(options.instructionData, context);
    const proofs = createProofs(options);

    return {
        feePayer: {
            publicKey: feePayerPublicKey,
            privateKey: options.feePayer.privateKey,
        },
        program: options.program,
        header,
        accounts,
        instructionData,
        proofs,
    };
}

async function createTransactionHeader(
    ctx: ThruClientContext,
    header: TransactionHeaderConfig,
    feePayerPublicKey: Uint8Array,
): Promise<TransactionHeaderInput> {
    const nonce = header.nonce ?? (await fetchFeePayerNonce(ctx, feePayerPublicKey));
    const startSlot = header.startSlot ?? (await fetchFinalizedSlot(ctx));
    return {
        fee: header.fee ?? DEFAULT_FEE,
        nonce,
        startSlot,
        expiryAfter: header.expiryAfter ?? DEFAULT_EXPIRY_AFTER,
        computeUnits: header.computeUnits ?? DEFAULT_COMPUTE_UNITS,
        stateUnits: header.stateUnits ?? DEFAULT_STATE_UNITS,
        memoryUnits: header.memoryUnits ?? DEFAULT_MEMORY_UNITS,
        flags: header.flags,
    };
}

function parseAccounts(accounts?: TransactionAccountsConfig): TransactionAccountsInput | undefined {
    if (!accounts) {
        return undefined;
    }
    const readWrite = accounts.readWrite?.map((value, index) =>
        parseAccountIdentifier(value, `accounts.readWrite[${index}]`),
    );
    const readOnly = accounts.readOnly?.map((value, index) =>
        parseAccountIdentifier(value, `accounts.readOnly[${index}]`),
    );

    const result: TransactionAccountsInput = {};
    if (readWrite && readWrite.length > 0) {
        result.readWriteAccounts = readWrite;
    }
    if (readOnly && readOnly.length > 0) {
        result.readOnlyAccounts = readOnly;
    }

    if (!result.readWriteAccounts && !result.readOnlyAccounts) {
        return undefined;
    }

    return result;
}

function createInstructionContext(
    feePayer: Uint8Array,
    program: Uint8Array,
    accounts?: TransactionAccountsInput,
): InstructionContext {
    // Build accounts array in transaction order: [feePayer, program, ...readWrite, ...readOnly]
    const allAccounts: Uint8Array[] = [
        feePayer,
        program,
        ...(accounts?.readWriteAccounts ?? []),
        ...(accounts?.readOnlyAccounts ?? []),
    ];

    // Helper to compare two account addresses
    const accountsEqual = (a: Uint8Array, b: Uint8Array): boolean => {
        if (a.length !== 32 || b.length !== 32) {
            return false;
        }
        for (let i = 0; i < 32; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    };

    const getAccountIndex = (pubkey: Uint8Array): number => {
        for (let i = 0; i < allAccounts.length; i++) {
            if (accountsEqual(allAccounts[i], pubkey)) {
                return i;
            }
        }
        throw new Error("Account not found in transaction accounts");
    };

    return { accounts: allAccounts, getAccountIndex };
}

async function resolveInstructionData(
    value: InstructionData | BytesLike | undefined,
    context: InstructionContext,
): Promise<BytesLike | undefined> {
    if (value === undefined) {
        return undefined;
    }
    
    // If it's a function, resolve it with the context
    if (typeof value === "function") {
        return await value(context);
    }
    
    // If it's already a Uint8Array, pass it through
    if (value instanceof Uint8Array) {
        return value;
    }
    
    // Otherwise, parse BytesLike (string) to Uint8Array
    return parseInstructionData(value);
}

function createProofs(options: BuildTransactionOptions): OptionalProofs | undefined {
    const proofs: OptionalProofs = {};
    if (options.feePayerStateProof) {
        proofs.feePayerStateProof = options.feePayerStateProof;
    }
    if (options.feePayerAccountMetaRaw) {
        proofs.feePayerAccountMetaRaw = options.feePayerAccountMetaRaw;
    }
    const hasProofs = Boolean(proofs.feePayerStateProof || proofs.feePayerAccountMetaRaw);
    return hasProofs ? proofs : undefined;
}

async function fetchFeePayerNonce(ctx: ThruClientContext, feePayer: Uint8Array): Promise<bigint> {
    const account = await getAccount(ctx, feePayer, { view: AccountView.FULL });
    const nonce = account.meta?.nonce;
    if (nonce === undefined) {
        throw new Error("Fee payer account nonce is unavailable");
    }
    return nonce;
}

async function fetchFinalizedSlot(ctx: ThruClientContext): Promise<bigint> {
    const height = await getBlockHeight(ctx);
    return height.finalized;
}
