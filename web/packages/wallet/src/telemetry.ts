import {
  BufferedEventQueue,
  createHttpJsonTransport,
  createTelemetryId,
  encodeTelemetryAppContext,
  isCanonicalEncoding,
  sanitizeTelemetryAppContext,
  sanitizeTelemetryMessage,
  TELEMETRY_FIELD_LIMITS as FIELD_LIMITS,
  TELEMETRY_IDENTIFIER_PATTERN,
  TELEMETRY_MAX_EVENT_NAME_LENGTH as TELEMETRY_MAX_EVENT_LENGTH,
  TELEMETRY_VERSION_PATTERN,
  type TelemetryAppContext,
} from '@thru/observability';
import {
  decodeAddress,
  decodeSignature,
  encodeAddress,
  encodeSignature,
} from '@thru/sdk/helpers';
import packageMetadata from '../package.json';

export { sanitizeTelemetryMessage } from '@thru/observability';
export type { TelemetryAppContext } from '@thru/observability';

/** Package version embedded at build time (including release-workflow rewrites). */
export const WALLET_SDK_VERSION = packageMetadata.version;
export const TELEMETRY_BATCH_VERSION = 1 as const;
export const TELEMETRY_ENABLED_SEARCH_PARAM = 'tn_telemetry';
export const TELEMETRY_SESSION_SEARCH_PARAM = 'tn_telemetry_session';
export const TELEMETRY_APP_CONTEXT_SEARCH_PARAM = 'tn_telemetry_app_context';
export const TELEMETRY_CONTEXT_SEARCH_PARAM = 'tn_telemetry_context';

const TELEMETRY_PATH = '/v1/telemetry';

export type TelemetrySource = 'sdk' | 'bridge' | 'wallet' | 'rpc';
export type TelemetrySeverity = 'debug' | 'info' | 'warn' | 'error';

export interface TelemetryEvent {
  timestamp: string;
  sequence: number;
  source: TelemetrySource;
  event: string;
  severity: TelemetrySeverity;
  sessionId: string;
  /** Minted once per running client instance to separate concurrent producers. */
  producerId?: string;
  /** Minted once per event and preserved across retries for de-duplication. */
  eventId?: string;
  /** Opaque host-app-provided correlation label. Never minted by the SDK. */
  appContextId?: string;
  /** Bounded host-app-provided dimensions. Never minted or interpreted. */
  appContext?: TelemetryAppContext;
  frameId?: string;
  requestId?: string;
  appOrigin?: string;
  sdkVersion?: string;
  walletVersion?: string;
  platform?: string;
  network?: string;
  operation?: string;
  durationMs?: number;
  outcome?: string;
  errorCode?: string;
  walletAddress?: string;
  programAddress?: string;
  transactionSignature?: string;
  message?: string;
}

export type TelemetryContext = Partial<
  Pick<
    TelemetryEvent,
    | 'source'
    | 'frameId'
    | 'appOrigin'
    | 'sdkVersion'
    | 'walletVersion'
    | 'platform'
    | 'network'
    | 'operation'
    | 'walletAddress'
    | 'programAddress'
  >
>;

export type TelemetryEventFields = Omit<
  Partial<TelemetryEvent>,
  | 'timestamp'
  | 'sequence'
  | 'event'
  | 'sessionId'
  | 'producerId'
  | 'eventId'
  | 'appContextId'
  | 'appContext'
  | 'message'
> & {
  message?: unknown;
};

export interface TelemetryClientOptions {
  /** Telemetry is enabled unless explicitly disabled. */
  enabled?: boolean;
  /** Hosted wallet URL. Only its origin is used for telemetry uploads. */
  walletUrl: string;
  /** A caller-provided ID allows the SDK and hosted wallet to share a trace. */
  sessionId?: string;
  /** Opaque host-app-provided cross-session correlation label. */
  appContextId?: string;
  /** Bounded host-app-provided dimensions stamped on every event. */
  appContext?: TelemetryAppContext;
  /** Default source for events. Individual records may override it. */
  source?: TelemetrySource;
  /** Safe fields included on every event unless overridden. */
  context?: TelemetryContext;
}

interface TelemetryBatch {
  version: typeof TELEMETRY_BATCH_VERSION;
  events: TelemetryEvent[];
}

