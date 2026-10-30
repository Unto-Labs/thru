import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { ServiceMetrics, observeIndexerHead, getServiceMetrics, sampleIndexerHead } from './index';
const running: ServiceMetrics[] = [];
function create() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metrics = new ServiceMetrics('clob', { exporter, env: { APPS_TELEMETRY_COMPONENT: 'indexer', APPS_TELEMETRY_NETWORK: 'devnet' }, routes: ['/markets/:market'], streams: ['trades'] });
  running.push(metrics);
  return { metrics, exporter };
}
const latest = (exporter: InMemoryMetricExporter) => exporter.getMetrics().at(-1)!.scopeMetrics.flatMap(scope => scope.metrics);
afterEach(async () => { await Promise.all(running.splice(0).map(metrics => metrics.stop())); });
describe('server metrics owning boundaries', () => {
  it('exports bounded cumulative HTTP counters and duration buckets without identifiers', async () => {
    const { metrics, exporter } = create();
    for (let i = 0; i < 250; i++) {
      metrics.http(`/wallet/${i}?secret=SECRET`, 'GET', 500, 20);
      metrics.record('apps.business.operations', { operation: `secret-${i}`, outcome: 'error', address: `address-${i}` });
    }
    metrics.http('/markets/:market', 'GET', 200, 50);
    await metrics.export();
    const records = latest(exporter);
    expect(records.find(record => record.descriptor.name === 'apps.http.requests')!.dataPoints).toHaveLength(2);
    expect(records.find(record => record.descriptor.name === 'apps.business.operations')!.dataPoints).toHaveLength(1);
    expect(JSON.stringify(records)).not.toMatch(/SECRET|address-|secret-/);
    expect(records.find(record => record.descriptor.name === 'apps.http.duration')!.dataPoints[0].value).toMatchObject({ count: 250 });
  });
  it('measures dependency rejection without changing the thrown object', async () => {
    const { metrics, exporter } = create();
    const error = new Error('private backend details');
    await expect(metrics.dependency('db', 'query', async () => { throw error; })).rejects.toBe(error);
    expect(await metrics.dependency('rpc', 'chain_head', async () => 42)).toBe(42);
    await metrics.export();
    expect(latest(exporter).find(record => record.descriptor.name === 'apps.dependency.errors')!.dataPoints[0].value).toBe(1);
    expect(JSON.stringify(latest(exporter))).not.toContain('private backend');
  });
  it('classifies resolved HTTP failures without changing responses or exposing payloads', async () => {
    const { metrics, exporter } = create();
    for (const status of [200, 401, 500]) {
      const response = new Response('private upstream payload', { status });
      expect(await metrics.dependency('external', 'query', async () => response, result => result.ok)).toBe(response);
      expect(await response.text()).toBe('private upstream payload');
    }
    const result = { private: 'unchanged' };
    expect(await metrics.dependency('external', 'query', async () => result, () => { throw new Error('private classifier failure'); })).toBe(result);
    await metrics.export();
    const records = latest(exporter);
    const requests = records.find(metric => metric.descriptor.name === 'apps.dependency.requests')!.dataPoints;
    expect(requests.find(point => point.attributes.outcome === 'success')!.value).toBe(1);
    expect(requests.find(point => point.attributes.outcome === 'error')!.value).toBe(3);
    expect(records.find(metric => metric.descriptor.name === 'apps.dependency.errors')!.dataPoints[0].value).toBe(3);
    expect(JSON.stringify(records)).not.toContain('private');
  });
  it('distinguishes checkpoint distance from known consumed lag and never invents progress', async () => {
    const { metrics, exporter } = create();
    await observeIndexerHead(metrics, async () => ({ finalized: 100n }), () => [{ name: 'trades', kind: 'account', checkpointSlot: '80', consumedSlot: '98' }]);
    await metrics.export();
    expect(latest(exporter).find(record => record.descriptor.name === 'apps.indexer.lag')!.dataPoints[0].value).toBe(2);
    expect(latest(exporter).find(record => record.descriptor.name === 'apps.indexer.last_progress_timestamp')).toBeUndefined();
    metrics.gauge('apps.stream.connections', { operation: 'sse' }, 2);
    metrics.gauge('apps.stream.connections', { operation: 'sse' }, 0);
    await metrics.export();
    expect(latest(exporter).find(record => record.descriptor.name === 'apps.stream.connections')!.dataPoints[0].value).toBe(0);
  });
  it('disabled telemetry preserves dependency behavior and does not poll RPC', async () => {
    const metrics = new ServiceMetrics('clob', { env: {} });
    const rpc = vi.fn(async () => ({ finalized: 100n }));
    await observeIndexerHead(metrics, rpc, () => []);
    expect(rpc).not.toHaveBeenCalled();
    expect(await metrics.dependency('db', 'query', async () => 'unchanged')).toBe('unchanged');
    metrics.http('/unbounded/id', 'GET', 200, 1);
    await metrics.stop();
  });
});


