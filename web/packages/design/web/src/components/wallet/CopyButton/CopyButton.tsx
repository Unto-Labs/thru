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

/* Copy by selecting a hidden node and running the legacy copy command. A Range
   selection rather than a focused textarea, so focus (and any dialog focus
   trap) is left alone. */
function copyWithSelection(value: string): boolean {
  if (typeof document === "undefined") return false;
  const selection = document.getSelection();
  if (!selection) return false;
  const saved = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i));
  const node = document.createElement("span");
  node.textContent = value;
  node.setAttribute("aria-hidden", "true");
  node.style.cssText =
    "position:fixed;top:0;left:0;clip:rect(0,0,0,0);white-space:pre;user-select:text;-webkit-user-select:text";
  document.body.appendChild(node);
  let copied = false;
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    selection.removeAllRanges();
    for (const range of saved) selection.addRange(range);
    node.remove();
  }
  return copied;
}

/**
 * copyText — write `value` to the clipboard; resolves true once it is there.
 * Chromium refuses the async Clipboard API in a cross-origin iframe unless the
 * host delegates `clipboard-write` (the embedded wallet can't count on that),
 * so a refusal falls back to the legacy copy command, which still runs inside
 * the click's user activation.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyWithSelection(value);
  }
}

/**
 * useCopy — copy a string to the clipboard and expose a transient `notifying`
 * flag (true for `timeout` ms after a successful copy) so callers can flip
 * their label/icon.
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
    async (value: string) => {
      const copied = await copyText(value);
      if (copied) {
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
        setNotifying(true);
        timerRef.current = window.setTimeout(() => setNotifying(false), timeout);
      }
      return copied;
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
          void copy(value);
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
        onClick={() => void copy(value)}
      >
        {lbl}
        {iconNode}
      </button>
    );
  }
  return (
    <Button variant={variant} size={size} className={className} onClick={() => void copy(value)}>
      {lbl}
      {iconNode}
    </Button>
  );
}
