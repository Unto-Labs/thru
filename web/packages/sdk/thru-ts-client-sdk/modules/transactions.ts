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
    ConsensusStatus,
    type VersionContext,
    AccountView,
    RawTransaction,
    TransactionView,
    BatchSendTransactionsRequestSchema,
    type BatchSendTransactionsResponse,
    SendAndTrackTxnRequestSchema,
    type SendAndTrackTxnResponse,
    type SubmissionStatus,
    SendTransactionRequestSchema,
    GetRawTransactionRequestSchema,
    GetTransactionRequestSchema,
    GetTransactionStatusRequestSchema,
    ListTransactionsForAccountRequestSchema,
    type ListTransactionsForAccountResponse as ProtoListTransactionsForAccountResponse,
    ListTransactionsRequestSchema,
    type ListTransactionsResponse as ProtoListTransactionsResponse,
} from "@thru/sdk/proto";

import { encodeSignature } from "@thru/sdk/helpers";
import { Pubkey, type PubkeyInput, Signature, type SignatureInput } from "../domain/primitives";
import type { TrackTransactionUpdate, TransactionExecutionResultData } from "../domain/transactions";
import { getAccount } from "./accounts";
import { getChainId } from "./chain";
import { getBlockHeight } from "./height";
import { trackTransaction } from "./streaming";

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
    chainId?: number;
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

export type BatchTrackStatus =
    | "executed"
    | "finalized_without_execution"
    | "timeout"
    | "not_accepted"
    | "cancelled"
    | "track_error";

export interface BatchSendAndTrackOptions extends BatchSendTransactionsOptions {
    trackTimeoutMs?: number;
    signal?: AbortSignal;
}

