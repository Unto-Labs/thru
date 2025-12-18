#!/usr/bin/env tsx

/**
 * Quick dev harness to run the block replay against a thru-net RPC endpoint.
 * Adjust DEFAULT_CONFIG below to change targets or limits.
 */
import {
  ChainClient,
  ConsoleSink,
  createBlockReplay,
  createConsoleLogger,
  type ReplayMetrics,
  type Slot,
} from "../src";

interface ReplayRunnerConfig {
  baseUrl: string;
  apiKey?: string;
  userAgent?: string;
  startSlot: Slot;
  safetyMargin: bigint;
  pageSize: number;
  limit?: number;
}

const DEFAULT_CONFIG: ReplayRunnerConfig = {
  baseUrl: "https://grpc.alphanet.thruput.org",
  apiKey: undefined,
  userAgent: undefined,
  startSlot: 0n,
  safetyMargin: 32n,
  pageSize: 256,
  limit: undefined,
};

async function main(): Promise<void> {
  const cfg = DEFAULT_CONFIG;
  const logger = createConsoleLogger("BlockReplay");
  logger.info("starting replay", {
    baseUrl: cfg.baseUrl,
    startSlot: cfg.startSlot.toString(),
    safetyMargin: cfg.safetyMargin.toString(),
    pageSize: cfg.pageSize,
    limit: cfg.limit ?? "∞",
  });

  const client = new ChainClient({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    userAgent: cfg.userAgent,
  });

  const chainTip = await ensureStartSlotWithinHeight(client, cfg.startSlot, logger);
  logger.info("chain height", { finalized: chainTip.toString() });

  const replay = createBlockReplay({
    client,
    startSlot: cfg.startSlot,
    safetyMargin: cfg.safetyMargin,
    pageSize: cfg.pageSize,
    logger,
  });

  const sink = new ConsoleSink("BlockSink");
  await sink.open({ stream: "blocks", label: cfg.baseUrl });

  let count = 0;
  const phaseTracker = createPhaseTracker();
  try {
    for await (const block of replay) {
      const phase = determinePhase(replay.getMetrics(), phaseTracker);
      const slot = block.header?.slot ?? 0n;
      await sink.write(block, { slot, phase });

      count += 1;
      if (cfg.limit && count >= cfg.limit) break;
    }
  } finally {
    await sink.close();
  }
  logger.info("replay finished", { emitted: count, metrics: replay.getMetrics() });
}

async function ensureStartSlotWithinHeight(
  client: ChainClient,
  startSlot: Slot,
  logger: ReturnType<typeof createConsoleLogger>,
): Promise<bigint> {
  try {
    const height = await client.getHeight();
    const tip = height.finalized ?? height.locallyExecuted ?? height.clusterExecuted ?? 0n;
    if (startSlot > tip) {
      throw new Error(
        `start slot ${startSlot.toString()} is above current finalized height ${tip.toString()}`,
      );
    }
    return tip;
  } catch (err) {
    logger.warn("failed to fetch chain height; continuing without validation", { err });
    return 0n;
  }
}

main().catch((err) => {
  console.error("Replay run failed:", err);
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
