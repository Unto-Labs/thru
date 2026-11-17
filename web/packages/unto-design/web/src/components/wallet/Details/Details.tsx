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
  /** Trigger label while the panel is open; defaults to `label`. */
  openLabel?: React.ReactNode;
  /** When set, render a loading message instead of children. */
  loading?: boolean | React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export interface DetailsItemProps {
  label: React.ReactNode;
  value: React.ReactNode;
}

function DetailsItem({ label, value }: DetailsItemProps) {
  return (
    <div className="uds-details__item">
      <span className="uds-details__label">{label}</span>
      <span className="uds-details__value">{value}</span>
    </div>
  );
}

/**
 * Details — a collapsible info panel of label/value rows, built on Base UI's
 * Collapsible for the open/close behavior. Use `Details.Item` for rows.
 */
function DetailsRoot({
  children,
  label = "Show more details",
  openLabel,
  loading,
  defaultOpen = false,
  className,
}: DetailsProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Collapsible.Root className={cn("uds-details", className)} open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="uds-details__trigger">
        <Info width={14} height={14} /> {open ? (openLabel ?? label) : label}
      </Collapsible.Trigger>
      <Collapsible.Panel className="uds-details__panel">
        <div className="uds-details__body">
          {loading ? (
            <div className="uds-details__loading">
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
