import type { Sql, TransactionSql } from 'postgres';

/** No ready epoch to read: the first build, a reset rebuilding the data, or a
    database of another dataset than the reader's pins (an API maps it to 503). */
export class NotReadyError extends Error {
  constructor() { super('NOT_READY'); }
}

/** Optional pins (EXPECTED_CHAIN_ID, EXPECTED_PROGRAM): an API pointed at
    another dataset's database reports not ready and serves nothing. */
export function expectedIdentity(env: NodeJS.ProcessEnv = process.env) {
  const chain = env.EXPECTED_CHAIN_ID?.trim();
  const program = env.EXPECTED_PROGRAM?.trim();
  if (chain && !/^\d{1,10}$/.test(chain)) throw new Error('EXPECTED_CHAIN_ID must be an integer');
  return { chainId: chain ? Number(chain) : null, program: program || null };
}
export type ExpectedIdentity = ReturnType<typeof expectedIdentity>;
/** No pins: any dataset matches. */
export const NO_PINS: ExpectedIdentity = { chainId: null, program: null };
/** Whether an identity row (`chain_id` or `chainId`, `program`) is the pinned dataset. */
export function identityMatches(row: { chain_id?: unknown; chainId?: unknown; program?: unknown } | null, expected: ExpectedIdentity) {
  if (!row) return false;
  const chain = Number(row.chainId ?? row.chain_id);
  return (expected.chainId === null || chain === expected.chainId) && (expected.program === null || row.program === expected.program);
}

/** One repeatable-read, read-only transaction (200 ms statements) over a
    ready epoch. Its first statement locks the identity table (shared), before
    the snapshot, so a reset (which locks it exclusively) never lands inside a
    read. `state` selects the identity row (`ready`, `chain_id`, `program`)
    with whatever the service reads alongside it; it is passed to `fn`. Throws
    NotReadyError when the epoch is not ready or the row is not the pinned dataset. */
export function readReadyEpoch<S, T>(sql: Sql, state: (tx: TransactionSql) => PromiseLike<readonly unknown[]>,
  expected: ExpectedIdentity, fn: (tx: TransactionSql, state: S) => Promise<T>): Promise<T> {
  return sql.begin('isolation level repeatable read read only', async tx => {
    /* Pipelined: one round trip. */
    const [, , [row]] = await Promise.all([
      tx`SET LOCAL statement_timeout='200ms'`,
      tx`LOCK TABLE indexer_identity IN ACCESS SHARE MODE`,
      state(tx),
    ]);
    const s = row as { ready?: unknown; chain_id?: unknown; program?: unknown } | undefined;
    if (!s?.ready || !identityMatches(s, expected)) throw new NotReadyError();
    return fn(tx, row as S);
  }) as Promise<T>;
}
