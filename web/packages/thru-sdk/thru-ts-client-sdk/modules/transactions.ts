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
} from "../defaults";
import type { ConsensusStatus, VersionContext } from "../proto/thru/common/v1/consensus_pb";
import { AccountView } from "../proto/thru/core/v1/account_pb";
import { Transaction as CoreTransaction, RawTransaction, TransactionView } from "../proto/thru/core/v1/transaction_pb";
import { SendTransactionRequestSchema } from "../proto/thru/services/v1/command_service_pb";
import {
    GetRawTransactionRequestSchema,
    GetTransactionRequestSchema,
    GetTransactionStatusRequestSchema,
    TransactionStatus,
} from "../proto/thru/services/v1/query_service_pb";
import {
    Transaction as LocalTransaction,
    TransactionBuilder,
    type BuildTransactionParams,
    type OptionalProofs,
    type ProgramIdentifier,
    type SignedTransactionResult,
    type TransactionAccountsInput,
    type TransactionContentInput,
    type TransactionHeaderInput,
} from "../transactions";
import { parseAccountIdentifier, parseInstructionData } from "../transactions/utils";
import type { BytesLike } from "./helpers";
import { encodeSignature, toSignature as toSignatureMessage } from "./helpers";

import { getAccount } from "./accounts";
import { getBlockHeight } from "./height";

export interface TransactionFeePayerConfig {
    publicKey: BytesLike;
    privateKey?: Uint8Array;
}

export interface TransactionAccountsConfig {
    readWrite?: BytesLike[];
    readOnly?: BytesLike[];
}

export interface TransactionContentConfig {
    instructions?: BytesLike;
    feePayerStateProof?: Uint8Array;
    feePayerAccountMetaRaw?: Uint8Array;
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

export interface BuildTransactionOptions {
    feePayer: TransactionFeePayerConfig;
    program: ProgramIdentifier;
    header?: TransactionHeaderConfig;
    accounts?: TransactionAccountsConfig;
    content?: TransactionContentConfig;
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

export async function getTransaction(
    ctx: ThruClientContext,
    signature: BytesLike,
    options: TransactionQueryOptions = {},
): Promise<CoreTransaction> {
    const request = create(GetTransactionRequestSchema, {
        signature: toSignatureMessage(signature),
        view: options.view ?? DEFAULT_TRANSACTION_VIEW,
        versionContext: options.versionContext,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getTransaction(request);
}

export async function getRawTransaction(
    ctx: ThruClientContext,
    signature: BytesLike,
    options: RawTransactionQueryOptions = {},
): Promise<RawTransaction> {
    const request = create(GetRawTransactionRequestSchema, {
        signature: toSignatureMessage(signature),
        versionContext: options.versionContext,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getRawTransaction(request);
}

export async function getTransactionStatus(ctx: ThruClientContext, signature: BytesLike): Promise<TransactionStatus> {
    const request = create(GetTransactionStatusRequestSchema, {
        signature: toSignatureMessage(signature),
    });
    return ctx.query.getTransactionStatus(request);
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
    const header = await createTransactionHeader(ctx, options.header ?? {}, feePayerPublicKey);
    const accounts = parseAccounts(options.accounts);
    const content = createContent(options.content);

    return {
        feePayer: {
            publicKey: feePayerPublicKey,
            privateKey: options.feePayer.privateKey,
        },
        program: options.program,
        header,
        accounts,
        content,
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

function createContent(content?: TransactionContentConfig): TransactionContentInput | undefined {
    if (!content) {
        return undefined;
    }

    const instructions = parseInstructionData(content.instructions);
    const proofs: OptionalProofs = {};
    if (content.feePayerStateProof) {
        proofs.feePayerStateProof = new Uint8Array(content.feePayerStateProof);
    }
    if (content.feePayerAccountMetaRaw) {
        proofs.feePayerAccountMetaRaw = new Uint8Array(content.feePayerAccountMetaRaw);
    }
    const hasProofs = Boolean(proofs.feePayerStateProof || proofs.feePayerAccountMetaRaw);

    if (!instructions && !hasProofs) {
        return undefined;
    }

    const result: TransactionContentInput = {};
    if (instructions) {
        result.instructions = instructions;
    }
    if (hasProofs) {
        result.proofs = proofs;
    }
    return result;
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
