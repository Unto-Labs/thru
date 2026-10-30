import { create } from "@bufbuild/protobuf";
import { type Event, type Filter, ListEventsRequestSchema, PageRequestSchema } from "@thru/sdk/proto";
import type { EventSource } from "../chain-client";
import { abortableDelay } from "../retry";
import type { BackfillFetcher, BackfillPage, ReplayLogger, Slot } from "../types";
import { closeIfCloseable } from "../types";

const RANGE_PAGE_SIZE = 1000;
/* An overloaded node sheds with "upstream request timeout"; ~16 s of backoff rides that out. */
const RANGE_ATTEMPTS = 8;
/* Ranges are at most 1/HISTORY_RANGES of the history, and start 64 times smaller. */
const HISTORY_RANGES = 1024;
const FIRST_STEP_DIVISOR = 64n;
/* A sparse range sizes the next ones at most this many times its own span, so
   ranges read concurrently do not compound the growth. */
const MAX_STEP_GROWTH = 2n;
/* Below this many slots to head, a sequential backfill is fast enough. */
const PARALLEL_MIN_SLOTS = 20_000n;
/* ListEvents trails finalized by seconds to minutes; 10,000 slots (~30 min at ~200 ms) clears that, so ranges never end in unindexed slots. */
const SEQUENTIAL_TAIL_SLOTS = 10_000n;

export interface ParallelHistoryOptions {
  /** Answers GetHeight; the ranges end SEQUENTIAL_TAIL_SLOTS below its finalized slot. */
  client: EventSource;
  clientFactory: () => EventSource;
  connections: number;
  /** Events read but not yet handed back before more ranges wait. */
  maxBuffered: number;
  /** The ListEvents filter for events in [lo, hi). */
  rangeFilter: (lo: Slot, hi: Slot) => Filter | undefined;
  /** Reads the tail from the last range's end, and everything when there are no ranges. */
  sequential: BackfillFetcher<Event, string>;
  checkPage: (events: Event[]) => void;
  signal?: AbortSignal;
  logger?: ReplayLogger;
}

/* Splits [startSlot, head - SEQUENTIAL_TAIL_SLOTS) into slot ranges read over
   separate connections and hands their pages back strictly in slot order, so
   checkpoints stay monotonic. Each new range spans about one page of events at
   the density the last range observed: a dense range would otherwise page
   through one connection while the read-ahead bound holds the others. The
   sequential fetcher then reads the tail, and reads everything when the head
   is unknown or near. Cursors are "p:<ranges handed back>" while ranges
   remain and "s:<token>" after. */
