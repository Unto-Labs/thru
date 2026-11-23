import * as React from "react";
import { cn } from "../../../utils";
import "./Brand.css";

export interface UntoWordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Font size in px; the square mark scales with it. */
  size?: number;
}

/**
 * UntoWordmark — the Unto Labs lockup from untolabs.com: a solid square and
 * "UNTO LABS" in spaced capitals, both in `currentColor` so it takes the
 * color of its context (a footer caption, a nav bar).
 */
export function UntoWordmark({ size = 11, className, style, ...props }: UntoWordmarkProps) {
  return (
    <span className={cn("uds-unto-wordmark", className)} style={{ fontSize: size, ...style }} {...props}>
      <span className="uds-unto-wordmark__mark" aria-hidden />
      Unto Labs
    </span>
  );
}

export interface PoweredByProps {
  /** Caption before the wordmark (default "Powered by"). */
  label?: React.ReactNode;
  /** Where the wordmark links (default https://untolabs.com); `null` for no link. */
  href?: string | null;
  className?: string;
}

/**
 * PoweredBy — the hairline footer strip that credits Unto Labs under a wallet
 * screen the site did not author (sign in, loading, error, signing). The
 * wordmark opens untolabs.com in a new tab.
 */
export function PoweredBy({ label = "Powered by", href = "https://untolabs.com", className }: PoweredByProps) {
  const mark = <UntoWordmark size={10} className="uds-powered__mark" />;
  return (
    <div className={cn("uds-powered", className)}>
      {label}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="uds-powered__link" aria-label="untolabs.com">
          {mark}
        </a>
      ) : (
        mark
      )}
    </div>
  );
}
