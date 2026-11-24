import { sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { DeliveryBatch } from '../delivery/outbox';
const bytes = customType<{data: Buffer}>({dataType: () => 'bytea'});
/* Drizzle mirrors of PROJECTION_STORAGE_SQL (migration.ts); the SQL is authoritative. */
const projectionIdentity = pgTable('indexer_identity', {
  singleton: boolean('singleton').primaryKey().default(true),
  chainId: bigint('chain_id', {mode:'number'}).notNull(), program: text('program').notNull(), identity: jsonb('identity').notNull(),
  epoch: bigint('epoch',{mode:'bigint'}).notNull().default(1n),
  writerFence: bigint('writer_fence',{mode:'bigint'}).notNull().default(0n),
  batchSeq: bigint('batch_seq',{mode:'bigint'}).notNull().default(0n),
  activatedSlot: numeric('activated_slot',{precision:20,scale:0}),
  ready: boolean('ready').notNull().default(false), readyAt: timestamp('ready_at',{withTimezone:true}),
  resetReason: text('reset_reason').notNull(), resetDetail: jsonb('reset_detail'),
  resetAt: timestamp('reset_at',{withTimezone:true}).notNull().defaultNow(), resetRequested: text('reset_requested'),
  anchorSlot: numeric('anchor_slot',{precision:20,scale:0}), anchorHash: text('anchor_hash'), storageId: text('storage_id'),
  updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
}, t => [check('indexer_identity_singleton_check', sql`${t.singleton}`)]);
const projectionOutbox = pgTable('indexer_outbox', {
  batchSeq: bigint('batch_seq',{mode:'bigint'}).primaryKey(), epoch: bigint('epoch',{mode:'bigint'}).notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), payload: jsonb('payload').$type<DeliveryBatch>().notNull(),
});
const projectionEvents = pgTable('indexer_raw_events', {
  eventId: text('event_id').primaryKey(), slot: numeric('slot',{precision:20,scale:0}).notNull(),
  payload: bytes('payload').notNull(), envelope: jsonb('envelope').notNull(),
});
const projectionQuarantine = pgTable('indexer_quarantine', {
  id: text('id').primaryKey(), reason: text('reason').notNull(),
  payload: bytes('payload').notNull(), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
const projectionProgress = pgTable('indexer_projection_progress', {
  lane: text('lane').primaryKey(), slot: numeric('slot',{precision:20,scale:0}).notNull(), eventId: text('event_id'),
  live: boolean('live').notNull().default(false),
});
/** Drizzle views of the writer's tables. Neither importing this schema nor
    defining a projection opens a database. */
export const projectionStorage = { projectionIdentity, projectionOutbox, projectionEvents, projectionQuarantine, projectionProgress };
