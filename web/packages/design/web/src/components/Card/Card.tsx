import * as React from "react";
import { cn } from "../../utils";
import "./Card.css";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "outlined";
}

/**
 * Card — token-driven surface. API matches the legacy design-system's Card 1:1
 * (variant: default | elevated | outlined). No Base UI primitive needed.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  function Card({ className, variant = "default", children, ...props }, ref) {
    return (
      <div ref={ref} className={cn("tds-card", `tds-card--${variant}`, className)} {...props}>
        {children}
      </div>
    );
  },
);
