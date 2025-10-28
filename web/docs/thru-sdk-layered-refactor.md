# Thru SDK Layered Refactor Tracker

## Objectives
- Extract transport and RPC setup into reusable context
- Split monolithic methods into focused domain helpers
- Preserve current transaction builder behaviour while relocating orchestration
- Maintain public API ergonomics with tree-shakeable modules

## Milestones
1. Core client context (`core/client.ts`) provides transport and service stubs
2. Domain modules (blocks, accounts, events, proofs, height, transactions) expose functional helpers
3. Transaction builder stays isolated; domain helpers delegate
4. Public entry point re-exports context, modules, and transaction types
5. Optional thin class wrapper delegates to functional helpers
6. Shared defaults, parsing, and error utilities consolidated

## QA Checklist
- [ ] Snapshot of legacy `sdk.ts` validated against new helpers
- [ ] Unit tests cover domain helper behaviour
- [ ] Streaming and transaction flows verified end to end
- [ ] Tree-shaking confirmed via bundle analysis

## Notes
- Maintain existing defaults for fees, limits, and expiry until new configuration API decided
- Ensure backwards compatibility for exported types (`Transaction`, `SignedTransactionResult`, etc.)

## Design Decisions
- Preserve pure helper exports that accept a shared `ThruClientContext`, so single-function imports and isolated unit tests remain trivial.
- `createThruClient` will instantiate the context and return bound helper namespaces (e.g. `client.blocks.get`), keeping ergonomics similar to Gill while staying tree-shakeable.
- Expose the created context alongside bound helpers for advanced usage, manual testing, or custom wiring.
- Explore an optional fluent RPC proxy (`client.rpc.query.getBlock().send()`) after the initial bound-module rollout, ensuring the proxy layers atop the same helpers.
- Document recommended testing patterns: unit tests stub the context and call raw helpers; integration tests use the bound factory output.

## Task Breakdown
- [x] Define `ThruClientContext` type and context factory in `core/client.ts`, wiring transport + service stubs.
- [x] Surface shared defaults (`fee`, `limits`, `expiry`) in `defaults.ts` and replace inline constants in existing code.
- [x] Extract context-dependent helpers from `sdk.ts` into raw functional modules (`modules/blocks.ts`, `modules/accounts.ts`, etc.) while preserving parameters and return types.
- [x] Implement `modules/transactions.ts` to delegate to existing builder utilities without duplicating signing logic.
- [x] Create `modules/events.ts`, `modules/proofs.ts`, and `modules/height.ts` using the current RPC calls and protobuf schemas.
- [x] Author `modules/streaming.ts` (or fold into transactions) to cover `trackTransaction` and other stream-based helpers.
- [x] Build a bound helper utility (`createBoundThruClient`) that binds each module to a context and returns namespaced APIs (`blocks`, `accounts`, `transactions`, ...).
- [x] Update the public entry point (`sdk.ts`) to export raw helpers, the bound factory output (`createThruClient`), and the compatibility `ThruSdk` wrapper.
- [ ] Add optional fluent RPC proxy wrapper mirroring Gill-style usage and document its experimental status.
- [ ] Write unit tests for each module using mocked `ThruClientContext` stubs; ensure coverage for error paths and defaults.
- [ ] Update integration/e2e tests (wallet + test-dapp) to consume the new API surface and confirm backwards compatibility.
- [ ] Refresh developer docs and README usage snippets to show both functional and bound-module patterns.
- [ ] Re-run bundle analysis to verify tree-shaking and update the QA checklist accordingly.

