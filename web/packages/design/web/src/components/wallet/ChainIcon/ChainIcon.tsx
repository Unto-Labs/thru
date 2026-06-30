import * as React from "react";
import { Disc, type DiscSize } from "../Disc/Disc";
import { chainMeta } from "../registry";

export interface ChainIconProps {
  /** Chain id — looked up in the registry for a curated name/color/glyph. */
  chainId: number;
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
 * ChainIcon — a circular network badge. Looks up `chainId` in the built-in
 * registry (muted Thru-palette colors); pass `color`/`glyph` to override.
 */
export function ChainIcon({
  chainId,
  color,
  glyph,
  src,
  size = "medium",
  border = false,
  className,
}: ChainIconProps) {
  const c = chainMeta(chainId);
  return (
    <Disc
      className={className}
      size={size}
      border={border}
      title={c.name}
      color={color ?? c.color}
      src={src}
      glyph={glyph ?? c.glyph}
      fallback={c.short[0] ?? "?"}
    />
  );
}
