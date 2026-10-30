import { randomUUID } from 'node:crypto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AggregationTemporality, AggregationType, MeterProvider, PeriodicExportingMetricReader, type PushMetricExporter } from '@opentelemetry/sdk-metrics';

const METRICS = {
  'apps.http.requests': 'counter', 'apps.http.errors': 'counter', 'apps.http.duration': 'duration',
  'apps.dependency.requests': 'counter', 'apps.dependency.errors': 'counter', 'apps.dependency.duration': 'duration',
  'apps.business.operations': 'counter', 'apps.business.duration': 'duration',
  'apps.browser.events': 'counter', 'apps.browser.duration': 'duration',
  /* Not named *.duration: a second view matching one instrument would export a duplicate stream. */
  'apps.browser.launch': 'duration',
  'apps.indexer.checkpoint': 'gauge', 'apps.indexer.consumed': 'gauge', 'apps.indexer.progress_known': 'gauge', 'apps.indexer.checkpoint_distance': 'gauge', 'apps.indexer.head_timestamp': 'gauge', 'apps.indexer.chain_head': 'gauge', 'apps.indexer.lag': 'gauge',
  'apps.indexer.last_progress_timestamp': 'gauge', 'apps.indexer.records': 'counter', 'apps.indexer.retries': 'counter',
  'apps.stream.connections': 'gauge', 'apps.stream.fallbacks': 'counter', 'apps.stream.errors': 'counter',
  'apps.wallet.pending_snapshot_timestamp': 'gauge', 'apps.wallet.pending_deposits': 'gauge', 'apps.wallet.oldest_pending_age': 'gauge', 'apps.faucet.payer_balance': 'gauge', 'apps.faucet.payer_balance_timestamp': 'gauge',
  'apps.telemetry.delivery_failures': 'counter',
} as const;
export type MetricName = keyof typeof METRICS;
type Environment = Record<string, string | undefined>;
type Attributes = Record<string, string>;
const INSTANCE_ID = randomUUID();
const bounded = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value) ? value : 'other';
export interface ServiceMetricsOptions {
  env?: Environment;
  exporter?: PushMetricExporter;
  /** Static server-owned route templates and operation names only. */
  routes?: readonly string[];
  operations?: readonly string[];
  streams?: readonly string[];
  /** apps.browser.launch label allowlists, keyed by label (BROWSER_LAUNCH_LABELS from @thru/browser-telemetry/server). */
  launch?: Readonly<Record<string, readonly string[]>>;
}

