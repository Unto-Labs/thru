import * as React from "react";
import { cn } from "../../utils";
import "./Detail.css";

export interface DetailProps {
  /** Left-hand label (mono, secondary). */
  label?: React.ReactNode;
  /** Right-hand value. */
  children?: React.ReactNode;
  /** Stack label over value instead of the default inline row. */
  stacked?: boolean;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}

/**
 * Detail — a static label/value row: mono secondary label on the left, value on
 * the right (or stacked). The presentational core of the explorer's SummaryDatum;
 * loading/skeleton/empty handling stays in the consumer.
 */
export function Detail({
  label,
  children,
  stacked = false,
  className,
  labelClassName,
  valueClassName,
}: DetailProps) {
  return (
    <div className={cn("tds-detail", stacked && "tds-detail--stacked", className)}>
      {label != null && (
        <span className={cn("tds-detail__label", labelClassName)}>{label}</span>
      )}
      <span className={cn("tds-detail__value", valueClassName)}>{children}</span>
    </div>
  );
}
