/**
 * Loading-lab prototype 3 of 5 — "Hairline Grid".
 *
 * A self-driving demo of the `GridLoader` in `../src/loading/HairlineGrid`:
 * nothing to tap, no network, no wallet, no navigation. It loops a ~7.1s cycle
 * forever so a reviewer can leave it running on a simulator:
 *
 *   0.0s  CONNECTING       indeterminate wave, two full 1400ms sweeps
 *   2.8s  SIGNING          indeterminate wave, one sweep
 *   4.2s  LOADING MARKETS  determinate, 0 → 100% over one sweep
 *   5.6s  hold at 100% for 1.2s
 *   6.8s  handoff — grid fades to bg over 240ms, mark settles to 0.96
 *   7.1s  reset; the grid fades back in as CONNECTING restarts
 *
 * Phase boundaries land on multiples of the wave period on purpose: the
 * indeterminate strip is off the grid at the end of every sweep, so handing
 * over to the determinate fill at 4.2s has no visible seam.
 *
 * Reduce-motion is handled inside `GridLoader` (static half-filled grid,
 * caption still cycles), so this file does not branch on it.
 */
import type React from "react";
import { useEffect, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { GridLoader, HAIRLINE_GRID_CELL, HAIRLINE_GRID_PERIOD_MS } from "../src";

const CONNECTING_END = HAIRLINE_GRID_PERIOD_MS * 2; /* 2800 */
const SIGNING_END = HAIRLINE_GRID_PERIOD_MS * 3; /*    4200 */
const FILL_END = HAIRLINE_GRID_PERIOD_MS * 4; /*       5600 */
const HOLD_END = FILL_END + 1200; /*                   6800 */
const CYCLE_MS = HOLD_END + 300; /*                    7100 */

/** 60ms is fine enough for the 240ms follow inside the grid. */
const TICK_MS = 60;

/** Quantised so identical frames compare equal and skip the re-render. */
const PROGRESS_STEPS = 24;

interface Frame {
  caption: string;
  progress: number | undefined;
  handoff: boolean;
}

function frameAt(elapsed: number): Frame {
  if (elapsed < CONNECTING_END) {
    return { caption: "CONNECTING", progress: undefined, handoff: false };
  }
  if (elapsed < SIGNING_END) {
    return { caption: "SIGNING", progress: undefined, handoff: false };
  }
  if (elapsed < FILL_END) {
    const raw = (elapsed - SIGNING_END) / (FILL_END - SIGNING_END);
    return {
      caption: "LOADING MARKETS",
      progress: Math.round(raw * PROGRESS_STEPS) / PROGRESS_STEPS,
      handoff: false,
    };
  }
  return { caption: "LOADING MARKETS", progress: 1, handoff: elapsed >= HOLD_END };
}

function sameFrame(a: Frame, b: Frame): boolean {
  return a.caption === b.caption && a.progress === b.progress && a.handoff === b.handoff;
}

/** Keeps the cell on the kit's 4px grid while scaling with the screen. */
function cellFor(width: number): number {
  const scaled = Math.round(width / 16 / 4) * 4;
  return Math.max(20, Math.min(28, scaled || HAIRLINE_GRID_CELL));
}

function markFor(width: number): number {
  return Math.max(72, Math.min(112, Math.round((width * 0.26) / 8) * 8));
}

export function HairlineGridPrototype(): React.JSX.Element {
  const window = useWindowDimensions();
  /* Seed from the window so the very first frame already draws a full-bleed
     grid, then correct to the real parent box once layout resolves. */
  const [size, setSize] = useState({ w: window.width, h: window.height });
  const [frame, setFrame] = useState<Frame>(() => frameAt(0));

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      const next = frameAt((Date.now() - startedAt) % CYCLE_MS);
      setFrame((prev) => (sameFrame(prev, next) ? prev : next));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((prev) =>
          Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5
            ? prev
            : { w: width, h: height }
        );
      }}
    >
      <GridLoader
        caption={frame.caption}
        progress={frame.progress}
        handoff={frame.handoff}
        cell={cellFor(size.w)}
        markSize={markFor(size.w)}
        width={size.w}
        height={size.h}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
});
