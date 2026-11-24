import { afterAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSchemaCompatible, compareSchema, loadMigrations, migrateSchema, parseMigration, schemaState, SchemaError, validateMigrations,
} from './schema-migrations';

const m1 = parseMigration('0001_init.sql', '-- min-binary: 1\nCREATE TABLE t_a(id int PRIMARY KEY);');
const m2expand = parseMigration('0002_add_b.sql', '-- min-binary: 1\n-- expand: a new nullable column\nALTER TABLE t_a ADD COLUMN b text;');
const m3contract = parseMigration('0003_drop_b.sql', '-- min-binary: 3\nALTER TABLE t_a DROP COLUMN b;');

describe('migration files', () => {
  it('requires NNNN_name.sql and a min-binary header within range', () => {
    expect(() => parseMigration('1_x.sql', '-- min-binary: 1\n')).toThrow('NNNN');
    expect(() => parseMigration('0001_x.sql', 'CREATE TABLE x();')).toThrow('min-binary');
    expect(() => parseMigration('0001_x.sql', '-- min-binary: 2\n')).toThrow('between 1');
    expect(m2expand).toMatchObject({ version: 2, name: 'add_b', minBinary: 1 });
    expect(m2expand.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
  it('loads a directory densely and refuses gaps or a decreasing floor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    writeFileSync(join(dir, '0001_init.sql'), m1.sql);
    writeFileSync(join(dir, '0002_add_b.sql'), m2expand.sql);
    writeFileSync(join(dir, 'README.md'), 'ignored');
    expect(loadMigrations(dir).map(m => m.version)).toEqual([1, 2]);
    expect(() => validateMigrations([m1, m3contract])).toThrow('without gaps');
    expect(() => validateMigrations([m1, m3contract, { ...m2expand, version: 4, minBinary: 2 }].map((m, i) => ({ ...m, version: i + 1 })))).toThrow('may not decrease');
  });
  it('compares an applied schema to a binary: ahead but allowed, newer floor, edited migration, gap', () => {
    const applied = (ms: typeof m1[]) => ({ version: ms.length, floor: Math.max(...ms.map(m => m.minBinary)),
      applied: ms.map(m => ({ version: m.version, name: m.name, checksum: m.checksum, minBinary: m.minBinary, appliedAt: '' })) });
    expect(compareSchema(applied([m1, m2expand]), [m1])).toEqual([2]);
    expect(() => compareSchema(applied([m1, m2expand, m3contract]), [m1, m2expand])).toThrow(SchemaError);
    expect(() => compareSchema(applied([m1, m2expand, m3contract]), [m1, m2expand])).toThrow('SCHEMA_NEWER');
    expect(() => compareSchema(applied([{ ...m1, checksum: 'f'.repeat(64) }]), [m1])).toThrow('CHECKSUM_MISMATCH');
    expect(() => compareSchema({ ...applied([m1, m2expand]), applied: applied([m1, m2expand]).applied.slice(1) }, [m1, m2expand])).toThrow('SCHEMA_GAP');
  });
});

const url = process.env.TEST_DATABASE_URL;
const admin = url ? postgres(url, { max: 2, onnotice: () => {} }) : null!;
const dbs: { name: string; sql: Sql }[] = [];
async function freshDb() {
  const name = `idx_migr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const u = new URL(url!); u.pathname = `/${name}`;
  const sql = postgres(u.toString(), { max: 6, onnotice: () => {} });
  dbs.push({ name, sql });
  return sql;
}
afterAll(async () => {
  for (const d of dbs) { await d.sql.end(); await admin.unsafe(`DROP DATABASE IF EXISTS ${d.name} WITH (FORCE)`); }
  await admin?.end();
});

describe.skipIf(!url)('migrateSchema (real Postgres)', () => {
  it('applies once, is a no-op the second time, and serializes concurrent migrators', async () => {
    const sql = await freshDb();
    const runs = await Promise.all([1, 2, 3].map(() => migrateSchema(sql, [m1, m2expand], { name: 'test' })));
    expect(runs.flatMap(r => r.applied).sort()).toEqual([1, 2]);
    const again = await migrateSchema(sql, [m1, m2expand], { name: 'test' });
    expect(again).toMatchObject({ before: 2, after: 2, applied: [], floor: 1 });
    expect((await schemaState(sql)).applied.map(a => a.version)).toEqual([1, 2]);
  });
  it('rolls a failing migration back with its row, leaving the earlier ones applied', async () => {
    const sql = await freshDb();
    const bad = parseMigration('0002_bad.sql', '-- min-binary: 1\nALTER TABLE t_a ADD COLUMN c int;\nSELECT 1/0;');
    await expect(migrateSchema(sql, [m1, bad], { name: 'test' })).rejects.toThrow();
    expect((await schemaState(sql)).version).toBe(1);
    const [col] = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='t_a' AND column_name='c'`;
    expect(col.n).toBe(0);
  });
  it('lets an older binary run over expand-only migrations, and refuses one older than a contract floor', async () => {
    const sql = await freshDb();
    await migrateSchema(sql, [m1, m2expand], { name: 'test' });
    /* Image rollback to the binary that only knows 0001: compatible. */
    const rolledBack = await migrateSchema(sql, [m1], { name: 'test' });
    expect(rolledBack).toMatchObject({ applied: [], ahead: [2], binary: 1 });
    expect((await assertSchemaCompatible(sql, [m1])).ahead).toEqual([2]);
    await migrateSchema(sql, [m1, m2expand, m3contract], { name: 'test' });
    await expect(migrateSchema(sql, [m1], { name: 'test' })).rejects.toThrow('SCHEMA_NEWER');
    await expect(assertSchemaCompatible(sql, [m1])).rejects.toThrow('SCHEMA_NEWER');
    await expect(assertSchemaCompatible(sql, [m1, m2expand])).rejects.toThrow('SCHEMA_NEWER');
    expect((await assertSchemaCompatible(sql, [m1, m2expand, m3contract])).version).toBe(3);
  });
  it('refuses a binary whose schema is not applied yet, and an edited migration', async () => {
    const sql = await freshDb();
    await expect(assertSchemaCompatible(sql, [m1])).rejects.toThrow('SCHEMA_MISSING');
    await migrateSchema(sql, [m1], { name: 'test' });
    await expect(assertSchemaCompatible(sql, [m1, m2expand])).rejects.toThrow('SCHEMA_BEHIND');
    const edited = parseMigration('0001_init.sql', '-- min-binary: 1\nCREATE TABLE t_a(id bigint PRIMARY KEY);');
    await expect(migrateSchema(sql, [edited], { name: 'test' })).rejects.toThrow('CHECKSUM_MISMATCH');
  });
});
