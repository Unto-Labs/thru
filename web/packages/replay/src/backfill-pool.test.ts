import { createHash } from "node:crypto";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AccountStateFilter,
  AccountView,
  BatchGetRawAccountsResponseSchema,
  FilterSchema,
  ListAccountsResponseSchema,
  type BatchGetRawAccountsRequestSchema,
  type BatchGetRawAccountsResponse,
  type ListAccountsRequestSchema,
  type ListAccountsResponse,
} from "@thru/sdk/proto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAllAccounts, type BackfillPoolFailure, type BackfillPoolOptions } from "./backfill-pool";
import type { AccountSource } from "./chain-client";
import { NOOP_LOGGER } from "./logger";

const OWNER = new Uint8Array(32).fill(7);
const FILTER = create(FilterSchema, { expression: "account.meta.owner.value == params.owner_bytes" });
const SCAN_BUDGET = 1_024;
const META = (() => {
  const bytes = new Uint8Array(64);
  new DataView(bytes.buffer).setUint16(0, 0xc7a3, true);
  bytes.set(OWNER, 16);
  return bytes;
})();

const hex = (address: Uint8Array) => Buffer.from(address).toString("hex");
const sorted = (addresses: Uint8Array[]) => addresses.map(hex).sort();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hashed = (seed: string) => new Uint8Array(createHash("sha256").update(seed).digest());
const withPrefix = (prefix: number[], seed: string) => {
  const address = hashed(seed);
  address.set(prefix);
  return address;
};
const at = (first: number) => {
  const address = new Uint8Array(32);
  address[0] = first;
  return address;
};
const justBefore = (first: number) => {
  const address = new Uint8Array(32).fill(0xff);
  address[0] = first - 1;
  return address;
};

interface FakeClient extends AccountSource {
  readonly name: string;
  closed: boolean;
  readonly cancels: Array<() => void>;
  close(): void;
}

type ListRequest = MessageInitShape<typeof ListAccountsRequestSchema>;
type ReadRequest = MessageInitShape<typeof BatchGetRawAccountsRequestSchema>;

/* Serves an owner filter the way the node does. A scan resumes strictly after
   the token address and stops at a full page or SCAN_BUDGET candidates. */
class FakeNode {
  readonly candidates: Array<{ address: Uint8Array; listed: boolean; compressed: boolean }>;
  readonly clients: FakeClient[] = [];
  readonly lists: string[] = [];
  readonly states: AccountStateFilter[] = [];
  readonly reads: number[] = [];
  readonly issued = new Set<string>();
  /* A node that authenticates its tokens refuses one the client spliced. */
  authenticTokensOnly = false;
  /* A node older than #4951 ignores `state` and lists live accounts only. */
  ignoresState = false;
  readBudget = Infinity;
  readDelayMs = 0;
  stallPooled?: "until-close" | "forever";
  listFault?: (client: FakeClient, call: number) => ConnectError | undefined;
  readFault?: (client: FakeClient, addresses: Uint8Array[]) => ConnectError | undefined;
  private listing = 0;

  constructor(
    listed: Uint8Array[],
    rejected: Uint8Array[] = [],
    compressed: Uint8Array[] = [],
    compressedRejected: Uint8Array[] = [],
  ) {
    this.candidates = [
      ...listed.map((address) => ({ address, listed: true, compressed: false })),
      ...rejected.map((address) => ({ address, listed: false, compressed: false })),
      ...compressed.map((address) => ({ address, listed: true, compressed: true })),
      ...compressedRejected.map((address) => ({ address, listed: false, compressed: true })),
    ].sort((a, b) => Buffer.compare(a.address, b.address));
  }

  /* Listings as `${client} ${state}`, in call order. */
  get listings(): string[] {
    return this.lists.map((name, i) => `${name} ${AccountStateFilter[this.states[i]]}`);
  }

  get calls(): number {
    return this.lists.length + this.reads.length;
  }

