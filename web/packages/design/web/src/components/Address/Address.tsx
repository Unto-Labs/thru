import * as React from "react";
import { cn } from "../../utils";
import { CopyButton } from "../wallet/CopyButton/CopyButton";
import "./Address.css";

export interface AddressProps {
  /** The full value (address / hash / signature). Copied verbatim. */
  value: string;
  /** Override the displayed text (e.g. a resolved name) instead of truncating. */
  display?: string;
  /** Leading chars to keep when middle-truncating. */
  leading?: number;
  /** Trailing chars to keep when middle-truncating. */
  trailing?: number;
  /** Render the value in mono (default true). */
  mono?: boolean;
  /** Show the inline copy icon (default true). */
  copy?: boolean;
  /** Expose the full value via the native title on hover (default true). Set
   *  false when the consumer supplies its own tooltip/popover. */
  showTitle?: boolean;
  /** Plain link target. For framework routing, pass `render` instead. */
  href?: string;
  /** A link element to wrap the value (e.g. a Next `<Link/>`), cloned with the
   *  value as its children — keeps framework coupling in the consumer. */
  render?: React.ReactElement;
  className?: string;
  /** Class applied to the value text (e.g. a hover-highlight from the consumer). */
  textClassName?: string;
  placeholder?: React.ReactNode;
}

function truncate(v: string, leading: number, trailing: number): string {
  if (v.length <= leading + trailing + 1) return v;
  return `${v.slice(0, leading)}…${v.slice(-trailing)}`;
}

/**
 * Address — a middle-truncated, mono identifier (address / hash / signature)
 * with an inline copy icon and an optional link. Presentational and
 * framework-agnostic: pass `render` to use a routing `<Link/>`, or `href` for a
 * plain anchor. The full value is exposed via the native title on hover.
 */
export function Address({
  value,
  display,
  leading = 8,
  trailing = 8,
  mono = true,
  copy = true,
  showTitle = true,
  href,
  render,
  className,
  textClassName,
  placeholder = "—",
}: AddressProps) {
  if (!value) {
    return <span className={cn("tds-address", className)}>{placeholder}</span>;
  }

  const truncated = display === undefined;
  const text = display ?? truncate(value, leading, trailing);
  const valueEl = (
    <span className={cn(mono && "tds-address__value--mono", textClassName)}>{text}</span>
  );

  let linked: React.ReactNode = valueEl;
  if (render) {
    const el = render as React.ReactElement<{ className?: string }>;
    linked = React.cloneElement(
      el,
      { className: cn("tds-address__link", el.props?.className) },
      valueEl,
    );
  } else if (href) {
    linked = (
      <a href={href} className="tds-address__link">
        {valueEl}
      </a>
    );
  }

  return (
    <span
      className={cn("tds-address", className)}
      title={showTitle && truncated ? value : undefined}
    >
      {linked}
      {copy && <CopyButton value={value} icon />}
    </span>
  );
}
