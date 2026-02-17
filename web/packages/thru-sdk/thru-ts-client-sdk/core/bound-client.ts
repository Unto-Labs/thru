import type { ThruClientContext } from "./client";

import { Pubkey, Signature, type PubkeyInput, type SignatureInput } from "../domain/primitives";
import * as accountsModule from "../modules/accounts";
import * as blocksModule from "../modules/blocks";
import * as consensusModule from "../modules/consensus";
import * as eventsModule from "../modules/events";
import * as heightModule from "../modules/height";
import {
    deriveAddress,
    DeriveAddressInput,
    DeriveAddressResult,
    deriveProgramAddress,
    type DeriveProgramAddressOptions,
    type DeriveProgramAddressResult
} from "../modules/helpers";
import * as chainModule from "../modules/chain";
import * as keysModule from "../modules/keys";
import * as nodeModule from "../modules/node";
import * as proofsModule from "../modules/proofs";
import * as slotsModule from "../modules/slots";
import * as streamingModule from "../modules/streaming";
import * as transactionsModule from "../modules/transactions";
import * as versionModule from "../modules/version";

type ContextualParameters<F> = F extends (ctx: ThruClientContext, ...args: infer P) => any ? P : never;

type BoundFunction<F> = F extends (ctx: ThruClientContext, ...args: infer P) => infer R ? (...args: P) => R : never;

function bind<F extends (ctx: ThruClientContext, ...args: any[]) => any>(
    ctx: ThruClientContext,
    fn: F,
): BoundFunction<F> {
    return ((...args: ContextualParameters<F>) => fn(ctx, ...args)) as BoundFunction<F>;
}

interface BoundBlocks {
    get: BoundFunction<typeof blocksModule.getBlock>;
    getRaw: BoundFunction<typeof blocksModule.getRawBlock>;
    list: BoundFunction<typeof blocksModule.listBlocks>;
    stream: BoundFunction<typeof streamingModule.streamBlocks>;
    getBlockHeight: BoundFunction<typeof heightModule.getBlockHeight>;
    streamHeight: BoundFunction<typeof streamingModule.streamHeight>;
}

interface BoundAccounts {
    get: BoundFunction<typeof accountsModule.getAccount>;
    getRaw: BoundFunction<typeof accountsModule.getRawAccount>;
    list: BoundFunction<typeof accountsModule.listAccounts>;
    stream: BoundFunction<typeof streamingModule.streamAccountUpdates>;
    create: BoundFunction<typeof accountsModule.createAccount>;
}

interface BoundTransactions {
    get: BoundFunction<typeof transactionsModule.getTransaction>;
    getRaw: BoundFunction<typeof transactionsModule.getRawTransaction>;
    getStatus: BoundFunction<typeof transactionsModule.getTransactionStatus>;
    list: BoundFunction<typeof transactionsModule.listTransactions>;
    listForAccount: BoundFunction<typeof transactionsModule.listTransactionsForAccount>;
    stream: BoundFunction<typeof streamingModule.streamTransactions>;
    build: BoundFunction<typeof transactionsModule.buildTransaction>;
    buildAndSign: BoundFunction<typeof transactionsModule.buildAndSignTransaction>;
    send: BoundFunction<typeof transactionsModule.sendTransaction>;
    batchSend: BoundFunction<typeof transactionsModule.batchSendTransactions>;
    sendAndTrack: BoundFunction<typeof transactionsModule.sendAndTrackTxn>;
    track: BoundFunction<typeof streamingModule.trackTransaction>;
}

interface BoundEvents {
    get: BoundFunction<typeof eventsModule.getEvent>;
    list: BoundFunction<typeof eventsModule.listEvents>;
    stream: BoundFunction<typeof streamingModule.streamEvents>;
}

interface BoundProofs {
    generate: BoundFunction<typeof proofsModule.generateStateProof>;
    getStateRoots: BoundFunction<typeof proofsModule.getStateRoots>;
}

interface BoundKeys {
    generateKeyPair: typeof keysModule.generateKeyPair;
    fromPrivateKey: typeof keysModule.fromPrivateKey;
}

interface BoundVersion {
    get: BoundFunction<typeof versionModule.getVersion>;
}

interface BoundSlots {
    getMetrics: BoundFunction<typeof slotsModule.getSlotMetrics>;
    listMetrics: BoundFunction<typeof slotsModule.listSlotMetrics>;
    streamMetrics: BoundFunction<typeof streamingModule.streamSlotMetrics>;
}

interface BoundNode {
    getPubkey: BoundFunction<typeof nodeModule.getNodePubkey>;
    getRecords: BoundFunction<typeof nodeModule.getNodeRecords>;
    streamRecords: BoundFunction<typeof streamingModule.streamNodeRecords>;
}

interface BoundChain {
    getChainInfo: BoundFunction<typeof chainModule.getChainInfo>;
    getChainId: BoundFunction<typeof chainModule.getChainId>;
}

