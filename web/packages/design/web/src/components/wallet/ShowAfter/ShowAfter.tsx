import * as React from "react";
import "./ShowAfter.css";

export interface ShowAfterProps {
  /** Milliseconds to wait before fading the children in. */
  delay?: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * ShowAfter — reveals its children after a delay, fading them in. The fade is
 * driven by the `data-shown` attribute in CSS (no inline transition logic).
 */
export function ShowAfter({ delay = 0, children, className }: ShowAfterProps) {
  const [shown, setShown] = React.useState(delay === 0);
  React.useEffect(() => {
    if (delay === 0) return;
    const t = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);
  return (
    <div
      className={["tds-show-after", className].filter(Boolean).join(" ")}
      data-shown={shown ? "" : undefined}
    >
      {children}
    </div>
  );
}
