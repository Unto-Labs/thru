import type { Sql, TransactionSql } from 'postgres';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { ProjectionTables } from './writer';

/* Both access paths use the reserved postgres-js connection. Drizzle already
   encodes its parameters; PostgreSQL's unknown type resolves them from SQL
   context without re-encoding JSON, arrays or timestamps in postgres-js.
   The callback driver leaves the pool's raw-query codecs untouched. */
export function transactionDatabase<T extends ProjectionTables>(pool: Sql, tx: TransactionSql, schema?: T) {
  return drizzle(async (query, params, method) => {
    const result = await tx.unsafe(query, params.map(p => typeof p === 'string' ? tx.typed(p, 705) : p)).raw();
    const columns = result.columns;
    const rows = result.map(row => row.map((bytes, i) => {
      if (bytes === null) return null;
      const value = bytes.toString('utf8');
      const type = columns[i].type;
      // These are the codecs Drizzle normally replaces. Leave their wire
      // text for its column mapper, without changing raw query result types.
      if ([1184, 1082, 1083, 1114, 1182, 1185, 1115, 1231].includes(type)) return value;
      return pool.options.parsers[type]?.(value) ?? value;
    }));
    return { rows: method === 'all' ? rows : rows.map(row => Object.fromEntries(columns.map((column, i) => [column.name, row[i]]))) };
  }, { schema });
}
