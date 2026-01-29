/**
 * Account stream processor.
 *
 * Processes account state from @thru/replay and commits to the database
 * with slot-aware upserts and checkpointing.
 */

import { sql } from "drizzle-orm";
import type { ChainClientFactory } from "@thru/replay";
import { createAccountsByOwnerReplay, AccountView } from "@thru/replay";
import type { DatabaseClient } from "../schema/types";
import { validateParsedData } from "../schema/validation";
import { getCheckpoint, updateCheckpoint } from "../checkpoint";
import type { AccountStream } from "./types";

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
  /** Validate parse output with Zod (useful for development) */
  validateParse?: boolean;
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
// Utilities
// ============================================================

function shouldLog(level: string, minLevel: string): boolean {
  const levels = ["debug", "info", "warn", "error"];
  return levels.indexOf(level) >= levels.indexOf(minLevel);
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
  const { clientFactory, db, logLevel = "info", validateParse = false } = options;
  const checkpointName = `account:${stream.name}`;

  const log = (
    level: string,
    msg: string,
    meta?: Record<string, unknown>
  ) => {
    if (shouldLog(level, logLevel)) {
      console.log(
        `[account-stream:${stream.name}] ${msg}`,
        meta ?? ""
      );
    }
  };

  const stats: AccountProcessorStats = {
    accountsProcessed: 0,
    accountsUpdated: 0,
    accountsDeleted: 0,
  };

  // Load checkpoint for resumable backfill
  const checkpoint = await getCheckpoint(db, checkpointName);
  const minUpdatedSlot = checkpoint?.slot ?? undefined;
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
      onBackfillComplete: (highestSlot) => {
        log(
          "info",
          `Backfill complete. Highest slot: ${highestSlot}, accounts processed: ${stats.accountsProcessed}`
        );
        lastProcessedSlot = highestSlot;
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

        // Log first few accounts for debugging
        if (stats.accountsProcessed <= 3) {
          log(
            "info",
            `Account ${stats.accountsProcessed}: ${account.addressHex}, slot=${account.slot}, dataLen=${account.data.length}`
          );
        }

        // Parse using stream's parser
        const parsed = stream.parse(account);
        if (!parsed) {
          log(
            "debug",
            `Skipped account ${account.addressHex} - parser returned null (dataLen=${account.data.length})`
          );
          continue;
        }

        // Validate parse output if enabled
        if (validateParse) {
          const validation = validateParsedData(stream.schema, parsed, stream.name);
          if (!validation.success) {
            log("error", validation.error);
            continue; // Skip invalid accounts
          }
        }

        if (account.isDelete) {
          log("debug", `Account deleted: ${account.addressHex}`);
          stats.accountsDeleted++;
          // Optionally delete from DB - for now we skip
          continue;
        }

        // Slot-aware upsert: only update if incoming slot >= existing slot
        const table = stream.table as any;
        const idField = stream.api?.idField ?? "address";

        try {
          await db
            .insert(stream.table)
            .values(parsed)
            .onConflictDoUpdate({
              target: table[idField],
              set: parsed,
              where: sql`${table.slot} <= ${(parsed as any).slot}`,
            });

          stats.accountsUpdated++;

          if (stats.accountsUpdated <= 3) {
            log(
              "info",
              `Successfully inserted account ${stats.accountsUpdated}`
            );
          }
        } catch (err) {
          log(
            "error",
            `Failed to upsert account ${account.addressHex}: ${err}`
          );
        }

        // Track highest slot for checkpoint
        if (account.slot > lastProcessedSlot) {
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
        // Persist checkpoint at block boundaries
        const slot = event.block.slot;
        if (slot > lastProcessedSlot) {
          lastProcessedSlot = slot;
        }
        await updateCheckpoint(db, checkpointName, lastProcessedSlot, null);
        log("debug", `Block finished: slot ${slot}, checkpoint saved`);
      }
    }

    // Final checkpoint save
    if (lastProcessedSlot > 0n) {
      await updateCheckpoint(db, checkpointName, lastProcessedSlot, null);
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
