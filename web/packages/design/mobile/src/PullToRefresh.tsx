/*
 * React Native Web has no RefreshControl, so on the web the hook watches
 * touches on the scroll node and writes transforms straight to the nodes: an
 * Animated value would re-render the content on every touch move under RNW.
 * The spinner sits beside the ScrollView because iOS WebKit does not draw
 * content above the start of a scroll area.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Platform, RefreshControl, View } from "react-native";
import { IconRefresh } from "./Icons";
import { Spinner } from "./loading/MarkDrawOn";
import { makeStyles, useThemeColors } from "./theme";

export const PULL_TO_REFRESH_THRESHOLD = 72;
const HOLD = 48;
const MAX_PULL = 120;
const RESISTANCE = 0.5;
const SETTLE_MS = 200;
/* Easing.out(Easing.cubic), as CSS. */
const SETTLE_EASE = "cubic-bezier(0.215, 0.61, 0.355, 1)";
/* A refresh the caller never started (it was already loading, say) lets go
   after this long instead of holding the content down. */
const UNSTARTED_RELEASE_MS = 800;

export interface PullToRefreshOptions {
  /** The ScrollView whose top the pull starts from. Typed loosely: an app
      and the kit can resolve different copies of react-native's types. */
  scrollRef: { readonly current: unknown };
  refreshing: boolean;
  onRefresh: () => void;
  /** Off: no control, no listeners, the content never moves. */
  enabled?: boolean;
}

export interface PullToRefreshParts {
  /** For the ScrollView's `refreshControl` (native only). Its props type is
      left open for the same reason as `scrollRef`'s. */
  refreshControl?: ReactElement<never>;
  /** For the view wrapping the scroll content, which moves with the pull
      (web). */
  contentRef: (node: unknown) => void;
  /** The spinner (web): a sibling of the ScrollView, over its top edge, in
      a parent the ScrollView fills. */
  indicator: ReactNode;
}

interface ScrollableRef {
  getScrollableNode?: () => unknown;
}

/* The bits of the DOM this needs; the kit compiles without the DOM lib. */
interface TouchLike {
  touches: ArrayLike<{ clientY: number }>;
  cancelable: boolean;
  preventDefault(): void;
}

interface ScrollNode {
  scrollTop: number;
  addEventListener(type: string, listener: (event: TouchLike) => void, options?: { passive: boolean }): void;
  removeEventListener(type: string, listener: (event: TouchLike) => void): void;
}

interface StyledNode {
  style: { transform: string; transition: string; opacity: string; willChange: string };
}

const styledNode = (node: unknown): StyledNode | null =>
  node && typeof (node as StyledNode).style === "object" ? (node as StyledNode) : null;

/* How far the content moves for a finger `dy` down: half of it to the
   threshold, then less and less towards MAX_PULL, so the pull never stops
   dead under the finger. */
export function pullDistance(dy: number): number {
  const linear = Math.max(0, dy) * RESISTANCE;
  if (linear <= PULL_TO_REFRESH_THRESHOLD) return linear;
  const room = MAX_PULL - PULL_TO_REFRESH_THRESHOLD;
  const over = linear - PULL_TO_REFRESH_THRESHOLD;
  return PULL_TO_REFRESH_THRESHOLD + room * (1 - 1 / (over / room + 1));
}

