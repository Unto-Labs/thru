import * as React from "react";
import { Disc, type DiscSize } from "../Disc/Disc";
import { tokenMeta } from "../registry";

export interface TokenIconProps {
  /** Token symbol — looked up in the registry for a curated name/color/glyph. */
  symbol: string;
  size?: DiscSize;
  border?: boolean | number;
  /** Override the registry color. */
  color?: string;
  /** Override the registry glyph. */
  glyph?: React.ReactNode;
  /** Optional logo image; falls back to the glyph. */
  src?: string;
  className?: string;
}

/**
 * TokenIcon — a circular token badge. Looks up `symbol` in the built-in
 * registry (muted Thru-palette colors); pass `color`/`glyph` to override.
 */
export function TokenIcon({
  symbol,
  color,
  glyph,
  src,
  size = "medium",
  border = false,
  className,
}: TokenIconProps) {
  const t = tokenMeta(symbol);
  return (
    <Disc
      className={className}
      size={size}
      border={border}
      title={t.name}
      color={color ?? t.color}
      src={src}
      glyph={glyph ?? t.glyph}
      fallback={t.short[0] ?? "?"}
    />
  );
}
