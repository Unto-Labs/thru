import type { ThruClientContext } from "../core/client";
import { AccountView, type VersionContext } from "@thru/proto";
import { Pubkey, type PubkeyInput } from "../domain/primitives";
import { getAccount } from "./accounts";
import { currentVersionContext } from "./consensus";
import { streamAccountUpdates } from "./streaming";

const DEFAULT_NONCE_WAIT_TIMEOUT_MS = 10_000;

export interface AccountNonceObserverOptions {
    versionContext?: VersionContext;
    signal?: AbortSignal;
}

export interface WaitForNonceOptions {
    timeoutMs?: number;
}

type NonceWaiter = {
    target: bigint;
    resolve: (nonce: bigint) => void;
    reject: (error: Error) => void;
    timeoutId?: ReturnType<typeof setTimeout>;
};

export class AccountNonceObserver {
    private readonly ctx: ThruClientContext;
    private readonly account: Pubkey;
    private readonly versionContext: VersionContext;
    private readonly abortController = new AbortController();
    private readonly waiters = new Set<NonceWaiter>();
    private latestNonce: bigint | undefined;
    private closed = false;
    private streamStarted = false;

    constructor(ctx: ThruClientContext, account: PubkeyInput, options: AccountNonceObserverOptions = {}) {
        this.ctx = ctx;
        this.account = Pubkey.from(account);
        this.versionContext = options.versionContext ?? currentVersionContext();

        options.signal?.addEventListener("abort", () => this.close(), { once: true });
    }

    getLatestNonce(): bigint | undefined {
        return this.latestNonce;
    }

    async refresh(): Promise<bigint | undefined> {
        const account = await getAccount(this.ctx, this.account, {
            view: AccountView.FULL,
            versionContext: this.versionContext,
        });
        this.observeNonce(account.meta?.nonce);
        return this.latestNonce;
    }

    start(): void {
        if (this.streamStarted || this.closed) {
            return;
        }

        this.streamStarted = true;
        void this.runStream();
    }

    async waitForNonceAtLeast(target: bigint, options: WaitForNonceOptions = {}): Promise<bigint> {
        if (this.closed) {
            throw new Error("AccountNonceObserver is closed");
        }

        if (this.latestNonce === undefined || this.latestNonce < target) {
            this.start();
            await this.refresh();
        }

        if (this.closed) {
            throw new Error("AccountNonceObserver is closed");
        }

        if (this.latestNonce !== undefined && this.latestNonce >= target) {
            return this.latestNonce;
        }

        return new Promise<bigint>((resolve, reject) => {
            const timeoutMs = options.timeoutMs ?? DEFAULT_NONCE_WAIT_TIMEOUT_MS;
            const waiter: NonceWaiter = {
                target,
                resolve,
                reject,
            };

            waiter.timeoutId = setTimeout(() => {
                this.waiters.delete(waiter);
                reject(new Error(`Timed out waiting for nonce >= ${target.toString()} after ${timeoutMs}ms`));
            }, timeoutMs);

            this.waiters.add(waiter);
        });
    }

    close(): void {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.abortController.abort();
        for (const waiter of this.waiters) {
            if (waiter.timeoutId) {
                clearTimeout(waiter.timeoutId);
            }
            waiter.reject(new Error("AccountNonceObserver closed"));
        }
        this.waiters.clear();
    }

    private async runStream(): Promise<void> {
        try {
            for await (const { update } of streamAccountUpdates(this.ctx, this.account, {
                view: AccountView.FULL,
                signal: this.abortController.signal,
            })) {
                if (this.closed) {
                    return;
                }

                if (update.kind === "snapshot") {
                    this.observeNonce(update.snapshot.account.meta?.nonce);
                    continue;
                }

                this.observeNonce(update.update.meta?.nonce);
            }
        } catch (error) {
            if (!this.closed) {
                this.rejectWaiters(error instanceof Error ? error : new Error(String(error)));
            }
        } finally {
            this.streamStarted = false;
            if (!this.closed) {
                this.rejectWaiters(new Error("Account nonce stream ended unexpectedly"));
            }
        }
    }

    private observeNonce(nonce: bigint | undefined): void {
        if (nonce === undefined) {
            return;
        }

        if (this.latestNonce === undefined || nonce > this.latestNonce) {
            this.latestNonce = nonce;
        }

        this.resolveReadyWaiters();
    }

    private resolveReadyWaiters(): void {
        if (this.latestNonce === undefined) {
            return;
        }

        for (const waiter of Array.from(this.waiters)) {
            if (this.latestNonce < waiter.target) {
                continue;
            }

            this.waiters.delete(waiter);
            if (waiter.timeoutId) {
                clearTimeout(waiter.timeoutId);
            }
            waiter.resolve(this.latestNonce);
        }
    }

    private rejectWaiters(error: Error): void {
        for (const waiter of this.waiters) {
            if (waiter.timeoutId) {
                clearTimeout(waiter.timeoutId);
            }
            waiter.reject(error);
        }
        this.waiters.clear();
    }
}

export interface FeePayerNonceAllocation {
    baseNonce: bigint;
    nonces: bigint[];
    barrierNonce: bigint;
}

export interface FeePayerNonceManagerOptions {
    observer?: AccountNonceObserver;
}

export class FeePayerNonceManager {
    readonly observer: AccountNonceObserver;
    private allocationQueue: Promise<void> = Promise.resolve();
    private nextNonce: bigint | undefined;

    constructor(ctx: ThruClientContext, feePayer: PubkeyInput, options: FeePayerNonceManagerOptions = {}) {
        this.observer = options.observer ?? new AccountNonceObserver(ctx, feePayer);
    }

    async allocate(count: number): Promise<FeePayerNonceAllocation> {
        return this.withAllocationLock(() => this.allocateUnsafe(count));
    }

    reset(nextNonce?: bigint): void {
        this.nextNonce = nextNonce;
    }

    async sync(): Promise<bigint> {
        const latestNonce = await this.observer.refresh();
        if (latestNonce === undefined) {
            throw new Error("Unable to read fee payer nonce");
        }

        this.nextNonce = latestNonce;
        return latestNonce;
    }

    async waitForNonceAtLeast(target: bigint, options?: WaitForNonceOptions): Promise<bigint> {
        const nonce = await this.observer.waitForNonceAtLeast(target, options);
        if (this.nextNonce === undefined || nonce > this.nextNonce) {
            this.nextNonce = nonce;
        }
        return nonce;
    }

    close(): void {
        this.observer.close();
    }

    private async allocateUnsafe(count: number): Promise<FeePayerNonceAllocation> {
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error("Nonce allocation count must be a positive integer");
        }

        const latestNonce = await this.observer.refresh();
        if (latestNonce === undefined) {
            throw new Error("Unable to read fee payer nonce");
        }

        const baseNonce = this.nextNonce === undefined || latestNonce > this.nextNonce
            ? latestNonce
            : this.nextNonce;
        const barrierNonce = baseNonce + BigInt(count);
        const nonces = Array.from({ length: count }, (_, index) => baseNonce + BigInt(index));
        this.nextNonce = barrierNonce;

        return {
            baseNonce,
            nonces,
            barrierNonce,
        };
    }

    private async withAllocationLock<T>(work: () => Promise<T>): Promise<T> {
        const previous = this.allocationQueue;
        let release!: () => void;
        this.allocationQueue = new Promise<void>((resolve) => {
            release = resolve;
        });

        await previous;

        try {
            return await work();
        } finally {
            release();
        }
    }
}
