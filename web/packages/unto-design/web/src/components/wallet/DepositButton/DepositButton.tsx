import * as React from "react";
import { cn } from "../../../utils";
import { Button, type ButtonProps } from "../../Button/Button";
import { Spinner } from "../../Spinner/Spinner";
import "./DepositButton.css";

const PlusCircle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);

export type DepositButtonState = "idle" | "loading";
export type DepositButtonSize = "md" | "sm" | "xs";
export type DepositButtonVariant = "primary" | "outline" | "accent" | "ghost";

const ICON_PX: Record<DepositButtonSize, number> = { md: 16, sm: 14, xs: 12 };

export interface DepositButtonProps
  extends Omit<ButtonProps, "variant" | "size" | "children" | "onClick"> {
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
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * DepositButton — the funding entry point a host app drops next to its
 * ConnectButton (or inline, as `ghost`, next to a balance). It is a Button
 * with a plus icon and an optional balance segment; the reference caller is
 * `unto.deposit({ to: account })`.
 */
export const DepositButton = React.forwardRef<HTMLElement, DepositButtonProps>(
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
      ...rest
    },
    ref,
  ) {
    const loading = state === "loading";
    const iconPx = ICON_PX[size];
    const text = label ?? (loading ? "Adding funds…" : "Add funds");
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn("uds-deposit-btn", loading && "uds-deposit-btn--loading", className)}
        onClick={loading ? undefined : onClick}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? (
          <Spinner tone="inherit" style={{ width: iconPx, height: iconPx }} />
        ) : (
          <PlusCircle width={iconPx} height={iconPx} />
        )}
        <span>{text}</span>
        {showBalance && !loading && balance != null && (
          <>
            <span className="uds-deposit-btn__sep" aria-hidden />
            <span className="uds-deposit-btn__bal">{balance}</span>
          </>
        )}
      </Button>
    );
  },
);
