// @vitest-environment jsdom

import { encodeAddress, encodeSignature } from '@thru/sdk/helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TELEMETRY_ENABLED_SEARCH_PARAM,
  TELEMETRY_SESSION_SEARCH_PARAM,
  TelemetryClient,
  sanitizeTelemetryMessage,
  telemetryEndpointForWalletUrl,
  withTelemetryParameters,
  type TelemetryEvent,
} from './telemetry';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TelemetryClient', () => {
  it('batches no more than 20 events and preserves one monotonic sequence', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient();

    for (let index = 0; index < 45; index++) {
      client.record('SDK.TEST.EVENT', { operation: `operation_${index}` });
    }

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const batches = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1].body as string) as {
        version: number;
        events: TelemetryEvent[];
      },
    );
    expect(batches.every((batch) => batch.version === 1)).toBe(true);
    expect(batches.every((batch) => batch.events.length <= 20)).toBe(true);
    expect(batches.flatMap((batch) => batch.events).map((event) => event.sequence))
      .toEqual(Array.from({ length: 45 }, (_, index) => index + 1));
    expect(batches[0].events[0].event).toBe('sdk.test.event');

    client.destroy();
  });

  it('bounds its pending queue at 200 events', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const client = createClient();

    for (let index = 0; index < 240; index++) {
      client.record('sdk.queue.test');
    }

    expect(client.pendingEventCount).toBe(200);
    client.destroy();
  });

  it('uses sendBeacon on page unload only for a same-origin endpoint', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const client = new TelemetryClient({
      walletUrl: `${window.location.origin}/embedded`,
      sessionId: 'session-same-origin',
    });
    client.record('sdk.unload.test');

    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe(
      `${window.location.origin}/v1/telemetry`,
    );
    expect(sendBeacon.mock.calls[0][1]).toBeInstanceOf(Blob);
    client.destroy();
  });

  it('uses credential-free keepalive fetch for cross-origin unloads', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient();
    client.record('sdk.cross_origin_unload.test');

    window.dispatchEvent(new Event('pagehide'));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      keepalive: true,
    });
    client.destroy();
  });

  it('silently retains and retries a failed upload', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient();
    client.record('sdk.retry.test');

    await expect(client.flush()).resolves.toBeUndefined();
    expect(client.pendingEventCount).toBe(1);
    await expect(client.flush()).resolves.toBeUndefined();
    expect(client.pendingEventCount).toBe(0);
    client.destroy();
  });

  it('aborts a hung upload and leaves its batch available for retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Pick<Response, 'ok'>>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient();
    client.record('sdk.hung_upload.test');

    const flush = client.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(flush).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.pendingEventCount).toBe(1);
    client.discard();
  });

  it('keeps a failed oldest batch when newer events fill the queue', async () => {
    let rejectUpload: ((reason?: unknown) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Pick<Response, 'ok'>>((_resolve, reject) => {
          rejectUpload = reject;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient();
    client.record('sdk.failed_oldest.test');
    const flush = client.flush();
    for (let index = 0; index < 200; index++) {
      client.record('sdk.newer.test');
    }

    rejectUpload?.(new Error('offline'));
    await flush;

    const pending = (
      client as unknown as { queue: { snapshot(): TelemetryEvent[] } }
    ).queue.snapshot();
    expect(pending).toHaveLength(200);
    expect(pending[0].sequence).toBe(1);
    expect(pending[pending.length - 1]?.sequence).toBe(200);
    client.discard();
  });

  it('collects and uploads nothing when disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient(false);
    client.record('sdk.disabled.test', { message: 'should not be retained' });

    await client.flush();
    client.destroy();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.pendingEventCount).toBe(0);
  });

  it('discards queued events without an upload attempt', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient();
    client.record('sdk.constructor.failed');

    client.discard();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.pendingEventCount).toBe(0);
  });

  it('keeps batches below the ingestion byte limit with maximum Unicode messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient();
    const maxMessage = '🧪'.repeat(256);
    const safeId = 'a'.repeat(128);
    const walletAddress = encodeAddress(new Uint8Array(32).fill(1));
    const programAddress = encodeAddress(new Uint8Array(32).fill(2));
    const transactionSignature = encodeSignature(new Uint8Array(64).fill(3));

    for (let index = 0; index < 20; index++) {
      client.record('sdk.maximum.event', {
        message: maxMessage,
        frameId: safeId,
        requestId: safeId,
        walletAddress,
        programAddress,
        transactionSignature,
      });
    }

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const call of fetchMock.mock.calls) {
      const body = call[1].body as string;
      expect(new TextEncoder().encode(body).byteLength).toBeLessThan(64 * 1024);
      expect((JSON.parse(body) as { events: unknown[] }).events.length).toBeLessThanOrEqual(20);
    }
    client.destroy();
  });

  it('keeps only canonical public Thru addresses and signatures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const walletAddress = encodeAddress(new Uint8Array(32).fill(4));
    const programAddress = encodeAddress(new Uint8Array(32).fill(5));
    const transactionSignature = encodeSignature(new Uint8Array(64).fill(6));
    const client = new TelemetryClient({
      walletUrl: 'https://app.tid.sh/embedded',
      sessionId: 'session-identifiers',
      context: {
        walletAddress: '11'.repeat(32),
        programAddress,
      },
    });
    client.record('sdk.identifiers.valid', {
      walletAddress,
      programAddress: '22'.repeat(32),
      transactionSignature,
    });
    client.record('sdk.identifiers.context');
    client.record('sdk.identifiers.invalid_signature', {
      transactionSignature: '33'.repeat(64),
    });

    await client.flush();

    const events = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      .events as TelemetryEvent[];
    expect(events[0]).toMatchObject({ walletAddress, transactionSignature });
    expect(events[0].programAddress).toBeUndefined();
    expect(events[1]).toMatchObject({ programAddress });
    expect(events[1].walletAddress).toBeUndefined();
    expect(events[2].transactionSignature).toBeUndefined();
    client.destroy();
  });

  it('normalizes custom-scheme app origins without retaining paths or query data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = new TelemetryClient({
      walletUrl: 'https://app.tid.sh/embedded',
      sessionId: 'session-custom-origin',
      context: { appOrigin: 'thru-mobile://sweeps/callback?token=secret' },
    });
    client.record('sdk.origin.test');
    await client.flush();

    const batch = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(batch.events[0].appOrigin).toBe('thru-mobile://sweeps');
    client.destroy();
  });
});

