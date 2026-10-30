import { Code, ConnectError } from "@connectrpc/connect";
import { rawAccountToAccount } from "@thru/sdk";
import { AccountStateFilter, AccountView, type Account, type Filter } from "@thru/sdk/proto";
import { AsyncQueue } from "./async-queue";
import type { AccountSource } from "./chain-client";
import { abortableDelay } from "./retry";
import type { ReplayLogger } from "./types";
import { closeIfCloseable } from "./types";

/* BatchGetRawAccounts item cap (BATCH_GET_MAX_ITEMS on the node). */
const READ_BATCH_SIZE = 1_000;
/* ListAccounts page cap (maxPageSize on the node). */
const LIST_PAGE_SIZE = 1_000;
/* Owner-plan page token: [version, kind=1, owner(32), address(32), digest(32)].
   Only version, kind, owner and digest are validated by the node; the address
   is where the scan resumes. */
const OWNER_TOKEN_SIZE = 98;
const TOKEN_ADDRESS_OFFSET = 34;
/* Page tokens carry the listing state from version 2 (#4951) on. */
const STATE_TOKEN_VERSION = 2;
/* An overloaded node sheds with "upstream request timeout"; ~16 s of backoff rides
   that out instead of failing a whole batch and restarting the backfill. */
const POOL_ATTEMPTS = 8;

export interface BackfillPoolOptions {
  primary: AccountSource;
  clientFactory?: () => AccountSource;
  owner: Uint8Array;
  filter: Filter;
  partitions: number;
  readers: number;
  maxRetries: number;
  skip: (address: Uint8Array) => boolean;
  logger: ReplayLogger;
  signal?: AbortSignal;
}

export interface BackfillPoolFailure {
  address: Uint8Array;
  error: unknown;
}

/* Lists every account matching `filter` and reads each one at its latest
   version, both spread over separate connections. Yields read batches in
   completion order; listing order carries no meaning because every write
   is guarded by (slot, seq). Addresses missing from a read response were
   deleted after listing and are dropped. */
