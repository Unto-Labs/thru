import * as React from "react";
import { cn } from "../../utils";
import "./Banner.css";

export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Bar height in px (default 24; use ~6 for a thin "hat"). */
  height?: number;
  /** Horizontal run of the slant at each end, in px. */
  slant?: number;
}

/**
 * Banner — the wing bar: a full-width accent parallelogram, both ends cut at
 * the same angle. The system's one angled shape, so keep it decorative; pass
 * children to overlay content.
 */
export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { height = 24, slant = 20, className, style, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("uds-banner", className)}
      style={{
        height,
        clipPath: `polygon(${slant}px 0, 100% 0, calc(100% - ${slant}px) 100%, 0 100%)`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});
