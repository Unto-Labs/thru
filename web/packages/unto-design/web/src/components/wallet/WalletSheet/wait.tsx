import * as React from "react";
import { Spinner } from "../../Spinner/Spinner";
import { Screen, type ScreenHeaderSize } from "../Screen/Screen";

/** Wait this long before the loading copy escalates and offers Retry / Cancel. */
export const WALLET_SHEET_ESCALATE_MS = 8000;

export function useWaitStages(
  key: React.Key | undefined,
  escalateAfterMs: number,
  canEscalate: boolean,
) {
  const [escalated, setEscalated] = React.useState(false);
  React.useEffect(() => {
    setEscalated(false);
    if (!canEscalate || escalateAfterMs <= 0) return;
    const t = window.setTimeout(() => setEscalated(true), escalateAfterMs);
    return () => window.clearTimeout(t);
  }, [key, escalateAfterMs, canEscalate]);
  return { escalated };
}

export function WaitHero({
  title,
  content,
  size = "md",
}: {
  title: React.ReactNode;
  content?: React.ReactNode;
  size?: ScreenHeaderSize;
}) {
  return (
    <Screen.Header
      size={size}
      icon={<Spinner tone="accent" style={size === "lg" ? { width: 22, height: 22 } : undefined} />}
      title={title}
      content={content}
    />
  );
}
