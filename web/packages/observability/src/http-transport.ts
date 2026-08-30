import type { BatchTransport, UploadOutcome } from './buffered-queue';

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok'> & Partial<Pick<Response, 'status'>>>;
export type BeaconLike = (url: string | URL, data?: BodyInit | null) => boolean;

export interface HttpJsonTransportOptions {
  /** Absolute URL or same-origin path of the ingestion endpoint. */
  endpoint: string;
  fetch?: FetchLike;
  /** Enables the synchronous teardown path (same-origin only). */
  sendBeacon?: BeaconLike;
  /**
   * Classify HTTP status codes that must not be retried. Defaults to all
   * 4xx statuses except 408, 425, and 429.
   */
  isPermanentStatus?: (status: number | undefined) => boolean;
}

export function isPermanentClientError(status: number | undefined): boolean {
  return (
    typeof status === 'number' && status >= 400 && status < 500 && ![408, 425, 429].includes(status)
  );
}

/**
 * Credential-free JSON POST transport for telemetry batches. Uploads use
 * keepalive inside documents so teardown flushes can outlive the page, and
 * the beacon path refuses cross-origin endpoints, matching sendBeacon's
 * cookie-carrying semantics.
 */
export function createHttpJsonTransport(options: HttpJsonTransportOptions): BatchTransport {
  const endpoint = options.endpoint;
  const isPermanent = options.isPermanentStatus ?? isPermanentClientError;

  const transport: BatchTransport = {
    async send(body: string, signal: AbortSignal | undefined): Promise<UploadOutcome> {
      const fetchImpl =
        options.fetch ??
        (typeof fetch === 'function' ? (fetch as FetchLike) : undefined);
      if (!fetchImpl) return 'retry';
      try {
        const request: RequestInit = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          credentials: 'omit',
          keepalive: true,
          ...(signal ? { signal } : {}),
        };
        const response = await fetchImpl(endpoint, request);
        if (response.ok) return 'success';
        return isPermanent(response.status) ? 'drop' : 'retry';
      } catch {
        return 'retry';
      }
    },
  };

  if (options.sendBeacon) {
    const sendBeacon = options.sendBeacon;
    transport.sendSync = (body: string): boolean => {
      if (typeof Blob !== 'function' || !isSameOriginEndpoint(endpoint)) {
        return false;
      }
      try {
        return sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      } catch {
        return false;
      }
    };
  }

  return transport;
}

function isSameOriginEndpoint(endpoint: string): boolean {
  if (typeof window === 'undefined') return endpoint.startsWith('/');
  try {
    return new URL(endpoint, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}
