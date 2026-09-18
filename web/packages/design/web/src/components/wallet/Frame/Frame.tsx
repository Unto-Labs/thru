import * as React from "react";
import { cn } from "../../../utils";
import "../island.css";
import "./Frame.css";

const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const X = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export interface FrameSite {
  /** Site label, e.g. "app.thru.org". */
  label: string;
  /** Site identity mark shown before the label (a `Disc`, an `<img>`, …).
   *  Defaults to the brick Thru circle. */
  icon?: React.ReactNode;
  /** Show a verified check badge. */
  verified?: boolean;
  /** Optional chip text, e.g. "mainnet". */
  tag?: string;
}

export type FrameAnimate = "in" | "out" | false;

/* How long the frame takes to ease to a new size (mirrors Frame.css). */
const RESIZE_MS = 280;

/**
 * Ease the frame between sizes when its content changes, for a frame that
 * stays mounted while screens swap inside it. The content is watched with a
 * MutationObserver (a microtask after the DOM changes, before paint), the
 * frame's height is pinned to the old value and then set to the new one so
 * the CSS transition runs; `auto` itself never animates. A ResizeObserver
 * keeps the "old" value fresh between swaps (a collapsible opening, the
 * viewport changing) and mutates nothing, so it never trips the observer
 * loop error.
 */
function useAnimatedResize(
  frameRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  React.useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!enabled || !frame || !content) return;
    if (typeof MutationObserver === "undefined" || typeof ResizeObserver === "undefined") return;
    const reduced =
      typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

    let last = frame.getBoundingClientRect().height;
    let pinned = false;
    let settle = 0;

    const unpin = () => {
      window.clearTimeout(settle);
      settle = 0;
      pinned = false;
      frame.style.height = "";
      frame.style.overflow = "";
      last = frame.getBoundingClientRect().height;
    };

    /* A descendant easing its own height (a collapsible panel) moves the
       frame by itself; pinning on top of that would freeze the frame mid-way
       and jump at the end. */
    const drivenByChild = () =>
      typeof frame.getAnimations === "function" &&
      typeof CSSTransition !== "undefined" &&
      frame.getAnimations({ subtree: true }).some(
        (animation) =>
          animation instanceof CSSTransition &&
          animation.transitionProperty === "height" &&
          animation.playState !== "finished" &&
          (animation.effect as KeyframeEffect | null)?.target !== frame,
      );

    const onContentChange = () => {
      const from = pinned ? frame.getBoundingClientRect().height : last;
      frame.style.transition = "none";
      frame.style.height = "";
      const to = frame.getBoundingClientRect().height;
      if (Math.abs(to - from) < 1 || reduced?.matches || (!pinned && drivenByChild())) {
        frame.style.transition = "";
        if (pinned) unpin();
        last = to;
        return;
      }
      frame.style.height = `${from}px`;
      frame.style.overflow = "hidden";
      void frame.offsetHeight; /* commit the start value before transitioning */
      frame.style.transition = "";
      frame.style.height = `${to}px`;
      pinned = true;
      window.clearTimeout(settle);
      settle = window.setTimeout(unpin, RESIZE_MS + 120);
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== frame || event.propertyName !== "height" || !pinned) return;
      unpin();
    };

    const mutations = new MutationObserver(onContentChange);
    mutations.observe(content, { childList: true, subtree: true, attributes: true, characterData: true });
    const sizes = new ResizeObserver(() => {
      if (!pinned) last = frame.getBoundingClientRect().height;
    });
    sizes.observe(frame);
    frame.addEventListener("transitionend", onTransitionEnd);

    return () => {
      mutations.disconnect();
      sizes.disconnect();
      frame.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(settle);
      frame.style.height = "";
      frame.style.overflow = "";
      frame.style.transition = "";
    };
  }, [frameRef, contentRef, enabled]);
}

export interface FrameProps {
  /** Layout width: dialog (narrow) or full. */
  mode?: "dialog" | "full";
  /** Site identity shown in the top bar. */
  site: FrameSite;
  /** Close handler — the X button. */
  onClose?: () => void;
  /** Play the island open / close motion on the frame itself. Leave unset
   *  when the frame sits inside a `WalletOverlay`, which animates the popup. */
  animate?: FrameAnimate;
  /** Ease the frame to its new size when the content changes — for a frame
   *  that stays mounted while screens swap inside it. */
  animateResize?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Frame — the wallet chrome: a top bar with the site identity (mark, label,
 * optional verified badge + tag) and a close button, wrapping the screen
 * content. Self-contained light surface so it reads over a dark stage.
 */
export const Frame = React.forwardRef<HTMLDivElement, FrameProps>(
  function Frame(
    { mode = "dialog", site, onClose, animate = false, animateResize = false, children, className },
    ref,
  ) {
    const frameRef = React.useRef<HTMLDivElement | null>(null);
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const setFrameRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        frameRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    useAnimatedResize(frameRef, contentRef, animateResize);
    return (
      <div
        ref={setFrameRef}
        className={cn(
          "tds-frame",
          `tds-frame--${mode}`,
          animate === "in" && "tds-frame--in",
          animate === "out" && "tds-frame--out",
          animateResize && "tds-frame--resize",
          className,
        )}
      >
        <div className="tds-frame__bar">
          <span className="tds-frame__site">
            {site.icon ?? <span className="tds-frame__logo" aria-hidden />}
            <span className="tds-frame__label" title={site.label}>
              {site.label}
            </span>
            {site.verified && (
              <span className="tds-frame__verified" title="Verified site">
                <Check width={11} height={11} />
              </span>
            )}
            {site.tag && <span className="tds-frame__chip">{site.tag}</span>}
          </span>
          <button type="button" className="tds-frame__close" aria-label="Close" onClick={onClose}>
            <X width={14} height={14} />
          </button>
        </div>
        <div ref={contentRef} className="tds-frame__content">
          {children}
        </div>
      </div>
    );
  },
);
