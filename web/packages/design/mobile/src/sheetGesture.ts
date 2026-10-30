export const SHEET_OVERDRAG = 0.3;
export const SHEET_FLICK_VELOCITY = 0.5;

export function shouldClaimSheetGesture(input: {
  dx: number;
  dy: number;
  numberActiveTouches: number;
  allowUpward?: boolean;
}): boolean {
  return input.numberActiveTouches === 1
    && Math.abs(input.dy) > 6
    && Math.abs(input.dy) > Math.abs(input.dx)
    && (input.allowUpward === true || input.dy > 0);
}

export function sheetDragPosition(start: number, dy: number, minimum = 0): number {
  const next = start + dy;
  return next >= minimum ? next : minimum - (minimum - next) * SHEET_OVERDRAG;
}

export function singleSheetReleaseTarget(input: {
  dy: number;
  velocity: number;
  height: number;
  cancelled?: boolean;
}): "open" | "dismiss" {
  if (input.cancelled || input.dy <= 0) return "open";
  return input.dy > input.height * 0.3
    || (input.dy >= 12 && input.velocity >= SHEET_FLICK_VELOCITY)
    ? "dismiss" : "open";
}
