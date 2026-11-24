import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Sql } from 'postgres';

/** One numbered schema migration. `minBinary` is the oldest binary schema
    version that may still run against the schema once this migration is
    applied: an expand migration keeps the previous floor, a contract
    migration raises it to the first binary that stopped using what it drops. */
export interface SchemaMigration {
  version: number;
  name: string;
  minBinary: number;
  sql: string;
  checksum: string;
}
export interface AppliedMigration {
  version: number; name: string; checksum: string; minBinary: number; appliedAt: string;
}
export interface SchemaState {
  /** Highest applied version (0 when the table is missing or empty). */
  version: number;
  /** Highest min_binary over the applied migrations (0 when none). */
  floor: number;
  applied: AppliedMigration[];
}
export type SchemaErrorCode =
  | 'SCHEMA_MISSING' | 'SCHEMA_BEHIND' | 'SCHEMA_NEWER' | 'SCHEMA_GAP' | 'CHECKSUM_MISMATCH' | 'INVALID_MIGRATION' | 'LOCK_TIMEOUT';
export class SchemaError extends Error {
  constructor(readonly code: SchemaErrorCode, message: string) { super(`${code}: ${message}`); }
}

export const MIGRATIONS_TABLE = 'indexer_schema_migrations';
const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const HEADER = /^--\s*min-binary:\s*(\d+)\s*$/m;

export function migrationChecksum(sql: string) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Parses `NNNN_name.sql` text; the leading comment block must declare `-- min-binary: N`. */
export function parseMigration(file: string, sql: string): SchemaMigration {
  const m = FILE.exec(file);
  if (!m) throw new SchemaError('INVALID_MIGRATION', `${file}: name must be NNNN_lower_snake.sql`);
  const version = Number(m[1]);
  const head = sql.split('\n').filter(l => l.startsWith('--')).join('\n');
  const h = HEADER.exec(head);
  if (!h) throw new SchemaError('INVALID_MIGRATION', `${file}: missing "-- min-binary: N" header`);
  const minBinary = Number(h[1]);
  if (version < 1 || minBinary < 1 || minBinary > version)
    throw new SchemaError('INVALID_MIGRATION', `${file}: min-binary must be between 1 and its own version`);
  return { version, name: m[2], minBinary, sql, checksum: migrationChecksum(sql) };
}

/** Every `NNNN_*.sql` in `dir`, checked to be dense from 1 with non-decreasing floors. */
export function loadMigrations(dir: URL | string): SchemaMigration[] {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql') && FILE.test(f)).sort();
  const base = typeof dir === 'string' ? dir.replace(/\/?$/, '/') : dir;
  return validateMigrations(files.map(f => parseMigration(f, readFileSync(typeof base === 'string' ? base + f : new URL(f, base), 'utf8'))));
}
export function validateMigrations(migrations: SchemaMigration[]) {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) throw new SchemaError('INVALID_MIGRATION', `migrations must be numbered 1..n without gaps (found ${m.version} at position ${i + 1})`);
    if (i && m.minBinary < sorted[i - 1].minBinary)
      throw new SchemaError('INVALID_MIGRATION', `${m.version}: min-binary may not decrease`);
  });
  if (!sorted.length) throw new SchemaError('INVALID_MIGRATION', 'no migrations');
  return sorted;
}
export const binaryVersion = (migrations: SchemaMigration[]) => migrations.reduce((v, m) => Math.max(v, m.version), 0);

/** The applied migrations, or version 0 when the table does not exist yet. */
export async function schemaState(sql: Sql): Promise<SchemaState> {
  const [{ exists }] = await sql`SELECT to_regclass(${MIGRATIONS_TABLE}) IS NOT NULL AS exists`;
  if (!exists) return { version: 0, floor: 0, applied: [] };
  const rows = await sql`SELECT version,name,checksum,min_binary,applied_at::text AS applied_at FROM indexer_schema_migrations ORDER BY version`;
  const applied = rows.map(r => ({ version: Number(r.version), name: r.name as string, checksum: r.checksum as string,
    minBinary: Number(r.min_binary), appliedAt: r.applied_at as string }));
  return {
    version: applied.reduce((v, r) => Math.max(v, r.version), 0),
    floor: applied.reduce((v, r) => Math.max(v, r.minBinary), 0),
    applied,
  };
}

/** Checks a database's applied migrations against this binary's list.
    Returns the versions the database has beyond the binary (all of which
    the floor allows). Throws on a gap, an edited migration, or a floor
    above the binary. */
