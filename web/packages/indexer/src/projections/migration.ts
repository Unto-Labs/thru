import type { Sql, TransactionSql } from 'postgres';
/** Additive SDK metadata tables. Call from the application's migration job. */
export async function migrateProjectionStorage(sql: Sql | TransactionSql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS indexer_namespaces (
      id text PRIMARY KEY, identity jsonb NOT NULL, source_generation bigint NOT NULL DEFAULT 1,
      active_generation bigint, writer_fence bigint NOT NULL DEFAULT 0, batch_seq bigint NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS indexer_generations (
      namespace_id text NOT NULL REFERENCES indexer_namespaces(id), generation bigint GENERATED ALWAYS AS IDENTITY,
      status text NOT NULL CHECK(status IN ('building','active','retired')), created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(namespace_id,generation));
    CREATE TABLE IF NOT EXISTS indexer_outbox (
      namespace_id text NOT NULL, batch_seq bigint NOT NULL, generation bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL, PRIMARY KEY(namespace_id,batch_seq));
    CREATE TABLE IF NOT EXISTS indexer_raw_events (
      namespace_id text NOT NULL, source_generation bigint NOT NULL, event_id text NOT NULL,
      slot numeric(20,0) NOT NULL, payload bytea NOT NULL, envelope jsonb NOT NULL,
      PRIMARY KEY(namespace_id,source_generation,event_id));
    CREATE TABLE IF NOT EXISTS indexer_quarantine (
      namespace_id text NOT NULL, source_generation bigint NOT NULL, id text NOT NULL,
      reason text NOT NULL,payload bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(namespace_id,source_generation,id));
    CREATE TABLE IF NOT EXISTS indexer_projection_progress (
      namespace_id text NOT NULL, source_generation bigint NOT NULL, projection_generation bigint NOT NULL,
      lane text NOT NULL,slot numeric(20,0) NOT NULL,event_id text,
      PRIMARY KEY(namespace_id,source_generation,projection_generation,lane));
  `);
}
