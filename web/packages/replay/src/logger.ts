import type { ReplayLogger } from "./types";

const noop = (): void => undefined;

export const NOOP_LOGGER: ReplayLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export function createConsoleLogger(prefix = "Replay"): ReplayLogger {
  return {
    debug: (message, meta) => console.debug(`[${prefix}] ${message}`, meta ?? ""),
    info: (message, meta) => console.info(`[${prefix}] ${message}`, meta ?? ""),
    warn: (message, meta) => console.warn(`[${prefix}] ${message}`, meta ?? ""),
    error: (message, meta) => console.error(`[${prefix}] ${message}`, meta ?? ""),
  };
}