export function compareSchema(state: SchemaState, migrations: SchemaMigration[]) {
  const own = binaryVersion(migrations);
  state.applied.forEach((a, i) => {
    if (a.version !== i + 1) throw new SchemaError('SCHEMA_GAP', `applied migrations are not contiguous at ${a.version}`);
  });
  for (const a of state.applied) {
    const m = migrations.find(x => x.version === a.version);
    if (m && m.checksum !== a.checksum)
      throw new SchemaError('CHECKSUM_MISMATCH', `migration ${a.version} (${a.name}) differs from the one applied; never edit an applied migration`);
  }
  if (state.floor > own)
    throw new SchemaError('SCHEMA_NEWER', `database schema ${state.version} requires a binary of schema version >= ${state.floor}; this binary has ${own}`);
  return state.applied.filter(a => a.version > own).map(a => a.version);
}

/** Startup check for a worker or API: the schema must be migrated to at least
    this binary's version, and its floor must not exceed it. */
export async function assertSchemaCompatible(sql: Sql, migrations: SchemaMigration[]) {
  const state = await schemaState(sql);
  const own = binaryVersion(migrations);
  if (!state.version) throw new SchemaError('SCHEMA_MISSING', 'no schema migrations applied; run the image\'s `provision` (or `migrate`) command first');
  const ahead = compareSchema(state, migrations);
  if (state.version < own)
    throw new SchemaError('SCHEMA_BEHIND', `database schema ${state.version} is older than this binary (${own}); run the image's \`provision\` command first`);
  return { ...state, binary: own, ahead };
}

const lockKey = (name: string) => `thru-indexer:migrate:${name}`;
/** The advisory-lock SQL fragment shared with role grants: one lock per schema. */
export async function migrationXactLock(tx: Sql, name: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(name)}||':'||current_schema(),0))`;
}

export interface MigrateResult { before: number; after: number; floor: number; applied: number[]; ahead: number[]; binary: number }
/** Applies pending migrations under a session advisory lock, each in its own
    transaction together with its row. Idempotent: a second run applies
    nothing. Refuses gaps, edited migrations and a floor above this binary;
    a database ahead of the binary by migrations its floor allows is left as
    is (an image rollback across expand migrations). */
export async function migrateSchema(pool: Sql, migrations: SchemaMigration[], options: {
  name: string; lockTimeoutMs?: number; log?: (event: Record<string, unknown>) => void;
}): Promise<MigrateResult> {
  const ordered = validateMigrations(migrations);
  const own = binaryVersion(ordered);
  const log = options.log ?? (() => {});
  const sql = await pool.reserve();
  const key = lockKey(options.name);
  let locked = false;
  try {
    const deadline = Date.now() + (options.lockTimeoutMs ?? 600_000);
    for (;;) {
      const [r] = await sql`SELECT pg_try_advisory_lock(hashtextextended(${key}||':'||current_schema(),0)) AS held`;
      if (r.held) { locked = true; break; }
      if (Date.now() > deadline) throw new SchemaError('LOCK_TIMEOUT', 'another migrator holds the schema lock');
      log({ event: 'schema_migrate_waiting' });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version integer PRIMARY KEY CHECK (version > 0), name text NOT NULL, checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      min_binary integer NOT NULL CHECK (min_binary BETWEEN 1 AND version),
      applied_at timestamptz NOT NULL DEFAULT now(), applied_by text NOT NULL DEFAULT current_user)`);
    const state = await schemaState(sql as unknown as Sql);
    const ahead = compareSchema(state, ordered);
    const applied: number[] = [];
    if (ahead.length) log({ event: 'schema_ahead_compatible', database: state.version, binary: own, floor: state.floor, ahead });
    for (const m of ordered.filter(x => x.version > state.version)) {
      await sql`BEGIN`;
      try {
        await sql.unsafe(m.sql);
        await sql`INSERT INTO indexer_schema_migrations(version,name,checksum,min_binary) VALUES(${m.version},${m.name},${m.checksum},${m.minBinary})`;
        await sql`COMMIT`;
      } catch (e) {
        await sql`ROLLBACK`.catch(() => {});
        throw e;
      }
      applied.push(m.version);
      log({ event: 'schema_migration_applied', version: m.version, name: m.name, minBinary: m.minBinary, checksum: m.checksum });
    }
    const after = await schemaState(sql as unknown as Sql);
    return { before: state.version, after: after.version, floor: after.floor, applied, ahead, binary: own };
  } finally {
    if (locked) await sql`SELECT pg_advisory_unlock(hashtextextended(${key}||':'||current_schema(),0))`.catch(() => {});
    sql.release();
  }
}
