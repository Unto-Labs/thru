import { create } from "@bufbuild/protobuf";

import { Pubkey } from "@thru/helpers";
import type { ThruClientContext } from "../core/client";
import { DEFAULT_ACCOUNT_VIEW, DEFAULT_MIN_CONSENSUS, DEFAULT_VERSION_CONTEXT } from "../defaults";
import { ConsensusStatus, VersionContext } from "../proto/thru/common/v1/consensus_pb";
import { type Filter } from "../proto/thru/common/v1/filters_pb";
import type { PageRequest } from "../proto/thru/common/v1/pagination_pb";
import { Account, AccountView, DataSlice, RawAccount } from "../proto/thru/core/v1/account_pb";
import { StateProofType } from "../proto/thru/core/v1/state_pb";
import {
    GetAccountRequestSchema,
    GetRawAccountRequestSchema,
    ListAccountsRequestSchema,
    type ListAccountsResponse,
} from "../proto/thru/services/v1/query_service_pb";
import type { Transaction } from "../transactions/Transaction";
import { TransactionBuilder } from "../transactions/TransactionBuilder";
import type { TransactionHeaderInput } from "../transactions/types";
import { mergeTransactionHeader } from "../utils/utils";
import { getBlockHeight } from "./height";
import { toPubkey } from "./helpers";
import { generateStateProof } from "./proofs";

export interface CreateAccountOptions {
    /** The new account's public key (fee payer). */
    publicKey: Pubkey;
    /** Optional overrides for the transaction header. */
    header?: Partial<TransactionHeaderInput>;
}


export interface AccountQueryOptions {
    view?: AccountView;
    versionContext?: VersionContext;
    minConsensus?: ConsensusStatus;
    dataSlice?: DataSlice;
}

export interface RawAccountQueryOptions {
    view?: AccountView;
    versionContext?: VersionContext;
    minConsensus?: ConsensusStatus;
}

export interface ListAccountsOptions {
    view?: AccountView;
    versionContext?: VersionContext;
    filter?: Filter;
    page?: PageRequest;
    minConsensus?: ConsensusStatus;
}

export function getAccount(
    ctx: ThruClientContext,
    address: Pubkey,
    options: AccountQueryOptions = {},
): Promise<Account> {
    const request = create(GetAccountRequestSchema, {
        address: toPubkey(address, "address"),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        dataSlice: options.dataSlice,
    });
    return ctx.query.getAccount(request);
}

export function getRawAccount(
    ctx: ThruClientContext,
    address: Pubkey,
    options: RawAccountQueryOptions = {},
): Promise<RawAccount> {
    const request = create(GetRawAccountRequestSchema, {
        address: toPubkey(address, "address"),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getRawAccount(request);
}

export function listAccounts(
    ctx: ThruClientContext,
    options: ListAccountsOptions,
): Promise<ListAccountsResponse> {
    const request = create(ListAccountsRequestSchema, {
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        filter: options.filter,
        page: options.page,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.listAccounts(request);
}

export async function createAccount(
    ctx: ThruClientContext,
    options: CreateAccountOptions,
): Promise<Transaction> {
    const feePayer = toPubkey(options.publicKey, "publicKey").value;

    const height = await getBlockHeight(ctx);
    const startSlot = height.finalized;

    const proofResponse = await generateStateProof(ctx, {
        address: options.publicKey,
        proofType: StateProofType.CREATING,
        targetSlot: startSlot,
    });

    const proofBytes = proofResponse.proof?.proof;
    if (!proofBytes || proofBytes.length === 0) {
        throw new Error("State proof generation returned empty proof");
    }

    const program = new Uint8Array(32);
    program[31] = 0x02;

    const builder = new TransactionBuilder();
    const headerDefaults: TransactionHeaderInput = {
        fee: 0n,
        nonce: 0n,
        startSlot,
        expiryAfter: 100,
        computeUnits: 10_000,
        memoryUnits: 10_000,
        stateUnits: 10_000,
    };

    const header = mergeTransactionHeader(headerDefaults, options.header);

    const transaction = builder.build({
        feePayer: { publicKey: feePayer },
        program,
        header,
        proofs: { feePayerStateProof: proofBytes }
    });

    return transaction;
}