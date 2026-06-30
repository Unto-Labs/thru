import * as React from "react";
import { Button, type ButtonProps } from "../../Button/Button";
import "./CopyButton.css";

const CopyIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 5.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const CheckIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * useCopy — copy a string to the clipboard and expose a transient `notifying`
 * flag (true for `timeout` ms after a copy) so callers can flip their label/icon.
 */
export function useCopy(timeout = 800) {
  const [notifying, setNotifying] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = React.useCallback(
    (value: string) => {
      navigator.clipboard?.writeText(value).catch(() => {});
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      setNotifying(true);
      timerRef.current = window.setTimeout(() => setNotifying(false), timeout);
    },
    [timeout],
  );
  return { copy, notifying };
}

type StatefulLabel = { normal: React.ReactNode; copied: React.ReactNode };

export interface CopyButtonProps {
  /** The string written to the clipboard. */
  value: string;
  /**
   * Label content. A plain node is shown always; pass `{ normal, copied }` to
   * swap it for the brief confirmation window after a copy.
   */
  label?: React.ReactNode | StatefulLabel;
  /** Icon shown in the idle state (self-contained — bring your own icon node). */
  copyIcon?: React.ReactNode;
  /** Icon shown briefly after a copy. */
  copiedIcon?: React.ReactNode;
  /** Render the inline link-style text variant instead of a Button. */
  text?: boolean;
  /** Render a bare, icon-only button (no Button chrome) — for inline copy next
   *  to an address/value. Takes precedence over `text`. */
  icon?: boolean;
  /** Accessible label for the icon-only variant. */
  "aria-label"?: string;
  /** Forwarded to the underlying Button (ignored for the text/icon variants). */
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

function isStateful(label: CopyButtonProps["label"]): label is StatefulLabel {
  return !!label && typeof label === "object" && "normal" in (label as object);
}

/**
 * CopyButton — copies `value` to the clipboard with a brief confirmation.
 * Presentational and self-contained: pass icon nodes via `copyIcon`/`copiedIcon`
 * (no built-in icon set). `text` renders the inline link variant.
 */
export function CopyButton({
  value,
  label,
  copyIcon,
  copiedIcon,
  text = false,
  icon = false,
  variant = "ghost",
  size = "sm",
  className,
  "aria-label": ariaLabel = "Copy to clipboard",
}: CopyButtonProps) {
  const { copy, notifying } = useCopy();
  const lbl = isStateful(label) ? (notifying ? label.copied : label.normal) : label;
  const iconNode = notifying
    ? (copiedIcon ?? <CheckIcon width={14} height={14} />)
    : (copyIcon ?? <CopyIcon width={14} height={14} />);

  if (icon) {
    return (
      <button
        type="button"
        className={["tds-copy-icon", className].filter(Boolean).join(" ")}
        onClick={(e) => {
          e.stopPropagation();
          copy(value);
        }}
        aria-label={ariaLabel}
        title={notifying ? "Copied!" : ariaLabel}
      >
        {iconNode}
      </button>
    );
  }

  if (text) {
    return (
      <button
        type="button"
        className={["tds-copy-text", className].filter(Boolean).join(" ")}
        onClick={() => copy(value)}
      >
        {lbl}
        {iconNode}
      </button>
    );
  }
  return (
    <Button variant={variant} size={size} className={className} onClick={() => copy(value)}>
      {lbl}
      {iconNode}
    </Button>
  );
}
