import * as React from "react";

export interface SpacerProps {
  /** Gap size in pixels. */
  size: number;
  /** Axis the gap occupies. */
  orientation?: "horizontal" | "vertical";
}

/**
 * Spacer — a fixed-size spacing element, horizontal or vertical. Purely
 * structural; no tokens or classes needed.
 */
export function Spacer({ size, orientation = "vertical" }: SpacerProps) {
  return orientation === "horizontal" ? (
    <span aria-hidden style={{ display: "inline-block", width: size }} />
  ) : (
    <div aria-hidden style={{ height: size }} />
  );
}
