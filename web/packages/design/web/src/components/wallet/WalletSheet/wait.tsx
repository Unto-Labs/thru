import * as React from "react";
import { Spinner } from "../../Spinner/Spinner";
import { Screen, type ScreenHeaderSize } from "../Screen/Screen";
import { Dove } from "../Dove/Dove";
import "./wait.css";

/** Wait this long on a spinner before the dove takes over. */
export const WALLET_SHEET_SLOW_MS = 2000;
/** Wait this long before the loading copy escalates and offers Retry / Cancel. */
export const WALLET_SHEET_ESCALATE_MS = 8000;

export function useWaitStages(
  key: React.Key | undefined,
  slowAfterMs: number,
  escalateAfterMs: number,
  canEscalate: boolean,
) {
  const [slow, setSlow] = React.useState(false);
  const [escalated, setEscalated] = React.useState(false);
  React.useEffect(() => {
    setSlow(false);
    setEscalated(false);
    const t1 = slowAfterMs > 0 ? window.setTimeout(() => setSlow(true), slowAfterMs) : null;
    const t2 =
      canEscalate && escalateAfterMs > 0
        ? window.setTimeout(() => setEscalated(true), escalateAfterMs)
        : null;
    return () => {
      if (t1 != null) window.clearTimeout(t1);
      if (t2 != null) window.clearTimeout(t2);
    };
  }, [key, slowAfterMs, escalateAfterMs, canEscalate]);
  return { slow, escalated };
}

export function WaitHero({
  slow,
  title,
  content,
  size = "md",
}: {
  slow: boolean;
  title: React.ReactNode;
  content?: React.ReactNode;
  size?: ScreenHeaderSize;
}) {
  const lg = size === "lg";
  return slow ? (
    <Screen.Header
      tone="plain"
      size={size}
      icon={
        <span role="status" aria-label="Still loading" className="tds-wait__dove">
          <Dove size={lg ? 60 : 52} draw />
        </span>
      }
      title={title}
      content={content}
    />
  ) : (
    <Screen.Header
      size={size}
      icon={<Spinner tone="brick" style={lg ? { width: 22, height: 22 } : undefined} />}
      title={title}
      content={content}
    />
  );
}
