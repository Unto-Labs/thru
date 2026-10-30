import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Animated, Keyboard, PanResponder, Platform, TextInput, type GestureResponderEvent, type PanResponderGestureState, type View } from "react-native";
import { shouldClaimSheetGesture } from "./sheetGesture";

type Surface = "header" | "body";
type GestureState<Snapshot> =
  | { kind: "idle" | "settling" | "closing" }
  | { kind: "tracking" }
  | { kind: "dragging"; snapshot: Snapshot };

type ClickEvent = { stopPropagation(): void; preventDefault(): void };
interface WebPanel {
  closest(selector: string): unknown;
  contains(element: WebPanel): boolean;
  addEventListener(type: "click", listener: (event: ClickEvent) => void, capture: boolean): void;
  removeEventListener(type: "click", listener: (event: ClickEvent) => void, capture: boolean): void;
}
interface EventHost {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}
const browser = globalThis as EventHost & {
  visualViewport?: EventHost & { height: number };
  document?: EventHost & {
    documentElement: { clientHeight: number };
    activeElement: WebPanel | null;
    hidden: boolean;
  };
};
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

interface SheetGestureOptions<Snapshot, Target> {
  position: Animated.Value;
  panelRef: RefObject<View | null>;
  active: boolean;
  enabled?: boolean;
  canStart?: (event: GestureResponderEvent, surface: Surface) => boolean;
  canClaim: (surface: Surface, gesture: PanResponderGestureState) => boolean;
  snapshot: (start: number) => Snapshot;
  dragPosition: (snapshot: Snapshot, dy: number) => number;
  releaseTarget: (snapshot: Snapshot, gesture: PanResponderGestureState) => Target | "dismiss";
  settle: (target: Target) => void;
  cancel: () => void;
  onDismiss: () => void;
}

export function useSheetGesture<Snapshot, Target>(options: SheetGestureOptions<Snapshot, Target>) {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<GestureState<Snapshot>>({ kind: "idle" });

  const responders = useMemo(() => {
    const allowed = () => {
      const current = latest.current;
      if (!current.active || current.enabled === false) return false;
      if (Platform.OS !== "web") return !Keyboard.isVisible() && TextInput.State.currentlyFocusedInput() == null;
      const panel = current.panelRef.current as unknown as WebPanel | null;
      const document = browser.document;
      if (!panel || panel.closest("[inert], [aria-hidden='true']") || document?.hidden) return false;
      const focused = document?.activeElement;
      if (focused && panel.contains(focused) && focused.closest(EDITABLE_SELECTOR)) return false;
      /* A keyboard is taller than 120px; a browser toolbar is not. */
      return !browser.visualViewport || !document
        || document.documentElement.clientHeight - Math.round(browser.visualViewport.height) < 120;
    };
    const cancel = () => {
      if (state.current.kind !== "tracking" && state.current.kind !== "dragging") return;
      state.current = { kind: "settling" };
      latest.current.cancel();
    };
    const responder = (surface: Surface) => {
      let startAllowed = false;
      return PanResponder.create({
        onStartShouldSetPanResponderCapture: (event, gesture) => {
          startAllowed = state.current.kind !== "closing"
            && allowed()
            && gesture.numberActiveTouches === 1
            && (latest.current.canStart?.(event, surface) ?? true);
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          state.current.kind !== "closing"
          && startAllowed
          && allowed()
          && shouldClaimSheetGesture({ ...gesture, allowUpward: true })
          && latest.current.canClaim(surface, gesture),
        onPanResponderGrant: () => {
          if (!startAllowed || !allowed()) return;
          startAllowed = false;
          const tracking: GestureState<Snapshot> = { kind: "tracking" };
          state.current = tracking;
          latest.current.position.stopAnimation((start) => {
            /* A native stop callback can arrive after termination or owner exit. */
            if (state.current !== tracking || !allowed()) return;
            state.current = { kind: "dragging", snapshot: latest.current.snapshot(start) };
          });
        },
        onPanResponderStart: (_event, gesture) => {
          if (gesture.numberActiveTouches > 1) cancel();
        },
        onPanResponderMove: (_event, gesture) => {
          if (!allowed() || gesture.numberActiveTouches !== 1) {
            cancel();
            return;
          }
          if (state.current.kind !== "dragging") return;
          latest.current.position.setValue(latest.current.dragPosition(state.current.snapshot, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!allowed() || state.current.kind === "tracking") {
            cancel();
            return;
          }
          if (state.current.kind !== "dragging") return;
          const target = latest.current.releaseTarget(state.current.snapshot, gesture);
          state.current = { kind: target === "dismiss" ? "closing" : "settling" };
          if (target === "dismiss") latest.current.onDismiss();
          else latest.current.settle(target);
        },
        onPanResponderTerminate: cancel,
        onPanResponderTerminationRequest: () => false,
      });
    };
    return { header: responder("header"), body: responder("body"), cancel };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const panel = options.panelRef.current as unknown as WebPanel | null;
    if (!panel) return;
    /* RNW's View drops PanResponder's onClickCapture prop. */
    const suppressClick = (event: ClickEvent) => {
      for (const responder of [responders.header, responders.body]) {
        const capture = Reflect.get(responder.panHandlers, "onClickCapture");
        if (typeof capture === "function") capture(event);
      }
    };
    panel.addEventListener("click", suppressClick, true);
    return () => panel.removeEventListener("click", suppressClick, true);
  });

  useEffect(() => {
    if (Platform.OS !== "web" || !options.active) return;
    const viewport = browser.visualViewport;
    browser.addEventListener?.("blur", responders.cancel);
    browser.addEventListener?.("resize", responders.cancel);
    browser.document?.addEventListener?.("visibilitychange", responders.cancel);
    viewport?.addEventListener?.("resize", responders.cancel);
    return () => {
      browser.removeEventListener?.("blur", responders.cancel);
      browser.removeEventListener?.("resize", responders.cancel);
      browser.document?.removeEventListener?.("visibilitychange", responders.cancel);
      viewport?.removeEventListener?.("resize", responders.cancel);
    };
  }, [options.active, responders]);

  useEffect(() => {
    if (!options.active) state.current = { kind: "idle" };
    else if (options.enabled === false) responders.cancel();
  }, [options.active, options.enabled, responders]);

  useEffect(() => () => { state.current = { kind: "idle" }; }, []);

  return responders;
}
