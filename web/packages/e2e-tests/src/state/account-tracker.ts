import { deferred } from "../utils/timing";

// We use 'any' for SDK types to avoid tight coupling to thru-sdk internals
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThruSdk = any;

/**
 * AccountState represents the cached state of an account
 */
export interface AccountState {
  nonce: bigint;
  balance: bigint;
  dataSize: bigint;
  lastUpdateSlot: bigint;
}

/**
 * AccountUpdate represents an update to an account state
 */
export interface AccountUpdate {
  nonce: bigint;
  balance: bigint;
  dataSize: bigint;
  slot: bigint;
}

interface AccountSubscription {
  state: AccountState;
  controller: AbortController;
  updateCallbacks: Array<(update: AccountUpdate) => void>;
}

/**
 * AccountStateTracker manages streaming subscriptions for account updates
 * and provides async methods to wait for state changes.
 */
export class AccountStateTracker {
  private sdk: ThruSdk;
  private chainId: number;

  private accounts = new Map<string, AccountSubscription>();
  private heightFinalized = 0n;
  private heightLocallyExecuted = 0n;
  private heightClusterExecuted = 0n;
  private heightController: AbortController | null = null;
  private heightCallbacks: Array<() => void> = [];

  constructor(sdk: ThruSdk, chainId: number) {
    this.sdk = sdk;
    this.chainId = chainId;
  }

  /**
   * Initialize the height tracking subscription
   */
  async setup(): Promise<void> {
    // Fetch initial height
    const height = await this.sdk.blocks.getBlockHeight();
    this.heightFinalized = height.finalized;
    this.heightLocallyExecuted = height.locallyExecuted;
    this.heightClusterExecuted = height.clusterExecuted;

    // Start height streaming in background
    this.heightController = new AbortController();
    this.runHeightStream(this.heightController.signal);
  }

  private async runHeightStream(signal: AbortSignal): Promise<void> {
    const streamStartedAt = Date.now();
    let messageCount = 0;
    console.error("[HeightStream] started at %s", new Date().toISOString());
    try {
      const iterable = this.sdk.blocks.streamHeight({ signal });
      for await (const { height } of iterable) {
        messageCount++;
        this.heightFinalized = height.finalized;
        this.heightLocallyExecuted = height.locallyExecuted;
        this.heightClusterExecuted = height.clusterExecuted;

        // Notify all waiters
        const callbacks = [...this.heightCallbacks];
        this.heightCallbacks = [];
        for (const cb of callbacks) {
          cb();
        }
      }
      // for-await exited normally (stream ended without error)
      console.error(
        "[HeightStream] ended normally after %d messages, %ds. Last heights: finalized=%s, executed=%s",
        messageCount,
        ((Date.now() - streamStartedAt) / 1000) | 0,
        this.heightFinalized,
        this.heightLocallyExecuted,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error(
          "[HeightStream] aborted (expected) after %d messages, %ds",
          messageCount,
          ((Date.now() - streamStartedAt) / 1000) | 0,
        );
      } else {
        console.error(
          "[HeightStream] died with error after %d messages, %ds. Last heights: finalized=%s, executed=%s. Error: %s %s",
          messageCount,
          ((Date.now() - streamStartedAt) / 1000) | 0,
          this.heightFinalized,
          this.heightLocallyExecuted,
          err instanceof Error ? `[${err.constructor.name}] ${err.message}` : String(err),
          err instanceof Error && err.cause ? `cause: ${err.cause}` : "",
        );
      }
    }
  }

  /**
   * Subscribe to account updates
   */
  async subscribeAccount(pubkey: string, force = false): Promise<void> {
    // Check if already subscribed
    if (this.accounts.has(pubkey)) {
      // Always refresh state from chain to get latest values
      const account = await this.sdk.accounts.get(pubkey);
      if (account) {
        const sub = this.accounts.get(pubkey)!;
        sub.state.nonce = account.meta?.nonce ?? 0n;
        sub.state.balance = account.meta?.balance ?? 0n;
        sub.state.dataSize = BigInt(account.meta?.dataSize ?? 0);
      }
      return;
    }

    // Fetch initial state
    let initialState: AccountState = {
      nonce: 0n,
      balance: 0n,
      dataSize: 0n,
      lastUpdateSlot: 0n,
    };

    try {
      const account = await this.sdk.accounts.get(pubkey);
      if (account) {
        initialState = {
          nonce: account.meta?.nonce ?? 0n,
          balance: account.meta?.balance ?? 0n,
          dataSize: BigInt(account.meta?.dataSize ?? 0),
          lastUpdateSlot: 0n,
        };
      }
    } catch (err) {
      if (!force) throw err;
    }

    // Create subscription entry
    const controller = new AbortController();
    const sub: AccountSubscription = {
      state: initialState,
      controller,
      updateCallbacks: [],
    };
    this.accounts.set(pubkey, sub);

    // Start streaming in background
    this.runAccountStream(pubkey, controller.signal);
  }

