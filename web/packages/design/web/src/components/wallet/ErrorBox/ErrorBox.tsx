import * as React from "react";
import { cn } from "../../../utils";
import { Screen } from "../Screen/Screen";
import { CopyButton } from "../CopyButton/CopyButton";
import "./ErrorBox.css";

export interface ErrorBoxProps {
  /** Raw error text, clamped to two lines; the copy action takes all of it. */
  message: string;
  /** Label of the copy action (default "Copy error"). */
  copyLabel?: React.ReactNode;
  className?: string;
}

/**
 * ErrorBox — the quiet panel under a failed wallet ceremony: the raw error,
 * clamped to two lines, and a link-style action that copies the full text.
 */
export function ErrorBox({ message, copyLabel = "Copy error", className }: ErrorBoxProps) {
  return (
    <Screen.Box className={cn("tds-errbox", className)}>
      <div className="tds-errbox__msg">{message}</div>
      <CopyButton value={message} text label={copyLabel} className="tds-errbox__copy" />
    </Screen.Box>
  );
}
