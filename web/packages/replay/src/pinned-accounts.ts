import type { AccountSource } from "./chain-client";
import { AccountView, type Account } from "@thru/sdk/proto";
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
            const account = await source.getAccount({
              address: { value: addresses[i] } as any,
              view: AccountView.FULL,
              versionContext: { version: { case: "slot", value: slot } } as any,
            }, { signal });
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
function equal(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
