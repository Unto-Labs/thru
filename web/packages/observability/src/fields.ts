/** Shared validation vocabulary for wallet telemetry fields, enforced
    independently on both the client and the server boundary. */

export const TELEMETRY_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const TELEMETRY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+:-]*$/;
export const TELEMETRY_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.-]*$/;

export const TELEMETRY_MAX_EVENT_NAME_LENGTH = 64;

export const TELEMETRY_FIELD_LIMITS = {
  sessionId: 128,
  producerId: 128,
  eventId: 128,
  frameId: 128,
  requestId: 128,
  appContextId: 128,
  appOrigin: 256,
  sdkVersion: 64,
  walletVersion: 64,
  platform: 32,
  network: 64,
  operation: 96,
  outcome: 64,
  errorCode: 96,
  walletAddress: 192,
  programAddress: 192,
  transactionSignature: 256,
} as const;
