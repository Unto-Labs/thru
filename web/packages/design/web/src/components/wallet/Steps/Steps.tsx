import * as React from "react";
import { cn } from "../../../utils";
import "./Steps.css";

const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export type StepStatus = "done" | "active" | "pending";

export interface StepItem {
  label: React.ReactNode;
  status: StepStatus;
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
    <div className={cn("tds-steps", className)} role="list">
      {items.map((item, i) => (
        <div
          key={i}
          role="listitem"
          className={cn("tds-steps__row", `tds-steps__row--${item.status}`)}
          aria-current={item.status === "active" ? "step" : undefined}
        >
          <span className="tds-steps__glyph">
            {item.status === "done" && <Check width={13} height={13} className="tds-steps__check" />}
            {item.status === "active" && <span className="tds-steps__spin" />}
            {item.status === "pending" && <span className="tds-steps__dot" />}
          </span>
          {item.label}
        </div>
      ))}
    </div>
  );
}
