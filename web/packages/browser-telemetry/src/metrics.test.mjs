import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceMetrics } from '../../server-telemetry/src/index.ts';
import { BROWSER_EVENTS, createBrowserTelemetryHandler } from './server.mjs';

test('every browser event reaches the real metric provider with fixed operation labels', async () => {
  const exports = [];
  const exporter = {
    export(data, done) { exports.push(data); done({ code: 0 }); },
    async forceFlush() {}, async shutdown() {},
  };
  const metrics = new ServiceMetrics('browser-test', { exporter, operations: BROWSER_EVENTS });
  const target = name => name === 'web_vital' ? 'lcp' : name.startsWith('stream_') ? 'blocks' : ['rpc_failed', 'request_failed'].includes(name) ? 'rpc' : undefined;
  try {
    const handle = createBrowserTelemetryHandler({ app: 'explorer', enabled: () => true, log: () => {}, record: event => {
      metrics.record('apps.browser.events', { operation: event.event, outcome: 'observed' });
      if (event.durationMs !== undefined) metrics.record('apps.browser.duration', { operation: event.event, outcome: 'observed' }, event.durationMs / 1000);
    } });
    const extra = name => name === 'launch' ? { value: 1200, milestone: 'balance', mode: 'browser', cache: 'cold', outcome: 'value', network: 'alphanet' } : target(name) ? { target: target(name) } : {};
    const events = BROWSER_EVENTS.map(event => ({ event, timestamp: Date.now(), ...extra(event), ...(['request_failed', 'rpc_failed'].includes(event) ? { durationMs: 125 } : {}) }));
    const response = await handle(new Request('https://app.example/api/telemetry/browser', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, events }) }));
    assert.equal(response.status, 204);
    await metrics.export();
    const recorded = exports.flatMap(e => e.scopeMetrics).flatMap(e => e.metrics);
    const counter = recorded.find(e => e.descriptor.name === 'apps.browser.events');
    assert.ok(counter);
    assert.deepEqual(counter.dataPoints.map(e => e.attributes.operation).sort(), [...BROWSER_EVENTS].sort());
    assert.ok(counter.dataPoints.every(e => e.attributes.outcome === 'observed'));
    const duration = recorded.find(e => e.descriptor.name === 'apps.browser.duration');
    assert.ok(duration);
    assert.ok(duration.dataPoints.every(e => e.value.sum === 0.125));
  } finally { await metrics.stop(); }
});
