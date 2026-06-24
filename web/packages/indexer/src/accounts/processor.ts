/**
 * Account stream processor.
 *
 * Processes account state from @thru/replay and commits to the database
 * with slot-aware upserts and checkpointing.
 */

import { eq, sql } from "drizzle-orm";
import type { ChainClientFactory, ReplayLogger } from "@thru/replay";
import { createAccountsByOwnerReplay, AccountView } from "@thru/replay";
import { encodeAddress } from "@thru/sdk/helpers";
import type { DatabaseClient } from "../schema/types";
import { validateParsedData } from "../schema/validation";
import { getCheckpoint, updateCheckpoint } from "../checkpoint";
import type { AccountStream } from "./types";
import type { ProcessorStatusObserver } from "../runtime/status";
import { createScopedLogger } from "../runtime/logger";

// ============================================================
// Types
// ============================================================

export interface AccountProcessorOptions {
  /** Factory to create fresh chain clients for reconnection */
  clientFactory: ChainClientFactory;
  /** Database client */
  db: DatabaseClient;
  /** Log level */
  logLevel?: "debug" | "info" | "warn" | "error";
  /** Structured logger for processor and replay lifecycle logs */
  logger?: ReplayLogger;
  /** Validate parse output with Zod (useful for development) */
  validateParse?: boolean;
  /** Runtime status observer */
  observer?: ProcessorStatusObserver;
}

export interface AccountProcessorStats {
  /** Total accounts processed */
  accountsProcessed: number;
  /** Total accounts inserted/updated */
  accountsUpdated: number;
  /** Total accounts deleted */
  accountsDeleted: number;
}

// ============================================================
// Processor
// ============================================================

