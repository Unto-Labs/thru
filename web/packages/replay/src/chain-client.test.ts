import { createRouterTransport } from "@connectrpc/connect";
import { QueryService } from "@thru/sdk/proto";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { ChainClient } from "./chain-client";

/* A ListEvents server that records each call's deadline as the transport
   delivered it, then holds the call until it is cancelled. */
function heldListEvents() {
  const calls: Array<{ timeoutMs: number | undefined; cancelled: Promise<void> }> = [];
  const transport = createRouterTransport((router) =>
    router.service(QueryService, {
      listEvents(_request, context) {
        let markCancelled!: () => void;
        const cancelled = new Promise<void>((resolve) => {
          markCancelled = resolve;
        });
        calls.push({ timeoutMs: context.timeoutMs(), cancelled });
        return new Promise((_resolve, reject) =>
          context.signal.addEventListener(
            "abort",
            () => {
              markCancelled();
              reject(context.signal.reason);
            },
            { once: true },
          ),
        );
      },
    }),
  );
  return { transport, calls };
}

describe("ChainClient.listEvents call options", () => {
  it("cancels the call on the server when the per-call signal aborts", async () => {
    const { transport, calls } = heldListEvents();
    const client = new ChainClient({ transport });
    const call = new AbortController();

    const pending = client.listEvents({}, { signal: call.signal });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    call.abort(new Error("recovery deadline"));

    await expect(pending).rejects.toThrow();
    await calls[0]!.cancelled;
  });

  it("still honours the client's default signal when a per-call signal is given", async () => {
    const { transport, calls } = heldListEvents();
    const clientDefault = new AbortController();
    const client = new ChainClient({ transport, callOptions: { signal: clientDefault.signal } });

    const pending = client.listEvents({}, { signal: new AbortController().signal });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    clientDefault.abort(new Error("client closing"));

    await expect(pending).rejects.toThrow();
    await calls[0]!.cancelled;
  });

  it("sends the client's default timeout, and a per-call timeout overrides it", async () => {
    const { transport, calls } = heldListEvents();
    const client = new ChainClient({ transport, callOptions: { timeoutMs: 60_000 } });
    const stop = new AbortController();

    const byDefault = client.listEvents({}, { signal: stop.signal });
    const overridden = client.listEvents({}, { signal: stop.signal, timeoutMs: 5_000 });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    stop.abort();
    await Promise.allSettled([byDefault, overridden]);

    /* The server sees the time remaining, a little under what was sent. */
    const [first, second] = calls.map((call) => call.timeoutMs);
    expect(first).toBeGreaterThan(55_000);
    expect(first).toBeLessThanOrEqual(60_000);
    expect(second).toBeGreaterThan(1_000);
    expect(second).toBeLessThanOrEqual(5_000);
  });
});

describe("ChainClient keepalive", () => {
  /* connectrpc/connect-es#1795: a destroyed session stops its keepalive timer
     only on a later tick, so a ping due in between ran against it and threw
     out of the timer, exiting the process. A server draining the connection
     with GOAWAY while a stream is open is one way into that window. */
  it("does not ping a session that close() destroyed while the server drained it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sessions = new Set<http2.ServerHttp2Session>();
    const server = http2.createServer();
    server.on("session", (session) => {
      sessions.add(session);
      session.on("error", () => {});
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200, "content-type": "application/grpc" });
      stream.session!.goaway(http2.constants.NGHTTP2_NO_ERROR, stream.id);
      stream.write(Buffer.alloc(5)); // one empty StreamEventsResponse
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const client = new ChainClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    try {
      const events = client.streamEvents({})[Symbol.asyncIterator]();
      await events.next(); // the GOAWAY arrived ahead of this message
      client.close();

      expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
    } finally {
      vi.useRealTimers();
      for (const session of sessions) session.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
