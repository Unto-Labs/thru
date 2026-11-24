/* The operator commands a projection service's image ships (`migrate`,
   `provision`, `schema-status`, `reset-request`, and the building blocks of
   `reconcile`), parameterized by service. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ChainClient, Event } from '@thru/replay';
import type { Sql } from 'postgres';
import { createPostgresClient } from '../postgres';
import { assertSchemaCompatible, loadMigrations, migrateSchema, migrationXactLock, schemaState, type SchemaMigration } from './schema-migrations';
import { requestReset } from './writer';

/* Command output: one JSON line on stdout (libraries here log through callers). */
const print = (line: unknown) => { process.stdout.write(`${JSON.stringify(line)}\n`); };
const open = (url: string) => createPostgresClient(url, { max: 1, onnotice: () => {} });
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export interface SchemaCommandsOptions {
  /** The migration lock's name (`thru-indexer:migrate:<name>`); `<name>_provisioned` is logged after `provision`. */
  name: string;
  /** The `service` field of every log line (e.g. `perps-indexer`). */
  service: string;
  /** The directory of `NNNN_*.sql` migrations shipped with the binary. */
  migrations: URL;
  /** The idempotent least-privilege roles script `provision` runs after migrating. */
  roles: URL;
  /** The runtime roles whose passwords `provision` sets, and the variables holding them. */
  passwords: { worker: { role: string; env: string }; api: { role: string; env: string } };
}

/** migrate, assertSchema, grantRoles, provision, status and the CLI of one service's schema. */
export function schemaCommands(o: SchemaCommandsOptions) {
  let loaded: SchemaMigration[] | undefined;
  const log = (event: Record<string, unknown>) => print({ service: o.service, ...event });
  /** This binary's schema migrations. */
  const migrations = () => loaded ??= loadMigrations(fileURLToPath(o.migrations));
  /** Applies pending migrations under the schema lock; refuses a schema newer than this binary. */
  async function migrate(url: string) {
    const sql = open(url);
    try {
      const result = await migrateSchema(sql, migrations(), { name: o.name, log });
      log({ event: 'schema_migrated', ...result });
      return result;
    } finally {
      await sql.end();
    }
  }
  /** Startup check for the worker and API (assertSchemaCompatible). */
  const assertSchema = (sql: Sql) => assertSchemaCompatible(sql, migrations());
  /** Least-privilege runtime roles, then their passwords, under the migration
      lock. Run as the schema owner after migrate. A password is set only when
      given, so a role whose credential is managed elsewhere is left alone. */
  async function grantRoles(url: string, passwords: { worker?: string; api?: string } = {}) {
    const sql = open(url);
    try {
      await sql.begin(async tx => {
        await migrationXactLock(tx as unknown as Sql, o.name);
        await tx.unsafe(await readFile(o.roles, 'utf8'));
        for (const [role, password] of [[o.passwords.worker.role, passwords.worker], [o.passwords.api.role, passwords.api]] as const) {
          if (!password) continue;
          if (password.length < 16) throw new Error(`${role} password must be at least 16 characters`);
          /* Utility statements take no bind parameters; quote_literal escapes. */
          const [{ literal }] = await tx`SELECT quote_literal(${password}) AS literal`;
          try {
            await tx.unsafe(`ALTER ROLE ${role} PASSWORD ${literal}`);
          } catch (e) {
            /* Never surface the statement: it carries the password. */
            throw new Error(`Setting the ${role} password failed (${(e as { code?: string }).code ?? 'unknown'})`);
          }
        }
      });
    } finally {
      await sql.end();
    }
  }
  /** `provision`: migrate, then roles and passwords, as one deploy step. */
  async function provision(url: string, env: NodeJS.ProcessEnv = process.env) {
    await migrate(url);
    await grantRoles(url, { worker: env[o.passwords.worker.env] || undefined, api: env[o.passwords.api.env] || undefined });
  }
  /** `schema-status`: what is applied, and whether this binary may run on it. */
  async function status(url: string) {
    const sql = open(url);
    try {
      const own = migrations();
      const state = await schemaState(sql);
      let compatible = 'ok';
      try { await assertSchemaCompatible(sql, own); } catch (e) { compatible = message(e); }
      return { binary: own.at(-1)!.version, database: state.version, floor: state.floor, compatible, applied: state.applied };
    } finally {
      await sql.end();
    }
  }
  /** The image's `migrate` (no flag), `provision` (--provision) and `schema-status` (--status). */
  async function main(argv = process.argv, env: NodeJS.ProcessEnv = process.env) {
    const url = env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    try {
      if (argv.includes('--status')) print(await status(url));
      else if (argv.includes('--provision')) {
        await provision(url, env);
        log({ event: `${o.name}_provisioned` });
      } else await migrate(url);
    } catch (e) {
      log({ event: 'schema_migrate_failed', message: message(e), code: (e as { code?: string }).code });
      process.exitCode = 1;
    }
  }
  return { migrations, migrate, assertSchema, grantRoles, provision, status, main };
}