it('delivers cumulative OTLP JSON with histogram seconds and bounded resource identity', async () => {
  const bodies: string[] = [];
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => { bodies.push(body); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  });
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw new Error('receiver missing');
  const metrics = new ServiceMetrics('clob', { env: { APPS_METRICS_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}/v1/metrics`, APPS_TELEMETRY_COMPONENT: 'api', APPS_TELEMETRY_NETWORK: 'devnet' }, routes: ['/health'] });
  try {
    metrics.http('/health', 'GET', 200, 250);
    metrics.gauge('apps.indexer.checkpoint', { stream: 'unknown-private', kind: 'event' }, 12);
    await metrics.export();
    const resource = JSON.parse(bodies[0]).resourceMetrics[0];
    expect(resource.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'clob' } });
    expect(resource.resource.attributes).toContainEqual({ key: 'component', value: { stringValue: 'api' } });
    expect(resource.resource.attributes).toContainEqual({ key: 'network', value: { stringValue: 'devnet' } });
    const wire = resource.scopeMetrics[0].metrics;
    expect(wire.find((metric: any) => metric.name === 'apps.http.duration')).toMatchObject({ unit: 's', histogram: { aggregationTemporality: 2, dataPoints: [{ count: 1, sum: 0.25 }] } });
    const checkpoint = wire.find((metric: any) => metric.name === 'apps.indexer.checkpoint');
    expect(checkpoint.gauge.dataPoints[0].asDouble).toBe(12);
    /* Unit '1' becomes '_ratio' in Prometheus; slots/counts are not ratios. */
    expect(checkpoint.unit ?? '').toBe('');
    expect(bodies[0]).not.toContain('unknown-private');
  } finally {
    await metrics.stop();
    await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()));
  }
});


it('merges static operations across browser and business consumers of one service', async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const first = getServiceMetrics('registry-test', { exporter, env: {}, operations: ['session'] });
  const second = getServiceMetrics('registry-test', { operations: ['js_error'] });
  running.push(first);
  expect(second).toBe(first);
  first.record('apps.business.operations', { operation: 'session', outcome: 'success' });
  second.record('apps.browser.events', { operation: 'js_error', outcome: 'observed' });
  await first.export();
  expect(latest(exporter).find(metric => metric.descriptor.name === 'apps.business.operations')!.dataPoints[0].attributes.operation).toBe('session');
  expect(latest(exporter).find(metric => metric.descriptor.name === 'apps.browser.events')!.dataPoints[0].attributes.operation).toBe('js_error');
});


it('does not emit false lag or freshness for a quiet filtered event stream', async () => {
  const { metrics, exporter } = create();
  await observeIndexerHead(metrics, async () => ({ finalized: 1000n }), () => [{ name: 'trades', kind: 'event', checkpointSlot: '10' }]);
  await metrics.export();
  expect(latest(exporter).find(metric => metric.descriptor.name === 'apps.indexer.lag')).toBeUndefined();
  expect(latest(exporter).find(metric => metric.descriptor.name === 'apps.indexer.progress_known')!.dataPoints[0].value).toBe(0);
  expect(latest(exporter).find(metric => metric.descriptor.name === 'apps.indexer.checkpoint_distance')!.dataPoints[0].value).toBe(990);
  expect(latest(exporter).find(metric => metric.descriptor.name === 'apps.indexer.last_progress_timestamp')).toBeUndefined();
});


it('bounds head sampling, closes stuck probes, and skips disabled probe allocation', async () => {
  const { metrics } = create();
  const close = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    const sampling = sampleIndexerHead(metrics, () => ({ getHeight: () => new Promise(() => {}), close }), () => []);
    await vi.advanceTimersByTimeAsync(5001);
    await sampling;
    expect(close).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('indexer.chain_head_failed'));
    const factory = vi.fn(() => { throw new Error('must never construct'); });
    await sampleIndexerHead(new ServiceMetrics('disabled', { env: {} }), factory, () => []);
    expect(factory).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); warn.mockRestore(); }
});


it('launch histogram has its own buckets and caller-bounded labels in one stream, and shared duration buckets are unchanged', async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metrics = getServiceMetrics('launch-test', { exporter, env: {} });
  running.push(metrics);
  getServiceMetrics('launch-test', { launch: { milestone: ['balance'], mode: ['pwa', 'browser'], cache: ['warm', 'cold'], outcome: ['value'] } });
  metrics.record('apps.browser.launch', { milestone: 'balance', mode: 'pwa', cache: 'warm', outcome: 'value', address: 'secret' }, 1.1);
  metrics.record('apps.browser.launch', { milestone: 'checkout', mode: 'pwa', cache: 'warm', outcome: 'value' }, 1.1);
  metrics.record('apps.browser.duration', { operation: 'js_error', outcome: 'success' }, 1.1);
  await metrics.export();
  const records = latest(exporter);
  const launch = records.filter(metric => metric.descriptor.name === 'apps.browser.launch');
  expect(launch).toHaveLength(1);
  expect(launch[0].descriptor.unit).toBe('s');
  expect(launch[0].dataPoints.map(point => point.attributes)).toEqual([
    { milestone: 'balance', mode: 'pwa', cache: 'warm', outcome: 'value' },
    { milestone: 'other', mode: 'pwa', cache: 'warm', outcome: 'value' },
  ]);
  expect((launch[0].dataPoints[0].value as { buckets: { boundaries: number[] } }).buckets.boundaries).toEqual([0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 30, 60]);
  const duration = records.filter(metric => metric.descriptor.name === 'apps.browser.duration');
  expect(duration).toHaveLength(1);
  expect((duration[0].dataPoints[0].value as { buckets: { boundaries: number[] } }).buckets.boundaries).toEqual([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]);
  expect(JSON.stringify(records)).not.toContain('secret');
});
