import * as React from "react";
import { cn } from "../../../utils";
import { styledDiv } from "../../../lib/styled";
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

export type ScreenHeaderTone = "neutral" | "success" | "danger" | "plain";

export interface ScreenHeaderProps {
  /** Centered badge glyph; defaults to an info icon. */
  icon?: React.ReactNode;
  /**
   * Badge treatment. `neutral` is the quiet surface pill, `success` the
   * grass pill, `danger` the brick-tint pill. `plain` drops the pill so a
   * self-contained mark (the Thru disc, the dove) sits directly in the hero.
   */
  tone?: ScreenHeaderTone;
  /** Title text. */
  title: React.ReactNode;
  /** Optional subtitle / supporting content. */
  content?: React.ReactNode;
  className?: string;
}

/**
 * ScreenHeader — a centered badge, title, and optional subtitle for the top of
 * a wallet Screen. Presentational; also available as `Screen.Header`.
 */
export function ScreenHeader({ icon, tone = "neutral", title, content, className }: ScreenHeaderProps) {
  return (
    <div className={cn("tds-screen__header", className)}>
      <span className={cn("tds-screen__badge", `tds-screen__badge--${tone}`)}>
        {icon ?? <Info width={16} height={16} />}
      </span>
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
  /** Optional footer rendered under the body — typically `Screen.Actions`. */
  footer?: React.ReactNode;
  /** Cap the body height and let it scroll (long review screens). */
  scroll?: boolean;
  className?: string;
}

/**
 * Screen — the body of a wallet flow: scrollable content plus an optional
 * footer / bottom action row. Pair with `Screen.Header`, `Screen.Box` (a quiet
 * info panel) and `Screen.Actions` (a two-button footer). Presentational.
 */
function ScreenRoot({ children, bottomAction, footer, scroll = false, className }: ScreenProps) {
  return (
    <div className={cn("tds-screen", className)}>
      <div className={cn("tds-screen__body", scroll && "tds-screen__body--scroll")}>{children}</div>
      {footer}
      {bottomAction && (
        <button type="button" className="tds-screen__bottom" onClick={bottomAction.onClick}>
          <span>{bottomAction.label}</span>
          <ChevronRight width={18} height={18} />
        </button>
      )}
    </div>
  );
}

/** A quiet surface panel for grouped rows (steps, error text, a summary). */
const ScreenBox = styledDiv("tds-screen__box");
/** The two-button footer row: children stretch to equal widths. */
const ScreenActions = styledDiv("tds-screen__actions");

export const Screen = Object.assign(ScreenRoot, {
  Header: ScreenHeader,
  Box: ScreenBox,
  Actions: ScreenActions,
});
