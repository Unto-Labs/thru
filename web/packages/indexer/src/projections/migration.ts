/** The projection writer's own tables, version 1. A service's first schema
    migration includes this text verbatim (between the BEGIN/END markers),
    and the service's tests assert that it still does; the migrator's
    checksum then covers it like the service's own tables.

    One database (or schema) holds exactly one dataset: there is no namespace.
    `indexer_identity` is a singleton: the chain, program and service identity
    the data belongs to, the epoch (changes only when the data is reset), the
    writer fence and the publication sequence. The chain anchor (a recent
    block's slot and hash) proves on restart that the RPC still serves the
    same chain, even when a regenesis kept the chain ID and the addresses.
    The storage ID (cluster system identifier and database OID) tells a
    restored or cloned database from the one the writer last used. */
export const PROJECTION_STORAGE_SQL = `-- BEGIN @thru/indexer projection storage v1
CREATE TABLE indexer_identity (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 chain_id bigint NOT NULL,
 program text NOT NULL,
 identity jsonb NOT NULL,
 epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
 writer_fence bigint NOT NULL DEFAULT 0,
 batch_seq bigint NOT NULL DEFAULT 0,
 activated_slot numeric(20,0),
 ready boolean NOT NULL DEFAULT false,
 ready_at timestamptz,
 reset_reason text NOT NULL,
 reset_detail jsonb,
 reset_at timestamptz NOT NULL DEFAULT now(),
 reset_requested text,
 anchor_slot numeric(20,0),
 anchor_hash text,
 storage_id text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE indexer_outbox (
 batch_seq bigint PRIMARY KEY, epoch bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL
);
CREATE TABLE indexer_raw_events (
 event_id text PRIMARY KEY, slot numeric(20,0) NOT NULL, payload bytea NOT NULL, envelope jsonb NOT NULL
);
CREATE INDEX indexer_raw_events_slot ON indexer_raw_events(slot);
CREATE TABLE indexer_quarantine (
 id text PRIMARY KEY, reason text NOT NULL, payload bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE indexer_projection_progress (
 lane text PRIMARY KEY, slot numeric(20,0) NOT NULL, event_id text, live boolean NOT NULL DEFAULT false
);
-- END @thru/indexer projection storage v1
`;
/** The writer's data tables (truncated on a reset), and the identity table. */
export const PROJECTION_TABLES = {
  identity: 'indexer_identity',
  data: ['indexer_outbox', 'indexer_raw_events', 'indexer_quarantine', 'indexer_projection_progress'],
  migrations: 'indexer_schema_migrations',
} as const;