  private async runAccountStream(pubkey: string, signal: AbortSignal): Promise<void> {
    try {
      const iterable = this.sdk.accounts.stream(pubkey, { signal });
      for await (const { update } of iterable) {
        const sub = this.accounts.get(pubkey);
        if (!sub) break;

        let accountUpdate: AccountUpdate;

        if (update.kind === "snapshot") {
          // Initial snapshot - extract from account meta
          const account = update.snapshot.account;
          accountUpdate = {
            nonce: account.meta?.nonce ?? sub.state.nonce,
            balance: account.meta?.balance ?? sub.state.balance,
            dataSize: BigInt(account.meta?.dataSize ?? sub.state.dataSize),
            slot: account.versionContext?.slot ?? 0n,
          };
        } else if (update.kind === "update") {
          // Delta update
          const delta = update.update;
          accountUpdate = {
            nonce: delta.meta?.nonce ?? sub.state.nonce,
            balance: delta.meta?.balance ?? sub.state.balance,
            dataSize: BigInt(delta.meta?.dataSize ?? sub.state.dataSize),
            slot: delta.slot ?? 0n,
          };
        } else {
          continue;
        }

        sub.state = { ...accountUpdate, lastUpdateSlot: accountUpdate.slot };

        // Notify callbacks
        for (const cb of sub.updateCallbacks) {
          cb(accountUpdate);
        }
      }
    } catch (err) {
      // AbortError is expected when we cancel
      if (err instanceof Error && err.name !== "AbortError") {
        console.error(`Account stream error for ${pubkey}:`, err);
      }
    }
  }

  /**
   * Unsubscribe from account updates
   */
  unsubscribeAccount(pubkey: string): void {
    const sub = this.accounts.get(pubkey);
    if (sub) {
      sub.controller.abort();
      this.accounts.delete(pubkey);
    }
  }

  /**
   * Get cached nonce for an account
   */
  getNonce(pubkey: string): bigint {
    const sub = this.accounts.get(pubkey);
    if (!sub) throw new Error("Account not subscribed");
    return sub.state.nonce;
  }

  /**
   * Set cached nonce for an account
   */
  setNonce(pubkey: string, nonce: bigint): void {
    const sub = this.accounts.get(pubkey);
    if (sub && nonce > sub.state.nonce) {
      sub.state.nonce = nonce;
    }
  }

  /**
   * Get cached balance for an account
   */
  getBalance(pubkey: string): bigint {
    const sub = this.accounts.get(pubkey);
    if (!sub) throw new Error("Account not subscribed");
    return sub.state.balance;
  }

  /**
   * Get finalized height
   */
  getFinalizedHeight(): bigint {
    return this.heightFinalized;
  }

  /**
   * Get locally executed height
   */
  getLocalExecutedHeight(): bigint {
    return this.heightLocallyExecuted;
  }

