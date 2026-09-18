import * as React from "react";
import { cn } from "../../../utils";
import "./DepositButton.css";

const PlusCircle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);

export type DepositButtonState = "idle" | "loading";
export type DepositButtonSize = "md" | "sm" | "xs";
export type DepositButtonVariant = "primary" | "outline" | "brick" | "ghost";

const ICON_PX: Record<DepositButtonSize, number> = { md: 16, sm: 14, xs: 12 };

export interface DepositButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** Idle shows the plus disc; loading spins it and swaps the label. */
  state?: DepositButtonState;
  size?: DepositButtonSize;
  /** `ghost` is the inline text-link form (brand color, underline on hover). */
  variant?: DepositButtonVariant;
  /** Idle label (default "Add funds"); loading reads "Adding funds…". */
  label?: React.ReactNode;
  /** Formatted balance shown after a hairline, e.g. "$1,284.50". */
  balance?: React.ReactNode;
  /** Show the balance segment (hidden while loading). */
  showBalance?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * DepositButton — the funding entry point a host app drops next to its
 * ConnectButton (or inline, as `ghost`, next to a balance). Idle it reads
 * "Add funds" with a plus disc; while the wallet sheet is open it spins and
 * reads "Adding funds…". With `balance` the current balance trails the label
 * after a hairline. Metrics mirror ConnectButton / Button per size; the
 * reference caller is `thru.deposit({ to: account })`.
 */
export const DepositButton = React.forwardRef<HTMLButtonElement, DepositButtonProps>(
  function DepositButton(
    {
      state = "idle",
      size = "md",
      variant = "primary",
      label,
      balance,
      showBalance = true,
      onClick,
      className,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const loading = state === "loading";
    const iconPx = ICON_PX[size];
    const text = label ?? (loading ? "Adding funds…" : "Add funds");
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "tds-deposit-btn",
          `tds-deposit-btn--${size}`,
          `tds-deposit-btn--${variant}`,
          loading && "tds-deposit-btn--loading",
          className,
        )}
        onClick={loading ? undefined : onClick}
        aria-busy={loading || undefined}
        disabled={disabled}
        {...rest}
      >
        {loading ? (
          <span
            className="tds-deposit-btn__spin"
            role="status"
            aria-label="Loading"
            style={{ width: iconPx, height: iconPx }}
          />
        ) : (
          <PlusCircle width={iconPx} height={iconPx} />
        )}
        <span>{text}</span>
        {showBalance && !loading && balance != null && (
          <>
            <span className="tds-deposit-btn__sep" aria-hidden />
            <span className="tds-deposit-btn__bal">{balance}</span>
          </>
        )}
      </button>
    );
  },
);
