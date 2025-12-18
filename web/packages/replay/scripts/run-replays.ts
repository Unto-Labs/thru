#!/usr/bin/env tsx

/**
 * Run block, transaction, and event replays concurrently using fixed defaults.
 * Tweak DEFAULT_RUNNER_CONFIG if you need different start slots or limits.
 */

import {
  ChainClient,
  ConsoleSink,
  createBlockReplay,
  createEventReplay,
  createTransactionReplay,
  createConsoleLogger,
  type ReplayMetrics,
  type Slot,
} from "../src";

interface SharedReplayConfig {
  startSlot: Slot;
  safetyMargin: bigint;
  pageSize: number;
  limit?: number;
}

interface RunnerConfig {
  baseUrl: string;
  apiKey?: string;
  userAgent?: string;
  block: SharedReplayConfig;
  transaction: SharedReplayConfig;
  event: SharedReplayConfig;
}

const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  baseUrl: "https://grpc.alphanet.thruput.org",
  apiKey: undefined,
  userAgent: undefined,
  block: {
    startSlot: 0n,
    safetyMargin: 32n,
    pageSize: 256,
    limit: undefined,
  },
  transaction: {
    startSlot: 0n,
    safetyMargin: 64n,
    pageSize: 256,
    limit: undefined,
  },
  event: {
    startSlot: 0n,
    safetyMargin: 64n,
    pageSize: 512,
    limit: undefined,
  },
};

async function runBlockReplayTask(
  client: ChainClient,
  cfg: SharedReplayConfig,
): Promise<void> {
  const logger = createConsoleLogger("Blocks");
  const replay = createBlockReplay({
    client,
    startSlot: cfg.startSlot,
    safetyMargin: cfg.safetyMargin,
    pageSize: cfg.pageSize,
    logger,
  });

  const sink = new ConsoleSink("BlockSink");
  await sink.open({ stream: "blocks" });

  let emitted = 0;
  const tracker = createPhaseTracker();
  try {
    for await (const block of replay) {
      const phase = determinePhase(replay.getMetrics(), tracker);
      const slot = block.header?.slot ?? 0n;
      await sink.write(block, { slot, phase });
      emitted += 1;
      if (cfg.limit && emitted >= cfg.limit) break;
    }
  } finally {
    await sink.close();
  }
  logger.info("replay finished", { emitted, metrics: replay.getMetrics() });
}

async function runTransactionReplayTask(
  client: ChainClient,
  cfg: SharedReplayConfig,
): Promise<void> {
  const logger = createConsoleLogger("Transactions");
  const replay = createTransactionReplay({
    client,
    startSlot: cfg.startSlot,
    safetyMargin: cfg.safetyMargin,
    pageSize: cfg.pageSize,
    logger,
  });

  const sink = new ConsoleSink("TransactionSink");
  await sink.open({ stream: "transactions" });

  let emitted = 0;
  const tracker = createPhaseTracker();
  try {
    for await (const tx of replay) {
      const phase = determinePhase(replay.getMetrics(), tracker);
      const slot = tx.slot ?? 0n;
      await sink.write(tx, { slot, phase });
      emitted += 1;
      if (cfg.limit && emitted >= cfg.limit) break;
    }
  } finally {
    await sink.close();
  }
  logger.info("replay finished", { emitted, metrics: replay.getMetrics() });
}

async function runEventReplayTask(
  client: ChainClient,
  cfg: SharedReplayConfig,
): Promise<void> {
  const logger = createConsoleLogger("Events");
  const replay = createEventReplay({
    client,
    startSlot: cfg.startSlot,
    safetyMargin: cfg.safetyMargin,
    pageSize: cfg.pageSize,
    logger,
  });

  const sink = new ConsoleSink("EventSink");
  await sink.open({ stream: "events" });

  let emitted = 0;
  const tracker = createPhaseTracker();
  try {
    for await (const event of replay) {
      const phase = determinePhase(replay.getMetrics(), tracker);
      const slot = event.slot ?? 0n;
      await sink.write(event, { slot, phase });
      emitted += 1;
      if (cfg.limit && emitted >= cfg.limit) break;
    }
  } finally {
    await sink.close();
  }
  logger.info("replay finished", { emitted, metrics: replay.getMetrics() });
}

async function fetchChainTip(client: ChainClient): Promise<bigint> {
  const height = await client.getHeight();
  return height.finalized ?? height.locallyExecuted ?? height.clusterExecuted ?? 0n;
}

function validateStartSlot(name: string, startSlot: Slot, tip: bigint): void {
  if (startSlot > tip) {
    throw new Error(
      `${name} start slot ${startSlot.toString()} is above finalized height ${tip.toString()}`,
    );
  }
}

async function main(): Promise<void> {
  const cfg = DEFAULT_RUNNER_CONFIG;
  const client = new ChainClient({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    userAgent: cfg.userAgent,
  });

  const tip = await fetchChainTip(client);
  validateStartSlot("block", cfg.block.startSlot, tip);
  validateStartSlot("transaction", cfg.transaction.startSlot, tip);
  validateStartSlot("event", cfg.event.startSlot, tip);

  await Promise.all([
    runBlockReplayTask(client, cfg.block),
    runTransactionReplayTask(client, cfg.transaction),
    runEventReplayTask(client, cfg.event),
  ]);
}

main().catch((err) => {
  console.error("run-replays failed:", err);
  process.exitCode = 1;
});

interface PhaseTracker {
  backfill: number;
  live: number;
}

function createPhaseTracker(): PhaseTracker {
  return { backfill: 0, live: 0 };
}

function determinePhase(metrics: ReplayMetrics, tracker: PhaseTracker): "backfill" | "live" {
  if (metrics.emittedBackfill > tracker.backfill) {
    tracker.backfill = metrics.emittedBackfill;
    return "backfill";
  }
  tracker.live = metrics.emittedLive;
  return "live";
}
