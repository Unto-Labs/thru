import { encodeSignature } from '@thru/sdk/helpers';
import { SubmissionStatus } from '@thru/sdk/proto';
import { TransactionFailedError, TransactionTimeoutError, signedUserErrorCode } from './errors';
import { errorMessage, sleep, type ThruClient } from './rpc';

/* Sending signed transactions and waiting for their execution: the fast
   confirm path (one sendAndTrack stream, a fallback status poll, never a
   second signature). */

interface ExecutionResultLike {
  vmError: number | bigint;
  userErrorCode: bigint;
}

/** Throws TransactionFailedError for a failed execution result. */
function checkExecution(label: string, signature: string, result: ExecutionResultLike): void {
  const vmError = Number(result.vmError);
  if (vmError === 0) return;
  throw new TransactionFailedError(label, signature, vmError, signedUserErrorCode(result.userErrorCode));
}

/** What sending needs of a client. */
export type PerpSendClient = Pick<ThruClient, 'transactions'>;

/* Most transactions execute within a couple of seconds of being sent, so
   the status is polled quickly at first and then every `delayMs`. */
const FAST_POLL_MS = 200;
const FAST_POLL_WINDOW_MS = 2_000;

/** transactions.send only means the RPC accepted the wire bytes; poll the
    execution status so callers see real success or a decoded failure.
    Gives up after `retries * delayMs` of waiting between polls. */
export async function waitForTransaction(
  sdk: PerpSendClient,
  signature: string,
  label: string,
  retries = 40,
  delayMs = 750,
  signal?: AbortSignal,
): Promise<void> {
  const budget = retries * delayMs;
  for (let waited = 0; ; ) {
    if (signal?.aborted) return;
    try {
      const status = await sdk.transactions.getStatus(signature);
      if (status?.executionResult) {
        checkExecution(label, signature, status.executionResult);
        return;
      }
    } catch (error) {
      if (error instanceof TransactionFailedError) throw error;
      /* Status not available yet: keep polling until the deadline. */
    }
    if (waited >= budget) break;
    const step = Math.min(waited < FAST_POLL_WINDOW_MS ? Math.min(FAST_POLL_MS, delayMs) : delayMs, budget - waited);
    await sleep(step);
    waited += step;
  }
  throw new TransactionTimeoutError(label, signature);
}

/** The signature of signed wire bytes: their last 64 bytes. */
export function wireSignature(raw: Uint8Array): string {
  if (raw.length < 64) throw new Error(`signed transaction too short (${raw.length} bytes)`);
  return encodeSignature(raw.subarray(raw.length - 64));
}

export interface SendAndConfirmOptions {
  /** Called once the node accepted the transaction. */
  onSubmitted?: (signature: string) => void;
  /** Overall deadline (default 30 s). */
  timeoutMs?: number;
  /** A status poll runs alongside the stream from this long after the send
      (default 1.5 s), in case the stream stalls behind a proxy. */
  fallbackDelayMs?: number;
  /** Interval of that poll (default 250 ms). */
  pollMs?: number;
}

const SEND_TIMEOUT_MS = 30_000;
const FALLBACK_DELAY_MS = 1_500;
const FALLBACK_POLL_MS = 250;

/** Sends signed wire bytes and resolves once they executed, throwing
    TransactionFailedError on a failed execution.

    One sendAndTrack stream replaces send + polling getStatus: the RPC
    subscribes to the signature before forwarding the transaction, so the
    execution result arrives as soon as the node publishes it (a
    trackTransaction opened after the send could miss it). A status poll
    starts alongside after `fallbackDelayMs` and takes over when the stream
    breaks.

    The bytes are never re-signed or changed here. The only resend is of the
    identical bytes, when the stream failed before the RPC acknowledged
    receipt (an RPC without sendAndTrack): the same signature and nonce can
    execute at most once, so it cannot place an order twice. */
export async function sendAndConfirm(sdk: PerpSendClient, raw: Uint8Array, label: string, options: SendAndConfirmOptions = {}): Promise<string> {
  const signature = wireSignature(raw);
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  const pollMs = options.pollMs ?? FALLBACK_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const stop = new AbortController();
  let submitted = false;
  const markSubmitted = () => {
    if (submitted) return;
    submitted = true;
    options.onSubmitted?.(signature);
  };
  const poll = async (delayMs: number): Promise<void> => {
    if (delayMs > 0) await sleep(delayMs);
    if (stop.signal.aborted) return;
    const retries = Math.max(1, Math.ceil((deadline - Date.now()) / pollMs));
    await waitForTransaction(sdk, signature, label, retries, pollMs, stop.signal);
  };

  const stream = async (): Promise<void> => {
    let received = false;
    try {
      for await (const update of sdk.transactions.sendAndTrack(raw, { timeoutMs, signal: stop.signal })) {
        received = true;
        if (update.status === SubmissionStatus.ACCEPTED) markSubmitted();
        if (update.executionResult) {
          markSubmitted();
          checkExecution(label, signature, update.executionResult);
          return;
        }
      }
    } catch (error) {
      if (error instanceof TransactionFailedError || stop.signal.aborted) throw error;
      if (!received) {
        /* Nothing reached the node through the stream (or we cannot tell):
           send the same bytes the plain way and poll. */
        await sdk.transactions.send(raw);
        markSubmitted();
        return poll(0);
      }
      if (!submitted && /transaction rejected|invalid transaction/i.test(errorMessage(error))) throw error;
    }
    /* Accepted (or possibly accepted) but the stream ended without a
       result: poll the status until the deadline. */
    markSubmitted();
    return poll(0);
  };

  const fallback = (async () => {
    await sleep(options.fallbackDelayMs ?? FALLBACK_DELAY_MS);
    if (stop.signal.aborted || !submitted) return new Promise<void>(() => {});
    return poll(0);
  })();

  try {
    await Promise.race([stream(), fallback]);
  } finally {
    stop.abort();
  }
  return signature;
}
