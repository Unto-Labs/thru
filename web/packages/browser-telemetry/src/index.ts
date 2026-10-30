/** Fixed labels only. Never pass exception text, URLs, identifiers, or bodies. */
const BROWSER_EVENT_NAMES = ['js_error', 'unhandled_rejection', 'rpc_failed', 'request_failed', 'stream_disconnected', 'stream_reconnected', 'stream_stale', 'web_vital', 'launch'] as const;
const BROWSER_TARGETS = ['api', 'rpc', 'external', 'blocks', 'transactions', 'lcp', 'cls', 'interaction_max'] as const;
/** The closed values of a `launch` event, keyed by field. The keys are also the
 * apps.browser.launch metric labels. server.mjs keeps the same lists and
 * index.test.mjs fails when the two differ. */
export const BROWSER_LAUNCH_LABELS = {
  milestone: ['ttfb', 'shell', 'balance', 'activity', 'resume'],
  mode: ['pwa', 'browser'],
  cache: ['warm', 'cold'],
  outcome: ['ok', 'signed_in', 'signed_out', 'value', 'unavailable', 'rows', 'empty', 'failed', 'abandoned', 'interrupted'],
  /** The chain a milestone read from. `none` before any chain data loads (ttfb, shell). */
  network: ['none', 'alphanet', 'betanet', 'custom'],
} as const;
type LaunchLabels = typeof BROWSER_LAUNCH_LABELS;
const LAUNCH_KEYS = Object.keys(BROWSER_LAUNCH_LABELS) as (keyof LaunchLabels)[];
export type BrowserEventName = (typeof BROWSER_EVENT_NAMES)[number];
export type BrowserTarget = (typeof BROWSER_TARGETS)[number];
export type LaunchMilestone = LaunchLabels['milestone'][number];
export type LaunchOutcome = LaunchLabels['outcome'][number];
export type LaunchNetwork = LaunchLabels['network'][number];
export interface BrowserEvent {
  event: BrowserEventName;
  timestamp: number;
  target?: BrowserTarget;
  status?: number;
  durationMs?: number;
  /** web_vital: the vital. launch: ms since navigation start, or since the page became visible for resume. */
  value?: number;
  /** Required on `launch`, never sent on any other event. */
  milestone?: LaunchMilestone;
  mode?: LaunchLabels['mode'][number];
  cache?: LaunchLabels['cache'][number];
  outcome?: LaunchOutcome;
  network?: LaunchNetwork;
}
export const BROWSER_TELEMETRY_ENDPOINT = '/api/telemetry/browser';
let activeRecord: ((event: Omit<BrowserEvent, 'timestamp'>) => void) | undefined;
export function recordBrowserEvent(event: Omit<BrowserEvent, 'timestamp'>): void {
  activeRecord?.(event);
}