/** `reset-request <note>`: asks the next worker start to reset this database
    (requestReset). Returns the line to print; the note is the arguments, or
    RESET_NOTE. Needs the worker's (or the schema owner's) DATABASE_URL. */
export async function resetRequestCommand(service: string, argv: string[], env: NodeJS.ProcessEnv = process.env) {
  const note = (argv.join(' ') || env.RESET_NOTE || '').trim();
  if (!note) throw new Error('usage: reset-request <note: ticket or reason>');
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required');
  const sql = open(url);
  try {
    const epoch = await requestReset(sql, note);
    return { event: 'indexer_reset_requested', service, epoch, note };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
/** Runs resetRequestCommand as the process: prints its line, or the failure (exit 1). */
export function runResetRequest(service: string, argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  return resetRequestCommand(service, argv, env).then(
    r => print(r),
    e => { console.error(JSON.stringify({ event: 'indexer_reset_request_failed', message: message(e) })); process.exitCode = 1; },
  );
}

/* reconcile: compare the read model with the chain, report divergences, optionally ask for a reset. */
export type Divergence = { check: string; market?: string; detail: unknown };

/** Two key sets that must be equal (chain side, indexer side), as a divergence
    with up to five samples of each difference, or null when they match. */
export function setDivergence(check: string, market: string, fromChain: string[], fromIndexer: string[]): Divergence | null {
  const a = new Set(fromChain), b = new Set(fromIndexer);
  const missing = fromChain.filter(x => !b.has(x)), extra = fromIndexer.filter(x => !a.has(x));
  return missing.length || extra.length
    ? { check, market, detail: { missingFromIndexer: missing.slice(0, 5), extraInIndexer: extra.slice(0, 5), missing: missing.length, extra: extra.length } }
    : null;
}

/** Every event `filter` matches with lo <= slot <= hi, in slot order (pages of
    1,000). Throws once more than `max` were listed: one pass stays bounded. */
export async function listEventRange(client: Pick<ChainClient, 'listEvents'>, filter: { expression: string }, lo: bigint, hi: bigint, max: number) {
  const out: Event[] = [];
  let token: string | undefined;
  do {
    const page = await client.listEvents({
      filter: { ...filter, expression: `(event.slot >= uint(${lo})) && (event.slot <= uint(${hi})) && (${filter.expression})` },
      page: { pageSize: 1000, orderBy: 'slot asc', pageToken: token },
    } as any);
    for (const e of page.events) if (e.slot !== undefined && e.slot >= lo && e.slot <= hi) out.push(e);
    token = page.page?.nextPageToken || undefined;
    if (out.length > max) throw new Error('History too large to reconcile in one pass');
  } while (token);
  return out;
}

/** `--request-reset`: records an operator reset request naming the checks
    that diverged; the next worker start performs it. */
export async function requestResetFor(sql: Sql, divergences: Divergence[]) {
  const note = `reconcile ${new Date().toISOString()}: ${[...new Set(divergences.map(d => d.check))].join(',')}`;
  return { note, epoch: await requestReset(sql, note) };
}

/** Runs a reconcile as the process: prints `indexer_reconcile` and exits 0
    (consistent) or 2 (divergence); prints `indexer_reconcile_failed` and
    exits 1 on an error. */
export function runReconcile(service: string, run: () => Promise<{ ok?: unknown }>) {
  return run().then(
    report => {
      print({ event: 'indexer_reconcile', service, ...report });
      process.exitCode = report.ok ? 0 : 2;
    },
    e => {
      print({ event: 'indexer_reconcile_failed', service, message: message(e) });
      process.exitCode = 1;
    },
  );
}
