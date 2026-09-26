import { it, expect, vi } from "vitest";
import { createRouterTransport } from "@connectrpc/connect";
import { QueryService } from "@thru/sdk/proto";
import { ChainClient, type AccountSource } from "./chain-client";
import { readPinnedAccounts } from "./pinned-accounts";
const address = new Uint8Array(32);
const account = (slot: bigint) =>
  ({
    address: { value: address },
    versionContext: { slot },
    meta: { dataSize: 1, flags: { isDeleted: false } },
    data: { data: new Uint8Array([1]) },
  }) as any;
it("pins every read and accepts unchanged older account versions at the cut", async () => {
  const requests: any[] = [];
  const source = {
    getAccount: async (req: any) => {
      requests.push(req);
      return account(2n);
    },
  };
  expect(await readPinnedAccounts(source, [address, address], 4n)).toHaveLength(
    2,
  );
  expect(requests.every((r) => r.versionContext.version.value === 4n)).toBe(
    true,
  );
});
it("never returns a partial cut after a read failure or future response", async () => {
  await expect(
    readPinnedAccounts({ getAccount: async () => account(5n) }, [address], 4n),
  ).rejects.toThrow("out-of-cut");
  await expect(
    readPinnedAccounts(
      {
        getAccount: async () => {
          throw new Error("missing");
        },
      },
      [address],
      4n,
    ),
  ).rejects.toThrow("missing");
});
it("enforces byte bounds and cancellation", async () => {
  await expect(
    readPinnedAccounts(
      { getAccount: async () => account(1n) },
      [address, address],
      4n,
      { maxBytes: 1 },
    ),
  ).rejects.toThrow("budget");
  const controller = new AbortController();
  controller.abort();
  await expect(
    readPinnedAccounts({ getAccount: async () => account(1n) }, [address], 4n, {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
});

it("cancels a stalled underlying RPC and does not wait for it", async () => {
  let transportAborted = false;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const transport = createRouterTransport(router => router.service(QueryService, {
    getAccount(_request, context) {
      started();
      return new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => {
        transportAborted = true;
        reject(context.signal.reason);
      }, { once: true }));
    },
  }));
  const controller = new AbortController();
  const task = readPinnedAccounts(new ChainClient({ transport }), [address], 4n, { signal: controller.signal });
  await ready;
  controller.abort(new Error('cancel requested'));
  await expect(task).rejects.toThrow('cancel requested');
  await vi.waitFor(() => expect(transportAborted).toBe(true));
});

it("aborts sibling reads on invalid data and schedules no further reads", async () => {
  const signals: AbortSignal[] = [];
  let calls = 0;
  const source: Pick<AccountSource, 'getAccount'> = {
    getAccount(_request, options) {
      signals.push(options!.signal!);
      if (++calls === 1) return Promise.resolve(account(5n));
      // Even a custom source that ignores cancellation cannot hold the caller.
      return new Promise(() => undefined);
    },
  };
  await expect(readPinnedAccounts(source, [address, address, address], 4n, { concurrency: 2 })).rejects.toThrow('out-of-cut');
  expect(calls).toBe(2);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid byte bound %s before calling the source', async maxBytes => {
  const getAccount = vi.fn(async () => account(1n));
  await expect(readPinnedAccounts({ getAccount }, [address], 4n, { maxBytes })).rejects.toThrow('bounds');
  expect(getAccount).not.toHaveBeenCalled();
});
