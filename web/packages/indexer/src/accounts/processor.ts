import { eq, getTableColumns } from "drizzle-orm";
import type { ChainClientFactory, ReplayLogger } from "@thru/replay";
import { createAccountsByOwnerReplay, AccountView } from "@thru/replay";
import { encodeAddress } from "@thru/sdk/helpers";
import type { DatabaseClient } from "../schema/types";
import { validateParsedData } from "../schema/validation";
import { bulkInsert } from "../schema/bulk-insert";
import { flushWhenIdle } from "./flush-when-idle";
import { getCheckpoint, updateCheckpoint } from "../checkpoint";
import type { AccountStream } from "./types";
import type { ProcessorStatusObserver } from "../runtime/status";
import { createScopedLogger } from "../runtime/logger";

export interface AccountProcessorOptions {
  clientFactory: ChainClientFactory;
  db: DatabaseClient;
  logLevel?: "debug" | "info" | "warn" | "error";
  logger?: ReplayLogger;
  validateParse?: boolean;
  observer?: ProcessorStatusObserver;
}

export interface AccountProcessorStats {
  accountsProcessed: number;
  accountsUpdated: number;
  accountsDeleted: number;
}

const WRITE_BATCH = 1_000;
const LIVE_FLUSH_IDLE_MS = 250;

/* Per stream, for listing and for reads. 2 streams x (8 + 8) + 16 history
   connections ran clean on betanet; 96 in total overloaded its RPC proxy. */
const BACKFILL_CONNECTIONS = 8;

/* Highest slot among rows (0n for none). */
function maxSlot(rows: Record<string, unknown>[]): bigint {
  let max = 0n;
  for (const row of rows) if ((row.slot as bigint) > max) max = row.slot as bigint;
  return max;
}

