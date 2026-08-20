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
export { TELEMETRY_EVENTS, type TelemetryEventName } from './events';
export {
  TELEMETRY_EVENT_NAME_PATTERN,
  TELEMETRY_FIELD_LIMITS,
  TELEMETRY_IDENTIFIER_PATTERN,
  TELEMETRY_MAX_EVENT_NAME_LENGTH,
  TELEMETRY_VERSION_PATTERN,
} from './fields';
export { createTelemetryId } from './ids';
export {
  TELEMETRY_MAX_MESSAGE_LENGTH,
  isCanonicalEncoding,
  sanitizeTelemetryMessage,
} from './redaction';
export { utf8ByteLength } from './utf8';