interface BoundConsensus {
    statusToString: typeof consensusModule.consensusStatusToString;
    versionContext: typeof consensusModule.versionContext;
    currentVersionContext: typeof consensusModule.currentVersionContext;
    currentOrHistoricalVersionContext: typeof consensusModule.currentOrHistoricalVersionContext;
    slotVersionContext: typeof consensusModule.slotVersionContext;
    timestampVersionContext: typeof consensusModule.timestampVersionContext;
    seqVersionContext: typeof consensusModule.seqVersionContext;
}

interface Helpers {
    createSignature(value: SignatureInput): Signature;
    createPubkey(value: PubkeyInput): Pubkey;
    deriveProgramAddress(options: DeriveProgramAddressOptions): DeriveProgramAddressResult;
    deriveAddress(inputs: DeriveAddressInput[]): DeriveAddressResult;
}

export interface Thru {
    ctx: ThruClientContext;
    blocks: BoundBlocks;
    accounts: BoundAccounts;
    transactions: BoundTransactions;
    events: BoundEvents;
    slots: BoundSlots;
    proofs: BoundProofs;
    keys: BoundKeys;
    version: BoundVersion;
    consensus: BoundConsensus;
    node: BoundNode;
    chain: BoundChain;
    helpers: Helpers;
}

export function createBoundThruClient(ctx: ThruClientContext): Thru {
    return {
        ctx,
        blocks: {
            get: bind(ctx, blocksModule.getBlock),
            getRaw: bind(ctx, blocksModule.getRawBlock),
            list: bind(ctx, blocksModule.listBlocks),
            stream: bind(ctx, streamingModule.streamBlocks),
            getBlockHeight: bind(ctx, heightModule.getBlockHeight),
            streamHeight: bind(ctx, streamingModule.streamHeight),
        },
        accounts: {
            get: bind(ctx, accountsModule.getAccount),
            getRaw: bind(ctx, accountsModule.getRawAccount),
            list: bind(ctx, accountsModule.listAccounts),
            stream: bind(ctx, streamingModule.streamAccountUpdates),
            create: bind(ctx, accountsModule.createAccount),
        },
        transactions: {
            get: bind(ctx, transactionsModule.getTransaction),
            getRaw: bind(ctx, transactionsModule.getRawTransaction),
            getStatus: bind(ctx, transactionsModule.getTransactionStatus),
            list: bind(ctx, transactionsModule.listTransactions),
            listForAccount: bind(ctx, transactionsModule.listTransactionsForAccount),
            stream: bind(ctx, streamingModule.streamTransactions),
            build: bind(ctx, transactionsModule.buildTransaction),
            buildAndSign: bind(ctx, transactionsModule.buildAndSignTransaction),
            send: bind(ctx, transactionsModule.sendTransaction),
            batchSend: bind(ctx, transactionsModule.batchSendTransactions),
            sendAndTrack: bind(ctx, transactionsModule.sendAndTrackTxn),
            track: bind(ctx, streamingModule.trackTransaction),
        },
        helpers: {
            createSignature: Signature.from,
            createPubkey: Pubkey.from,
            deriveProgramAddress,
            deriveAddress
        },
        keys: {
            generateKeyPair: keysModule.generateKeyPair,
            fromPrivateKey: keysModule.fromPrivateKey,
        },
        events: {
            get: bind(ctx, eventsModule.getEvent),
            list: bind(ctx, eventsModule.listEvents),
            stream: bind(ctx, streamingModule.streamEvents),
        },
        slots: {
            getMetrics: bind(ctx, slotsModule.getSlotMetrics),
            listMetrics: bind(ctx, slotsModule.listSlotMetrics),
            streamMetrics: bind(ctx, streamingModule.streamSlotMetrics),
        },
        proofs: {
            generate: bind(ctx, proofsModule.generateStateProof),
            getStateRoots: bind(ctx, proofsModule.getStateRoots),
        },
        node: {
            getPubkey: bind(ctx, nodeModule.getNodePubkey),
            getRecords: bind(ctx, nodeModule.getNodeRecords),
            streamRecords: bind(ctx, streamingModule.streamNodeRecords),
        },
        chain: {
            getChainInfo: bind(ctx, chainModule.getChainInfo),
            getChainId: bind(ctx, chainModule.getChainId),
        },
        version: {
            get: bind(ctx, versionModule.getVersion),
        },
        consensus: {
            statusToString: consensusModule.consensusStatusToString,
            versionContext: consensusModule.versionContext,
            currentVersionContext: consensusModule.currentVersionContext,
            currentOrHistoricalVersionContext: consensusModule.currentOrHistoricalVersionContext,
            slotVersionContext: consensusModule.slotVersionContext,
            timestampVersionContext: consensusModule.timestampVersionContext,
            seqVersionContext: consensusModule.seqVersionContext,
        },
    };
}