export async function runAccountStreamProcessor(
  stream: AccountStream,
  options: AccountProcessorOptions,
  abortSignal?: AbortSignal
): Promise<AccountProcessorStats> {
  const { clientFactory, db, logLevel = "info", logger: baseLogger, validateParse = false, observer } = options;
  const checkpointName = `account:${stream.name}`;

  const logger = createScopedLogger({
    logger: baseLogger,
    level: logLevel,
    prefix: `account-stream:${stream.name}`,
    bindings: {
      component: "indexer-stream",
      stream: stream.name,
      kind: "account",
      checkpoint_name: checkpointName,
    },
  });
  const log = (
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>
  ) => logger[level](msg, meta);

  const stats: AccountProcessorStats = {
    accountsProcessed: 0,
    accountsUpdated: 0,
    accountsDeleted: 0,
  };

  const checkpoint = await getCheckpoint(db, checkpointName);
  const minUpdatedSlot = checkpoint?.slot;
  observer?.onStart?.({
    startSlot: minUpdatedSlot,
    checkpointSlot: checkpoint?.slot ?? null,
  });
  if (minUpdatedSlot !== undefined) {
    log("info", `Resuming from checkpoint: slot ${minUpdatedSlot}`);
  }

  log("info", `Starting account stream: ${stream.description}`);
  if (stream.expectedSize) {
    log("info", `Expected data size: ${stream.expectedSize} bytes`);
  }

  let lastProcessedSlot = minUpdatedSlot ?? 0n;
  /* Highest slot the live stream has delivered. Backfill reads run ahead of
     it, so a checkpoint past it could skip updates the stream had not sent. */
  let streamSlot = 0n;
  const checkpointSlot = () => (lastProcessedSlot < streamSlot ? lastProcessedSlot : streamSlot);
  let handledAnyAccount = false;
  let backfillDrained = false;
  let backfillCheckpoint: Promise<void> | null = null;
  const settleBackfillCheckpoint = async () => {
    if (!backfillCheckpoint) return;
    const pending = backfillCheckpoint;
    backfillCheckpoint = null;
    await pending;
  };

  /* Rows are written in multi-row upserts: during backfill every 1,000 rows,
     live at each block marker (before its checkpoint) or once the stream has
     been quiet for LIVE_FLUSH_IDLE_MS. The replay emits only strictly newer
     versions per address, so a later row replaces an earlier buffered one. */
  const table = stream.table as any;
  const idField = stream.api?.idField ?? "address";
  const buffered = new Map<unknown, Record<string, unknown>>();
  const flushBuffered = async () => {
    if (buffered.size === 0) return;
    const rows = [...buffered.values()];
    buffered.clear();
    const columns = getTableColumns(stream.table as any);
    const set = Object.keys(rows[0]).filter((key) => key in columns);
    observer?.onPhase?.({ phase: "commit", slot: maxSlot(rows) });
    try {
      const { rows: upserted } = await bulkInsert(
        db,
        stream.table,
        rows,
        { kind: "versioned-update", target: table[idField], set, slot: table.slot, seq: table.seq },
        [table.slot],
      );
      if (upserted.length > 0) {
        stats.accountsUpdated += upserted.length;
        handledAnyAccount = true;
        const writtenSlot = maxSlot(upserted);
        if (writtenSlot > lastProcessedSlot) lastProcessedSlot = writtenSlot;
        observer?.onBatchCommitted?.({ slot: writtenSlot, count: upserted.length });
      }
    } catch (err) {
      observer?.onError?.("commit", err);
      log("error", `Failed to upsert ${rows.length} accounts: ${err}`);
      throw err;
    } finally {
      observer?.onPhase?.({ phase: null });
    }
  };

  /* A failed final flush stops the replay, so the loop rethrows the failure
     even on a quiet chain where no further event would wake it. */
  const replayAbort = new AbortController();
  const stopReplay = () => replayAbort.abort();
  abortSignal?.addEventListener("abort", stopReplay, { once: true });
  if (abortSignal?.aborted) stopReplay();

  try {
    const replay = createAccountsByOwnerReplay({
      clientFactory,
      listPartitions: BACKFILL_CONNECTIONS,
      readConnections: BACKFILL_CONNECTIONS,
      owner: stream.getOwnerProgram(),
      view: AccountView.FULL,
      dataSizes: stream.dataSizes ?? (stream.expectedSize ? [stream.expectedSize] : undefined),
      minUpdatedSlot,
      logger,
      signal: replayAbort.signal,
      onBackfillComplete: (highestSlot, streamCoveredSlot) => {
        log(
          "info",
          `Backfill complete. Highest slot: ${highestSlot}, stream slot: ${streamCoveredSlot}, accounts processed: ${stats.accountsProcessed}`
        );
        backfillDrained = true;
        if (streamCoveredSlot > streamSlot) streamSlot = streamCoveredSlot;
        /* The loop is suspended in next() here, so this flush is the only writer. */
        backfillCheckpoint = flushBuffered().then(async () => {
          if (!handledAnyAccount) return;
          const slot = checkpointSlot();
          try {
            await updateCheckpoint(db, checkpointName, slot, null);
            observer?.onCheckpoint?.({ slot });
            log("info", `Backfill checkpoint saved: slot ${slot}`);
          } catch (err) {
            log("warn", `Failed to save backfill checkpoint at slot ${slot}: ${err}`);
          }
        });
        backfillCheckpoint.catch(stopReplay);
      },
    });

    /* Live rows wait for their block's marker; the idle flush bounds that wait
       when a stream drops between an update and its marker. */
    const events = flushWhenIdle(replay, LIVE_FLUSH_IDLE_MS, () => backfillDrained && buffered.size > 0, flushBuffered);
    for await (const event of events) {
      if (abortSignal?.aborted) {
        log("info", "Abort signal received, stopping");
        break;
      }
      /* Live writes wait for the final flush, so its INSERT cannot undo a live delete. */
      if (backfillCheckpoint) await settleBackfillCheckpoint();

      if (event.type === "account") {
        const account = event.account;
        stats.accountsProcessed++;
        observer?.onRecord?.({
          slot: account.slot,
          id: account.addressHex,
        });

        if (stats.accountsProcessed <= 3) {
          log(
            "info",
            `Account ${stats.accountsProcessed}: ${account.addressHex}, slot=${account.slot}, dataLen=${account.data.length}`
          );
        }

        if (account.isDelete) {
          log("debug", `Account deleted: ${account.addressHex}`);
          const idValue = encodeAddress(account.address);
          buffered.delete(idValue);
          observer?.onPhase?.({ phase: "commit", slot: account.slot });
          try {
            await db.delete(stream.table).where(eq(table[idField], idValue));
            stats.accountsDeleted++;
            observer?.onBatchCommitted?.({ slot: account.slot, count: 1 });
            handledAnyAccount = true;
            log("info", `Deleted row for account ${account.addressHex}`);
            if (account.slot > lastProcessedSlot) {
              lastProcessedSlot = account.slot;
            }
          } catch (err) {
            observer?.onError?.("commit", err);
            log("error", `Failed to delete account ${account.addressHex}: ${err}`);
            throw err;
          } finally { observer?.onPhase?.({ phase: null }); }
          continue;
        }

        let parsed;
        try {
          parsed = stream.parse(account);
        } catch (parseErr) {
          observer?.onParserError?.(parseErr);
          observer?.onError?.("parse", parseErr);
          throw parseErr;
        }
        if (!parsed) {
          observer?.onParserNull?.();
          log(
            "debug",
            `Skipped account ${account.addressHex} - parser returned null (dataLen=${account.data.length})`
          );
          continue;
        }

        if (validateParse) {
          const validation = validateParsedData(stream.schema, parsed, stream.name);
          if (!validation.success) {
            observer?.onParseValidationError?.(validation.error);
            log("error", validation.error);
            continue;
          }
        }

        buffered.set((parsed as Record<string, unknown>)[idField], parsed as Record<string, unknown>);
        if (buffered.size >= WRITE_BATCH) await flushBuffered();
        if (stats.accountsProcessed % 100 === 0) {
          log(
            "info",
            `Processed ${stats.accountsProcessed} accounts, updated ${stats.accountsUpdated}`
          );
        }
      } else if (event.type === "blockFinished") {
        const slot = event.block.slot;
        if (slot > streamSlot) streamSlot = slot;
        if (!backfillDrained) {
          log("debug", `Block finished: slot ${slot}, backfill still running; no checkpoint`);
          continue;
        }
        /* The block's rows are written before its checkpoint. */
        await flushBuffered();
        if (handledAnyAccount) {
          const checkpoint = checkpointSlot();
          await updateCheckpoint(db, checkpointName, checkpoint, null);
          observer?.onCheckpoint?.({ slot: checkpoint });
          log(
            "debug",
            `Block finished: slot ${slot}, checkpoint saved at account slot ${checkpoint}`
          );
        } else {
          log(
            "debug",
            `Block finished: slot ${slot}, no checkpoint yet (no accounts handled)`
          );
        }
        observer?.onProgress?.({ slot });
      }
    }

    await settleBackfillCheckpoint();
    await flushBuffered();
    if (backfillDrained && handledAnyAccount) {
      const checkpoint = checkpointSlot();
      await updateCheckpoint(db, checkpointName, checkpoint, null);
      observer?.onCheckpoint?.({ slot: checkpoint });
      log("info", `Final checkpoint saved: slot ${checkpoint}`);
    }
  } catch (err) {
    /* A flush failure was already logged; the error being handled wins. */
    await settleBackfillCheckpoint().catch(() => {});
    if (abortSignal?.aborted) {
      log("info", "Stream aborted");
    } else {
      log(
        "error",
        `Stream error: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }
  } finally {
    abortSignal?.removeEventListener("abort", stopReplay);
    /* Ends a replay still waiting on its stream, e.g. after a failed idle flush. */
    stopReplay();
  }

  log(
    "info",
    `Finished. Processed: ${stats.accountsProcessed}, Updated: ${stats.accountsUpdated}, Deleted: ${stats.accountsDeleted}`
  );

  return stats;
}
