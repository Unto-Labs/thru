import type { Sql } from 'postgres';
export interface DeliveryMessage {
  topic: string; key: string; operation: string; revision: string; payload: unknown;
}
/** One published revision. `epoch` names the dataset generation: a reset
    starts a new epoch, and nothing from an older one is ever delivered. */
export interface DeliveryBatch {
  schemaVersion: number; epoch: string; batchSeq: string; messages: DeliveryMessage[];
}
/** The identity row as readers see it (numeric fields as text). */
export interface DatasetHead {
  epoch: string; batch_seq: string; ready: boolean; activated_slot: string | null;
  chain_id: string; program: string; [key: string]: unknown;
}
export interface OutboxSource {
  head(): Promise<{ ns: DatasetHead | null; floor: string | null }>;
  outbox(after: string, limit?: number): Promise<{ batch_seq: string; payload: DeliveryBatch }[]>;
  listen(wake: () => void, connected: () => void): Promise<() => Promise<void>>;
}
/** LISTEN is only a wakeup. Durable reads and the retention floor are queried
    from the primary, so a dropped notification cannot lose a publication. */
export class OutboxReader implements OutboxSource {
  constructor(private sql: Sql) {}
  async head() {
    const sql = this.sql;
    /* One statement: identity and floor come from the same snapshot, taken
       after the identity table's lock (a reset holds it exclusively). */
    const [row] = await sql`SELECT n.epoch::text AS epoch,n.batch_seq::text AS batch_seq,n.ready,n.activated_slot::text AS activated_slot,
        n.chain_id::text AS chain_id,n.program,(SELECT min(batch_seq)::text FROM indexer_outbox) AS outbox_floor
      FROM indexer_identity n`;
    if (!row) return { ns: null, floor: null };
    const { outbox_floor, ...ns } = row;
    return { ns: ns as DatasetHead, floor: (outbox_floor ?? null) as string | null };
  }
  async outbox(after: string, limit = 100) {
    const sql = this.sql;
    /* Qualified: a bare `batch_seq` here names the text output column, which
       sorts '10' before '9' and pages past rows across a digit boundary. */
    const rows = await sql`SELECT batch_seq::text,payload FROM indexer_outbox
      WHERE batch_seq>${after} ORDER BY indexer_outbox.batch_seq LIMIT ${limit}`;
    return rows as unknown as { batch_seq: string; payload: DeliveryBatch }[];
  }
  async listen(wake: () => void, connected: () => void) {
    /* The payload is the publishing epoch; any notification only wakes a poll. */
    return (await this.sql.listen('indexer_outbox', () => wake(), connected)).unlisten;
  }
  async prune() {
    const sql = this.sql;
    await sql`DELETE FROM indexer_outbox
      WHERE created_at<now()-interval '10 minutes' OR batch_seq IN
        (SELECT batch_seq FROM (SELECT batch_seq,sum(pg_column_size(payload)) OVER(ORDER BY batch_seq DESC) AS bytes
          FROM indexer_outbox) sizes WHERE bytes>67108864)`;
  }
}