describe('telemetry URL and redaction helpers', () => {
  it('sets explicit hosted-wallet telemetry parameters', () => {
    const enabled = new URL(
      withTelemetryParameters(
        'https://app.tid.sh/embedded?existing=1',
        true,
        'session-123',
      ),
    );
    expect(enabled.searchParams.get('existing')).toBe('1');
    expect(enabled.searchParams.get(TELEMETRY_ENABLED_SEARCH_PARAM)).toBe('1');
    expect(enabled.searchParams.get(TELEMETRY_SESSION_SEARCH_PARAM)).toBe('session-123');

    const disabled = new URL(withTelemetryParameters(enabled.toString(), false, 'off'));
    expect(disabled.searchParams.get(TELEMETRY_ENABLED_SEARCH_PARAM)).toBe('0');
  });

  it('derives the endpoint from only the wallet origin', () => {
    expect(
      telemetryEndpointForWalletUrl(
        'https://user:password@app.tid.sh/embedded?token=secret#fragment',
      ),
    ).toBe('https://app.tid.sh/v1/telemetry');
  });

  it('redacts sensitive fields, bearer credentials, and all URL query data', () => {
    const message = sanitizeTelemetryMessage(
      'credential_id=abc cookie=session123 authorization=Bearer topsecret ' +
        'instruction_bytes=deadbeef account_contents=private ' +
        'https://example.com/callback?token=secret ' +
        'thru-mobile://sweeps/callback?code=secret ' +
        '/local/path?token=secret ' +
        '/fragment/path#private-section ' +
        'callback?code=bare-secret redirect#bare-fragment ' +
        'https%3A%2F%2Fexample.com%2Fcallback%3Ftoken%3Dsecret',
    );

    expect(message).toContain('credential_id=[REDACTED]');
    expect(message).toContain('cookie=[REDACTED]');
    expect(message).toContain('authorization=[REDACTED]');
    expect(message).toContain('instruction_bytes=[REDACTED]');
    expect(message).toContain('account_contents=[REDACTED]');
    expect(message).toContain('https://example.com/callback');
    expect(message).toContain('thru-mobile://sweeps/callback');
    expect(message).toContain('/local/path');
    expect(message).toContain('/fragment/path');
    expect(message).toContain('callback');
    expect(message).toContain('redirect');
    expect(message).not.toContain('secret');
    expect(message).not.toContain('topsecret');
    expect(message).not.toContain('session123');
    expect(message).not.toContain('deadbeef');
    expect(message).not.toContain('?token=');
    expect(message).not.toContain('?code=');
    expect(message).not.toContain('#private-section');
    expect(message).not.toContain('bare-secret');
    expect(message).not.toContain('bare-fragment');
    expect(message).not.toContain('%3Ftoken');
  });

  it('redacts quoted JSON, camelCase secrets, passwords, and basic auth', () => {
    const message = sanitizeTelemetryMessage(
      '{"token":"json-secret","sessionId":"session-secret",' +
        '"client_secret":"client-secret","password":"password-secret",' +
        '"passkeyAssertion":"assertion-secret","instructionData":"AQID",' +
        '"amount":"123.45"} authorization: Basic dXNlcjpwYXNz',
    );

    expect(message).not.toContain('json-secret');
    expect(message).not.toContain('session-secret');
    expect(message).not.toContain('client-secret');
    expect(message).not.toContain('password-secret');
    expect(message).not.toContain('assertion-secret');
    expect(message).not.toContain('AQID');
    expect(message).not.toContain('123.45');
    expect(message).not.toContain('dXNlcjpwYXNz');
    expect(message).toContain('[REDACTED]');
  });

  it('redacts unlabeled numeric values that could be amounts or balances', () => {
    const message = sanitizeTelemetryMessage(
      'transfer failed: have 123.45, need 9,999.00, delta -2.5e3',
    );

    expect(message).not.toContain('123.45');
    expect(message).not.toContain('9,999.00');
    expect(message).not.toContain('2.5e3');
    expect(message).toContain('[REDACTED_NUMBER]');
  });
});

function createClient(enabled = true): TelemetryClient {
  return new TelemetryClient({
    enabled,
    walletUrl: 'https://app.tid.sh/embedded?ignored=1',
    sessionId: 'session-test',
    source: 'sdk',
    context: {
      appOrigin: 'https://third-party.example/path?secret=1',
      sdkVersion: '1.2.3',
      platform: 'browser',
    },
  });
}
