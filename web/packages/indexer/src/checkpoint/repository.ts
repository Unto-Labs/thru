/**
 * Checkpoint repository for reading and updating stream checkpoints.
 */

import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../schema/types";
import { checkpointTable, type Checkpoint } from "./table";

/**
 * Get the checkpoint for a specific stream.
 * Returns null if no checkpoint exists yet.
 *
 * @param db - Database client
 * @param streamName - Name of the stream
 * @returns Checkpoint or null if not found
 */
export async function getCheckpoint(
  db: DatabaseClient,
  streamName: string
): Promise<Checkpoint | null> {
  const [row] = await db
    .select()
    .from(checkpointTable)
    .where(eq(checkpointTable.streamName, streamName))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    slot: row.lastIndexedSlot,
    eventId: row.lastEventId,
  };
}

/**
 * Update the checkpoint for a specific stream.
 * Uses upsert to handle both insert and update cases.
 *
 * @param db - Database client (can be a transaction)
 * @param streamName - Name of the stream
 * @param slot - Last indexed slot number
 * @param eventId - Last event ID (optional)
 */
export async function updateCheckpoint(
  db: DatabaseClient,
  streamName: string,
  slot: bigint,
  eventId: string | null = null
): Promise<void> {
  await db
    .insert(checkpointTable)
    .values({
      streamName,
      lastIndexedSlot: slot,
      lastEventId: eventId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: checkpointTable.streamName,
      set: {
        lastIndexedSlot: slot,
        lastEventId: eventId,
        updatedAt: new Date(),
      },
    });
}

/**
 * Delete the checkpoint for a specific stream.
 * Use with caution - this will cause the stream to re-index from the start.
 *
 * @param db - Database client
 * @param streamName - Name of the stream
 */
export async function deleteCheckpoint(
  db: DatabaseClient,
  streamName: string
): Promise<void> {
  await db
    .delete(checkpointTable)
    .where(eq(checkpointTable.streamName, streamName));
}

/**
 * Get all checkpoints.
 * Useful for monitoring and debugging.
 *
 * @param db - Database client
 * @returns Array of checkpoints with stream names
 */
export async function getAllCheckpoints(
  db: DatabaseClient
): Promise<Array<{ streamName: string; checkpoint: Checkpoint }>> {
  const rows = await db.select().from(checkpointTable);

  return rows.map((row) => ({
    streamName: row.streamName,
    checkpoint: {
      slot: row.lastIndexedSlot,
      eventId: row.lastEventId,
    },
  }));
}
