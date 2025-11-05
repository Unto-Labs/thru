import type { ThruClientContext } from "./client";

import { decodeAddress, decodeSignature, encodeAddress, encodeSignature } from "@thru/helpers";
import * as accountsModule from "../modules/accounts";
import * as blocksModule from "../modules/blocks";
import * as eventsModule from "../modules/events";
import * as heightModule from "../modules/height";
import {
    deriveProgramAddress,
    toBlockHash,
    toPubkey,
    toSignature,
    type DeriveProgramAddressOptions,
    type DeriveProgramAddressResult,
} from "../modules/helpers";
import * as keysModule from "../modules/keys";
import * as proofsModule from "../modules/proofs";
import * as streamingModule from "../modules/streaming";
import * as transactionsModule from "../modules/transactions";
import * as versionModule from "../modules/version";
import { BlockHash, Pubkey, Signature } from "../proto/thru/core/v1/types_pb";

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
    listForAccount: BoundFunction<typeof transactionsModule.listTransactionsForAccount>;
    stream: BoundFunction<typeof streamingModule.streamTransactions>;
    build: BoundFunction<typeof transactionsModule.buildTransaction>;
    buildAndSign: BoundFunction<typeof transactionsModule.buildAndSignTransaction>;
    send: BoundFunction<typeof transactionsModule.sendTransaction>;
    batchSend: BoundFunction<typeof transactionsModule.batchSendTransactions>;
    track: BoundFunction<typeof streamingModule.trackTransaction>;
}

interface BoundEvents {
    get: BoundFunction<typeof eventsModule.getEvent>;
    stream: BoundFunction<typeof streamingModule.streamEvents>;
}

interface BoundProofs {
    generate: BoundFunction<typeof proofsModule.generateStateProof>;
}

interface BoundKeys {
    generateKeyPair: typeof keysModule.generateKeyPair;
    fromPrivateKey: typeof keysModule.fromPrivateKey;
}

interface BoundVersion {
    get: BoundFunction<typeof versionModule.getVersion>;
}

interface Helpers {
    toSignature(value: Uint8Array | string): Signature;
    toPubkey(value: Uint8Array | string, field: string): Pubkey;
    toBlockHash(value: Uint8Array | string): BlockHash;
    encodeSignature(bytes: Uint8Array): string;
    decodeSignature(value: string): Uint8Array;
    encodeAddress(bytes: Uint8Array): string;
    decodeAddress(value: string): Uint8Array;
    deriveProgramAddress(options: DeriveProgramAddressOptions): DeriveProgramAddressResult;
}

export interface Thru {
    ctx: ThruClientContext;
    blocks: BoundBlocks;
    accounts: BoundAccounts;
    transactions: BoundTransactions;
    events: BoundEvents;
    proofs: BoundProofs;
    keys: BoundKeys;
    version: BoundVersion;
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
            listForAccount: bind(ctx, transactionsModule.listTransactionsForAccount),
            stream: bind(ctx, streamingModule.streamTransactions),
            build: bind(ctx, transactionsModule.buildTransaction),
            buildAndSign: bind(ctx, transactionsModule.buildAndSignTransaction),
            send: bind(ctx, transactionsModule.sendTransaction),
            batchSend: bind(ctx, transactionsModule.batchSendTransactions),
            track: bind(ctx, streamingModule.trackTransaction),
        },
        helpers: {
            toSignature,
            toPubkey,
            toBlockHash,
            encodeSignature,
            decodeSignature,
            encodeAddress,
            decodeAddress,
            deriveProgramAddress,
        },
        keys: {
            generateKeyPair: keysModule.generateKeyPair,
            fromPrivateKey: keysModule.fromPrivateKey,
        },
        events: {
            get: bind(ctx, eventsModule.getEvent),
            stream: bind(ctx, streamingModule.streamEvents),
        },
        proofs: {
            generate: bind(ctx, proofsModule.generateStateProof),
        },
        version: {
            get: bind(ctx, versionModule.getVersion),
        },
    };
}