export class ServiceMetrics {
  private provider?: MeterProvider;
  private reader?: PeriodicExportingMetricReader;
  private instruments = new Map<string, { add?: (value: number, attrs: Attributes) => void; record?: (value: number, attrs: Attributes) => void }>();
  constructor(service: string, private options: ServiceMetricsOptions = {}) {
    const env = options.env ?? process.env;
    if (!env.APPS_METRICS_OTLP_ENDPOINT && !options.exporter) return;
    const exporter = options.exporter ?? new OTLPMetricExporter({ url: env.APPS_METRICS_OTLP_ENDPOINT, temporalityPreference: AggregationTemporality.CUMULATIVE, timeoutMillis: 5000 });
    this.reader = new PeriodicExportingMetricReader({
      exporter: {
        export: (data, callback) => {
          try { exporter.export(data, result => {
            if (result.code !== 0) this.record('apps.telemetry.delivery_failures', { operation: 'metrics_export' });
            callback(result);
          }); } catch { this.record('apps.telemetry.delivery_failures', { operation: 'metrics_export' }); callback({ code: 1 }); }
        },
        forceFlush: () => exporter.forceFlush(), shutdown: () => exporter.shutdown(),
        selectAggregationTemporality: () => AggregationTemporality.CUMULATIVE,
      }, exportIntervalMillis: 30000, exportTimeoutMillis: 5000,
    });
    this.provider = new MeterProvider({
      resource: resourceFromAttributes({
        'service.name': env.OTEL_SERVICE_NAME || service,
        'service.namespace': 'apps', 'service.instance.id': env.OTEL_SERVICE_INSTANCE_ID || INSTANCE_ID,
        'service.version': env.K_REVISION || 'unknown',
        'deployment.environment.name': bounded(env.APPS_TELEMETRY_ENVIRONMENT, ['prod', 'staging', 'production']),
        component: bounded(env.APPS_TELEMETRY_COMPONENT, ['api', 'indexer', 'web', 'worker', 'producer', 'admin']),
        network: bounded(env.APPS_TELEMETRY_NETWORK, ['alphanet', 'betanet', 'devnet', 'mainnet']),
      }), readers: [this.reader],
      views: [
        { instrumentName: 'apps.*.duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60] } }, aggregationCardinalityLimit: 2048 },
        /* About 25% wide from 0.5 s to 3 s, where launch percentiles land and the shared view has only 0.5, 1 and 2.5. */
        { instrumentName: 'apps.browser.launch', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 30, 60] } }, aggregationCardinalityLimit: 2048 },
      ],
    });
    const meter = this.provider.getMeter('@thru/server-telemetry');
    for (const [name, kind] of Object.entries(METRICS)) {
      this.instruments.set(name, kind === 'duration' ? meter.createHistogram(name, { unit: 's' }) : kind === 'gauge' ? meter.createGauge(name, /timestamp|oldest_pending_age/.test(name) ? { unit: 's' } : {}) : meter.createCounter(name));
    }
  }
  isEnabled(): boolean { return this.provider !== undefined; }
  configure(options: ServiceMetricsOptions): void {
    for (const key of ['routes', 'operations', 'streams'] as const) {
      if (options[key]) this.options[key] = [...new Set([...(this.options[key] ?? []), ...options[key]])];
    }
    if (options.launch) this.options.launch = options.launch;
  }
  private attributes(name: MetricName, input: Record<string, unknown>): Attributes {
    if (name === 'apps.browser.launch') return Object.fromEntries(Object.entries(this.options.launch ?? {}).map(([label, allowed]) => [label, bounded(input[label], allowed)]));
    if (name.startsWith('apps.http.')) return {
      route: bounded(input.route, this.options.routes ?? []),
      method: bounded(input.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
      status_class: bounded(input.status_class, ['1xx', '2xx', '3xx', '4xx', '5xx']),
    };
    if (name.startsWith('apps.indexer.')) return { stream: bounded(input.stream, this.options.streams ?? []), kind: bounded(input.kind, ['event', 'account']) };
    if (name.startsWith('apps.stream.')) return { operation: bounded(input.operation, ['sse', 'notify', 'chain', 'poll']) };
    if (name.startsWith('apps.wallet.')) return { state: bounded(input.state, ['received', 'minting', 'failed']) };
    if (name.startsWith('apps.faucet.')) return { network: bounded(input.network, ['alphanet', 'betanet']) };
    return {
      operation: bounded(input.operation, ['metrics_export', 'query', 'commit', 'checkpoint', 'chain_head', ...(this.options.operations ?? [])]),
      ...(name.startsWith('apps.dependency.') ? { dependency: bounded(input.dependency, ['db', 'rpc', 'stream', 'pubsub', 'auth', 'external']) } : {}),
      outcome: bounded(input.outcome, ['success', 'error', 'rejected', 'timeout', 'rate_limited', 'confirmed', 'observed', 'network_error', 'http_error']),
    };
  }
  record(name: MetricName, input: Record<string, unknown>, value = 1): void {
    try {
      if (!Number.isFinite(value) || value < 0) return;
      const instrument = this.instruments.get(name);
      if (!instrument) return;
      const attrs = this.attributes(name, input);
      if (instrument.add) instrument.add(value, attrs); else instrument.record?.(value, attrs);
    } catch { /* Telemetry never changes application control flow. */ }
  }
  gauge(name: MetricName, attrs: Record<string, unknown>, value: number): void { this.record(name, attrs, value); }
  http(route: string, method: string, status: number, durationMs: number): void {
    const attrs = { route, method, status_class: `${Math.floor(status / 100)}xx` };
    this.record('apps.http.requests', attrs);
    if (status >= 400) this.record('apps.http.errors', attrs);
    this.record('apps.http.duration', attrs, Math.max(0, durationMs) / 1000);
  }
  async dependency<T>(dependency: 'db' | 'rpc' | 'stream' | 'pubsub' | 'auth' | 'external', operation: string, handler: () => Promise<T>, succeeded: (result: T) => boolean = () => true): Promise<T> {
    const started = performance.now();
    let outcome = 'error';
    try {
      const result = await handler();
      /* Classification is observational: even a faulty predicate must preserve
         the dependency's returned value and application control flow. */
      try { outcome = succeeded(result) ? 'success' : 'error'; } catch { /* Keep error outcome. */ }
      return result;
    }
    finally {
      const attrs = { dependency, operation, outcome };
      this.record('apps.dependency.requests', attrs);
      if (outcome === 'error') this.record('apps.dependency.errors', attrs);
      this.record('apps.dependency.duration', attrs, (performance.now() - started) / 1000);
    }
  }
  async export(): Promise<void> { try { await this.reader?.forceFlush(); } catch { /* Best effort. */ } }
  async stop(): Promise<void> { try { await this.provider?.shutdown(); } catch { /* Best effort. */ } }
}
const services = new Map<string, ServiceMetrics>();
export function getServiceMetrics(service: string, options: ServiceMetricsOptions = {}): ServiceMetrics {
  let metrics = services.get(service);
  if (!metrics) {
    try { metrics = new ServiceMetrics(service, options); } catch { metrics = new ServiceMetrics(service, { env: {} }); }
    services.set(service, metrics);
  }
  metrics.configure(options);
  return metrics;
}

