import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { DEFAULT_ACCOUNT_VIEW, DEFAULT_MIN_CONSENSUS } from "../defaults";
import { ConsensusStatus, VersionContext } from "../proto/thru/common/v1/consensus_pb";
import type { Filter } from "../proto/thru/common/v1/filters_pb";
import type { PageRequest } from "../proto/thru/common/v1/pagination_pb";
import { Account, AccountView, DataSlice, RawAccount } from "../proto/thru/core/v1/account_pb";
import { StateProofType } from "../proto/thru/core/v1/state_pb";
import {
    GetAccountRequestSchema,
    GetRawAccountRequestSchema,
    ListOwnedAccountsRequestSchema,
    ListOwnedAccountsResponse,
} from "../proto/thru/services/v1/query_service_pb";
import type { Transaction } from "../transactions/Transaction";
import { TransactionBuilder } from "../transactions/TransactionBuilder";
import { getBlockHeight } from "./height";
import type { BytesLike } from "./helpers";
import { toPubkey } from "./helpers";
import { generateStateProof } from "./proofs";

export interface CreateAccountOptions {
    /** The new account's public key (fee payer). */
    publicKey: BytesLike;
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

export interface ListOwnedAccountsOptions {
    view?: AccountView;
    versionContext?: VersionContext;
    filter?: Filter;
    page?: PageRequest;
    minConsensus?: ConsensusStatus;
}

export function getAccount(
    ctx: ThruClientContext,
    address: BytesLike,
    options: AccountQueryOptions = {},
): Promise<Account> {
    const request = create(GetAccountRequestSchema, {
        address: toPubkey(address, "address"),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        dataSlice: options.dataSlice,
    });
    return ctx.query.getAccount(request);
}

export function getRawAccount(
    ctx: ThruClientContext,
    address: BytesLike,
    options: RawAccountQueryOptions = {},
): Promise<RawAccount> {
    const request = create(GetRawAccountRequestSchema, {
        address: toPubkey(address, "address"),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getRawAccount(request);
}

export function listOwnedAccounts(
    ctx: ThruClientContext,
    owner: BytesLike,
    options: ListOwnedAccountsOptions = {},
): Promise<ListOwnedAccountsResponse> {
    const request = create(ListOwnedAccountsRequestSchema, {
        owner: toPubkey(owner, "owner"),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext,
        filter: options.filter,
        page: options.page,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.listOwnedAccounts(request);
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
    const transaction = builder.build({
        feePayer: { publicKey: feePayer },
        program,
        header: {
            fee: 0n,
            nonce: 0n,
            startSlot,
            expiryAfter: 100,
            computeUnits: 10_000,
            memoryUnits: 10_000,
            stateUnits: 10_000,
        },
        content: {
            proofs: { feePayerStateProof: proofBytes }
        }
    });

    return transaction;
}