  client(name: string): FakeClient {
    const client: FakeClient = {
      name,
      closed: false,
      cancels: [],
      close: () => {
        client.closed = true;
        for (const cancel of client.cancels) cancel();
      },
      listAccounts: (request) => this.listAccounts(client, request),
      batchGetRawAccounts: (request) => this.batchGetRawAccounts(client, request),
      getAccount: () => Promise.reject(new Error("unused")),
      streamAccountUpdates: () => {
        throw new Error("unused");
      },
    };
    this.clients.push(client);
    return client;
  }

  private stall(client: FakeClient): Promise<never> {
    return new Promise((_, reject) => {
      if (this.stallPooled === "until-close") {
        client.cancels.push(() => reject(new ConnectError("connection aborted", Code.Canceled)));
      }
    });
  }

  private async listAccounts(client: FakeClient, request: ListRequest): Promise<ListAccountsResponse> {
    this.lists.push(client.name);
    const requested = request.state ?? AccountStateFilter.UNSPECIFIED;
    this.states.push(requested);
    const fault = this.listFault?.(client, this.lists.length);
    if (fault) throw fault;
    if (client.name !== "primary" && this.stallPooled) return this.stall(client);
    const state = this.ignoresState
      ? AccountStateFilter.LIVE
      : requested === AccountStateFilter.UNSPECIFIED ? AccountStateFilter.ALL : requested;
    const after = this.cursor(request.page?.pageToken, state);
    /* #4951: two listings in flight per node unless the request is LIVE. */
    const admitted = state !== AccountStateFilter.LIVE;
    if (admitted && this.listing >= 2) {
      throw new ConnectError("account listing capacity exhausted; retry later", Code.ResourceExhausted);
    }
    if (admitted) this.listing++;
    try {
      await Promise.resolve();
      return this.scan(after, Math.min(request.page?.pageSize || 100, 1_000), state, request.view === AccountView.META_ONLY);
    } finally {
      if (admitted) this.listing--;
    }
  }

  private scan(after: Uint8Array | undefined, limit: number, state: AccountStateFilter, withMeta: boolean): ListAccountsResponse {
    /* Live and compressed accounts sit in separate stores; ALL merges them. */
    const store = this.candidates.filter((c) =>
      state === AccountStateFilter.ALL || c.compressed === (state === AccountStateFilter.COMPRESSED));
    let i = after ? store.findIndex((c) => Buffer.compare(c.address, after) > 0) : 0;
    if (i < 0) i = store.length;
    const accounts: Array<{ address: Uint8Array; compressed: boolean }> = [];
    let last: Uint8Array = new Uint8Array(32);
    for (let scanned = 1; i < store.length; scanned++) {
      const candidate = store[i++];
      last = candidate.address;
      if (candidate.listed) accounts.push(candidate);
      if (accounts.length === limit || scanned === SCAN_BUDGET) break;
    }
    const hasMore = i < store.length;
    return create(ListAccountsResponseSchema, {
      accounts: accounts.map(({ address: value, compressed }) => ({
        address: { value },
        ...(withMeta ? { meta: { flags: { isCompressed: compressed } } } : {}),
      })),
      page: hasMore ? { nextPageToken: this.token(last, state) } : after ? {} : undefined,
    });
  }

  private token(address: Uint8Array, state: AccountStateFilter): string {
    const bytes = new Uint8Array(98);
    /* #4951 moved page tokens to version 2. */
    bytes[0] = this.ignoresState ? 1 : 2;
    bytes[1] = 1;
    bytes.set(OWNER, 2);
    bytes.set(address, 34);
    bytes.fill(state, 66);
    const token = Buffer.from(bytes).toString("base64url");
    this.issued.add(token);
    return token;
  }