export function createParallelHistory(options: ParallelHistoryOptions): {
  fetchBackfill: BackfillFetcher<Event, string>;
  close: () => void;
} {
  const { connections, maxBuffered } = options;
  /* Pages a range has read and not yet handed back, in order. */
  type Range = { lo: Slot; hi: Slot; pages: Event[][]; done: boolean };
  /* Ranges not yet handed back; ranges[0] is the one being handed back. */
  let ranges: Range[] | null = null;
  let tail: Slot = 0n;
  /* Where the next range starts, its span, and the largest span allowed. */
  let nextLo: Slot = 0n;
  let step: Slot = 1n;
  let maxStep: Slot = 1n;
  let handed = 0;
  let launched = 0;
  let active = 0;
  let buffered = 0;
  let failure: unknown;
  const pool: EventSource[] = [];
  const idle: EventSource[] = [];
  const window = connections * 8;
  const stop = new AbortController();
  /* Wakes the consumer waiting on the next range's next page. */
  let wake: (() => void) | undefined;
  const notify = () => {
    const w = wake;
    wake = undefined;
    w?.();
  };

  const close = () => {
    if (stop.signal.aborted) return;
    stop.abort();
    notify();
    options.signal?.removeEventListener("abort", close);
    for (const source of pool) closeIfCloseable(source);
  };

  /* Range i, created at the current step when first needed; undefined past the last. */
  const rangeAt = (i: number): Range | undefined => {
    while (ranges!.length <= i && nextLo < tail) {
      const hi = nextLo + step < tail ? nextLo + step : tail;
      ranges!.push({ lo: nextLo, hi, pages: [], done: false });
      nextLo = hi;
    }
    return ranges![i];
  };
  /* Sizes later ranges from `events` read over `slots`: shrink at once, grow gradually. */
  const observe = (slots: Slot, events: number) => {
    const fit = (slots * BigInt(RANGE_PAGE_SIZE)) / BigInt(Math.max(events, 1));
    const grown = fit < slots * MAX_STEP_GROWTH ? fit : slots * MAX_STEP_GROWTH;
    step = grown < 1n ? 1n : grown < maxStep ? grown : maxStep;
  };

  const readRange = async (source: EventSource, range: Range): Promise<void> => {
    const filter = options.rangeFilter(range.lo, range.hi);
    let pageToken: string | undefined;
    do {
      let response;
      for (let attempt = 0; ; attempt++) {
        stop.signal.throwIfAborted();
        try {
          response = await source.listEvents(create(ListEventsRequestSchema, {
            filter,
            page: create(PageRequestSchema, { pageSize: RANGE_PAGE_SIZE, orderBy: "slot asc", pageToken }),
          }), { signal: stop.signal });
          break;
        } catch (err) {
          if (stop.signal.aborted || attempt >= RANGE_ATTEMPTS - 1) throw err;
          await abortableDelay(Math.min(250 * 2 ** attempt, 4_000), stop.signal);
        }
      }
      options.checkPage(response.events);
      const first = pageToken === undefined;
      pageToken = response.page?.nextPageToken || undefined;
      if (first) {
        const last = response.events[response.events.length - 1]?.slot ?? range.lo;
        observe(pageToken ? last - range.lo + 1n : range.hi - range.lo, response.events.length);
      }
      buffered += response.events.length;
      if (response.events.length) range.pages.push(response.events);
      if (range === ranges![0]) notify();
      /* While the buffer is full, a range waits between pages unless it is the
         next one with nothing unread, so a stalled consumer bounds every range. */
      while (pageToken && buffered >= maxBuffered && (range !== ranges![0] || range.pages.length > 0) && !stop.signal.aborted) {
        await abortableDelay(5, stop.signal);
      }
    } while (pageToken);
    range.done = true;
    if (range === ranges![0]) notify();
  };

  const pump = () => {
    while (
      ranges && !stop.signal.aborted && active < connections && launched < window && buffered < maxBuffered
    ) {
      const range = rangeAt(launched);
      if (!range) break;
      launched++;
      let source = idle.pop();
      if (!source) pool.push(source = options.clientFactory());
      active++;
      void readRange(source, range)
        .catch((err) => {
          failure ??= err;
          close();
        })
        .finally(() => {
          active--;
          idle.push(source!);
          pump();
        });
    }
  };

  const fetchBackfill = async ({ startSlot, cursor }: { startSlot: Slot; cursor?: string }): Promise<BackfillPage<Event, string>> => {
    if (cursor === undefined && ranges === null) {
      /* The height only picks the faster path; without it, read sequentially. */
      const height = await (options.client as EventSource & { getHeight?: () => Promise<{ finalized?: bigint }> })
        .getHeight?.()
        .catch((error: unknown) => {
          options.logger?.warn?.("history height unavailable; reading history sequentially", { error });
          return undefined;
        });
      const head = height?.finalized ?? 0n;
      ranges = [];
      if (head > startSlot + PARALLEL_MIN_SLOTS) {
        tail = head - SEQUENTIAL_TAIL_SLOTS;
        nextLo = startSlot;
        maxStep = (tail - startSlot) / BigInt(HISTORY_RANGES) + 1n;
        step = maxStep / FIRST_STEP_DIVISOR || 1n;
        options.signal?.addEventListener("abort", close, { once: true });
        if (options.signal?.aborted) close();
        options.logger?.info?.(`parallel history backfill over ${connections} connections to slot ${tail}`);
      }
    }
    while (ranges && (cursor === undefined || cursor.startsWith("p:"))) {
      const range = rangeAt(0);
      if (!range) break;
      pump();
      while (!range.pages.length && !range.done && failure === undefined && !stop.signal.aborted) {
        await new Promise<void>((resolve) => (wake = resolve));
      }
      if (failure !== undefined) throw failure;
      stop.signal.throwIfAborted();
      const items = range.pages.shift();
      if (items) {
        buffered -= items.length;
        pump();
        return { items, cursor: `p:${handed}`, done: false };
      }
      ranges.shift();
      launched--;
      handed++;
      if (!rangeAt(0)) {
        close();
        return { items: [], cursor: "s:", done: false };
      }
    }
    const token = cursor?.startsWith("s:") ? cursor.slice(2) || undefined : cursor;
    // tail is set only when ranges read the history before it.
    const page = await options.sequential({ startSlot: tail > 0n ? tail : startSlot, cursor: token });
    return { ...page, cursor: page.cursor === undefined ? undefined : `s:${page.cursor}` };
  };

  return { fetchBackfill, close };
}
