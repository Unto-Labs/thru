import * as React from "react";
import { cn } from "../../utils";
import "./Stepper.css";

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  /** How many steps the flow has. */
  count: number;
  /** Zero-based index of the step being shown. */
  active: number;
  /**
   * Accessible label for the group. The dots are decorative; this and the
   * `aria-valuetext` are what a screen reader announces.
   */
  label?: string;
}

/**
 * Stepper — the dot progress indicator for a short wizard: completed steps
 * dim, the current step widens into a pill, upcoming steps stay quiet.
 *
 * Renders nothing below two steps — a lone dot conveys no progress and just
 * adds a control to explain.
 */
export const Stepper = React.forwardRef<HTMLDivElement, StepperProps>(function Stepper(
  { count, active, label = "Progress", className, ...rest },
  ref,
) {
  if (count < 2) return null;
  const current = Math.min(Math.max(active, 0), count - 1);

  return (
    <div
      ref={ref}
      className={cn("tds-stepper", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={current + 1}
      aria-valuetext={`Step ${current + 1} of ${count}`}
      {...rest}
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="tds-stepper__dot"
          data-state={index === current ? "active" : index < current ? "complete" : "upcoming"}
        />
      ))}
    </div>
  );
});
