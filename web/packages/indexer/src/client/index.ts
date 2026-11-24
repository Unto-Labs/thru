/** Browser-only delivery transport. No server or database imports. */
/** A published batch. `epoch` changes only when the dataset is reset. */
export interface IndexerBatch {
  epoch: string;
  messages: { operation: string }[];
}
export interface IndexerCursor {
  epoch: string;
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
  if (version !== 1 || !key || typeof key.epoch !== 'string' || !/^[1-9][0-9]*$/.test(key.epoch)) throw new Error('Invalid cursor');
  return key;
}
export type ConnectionStatus = 'connecting' | 'connected' | 'retrying' | 'closed';
/** A stream request the server refused as a client error (HTTP 400), e.g.
    `CURSOR_SCOPE_MISMATCH`: the resume cursor was issued for another scope.
    Not a reset: the dataset (epoch) is unchanged, and retrying the same
    request cannot succeed. */
export interface IndexerStreamError { status: number; code: string; message: string }
/* EventSource.CLOSED: a refused request (any status but 200, or another
   content type) closes the source before it opens; a network error leaves it
   CONNECTING. */
const CLOSED = 2;
/* EventSource hides the status of a refused request: read it once with fetch.
   Only a 400 is classified (a client error); anything else, or no answer,
   leaves the caller's usual reconnect path. */
async function refusal(url: URL): Promise<IndexerStreamError | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const response = await fetch(url, { headers: { accept: 'text/event-stream' }, cache: 'no-store', signal: abort.signal });
    if (response.status !== 400) return null;
    const body = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
    return {
      status: 400,
      code: typeof body?.error?.code === 'string' ? body.error.code : 'BAD_REQUEST',
      message: typeof body?.error?.message === 'string' ? body.error.message : 'Bad request',
    };
  } catch { return null; }
  finally { clearTimeout(timer); abort.abort(); }
}
export function connectIndexer<T extends IndexerBatch>(options: {
  url: string | URL;
  scope: Record<string, string | string[] | undefined>;
  resume?: string;
  schema: { parse(value: unknown): T };
  applyBatch(batch: T): void | Promise<void>;
  onResync(): void;
  onStatus?(status: ConnectionStatus): void;
  onSnapshot?(snapshot: unknown): void | Promise<void>;
  /** The server refused the stream as a client error (400): the connection
      closes and neither retries nor resyncs. Without this handler a refused
      stream takes the reconnect path (and resyncs after three failures). */
  onError?(error: IndexerStreamError): void;
}) {
  let cursor = options.resume;
  let identity = cursor ? decodeCursor(cursor) : undefined;
  let source: EventSource | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  /* Connection session: bumps on every (re)connect so stale callbacks drop. */
  let session = 0;
  let errors = 0;
  let queuedBytes = 0;
  let applying: Promise<void> = Promise.resolve();
  const status = (value: ConnectionStatus) => options.onStatus?.(value);
  const disconnect = () => {
    session++;
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
    const current = session;
    queuedBytes += event.data.length;
    if (queuedBytes > 1024 * 1024) { resync(); return; }
    applying = applying.then(async () => {
      try {
        if (stopped || current !== session) return;
        await apply();
      } catch { if (current === session) reconnect(); }
      finally { queuedBytes -= event.data.length; }
    });
  };
  function open() {
    if (stopped) return;
    const url = new URL(options.url, globalThis.location?.href);
    for (const [key, value] of Object.entries(options.scope))
      if (value !== undefined) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : value);
    if (cursor) url.searchParams.set('after', cursor);
    const current = session;
    const live = () => !stopped && current === session;
    const opening = source = new EventSource(url);
    let opened = false;
    status('connecting');
    touch();
    source.onopen = () => { if (live()) { opened = true; touch(); status('connected'); } };
    source.addEventListener('heartbeat', () => { if (live()) touch(); });
    source.addEventListener('batch', (event: MessageEvent<string>) => {
      if (!live()) return;
      touch();
      enqueue(event, async () => {
        const batch = options.schema.parse(JSON.parse(event.data));
        const next = decodeCursor(event.lastEventId);
        /* A batch of another epoch (the dataset was reset) never applies: resync from REST. */
        if ((identity && batch.epoch !== identity.epoch) || next.epoch !== batch.epoch ||
          batch.messages.some(m => m.operation === 'resync_required')) { resync(); return; }
        await options.applyBatch(batch);
        // EventSource's own Last-Event-ID advances before application success.
        // Recreate the source ourselves using only the last fully applied ID.
        if (stopped || current !== session) return;
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
    source.onerror = () => {
      if (!live()) return;
      if (opened || !options.onError || opening.readyState !== CLOSED) { reconnect(); return; }
      /* Refused before it opened: a client error (400) closes for good and
         is reported; anything else reconnects as before. */
      void refusal(url).then(error => {
        if (!live()) return;
        if (!error) { reconnect(); return; }
        close();
        options.onError!(error);
      });
    };
  }
  open();
  return { close, get resume() { return cursor; } };
}
