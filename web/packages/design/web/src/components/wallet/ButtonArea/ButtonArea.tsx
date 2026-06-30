import * as React from "react";
import { cn } from "../../../utils";
import "./ButtonArea.css";

export interface ButtonAreaProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render the filled-block variant (solid surface, padded). */
  filled?: boolean;
}

/**
 * ButtonArea — a bare tap-target with only interaction styling (press, focus
 * ring, disabled). You supply the content; pass `filled` for a solid block.
 */
export const ButtonArea = React.forwardRef<HTMLButtonElement, ButtonAreaProps>(
  function ButtonArea({ className, filled = false, children, type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn("tds-btn-area", filled && "tds-btn-area--filled", className)}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
