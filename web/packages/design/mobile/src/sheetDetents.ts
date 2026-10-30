/**
 * Positions are the sheet's top edge, in points from the top of the screen.
 * No React Native here, so the rules can be tested as they are.
 */

import { SHEET_FLICK_VELOCITY, sheetDragPosition } from "./sheetGesture";

export { SHEET_FLICK_VELOCITY, SHEET_OVERDRAG } from "./sheetGesture";

export type SheetDetent = "half" | "full";

export const SHEET_HALF_FRACTION = 0.52;
export const SHEET_HALF_MIN = 360;
export const SHEET_FULL_GAP = 16;
/** Snapping to a detent; the kit's curve, no overshoot. */
export const SHEET_SNAP_MS = 320;
/** Let go with less than this share of the half height showing: dismiss. */
export const SHEET_DISMISS_FRACTION = 0.6;
/** The scrim's share of its full strength at half. */
export const SHEET_HALF_SCRIM = 0.4 / 0.64;

export interface SheetGeometry {
  fullTop: number;
  halfTop: number;
  closedTop: number;
  halfHeight: number;
}

/** The detents for a screen `screenHeight` tall under a status bar
    `safeTop` tall. Half never reaches higher than full. */
export function sheetGeometry(screenHeight: number, safeTop: number): SheetGeometry {
  const fullTop = safeTop + SHEET_FULL_GAP;
  const halfHeight = Math.round(
    Math.min(Math.max(screenHeight * SHEET_HALF_FRACTION, SHEET_HALF_MIN), screenHeight - fullTop)
  );
  return { fullTop, halfTop: screenHeight - halfHeight, closedTop: screenHeight, halfHeight };
}

export function detentTop(detent: SheetDetent, geometry: SheetGeometry): number {
  return detent === "full" ? geometry.fullTop : geometry.halfTop;
}

/** Follows the finger 1:1, and at SHEET_OVERDRAG past full. */
export function dragTop(startTop: number, dy: number, geometry: SheetGeometry): number {
  return sheetDragPosition(startTop, dy, geometry.fullTop);
}

/** Where a released drag goes.
    - Dismiss when less than SHEET_DISMISS_FRACTION of the half height shows.
    - A downward flick dismisses from half, and from full drops to half.
    - An upward flick goes to full.
    - Otherwise, the nearer detent. */
export function releaseTarget(input: {
  top: number;
  /** Points per millisecond, positive downward. */
  velocity: number;
  /** The detent the drag started from. */
  from: SheetDetent;
  geometry: SheetGeometry;
}): SheetDetent | "dismiss" {
  const { top, velocity, from, geometry } = input;
  const showing = geometry.closedTop - top;
  if (showing < geometry.halfHeight * SHEET_DISMISS_FRACTION) return "dismiss";
  if (velocity >= SHEET_FLICK_VELOCITY) {
    return from === "half" || top > geometry.halfTop ? "dismiss" : "half";
  }
  if (velocity <= -SHEET_FLICK_VELOCITY) return "full";
  if (top >= geometry.halfTop) return "half";
  return top - geometry.fullTop < geometry.halfTop - top ? "full" : "half";
}
