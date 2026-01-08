import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
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
    type SignedTransactionResult,
    Transaction,
    type TransactionAccountsInput,
    TransactionBuilder,
    type TransactionHeaderInput,
    TransactionStatusSnapshot
} from "../domain/transactions";
import { normalizeAccountList, parseInstructionData } from "../domain/transactions/utils";
import {
    type ConsensusStatus,
    type VersionContext,
    AccountView,
    RawTransaction,
    TransactionView,
    BatchSendTransactionsRequestSchema,
    type BatchSendTransactionsResponse,
    SendTransactionRequestSchema,
    GetRawTransactionRequestSchema,
    GetTransactionRequestSchema,
    GetTransactionStatusRequestSchema,
    ListTransactionsForAccountRequestSchema,
    type ListTransactionsForAccountResponse as ProtoListTransactionsForAccountResponse,
    ListTransactionsRequestSchema,
    type ListTransactionsResponse as ProtoListTransactionsResponse,
} from "@thru/proto";

import { encodeSignature } from "@thru/helpers";
import { Pubkey, type PubkeyInput, Signature, type SignatureInput } from "../domain/primitives";
import { getAccount } from "./accounts";
import { getBlockHeight } from "./height";

export interface TransactionFeePayerConfig {
    publicKey: PubkeyInput;
    privateKey?: Uint8Array;
}

export interface TransactionAccountsConfig {
    readWrite?: PubkeyInput[];
    readOnly?: PubkeyInput[];
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
export type InstructionData = Uint8Array | string| ((context: InstructionContext) => Promise<Uint8Array>);

export interface BuildTransactionOptions {
    feePayer: TransactionFeePayerConfig;
    program: PubkeyInput;
    header?: TransactionHeaderConfig;
    accounts?: TransactionAccountsConfig;
    instructionData?: InstructionData;
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

export interface ListTransactionsOptions {
    filter?: Filter;
    page?: PageRequest;
    returnEvents?: boolean;
    versionContext?: VersionContext;
    minConsensus?: ConsensusStatus;
}

export async function getTransaction(
    ctx: ThruClientContext,
    signature: SignatureInput,
    options: TransactionQueryOptions = {},
): Promise<Transaction> {
    const request = create(GetTransactionRequestSchema, {
        signature: Signature.from(signature).toProtoSignature(),
        view: options.view ?? DEFAULT_TRANSACTION_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    const proto = await ctx.query.getTransaction(request, withCallOptions(ctx));
    return Transaction.fromProto(proto);
}

export async function getRawTransaction(
    ctx: ThruClientContext,
    signature: SignatureInput,
    options: RawTransactionQueryOptions = {},
): Promise<RawTransaction> {
    const request = create(GetRawTransactionRequestSchema, {
        signature: Signature.from(signature).toProtoSignature(),
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getRawTransaction(request, withCallOptions(ctx));
}

export async function getTransactionStatus(ctx: ThruClientContext, signature: SignatureInput): Promise<TransactionStatusSnapshot> {
    const request = create(GetTransactionStatusRequestSchema, {
        signature: Signature.from(signature).toProtoSignature(),
    });
    const proto = await ctx.query.getTransactionStatus(request, withCallOptions(ctx));
    return TransactionStatusSnapshot.fromProto(proto);
}

export async function listTransactionsForAccount(
    ctx: ThruClientContext,
    account: PubkeyInput,
    options: ListTransactionsForAccountOptions = {},
): Promise<TransactionList> {
    const request = create(ListTransactionsForAccountRequestSchema, {
        account: Pubkey.from(account).toProtoPubkey(),
        filter: options.filter?.toProto(),
        page: options.page?.toProto(),
    });
    const response: ProtoListTransactionsForAccountResponse = await ctx.query.listTransactionsForAccount(
        request,
        withCallOptions(ctx),
    );
    const protoTransactionSignatures = (response.transactions ?? []).map((transaction) => transaction.signature);
    const transactions = await Promise.all(
        protoTransactionSignatures.map((signature) => {
            if (!signature) {
                throw new Error("ListTransactionsForAccount returned an empty signature");
            }
            return getTransaction(ctx, signature.value, options.transactionOptions);
        }),
    );
    return {
        transactions,
        page: PageResponse.fromProto(response.page),
    };
}

export async function listTransactions(
    ctx: ThruClientContext,
    options: ListTransactionsOptions = {},
): Promise<TransactionList> {
    const request = create(ListTransactionsRequestSchema, {
        filter: options.filter?.toProto(),
        page: options.page?.toProto(),
        returnEvents: options.returnEvents,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    const response: ProtoListTransactionsResponse = await ctx.query.listTransactions(
        request,
        withCallOptions(ctx),
    );
    return {
        transactions: response.transactions.map((proto) => Transaction.fromProto(proto)),
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
    return ctx.command.batchSendTransactions(request, withCallOptions(ctx));
}

async function sendRawTransaction(ctx: ThruClientContext, rawTransaction: Uint8Array): Promise<string> {
    const request = create(SendTransactionRequestSchema, { rawTransaction });
    const response = await ctx.command.sendTransaction(request, withCallOptions(ctx));
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
    const feePayerPublicKey = Pubkey.from(options.feePayer.publicKey).toBytes();
    const program = Pubkey.from(options.program).toBytes();
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
        program: Pubkey.from(options.program).toBytes(),
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
        Pubkey.from(value).toBytes(),
    );
    const readOnly = accounts.readOnly?.map((value, index) =>
        Pubkey.from(value).toBytes(),
    );

    const result: TransactionAccountsInput = {};
    if (readWrite && readWrite.length > 0) {
        result.readWriteAccounts = normalizeAccountList(readWrite);
    }
    if (readOnly && readOnly.length > 0) {
        result.readOnlyAccounts = normalizeAccountList(readOnly);
    }

    if (!result.readWriteAccounts && !result.readOnlyAccounts) {
        return undefined;
    }

    return result;
}

function createInstructionContext(
    feePayer: PubkeyInput,
    program: PubkeyInput,
    accounts?: TransactionAccountsInput,
): InstructionContext {
    // Build accounts array in transaction order: [feePayer, program, ...readWrite, ...readOnly]
    const allAccounts: Pubkey[] = [
        Pubkey.from(feePayer),
        Pubkey.from(program),
        ...(accounts?.readWriteAccounts?.map((value) => Pubkey.from(value)) ?? []),
        ...(accounts?.readOnlyAccounts?.map((value) => Pubkey.from(value)) ?? []),
    ];

    // Helper to compare two account addresses
    const getAccountIndex = (pubkey: PubkeyInput): number => {
        for (let i = 0; i < allAccounts.length; i++) {
            if (allAccounts[i].equals(Pubkey.from(pubkey))) {
                return i;
            }
        }
        throw new Error("Account not found in transaction accounts");
    };

    return { accounts: allAccounts, getAccountIndex };
}

async function resolveInstructionData(
    value: InstructionData | undefined,
    context: InstructionContext,
): Promise<Uint8Array | undefined> {
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