/** Sample chain height without conflating a heartbeat with source consumption.
 * checkpoint_distance is only distance to persisted rows. A quiet filtered
 * event stream has no empty-block watermark, so progress_known is zero and no
 * lag is emitted. Accounts supply consumedSlot only after fully handling a
 * blockFinished marker, including blocks with no matching accounts. Head
 * timestamp lets dashboards reject an old sample after RPC failure. */
export async function observeIndexerHead(
  metrics: ServiceMetrics,
  getHeight: () => Promise<{ finalized?: bigint; locallyExecuted?: bigint; clusterExecuted?: bigint }>,
  streams: () => readonly { name: string; kind: string; checkpointSlot: string | null; consumedSlot?: string | null }[],
): Promise<void> {
  if (!metrics.isEnabled()) return;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const height = await metrics.dependency('rpc', 'chain_head', () => Promise.race([
      Promise.resolve().then(getHeight),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('head_probe_timeout')), 5000); deadline.unref?.(); }),
    ]));
    const head = [height.finalized, height.locallyExecuted, height.clusterExecuted]
      .filter((slot): slot is bigint => slot !== undefined)
      .reduce((highest, slot) => slot > highest ? slot : highest, 0n);
    for (const stream of streams()) {
      const attrs = { stream: stream.name, kind: stream.kind };
      metrics.gauge('apps.indexer.chain_head', attrs, Number(head));
      metrics.gauge('apps.indexer.head_timestamp', attrs, Date.now() / 1000);
      const consumed = stream.consumedSlot;
      metrics.gauge('apps.indexer.progress_known', attrs, consumed == null ? 0 : 1);
      if (consumed != null) {
        const slot = BigInt(consumed);
        metrics.gauge('apps.indexer.lag', attrs, Number(head > slot ? head - slot : 0n));
      }
      if (stream.checkpointSlot !== null) {
        const checkpoint = BigInt(stream.checkpointSlot);
        metrics.gauge('apps.indexer.checkpoint', attrs, Number(checkpoint));
        metrics.gauge('apps.indexer.checkpoint_distance', attrs, Number(head > checkpoint ? head - checkpoint : 0n));
      }
    }
  } catch {
    console.warn(JSON.stringify({ event: 'indexer.chain_head_failed', action: 'check_rpc_connectivity' }));
  } finally { if (deadline) clearTimeout(deadline); }
}


/** Own the dedicated probe lifecycle. Never allocate it while telemetry is disabled. */
export async function sampleIndexerHead(
  metrics: ServiceMetrics,
  createProbe: () => { getHeight: Parameters<typeof observeIndexerHead>[1]; close(): void },
  streams: Parameters<typeof observeIndexerHead>[2],
): Promise<void> {
  if (!metrics.isEnabled()) return;
  let probe: ReturnType<typeof createProbe> | undefined;
  try {
    probe = createProbe();
    await observeIndexerHead(metrics, () => probe!.getHeight(), streams);
  } catch { console.warn(JSON.stringify({ event: 'indexer.head_probe_failed', action: 'check_rpc_configuration' })); }
  finally { try { probe?.close(); } catch { /* Best effort cleanup. */ } }
}
