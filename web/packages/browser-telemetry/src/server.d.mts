import type { BrowserEvent } from './index';
export const BROWSER_EVENTS: readonly BrowserEvent['event'][];
export const BROWSER_LAUNCH_LABELS: typeof import('./index').BROWSER_LAUNCH_LABELS;
export function readBrowserTelemetryOrigins(env?: Record<string, string | undefined>): string[] | undefined;
export function parseBrowserBatch(value: unknown): BrowserEvent[] | null;
export function createBrowserTelemetryHandler(options: {
  app: string;
  origins?: readonly string[];
  record?: (event: BrowserEvent) => void;
  enabled?: () => boolean;
  log?: (event: BrowserEvent & { app: string; component: string }) => void;
}): (request: Request) => Promise<Response>;
