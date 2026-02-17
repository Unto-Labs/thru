/**
 * Execute a function with a timeout.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  message = "Operation timed out"
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${message} (after ${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Poll a condition until it returns true or timeout.
 */
export async function pollUntil(
  condition: () => Promise<boolean> | boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    message?: string;
  } = {}
): Promise<void> {
  const { timeoutMs = 30000, intervalMs = 100, message = "Condition not met" } = options;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`${message} (timeout after ${timeoutMs}ms)`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll for a transaction status until it's available in the indexer.
 * Use this ONLY when testing the GetTransactionStatus RPC itself.
 */
export async function pollForTransactionStatus(
  sdk: { transactions: { getStatus: (sig: string) => Promise<unknown> } },
  signature: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
): Promise<unknown> {
  const { timeoutMs = 30000, intervalMs = 200 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const status = await sdk.transactions.getStatus(signature);
      if (status) return status;
    } catch (err) {
      const errorMsg = (err as Error).message || String(err);
      if (!errorMsg.includes("not_found") && !errorMsg.includes("not found")) {
        throw err;
      }
    }
    await sleep(intervalMs);
  }

  throw new Error(`Transaction status ${signature} not found after ${timeoutMs}ms`);
}

/**
 * Poll for a transaction until it's available in the indexer.
 * Use this ONLY when testing the GetTransaction RPC itself.
 */
export async function pollForTransaction(
  sdk: { transactions: { get: (sig: string) => Promise<unknown> } },
  signature: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
): Promise<unknown> {
  const { timeoutMs = 30000, intervalMs = 200 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const tx = await sdk.transactions.get(signature);
      if (tx) return tx;
    } catch (err) {
      const errorMsg = (err as Error).message || String(err);
      if (!errorMsg.includes("not_found") && !errorMsg.includes("not found")) {
        throw err;
      }
    }
    await sleep(intervalMs);
  }

  throw new Error(`Transaction ${signature} not found after ${timeoutMs}ms`);
}

/**
 * Transaction status from TrackTransaction stream.
 */
export interface TrackedTransactionStatus {
  statusCode?: number;
  executionResult?: {
    vmError?: number;
    consumedComputeUnits?: number;
  };
}

/**
 * Track a transaction until it reaches finalized status.
 * Uses TrackTransaction streaming instead of polling.
 *
 * IMPORTANT: Call this BEFORE sending the transaction, then await after sending.
 *
 * Usage:
 *   const trackPromise = trackTransactionUntilFinalized(ctx.sdk, tx.signature.toThruFmt());
 *   await ctx.blockSender.sendAsBlock([tx.rawTransaction]);
 *   const status = await trackPromise;
 */
export async function trackTransactionUntilFinalized(
  sdk: { transactions: { track: (sig: string, opts?: { timeoutMs?: number }) => AsyncIterable<TrackedTransactionStatus> } },
  signature: string,
  options: {
    timeoutMs?: number;
  } = {}
): Promise<TrackedTransactionStatus> {
  const { timeoutMs = 60000 } = options;

  // ConsensusStatus values from proto (thru.common.v1.ConsensusStatus)
  const FINALIZED = 3;
  const CLUSTER_EXECUTED = 5;

  let lastUpdate: TrackedTransactionStatus | null = null;

  try {
    for await (const update of sdk.transactions.track(signature, { timeoutMs })) {
      lastUpdate = update;

      // Stop when FINALIZED or CLUSTER_EXECUTED - both indicate the transaction is complete
      if (update.statusCode === FINALIZED || update.statusCode === CLUSTER_EXECUTED) {
        return update;
      }
    }
  } catch (err) {
    // If we got updates before timeout, return the last one
    if (lastUpdate && (err as Error).name === "AbortError") {
      return lastUpdate;
    }
    throw err;
  }

  if (lastUpdate) {
    return lastUpdate;
  }

  throw new Error(`Transaction ${signature} tracking timed out after ${timeoutMs}ms`);
}

/**
 * Create a deferred promise that can be resolved/rejected externally.
 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Advance the blockchain by sending dummy transfer transactions.
 * Used to reach a minimum slot number before running certain program tests.
 */
export async function advanceSlots(
  sdk: {
    blocks: { getBlockHeight: () => Promise<{ finalized: bigint }> };
    accounts: { get: (addr: string) => Promise<{ meta?: { nonce?: bigint } } | null> };
    transactions: {
      buildAndSign: (params: unknown) => Promise<{ rawTransaction: Uint8Array; signature: { toThruFmt: () => string } }>;
      track: (sig: string, opts?: { timeoutMs?: number }) => AsyncIterable<TrackedTransactionStatus>;
    };
  },
  blockSender: { sendAsBlock: (txs: Uint8Array[]) => Promise<unknown> },
  feePayer: { publicKey: Uint8Array; publicKeyString: string; seed: Uint8Array },
  recipient: { publicKey: Uint8Array },
  numSlots: bigint,
  chainId: number,
  logFn?: (msg: string, ...args: unknown[]) => void
): Promise<void> {
  const EOA_PROGRAM = new Uint8Array(32);

  const feePayerAcct = await sdk.accounts.get(feePayer.publicKeyString);
  if (!feePayerAcct) {
    throw new Error("Failed to get fee payer account");
  }
  let nonce = feePayerAcct.meta?.nonce ?? 0n;

  const initialHeight = await sdk.blocks.getBlockHeight();
  const baseSlot = initialHeight.finalized;
  let lastSig = "";

  for (let i = 0n; i < numSlots; i++) {
    const startSlot = baseSlot + 1n;

    const transferData = new Uint8Array(16);
    const view = new DataView(transferData.buffer);
    view.setUint32(0, 1, true);
    view.setBigUint64(4, 1n, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 2, true);

    const tx = await sdk.transactions.buildAndSign({
      feePayer: {
        publicKey: feePayer.publicKey,
        privateKey: feePayer.seed,
      },
      program: EOA_PROGRAM,
      header: {
        fee: 1n,
        nonce: nonce,
        startSlot: startSlot,
        expiryAfter: 1_000_000,
        computeUnits: 1_000_000,
        stateUnits: 10_000,
        memoryUnits: 10_000,
        chainId: chainId,
      },
      accounts: {
        readWrite: [recipient.publicKey],
      },
      instructionData: transferData,
    });

    await blockSender.sendAsBlock([tx.rawTransaction]);
    lastSig = tx.signature.toThruFmt();
    nonce++;

    if (logFn && (i + 1n) % 32n === 0n) {
      logFn("Submitted %d/%d dumb fill blocks", i + 1n, numSlots);
    }
  }

  if (lastSig) {
    await trackTransactionUntilFinalized(sdk, lastSig);
  }
}
