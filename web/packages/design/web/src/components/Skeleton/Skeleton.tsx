import * as React from "react";
import { cn } from "../../utils";
import "./Skeleton.css";

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  width?: number | string;
  height?: number | string;
  /** Round the block (defaults to square, per square-first). */
  rounded?: boolean;
}

/**
 * Skeleton — a shimmering placeholder block for loading states. Sizing via
 * `width`/`height` (number = px) or className.
 */
export const Skeleton = React.forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  { width, height, rounded = false, className, style, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn("tds-skeleton", rounded && "tds-skeleton--rounded", className)}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
});
