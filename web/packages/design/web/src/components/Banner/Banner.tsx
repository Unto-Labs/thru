import * as React from "react";
import { cn } from "../../utils";
import "./Banner.css";

export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Bar height in px (default 24; use ~6 for a thin "hat"). */
  height?: number;
  /** Width of the diagonal "wing" slant on the right end, in px. */
  slant?: number;
}

/**
 * Banner — the Thru "wing" bar: a full-width brick strip whose right end is
 * sheared into the diagonal wing (the RedHeader motif; same slant as the Tabs
 * hat). Decorative; pass children to overlay content.
 */
export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { height = 24, slant = 20, className, style, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("tds-banner", className)}
      style={{
        height,
        clipPath: `polygon(0 0, calc(100% - ${slant}px) 0, 100% 100%, 0 100%)`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});