/** One mount owns global listeners and restores fetch on teardown (including StrictMode). */
export function installBrowserTelemetry(options: { sampleRate?: number; random?: () => number; endpoint?: "/api/telemetry/browser" | "/blog/api/telemetry/browser" } = {}): () => void {
  if (typeof window === 'undefined' || activeRecord) return () => {};
  const endpoint = options.endpoint ?? BROWSER_TELEMETRY_ENDPOINT;
  const random = options.random ?? Math.random;
  const rate = Math.max(0, Math.min(1, options.sampleRate ?? 0.1));
  const originalFetch = window.fetch;
  const send = originalFetch.bind(window);
  let queue: BrowserEvent[] = [];
  let budget = 60;
  let stopped = false;
  let pending = 0;
  const record = (input: Omit<BrowserEvent, 'timestamp'>) => {
    if (!BROWSER_EVENT_NAMES.includes(input.event)) return;
    if (input.target && !BROWSER_TARGETS.includes(input.target)) return;
    const launch = input.event === 'launch';
    if (launch && (!Number.isFinite(input.value) || LAUNCH_KEYS.some(key => !(BROWSER_LAUNCH_LABELS[key] as readonly unknown[]).includes(input[key])))) return;
    // A page sends each launch milestone once; sampling would only thin the percentiles.
    if (stopped || budget <= 0 || queue.length >= 20 || (!launch && random() >= rate)) return;
    budget--;
    // Construct fields explicitly; callers cannot smuggle extra data onto the wire.
    queue.push({ event: input.event, timestamp: Date.now(),
      ...(input.target ? { target: input.target } : {}),
      ...(Number.isInteger(input.status) ? { status: input.status } : {}),
      ...(Number.isFinite(input.durationMs) ? { durationMs: Math.min(300_000, Math.max(0, input.durationMs!)) } : {}),
      ...(Number.isFinite(input.value) ? { value: Math.min(300_000, Math.max(0, input.value!)) } : {}),
      ...(launch ? Object.fromEntries(LAUNCH_KEYS.map(key => [key, input[key]])) : {}),
    });
  };
  activeRecord = record;
  const flush = (final = false) => {
    // Final lifecycle reports may use one additional bounded upload slot.
    if (!queue.length || pending >= (final ? 2 : 1)) return;
    const events = queue;
    queue = [];
    pending++;
    // No retries. Contain synchronous fetch/setup failures as well as rejections.
    void (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 5000);
        await send(endpoint, {
          method: 'POST', credentials: 'same-origin', keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: 1, events }), signal: controller.signal,
        });
      } catch { /* Telemetry must never interrupt the application or cleanup. */ }
      finally { clearTimeout(timeout); pending--; }
    })();
  };
  const classify = (input: RequestInfo | URL): BrowserTarget | undefined => {
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.origin === window.location.origin && url.pathname === endpoint) return;
      if (/^\/thru\./.test(url.pathname)) return 'rpc';
      if (url.origin !== window.location.origin) return 'external';
      if (/^\/api(\/|$)/.test(url.pathname)) return 'api';
    } catch { /* Invalid request inputs must preserve the original fetch behavior. */ }
  };
  const wrappedFetch: typeof fetch = async (input, init) => {
    const target = classify(input);
    const start = performance.now();
    try {
      const response = await originalFetch.call(window, input, init);
      if (target && !response.ok) record({ event: 'request_failed', target, status: response.status, durationMs: performance.now() - start });
      return response;
    } catch (error) {
      const signal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
      if (target && !signal?.aborted) record({ event: 'request_failed', target, status: 0, durationMs: performance.now() - start });
      throw error;
    }
  };
  window.fetch = wrappedFetch;
  const onError = () => record({ event: 'js_error' });
  const onRejection = () => record({ event: 'unhandled_rejection' });
  const onHidden = () => { if (document.visibilityState === 'hidden') reportVitals(); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onHidden);
  const interval = setInterval(flush, 10_000);
  const resetBudget = setInterval(() => { budget = 60; }, 60_000);
  const observers: PerformanceObserver[] = [];
  let lcp = 0;
  let cls = 0;
  let clsStart: number | undefined;
  let clsLast = 0;
  let clsWindow = 0;
  let inp = 0;
  const observe = (type: string, callback: (entries: PerformanceEntry[]) => void, durationThreshold?: number): boolean => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return false;
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver(list => callback(list.getEntries()));
      observer.observe({ type, buffered: true, ...(durationThreshold !== undefined ? { durationThreshold } : {}) } as PerformanceObserverInit);
      observers.push(observer);
      return true;
    } catch { observer?.disconnect(); return false; }
  };
  observe('largest-contentful-paint', entries => { for (const entry of entries) lcp = entry.startTime; });
  const clsObserved = observe('layout-shift', entries => {
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
      if (shift.hadRecentInput) continue;
      if (clsStart === undefined || entry.startTime - clsLast > 1000 || entry.startTime - clsStart > 5000) { clsStart = entry.startTime; clsWindow = 0; }
      clsLast = entry.startTime; clsWindow += shift.value; cls = Math.max(cls, clsWindow);
    }
  });
  // Maximum observed interaction duration is a bounded INP approximation, not p98 INP.
  observe('event', entries => { for (const entry of entries) if ((entry as PerformanceEntry & { interactionId?: number }).interactionId) inp = Math.max(inp, entry.duration); }, 40);
  let reportedVitals = false;
  const reportVitals = () => {
    if (reportedVitals) { flush(true); return; }
    reportedVitals = true;
    if (lcp) record({ event: 'web_vital', target: 'lcp', value: lcp });
    if (clsObserved) record({ event: 'web_vital', target: 'cls', value: cls });
    if (inp) record({ event: 'web_vital', target: 'interaction_max', value: inp });
    flush(true);
  };
  window.addEventListener('pagehide', reportVitals);
  return () => {
    if (stopped) return;
    try { reportVitals(); }
    finally {
      stopped = true;
      if (activeRecord === record) activeRecord = undefined;
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('pagehide', reportVitals);
      document.removeEventListener('visibilitychange', onHidden);
      clearInterval(interval); clearInterval(resetBudget);
      for (const observer of observers) observer.disconnect();
    }
  };
}

/** Lifecycle witness for long-lived streams; stale emits once per outage. */
export function monitorBrowserStream(target: 'blocks' | 'transactions', staleMs = 30_000) {
  let lastMessage = Date.now();
  let stale = false;
  let disconnected = false;
  const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { lastMessage = Date.now(); return; }
    if (!stale && Date.now() - lastMessage >= staleMs) { stale = true; recordBrowserEvent({ event: 'stream_stale', target }); }
  }, Math.min(staleMs, 5000));
  return {
    message() {
      if (disconnected || stale) recordBrowserEvent({ event: 'stream_reconnected', target });
      disconnected = false; stale = false; lastMessage = Date.now();
    },
    disconnect() {
      if (!disconnected) recordBrowserEvent({ event: 'stream_disconnected', target });
      disconnected = true;
    },
    dispose() { clearInterval(timer); },
  };
}
