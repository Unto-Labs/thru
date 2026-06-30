import * as React from "react";
import { cn } from "../../utils";
import { Ui4, Ui5 } from "../Text/Text";
import { CopyButton } from "../wallet/CopyButton/CopyButton";
import "./Timestamp.css";

export interface TimestampProps {
  /** A Date or epoch-ms value, formatted via Intl when `formatted` is absent. */
  value?: Date | number;
  /** Explicit absolute text (e.g. a consumer's timezone-aware format). Wins over `value`. */
  formatted?: string;
  /** Secondary relative line (e.g. "16 seconds ago"). Consumer-supplied. */
  relative?: string;
  /** Slot rendered next to the time — e.g. a timezone-toggle button. */
  action?: React.ReactNode;
  /** Show an inline copy icon. */
  copy?: boolean;
  /** Value copied (defaults to `formatted`/the raw value). */
  copyValue?: string;
  className?: string;
  textClassName?: string;
  placeholder?: React.ReactNode;
}

const ABS = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

/**
 * Timestamp — presentational time display: an absolute line (mono) with an
 * optional relative line, an action slot (e.g. a timezone toggle), and optional
 * inline copy. Formatting + timezone state stay with the consumer (pass
 * `formatted`/`relative`), or pass a `value` for default Intl formatting.
 */
export function Timestamp({
  value,
  formatted,
  relative,
  action,
  copy = false,
  copyValue,
  className,
  textClassName,
  placeholder = "—",
}: TimestampProps) {
  const abs =
    formatted ?? (value != null ? ABS.format(typeof value === "number" ? new Date(value) : value) : undefined);

  if (abs === undefined) {
    return <span className={cn("tds-timestamp", className)}>{placeholder}</span>;
  }

  const toCopy = copyValue ?? formatted ?? (value != null ? String(value) : abs);

  return (
    <span className={cn("tds-timestamp", className)}>
      <span className="tds-timestamp__row">
        <Ui4 className={cn("tds-timestamp__abs", textClassName)}>{abs}</Ui4>
        {action}
        {copy && <CopyButton value={toCopy} icon />}
      </span>
      {relative && <Ui5 className="tds-timestamp__rel">{relative}</Ui5>}
    </span>
  );
}