/**
 * Run an account stream processor.
 *
 * Backfills all accounts via ListAccounts, then streams live updates.
 * Supports resumable indexing via checkpoint persistence.
 *
 * @param stream - The account stream to process
 * @param options - Processor configuration
 * @param abortSignal - Optional signal to stop processing
 * @returns Processor statistics
 */
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

  // Load checkpoint for resumable backfill
  const checkpoint = await getCheckpoint(db, checkpointName);
  const minUpdatedSlot = checkpoint?.slot;
  observer?.onStart?.({
    startSlot: minUpdatedSlot,
    checkpointSlot: checkpoint?.slot ?? null,
  });
  if (minUpdatedSlot) {
    log("info", `Resuming from checkpoint: slot ${minUpdatedSlot}`);
  }

  log("info", `Starting account stream: ${stream.description}`);
  if (stream.expectedSize) {
    log("info", `Expected data size: ${stream.expectedSize} bytes`);
  }

  // Track highest slot seen for checkpoint persistence
  let lastProcessedSlot = minUpdatedSlot ?? 0n;

  try {
    // Use createAccountsByOwnerReplay for hybrid backfill + streaming
    const replay = createAccountsByOwnerReplay({
      clientFactory,
      owner: stream.getOwnerProgram(),
      view: AccountView.FULL,
      dataSizes: stream.dataSizes ?? (stream.expectedSize ? [stream.expectedSize] : undefined),
      minUpdatedSlot,
      logger,
      signal: abortSignal,
      onBackfillComplete: (highestSlot) => {
        log(
          "info",
          `Backfill complete. Highest slot: ${highestSlot}, accounts processed: ${stats.accountsProcessed}`
        );
      },
    });

    for await (const event of replay) {
      if (abortSignal?.aborted) {
        log("info", "Abort signal received, stopping");
        break;
      }

      if (event.type === "account") {
        const account = event.account;
        stats.accountsProcessed++;
        observer?.onRecord?.({
          slot: account.slot,
          id: account.addressHex,
        });

        // Log first few accounts for debugging
        if (stats.accountsProcessed <= 3) {
          log(
            "info",
            `Account ${stats.accountsProcessed}: ${account.addressHex}, slot=${account.slot}, dataLen=${account.data.length}`
          );
        }

        const table = stream.table as any;
        const idField = stream.api?.idField ?? "address";

        // Handle account deletions before parsing — deleted accounts have
        // zeroed data so parse() would return null and the delete would be
        // silently skipped.
        if (account.isDelete) {
          log("debug", `Account deleted: ${account.addressHex}`);
          const idValue = encodeAddress(account.address);
          try {
            await db.delete(stream.table).where(eq(table[idField], idValue));
            stats.accountsDeleted++;
            observer?.onCheckpoint?.({ slot: account.slot });
            log("info", `Deleted row for account ${account.addressHex}`);
            if (account.slot > lastProcessedSlot) {
              lastProcessedSlot = account.slot;
            }
          } catch (err) {
            observer?.onError?.("commit", err);
            log("error", `Failed to delete account ${account.addressHex}: ${err}`);
            throw err;
          }
          continue;
        }

        // Parse using stream's parser
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
          if (account.slot > lastProcessedSlot) {
            lastProcessedSlot = account.slot;
          }
          continue;
        }

        // Validate parse output if enabled
        if (validateParse) {
          const validation = validateParsedData(stream.schema, parsed, stream.name);
          if (!validation.success) {
            observer?.onParseValidationError?.(validation.error);
            log("error", validation.error);
            continue; // Skip invalid accounts
          }
        }

        // Slot-aware upsert: only update if incoming slot >= existing slot

        let upserted = false;
        try {
          const upsertedRows = await db
            .insert(stream.table)
            .values(parsed)
            .onConflictDoUpdate({
              target: table[idField],
              set: parsed,
              where: sql`${table.slot} <= ${(parsed as any).slot}`,
            })
            .returning();

          upserted = upsertedRows.length > 0;
          if (upserted) {
            stats.accountsUpdated++;
          }

          if (upserted && stats.accountsUpdated <= 3) {
            log(
              "info",
              `Successfully inserted account ${stats.accountsUpdated}`
            );
          }
        } catch (err) {
          observer?.onError?.("commit", err);
          log(
            "error",
            `Failed to upsert account ${account.addressHex}: ${err}`
          );
          throw err;
        }

        // Track highest slot for checkpoint
        if (upserted && account.slot > lastProcessedSlot) {
          lastProcessedSlot = account.slot;
        }

        // Progress logging
        if (stats.accountsProcessed % 100 === 0) {
          log(
            "info",
            `Processed ${stats.accountsProcessed} accounts, updated ${stats.accountsUpdated}`
          );
        }
      } else if (event.type === "blockFinished") {
        // Persist at block boundaries, but do not advance the checkpoint to
        // the block slot unless an account update was actually handled.
        const slot = event.block.slot;
        if (lastProcessedSlot > 0n) {
          await updateCheckpoint(db, checkpointName, lastProcessedSlot, null);
          observer?.onCheckpoint?.({ slot: lastProcessedSlot });
          log(
            "debug",
            `Block finished: slot ${slot}, checkpoint saved at account slot ${lastProcessedSlot}`
          );
        } else {
          log(
            "debug",
            `Block finished: slot ${slot}, no checkpoint yet (no accounts handled)`
          );
        }
      }
    }

    // Final checkpoint save
    if (lastProcessedSlot > 0n) {
      await updateCheckpoint(db, checkpointName, lastProcessedSlot, null);
      observer?.onCheckpoint?.({ slot: lastProcessedSlot });
      log("info", `Final checkpoint saved: slot ${lastProcessedSlot}`);
    }
  } catch (err) {
    if (abortSignal?.aborted) {
      log("info", "Stream aborted");
    } else {
      log(
        "error",
        `Stream error: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }
  }

  log(
    "info",
    `Finished. Processed: ${stats.accountsProcessed}, Updated: ${stats.accountsUpdated}, Deleted: ${stats.accountsDeleted}`
  );

  return stats;
}
