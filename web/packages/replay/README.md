# @thru/etl-replay

High-throughput historical replay for the thru-net blockchain stack. This package backfills blocks, transactions, and events via the `QueryService` (`List*` RPCs) and then hands off to the realtime `StreamingService` (`Stream*` RPCs) without gaps or duplicates. It powers ETL and analytics sinks that need a single ordered feed even when the node is millions of slots behind tip.

```
            ┌─────────────┐     paginated history     ┌─────────────┐
Chain RPC ─►│ List* APIs  ├──────────────────────────►│ Backfill loop│
            └─────────────┘                           └─────┬───────┘
                                                          (BUFFERING+BACKFILLING)
            ┌─────────────┐     live async stream     ┌─────▼───────┐
Chain RPC ─►│ Stream* APIs├──────────────────────────►│ LivePump     │
            └─────────────┘                           └─────┬───────┘
                                                            (SWITCHING)
                                         deduped, ordered ┌─▼────────┐
                                         async iterable   │ReplayStream│
                                                          └────┬─────┘
                                                               │ (STREAMING)
                                                               ▼
                                                         Async consumer
```

## Capabilities

- Gapless replay for **blocks, transactions, and events** with resource-specific factories (`createBlockReplay`, `createTransactionReplay`, `createEventReplay`).
- **Four-phase state machine** (`BUFFERING → BACKFILLING → SWITCHING → STREAMING`) that deterministically merges historical and live data.
- **Safety margin & overlap management:** configurable `safetyMargin` keeps a guard band between historical slots and the earliest slot seen on the live stream so the switchover never emits future data twice.
- **Per-item deduplication** via customizable `extractKey` functions so multiple transactions/events in one slot are preserved while duplicates caused by overlap or reconnects are discarded.
- **Automatic live stream retries:** `ReplayStream` reconnects with the latest emitted slot, drains buffered data, and resumes transparently after errors or server-side EOF.
- **Structured metrics and logging:** `getMetrics()` exposes counts for emitted backfill vs live records, buffered overlap, and discarded duplicates, while pluggable `ReplayLogger` implementations (default `NOOP_LOGGER`, optional console logger) keep observability consistent across deployments.
- **ConnectRPC client wrapper (`ChainClient`)** that centralizes TLS, headers, interceptors, and transport reuse for both query and streaming services.
- **Deterministic test harness** (`SimulatedChain`, `SimulatedTransactionSource`) plus Vitest specs to validate deduplication, switching, and reconnect logic.

## Architecture Overview

| Layer | Responsibility | Key Files |
| --- | --- | --- |
| Entry Points | Resource-specific factories configure pagination, filters, and live subscribers for each data type. | `src/replay/block-replay.ts`, `src/replay/transaction-replay.ts`, `src/replay/event-replay.ts` |
| Replay State Machine | Coordinates backfill/livestream phases, metrics, retries, and dedup. | `src/replay-stream.ts` |
| Live Ingestion | Buffers live data, exposes overlap bounds, and feeds an async queue once streaming. | `src/live-pump.ts`, `src/async-queue.ts` |
| Deduplication | Slot/key-aware buffer that keeps the overlap window sorted and bounded. | `src/dedup-buffer.ts` |
| Connectivity | ConnectRPC wiring for Query/Streaming services, header interceptors, and transport configuration. | `src/chain-client.ts` |
| Testing Utilities | In-memory block/transaction sources that emulate pagination and streaming semantics. | `src/testing/*.ts` |

### Replay Lifecycle

1. **BUFFERING** – `LivePump` subscribes to `Stream*` immediately, buffering every item in a sorted dedup buffer and tracking the min/max slot observed.
2. **BACKFILLING** – `ReplayStream` pages through `List*` RPCs (default `orderBy = "slot asc"`). Each item is sorted, deduped against the last emitted slot+key, yielded to consumers, and used to advance `currentSlot`. After each page we prune buffered live items `<= currentSlot` so memory use stays proportional to the safety margin.
3. **SWITCHING** – When `currentSlot >= maxStreamSlot - safetyMargin` (or the server signals no more history), we invoke `livePump.enableStreaming(currentSlot)`, discard overlap, drain remaining buffered data in ascending order, and mark the pump as streaming-only.
4. **STREAMING** – The replay now awaits `livePump.next()` forever, emitting live data as soon as the async queue resolves. Failures trigger `safeClose` and a resubscription at `currentSlot`, immediately enabling streaming mode so reconnects do not block.

### Core Data Structures

- **`ReplayStream<T>`** – generic async iterable that accepts `fetchBackfill`, `subscribeLive`, `extractSlot`, `extractKey`, and `safetyMargin`. It also exposes metrics and optional `resubscribeOnEnd` control.
- **`LivePump<T>`** – wraps any async iterable, buffering until `enableStreaming()` is called. It records `minSlot()`/`maxSlot()` to guide the handover threshold, and enforces an `emitFloor` so late-arriving historical slots from the live stream are dropped quietly.
- **`DedupBuffer<T>`** – multi-map keyed by slot + user-provided key, with binary search insertion, `discardUpTo`, `drainAbove`, and `drainAll` helpers. This lets transaction/event replays keep multiple records per slot while still pruning overlap aggressively.
- **`AsyncQueue<T>`** – minimal async iterator queue that handles back-pressure and clean shutdown/failure propagation between the live pump and replay consumer.
- **`ChainClient`** – lazily builds a Connect transport (HTTP/2 by default), handles API keys/user agents via interceptors, and exposes typed wrappers for `list/stream` RPC pairs plus `getHeight`.