  private cursor(token: string | undefined, state: AccountStateFilter): Uint8Array | undefined {
    if (!token) return undefined;
    const bytes = Buffer.from(token, "base64url");
    const valid =
      bytes.length === 98 &&
      bytes[0] === (this.ignoresState ? 1 : 2) &&
      bytes[1] === 1 &&
      Buffer.compare(bytes.subarray(2, 34), OWNER) === 0 &&
      bytes.subarray(66).every((byte) => byte === state) &&
      (!this.authenticTokensOnly || this.issued.has(token));
    if (!valid) throw new ConnectError("invalid or mismatched account page token", Code.InvalidArgument);
    return new Uint8Array(bytes.subarray(34, 66));
  }

  private async batchGetRawAccounts(client: FakeClient, request: ReadRequest): Promise<BatchGetRawAccountsResponse> {
    const addresses = (request.items ?? []).map((item) => item.address!.value!);
    this.reads.push(addresses.length);
    if (client.name !== "primary" && this.stallPooled) return this.stall(client);
    await (this.readDelayMs ? sleep(this.readDelayMs) : Promise.resolve());
    if (addresses.length > 1_000) throw new ConnectError("too many items", Code.InvalidArgument);
    if (addresses.length > this.readBudget) throw new ConnectError("response budget exceeded", Code.ResourceExhausted);
    const fault = this.readFault?.(client, addresses);
    if (fault) throw fault;
    return create(BatchGetRawAccountsResponseSchema, {
      accounts: Object.fromEntries(addresses.map((value) => [hex(value), { address: { value }, rawMeta: META }])),
    });
  }
}

/* 1,000 accounts under prefix 0000 fill the first page, so 8 partitions split the
   rest at 2000.., 4000.., ..., e000... The rejected run makes empty budget pages. */
function spreadAccounts() {
  const listed = [
    ...Array.from({ length: 1_000 }, (_, i) => withPrefix([0, 0], `first-${i}`)),
    ...Array.from({ length: 3_000 }, (_, i) => hashed(`spread-${i}`)),
    at(0x20),
    justBefore(0x20),
    at(0x80),
    justBefore(0x80),
    at(0xe0),
    new Uint8Array(32).fill(0xff),
  ];
  const rejected = Array.from({ length: 1_100 }, (_, i) => withPrefix([0x50, 0], `rejected-${i}`));
  return { listed, rejected };
}

function poolOptions(node: FakeNode, overrides: Partial<BackfillPoolOptions> = {}): BackfillPoolOptions {
  let pooled = 0;
  return {
    primary: node.client("primary"),
    clientFactory: () => node.client(`pooled-${++pooled}`),
    owner: OWNER,
    filter: FILTER,
    partitions: 8,
    readers: 8,
    maxRetries: 3,
    skip: () => false,
    logger: NOOP_LOGGER,
    ...overrides,
  };
}

async function listedBy(options: BackfillPoolOptions, failures: BackfillPoolFailure[] = []): Promise<string[]> {
  const listed: string[] = [];
  for await (const batch of readAllAccounts(options, failures)) {
    for (const account of batch) listed.push(hex(account.address!.value!));
  }
  return listed.sort();
}

async function withFakeClock<T>(run: Promise<T>): Promise<T> {
  let settled = false;
  void run.then(() => (settled = true), () => (settled = true));
  while (!settled) await vi.advanceTimersByTimeAsync(1_000);
  return run;
}

async function unhandledDuring(run: () => Promise<void>, settle = () => sleep(50)): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    await run();
    await settle();
  } finally {
    process.off("unhandledRejection", record);
  }
  return unhandled;
}

const openClients = (node: FakeNode) => node.clients.filter((client) => !client.closed).map((client) => client.name);

afterEach(() => {
  vi.useRealTimers();
});

