/** Bounded host-app-provided telemetry dimensions. The map is opaque to the
    SDK and the server: keys and values are validated, never interpreted, and
    are exported under their own attribute namespace so they can never shadow
    a first-class telemetry field. */

export type TelemetryAppContext = Record<string, string>;

export const TELEMETRY_CONTEXT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const TELEMETRY_MAX_CONTEXT_KEYS = 5;
export const TELEMETRY_MAX_CONTEXT_KEY_LENGTH = 32;
export const TELEMETRY_MAX_CONTEXT_VALUE_LENGTH = 64;

/* Values are correlation labels, not free text: the identifier charset keeps
   e-mail addresses, URLs, and prose out of telemetry by construction. */
const CONTEXT_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const CONTEXT_PARAM_PAIR_SEPARATOR = ',';
const CONTEXT_PARAM_KEY_SEPARATOR = '=';

function isValidKey(key: string): boolean {
  return key.length <= TELEMETRY_MAX_CONTEXT_KEY_LENGTH && TELEMETRY_CONTEXT_KEY_PATTERN.test(key);
}

function isValidValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= TELEMETRY_MAX_CONTEXT_VALUE_LENGTH &&
    CONTEXT_VALUE_PATTERN.test(value)
  );
}

/** Drop every entry the ingestion contract cannot accept, then keep at most
    the first keys in lexicographic order so the result is deterministic. */
export function sanitizeTelemetryAppContext(value: unknown): TelemetryAppContext | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const accepted = Object.entries(value as Record<string, unknown>)
    .filter(([key, entry]) => isValidKey(key) && isValidValue(entry))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, TELEMETRY_MAX_CONTEXT_KEYS);
  if (accepted.length === 0) {
    return undefined;
  }
  const result: TelemetryAppContext = {};
  for (const [key, entry] of accepted) {
    result[key] = entry as string;
  }
  return result;
}

/** Encode a sanitized context as `key=value,key=value`. The key and value
    charsets exclude both separators, so the encoding is unambiguous. */
export function encodeTelemetryAppContext(context: unknown): string | undefined {
  const sanitized = sanitizeTelemetryAppContext(context);
  if (!sanitized) {
    return undefined;
  }
  return Object.entries(sanitized)
    .map(([key, value]) => `${key}${CONTEXT_PARAM_KEY_SEPARATOR}${value}`)
    .join(CONTEXT_PARAM_PAIR_SEPARATOR);
}

export function decodeTelemetryAppContext(value: unknown): TelemetryAppContext | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const decoded: Record<string, unknown> = {};
  for (const pair of value.split(CONTEXT_PARAM_PAIR_SEPARATOR)) {
    const separator = pair.indexOf(CONTEXT_PARAM_KEY_SEPARATOR);
    if (separator <= 0) continue;
    decoded[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return sanitizeTelemetryAppContext(decoded);
}