const TELEMETRY_SOURCES = new Set<TelemetrySource>([
  'sdk',
  'bridge',
  'wallet',
  'rpc',
]);
const TELEMETRY_SEVERITIES = new Set<TelemetrySeverity>([
  'debug',
  'info',
  'warn',
  'error',
]);

/** Generate a session identifier without relying on a browser-only API. */
export function createTelemetrySessionId(): string {
  return createTelemetryId();
}

/** Resolve the credential-free ingestion endpoint on the wallet's origin. */
export function telemetryEndpointForWalletUrl(walletUrl: string): string {
  const wallet = new URL(walletUrl);
  if (wallet.origin === 'null') {
    throw new Error('Wallet telemetry requires a non-opaque HTTP(S) origin');
  }
  return new URL(TELEMETRY_PATH, wallet.origin).toString();
}

/** Add the hosted-wallet telemetry contract to an embedded wallet URL. */
export function withTelemetryParameters(
  walletUrl: string,
  enabled: boolean,
  sessionId: string,
  appContextId?: string,
  appContext?: TelemetryAppContext,
): string {
  const url = new URL(walletUrl);
  url.searchParams.set(TELEMETRY_ENABLED_SEARCH_PARAM, enabled ? '1' : '0');
  url.searchParams.set(TELEMETRY_SESSION_SEARCH_PARAM, sessionId);
  const sanitizedAppContextId = sanitizeAppContextId(appContextId);
  if (sanitizedAppContextId) {
    url.searchParams.set(TELEMETRY_APP_CONTEXT_SEARCH_PARAM, sanitizedAppContextId);
  } else {
    url.searchParams.delete(TELEMETRY_APP_CONTEXT_SEARCH_PARAM);
  }
  const encodedContext = encodeTelemetryAppContext(appContext);
  if (encodedContext) {
    url.searchParams.set(TELEMETRY_CONTEXT_SEARCH_PARAM, encodedContext);
  } else {
    url.searchParams.delete(TELEMETRY_CONTEXT_SEARCH_PARAM);
  }
  return url.toString();
}

/** Correlation keys are never mutated into misleading values; invalid input
    is omitted instead. */
export function sanitizeAppContextId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > FIELD_LIMITS.appContextId ||
    !TELEMETRY_IDENTIFIER_PATTERN.test(value)
  ) {
    return undefined;
  }
  return value;
}

/**
 * Best-effort SDK telemetry. The client only accepts a fixed field allowlist,
 * sanitizes before queueing, and never surfaces transport errors to callers.
 */
export class TelemetryClient {
  readonly enabled: boolean;
  readonly sessionId: string;
  readonly producerId: string;

  private readonly defaultSource: TelemetrySource;
  private readonly context: TelemetryContext;
  private appContextId?: string;
  private appContext?: TelemetryAppContext;
  private readonly queue: BufferedEventQueue<TelemetryEvent>;
  private sequence = 0;
  private destroyed = false;
  private readonly unloadHandler = () => {
    if (!this.queue.flushSync()) {
      void this.queue.flush(true);
    }
  };

