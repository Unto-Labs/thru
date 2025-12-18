# Thru ETL Replay - Development Plan

## Objective
Build a reliable "Chain -> Stream" replay that backfills historical data from a `List*` API and seamlessly transitions to a `Stream*` API without missing or duplicating data.

## Architecture: "The Replay"

### Core Logic: The Handover State Machine
We need to implement a state machine that manages two sources of data:
1.  **Backfill Source:** `ListBlocks`, `ListTransactions` (Finite, Historical).
2.  **Live Source:** `StreamBlocks`, `StreamTransactions` (Infinite, Real-time).

**States:**
1.  **BUFFERING:** 
    - Connect to Live Stream immediately.
    - Buffer incoming items in a `MinHeap` or sorted `Map`.
    - Track `min_stream_slot` (the earliest slot seen in the live stream).
2.  **BACKFILLING:**
    - Iterate backwards (or efficiently paginate) from `start_slot`.
    - Yield items to the consumer.
    - Check condition: `current_backfill_slot` >= `min_stream_slot - SAFETY_MARGIN`.
3.  **SWITCHING:**
    - Stop Backfill.
    - Drain the Buffer: Discard items where `slot <= current_backfill_slot`.
    - Yield remaining items in the Buffer.
4.  **STREAMING:**
    - Pipe data directly from Live Stream to Consumer.

### Components (TypeScript Prototype)

1.  **`ChainClient`**: A wrapper around `ConnectRPC` clients to handle auth/connection.
2.  **`ReplaydStream<T>`**: The generic class implementing the logic above.
    - Inputs: `fetchRange(start, end)`, `subscribe(start)`.
    - Output: `AsyncIterator<T>`.
3.  **`DedupBuffer`**: A helper to manage the "Overlap" window.

## Development Tasks

### Phase 1: Setup & Connectivity (Current)
- [x] Initialize project structure (`web/etl-replay`).
- [x] Generate Protobuf Client code (`buf generate`).
- [x] Create a basic "Hello World" script (`src/investigate.ts`).
- [ ] Verify `ListBlocks` ordering behavior (Ascending vs Descending).

### Phase 2: The Logic Prototype
- [x] Implement `ReplaydStream` class skeleton (`src/replay-stream.ts`).
- [x] Implement "Stream Buffering" (holding live items while backfilling).
- [x] Implement "Backfill Pagination" (handling tokens).
- [x] Implement the "Switchover" logic.
- [ ] Test with a "Simulated Chain" (Mock Data Source) to prove gapless delivery.

### Phase 3: Integration
- [ ] Connect to real `thru-net` node.
- [ ] Validate CEL Filters are passed correctly.
- [ ] Measure throughput (roughly) to benchmark Node.js performance.

### Phase 4: Output
- [ ] Add a simple "Sink" interface (Console, File, Kafka).

## Questions to Answer
1. Does `ListBlocks` support `order_by="slot asc"`? If not, we must fetch in chunks and reverse.
2. How reliable is `StreamBlocks`? Does it drop messages under load?
