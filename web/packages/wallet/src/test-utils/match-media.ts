import { vi } from 'vitest';

type ChangeListener = (event: { matches: boolean }) => void;

/** Stub globalThis.matchMedia with a controllable prefers-color-scheme query. */
export function stubColorSchemeMedia(initiallyDark: boolean) {
  const listeners = new Set<ChangeListener>();
  const query = {
    matches: initiallyDark,
    addEventListener: vi.fn((_type: string, listener: ChangeListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: ChangeListener) => {
      listeners.delete(listener);
    }),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return {
    query,
    listeners,
    setDark(dark: boolean) {
      query.matches = dark;
      listeners.forEach((listener) => listener({ matches: dark }));
    },
  };
}
