import {
  pgTable,
  text,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Per-stream checkpoint table.
 * Each stream has its own checkpoint keyed by stream name.
 *
 * This table should be included in your Drizzle migrations.
 */
export const checkpointTable = pgTable("indexer_checkpoints", {
  /** Stream name (primary key) */
  streamName: text("stream_name").primaryKey(),
  /** Last indexed slot number */
  lastIndexedSlot: bigint("last_indexed_slot", { mode: "bigint" }).notNull(),
  /** Last event ID (for cursor-based resume) */
  lastEventId: text("last_event_id"),
  /** When the checkpoint was last updated */
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Checkpoint data structure.
 */
export interface Checkpoint {
  /** Last indexed slot number */
  slot: bigint;
  /** Last event ID (for cursor-based resume) */
  eventId: string | null;
}