  constructor(options: TelemetryClientOptions) {
    this.enabled = options.enabled ?? true;
    this.sessionId = sanitizeIdentifier(
      options.sessionId ?? createTelemetrySessionId(),
      FIELD_LIMITS.sessionId,
    );
    this.producerId = sanitizeIdentifier(
      createTelemetryId(),
      FIELD_LIMITS.producerId,
    );
    this.defaultSource = isTelemetrySource(options.source)
      ? options.source
      : 'sdk';
    this.appContextId = sanitizeAppContextId(options.appContextId);
    this.appContext = sanitizeTelemetryAppContext(options.appContext);
    this.context = sanitizeContext(options.context);
    this.queue = new BufferedEventQueue<TelemetryEvent>({
      transport: createHttpJsonTransport({
        endpoint: telemetryEndpointForWalletUrl(options.walletUrl),
        sendBeacon: (url, data) =>
          typeof navigator !== 'undefined' &&
          typeof navigator.sendBeacon === 'function'
            ? navigator.sendBeacon(url, data)
            : false,
      }),
      serializeBatch,
      flushOnFullBatch: true,
    });

    if (!this.enabled) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      window.addEventListener('pagehide', this.unloadHandler);
      window.addEventListener('beforeunload', this.unloadHandler);
    }
  }

  get pendingEventCount(): number {
    return this.queue.size;
  }

  /** Set or clear the opaque host-app correlation label for later events. */
  setAppContextId(value: string | null): void {
    this.appContextId = value === null ? undefined : sanitizeAppContextId(value);
  }

  getAppContextId(): string | undefined {
    return this.appContextId;
  }

  /** Replace or clear the host-app dimensions stamped on later events.
      Entries the ingestion contract cannot accept are dropped. */
  setContext(context: TelemetryAppContext | null): void {
    this.appContext =
      context === null ? undefined : sanitizeTelemetryAppContext(context);
  }

  getContext(): TelemetryAppContext | undefined {
    return this.appContext ? { ...this.appContext } : undefined;
  }

  record(event: string, fields: TelemetryEventFields = {}): void {
    if (!this.enabled || this.destroyed) {
      return;
    }

    try {
      const merged = { ...this.context, ...fields };
      const telemetryEvent = buildTelemetryEvent(
        event,
        ++this.sequence,
        this.sessionId,
        this.producerId,
        this.defaultSource,
        merged,
      );
      if (this.appContextId) {
        telemetryEvent.appContextId = this.appContextId;
      }
      if (this.appContext) {
        telemetryEvent.appContext = { ...this.appContext };
      }
      this.queue.enqueue(telemetryEvent);
    } catch {
      /* Telemetry must never change application behavior. */
    }
  }

  /** Upload at most one batch. This promise intentionally never rejects. */
  async flush(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.queue.flush();
  }

  /** Stop collection and perform a final best-effort upload. */
  destroy(): void {
    this.shutdown(true);
  }

  /** Stop collection and erase queued events without any transport attempt. */
  discard(): void {
    this.shutdown(false);
  }

  private shutdown(flush: boolean): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    if (
      typeof window !== 'undefined' &&
      typeof window.removeEventListener === 'function'
    ) {
      window.removeEventListener('pagehide', this.unloadHandler);
      window.removeEventListener('beforeunload', this.unloadHandler);
    }

    if (!flush) {
      this.queue.clear();
      return;
    }
    if (!this.queue.flushSync()) {
      void this.queue.flush(true);
    }
    this.queue.stopTimer();
  }
}

function serializeBatch(events: TelemetryEvent[]): string {
  const batch: TelemetryBatch = {
    version: TELEMETRY_BATCH_VERSION,
    events,
  };
  return JSON.stringify(batch);
}

function buildTelemetryEvent(
  event: string,
  sequence: number,
  sessionId: string,
  producerId: string,
  defaultSource: TelemetrySource,
  fields: TelemetryEventFields,
): TelemetryEvent {
  const result: TelemetryEvent = {
    timestamp: new Date().toISOString(),
    sequence,
    source: isTelemetrySource(fields.source) ? fields.source : defaultSource,
    event: sanitizeEventName(event),
    severity: isTelemetrySeverity(fields.severity) ? fields.severity : 'info',
    sessionId,
    producerId,
    eventId: sanitizeIdentifier(createTelemetryId(), FIELD_LIMITS.eventId),
  };

  assignString(result, 'frameId', fields.frameId, FIELD_LIMITS.frameId);
  assignString(result, 'requestId', fields.requestId, FIELD_LIMITS.requestId);
  assignOrigin(result, fields.appOrigin);
  assignVersion(result, 'sdkVersion', fields.sdkVersion, FIELD_LIMITS.sdkVersion);
  assignVersion(result, 'walletVersion', fields.walletVersion, FIELD_LIMITS.walletVersion);
  assignString(result, 'platform', fields.platform, FIELD_LIMITS.platform);
  assignString(result, 'network', fields.network, FIELD_LIMITS.network);
  assignString(result, 'operation', fields.operation, FIELD_LIMITS.operation);
  assignString(result, 'outcome', fields.outcome, FIELD_LIMITS.outcome);
  assignString(result, 'errorCode', fields.errorCode, FIELD_LIMITS.errorCode);
  assignCanonicalAddress(result, 'walletAddress', fields.walletAddress);
  assignCanonicalAddress(result, 'programAddress', fields.programAddress);
  assignCanonicalSignature(result, 'transactionSignature', fields.transactionSignature);
  if (
    typeof fields.durationMs === 'number' &&
    Number.isFinite(fields.durationMs) &&
    fields.durationMs >= 0 &&
    fields.durationMs <= 86_400_000
  ) {
    result.durationMs = Math.floor(fields.durationMs);
  }
  const message = sanitizeTelemetryMessage(fields.message);
  if (message) {
    result.message = message;
  }
  return result;
}

