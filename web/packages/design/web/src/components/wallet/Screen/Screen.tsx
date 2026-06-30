import * as React from "react";
import { cn } from "../../../utils";
import "./Screen.css";

const Info = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 7.2v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8" cy="5.2" r="0.85" fill="currentColor" />
  </svg>
);
const ChevronRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface ScreenHeaderProps {
  /** Centered badge glyph; defaults to an info icon. */
  icon?: React.ReactNode;
  /** Title text. */
  title: string;
  /** Optional subtitle / supporting content. */
  content?: React.ReactNode;
  className?: string;
}

/**
 * ScreenHeader — a centered badge, title, and optional subtitle for the top of
 * a wallet Screen. Presentational; also available as `Screen.Header`.
 */
export function ScreenHeader({ icon, title, content, className }: ScreenHeaderProps) {
  return (
    <div className={cn("tds-screen__header", className)}>
      <span className="tds-screen__badge">{icon ?? <Info width={16} height={16} />}</span>
      <div className="tds-screen__title">{title}</div>
      {content && <div className="tds-screen__sub">{content}</div>}
    </div>
  );
}

export interface ScreenBottomAction {
  label: React.ReactNode;
  onClick?: () => void;
}

export interface ScreenProps {
  children: React.ReactNode;
  /** Optional bottom action row (label + chevron). */
  bottomAction?: ScreenBottomAction;
  className?: string;
}

/**
 * Screen — the body of a wallet flow: scrollable content plus an optional
 * bottom action row. Pair with `Screen.Header`. Presentational; data via props.
 */
function ScreenRoot({ children, bottomAction, className }: ScreenProps) {
  return (
    <div className={cn("tds-screen", className)}>
      <div className="tds-screen__body">{children}</div>
      {bottomAction && (
        <button type="button" className="tds-screen__bottom" onClick={bottomAction.onClick}>
          <span>{bottomAction.label}</span>
          <ChevronRight width={18} height={18} />
        </button>
      )}
    </div>
  );
}

export const Screen = Object.assign(ScreenRoot, { Header: ScreenHeader });
