import { sql } from 'drizzle-orm';
import { bigint, check, customType, jsonb, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { DeliveryBatch } from '../delivery/outbox';
const bytes = customType<{data: Buffer}>({dataType: () => 'bytea'});
const namespace = () => text('namespace_id').notNull();
const source = () => bigint('source_generation', {mode:'bigint'}).notNull();
const projectionNamespaces = pgTable('indexer_namespaces', {
  id: text('id').primaryKey(), identity: jsonb('identity').notNull(),
  sourceGeneration: source().default(1n), activeGeneration: bigint('active_generation',{mode:'bigint'}),
  writerFence: bigint('writer_fence',{mode:'bigint'}).notNull().default(0n),
  batchSeq: bigint('batch_seq',{mode:'bigint'}).notNull().default(0n),
});
const projectionGenerations = pgTable('indexer_generations', {
  namespaceId: namespace().references(() => projectionNamespaces.id),
  generation: bigint('generation',{mode:'bigint'}).generatedAlwaysAsIdentity(),
  status: text('status').notNull(), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, t => [primaryKey({columns:[t.namespaceId,t.generation]}),check('indexer_generations_status_check',sql`${t.status} IN ('building','active','retired')`)]);
const projectionOutbox = pgTable('indexer_outbox', {
  namespaceId: namespace(), batchSeq: bigint('batch_seq',{mode:'bigint'}).notNull(),
  generation: bigint('generation',{mode:'bigint'}).notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), payload: jsonb('payload').$type<DeliveryBatch>().notNull(),
}, t => [primaryKey({columns:[t.namespaceId,t.batchSeq]})]);
const projectionEvents = pgTable('indexer_raw_events', {
  namespaceId: namespace(), sourceGeneration: source(), eventId: text('event_id').notNull(),
  slot: numeric('slot',{precision:20,scale:0}).notNull(), payload: bytes('payload').notNull(), envelope: jsonb('envelope').notNull(),
}, t => [primaryKey({columns:[t.namespaceId,t.sourceGeneration,t.eventId]})]);
const projectionQuarantine = pgTable('indexer_quarantine', {
  namespaceId: namespace(), sourceGeneration: source(), id: text('id').notNull(), reason: text('reason').notNull(),
  payload: bytes('payload').notNull(), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, t => [primaryKey({columns:[t.namespaceId,t.sourceGeneration,t.id]})]);
const projectionProgress = pgTable('indexer_projection_progress', {
  namespaceId: namespace(), sourceGeneration: source(), projectionGeneration: bigint('projection_generation',{mode:'bigint'}).notNull(),
  lane: text('lane').notNull(), slot: numeric('slot',{precision:20,scale:0}).notNull(), eventId: text('event_id'),
}, t => [primaryKey({columns:[t.namespaceId,t.sourceGeneration,t.projectionGeneration,t.lane]})]);
/** Spread into a Drizzle migration schema alongside domain tables, or run
    migrateProjectionStorage from an application's existing migration job.
    Neither importing this schema nor defining a projection opens a database. */
export const projectionStorage = { projectionNamespaces, projectionGenerations, projectionOutbox,
  projectionEvents, projectionQuarantine, projectionProgress };
