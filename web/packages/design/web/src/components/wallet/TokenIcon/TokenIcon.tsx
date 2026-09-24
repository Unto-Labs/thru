import { ThruUsdLogo } from "../../../ThruUsdLogo";
import { isThruUsdSymbol, THRUSD_RED } from "../../../../../tokens/src/thrusd";
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
  const branded =
    isThruUsdSymbol(symbol) && !src && glyph == null && color == null;
  const px =
    typeof size === "number"
      ? size
      : { small: 16, medium: 24, large: 38 }[size];
  const inset =
    border === true ? (px <= 16 ? 1 : px <= 20 ? 2 : 3) : Number(border) || 0;
  return (
    <Disc
      className={className}
      size={size}
      border={border}
      title={branded ? "ThruUSD" : t.name}
      color={color ?? (branded ? THRUSD_RED : t.color)}
      src={src}
      glyph={
        glyph ??
        (branded ? <ThruUsdLogo size={Math.max(0, px - inset * 2)} /> : t.glyph)
      }
      fallback={t.short[0] ?? "?"}
    />
  );
}