export async function* readAllAccounts(
  options: BackfillPoolOptions,
  failures: BackfillPoolFailure[],
): AsyncGenerator<Account[]> {
  const { primary, clientFactory, signal, logger } = options;
  const clients: AccountSource[] = [];
  const connect = () => {
    if (!clientFactory) return primary;
    const client = clientFactory();
    clients.push(client);
    return client;
  };
  const toRead = new AsyncQueue<Uint8Array[]>();
  const done = new AsyncQueue<Account[]>();
  const controller = new AbortController();
  const stopped = () => controller.signal.aborted;
  /* Ends the backfill at once. After a stop nothing is queued, connected, retried
     or yielded, and results of calls still in flight are dropped. */
  const stop = () => {
    controller.abort();
    toRead.close();
    done.close();
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();

  let pending: Uint8Array[] = [];
  const enqueue = (address: Uint8Array) => {
    if (stopped() || options.skip(address)) return;
    pending.push(address);
    if (pending.length >= READ_BATCH_SIZE) {
      toRead.push(pending);
      pending = [];
    }
  };

  /* InvalidArgument cannot change on retry. ResourceExhausted on a read is the
     response budget, so the reader splits the batch instead. */
  const retry = async <T>(fn: () => Promise<T>, splitOnExhausted: boolean): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      /* A closed ChainClient reconnects on its next call, so no call may start after a stop. */
      controller.signal.throwIfAborted();
      try {
        return await fn();
      } catch (err) {
        const code = err instanceof ConnectError ? err.code : undefined;
        const final = code === Code.InvalidArgument || (splitOnExhausted && code === Code.ResourceExhausted);
        if (final || stopped() || attempt >= Math.max(options.maxRetries, POOL_ATTEMPTS)) throw err;
        await abortableDelay(Math.min(250 * 2 ** (attempt - 1), 4_000), controller.signal);
      }
    }
  };
  /* LIVE skips the node's two-listing admission (#4951). The page token digest
     covers the state, so every page and partition must send the same one. */
  const list = (
    client: AccountSource,
    pageToken?: string,
    state: AccountStateFilter = AccountStateFilter.LIVE,
    view: AccountView = AccountView.PUBKEY_ONLY,
  ) =>
    retry(() =>
      client.listAccounts({
        view,
        filter: options.filter,
        state,
        page: { pageSize: LIST_PAGE_SIZE, pageToken },
      }), false
    );

  const walk = async (client: AccountSource, token: string | undefined, end?: Uint8Array) => {
    while (token && !stopped()) {
      const response = await list(client, token);
      for (const account of response.accounts) {
        const address = account.address?.value;
        if (!address) continue;
        if (end && compare(address, end) >= 0) return;
        enqueue(address);
      }
      token = response.page?.nextPageToken || undefined;
      const next = token && tokenAddress(token, options.owner);
      if (end && next && compare(next, end) >= 0) return;
    }
  };

  const listAll = async () => {
    const first = await list(primary);
    for (const account of first.accounts) {
      if (account.address?.value) enqueue(account.address.value);
    }
    const token = first.page?.nextPageToken || undefined;
    const resumeAt = token && tokenAddress(token, options.owner);
    /* Split the rest of the address space into evenly spaced partitions and
       walk them concurrently. Addresses are hashes, so the split is even. */
    const bounds = resumeAt ? partitionBounds(resumeAt, options.partitions) : [];
    if (!token || bounds.length < 2) {
      await walk(primary, token);
      return;
    }
    const startToken = (i: number) => (i === 0 ? token : withTokenAddress(token, predecessor(bounds[i])));
    try {
      await list(primary, startToken(1));
    } catch (err) {
      if (!(err instanceof ConnectError && err.code === Code.InvalidArgument)) throw err;
      logger.warn("Partitioned listing rejected; listing sequentially", { error: err });
      await walk(primary, token);
      return;
    }
    if (stopped()) return;
    await Promise.all(bounds.map((_, i) => walk(connect(), startToken(i), bounds[i + 1])));
  };

  const read = async (client: AccountSource, addresses: Uint8Array[]): Promise<void> => {
    let response;
    try {
      response = await retry(() =>
        client.batchGetRawAccounts({
          view: AccountView.FULL,
          items: addresses.map((value) => ({ address: { value } })),
        }), true
      );
    } catch (err) {
      if (stopped()) return;
      if (err instanceof ConnectError && err.code === Code.ResourceExhausted && addresses.length > 1) {
        const half = Math.ceil(addresses.length / 2);
        await read(client, addresses.slice(0, half));
        await read(client, addresses.slice(half));
        return;
      }
      for (const address of addresses) failures.push({ address, error: err });
      return;
    }
    if (!stopped()) done.push(Object.values(response.accounts).map(rawAccountToAccount));
  };

  /* Reader 0 shares the primary client; the rest connect on their first batch. */
  const readerCount = Math.max(1, options.readers);
  const readers = Array.from({ length: readerCount }, async (_, i) => {
    let client: AccountSource | undefined = i === 0 ? primary : undefined;
    for await (const batch of toRead) {
      /* Bound memory: wait while the consumer is behind. */
      while (done.size >= readerCount * 2 && !stopped()) {
        await abortableDelay(5, controller.signal);
      }
      if (stopped()) return;
      client ??= connect();
      await read(client, batch);
    }
  });

  /* Compressed accounts are not LIVE. One sequential walk lists them next to
     the live partitions, best effort: the node scans compressed accounts
     chain-wide and may refuse a page over its read budget, and that must not
     cost the live backfill. A node older than #4951 ignores the state and
     answers with live accounts in version-1 tokens; either sign ends the walk. */
  const listCompressed = async () => {
    const client = connect();
    let token: string | undefined;
    do {
      const response = await list(client, token, AccountStateFilter.COMPRESSED, AccountView.META_ONLY);
      if (response.accounts.some((account) => account.meta?.flags?.isCompressed !== true)) return;
      for (const account of response.accounts) {
        if (account.address?.value) enqueue(account.address.value);
      }
      token = response.page?.nextPageToken || undefined;
      if (token && tokenVersion(token) < STATE_TOKEN_VERSION) return;
    } while (token && !stopped());
  };
  const listCompressedBestEffort = () =>
    listCompressed().catch((error: unknown) => {
      if (!stopped()) logger.warn("Compressed account listing failed; continuing with live accounts", { error });
    });

  const listing = Promise.all([listAll(), listCompressedBestEffort()]).then(() => {
    if (pending.length && !stopped()) toRead.push(pending);
    toRead.close();
  });
  /* Promise.all observes every reader from the start, so a reader that rejects
     after a listing failure is never unhandled. */
  void Promise.all([listing, ...readers]).then(
    () => done.close(),
    (err) => {
      if (!stopped()) done.fail(err);
      stop();
    },
  );

  try {
    for await (const batch of done) yield batch;
  } finally {
    stop();
    signal?.removeEventListener("abort", stop);
    for (const client of clients) closeIfCloseable(client);
  }
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function tokenVersion(token: string): number {
  return Buffer.from(token, "base64url")[0] ?? 0;
}

function tokenAddress(token: string, owner: Uint8Array): Uint8Array | null {
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== OWNER_TOKEN_SIZE || bytes[1] !== 1) return null;
  if (compare(bytes.subarray(2, 2 + owner.length), owner) !== 0) return null;
  return new Uint8Array(bytes.subarray(TOKEN_ADDRESS_OFFSET, TOKEN_ADDRESS_OFFSET + 32));
}

function withTokenAddress(token: string, address: Uint8Array): string {
  const bytes = Buffer.from(token, "base64url");
  bytes.set(address, TOKEN_ADDRESS_OFFSET);
  return bytes.toString("base64url");
}

/* Partition starts: the first is `from`, the rest split (from, 2^256) evenly
   by the leading two bytes. */
function partitionBounds(from: Uint8Array, count: number): Uint8Array[] {
  const lo = (from[0] << 8) | from[1];
  const bounds = [from];
  for (let i = 1; i < count; i++) {
    const value = lo + Math.floor(((0x10000 - lo) * i) / count);
    if (value <= lo || value > 0xffff) continue;
    const bound = new Uint8Array(32);
    bound[0] = value >> 8;
    bound[1] = value & 0xff;
    if (compare(bound, bounds[bounds.length - 1]) > 0) bounds.push(bound);
  }
  return bounds;
}

/* The address just before `address`: the node resumes strictly after a token's address. */
function predecessor(address: Uint8Array): Uint8Array {
  const out = Uint8Array.from(address);
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] > 0) {
      out[i]--;
      return out;
    }
    out[i] = 0xff;
  }
  return out;
}
