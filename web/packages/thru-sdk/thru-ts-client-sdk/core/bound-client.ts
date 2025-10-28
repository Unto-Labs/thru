import type { ThruClientContext } from "./client";

import * as accountsModule from "../modules/accounts";
import * as blocksModule from "../modules/blocks";
import * as eventsModule from "../modules/events";
import * as heightModule from "../modules/height";
import {
    decodeAddress,
    decodeSignature,
    deriveProgramAddress,
    encodeAddress,
    encodeSignature,
    toBlockHash,
    toPubkey,
    toSignature,
    type DeriveProgramAddressOptions,
    type DeriveProgramAddressResult,
} from "../modules/helpers";
import * as proofsModule from "../modules/proofs";
import * as streamingModule from "../modules/streaming";
import * as transactionsModule from "../modules/transactions";
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
    getBlockHeight: BoundFunction<typeof heightModule.getBlockHeight>;
}

interface BoundAccounts {
    get: BoundFunction<typeof accountsModule.getAccount>;
    getRaw: BoundFunction<typeof accountsModule.getRawAccount>;
    listOwned: BoundFunction<typeof accountsModule.listOwnedAccounts>;
    create: BoundFunction<typeof accountsModule.createAccount>;
}

interface BoundTransactions {
    get: BoundFunction<typeof transactionsModule.getTransaction>;
    getRaw: BoundFunction<typeof transactionsModule.getRawTransaction>;
    getStatus: BoundFunction<typeof transactionsModule.getTransactionStatus>;
    build: BoundFunction<typeof transactionsModule.buildTransaction>;
    buildAndSign: BoundFunction<typeof transactionsModule.buildAndSignTransaction>;
    send: BoundFunction<typeof transactionsModule.sendTransaction>;
    track: BoundFunction<typeof streamingModule.trackTransaction>;
}

interface BoundEvents {
    get: BoundFunction<typeof eventsModule.getEvent>;
}

interface BoundProofs {
    generate: BoundFunction<typeof proofsModule.generateStateProof>;
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
    helpers: Helpers;
}

export function createBoundThruClient(ctx: ThruClientContext): Thru {
    return {
        ctx,
        blocks: {
            get: bind(ctx, blocksModule.getBlock),
            getRaw: bind(ctx, blocksModule.getRawBlock),
            list: bind(ctx, blocksModule.listBlocks),
            getBlockHeight: bind(ctx, heightModule.getBlockHeight),
        },
        accounts: {
            get: bind(ctx, accountsModule.getAccount),
            getRaw: bind(ctx, accountsModule.getRawAccount),
            listOwned: bind(ctx, accountsModule.listOwnedAccounts),
            create: bind(ctx, accountsModule.createAccount),
        },
        transactions: {
            get: bind(ctx, transactionsModule.getTransaction),
            getRaw: bind(ctx, transactionsModule.getRawTransaction),
            getStatus: bind(ctx, transactionsModule.getTransactionStatus),
            build: bind(ctx, transactionsModule.buildTransaction),
            buildAndSign: bind(ctx, transactionsModule.buildAndSignTransaction),
            send: bind(ctx, transactionsModule.sendTransaction),
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
        events: {
            get: bind(ctx, eventsModule.getEvent),
        },
        proofs: {
            generate: bind(ctx, proofsModule.generateStateProof),
        },
    };
}
