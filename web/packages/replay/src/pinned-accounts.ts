import { Code, ConnectError } from "@connectrpc/connect";
import type { AccountSource } from "./chain-client";
import { AccountView, type Account } from "@thru/sdk/proto";
import { abortableDelay } from "./retry";
/* About 5 s: a node's durable cursor trails finalized by a few slots. */
const NOT_DURABLE_RETRIES = 10;
const NOT_DURABLE_DELAY_MS = 500;
/** A bounded alternative to owner enumeration. No inference about catalog completeness
 * or finality is made. The caller selects an execution-complete historical cut. */
export async function readPinnedAccounts(
  source: Pick<AccountSource, "getAccount">,
  addresses: Uint8Array[],
  slot: bigint,
  options: {
    concurrency?: number;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<Account[]> {
  const concurrency = options.concurrency ?? 4,
    maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 16 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    addresses.length > 1024
  )
    throw new Error("Invalid pinned read bounds");
  const output = new Array<Account>(addresses.length);
  let next = 0,
    bytes = 0;
  const controller = new AbortController();
  const signal = controller.signal;
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.throwIfAborted();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([aborted, Promise.all(
      Array.from(
        { length: Math.min(concurrency, addresses.length) },
        async () => {
          while (next < addresses.length) {
            signal.throwIfAborted();
            const i = next++;
            const account = await getAccountAtSlot(source, addresses[i], slot, signal);
            signal.throwIfAborted();
            const version =
              account.versionContext?.slot ?? account.meta?.lastUpdatedSlot;
            if (
              version === undefined ||
              version > slot ||
              !account.meta ||
              !account.data?.data ||
              account.data.compressed ||
              account.meta.flags?.isDeleted
            )
              throw new Error("Incomplete or out-of-cut pinned account");
            if (account.data.data.length !== account.meta.dataSize)
              throw new Error("Pinned account size mismatch");
            if (!account.address || !equal(account.address.value, addresses[i]))
              throw new Error("Pinned account address mismatch");
            bytes += account.data.data.byteLength;
            if (bytes > maxBytes)
              throw new Error("Pinned account byte budget exceeded");
            output[i] = account;
          }
        },
      ),
    )]);
    return output;
  } catch (error) {
    // Stop sibling RPCs on the first invalid cut, not after they all finish.
    controller.abort(error);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", forwardAbort);
    signal.removeEventListener("abort", onAbort);
  }
}
/* A node refuses a slot above its durable cursor with FailedPrecondition until it
   commits that slot, so a cut near the head retries instead of failing. */
async function getAccountAtSlot(
  source: Pick<AccountSource, "getAccount">,
  address: Uint8Array,
  slot: bigint,
  signal: AbortSignal,
): Promise<Account> {
  for (let retries = 0; ; retries++) {
    try {
      return await source.getAccount({
        address: { value: address } as any,
        view: AccountView.FULL,
        versionContext: { version: { case: "slot", value: slot } } as any,
      }, { signal });
    } catch (error) {
      if (
        retries >= NOT_DURABLE_RETRIES ||
        !(error instanceof ConnectError && error.code === Code.FailedPrecondition)
      )
        throw error;
      await abortableDelay(NOT_DURABLE_DELAY_MS, signal, { keepAlive: true });
      signal.throwIfAborted();
    }
  }
}
function equal(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