## Operational Behavior & Configuration

| Option | Location | Purpose |
| --- | --- | --- |
| `startSlot` | All replay factories | First slot to include in the backfill; also the minimum slot for the live subscriber. |
| `safetyMargin` | `ReplayStream` (`32n` for blocks, `64n` for tx/events by default) | Buffer of slots that must exist between the latest backfill slot and the earliest live slot before switching. |
| `pageSize` | Resource factories | Number of records to request per `List*` page. |
| `filter` | Resource factories | CEL expression merged with the internally generated `slot >= uint(startSlot)` predicate to ensure consistent ordering/resume behavior. |
| `view`, `minConsensus`, `returnEvents` | Block/tx factories | Mirror Thru RPC query flags so callers can trade fidelity for throughput. |
| `resubscribeOnEnd` | `ReplayStream` | If `false`, the iterable ends when the server closes the live stream instead of reconnecting. |
| `logger` | Any factory | Plug in structured logging (e.g., `createConsoleLogger("Blocks")`). |

`ReplayStream` automatically:

- Keeps `metrics.bufferedItems`, `emittedBackfill`, `emittedLive`, and `discardedDuplicates`. The metrics snapshot is immutable so callers can periodically poll without worrying about concurrent mutation.
- Deduplicates both during backfill and streaming via `extractKey`. Blocks default to slot-based keys; transactions prefer the signature (fallback to slot+blockOffset); events use `eventId` or slot+callIdx.
- Retries live streams after any error/EOF with an exponential-free but bounded strategy (currently constant `RETRY_DELAY_MS = 1000`), guaranteeing ordering because the new `LivePump` starts in streaming mode with the previous `currentSlot` as its emit floor.

## Usage

```ts
import {
  ChainClient,
  createBlockReplay,
  createConsoleLogger,
} from "@thru/etl-replay";

const client = new ChainClient({
  baseUrl: "https://rpc.thru.net",
  apiKey: process.env.THRU_API_KEY,
  userAgent: "etl-replay-demo",
});

const blockReplay = createBlockReplay({
  client,
  startSlot: 1_000_000n,
  safetyMargin: 64n,
  pageSize: 256,
  logger: createConsoleLogger("BlockReplay"),
  filter: undefined, // optional CEL filter merged with slot predicate
});

for await (const block of blockReplay) {
  // Persist, transform, or forward each block.
  console.log("slot", block.header?.slot?.toString());
}
```

Switching to transactions or events only changes the factory import plus any resource-specific options. `ReplayStream` itself is generic, so advanced integrations can wire custom fetch/subscription functions (e.g., for account data) as long as they abide by the `ReplayConfig` contract.

## Building, Testing, and Regenerating Protos

```bash
pnpm install            # install dependencies
pnpm run build          # tsup -> dist/index.{cjs,mjs,d.ts}
pnpm test               # vitest, uses simulated sources

# When upstream proto definitions change
pnpm run protobufs:pull     # copies repo-wide proto/ into this package
pnpm run protobufs:generate # buf generate -> src/proto/
```

- The package ships dual entry points (`dist/index.mjs` + `dist/index.cjs`) generated by `tsup` and targets Node.js ≥ 18.
- Generated files live under `src/gen/` and are kept out of version control elsewhere in the monorepo; avoid manual edits.
- Scripts assume workspace-relative `proto/` roots; adjust `protobufs:pull` if the directory layout changes.

## Limitations & Future Considerations

- **Single-chain, single-resource instances:** each replay handles one RPC resource (blocks, transactions, or events). Multi-resource ETL must run multiple iterables side-by-side and coordinate downstream ordering.
- **In-memory buffering:** overlap data is kept in process memory; extremely wide safety margins or multi-million slot gaps can increase memory pressure even though `discardBufferedUpTo` keeps it bounded to roughly the safety window. Persisted buffers/checkpointing are not implemented.
- **No batching/parallelization on the consumer side:** the async iterator yields one item at a time. Downstream batching must be implemented by the caller to avoid per-record I/O overhead.
- **Deterministic ordering requires the backend to honor `orderBy = "slot asc"` and CEL slot predicates.** Misconfigured RPC nodes that return unsorted pages will still be sorted locally, but cursor semantics (and thus throughput) degrade.
- **Retry policy is fixed (`1s` delay, infinite retries).** Environments that need exponential backoff or max retry counts should wrap the iterable and stop when necessary.
- **Filtering is limited to CEL expressions accepted by the Thru RPC API.** Compound filters are merged as string expressions; callers must avoid conflicting parameter names.
- **No built-in metrics export.** `getMetrics()` exposes counters, but exporting them to Prometheus/StatsD/etc. is left to the host application.

## Repository Reference

- `REPLAY_GUIDE.md` – deep dive through every module (recommended read for contributors).
- `REPLAY_ISSUES.md` – historical correctness issues and the fixes applied (handy for regression context).
- `DEV_PLAN.md` – original development milestones; useful for understanding remaining roadmap items.
- `scripts/` – helper scripts for running the replay against staging/mainnet endpoints.
- `dist/` – build output from `tsc`.

With this README plus the in-repo guides, you should have everything you need to operate, extend, or debug the replay pipeline with confidence.