export function usePullToRefresh({
  scrollRef,
  refreshing,
  onRefresh,
  enabled = true,
}: PullToRefreshOptions): PullToRefreshParts {
  const colors = useThemeColors();
  const styles = useStyles();
  const web = Platform.OS === "web";
  const [holding, setHolding] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const holdingRef = useRef(false);

  const content = useRef<StyledNode | null>(null);
  const glyph = useRef<StyledNode | null>(null);
  const spinner = useRef<StyledNode | null>(null);
  const spinnerRef = useCallback((node: unknown) => {
    spinner.current = styledNode(node);
  }, []);
  const contentRef = useCallback((node: unknown) => {
    content.current = styledNode(node);
  }, []);
  const glyphRef = useCallback((node: unknown) => {
    glyph.current = styledNode(node);
  }, []);

  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paint = useCallback((to: number, animate: boolean) => {
    const transition = animate ? `${SETTLE_MS}ms ${SETTLE_EASE}` : "";
    const body = content.current;
    if (body) {
      body.style.willChange = "transform";
      body.style.transition = transition ? `transform ${transition}` : "none";
      body.style.transform = `translate3d(0, ${to}px, 0)`;
    }
    const holder = spinner.current;
    if (holder) {
      holder.style.transition = transition ? `transform ${transition}` : "none";
      holder.style.transform = `translate3d(0, ${to}px, 0)`;
    }
    const mark = glyph.current;
    if (mark) {
      const shown = Math.min(1, to / PULL_TO_REFRESH_THRESHOLD);
      mark.style.transition = transition ? `transform ${transition}, opacity ${transition}` : "none";
      mark.style.opacity = String(to < 24 ? (to / 24) * 0.4 : 0.4 + (shown - 1 / 3) * 0.9);
      mark.style.transform = `rotate(${shown * 270}deg)`;
    }
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = null;
    /* Back at rest: drop the layer the pull kept the content on. */
    if (to === 0 && body) {
      restTimer.current = setTimeout(
        () => {
          body.style.willChange = "";
          body.style.transform = "";
          body.style.transition = "";
        },
        animate ? SETTLE_MS : 0
      );
    }
  }, []);
  useEffect(
    () => () => {
      if (restTimer.current) clearTimeout(restTimer.current);
    },
    []
  );

  const attach = useCallback(
    (node: ScrollNode) => {
      let startY: number | null = null;
      let distance = 0;
      let frame: number | null = null;
      const draw = () => {
        frame = null;
        paint(distance, false);
      };
      const onStart = (event: TouchLike) => {
        startY =
          node.scrollTop <= 0 && !holdingRef.current && event.touches.length === 1
            ? event.touches[0].clientY
            : null;
        distance = 0;
      };
      const onMove = (event: TouchLike) => {
        if (startY === null) return;
        const dy = event.touches[0].clientY - startY;
        if (dy <= 0 || node.scrollTop > 0) {
          if (distance > 0) {
            distance = 0;
            if (frame === null) frame = requestAnimationFrame(draw);
          }
          if (node.scrollTop > 0) startY = null;
          return;
        }
        if (event.cancelable) event.preventDefault();
        distance = pullDistance(dy);
        if (frame === null) frame = requestAnimationFrame(draw);
      };
      const onEnd = () => {
        if (startY === null) return;
        startY = null;
        if (frame !== null) {
          cancelAnimationFrame(frame);
          frame = null;
        }
        if (distance >= PULL_TO_REFRESH_THRESHOLD) {
          holdingRef.current = true;
          setHolding(true);
          paint(HOLD, true);
          onRefreshRef.current();
        } else if (distance > 0) {
          paint(0, true);
        }
        distance = 0;
      };
      node.addEventListener("touchstart", onStart, { passive: true });
      node.addEventListener("touchmove", onMove, { passive: false });
      node.addEventListener("touchend", onEnd, { passive: true });
      node.addEventListener("touchcancel", onEnd, { passive: true });
      return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        node.removeEventListener("touchstart", onStart);
        node.removeEventListener("touchmove", onMove);
        node.removeEventListener("touchend", onEnd);
        node.removeEventListener("touchcancel", onEnd);
      };
    },
    [paint]
  );

  /* After every render: the ScrollView's node changes under the hook, so the
     listeners follow whichever node is there now. */
  const attached = useRef<{ node: ScrollNode; detach: () => void } | null>(null);
  useEffect(() => {
    const found = web && enabled
      ? ((scrollRef.current as ScrollableRef | null)?.getScrollableNode?.() as ScrollNode | undefined)
      : undefined;
    const node = found && typeof found.addEventListener === "function" ? found : null;
    if (attached.current?.node === node) return;
    attached.current?.detach();
    attached.current = node ? { node, detach: attach(node) } : null;
  });
  useEffect(
    () => () => {
      attached.current?.detach();
      attached.current = null;
    },
    []
  );

  const sawRefreshing = useRef(false);
  useEffect(() => {
    if (!holding) {
      sawRefreshing.current = false;
      return;
    }
    if (refreshing) {
      sawRefreshing.current = true;
      return;
    }
    const release = () => {
      holdingRef.current = false;
      setHolding(false);
      paint(0, true);
    };
    if (sawRefreshing.current) {
      release();
      return;
    }
    const timer = setTimeout(() => {
      if (!refreshingRef.current) release();
    }, UNSTARTED_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [holding, paint, refreshing]);

  if (!enabled) return { contentRef, indicator: null };

  if (!web) {
    return {
      refreshControl: (
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fgMuted} colors={[colors.accent]} />
      ) as ReactElement<never>,
      contentRef,
      indicator: null,
    };
  }

  return {
    contentRef,
    indicator: (
      <View
        ref={spinnerRef}
        accessibilityElementsHidden={!holding}
        accessibilityLabel={holding ? "Refreshing" : undefined}
        importantForAccessibility={holding ? "auto" : "no-hide-descendants"}
        style={styles.indicator}
      >
        {holding ? (
          <Spinner size={18} color={colors.fgMuted} />
        ) : (
          <View ref={glyphRef} style={styles.glyph}>
            <IconRefresh size={18} color={colors.fgMuted} />
          </View>
        )}
      </View>
    ),
  };
}

const useStyles = makeStyles(() => ({
  indicator: {
    position: "absolute",
    top: -HOLD,
    left: 0,
    right: 0,
    height: HOLD,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  glyph: { opacity: 0 },
}));
