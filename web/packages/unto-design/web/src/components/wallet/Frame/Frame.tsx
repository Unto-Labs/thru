import * as React from "react";
import { cn } from "../../../utils";
import { Button } from "../../Button/Button";
import "../island.css";
import "./Frame.css";

const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChevronLeft = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M10 4 6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  /** Full origin shown on hover when the label is its host. */
  labelTitle?: string;
  /** Keep the entire requester host visible, including long subdomains. */
  wrapLabel?: boolean;
  /** Site identity mark shown before the label (a `Disc`, an `<img>`, …).
   *  Defaults to the brick Thru circle. */
  icon?: React.ReactNode;
  verified?: boolean;
  /** Optional chip text, e.g. "mainnet". */
  tag?: string;
}

export type FrameAnimate = "in" | "out" | false;

/**
 * CSS never transitions `height: auto`, so the frame is pinned to its old
 * height and then set to the new one. The ResizeObserver only records the
 * height and mutates nothing, so it never trips the observer loop error.
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

    /* WebKit keeps a scroll container's size from the pinned layout once the
       pin is released if its content changed while pinned. Toggling overflow
       makes WebKit size it again. */
    const refreshScrollers = () => {
      for (const el of content.querySelectorAll<HTMLElement>("*")) {
        const overflowY = getComputedStyle(el).overflowY;
        if (overflowY !== "auto" && overflowY !== "scroll") continue;
        const { scrollTop } = el;
        const inline = el.style.overflowY;
        el.style.overflowY = "hidden";
        void el.offsetHeight;
        el.style.overflowY = inline;
        el.scrollTop = scrollTop;
      }
    };

    const unpin = () => {
      window.clearTimeout(settle);
      settle = 0;
      pinned = false;
      frame.style.height = "";
      frame.style.overflow = "";
      refreshScrollers();
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
      settle = window.setTimeout(unpin, parseFloat(getComputedStyle(frame).transitionDuration) * 1000 + 120);
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
  /** Site identity shown in the top bar; omit to leave it out. */
  site?: FrameSite;
  /** Close handler — the X button. */
  onClose?: () => void;
  /** Back handler: a back button on the left of the top bar, in place of
   *  the site identity. */
  onBack?: () => void;
  /** Accessible name for the back button (default "Back"). */
  backLabel?: string;
  /** Play the island open / close motion on the frame itself. Leave unset
   *  when the frame sits inside a `WalletOverlay`, which animates the popup. */
  animate?: FrameAnimate;
  /** Ease the frame to its new size when the content changes — for a frame
   *  that stays mounted while screens swap inside it. */
  animateResize?: boolean;
  /** Active network, e.g. "Alphanet": a status line under the screens. */
  network?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Frame — the wallet chrome: a top bar with the site identity and a close
 * button, wrapping the screen content.
 */
export const Frame = React.forwardRef<HTMLDivElement, FrameProps>(
  function Frame(
    {
      mode = "dialog",
      site,
      onClose,
      onBack,
      backLabel = "Back",
      animate = false,
      animateResize = false,
      network,
      children,
      className,
    },
    ref,
  ) {
    const hasNetwork = network != null;
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
          "uds-frame",
          `uds-frame--${mode}`,
          animate === "in" && "uds-frame--in",
          animate === "out" && "uds-frame--out",
          animateResize && "uds-frame--resize",
          hasNetwork && "uds-frame--network",
          className,
        )}
      >
        <div
          className={cn(
            "uds-frame__bar",
            !site && "uds-frame__bar--plain",
            !site && !onBack && "uds-frame__bar--float",
          )}
        >
          {onBack ? (
            <Button
              variant="ghost"
              size="sm"
              className="uds-frame__back"
              aria-label={backLabel}
              onClick={onBack}
            >
              <ChevronLeft width={16} height={16} />
            </Button>
          ) : site ? (
            <span className="uds-frame__site">
              {site.icon ?? <span className="uds-frame__logo" aria-hidden />}
              <span
                className={cn("uds-frame__label", site.wrapLabel && "uds-frame__label--wrap")}
                title={site.labelTitle ?? site.label}
                dir="ltr"
              >
                {site.label}
              </span>
              {site.verified && (
                <span className="uds-frame__verified" title="Verified site">
                  <Check width={11} height={11} />
                </span>
              )}
              {site.tag && <span className="uds-frame__chip">{site.tag}</span>}
            </span>
          ) : null}
          <button type="button" className="uds-frame__close" aria-label="Close" onClick={onClose}>
            <X width={14} height={14} />
          </button>
        </div>
        <div ref={contentRef} className="uds-frame__content">
          {children}
        </div>
        {hasNetwork && (
          <p className="uds-frame__network">
            <span className="uds-frame__network-dot" aria-hidden />
            <span className="uds-frame__network-hint">Network: </span>
            <span className="uds-frame__network-name">{network}</span>
          </p>
        )}
      </div>
    );
  },
);
