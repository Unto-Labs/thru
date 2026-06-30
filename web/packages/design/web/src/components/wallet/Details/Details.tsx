import * as React from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "../../../utils";
import "./Details.css";

const Info = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 7.2v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8" cy="5.2" r="0.85" fill="currentColor" />
  </svg>
);

export interface DetailsProps {
  /** Details.Item rows (or any content). */
  children: React.ReactNode;
  /** Trigger label. */
  label?: React.ReactNode;
  /** When set, render a loading message instead of children. */
  loading?: boolean | React.ReactNode;
  className?: string;
}

export interface DetailsItemProps {
  label: React.ReactNode;
  value: React.ReactNode;
}

function DetailsItem({ label, value }: DetailsItemProps) {
  return (
    <div className="tds-details__item">
      <span className="tds-details__label">{label}</span>
      <span className="tds-details__value">{value}</span>
    </div>
  );
}

/**
 * Details — a collapsible info panel of label/value rows, built on Base UI's
 * Collapsible for the open/close behavior. Use `Details.Item` for rows.
 * Presentational; data comes in via children/props.
 */
function DetailsRoot({ children, label = "Show more details", loading, className }: DetailsProps) {
  return (
    <Collapsible.Root className={cn("tds-details", className)}>
      <Collapsible.Trigger className="tds-details__trigger">
        <Info width={14} height={14} /> {label}
      </Collapsible.Trigger>
      <Collapsible.Panel className="tds-details__panel">
        <div className="tds-details__body">
          {loading ? (
            <div className="tds-details__loading">
              {loading === true ? "Loading details…" : loading}
            </div>
          ) : (
            children
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export const Details = Object.assign(DetailsRoot, { Item: DetailsItem });
