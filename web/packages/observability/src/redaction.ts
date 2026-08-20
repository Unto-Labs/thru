/**
 * Shared privacy redaction for telemetry messages. Clients redact before
 * queueing and the ingestion server re-redacts before emitting, so both
 * sides must share a single definition to avoid silent drift.
 */

export const TELEMETRY_MAX_MESSAGE_LENGTH = 256;

const SENSITIVE_KEY_VALUE_PATTERN =
  /(^|[^A-Za-z0-9_])((?:\\?["'])?)(authorization|proxy[_ -]?authorization|cookie|set[_ -]?cookie|(?:(?:access|refresh|identity|id|auth|client)[_ -]?)?token|(?:client[_ -]?)?secret|password|passwd|api[_ -]?key|private[_ -]?key|session[_ -]?(?:key|token|id)|credential(?:[_ -]?id)?|(?:passkey[_ -]?)?assertion|raw[_ -]?transaction|signed[_ -]?transaction|instruction[_ -]?(?:data|bytes)|account[_ -]?(?:data|contents?)|(?:payment[_ -]?)?amount|balance)\2\s*[:=]\s*(?:\\?"(?:\\\\.|[^"\\])*\\?"|\\?'(?:\\\\.|[^'\\])*\\?'|\{[^}\r\n]*\}|\[[^\]\r\n]*\]|[^\s,;}]+)/gi;

const LONG_ENCODED_VALUE_PATTERN =
  /\b(?:0x)?(?:[A-Fa-f0-9]{64,}|[A-Za-z0-9+/_-]{80,}={0,2})\b/g;
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;
const ENCODED_URL_PATTERN = /[a-z][a-z0-9+.-]*%3a%2f%2f[^\s<>"']+/gi;
const RELATIVE_URL_WITH_DATA_PATTERN =
  /(^|[^A-Za-z0-9])((?:\.{0,2}\/)?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~!$&()*+,;=:@%-]*)*)[?#][^\s<>"']+/g;
const NUMBER_PATTERN =
  /(^|[^A-Za-z0-9])[-+]?\d[\d,._]*(?:e[-+]?\d+)?(?=$|[^A-Za-z0-9])/gi;

function stripAbsoluteUrlData(value: string): string {
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

/** Convert an unknown error into a bounded, redacted telemetry message. */
export function sanitizeTelemetryMessage(value: unknown): string | undefined {
  const source =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : undefined;
  if (!source) return undefined;

  let sanitized = source
    .replace(/\b(Bearer|Basic)\s+[^\s,;"'}]+/gi, '$1 [REDACTED]')
    .replace(ENCODED_URL_PATTERN, (encodedUrl) => {
      try {
        return stripAbsoluteUrlData(decodeURIComponent(encodedUrl));
      } catch {
        return '[REDACTED_URL]';
      }
    })
    .replace(URL_PATTERN, (url) => {
      try {
        return stripAbsoluteUrlData(url);
      } catch {
        return '[REDACTED_URL]';
      }
    })
    .replace(RELATIVE_URL_WITH_DATA_PATTERN, (_match, prefix: string, relativeUrl: string) => {
      try {
        return `${prefix}${new URL(relativeUrl, 'https://telemetry.invalid').pathname}`;
      } catch {
        return `${prefix}[REDACTED_URL]`;
      }
    })
    .replace(
      SENSITIVE_KEY_VALUE_PATTERN,
      (_match, prefix: string, quote: string, key: string) =>
        `${prefix}${quote}${key}${quote}=[REDACTED]`,
    )
    .replace(LONG_ENCODED_VALUE_PATTERN, '[REDACTED]')
    .replace(NUMBER_PATTERN, '$1[REDACTED_NUMBER]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) return undefined;
  if (sanitized.length > TELEMETRY_MAX_MESSAGE_LENGTH) {
    sanitized = `${sanitized.slice(0, TELEMETRY_MAX_MESSAGE_LENGTH - 3)}...`;
  }
  return sanitized;
}

/**
 * True when `value` survives a decode/encode round-trip unchanged, i.e. it is
 * the canonical text encoding and cannot smuggle non-canonical payloads.
 */
export function isCanonicalEncoding<T>(
  value: string,
  decode: (text: string) => T,
  encode: (decoded: T) => string,
): boolean {
  try {
    return encode(decode(value)) === value;
  } catch {
    return false;
  }
}
