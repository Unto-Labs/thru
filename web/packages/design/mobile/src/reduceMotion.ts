import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/* One app-wide reading of the OS setting. A sheet mounts at the moment it
   opens, so a per-component async read would let that first open slide
   before the answer arrived. On web the media query answers at once;
   natively the first answer lands right after launch, long before anyone
   opens a sheet. */
const QUERY = "(prefers-reduced-motion: reduce)";

/* The kit compiles without the DOM types; this is all it reads of them. */
interface MediaQuery {
  matches: boolean;
  addEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
}
const host = globalThis as { matchMedia?: (query: string) => MediaQuery };
const media = Platform.OS === "web" && typeof host.matchMedia === "function" ? host.matchMedia(QUERY) : null;

let reduceMotion = media?.matches ?? false;
const listeners = new Set<() => void>();

function set(enabled: boolean) {
  if (enabled === reduceMotion) return;
  reduceMotion = enabled;
  for (const listener of listeners) listener();
}

if (media) {
  media.addEventListener?.("change", (event) => set(event.matches));
} else {
  AccessibilityInfo.isReduceMotionEnabled()
    .then(set)
    .catch(() => {
      /* Best effort: if the query fails, motion stays on. */
    });
  AccessibilityInfo.addEventListener("reduceMotionChanged", set);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the OS asks for reduced motion right now. */
export function isReduceMotionEnabled(): boolean {
  return reduceMotion;
}

/**
 * Whether the OS asks for reduced motion, tracked live. react-native-web
 * answers from `prefers-reduced-motion`. Under it, kit motion drops all
 * movement: a sheet or snackbar fades in `REDUCED_MOTION_MS` instead of
 * sliding, and a caret stops blinking.
 */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, isReduceMotionEnabled, isReduceMotionEnabled);
}

/** The kit's fade under reduced motion, in ms. */
export const REDUCED_MOTION_MS = 120;
