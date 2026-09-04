import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BufferedEventQueue,
  type BatchTransport,
  type UploadOutcome,
} from './buffered-queue';
import { createHttpJsonTransport, isPermanentClientError } from './http-transport';
import { createTelemetryId } from './ids';
import { utf8ByteLength } from './utf8';

interface TestEvent {
  sequence: number;
  payload?: string;
}

function serialize(events: TestEvent[]): string {
  return JSON.stringify({ version: 1, events });
}

function createQueue(
  transport: BatchTransport,
  overrides: Partial<ConstructorParameters<typeof BufferedEventQueue<TestEvent>>[0]> = {},
): BufferedEventQueue<TestEvent> {
  return new BufferedEventQueue<TestEvent>({
    transport,
    serializeBatch: serialize,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BufferedEventQueue', () => {
  it('caps batches at maxBatchEvents and drains after success', async () => {
    const bodies: string[] = [];
    const send = vi.fn(async (body: string): Promise<UploadOutcome> => {
      bodies.push(body);
      return 'success';
    });
    const queue = createQueue({ send }, { maxBatchEvents: 20 });

    for (let sequence = 1; sequence <= 45; sequence += 1) {
      queue.enqueue({ sequence });
    }
    while (queue.size > 0) {
      await queue.flush();
    }

    const batches = bodies.map((body) => JSON.parse(body) as { events: TestEvent[] });
    expect(batches.every((batch) => batch.events.length <= 20)).toBe(true);
    expect(batches.flatMap((batch) => batch.events).map((event) => event.sequence)).toEqual(
      Array.from({ length: 45 }, (_, index) => index + 1),
    );
  });

  it('bounds the ring buffer by dropping the oldest events', () => {
    const queue = createQueue(
      { send: () => new Promise<UploadOutcome>(() => {}) },
      { maxQueuedEvents: 5, maxBatchEvents: 100 },
    );
    for (let sequence = 1; sequence <= 8; sequence += 1) {
      queue.enqueue({ sequence });
    }
    expect(queue.size).toBe(5);
  });

  it('respects the byte cap while always sending at least one event', async () => {
    const bodies: string[] = [];
    const queue = createQueue(
      {
        send: async (body) => {
          bodies.push(body);
          return 'success';
        },
      },
      { maxBatchBytes: 120, maxBatchEvents: 10 },
    );
    queue.enqueue({ sequence: 1, payload: 'x'.repeat(200) });
    queue.enqueue({ sequence: 2 });
    await queue.flush();

    const first = JSON.parse(bodies[0]) as { events: TestEvent[] };
    expect(first.events).toHaveLength(1);
    expect(first.events[0].sequence).toBe(1);
  });

  it('restores a failed batch ahead of newer events', async () => {
    const send = vi
      .fn<(body: string, signal: AbortSignal | undefined) => Promise<UploadOutcome>>()
      .mockResolvedValueOnce('retry')
      .mockResolvedValue('success');
    const queue = createQueue({ send });

    queue.enqueue({ sequence: 1 });
    const flush = queue.flush();
    queue.enqueue({ sequence: 2 });
    await flush;

    expect(queue.size).toBe(2);
    await queue.flush(true);
    const retried = JSON.parse(send.mock.calls[1][0]) as { events: TestEvent[] };
    expect(retried.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('drops a permanently rejected batch without retrying', async () => {
    const send = vi.fn(async (): Promise<UploadOutcome> => 'drop');
    const queue = createQueue({ send });
    queue.enqueue({ sequence: 1 });
    await queue.flush();
    expect(queue.size).toBe(0);
  });

  it('applies exponential backoff between transient failures', async () => {
    let nowMs = 0;
    const send = vi.fn(async (): Promise<UploadOutcome> => 'retry');
    const queue = createQueue(
      { send },
      { maxRetryDelayMs: 30_000, flushIntervalMs: 2_000, now: () => nowMs },
    );
    queue.enqueue({ sequence: 1 });

    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    nowMs = 2_000;
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(2);
    /* The retry delay doubles after the second failure. */
    nowMs = 4_000;
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(2);
    nowMs = 6_000;
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(3);
    await queue.flush(true);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('aborts a hung upload via the request timeout', async () => {
    vi.useFakeTimers();
    const send = vi.fn(
      (_body: string, signal: AbortSignal | undefined) =>
        new Promise<UploadOutcome>((resolve) => {
          signal?.addEventListener('abort', () => resolve('retry'));
        }),
    );
    const queue = createQueue({ send }, { requestTimeoutMs: 10_000 });
    queue.enqueue({ sequence: 1 });

    const flush = queue.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush;

    expect(send).toHaveBeenCalledOnce();
    expect(queue.size).toBe(1);
  });

  it('flushes synchronously through the teardown transport', () => {
    const sent: string[] = [];
    const queue = createQueue({
      send: async () => 'success',
      sendSync: (body) => {
        sent.push(body);
        return true;
      },
    });
    queue.enqueue({ sequence: 1 });
    queue.enqueue({ sequence: 2 });

    expect(queue.flushSync()).toBe(true);
    expect(queue.size).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('restores events and reports failure when the sync path rejects a batch', () => {
    const queue = createQueue({
      send: async () => 'success',
      sendSync: () => false,
    });
    queue.enqueue({ sequence: 1 });

    expect(queue.flushSync()).toBe(false);
    expect(queue.size).toBe(1);
  });

  it('clear aborts the in-flight upload and empties the queue', async () => {
    let observedAbort = false;
    const send = vi.fn(
      (_body: string, signal: AbortSignal | undefined) =>
        new Promise<UploadOutcome>((resolve) => {
          signal?.addEventListener('abort', () => {
            observedAbort = true;
            resolve('retry');
          });
        }),
    );
    const queue = createQueue({ send });
    queue.enqueue({ sequence: 1 });
    const flush = queue.flush();
    queue.enqueue({ sequence: 2 });

    queue.clear();
    await flush;

    expect(observedAbort).toBe(true);
    expect(queue.size).toBe(0);
  });

  it('eagerly drains full batches when flushOnFullBatch is set', async () => {
    const bodies: string[] = [];
    const queue = createQueue(
      {
        send: async (body) => {
          bodies.push(body);
          return 'success';
        },
      },
      { maxBatchEvents: 20, flushOnFullBatch: true },
    );
    for (let sequence = 1; sequence <= 45; sequence += 1) {
      queue.enqueue({ sequence });
    }
    await vi.waitFor(() => expect(queue.size).toBe(5));
    expect(bodies).toHaveLength(2);
  });

  it('flushes on the background interval', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (): Promise<UploadOutcome> => 'success');
    const queue = createQueue({ send }, { flushIntervalMs: 2_000 });
    queue.enqueue({ sequence: 1 });

    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledOnce();
    expect(queue.size).toBe(0);
  });
});

describe('createHttpJsonTransport', () => {
  it('classifies responses into success, retry, and drop', async () => {
    const statuses = [200, 500, 400, 429];
    const fetchMock = vi.fn(async () => {
      const status = statuses.shift()!;
      return { ok: status < 300, status };
    });
    const transport = createHttpJsonTransport({ endpoint: '/v1/telemetry', fetch: fetchMock });

    expect(await transport.send('{}', undefined)).toBe('success');
    expect(await transport.send('{}', undefined)).toBe('retry');
    expect(await transport.send('{}', undefined)).toBe('drop');
    expect(await transport.send('{}', undefined)).toBe('retry');
  });

  it('posts credential-free JSON', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    const transport = createHttpJsonTransport({ endpoint: '/v1/telemetry', fetch: fetchMock });
    await transport.send('{"a":1}', undefined);

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/telemetry',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
      }),
    );
  });

  it('returns retry when fetch itself fails', async () => {
    const transport = createHttpJsonTransport({
      endpoint: '/v1/telemetry',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    expect(await transport.send('{}', undefined)).toBe('retry');
  });

  it('only exposes the sync path for same-origin endpoints outside a window', () => {
    const beacon = vi.fn(() => true);
    const sameOrigin = createHttpJsonTransport({ endpoint: '/v1/telemetry', sendBeacon: beacon });
    const crossOrigin = createHttpJsonTransport({
      endpoint: 'https://elsewhere.example/v1/telemetry',
      sendBeacon: beacon,
    });

    expect(sameOrigin.sendSync?.('{}')).toBe(true);
    expect(crossOrigin.sendSync?.('{}')).toBe(false);
  });
});

describe('isPermanentClientError', () => {
  it('treats 4xx as permanent except retryable statuses', () => {
    expect(isPermanentClientError(400)).toBe(true);
    expect(isPermanentClientError(404)).toBe(true);
    expect(isPermanentClientError(408)).toBe(false);
    expect(isPermanentClientError(425)).toBe(false);
    expect(isPermanentClientError(429)).toBe(false);
    expect(isPermanentClientError(500)).toBe(false);
    expect(isPermanentClientError(undefined)).toBe(false);
  });
});

describe('createTelemetryId', () => {
  it('produces unique identifiers safe for the telemetry contract', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createTelemetryId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
      expect(id.length).toBeLessThanOrEqual(128);
    }
  });
});

describe('utf8ByteLength', () => {
  it('matches TextEncoder for mixed content', () => {
    const samples = ['plain ascii', 'çÿrïllîc-ish', '🧪🚀', 'mix 🧪 of ünicode', ''];
    for (const sample of samples) {
      expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).byteLength);
    }
  });
});
