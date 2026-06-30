import * as React from "react";
import { cn } from "../../../utils";
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
  /** Show a verified check badge. */
  verified?: boolean;
  /** Optional chip text, e.g. "mainnet". */
  tag?: string;
}

export interface FrameProps {
  /** Layout width: dialog (narrow) or full. */
  mode?: "dialog" | "full";
  /** Site identity shown in the top bar. */
  site: FrameSite;
  /** Close handler — the X button. */
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Frame — the wallet chrome: a top bar with the site identity (logo, label,
 * optional verified badge + tag) and a close button, wrapping the screen
 * content. Self-contained light surface so it reads over a dark stage.
 */
export const Frame = React.forwardRef<HTMLDivElement, FrameProps>(
  function Frame({ mode = "dialog", site, onClose, children, className }, ref) {
    return (
      <div ref={ref} className={cn("tds-frame", `tds-frame--${mode}`, className)}>
        <div className="tds-frame__bar">
          <span className="tds-frame__site">
            <span className="tds-frame__logo" aria-hidden />
            {site.label}
            {site.verified && (
              <span className="tds-frame__verified">
                <Check width={11} height={11} />
              </span>
            )}
            {site.tag && <span className="tds-frame__chip">{site.tag}</span>}
          </span>
          <button type="button" className="tds-frame__close" aria-label="Close" onClick={onClose}>
            <X width={14} height={14} />
          </button>
        </div>
        <div className="tds-frame__content">{children}</div>
      </div>
    );
  },
);
