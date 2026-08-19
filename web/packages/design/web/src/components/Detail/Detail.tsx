import * as React from "react";
import { cn } from "../../utils";
import "./Detail.css";

export type DetailVariant = "default" | "summary";

export interface DetailProps {
  /** Left-hand label. */
  label?: React.ReactNode;
  /** Right-hand value. */
  children?: React.ReactNode;
  /** Stack label over value instead of the default inline row. */
  stacked?: boolean;
  /**
   * Which half is machine-facing, and so which half is mono.
   *
   * `default` — a field name and its contents (mono label, sans value), the
   * explorer's key/value shape.
   * `summary` — a plain-language label against a figure (sans label, mono
   * tabular value), for money and totals, where the numbers must align.
   */
  variant?: DetailVariant;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}

/**
 * Detail — a static label/value row. The presentational core of the explorer's
 * SummaryDatum; loading/skeleton/empty handling stays in the consumer.
 */
export function Detail({
  label,
  children,
  stacked = false,
  variant = "default",
  className,
  labelClassName,
  valueClassName,
}: DetailProps) {
  return (
    <div
      className={cn(
        "tds-detail",
        `tds-detail--${variant}`,
        stacked && "tds-detail--stacked",
        className,
      )}
    >
      {label != null && (
        <span className={cn("tds-detail__label", labelClassName)}>{label}</span>
      )}
      <span className={cn("tds-detail__value", valueClassName)}>{children}</span>
    </div>
  );
}