export interface BatchSendAndTrackResult {
    signature: string;
    accepted: boolean;
    trackStatus: BatchTrackStatus;
    update?: TrackTransactionUpdate;
    executionResult?: TransactionExecutionResultData;
    error?: unknown;
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

export async function batchSendAndTrack(
    ctx: ThruClientContext,
    transactions: (LocalTransaction | Uint8Array)[],
    options: BatchSendAndTrackOptions = {},
): Promise<BatchSendAndTrackResult[]> {
    const rawTransactions = transactions.map((tx) =>
        tx instanceof Uint8Array ? tx : tx.toWire(),
    );
    const signatures = rawTransactions.map(extractSignature);
    const trackControllers = rawTransactions.map(() => new AbortController());
    const abortStatuses = rawTransactions.map<BatchTrackStatus | undefined>(() => undefined);
    const trackPromises = signatures.map((signature, index) =>
        trackUntilExecution(ctx, signature, {
            timeoutMs: options.trackTimeoutMs,
            signal: trackControllers[index].signal,
            getAbortStatus: () => abortStatuses[index],
        }),
    );

    options.signal?.addEventListener(
        "abort",
        () => {
            for (let index = 0; index < trackControllers.length; index += 1) {
                abortStatuses[index] ??= "cancelled";
                trackControllers[index].abort();
            }
        },
        { once: true },
    );

    let response: BatchSendTransactionsResponse;
    try {
        response = await batchSendTransactions(ctx, rawTransactions, {
            numRetries: options.numRetries ?? 0,
        });
    } catch (error) {
        for (const controller of trackControllers) {
            controller.abort();
        }
        await Promise.allSettled(trackPromises);
        throw error;
    }

    const accepted = signatures.map((_, index) => response.accepted[index] === true);
    for (let index = 0; index < accepted.length; index += 1) {
        if (!accepted[index]) {
            abortStatuses[index] = "not_accepted";
            trackControllers[index].abort();
        }
    }

    const tracked = await Promise.all(trackPromises);
    return signatures.map((signature, index) => ({
        signature,
        accepted: accepted[index],
        ...tracked[index],
    }));
}

export interface SendAndTrackTxnOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface SendAndTrackTxnUpdate {
    status: SubmissionStatus;
    signature?: { value: Uint8Array };
    consensusStatus: number;
    executionResult?: {
        vmError: number;
        consumedComputeUnits: number;
        userErrorCode: bigint;
    };
}

export function sendAndTrackTxn(
    ctx: ThruClientContext,
    transaction: LocalTransaction | Uint8Array,
    options: SendAndTrackTxnOptions = {},
): AsyncIterable<SendAndTrackTxnUpdate> {
    const raw = transaction instanceof Uint8Array ? transaction : transaction.toWire();
    const request = create(SendAndTrackTxnRequestSchema, {
        transaction: raw,
        timeout:
            options.timeoutMs != null
                ? {
                    seconds: BigInt(Math.floor(options.timeoutMs / 1000)),
                    nanos: (options.timeoutMs % 1000) * 1_000_000,
                }
                : undefined,
    });

    const iterable = ctx.command.sendAndTrackTxn(request, {
        ...withCallOptions(ctx),
        signal: options.signal,
    });

    async function* mapper(): AsyncGenerator<SendAndTrackTxnUpdate> {
        for await (const response of iterable) {
            yield {
                status: response.status,
                signature: response.signature ? { value: response.signature.value } : undefined,
                consensusStatus: response.consensusStatus,
                executionResult: response.executionResult
                    ? {
                        vmError: response.executionResult.vmError,
                        consumedComputeUnits: response.executionResult.consumedComputeUnits,
                        userErrorCode: response.executionResult.userErrorCode,
                    }
                    : undefined,
            };
        }
    }

    return mapper();
}

async function sendRawTransaction(ctx: ThruClientContext, rawTransaction: Uint8Array): Promise<string> {
    const request = create(SendTransactionRequestSchema, { rawTransaction });
    const response = await ctx.command.sendTransaction(request, withCallOptions(ctx));
    if (!response.signature?.value) {
        throw new Error("No signature returned from sendTransaction");
    }
    return encodeSignature(response.signature.value);
}

function extractSignature(rawTransaction: Uint8Array): string {
    if (rawTransaction.length < 64) {
        throw new Error(`Raw transaction too short to contain a signature: ${rawTransaction.length} bytes`);
    }

    const signatureBytes = rawTransaction.slice(rawTransaction.length - 64);
    return Signature.from(signatureBytes).toThruFmt();
}

async function trackUntilExecution(
    ctx: ThruClientContext,
    signature: string,
    options: {
        timeoutMs?: number;
        signal?: AbortSignal;
        getAbortStatus?: () => BatchTrackStatus | undefined;
    } = {},
): Promise<Omit<BatchSendAndTrackResult, "signature" | "accepted">> {
    let finalizedSeen = false;
    let latestUpdate: TrackTransactionUpdate | undefined;

    try {
        for await (const update of trackTransaction(ctx, signature, options)) {
            latestUpdate = update;
            if (update.statusCode === ConsensusStatus.FINALIZED || update.status === "finalized") {
                finalizedSeen = true;
            }

            if (update.executionResult) {
                return {
                    trackStatus: "executed",
                    update,
                    executionResult: update.executionResult,
                };
            }
        }
    } catch (error) {
        if (options.signal?.aborted) {
            return {
                trackStatus: options.getAbortStatus?.() ?? "cancelled",
                error,
            };
        }

        if (finalizedSeen) {
            return {
                trackStatus: "finalized_without_execution",
                update: latestUpdate,
                error,
            };
        }

        return {
            trackStatus: "track_error",
            update: latestUpdate,
            error,
        };
    }

    if (finalizedSeen) {
        return {
            trackStatus: "finalized_without_execution",
            update: latestUpdate,
        };
    }

    return {
        trackStatus: "timeout",
        update: latestUpdate,
    };
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
    const chainId = header.chainId ?? (await fetchChainId(ctx));
    return {
        fee: header.fee ?? DEFAULT_FEE,
        nonce,
        startSlot,
        expiryAfter: header.expiryAfter ?? DEFAULT_EXPIRY_AFTER,
        chainId,
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

async function fetchChainId(ctx: ThruClientContext): Promise<number> {
    return getChainId(ctx);
}