  /**
   * Wait until heightFinalized equals heightLocallyExecuted
   */
  async waitForExecution(timeoutMs: number): Promise<void> {
    if (this.heightFinalized === this.heightLocallyExecuted) {
      return;
    }

    const deadline = Date.now() + timeoutMs;

    while (this.heightFinalized !== this.heightLocallyExecuted) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timeout waiting for execution sync (finalized: ${this.heightFinalized}, locally executed: ${this.heightLocallyExecuted})`
        );
      }

      // Wait for next height update
      await new Promise<void>((resolve) => {
        this.heightCallbacks.push(resolve);
        // Also set a timeout to check periodically
        setTimeout(resolve, 100);
      });
    }
  }

  /**
   * Wait for finalized height to reach a specific slot
   */
  async waitForFinalizedSlot(slot: bigint, timeoutMs: number): Promise<void> {
    if (this.heightFinalized >= slot) {
      return;
    }

    const deadline = Date.now() + timeoutMs;

    while (this.heightFinalized < slot) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timeout waiting for finalized slot ${slot} (current: ${this.heightFinalized})`
        );
      }

      await new Promise<void>((resolve) => {
        this.heightCallbacks.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  }

  /**
   * Wait for an account's balance to reach the expected value
   */
  async waitForBalanceChange(
    pubkey: string,
    expectedBalance: bigint,
    timeoutMs: number
  ): Promise<void> {
    const sub = this.accounts.get(pubkey);
    if (!sub) throw new Error("Account not subscribed");

    if (sub.state.balance === expectedBalance) {
      return;
    }

    const { promise, resolve, reject } = deferred<void>();

    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for balance change (current: ${sub.state.balance}, expected: ${expectedBalance})`
        )
      );
    }, timeoutMs);

    const callback = (update: AccountUpdate) => {
      if (update.balance === expectedBalance) {
        clearTimeout(timeoutId);
        // Remove callback
        const idx = sub.updateCallbacks.indexOf(callback);
        if (idx >= 0) sub.updateCallbacks.splice(idx, 1);
        resolve();
      }
    };

    sub.updateCallbacks.push(callback);

    return promise;
  }

  /**
   * Wait for an account's nonce to increment
   */
  async waitForNonceIncrement(pubkey: string, timeoutMs: number): Promise<void> {
    const sub = this.accounts.get(pubkey);
    if (!sub) throw new Error("Account not subscribed");

    const currentNonce = sub.state.nonce;

    const { promise, resolve, reject } = deferred<void>();

    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for nonce increment (current: ${sub.state.nonce}, initial: ${currentNonce})`
        )
      );
    }, timeoutMs);

    const callback = (update: AccountUpdate) => {
      if (update.nonce > currentNonce) {
        clearTimeout(timeoutId);
        const idx = sub.updateCallbacks.indexOf(callback);
        if (idx >= 0) sub.updateCallbacks.splice(idx, 1);
        resolve();
      }
    };

    sub.updateCallbacks.push(callback);

    return promise;
  }

  /**
   * Wait for any update on an account (useful for newly created accounts).
   * Resolves when the streaming receives any update for the account.
   */
  async waitForAccountUpdate(pubkey: string, timeoutMs: number): Promise<void> {
    const sub = this.accounts.get(pubkey);
    if (!sub) throw new Error("Account not subscribed");

    const { promise, resolve, reject } = deferred<void>();

    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for account update`));
    }, timeoutMs);

    const callback = () => {
      clearTimeout(timeoutId);
      const idx = sub.updateCallbacks.indexOf(callback);
      if (idx >= 0) sub.updateCallbacks.splice(idx, 1);
      resolve();
    };

    sub.updateCallbacks.push(callback);

    return promise;
  }

  /**
   * Wait for an account's data size to reach the expected value.
   * Useful for ephemeral accounts that are created with a specific size.
   */
  async waitForDataSizeChange(
    pubkey: string,
    expectedDataSize: bigint,
    timeoutMs: number
  ): Promise<void> {
    const sub = this.accounts.get(pubkey);
    if (!sub) throw new Error("Account not subscribed");

    if (sub.state.dataSize === expectedDataSize) {
      return;
    }

    const { promise, resolve, reject } = deferred<void>();

    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for data size change (current: ${sub.state.dataSize}, expected: ${expectedDataSize})`
        )
      );
    }, timeoutMs);

    const callback = (update: AccountUpdate) => {
      if (update.dataSize === expectedDataSize) {
        clearTimeout(timeoutId);
        const idx = sub.updateCallbacks.indexOf(callback);
        if (idx >= 0) sub.updateCallbacks.splice(idx, 1);
        resolve();
      }
    };

    sub.updateCallbacks.push(callback);

    return promise;
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    if (this.heightController) {
      this.heightController.abort();
      this.heightController = null;
    }

    for (const [, sub] of this.accounts) {
      sub.controller.abort();
    }
    this.accounts.clear();
  }
}
