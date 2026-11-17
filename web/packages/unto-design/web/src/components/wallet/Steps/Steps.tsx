import * as React from "react";
import { cn } from "../../../utils";
import "./Steps.css";

const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export type StepStatus = "done" | "active" | "pending";

export interface StepItem {
  label: React.ReactNode;
  status: StepStatus;
  /** A trailing note on the row, e.g. "Creating". */
  detail?: React.ReactNode;
}

/** The 16px status mark of a step row, for other lists that show the same states. Only those lists have a failed row. */
export function StepGlyph({ status }: { status: StepStatus | "failed" }) {
  return (
    <span className="uds-steps__glyph">
      {status === "done" && <Check width={13} height={13} className="uds-steps__check" />}
      {status === "failed" && <Cross width={13} height={13} className="uds-steps__cross" />}
      {status === "active" && <span className="uds-steps__spin" />}
      {status === "pending" && <span className="uds-steps__dot" />}
    </span>
  );
}

export interface StepsProps {
  items: StepItem[];
  className?: string;
}

/**
 * Steps — a compact progress ladder for a wallet ceremony: each row is a
 * check (done), a small spinning ring (active), or a hollow dot (pending).
 * Presentational; the caller advances the statuses.
 */
export function Steps({ items, className }: StepsProps) {
  return (
    <div className={cn("uds-steps", className)} role="list">
      {items.map((item, i) => (
        <div
          key={i}
          role="listitem"
          className={cn("uds-steps__row", `uds-steps__row--${item.status}`)}
          aria-current={item.status === "active" ? "step" : undefined}
        >
          <StepGlyph status={item.status} />
          {item.label}
          {item.detail != null && <span className="uds-steps__detail">{item.detail}</span>}
        </div>
      ))}
    </div>
  );
}
