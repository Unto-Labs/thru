import type { Sql } from 'postgres';
export interface DeliveryMessage {
  topic: string; key: string; operation: string; revision: string; payload: unknown;
}
export interface DeliveryBatch {
  schemaVersion: number; namespace: string; sourceGeneration: string;
  projectionGeneration: string; batchSeq: string; messages: DeliveryMessage[];
}
export interface OutboxSource {
  namespace: string;
  head(): Promise<{ ns: any; floor: string | null }>;
  outbox(after: string, limit?: number): Promise<{ batch_seq: string; payload: DeliveryBatch }[]>;
  listen(wake: () => void, connected: () => void): Promise<() => Promise<void>>;
}
/** LISTEN is only a wakeup. Durable reads and the retention floor are queried
    from the primary, so a dropped notification cannot lose a publication. */
export class OutboxReader implements OutboxSource {
  constructor(private sql: Sql, readonly namespace: string) {}
  async head() {
    const sql = this.sql;
    const [row] = await sql`SELECT n.*,(SELECT min(batch_seq)::text FROM indexer_outbox WHERE namespace_id=${this.namespace}) AS outbox_floor
      FROM indexer_namespaces n WHERE id=${this.namespace}`;
    if (!row) return { ns: null, floor: null };
    const { outbox_floor, ...ns } = row;
    return { ns, floor: (outbox_floor ?? null) as string | null };
  }
  async outbox(after: string, limit = 100) {
    const sql = this.sql;
    const rows = await sql`SELECT batch_seq::text,payload FROM indexer_outbox
      WHERE namespace_id=${this.namespace} AND batch_seq>${after} ORDER BY batch_seq LIMIT ${limit}`;
    return rows as unknown as { batch_seq: string; payload: DeliveryBatch }[];
  }
  async listen(wake: () => void, connected: () => void) {
    return (await this.sql.listen('indexer_outbox', namespace => {
      if (namespace === this.namespace) wake();
    }, connected)).unlisten;
  }
  async prune() {
    const sql = this.sql;
    await sql`DELETE FROM indexer_outbox WHERE namespace_id=${this.namespace}
      AND (created_at<now()-interval '10 minutes' OR batch_seq IN
        (SELECT batch_seq FROM (SELECT batch_seq,sum(pg_column_size(payload)) OVER(ORDER BY batch_seq DESC) AS bytes
          FROM indexer_outbox WHERE namespace_id=${this.namespace}) sizes WHERE bytes>67108864))`;
  }
}
