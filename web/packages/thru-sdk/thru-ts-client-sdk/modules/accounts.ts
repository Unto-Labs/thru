import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { DEFAULT_ACCOUNT_VIEW, DEFAULT_MIN_CONSENSUS, DEFAULT_VERSION_CONTEXT } from "../defaults";
import { Account } from "../domain/accounts";
import { Filter } from "../domain/filters";
import { PageRequest, PageResponse } from "../domain/pagination";
import { Pubkey, type PubkeyInput } from "../domain/primitives";
import type { Transaction } from "../domain/transactions/Transaction";
import { TransactionBuilder } from "../domain/transactions/TransactionBuilder";
import type { TransactionHeaderInput } from "../domain/transactions/types";
import { ConsensusStatus, VersionContext } from "../proto/thru/common/v1/consensus_pb";
import { AccountView, DataSlice, RawAccount } from "../proto/thru/core/v1/account_pb";
import { StateProofType } from "../proto/thru/core/v1/state_pb";
import {
    GetAccountRequestSchema,
    GetRawAccountRequestSchema,
    ListAccountsRequestSchema,
    type ListAccountsResponse as ProtoListAccountsResponse,
} from "../proto/thru/services/v1/query_service_pb";
import { mergeTransactionHeader } from "../utils/utils";
import { generateStateProof } from "./proofs";

export interface CreateAccountOptions {
    /** The new account's public key (fee payer). */
    publicKey: PubkeyInput;
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

export interface AccountList {
    accounts: Account[];
    page?: PageResponse;
}

export function getAccount(
    ctx: ThruClientContext,
    address: PubkeyInput,
    options: AccountQueryOptions = {},
): Promise<Account> {
    const request = create(GetAccountRequestSchema, {
        address: Pubkey.from(address).toProtoPubkey(),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        dataSlice: options.dataSlice,
    });
    return ctx.query.getAccount(request, withCallOptions(ctx)).then(Account.fromProto);
}

export function getRawAccount(
    ctx: ThruClientContext,
    address: PubkeyInput,
    options: RawAccountQueryOptions = {},
): Promise<RawAccount> {
    const request = create(GetRawAccountRequestSchema, {
        address: Pubkey.from(address).toProtoPubkey(),
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.getRawAccount(request, withCallOptions(ctx));
}

export function listAccounts(
    ctx: ThruClientContext,
    options: ListAccountsOptions,
): Promise<AccountList> {
    const request = create(ListAccountsRequestSchema, {
        view: options.view ?? DEFAULT_ACCOUNT_VIEW,
        versionContext: options.versionContext ?? DEFAULT_VERSION_CONTEXT,
        filter: options.filter?.toProto(),
        page: options.page?.toProto(),
        minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
    });
    return ctx.query.listAccounts(request, withCallOptions(ctx)).then((response: ProtoListAccountsResponse) => ({
        accounts: response.accounts.map((proto) => Account.fromProto(proto)),
        page: PageResponse.fromProto(response.page),
    }));
}

export async function createAccount(
    ctx: ThruClientContext,
    options: CreateAccountOptions,
): Promise<Transaction> {
    const feePayer = Pubkey.from(options.publicKey).toBytes();

    // Let the server auto-select the latest available state root slot.
    // This avoids race conditions where we request a slot that hasn't
    // been ingested into ClickHouse yet.
    const proofResponse = await generateStateProof(ctx, {
        address: options.publicKey,
        proofType: StateProofType.CREATING,
        // targetSlot omitted - server will auto-select
    });

    const proofBytes = proofResponse.proof;
    if (!proofBytes || proofBytes.length === 0) {
        throw new Error("State proof generation returned empty proof");
    }

    // Use the slot from the proof response for the transaction startSlot
    const startSlot = proofResponse.slot;

    const program = new Uint8Array(32);
    program[31] = 0x03; /* NOOP program id used by thru-cli account creation */

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