function sanitizeContext(context?: TelemetryContext): TelemetryContext {
  if (!context) {
    return {};
  }
  const result: TelemetryContext = {};
  if (isTelemetrySource(context.source)) result.source = context.source;
  assignString(result, 'frameId', context.frameId, FIELD_LIMITS.frameId);
  assignOrigin(result, context.appOrigin);
  assignVersion(result, 'sdkVersion', context.sdkVersion, FIELD_LIMITS.sdkVersion);
  assignVersion(result, 'walletVersion', context.walletVersion, FIELD_LIMITS.walletVersion);
  assignString(result, 'platform', context.platform, FIELD_LIMITS.platform);
  assignString(result, 'network', context.network, FIELD_LIMITS.network);
  assignString(result, 'operation', context.operation, FIELD_LIMITS.operation);
  assignCanonicalAddress(result, 'walletAddress', context.walletAddress);
  assignCanonicalAddress(result, 'programAddress', context.programAddress);
  return result;
}

function assignString<
  T extends object,
  K extends keyof T,
>(target: T, key: K, value: unknown, maxLength: number): void {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }
  /* Identifier fields are correlation keys. Never mutate a public address or
     signature into a misleading value; omit values the ingestion contract
     cannot safely accept instead. */
  if (value.length > maxLength || !TELEMETRY_IDENTIFIER_PATTERN.test(value)) {
    return;
  }
  target[key] = value as T[K];
}

function assignCanonicalAddress<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  if (typeof value !== 'string' || !isCanonicalThruAddress(value)) {
    return;
  }
  target[key] = value as T[K];
}

function assignVersion<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
  maxLength: number,
): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    !TELEMETRY_VERSION_PATTERN.test(value)
  ) {
    return;
  }
  target[key] = value as T[K];
}

function assignCanonicalSignature<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  if (typeof value !== 'string' || !isCanonicalThruSignature(value)) {
    return;
  }
  target[key] = value as T[K];
}

function isCanonicalThruAddress(value: string): boolean {
  if (value.length > FIELD_LIMITS.walletAddress) return false;
  return isCanonicalEncoding(value, decodeAddress, encodeAddress);
}

function isCanonicalThruSignature(value: string): boolean {
  if (value.length > FIELD_LIMITS.transactionSignature) return false;
  return isCanonicalEncoding(value, decodeSignature, encodeSignature);
}

function assignOrigin<T extends { appOrigin?: string }>(
  target: T,
  value: unknown,
): void {
  if (typeof value !== 'string' || !value) {
    return;
  }
  try {
    const url = new URL(value);
    let safeOrigin: string | undefined;
    if (url.origin !== 'null') {
      safeOrigin = url.origin;
    } else if (url.protocol && url.host) {
      safeOrigin = `${url.protocol}//${url.host}`;
    }
    if (safeOrigin && safeOrigin.length <= FIELD_LIMITS.appOrigin) {
      target.appOrigin = safeOrigin;
    }
  } catch {
    /* Invalid and hostless origins are omitted rather than uploaded. */
  }
}

function sanitizeIdentifier(value: string, maxLength: number): string {
  const normalized = truncate(value.replace(/[^A-Za-z0-9._:-]/g, '_'), maxLength);
  return /^[A-Za-z0-9]/.test(normalized)
    ? normalized
    : truncate(`id${normalized}`, maxLength);
}

function sanitizeEventName(value: string): string {
  const normalized = truncate(
    (typeof value === 'string' ? value.toLowerCase() : 'unknown').replace(
      /[^a-z0-9_.-]/g,
      '_',
    ),
    TELEMETRY_MAX_EVENT_LENGTH,
  );
  if (/^[a-z]/.test(normalized)) return normalized;
  return truncate(`event.${normalized || 'unknown'}`, TELEMETRY_MAX_EVENT_LENGTH);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function isTelemetrySource(value: unknown): value is TelemetrySource {
  return TELEMETRY_SOURCES.has(value as TelemetrySource);
}

function isTelemetrySeverity(value: unknown): value is TelemetrySeverity {
  return TELEMETRY_SEVERITIES.has(value as TelemetrySeverity);
}
