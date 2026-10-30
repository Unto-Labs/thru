import { it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { AccountSchema, QueryService } from "@thru/sdk/proto";
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
it("retries a slot the node has not made durable, then gives up", async () => {
  vi.useFakeTimers();
  try {
    const notDurable = new ConnectError(
      "slot 4 is above the durable cursor 3; retry once the slot is durable",
      Code.FailedPrecondition,
    );
    let calls = 0;
    const lagging = readPinnedAccounts({
      getAccount: async () => {
        if (++calls <= 2) throw notDurable;
        return account(2n);
      },
    }, [address], 4n);
    await vi.runAllTimersAsync();
    expect(await lagging).toHaveLength(1);
    expect(calls).toBe(3);

    calls = 0;
    const stuck = expect(readPinnedAccounts({
      getAccount: async () => {
        calls++;
        throw notDurable;
      },
    }, [address], 4n)).rejects.toThrow("above the durable cursor");
    await vi.runAllTimersAsync();
    await stuck;
    expect(calls).toBe(11);
  } finally {
    vi.useRealTimers();
  }
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
it("stops waiting and sends no further read when cancelled during a not-durable retry", async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const controller = new AbortController();
    const read = readPinnedAccounts({
      getAccount: async () => {
        calls++;
        throw new ConnectError("slot not durable", Code.FailedPrecondition);
      },
    }, [address], 4n, { signal: controller.signal });
    await vi.waitFor(() => expect(calls).toBe(1));
    controller.abort(new Error("shutdown"));
    await expect(read).rejects.toThrow("shutdown");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
it("keeps a standalone process alive while it waits to retry a slot that is not durable", async () => {
  // Vitest's own handles keep its process alive, so the reader runs in a child process with real timers.
  let requests = 0;
  const reply = toBinary(AccountSchema, create(AccountSchema, {
    address: { value: address }, versionContext: { slot: 2n },
    meta: { dataSize: 1, flags: { isDeleted: false } }, data: { data: new Uint8Array([1]) },
  }));
  const server = http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    stream.on("error", () => {});
    stream.resume();
    stream.on("end", () => {
      if (++requests <= 2) {
        stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": String(Code.FailedPrecondition), "grpc-message": "slot not durable" }, { endStream: true });
        return;
      }
      const frame = Buffer.alloc(5 + reply.length);
      frame.writeUInt32BE(reply.length, 1);
      frame.set(reply, 5);
      stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
      stream.end(frame);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const source = (name: string) => fileURLToPath(new URL(name, import.meta.url));
  const script = `
    const { ChainClient } = await import(${JSON.stringify(source("./chain-client.ts"))});
    const { readPinnedAccounts } = await import(${JSON.stringify(source("./pinned-accounts.ts"))});
    const accounts = await readPinnedAccounts(new ChainClient({ baseUrl: ${JSON.stringify(baseUrl)} }), [new Uint8Array(32)], 4n);
    console.log(accounts.length);`;
  try {
    const result = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = execFile(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], (_error, stdout) => resolve({ code: child.exitCode, stdout }));
    });
    expect({ ...result, requests }).toEqual({ code: 0, stdout: "1\n", requests: 3 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}, 20_000);
