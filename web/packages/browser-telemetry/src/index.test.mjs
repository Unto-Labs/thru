import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_LAUNCH_LABELS, installBrowserTelemetry, recordBrowserEvent, monitorBrowserStream } from './index.ts';
import { BROWSER_LAUNCH_LABELS as SERVER_LAUNCH_LABELS, parseBrowserBatch } from './server.mjs';
function browser({ endpoint = '/api/telemetry/browser' } = {}) {
  const sent = [];
  const window = new EventTarget();
  window.location = { href: 'https://app.example/', origin: 'https://app.example' };
  const fetch = async (input, init) => {
    if (input === endpoint) { sent.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 503 });
  };
  window.fetch = fetch;
  const document = new EventTarget(); document.visibilityState = 'visible';
  globalThis.window = window; globalThis.document = document;
  return { window, document, sent, fetch };
}
test('sampling, explicit field projection, budgets and teardown', async () => {
  const b = browser();
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  for (let i = 0; i < 100; i++) recordBrowserEvent({ event: 'js_error', message: 'secret', url: '?token=secret' });
  b.window.dispatchEvent(new Event('pagehide'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.sent[0].events.length, 20);
  assert.deepEqual(Object.keys(b.sent[0].events[0]).sort(), ['event', 'timestamp']);
  stop(); assert.equal(b.window.fetch, b.fetch);
  const count = b.sent.length;
  b.window.dispatchEvent(new Event('error')); recordBrowserEvent({ event: 'js_error' });
  b.window.dispatchEvent(new Event('pagehide'));
  assert.equal(b.sent.length, count);
  const stopSampled = installBrowserTelemetry({ sampleRate: 0 });
  b.window.dispatchEvent(new Event('error')); stopSampled();
  assert.equal(b.sent.length, count);
});
test('failed fetch preserves response and strips URL', async () => {
  const b = browser(); const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  assert.equal((await b.window.fetch('/api/account/secret?token=sensitive')).status, 503);
  assert.equal((await b.window.fetch('https://rpc.example/thru.rpc.Service/GetAccount?token=secret')).status, 503);
  b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
  const events = b.sent[0].events.filter(e => e.event !== 'web_vital');
  assert.deepEqual(events.map(e => e.target), ['api', 'rpc']);
  assert.ok(!JSON.stringify(events).includes('secret'));
  stop();
});
test('stream lifecycle emits one disconnect and reconnect per interruption', async () => {
  const b = browser(); const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  const stream = monitorBrowserStream('blocks');
  stream.disconnect(); stream.disconnect(); stream.message(); stream.message(); stream.dispose();
  b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(b.sent[0].events.filter(e => e.event !== 'web_vital').map(e => e.event), ['stream_disconnected', 'stream_reconnected']);
  stop();
});
test('aborted fetch is ignored and network failure remains observable without exception text', async () => {
  const b = browser();
  b.window.fetch = async (input, init) => {
    if (input === '/api/telemetry/browser') return b.fetch(input, init);
    throw new Error('secret address and token');
  };
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(b.window.fetch('/api/private?token=secret', { signal: controller.signal }));
  await assert.rejects(b.window.fetch('/api/private?token=secret'));
  b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
  const failures = b.sent[0].events.filter(e => e.event === 'request_failed');
  assert.equal(failures.length, 1); assert.equal(failures[0].status, 0);
  assert.ok(!JSON.stringify(b.sent).includes('secret'));
  stop();
});
test('staleness emits once until data resumes and disposal clears the monitor', async t => {
  const b = browser();
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() });
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  const stream = monitorBrowserStream('transactions', 500);
  t.mock.timers.tick(1500);
  stream.message(); stream.dispose();
  b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(b.sent[0].events.filter(e => e.event !== 'web_vital').map(e => e.event), ['stream_stale', 'stream_reconnected']);
  t.mock.timers.tick(1000);
  stop();
});
test('per-minute event budget caps repeated batches', async () => {
  const b = browser(); const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  try {
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 20; i++) recordBrowserEvent({ event: 'js_error' });
      b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(b.sent.flatMap(batch => batch.events).length, 60);
    assert.equal(b.sent.length, 3);
  } finally { stop(); }
});
test('visibility flush includes error and vitals together and disconnects observers', async () => {
  const b = browser(); const observers = [];
  globalThis.PerformanceObserver = class {
    static supportedEntryTypes = ['largest-contentful-paint', 'layout-shift', 'event'];
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(options) { this.type = options.type; }
    disconnect() { this.disconnected = true; }
  };
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  try {
    for (const observer of observers) observer.callback({ getEntries: () => observer.type === 'largest-contentful-paint' ? [{ startTime: 1200 }] : observer.type === 'event' ? [{ interactionId: 1, duration: 80 }] : [{ startTime: 100, hadRecentInput: false, value: 0.2 }] });
    b.window.dispatchEvent(new Event('error'));
    b.document.visibilityState = 'hidden'; b.document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(b.sent[0].events.map(e => e.event), ['js_error', 'web_vital', 'web_vital', 'web_vital']);
    assert.deepEqual(b.sent[0].events.slice(1).map(e => [e.target, e.value]), [['lcp', 1200], ['cls', 0.2], ['interaction_max', 80]]);
    b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.sent.length, 1);
  } finally { stop(); delete globalThis.PerformanceObserver; }
  assert.ok(observers.every(observer => observer.disconnected));
});
for (const lifecycle of ['pagehide', 'teardown']) {
  test(`bounded final ${lifecycle} upload proceeds while periodic upload is unresolved`, async t => {
    const b = browser(); const uploads = []; const complete = [];
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    globalThis.PerformanceObserver = class {
      static supportedEntryTypes = ['layout-shift'];
      observe() {} disconnect() {}
    };
    b.window.fetch = (endpoint, init) => {
      uploads.push({ endpoint, batch: JSON.parse(init.body) });
      return new Promise(resolve => complete.push(() => resolve(new Response(null, { status: 204 }))));
    };
    const originalFetch = b.window.fetch;
    const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
    try {
      recordBrowserEvent({ event: 'js_error' });
      t.mock.timers.tick(10_000);
      assert.equal(uploads.length, 1);
      recordBrowserEvent({ event: 'unhandled_rejection' });
      if (lifecycle === 'pagehide') b.window.dispatchEvent(new Event('pagehide'));
      else stop();
      assert.equal(uploads.length, 2);
      assert.deepEqual(uploads[1].batch.events.map(e => e.event), ['unhandled_rejection', 'web_vital']);
      assert.equal(uploads[1].batch.events[1].target, 'cls');
      recordBrowserEvent({ event: 'js_error' });
      b.window.dispatchEvent(new Event('pagehide'));
      assert.equal(uploads.length, 2, 'at most two uploads can be in flight');
    } finally {
      stop(); for (const resolve of complete) resolve();
      await new Promise(resolve => setImmediate(resolve));
      delete globalThis.PerformanceObserver;
    }
    assert.equal(b.window.fetch, originalFetch);
  });
}
test('missing AbortSignal.timeout preserves future uploads and teardown', async t => {
  const b = browser(); const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  try {
    recordBrowserEvent({ event: 'js_error' });
    assert.doesNotThrow(() => t.mock.timers.tick(10_000));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.sent.length, 1);
    recordBrowserEvent({ event: 'unhandled_rejection' });
    assert.doesNotThrow(stop);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.sent.length, 2);
    assert.equal(b.window.fetch, b.fetch);
    b.window.dispatchEvent(new Event('error'));
    t.mock.timers.tick(60_000);
    assert.equal(b.sent.length, 2);
  } finally { Object.defineProperty(AbortSignal, 'timeout', descriptor); stop(); }
});
test('synchronous transport failure is contained and does not poison later flushes', async t => {
  const b = browser(); let attempts = 0;
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  b.window.fetch = (input, init) => { if (++attempts === 1) throw new Error('synthetic transport failure'); return b.fetch(input, init); };
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  try {
    recordBrowserEvent({ event: 'js_error' });
    assert.doesNotThrow(() => t.mock.timers.tick(10_000));
    await new Promise(resolve => setImmediate(resolve));
    recordBrowserEvent({ event: 'unhandled_rejection' });
    assert.doesNotThrow(stop);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2); assert.equal(b.sent.length, 1);
  } finally { stop(); }
});
test('CLS session window begins at the first accepted shift within the first second', async () => {
  const b = browser(); let deliver;
  globalThis.PerformanceObserver = class {
    static supportedEntryTypes = ['layout-shift'];
    constructor(callback) { deliver = entries => callback({ getEntries: () => entries }); }
    observe() {} disconnect() {}
  };
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  try {
    deliver([100, 900, 1700, 2500, 3300, 4100, 4900, 5050].map(startTime => ({ startTime, hadRecentInput: false, value: 0.1 })));
    stop(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.sent.length, 1);
    const cls = b.sent[0].events.find(e => e.target === 'cls');
    assert.ok(Math.abs(cls.value - 0.8) < 1e-10);
  } finally { stop(); delete globalThis.PerformanceObserver; }
});
for (const mode of ['unsupported', 'observe throws']) {
  test(`CLS is omitted when layout-shift observation is ${mode}`, async () => {
    const b = browser();
    globalThis.PerformanceObserver = class {
      static supportedEntryTypes = mode === 'unsupported' ? [] : ['layout-shift'];
      observe() { throw new Error('unsupported observer'); } disconnect() {}
    };
    const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
    try {
      recordBrowserEvent({ event: 'js_error' }); stop();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(b.sent.length, 1);
      assert.ok(b.sent[0].events.every(e => e.target !== 'cls'));
    } finally { stop(); delete globalThis.PerformanceObserver; }
  });
}
test('blog reports use the deployed /blog/api/telemetry/browser endpoint', async () => {
  const endpoint = '/blog/api/telemetry/browser'; const b = browser({ endpoint }); const calls = [];
  b.window.fetch = (input, init) => { calls.push(input); return b.fetch(input, init); };
  const stop = installBrowserTelemetry({ endpoint, sampleRate: 1, random: () => 0 });
  try {
    recordBrowserEvent({ event: 'js_error' }); stop();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [endpoint]); assert.equal(b.sent.length, 1);
    assert.equal(b.sent[0].events[0].event, 'js_error');
  } finally { stop(); }
});
test('upload deadline aborts after five seconds without retries and releases its slot', async t => {
  const b = browser(); const signals = [];
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  b.window.fetch = (_input, init) => {
    signals.push(init.signal);
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true }));
  };
  const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  try {
    recordBrowserEvent({ event: 'js_error' }); t.mock.timers.tick(10_000);
    assert.equal(signals.length, 1);
    t.mock.timers.tick(4999); assert.equal(signals[0].aborted, false);
    t.mock.timers.tick(1); assert.equal(signals[0].aborted, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signals.length, 1, 'failed uploads are not retried');
    recordBrowserEvent({ event: 'unhandled_rejection' });
    t.mock.timers.tick(5000);
    assert.equal(signals.length, 2, 'the periodic slot is available again');
    stop(); t.mock.timers.tick(5000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signals[1].aborted, true);
  } finally { stop(); }
});
const balance = { event: 'launch', value: 1834, milestone: 'balance', mode: 'browser', cache: 'warm', outcome: 'value', network: 'alphanet' };
async function sentEvents(b) {
  b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
  return b.sent.flatMap(batch => batch.events).filter(e => e.event !== 'web_vital');
}
test('launch events skip sampling and carry exactly the launch schema', async () => {
  const b = browser(); const stop = installBrowserTelemetry({ sampleRate: 0 });
  try {
    recordBrowserEvent({ ...balance, secret: 'secret' });
    recordBrowserEvent({ event: 'js_error' });
    const events = await sentEvents(b);
    assert.deepEqual(events.map(e => e.event), ['launch']);
    const { timestamp, ...rest } = events[0];
    assert.ok(Number.isInteger(timestamp));
    assert.deepEqual(rest, balance);
  } finally { stop(); }
});
test('a launch event outside the schema never reaches the wire and does not spoil the batch', async () => {
  const b = browser(); const stop = installBrowserTelemetry({ sampleRate: 1, random: () => 0 });
  try {
    recordBrowserEvent({ ...balance, outcome: 'secret' });
    recordBrowserEvent({ ...balance, milestone: undefined });
    recordBrowserEvent({ ...balance, value: undefined });
    recordBrowserEvent({ event: 'js_error' });
    const events = await sentEvents(b);
    assert.deepEqual(events.map(e => e.event), ['js_error']);
    assert.ok(!JSON.stringify(b.sent).includes('secret'));
  } finally { stop(); }
});
test('client and server agree on every launch label, and what the client sends the server parses', async () => {
  assert.deepEqual(structuredClone(BROWSER_LAUNCH_LABELS), structuredClone(SERVER_LAUNCH_LABELS));
  const b = browser(); const stop = installBrowserTelemetry({ sampleRate: 0 });
  try {
    const width = Math.max(...Object.values(BROWSER_LAUNCH_LABELS).map(values => values.length));
    for (let i = 0; i < width; i++) {
      recordBrowserEvent({ event: 'launch', value: i, ...Object.fromEntries(Object.entries(BROWSER_LAUNCH_LABELS).map(([key, values]) => [key, values[i % values.length]])) });
    }
    b.window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.sent.length, 1);
    assert.equal(b.sent[0].events.filter(e => e.event === 'launch').length, width);
    assert.deepEqual(parseBrowserBatch(b.sent[0]), b.sent[0].events);
  } finally { stop(); }
});