describe("readAllAccounts listing", () => {
  it("lists every account exactly once across 8 partitions, including accounts on a partition boundary", async () => {
    const { listed: accounts, rejected } = spreadAccounts();
    const node = new FakeNode(accounts, rejected);

    expect(await listedBy(poolOptions(node))).toEqual(sorted(accounts));
    const partitionClients = node.listings.filter((l) => l.endsWith(" LIVE") && !l.startsWith("primary "));
    expect(new Set(partitionClients).size).toBe(8);
  });

  it("sends state LIVE on every listing, so the node never applies its two-listing admission", async () => {
    const { listed: accounts, rejected } = spreadAccounts();
    const node = new FakeNode(accounts, rejected);

    await listedBy(poolOptions(node));

    /* No compressed accounts: the one compressed walk is a single empty page. */
    expect(node.states.filter((state) => state !== AccountStateFilter.LIVE)).toEqual([AccountStateFilter.COMPRESSED]);
    expect(node.states.filter((state) => state === AccountStateFilter.LIVE).length).toBeGreaterThan(8);
  });

  it("lists sequentially with the same accounts when the node rejects a spliced page token", async () => {
    const { listed: accounts, rejected } = spreadAccounts();
    const node = new FakeNode(accounts, rejected);
    node.authenticTokensOnly = true;
    const warn = vi.fn();

    expect(await listedBy(poolOptions(node, { logger: { ...NOOP_LOGGER, warn } }))).toEqual(sorted(accounts));
    expect(node.listings.filter((l) => l.endsWith(" LIVE") && !l.startsWith("primary "))).toEqual([]);
    expect(warn).toHaveBeenCalledWith("Partitioned listing rejected; listing sequentially", {
      error: expect.objectContaining({ code: Code.InvalidArgument }),
    });
  });

  it("walks sequentially when the first page ends in the 0xffff prefix", async () => {
    const accounts = Array.from({ length: 1_010 }, (_, i) => withPrefix([0xff, 0xff], `top-${i}`));
    const node = new FakeNode(accounts);

    expect(await listedBy(poolOptions(node))).toEqual(sorted(accounts));
    expect(node.listings.filter((l) => l.endsWith(" LIVE"))).toEqual(["primary LIVE", "primary LIVE"]);
  });

  it("retries a listing the node refuses with ResourceExhausted", async () => {
    const accounts = Array.from({ length: 2_500 }, (_, i) => hashed(`retry-${i}`));
    const node = new FakeNode(accounts);
    node.listFault = (client) =>
      client.name === "primary" && node.lists.filter((name) => name === "primary").length === 2
        ? new ConnectError("account listing capacity exhausted; retry later", Code.ResourceExhausted)
        : undefined;

    expect(await listedBy(poolOptions(node, { partitions: 1 }))).toEqual(sorted(accounts));
    expect(node.listings.filter((l) => l.startsWith("primary "))).toEqual([
      "primary LIVE", "primary LIVE", "primary LIVE", "primary LIVE",
    ]);
  });
});

describe("readAllAccounts compressed accounts", () => {
  it("lists compressed accounts once in one sequential walk next to the LIVE partitions", async () => {
    const { listed: live, rejected } = spreadAccounts();
    const compressed = Array.from({ length: 1_200 }, (_, i) => hashed(`compressed-${i}`));
    const node = new FakeNode(live, rejected, compressed);

    const listed = await listedBy(poolOptions(node));

    expect(listed).toEqual(sorted([...live, ...compressed]));
    const walk = node.listings.filter((l) => l.endsWith(" COMPRESSED"));
    expect(walk).toEqual(["pooled-1 COMPRESSED", "pooled-1 COMPRESSED"]);
    expect(node.listings.filter((l) => !l.endsWith(" COMPRESSED") && !l.endsWith(" LIVE"))).toEqual([]);
  });

  it("ends the compressed walk after one call on a node that ignores the state filter", async () => {
    const { listed: live, rejected } = spreadAccounts();
    const compressed = Array.from({ length: 1_200 }, (_, i) => hashed(`compressed-${i}`));
    const node = new FakeNode(live, rejected, compressed);
    node.ignoresState = true;

    const listed = await listedBy(poolOptions(node));

    /* The old node never lists compressed accounts, and its live answer to the
       compressed walk is not listed twice. */
    expect(listed).toEqual(sorted(live));
    expect(node.listings.filter((l) => l.endsWith(" COMPRESSED"))).toEqual(["pooled-1 COMPRESSED"]);
  });

  it("keeps walking past a compressed page that matched nothing but has a continuation token", async () => {
    const live = Array.from({ length: 10 }, (_, i) => hashed(`live-${i}`));
    const skipped = Array.from({ length: 1_100 }, (_, i) => withPrefix([0, 1], `compressed-other-size-${i}`));
    const compressed = Array.from({ length: 50 }, (_, i) => withPrefix([0x90, i], `compressed-${i}`));
    const node = new FakeNode(live, [], compressed, skipped);

    const listed = await listedBy(poolOptions(node));

    expect(listed).toEqual(sorted([...live, ...compressed]));
    expect(node.listings.filter((l) => l.endsWith(" COMPRESSED"))).toEqual(["pooled-1 COMPRESSED", "pooled-1 COMPRESSED"]);
  });
});

