export {
  BufferedEventQueue,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_BATCH_BYTES,
  DEFAULT_MAX_BATCH_EVENTS,
  DEFAULT_MAX_QUEUED_EVENTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type BatchTransport,
  type BufferedEventQueueOptions,
  type UploadOutcome,
} from './buffered-queue';
export {
  createHttpJsonTransport,
  isPermanentClientError,
  type BeaconLike,
  type FetchLike,
  type HttpJsonTransportOptions,
} from './http-transport';
export {
  TELEMETRY_CONTEXT_KEY_PATTERN,
  TELEMETRY_MAX_CONTEXT_KEYS,
  TELEMETRY_MAX_CONTEXT_KEY_LENGTH,
  TELEMETRY_MAX_CONTEXT_VALUE_LENGTH,
  decodeTelemetryAppContext,
  encodeTelemetryAppContext,
  sanitizeTelemetryAppContext,
  type TelemetryAppContext,
} from './app-context';
export { TELEMETRY_EVENTS, type TelemetryEventName } from './events';
export {
  TELEMETRY_EVENT_NAME_PATTERN,
  TELEMETRY_FIELD_LIMITS,
  TELEMETRY_IDENTIFIER_PATTERN,
  TELEMETRY_MAX_EVENT_NAME_LENGTH,
  TELEMETRY_TOKEN_ACCOUNT_PATTERN,
  TELEMETRY_VERSION_PATTERN,
} from './fields';
export { createTelemetryId } from './ids';
export {
  TELEMETRY_MAX_MESSAGE_LENGTH,
  isCanonicalEncoding,
  sanitizeTelemetryMessage,
} from './redaction';
export { utf8ByteLength } from './utf8';
