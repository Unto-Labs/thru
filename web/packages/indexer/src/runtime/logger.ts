/* eslint-disable no-console -- console is this sink's output. */
import type { ReplayLogger } from "@thru/replay";

export type IndexerLogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: IndexerLogLevel[] = ["debug", "info", "warn", "error"];
/* Cloud Logging reads `severity` and `message` from a JSON line. */
const SEVERITY: Record<IndexerLogLevel, string> = { debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR" };

function shouldLog(level: IndexerLogLevel, minimum: IndexerLogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(minimum);
}

/* JSON.stringify drops an Error's fields (`{}`) and throws on a bigint. */
function serializable(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    const e = value as Error & { code?: unknown; cause?: unknown };
    return {
      name: e.name,
      message: e.message,
      ...(e.code !== undefined ? { code: e.code } : {}),
      ...(e.stack !== undefined ? { stack: e.stack } : {}),
      ...(e.cause !== undefined && e.cause !== value ? { cause: e.cause } : {}),
    };
  }
  return value;
}

/** One log record as one line of JSON: a log shipper (Cloud Logging on the
    worker VM, Cloud Run) makes every line of stdout and stderr its own entry,
    so a record must never span lines. `severity`, `logger` and `message`
    come first and win over fields of the same name; bigints are decimal
    strings, errors carry name, message, code, stack and cause (newlines in a
    stack stay escaped inside the string). */
export function formatLogLine(
  head: { severity: string; message: string; logger?: string },
  fields: Record<string, unknown> = {},
): string {
  const record = Object.assign({}, head, fields, head);
  try {
    return JSON.stringify(record, serializable);
  } catch (error) {
    /* A circular or otherwise unserializable field: keep the line, drop the fields. */
    return JSON.stringify({ ...head, fieldsError: error instanceof Error ? error.message : String(error) });
  }
}

/** Writes `head` and `fields` as one JSON line, to stderr for warnings and
    errors and to stdout otherwise. */
export function writeLogLine(
  level: IndexerLogLevel,
  message: string,
  fields: Record<string, unknown> = {},
  logger?: string,
): void {
  const line = formatLogLine({ severity: SEVERITY[level], ...(logger ? { logger } : {}), message }, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** The line a process writes when it stops on an error (a worker's fatal
    error, an API that cannot start): one JSON line with the error's stack. */
export function logFatal(service: string, event: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  writeLogLine("error", message, { event, service, error });
}

export function createScopedLogger(options: {
  logger?: ReplayLogger;
  level?: IndexerLogLevel;
  prefix: string;
  bindings?: Record<string, unknown>;
}): ReplayLogger {
  const minimum = options.level ?? "info";
  const bindings = options.bindings ?? {};

  const log = (
    level: IndexerLogLevel,
    message: string,
    meta?: Record<string, unknown>
  ) => {
    if (!shouldLog(level, minimum)) {
      return;
    }

    const fields = { ...bindings, ...(meta ?? {}) };
    if (options.logger) {
      options.logger[level](message, fields);
    } else {
      writeLogLine(level, message, fields, options.prefix);
    }
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}
