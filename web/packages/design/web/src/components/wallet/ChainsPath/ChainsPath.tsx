import * as React from "react";
import { cn } from "../../../utils";
import "./ChainsPath.css";

const ArrowRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface ChainMeta {
  /** Display name. */
  name: string;
  /** Single-character glyph for the disc. */
  glyph?: string;
  /** Optional accent color. */
  color?: string;
}

export interface ChainsPathProps {
  /** Ordered chains; the last is the destination, the rest are sources. */
  chains: ChainMeta[];
  className?: string;
}

function Disc({ chain }: { chain: ChainMeta }) {
  return (
    <span
      className="tds-chains-path__disc"
      title={chain.name}
      style={chain.color ? { background: chain.color, color: "#fff" } : undefined}
    >
      {chain.glyph ?? chain.name.slice(0, 1)}
    </span>
  );
}

/**
 * ChainsPath — a source → destination route across chains. With a single chain
 * it renders just that disc + name; with several, the sources overlap into a
 * stack, then an arrow, then the destination. Presentational; data via props.
 */
export const ChainsPath = React.forwardRef<HTMLDivElement, ChainsPathProps>(
  function ChainsPath({ chains, className }, ref) {
    if (chains.length === 0) return null;
    const dest = chains[chains.length - 1];
    const sources = chains.slice(0, -1);
    return (
      <div ref={ref} className={cn("tds-chains-path", className)}>
        {sources.length === 0 ? (
          <Disc chain={dest} />
        ) : (
          <>
            <span className="tds-chains-path__stack">
              {sources.map((c, i) => (
                <Disc key={i} chain={c} />
              ))}
            </span>
            <span className="tds-chains-path__arrow">
              <ArrowRight width={11} height={11} />
            </span>
            <Disc chain={dest} />
          </>
        )}
        <span className="tds-chains-path__name">{dest.name}</span>
      </div>
    );
  },
);
