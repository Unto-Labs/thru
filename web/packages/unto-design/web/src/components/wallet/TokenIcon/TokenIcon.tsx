import { UntoUsdLogo } from "../../../UntoUsdLogo";
import { isUntoUsdSymbol, UNTOUSD_RED } from "../../../../../tokens/src/untousd";
import * as React from "react";
import { Disc, toPx, type DiscSize } from "../Disc/Disc";
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

export function TokenIcon({
  symbol,
  color,
  glyph,
  src,
  size = "md",
  border = false,
  className,
}: TokenIconProps) {
  const t = tokenMeta(symbol);
  const branded =
    isUntoUsdSymbol(symbol) && !src && glyph == null && color == null;
  const px = toPx(size);
  const inset =
    border === true ? (px <= 16 ? 1 : px <= 20 ? 2 : 3) : Number(border) || 0;
  return (
    <Disc
      className={className}
      size={size}
      border={border}
      title={branded ? "UntoUSD" : t.name}
      color={color ?? (branded ? UNTOUSD_RED : t.color)}
      src={src}
      glyph={
        glyph ??
        (branded ? <UntoUsdLogo size={Math.max(0, px - inset * 2)} /> : t.glyph)
      }
      fallback={t.short[0] ?? "?"}
    />
  );
}
