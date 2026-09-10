import * as React from "react";
import { cn } from "../../../utils";
import "./Checklist.css";

const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface ChecklistProps {
  /** One row per entry — what the site is asking for. */
  items: React.ReactNode[];
  className?: string;
}

/**
 * Checklist — a bordered list of granted capabilities, each led by a grass
 * check (the permissions screen's "this site is asking to…" list).
 */
export function Checklist({ items, className }: ChecklistProps) {
  return (
    <ul className={cn("tds-checklist", className)}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <li className="tds-checklist__sep" role="separator" aria-hidden />}
          <li className="tds-checklist__item">
            <span className="tds-checklist__check">
              <Check width={14} height={14} />
            </span>
            {item}
          </li>
        </React.Fragment>
      ))}
    </ul>
  );
}
