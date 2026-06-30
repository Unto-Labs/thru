import * as React from "react";
import "./Spinner.css";

export type SpinnerTone = "neutral" | "brick";

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: SpinnerTone;
}

/**
 * Spinner — a subdued loading indicator (CSS only). A Thru house component,
 * not a Base UI primitive: a single rotating ring driven by CSS keyframes.
 *
 * Size, thickness, and speed are tunable via inline style
 * (`width`/`height`, `borderWidth`, `animationDuration`).
 */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
  function Spinner({ tone = "neutral", className, ...props }, ref) {
    const cls = ["tds-spinner", `tds-spinner--${tone}`, className]
      .filter(Boolean)
      .join(" ");
    return <span ref={ref} className={cls} role="status" aria-label="Loading" {...props} />;
  },
);
