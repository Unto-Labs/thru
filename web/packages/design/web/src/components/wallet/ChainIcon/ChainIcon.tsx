import * as React from "react";
import { Disc, type DiscSize } from "../Disc/Disc";
import { chainMeta } from "../registry";

export interface ChainIconProps {
  /** Chain id — looked up in the registry for a curated name/color/glyph/logo. */
  chainId: number;
  size?: DiscSize;
  border?: boolean | number;
  /** Override the registry color. */
  color?: string;
  /** Override the registry glyph. */
  glyph?: React.ReactNode;
  /** Optional logo image; overrides the registry logo, falls back to the glyph. */
  src?: string;
  /** Draw the glyph disc even when the registry has a brand logo. */
  logo?: boolean;
  className?: string;
}

/**
 * ChainIcon — a circular network badge. Looks up `chainId` in the built-in
 * registry: chains with a brand logo (Ethereum, Base, Solana, Arbitrum,
 * Bitcoin) draw it, the rest draw the muted Thru-palette glyph disc. Pass
 * `color`/`glyph`/`src` to override, or `logo={false}` to force the disc.
 */
export function ChainIcon({
  chainId,
  color,
  glyph,
  src,
  logo = true,
  size = "medium",
  border = false,
  className,
}: ChainIconProps) {
  const c = chainMeta(chainId);
  const image = src ?? (logo && glyph == null && color == null ? c.logo : undefined);
  return (
    <Disc
      className={className}
      size={size}
      border={border}
      title={c.name}
      color={color ?? c.color}
      src={image}
      glyph={glyph ?? c.glyph}
      fallback={c.short[0] ?? "?"}
    />
  );
}
