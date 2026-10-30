export interface SpacerProps {
  /** Gap size in pixels. */
  size: number;
  /** Axis the gap occupies. */
  orientation?: "horizontal" | "vertical";
}

export function Spacer({ size, orientation = "vertical" }: SpacerProps) {
  return orientation === "horizontal" ? (
    <span aria-hidden style={{ display: "inline-block", width: size }} />
  ) : (
    <div aria-hidden style={{ height: size }} />
  );
}
