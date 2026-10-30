import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserTelemetryHandler, parseBrowserBatch } from './server.mjs';
const batch = (events = [{ event: 'js_error', timestamp: Date.now() }]) => ({ version: 1, events });
const request = (body, headers = {}) => new Request('https://app.example/api/telemetry/browser', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
test('schema rejects strings, unknown fields, dynamic targets and non-finite/unbounded numbers', () => {
  for (const event of [
    { event: 'js_error', message: 'secret' }, { event: 'js_error', stack: 'secret' },
    { event: 'request_failed', target: '/api/address/secret' }, { event: 'web_vital', target: 'lcp', value: -1 },
    { event: 'request_failed', target: 'api', status: 999 }, { event: 'web_vital', target: 'cls', value: Infinity },
  ]) assert.equal(parseBrowserBatch(batch([{ timestamp: Date.now(), ...event }])), null);
  assert.equal(parseBrowserBatch(batch(Array.from({ length: 21 }, () => ({ event: 'js_error', timestamp: Date.now() })))), null);
  assert.equal(parseBrowserBatch({ ...batch(), token: 'secret' }), null);
});
test('same-origin valid batch reaches sanitized logging and metrics callback', async () => {
  const logged = []; const recorded = [];
  const handler = createBrowserTelemetryHandler({ app: 'explorer', enabled: () => true, log: e => logged.push(e), record: e => recorded.push(e) });
  const event = { event: 'request_failed', timestamp: Date.now(), target: 'rpc', status: 503, durationMs: 123 };
  assert.equal((await handler(request(batch([event])))).status, 204);
  assert.deepEqual(recorded, [event]);
  assert.deepEqual(logged, [{ component: 'browser-telemetry', app: 'explorer', ...event }]);
  assert.equal((await handler(request(batch(), { origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await handler(request(batch(), { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await handler(request(batch(), { origin: '' }))).status, 403);
});
test('body bounds apply without trusting content-length; malformed batches never emit', async () => {
  let calls = 0;
  const handler = createBrowserTelemetryHandler({ app: 'faucet', enabled: () => true, log: () => calls++ });
  assert.equal((await handler(request('x'.repeat(16385)))).status, 413);
  assert.equal((await handler(request('{invalid'))).status, 400);
  assert.equal((await handler(request(batch([{ event: 'js_error', timestamp: Date.now(), address: 'secret' }])))).status, 400);
  assert.equal(calls, 0);
});
test('global bucket and disabled gate bound untrusted traffic', async () => {
  const handler = createBrowserTelemetryHandler({ app: 'gallery', enabled: () => true, log: () => {} });
  for (let i = 0; i < 120; i++) assert.equal((await handler(request(batch()))).status, 204);
  assert.equal((await handler(request(batch()))).status, 429);
  assert.equal((await createBrowserTelemetryHandler({ app: 'gallery', enabled: () => false })(request('garbage'))).status, 204);
});
test('trusted JSON origin list accepts all explicit hosts and rejects wildcard, suffix, malformed config', async () => {
  const { readBrowserTelemetryOrigins } = await import('./server.mjs');
  const primary = 'https://thru.org'; const alias = 'https://www.thru.org';
  const origins = readBrowserTelemetryOrigins({ APPS_BROWSER_TELEMETRY_ORIGINS: JSON.stringify([primary, alias, primary]) });
  assert.deepEqual(origins, [primary, alias]);
  const handler = createBrowserTelemetryHandler({ app: 'thru-web', origins, enabled: () => true, log: () => {} });
  for (const origin of origins) assert.equal((await handler(request(batch(), { origin }))).status, 204);
  for (const origin of ['https://thru.org.attacker.test', 'https://evil.thru.org', 'null', '']) assert.equal((await handler(request(batch(), { origin }))).status, 403);
  for (const value of ['{invalid', '[]', '["https://*.thru.org"]', '["https://thru.org/path"]', '["https://user@thru.org"]', '"https://thru.org"']) {
    const malformed = readBrowserTelemetryOrigins({ APPS_BROWSER_TELEMETRY_ORIGINS: value, APPS_BROWSER_TELEMETRY_ORIGIN: primary });
    assert.deepEqual(malformed, []);
    assert.equal((await createBrowserTelemetryHandler({ app: 'test', origins: malformed, enabled: () => true })(request(batch(), { origin: primary }))).status, 403);
  }
  assert.deepEqual(readBrowserTelemetryOrigins({ APPS_BROWSER_TELEMETRY_ORIGIN: primary }), [primary]);
});
test('launch events need value and every launch label; other events may not carry them', () => {
  const launch = { event: 'launch', timestamp: Date.now(), value: 1200, milestone: 'balance', mode: 'pwa', cache: 'warm', outcome: 'value', network: 'alphanet' };
  assert.deepEqual(parseBrowserBatch(batch([launch])), [launch]);
  const { value, ...noValue } = launch;
  const rejected = [noValue, { ...launch, value: 300001 }, { ...launch, milestone: 'checkout' }, { ...launch, outcome: 'secret' },
    ...['milestone', 'mode', 'cache', 'outcome', 'network'].map(key => { const { [key]: _, ...rest } = launch; return rest; }),
    { event: 'js_error', timestamp: Date.now(), outcome: 'value' }, { event: 'web_vital', timestamp: Date.now(), target: 'lcp', value, milestone: 'shell' }];
  for (const event of rejected) assert.equal(parseBrowserBatch(batch([{ event: 'js_error', timestamp: Date.now() }, event])), null, JSON.stringify(event));
});