describe("readAllAccounts compressed walk failures", () => {
  it("keeps the live backfill when the node refuses every compressed page", async () => {
    vi.useFakeTimers();
    const { listed: live, rejected } = spreadAccounts();
    const compressed = Array.from({ length: 1_200 }, (_, i) => hashed(`compressed-${i}`));
    const node = new FakeNode(live, rejected, compressed);
    node.listFault = () =>
      node.states.at(-1) === AccountStateFilter.COMPRESSED
        ? new ConnectError("account listing database budget exceeded", Code.ResourceExhausted)
        : undefined;
    const warn = vi.fn();

    const listed = await withFakeClock(listedBy(poolOptions(node, { logger: { ...NOOP_LOGGER, warn } })));

    expect(listed).toEqual(sorted(live));
    expect(node.listings.filter((l) => l.endsWith(" COMPRESSED"))).toEqual(Array(8).fill("pooled-1 COMPRESSED"));
    expect(warn).toHaveBeenCalledWith("Compressed account listing failed; continuing with live accounts", {
      error: expect.objectContaining({ code: Code.ResourceExhausted }),
    });
  });

  it("stops after one call when an old node's compressed answer is an empty page with a token", async () => {
    const live = Array.from({ length: 200 }, (_, i) => withPrefix([0x80], `live-${i}`));
    /* The first 1,100 live candidates fail the filter, so the first page is empty but continues. */
    const rejected = Array.from({ length: 1_100 }, (_, i) => withPrefix([0, 1], `other-size-${i}`));
    const node = new FakeNode(live, rejected);
    node.ignoresState = true;

    expect(await listedBy(poolOptions(node))).toEqual(sorted(live));
    expect(node.listings.filter((l) => l.endsWith(" COMPRESSED"))).toEqual(["pooled-1 COMPRESSED"]);
  });
});

describe("readAllAccounts reads", () => {
  it("splits a read the node refuses as over its response budget", async () => {
    const accounts = Array.from({ length: 2_500 }, (_, i) => hashed(`split-${i}`));
    const node = new FakeNode(accounts);
    node.readBudget = 250;
    const failures: BackfillPoolFailure[] = [];

    expect(await listedBy(poolOptions(node, { partitions: 1 }), failures)).toEqual(sorted(accounts));
    expect(failures).toEqual([]);
    expect(node.reads.sort((a, b) => b - a)).toEqual([
      1_000, 1_000, 500, 500, 500, 500, 500, 250, 250, 250, 250, 250, 250, 250, 250, 250, 250,
    ]);
  });

  it("reports a batch that still fails after its retries and yields the rest", async () => {
    vi.useFakeTimers();
    const accounts = Array.from({ length: 1_500 }, (_, i) => hashed(`fail-${i}`));
    const node = new FakeNode(accounts);
    /* The first page's 1,000 accounts are one batch; the last 500 are the other. */
    const doomed = new Set(sorted(accounts).slice(1_000));
    node.readFault = (_, addresses) =>
      addresses.some((address) => doomed.has(hex(address))) ? new ConnectError("unavailable", Code.Unavailable) : undefined;
    const failures: BackfillPoolFailure[] = [];

    const listed = await withFakeClock(listedBy(poolOptions(node, { partitions: 1 }), failures));

    expect(listed).toEqual(sorted(accounts).slice(0, 1_000));
    expect(failures.map((failure) => hex(failure.address)).sort()).toEqual(sorted(accounts).slice(1_000));
    expect(failures.map((failure) => (failure.error as ConnectError).code)).toEqual(Array(500).fill(Code.Unavailable));
    expect(node.reads.sort((a, b) => b - a)).toEqual([1_000, 500, 500, 500, 500, 500, 500, 500, 500]);
  });
});