## Current Implementation Snapshot
### `thru-wallet-sdk/packages/thru-sdk/thru-ts-client-sdk/sdk.ts`
```ts
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { ConsensusStatus, VersionContext } from "./proto/thru/common/v1/consensus_pb";
import type { Filter } from "./proto/thru/common/v1/filters_pb";
import type { PageRequest } from "./proto/thru/common/v1/pagination_pb";
import { Account, AccountView, DataSlice, RawAccount } from "./proto/thru/core/v1/account_pb";
import { Block, BlockView, RawBlock } from "./proto/thru/core/v1/block_pb";
import { StateProofRequestSchema } from "./proto/thru/core/v1/state_pb";
import { Transaction as CoreTransaction, RawTransaction, TransactionView } from "./proto/thru/core/v1/transaction_pb";
import { Pubkey } from "./proto/thru/core/v1/types_pb";
import { CommandService, SendTransactionRequestSchema } from "./proto/thru/services/v1/command_service_pb";
import {
    Event,
    GenerateStateProofRequestSchema,
    GenerateStateProofResponse,
    GetAccountRequestSchema,
    GetBlockRequestSchema,
    GetEventRequestSchema,
    GetHeightRequestSchema,
    GetHeightResponse,
    GetRawAccountRequestSchema,
    GetRawBlockRequestSchema,
    GetRawTransactionRequestSchema,
    GetTransactionRequestSchema,
    GetTransactionStatusRequestSchema,
    ListBlocksRequestSchema,
    ListBlocksResponse,
    ListOwnedAccountsRequestSchema,
    ListOwnedAccountsResponse,
    QueryService,
    TransactionStatus,
} from "./proto/thru/services/v1/query_service_pb";
import type { TrackTransactionResponse } from "./proto/thru/services/v1/streaming_service_pb";
import { StreamingService, TrackTransactionRequestSchema } from "./proto/thru/services/v1/streaming_service_pb";
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
} from "./transactions";
import { parseAccountIdentifier, parseInstructionData } from "./transactions/utils";
import { GenerateStateProofOptions } from "./types/types";
import { BlockSelector, BytesLike, decodeAddress, decodeSignature, encodeAddress, encodeSignature, isSlotSelector, toBlockHash, toPubkey, toSignature as toSignatureMessage } from "./utils/utils";

const DEFAULT_HOST = "http://74.118.142.189:8080";
const DEFAULT_ACCOUNT_VIEW = AccountView.FULL;
const DEFAULT_BLOCK_VIEW = BlockView.FULL;
const DEFAULT_TRANSACTION_VIEW = TransactionView.FULL;
const DEFAULT_MIN_CONSENSUS = ConsensusStatus.UNSPECIFIED;

export { Transaction as SdkTransaction } from "./transactions";
export type { SignedTransactionResult } from "./transactions";
export { TransactionBuilder };

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

const DEFAULT_FEE = 1n;
const DEFAULT_COMPUTE_UNITS = 300_000_000;
const DEFAULT_STATE_UNITS = 10_000;
const DEFAULT_MEMORY_UNITS = 10_000;
const DEFAULT_EXPIRY_AFTER = 100;

export class ThruSdk {
    public hostUrl: string;
    private readonly transport;
    private readonly queryClient;
    private readonly commandClient;
    private readonly streamingClient;
    constructor(hostUrl: string = DEFAULT_HOST) {
        this.hostUrl = hostUrl;
        this.transport = createGrpcWebTransport({
            baseUrl: this.hostUrl,
        });
        this.queryClient = createClient(QueryService, this.transport);
        this.commandClient = createClient(CommandService, this.transport);
        this.streamingClient = createClient(StreamingService, this.transport);
    }

    // Helpers
    getHostUrl(): string {
        return this.hostUrl;
    }

    encodeSignature(signature: Uint8Array): string {
        return encodeSignature(signature);
    }

    encodeAddress(address: Uint8Array): string {
        return encodeAddress(address);
    }

    decodeSignature(signature: string): Uint8Array {
        return decodeSignature(signature);
    }

    decodeAddress(address: string): Uint8Array {
        return decodeAddress(address);
    }

    toPubkey(value: BytesLike): Pubkey {
        return toPubkey(value, "pubkey");
    }

    toSignature(value: BytesLike): Uint8Array {
        return toSignatureMessage(value).value;
    }

    // RPC Methods
    async getBlockHeight(): Promise<GetHeightResponse> {
        const request = create(GetHeightRequestSchema);
        return this.queryClient.getHeight(request);
    }

    async getTransactionStatus(signature: BytesLike): Promise<TransactionStatus> {
        const request = create(GetTransactionStatusRequestSchema, {
            signature: toSignatureMessage(signature),
        });
        return this.queryClient.getTransactionStatus(request);
    }

    async getTransaction(
        signature: BytesLike,
        options: {
            view?: TransactionView;
            versionContext?: VersionContext;
            minConsensus?: ConsensusStatus;
        } = {},
    ): Promise<CoreTransaction> {
        const request = create(GetTransactionRequestSchema, {
            signature: toSignatureMessage(signature),
            view: options.view ?? DEFAULT_TRANSACTION_VIEW,
            versionContext: options.versionContext,
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        });
        return this.queryClient.getTransaction(request);
    }

    async getRawTransaction(
        signature: BytesLike,
        options: {
            versionContext?: VersionContext;
            minConsensus?: ConsensusStatus;
        } = {},
    ): Promise<RawTransaction> {
        const request = create(GetRawTransactionRequestSchema, {
            signature: toSignatureMessage(signature),
            versionContext: options.versionContext,
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        });
        return this.queryClient.getRawTransaction(request);
    }

    async getAccount(
        address: BytesLike,
        options: {
            view?: AccountView;
            versionContext?: VersionContext;
            minConsensus?: ConsensusStatus;
            dataSlice?: DataSlice;
        } = {},
    ): Promise<Account> {
        const request = create(GetAccountRequestSchema, {
            address: toPubkey(address, "address"),
            view: options.view ?? DEFAULT_ACCOUNT_VIEW,
            versionContext: options.versionContext,
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
            dataSlice: options.dataSlice,
        });
        return this.queryClient.getAccount(request);
    }

    async getRawAccount(
        address: BytesLike,
        options: {
            view?: AccountView;
            versionContext?: VersionContext;
            minConsensus?: ConsensusStatus;
        } = {},
    ): Promise<RawAccount> {
        const request = create(GetRawAccountRequestSchema, {
            address: toPubkey(address, "address"),
            view: options.view ?? DEFAULT_ACCOUNT_VIEW,
            versionContext: options.versionContext,
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        });
        return this.queryClient.getRawAccount(request);
    }

    async getBlock(
        selector: BlockSelector,
        options: {
            view?: BlockView;
            minConsensus?: ConsensusStatus;
        } = {},
    ): Promise<Block> {
        const request = create(GetBlockRequestSchema, {
            selector: isSlotSelector(selector)
                ? { case: "slot", value: typeof selector.slot === "bigint" ? selector.slot : BigInt(selector.slot) }
                : { case: "blockHash", value: toBlockHash(selector.blockHash) },
            view: options.view ?? DEFAULT_BLOCK_VIEW,
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        });
        return this.queryClient.getBlock(request);
    }

    async getRawBlock(
        selector: BlockSelector,
        options: {
            minConsensus?: ConsensusStatus;
        } = {},
    ): Promise<RawBlock> {
        const request = create(GetRawBlockRequestSchema, {
            selector: isSlotSelector(selector)
                ? { case: "slot", value: typeof selector.slot === "bigint" ? selector.slot : BigInt(selector.slot) }
                : { case: "blockHash", value: toBlockHash(selector.blockHash) },
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        });
        return this.queryClient.getRawBlock(request);
    }

    async listOwnedAccounts(
        owner: BytesLike,
        options: {
            view?: AccountView;
            versionContext?: VersionContext;
            filter?: Filter;
            page?: PageRequest;
            minConsensus?: ConsensusStatus;
        } = {},
    ): Promise<ListOwnedAccountsResponse> {
        const request = create(ListOwnedAccountsRequestSchema, {
            owner: toPubkey(owner, "owner"),
            view: options.view ?? DEFAULT_ACCOUNT_VIEW,
            versionContext: options.versionContext,
            filter: options.filter,
            page: options.page,
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        });
        return this.queryClient.listOwnedAccounts(request);
    }

    async listBlocks(
        options: {
            filter?: Filter;
            page?: PageRequest;
            view?: BlockView;
            minConsensus?: ConsensusStatus;
        } = {},
    ): Promise<ListBlocksResponse> {
        const request = create(ListBlocksRequestSchema, {
            filter: options.filter,
            page: options.page,
            view: options.view ?? DEFAULT_BLOCK_VIEW,
            minConsensus: options.minConsensus ?? DEFAULT_MIN_CONSENSUS,
        });
        return this.queryClient.listBlocks(request);
    }

    async getEvent(
        eventId: string,
        options: { versionContext?: VersionContext } = {},
    ): Promise<Event> {
        if (!eventId) {
            throw new Error("eventId is required");
        }
        const request = create(GetEventRequestSchema, {
            eventId,
            versionContext: options.versionContext,
        });
        return this.queryClient.getEvent(request);
    }

    async generateStateProof(options: GenerateStateProofOptions): Promise<GenerateStateProofResponse> {
        const request = create(StateProofRequestSchema, {
            address: options.address ? toPubkey(options.address, "address") : undefined,
            proofType: options.proofType,
            targetSlot: options.targetSlot,
        });
        const schemaRequest = create(GenerateStateProofRequestSchema, { request });
        return this.queryClient.generateStateProof(schemaRequest);
    }

    // Transaction helpers
    async buildTransaction(options: BuildTransactionOptions): Promise<LocalTransaction> {
        const builder = this.createTransactionBuilder();
        const params = await this.createBuildParams(options);
        return builder.build(params);
    }

    async buildAndSignTransaction(options: BuildAndSignTransactionOptions): Promise<SignedTransactionResult> {
        const builder = this.createTransactionBuilder();
        const params = await this.createBuildParams(options);
        if (!params.feePayer.privateKey) {
            throw new Error("Fee payer private key is required to sign the transaction");
        }
        return builder.buildAndSign(params);
    }

    async sendBuiltTransaction(transaction: LocalTransaction | Uint8Array): Promise<string> {
        const raw = transaction instanceof Uint8Array ? transaction : transaction.toWire();
        return this.sendTransaction(raw);
    }

    async sendTransaction(rawTransaction: Uint8Array): Promise<string> {
        const request = create(SendTransactionRequestSchema, { rawTransaction });
        const response = await this.commandClient.sendTransaction(request);
        if (!response.signature?.value) {
            throw new Error("No signature returned from sendTransaction");
        }
        return encodeSignature(response.signature.value);
    }

    trackTransaction(
        signature: BytesLike,
        options: {
            timeoutMs?: number;
            signal?: AbortSignal;
        } = {},
    ): AsyncIterable<TrackTransactionResponse> {
        const timeoutMs = options.timeoutMs;
        const request = create(TrackTransactionRequestSchema, {
            signature: toSignatureMessage(signature),
            timeout:
                timeoutMs != null
                    ? {
                        seconds: BigInt(Math.floor(timeoutMs / 1000)),
                        nanos: (timeoutMs % 1000) * 1_000_000,
                    }
                    : undefined,
        });

        return this.streamingClient.trackTransaction(request, {
            signal: options.signal,
        });
    }

    // Internal helpers
    private createTransactionBuilder(): TransactionBuilder {
        return new TransactionBuilder();
    }

    private async createBuildParams(options: BuildTransactionOptions): Promise<BuildTransactionParams> {
        const feePayerPublicKey = parseAccountIdentifier(options.feePayer.publicKey, "feePayer.publicKey");
        const header = await this.createTransactionHeader(options.header ?? {}, feePayerPublicKey);
        const accounts = this.parseAccounts(options.accounts);
        const content = this.createContent(options.content);

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

    private async createTransactionHeader(
        header: TransactionHeaderConfig,
        feePayerPublicKey: Uint8Array,
    ): Promise<TransactionHeaderInput> {
        const nonce = header.nonce ?? (await this.fetchFeePayerNonce(feePayerPublicKey));
        const startSlot = header.startSlot ?? (await this.fetchFinalizedSlot());
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

    private parseAccounts(accounts?: TransactionAccountsConfig): TransactionAccountsInput | undefined {
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

    private createContent(content?: TransactionContentConfig): TransactionContentInput | undefined {
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

    private async fetchFeePayerNonce(feePayer: Uint8Array): Promise<bigint> {
        const account = await this.getAccount(feePayer, { view: AccountView.FULL });
        const nonce = account.meta?.nonce;
        if (nonce === undefined) {
            throw new Error("Fee payer account nonce is unavailable");
        }
        return nonce;
    }

    private async fetchFinalizedSlot(): Promise<bigint> {
        const height = await this.getBlockHeight();
        return height.finalized;
    }
}

```
