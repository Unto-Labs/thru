/** Browser ingestion accepts only a fixed numeric schema; never proxies arbitrary OTLP. */
export const BROWSER_EVENTS = Object.freeze(['js_error', 'unhandled_rejection', 'rpc_failed', 'request_failed', 'stream_disconnected', 'stream_reconnected', 'stream_stale', 'web_vital', 'launch']);
/** Same lists as index.ts (index.test.mjs compares them). Keys are the launch
 * event fields and the apps.browser.launch labels. */
export const BROWSER_LAUNCH_LABELS = Object.freeze({
  milestone: Object.freeze(['ttfb', 'shell', 'balance', 'activity', 'resume']),
  mode: Object.freeze(['pwa', 'browser']),
  cache: Object.freeze(['warm', 'cold']),
  outcome: Object.freeze(['ok', 'signed_in', 'signed_out', 'value', 'unavailable', 'rows', 'empty', 'failed', 'abandoned', 'interrupted']),
  network: Object.freeze(['none', 'alphanet', 'betanet', 'custom']),
});
const targets = new Set(['api', 'rpc', 'external', 'blocks', 'transactions', 'lcp', 'cls', 'interaction_max']);
const fields = new Set(['event', 'timestamp', 'target', 'status', 'durationMs', 'value', ...Object.keys(BROWSER_LAUNCH_LABELS)]);
export function parseBrowserBatch(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => key !== 'version' && key !== 'events') || value.version !== 1 || !Array.isArray(value.events) || !value.events.length || value.events.length > 20) return null;
  const now = Date.now();
  const result = [];
  for (const event of value.events) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some(key => !fields.has(key)) || !BROWSER_EVENTS.includes(event.event)) return null;
    if (!Number.isInteger(event.timestamp) || Math.abs(now - event.timestamp) > 86400000) return null;
    if (event.target !== undefined && !targets.has(event.target)) return null;
    if (event.status !== undefined && (!Number.isInteger(event.status) || (event.status !== 0 && (event.status < 100 || event.status > 599)))) return null;
    for (const key of ['durationMs', 'value']) if (event[key] !== undefined && (!Number.isFinite(event[key]) || event[key] < 0 || event[key] > 300000)) return null;
    if (event.event === 'rpc_failed' && event.target !== 'rpc') return null;
    if (event.event === 'request_failed' && !['api', 'rpc', 'external'].includes(event.target)) return null;
    if (event.event.startsWith('stream_') && !['blocks', 'transactions'].includes(event.target)) return null;
    if (event.event === 'web_vital' && !['lcp', 'cls', 'interaction_max'].includes(event.target)) return null;
    const launch = event.event === 'launch';
    if (launch && event.value === undefined) return null;
    for (const [key, allowed] of Object.entries(BROWSER_LAUNCH_LABELS)) if (launch ? !allowed.includes(event[key]) : event[key] !== undefined) return null;
    result.push({ ...event });
  }
  return result;
}

/** Parse only server-owned exact origins; malformed configured lists fail closed. */
export function readBrowserTelemetryOrigins(env = process.env) {
  let origins;
  if (env.APPS_BROWSER_TELEMETRY_ORIGINS !== undefined) {
    try { origins = JSON.parse(env.APPS_BROWSER_TELEMETRY_ORIGINS); } catch { return []; }
  } else if (env.APPS_BROWSER_TELEMETRY_ORIGIN) {
    origins = [env.APPS_BROWSER_TELEMETRY_ORIGIN];
  } else { return undefined; }
  if (!Array.isArray(origins) || origins.length === 0 || origins.length > 32) return [];
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin.length > 512 || origin.includes('*')) return [];
    try {
      const url = new URL(origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) return [];
    } catch { return []; }
  }
  return [...new Set(origins)];
}

/** Global per-process bucket bounds abuse without storing client IPs or identities. */
export function createBrowserTelemetryHandler({ app, record = () => {}, origins = readBrowserTelemetryOrigins(), enabled = () => process.env.APPS_BROWSER_TELEMETRY_ENABLED === 'true', log = event => console.log(JSON.stringify(event)) }) {
  const trustedOrigins = origins === undefined ? undefined : new Set(origins);
  let tokens = 120;
  let last = Date.now();
  const response = status => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  return async function handleBrowserTelemetry(request) {
    if (!enabled()) return response(204);
    if (request.method !== 'POST') return response(405);
    // Exact same origin; do not trust forwarded host/origin headers or enable CORS.
    const requestOrigin = request.headers.get('origin');
    const allowed = trustedOrigins === undefined ? requestOrigin === new URL(request.url).origin : trustedOrigins.has(requestOrigin);
    if (!allowed || request.headers.get('sec-fetch-site') === 'cross-site') return response(403);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return response(415);
    const now = Date.now();
    tokens = Math.min(120, tokens + Math.max(0, now - last) / 1000);
    last = now;
    if (tokens < 1) return response(429);
    tokens--;
    if (Number(request.headers.get('content-length')) > 16384) return response(413);
    const reader = request.body?.getReader();
    if (!reader) return response(400);
    let length = 0;
    const chunks = [];
    let timeout;
    try {
      const deadline = new Promise((_, reject) => { timeout = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error('body timeout')); }, 5000); });
      const read = async () => {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 16384) { void reader.cancel().catch(() => {}); return null; }
          chunks.push(chunk.value);
        }
        return chunks;
      };
      const bounded = await Promise.race([read(), deadline]);
      if (!bounded) return response(413);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of bounded) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const events = parseBrowserBatch(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (!events) return response(400);
      for (const event of events) {
        // App is server-controlled. Metrics and logs can never receive arbitrary labels.
        try { log({ component: 'browser-telemetry', app, ...event }); record(event); } catch { /* Observation must not fail application requests. */ }
      }
      return response(204);
    } catch { return response(400); }
    finally { clearTimeout(timeout); }
  };
}
