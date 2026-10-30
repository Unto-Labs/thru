/** Browser-only delivery transport. No server or database imports. */
export interface IndexerBatch {
  namespace: string;
  sourceGeneration: string;
  projectionGeneration: string;
  messages: { operation: string }[];
}
export interface IndexerCursor {
  namespace: string;
  sourceGeneration: string;
  projectionGeneration: string;
  filter: string;
  cuts: Record<string, string>;
}
/* Same versioned base64url envelope as indexer-service/createCursorCodec. */
export function encodeIndexerCursor(key: IndexerCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, key }));
  const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (value.length > 4096) throw new Error('Cursor too large');
  return value;
}
function decodeCursor(value: string): IndexerCursor {
  if (value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid cursor');
  const { version, key } = JSON.parse(new TextDecoder().decode(Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0),
  )));
  if (version !== 1 || !key || typeof key.namespace !== 'string' ||
      typeof key.sourceGeneration !== 'string' || typeof key.projectionGeneration !== 'string') throw new Error('Invalid cursor');
  return key;
}
export type ConnectionStatus = 'connecting' | 'connected' | 'retrying' | 'closed';
export function connectIndexer<T extends IndexerBatch>(options: {
  url: string | URL;
  scope: Record<string, string | string[] | undefined>;
  resume?: string;
  schema: { parse(value: unknown): T };
  applyBatch(batch: T): void | Promise<void>;
  onResync(): void;
  onStatus?(status: ConnectionStatus): void;
  onSnapshot?(snapshot: unknown): void | Promise<void>;
}) {
  let cursor = options.resume;
  let identity = cursor ? decodeCursor(cursor) : undefined;
  let source: EventSource | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let epoch = 0;
  let errors = 0;
  let queuedBytes = 0;
  let applying: Promise<void> = Promise.resolve();
  const status = (value: ConnectionStatus) => options.onStatus?.(value);
  const disconnect = () => {
    epoch++;
    clearTimeout(heartbeat);
    clearTimeout(retry);
    source?.close();
    source = undefined;
  };
  const close = () => { if (!stopped) { stopped = true; disconnect(); status('closed'); } };
  const resync = () => { if (!stopped) { close(); options.onResync(); } };
  const reconnect = () => {
    if (stopped || !source) return;
    disconnect();
    if (++errors >= 3) { resync(); return; }
    status('retrying');
    retry = setTimeout(() => { if (!stopped) open(); }, Math.min(1000 * 2 ** (errors - 1), 10000));
  };
  const touch = () => { clearTimeout(heartbeat); heartbeat = setTimeout(resync, 45000); };
  const enqueue = (event: MessageEvent<string>, apply: () => Promise<void>) => {
    const current = epoch;
    queuedBytes += event.data.length;
    if (queuedBytes > 1024 * 1024) { resync(); return; }
    applying = applying.then(async () => {
      try {
        if (stopped || current !== epoch) return;
        await apply();
      } catch { if (current === epoch) reconnect(); }
      finally { queuedBytes -= event.data.length; }
    });
  };
  function open() {
    if (stopped) return;
    const url = new URL(options.url, globalThis.location?.href);
    for (const [key, value] of Object.entries(options.scope))
      if (value !== undefined) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : value);
    if (cursor) url.searchParams.set('after', cursor);
    const current = epoch;
    const live = () => !stopped && current === epoch;
    source = new EventSource(url);
    status('connecting');
    touch();
    source.onopen = () => { if (live()) { touch(); status('connected'); } };
    source.addEventListener('heartbeat', () => { if (live()) touch(); });
    source.addEventListener('batch', (event: MessageEvent<string>) => {
      if (!live()) return;
      touch();
      enqueue(event, async () => {
        const batch = options.schema.parse(JSON.parse(event.data));
        const next = decodeCursor(event.lastEventId);
        if ((identity && (batch.namespace !== identity.namespace || batch.sourceGeneration !== identity.sourceGeneration ||
          batch.projectionGeneration !== identity.projectionGeneration)) || next.namespace !== batch.namespace ||
          next.sourceGeneration !== batch.sourceGeneration || next.projectionGeneration !== batch.projectionGeneration ||
          batch.messages.some(m => m.operation === 'resync_required')) { resync(); return; }
        await options.applyBatch(batch);
        // EventSource's own Last-Event-ID advances before application success.
        // Recreate the source ourselves using only the last fully applied ID.
        if (stopped || current !== epoch) return;
        cursor = event.lastEventId;
        identity = next;
        errors = 0;
        status('connected');
      });
    });
    source.addEventListener('snapshot', (event: MessageEvent<string>) => {
      if (!live()) return;
      touch();
      enqueue(event, async () => { await options.onSnapshot?.(JSON.parse(event.data)); });
    });
    source.addEventListener('resync_required', () => { if (live()) resync(); });
    source.onerror = () => { if (live()) reconnect(); };
  }
  open();
  return { close, get resume() { return cursor; } };
}
