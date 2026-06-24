import type { ReplayLogger } from "@thru/replay";

export type IndexerLogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: IndexerLogLevel[] = ["debug", "info", "warn", "error"];

function shouldLog(level: IndexerLogLevel, minimum: IndexerLogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(minimum);
}

function writeConsole(
  prefix: string,
  level: IndexerLogLevel,
  message: string,
  meta?: Record<string, unknown>
): void {
  const text = `[${prefix}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    if (level === "error") {
      console.error(text, meta);
    } else if (level === "warn") {
      console.warn(text, meta);
    } else {
      console.log(text, meta);
    }
    return;
  }

  if (level === "error") {
    console.error(text);
  } else if (level === "warn") {
    console.warn(text);
  } else {
    console.log(text);
  }
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

    const hasMeta = meta !== undefined && Object.keys(meta).length > 0;
    const fields = { ...bindings, ...(meta ?? {}) };
    if (options.logger) {
      options.logger[level](message, fields);
    } else {
      writeConsole(options.prefix, level, message, hasMeta ? fields : undefined);
    }
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}
