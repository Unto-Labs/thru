import * as React from "react";
import { Avatar } from "@base-ui/react/avatar";
import { cn } from "../../../utils";
import "./Disc.css";

export type DiscSize = "small" | "medium" | "large" | number;

const DISC_PX = { small: 16, medium: 24, large: 38 } as const;

const toPx = (s: DiscSize): number => (typeof s === "number" ? s : DISC_PX[s]);

const borderPx = (px: number, border: boolean | number): number =>
  border === true ? (px <= 16 ? 1 : px <= 20 ? 2 : 3) : Number(border) || 0;

export interface DiscProps {
  /** Diameter — a named size or an explicit pixel value. */
  size?: DiscSize;
  /** Ring inset around the inner fill: `true` picks a size-based width, or pass px. */
  border?: boolean | number;
  /** Hover title / accessible label. */
  title?: string;
  /** Inner fill color (any CSS color). Defaults to a neutral surface. */
  color?: string;
  /** Monogram glyph to render when there's no image. */
  glyph?: React.ReactNode;
  /** Image source; renders inside an Avatar with `fallback`. */
  src?: string;
  /** Fallback shown while/if the image fails to load. */
  fallback?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Disc — the circular avatar primitive that underpins ChainIcon and TokenIcon.
 *
 * Presentational and self-contained: it knows nothing about chains or tokens —
 * callers pass `color` / `glyph` / `src` directly. An `src` renders through
 * Base UI's Avatar (with `fallback`), otherwise a centered monogram glyph.
 */
export const Disc = React.forwardRef<HTMLSpanElement, DiscProps>(function Disc(
  { size = "medium", border = false, title, color, glyph, src, fallback, className, style },
  ref,
) {
  const px = toPx(size);
  const b = borderPx(px, border);
  return (
    <span
      ref={ref}
      className={cn("tds-disc", className)}
      title={title}
      style={{ width: px, height: px, ...style }}
    >
      <span
        className="tds-disc__inner"
        style={{ inset: b, background: color ?? "var(--color-surface-lower)" }}
      >
        {src ? (
          <Avatar.Root className="tds-disc__av">
            <Avatar.Image src={src} />
            <Avatar.Fallback className="tds-disc__glyph">{fallback}</Avatar.Fallback>
          </Avatar.Root>
        ) : (
          <span
            className="tds-disc__glyph"
            style={{
              color: color ? "var(--color-text-primary-inverse)" : "var(--color-text-tertiary)",
              fontSize: px * 0.46,
            }}
          >
            {glyph ?? fallback}
          </span>
        )}
      </span>
    </span>
  );
});