describe("readAllAccounts stopping", () => {
  it.each(["until-close", "forever"] as const)(
    "an abort ends the backfill and closes every pooled client while pooled calls stall %s",
    async (stall) => {
      const { listed: accounts, rejected } = spreadAccounts();
      const node = new FakeNode(accounts, rejected);
      node.stallPooled = stall;
      node.readDelayMs = 10;
      const controller = new AbortController();
      const batches: number[] = [];
      let callsAtAbort = 0;

      const unhandled = await unhandledDuring(async () => {
        for await (const batch of readAllAccounts(poolOptions(node, { signal: controller.signal }), [])) {
          batches.push(batch.length);
          callsAtAbort = node.calls;
          controller.abort();
        }
      });

      expect(unhandled).toEqual([]);
      expect(batches).toEqual([1_000]);
      expect(node.calls).toBe(callsAtAbort);
      expect(node.clients.map((client) => `${client.name} ${client.closed ? "closed" : "open"}`)).toEqual([
        "primary open",
        /* One compressed walk plus 8 partitions. */
        ...Array.from({ length: 9 }, (_, i) => `pooled-${i + 1} closed`),
      ]);
    },
  );

  it("a consumer that stops early starts no call afterwards and leaves no unhandled rejection", async () => {
    const { listed: accounts, rejected } = spreadAccounts();
    const node = new FakeNode(accounts, rejected);
    node.readFault = (client) => (client.name === "primary" ? undefined : new ConnectError("unavailable", Code.Unavailable));
    let callsAtStop = 0;

    const unhandled = await unhandledDuring(
      async () => {
        for await (const batch of readAllAccounts(poolOptions(node, { partitions: 1 }), [])) {
          expect(batch.length).toBe(1_000);
          /* Pooled readers fail and sit in their 250 ms retry backoff. */
          await sleep(30);
          callsAtStop = node.calls;
          break;
        }
      },
      () => sleep(400),
    );

    expect(unhandled).toEqual([]);
    expect(node.calls).toBe(callsAtStop);
    expect(node.clients.length).toBeGreaterThan(1);
    expect(openClients(node)).toEqual(["primary"]);
  });

  it("a listing failure rejects the backfill with no unhandled rejection from a read still in flight", async () => {
    vi.useFakeTimers();
    const { listed: accounts, rejected } = spreadAccounts();
    const node = new FakeNode(accounts, rejected);
    node.readDelayMs = 30_000;
    node.listFault = (client) => (client.name === "primary" ? undefined : new ConnectError("unavailable", Code.Unavailable));
    let error: unknown;

    const unhandled = await unhandledDuring(
      async () => {
        error = await withFakeClock(listedBy(poolOptions(node)).catch((err: unknown) => err));
      },
      async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        vi.useRealTimers();
        await sleep(10);
      },
    );

    expect(unhandled).toEqual([]);
    expect(error).toMatchObject({ code: Code.Unavailable });
    expect(node.reads).toEqual([1_000]);
    expect(openClients(node)).toEqual(["primary"]);
  });
});
