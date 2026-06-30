import * as React from "react";
import { cn } from "../../../utils";
import { TokenIcon } from "../TokenIcon/TokenIcon";
import { ChainIcon } from "../ChainIcon/ChainIcon";
import { chainMeta } from "../registry";
import "./Balance.css";

const RefreshCw = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M13.5 7a5.5 5.5 0 1 0-1.3 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M13.5 3v3.2h-3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface BalanceProps {
  /** Token symbol — looked up in the registry for the icon color/glyph. */
  tokenSymbol: string;
  /** Token name, shown as the primary label. */
  tokenName: string;
  /** Chain id — looked up in the registry for the badge + "on {name}". */
  chainId: number;
  /** Formatted fiat amount (e.g. "$1,284.50"). */
  amountFiat: string;
  /** Show a spinner instead of the refresh icon. */
  fetching?: boolean;
  /** Tint the amount as a warning. */
  warn?: boolean;
  /** Refetch handler — the fiat area becomes a tap target. */
  onRefetch?: () => void;
  /** Drop the outer border (for grouping). */
  seamless?: boolean;
  className?: string;
}

/**
 * Balance — a token balance row: a token disc with a chain badge, the token
 * name and chain, and a refreshable fiat value. Icons/colors come from the
 * built-in chain/token registry.
 */
export const Balance = React.forwardRef<HTMLDivElement, BalanceProps>(
  function Balance(
    { tokenSymbol, tokenName, chainId, amountFiat, fetching, warn, onRefetch, seamless, className },
    ref,
  ) {
    return (
      <div ref={ref} className={cn("tds-balance", seamless && "tds-balance--seamless", className)}>
        <div className="tds-balance__icon">
          <TokenIcon symbol={tokenSymbol} size={20} />
          <span className="tds-balance__chain">
            <ChainIcon chainId={chainId} size={14} />
          </span>
        </div>
        <div className="tds-balance__info">
          <div className="tds-balance__name">{tokenName}</div>
          <div className="tds-balance__on">on {chainMeta(chainId).name}</div>
        </div>
        <button
          type="button"
          className="tds-balance__fiat"
          disabled={!onRefetch || fetching}
          onClick={onRefetch}
        >
          <span className={cn("tds-balance__amount", warn && "tds-balance__amount--warn")}>
            {amountFiat}
          </span>
          <span className="tds-balance__refresh">
            {fetching ? <span className="tds-balance__spinner" /> : <RefreshCw width={13} height={13} />}
          </span>
        </button>
      </div>
    );
  },
);
