/**
 * Hairline Grid — the design system's own geometry, animated.
 *
 * Leans only on kit primitives — `makeStyles`, the token scales and the brand
 * lockups — and keeps the kit's peer-dep discipline (see the driver note at
 * the bottom of this comment): RN `Animated` only, no reanimated.
 *
 * A full-bleed grid of 24pt cells stroked at 1px, running edge to edge (and
 * deliberately past the edges, so it reads as infinite under the safe areas).
 * A diagonal wave sweeps top-left → bottom-right filling cells; exactly one
 * cell — the wave's leading edge — is `accent` brick at a time, with a short
 * decay behind it. The brand mark is knocked out of the centre: the cells it
 * covers keep `bg` and their hairlines are suppressed, so the mark reads as a
 * hole punched in the grid rather than a badge sitting on top of it.
 *
 * `GridLoader`'s `mark` prop picks what sits in the hole. `"tile"` snaps a
 * square `BrandTile` to whole cells so the red lockup fills the punched
 * rectangle exactly, with no seam; `"wings"` centres a `WingsMark` in a hole
 * one step of air larger, keeping the paper-cutout read.
 *
 * Cheapness is the whole trick. A phone-sized grid is ~18×38 = 680 cells, and
 * 680 Views would drop frames, so this renders as ONE `react-native-svg` tree
 * of ~10 elements:
 *   - six nested fill strips (`Path`) at graded opacity — the same colour
 *     composited over itself is a no-op, so they stack into the leading
 *     opacity ramp and its mirrored trailing ramp;
 *   - two accent `Rect`s — the brick head, and the cell it just left decaying;
 *   - one stroked `Path` carrying every hairline in the grid.
 * Each strip is one rect per row (a diagonal staircase is row-decomposable),
 * so a repaint builds ~38 subpaths, not 680 — and the strings are memoised per
 * integer band index, so the loop is allocation-free after the first pass.
 * State only advances when that band index changes.
 *
 * Dependencies are react / react-native / react-native-svg only — no
 * reanimated, even though the app has it, so this stays promotable.
 * The wave is JS-driven (`useNativeDriver: false`) because it changes SVG path
 * geometry, which no natively-driven prop can express; the handoff fade and
 * the mark's settle transform are opacity/transform and run on the native
 * driver.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { font, radius, space, text } from "../tokens";
import { makeStyles } from "../theme";
import { BrandTile, WingsMark, WINGS_MARK_TRIM_ASPECT } from "../BrandTile";

/** Default cell edge in pt — 24 = six steps of the kit's 4px grid. */
export const HAIRLINE_GRID_CELL = 24;

/** One full sweep: the wave fills the grid and clears it again. */
export const HAIRLINE_GRID_PERIOD_MS = 1400;

/* Timing table (see the design spec):
     wave period     1400ms   one sweep: the wave fills the grid, then clears it
     fill ramp        180ms   per-cell opacity ramp at the wave's two edges
     accent hold       90ms   the brick head sits on one cell this long
     accent decay      90ms   the cell it left fades back to bgMuted
     determinate      240ms   follow time when `progress` moves
     handoff          240ms   grid fades to bg, mark settles to 0.96          */
const FILL_RAMP_MS = 180;
const ACCENT_HOLD_MS = 90;
const DETERMINATE_FOLLOW_MS = 240;
const HANDOFF_MS = 240;
const HANDOFF_SCALE = 0.96;

/* On a tall phone the head crosses ~54 bands in 700ms, so a literal 180ms
   ramp would smear a quarter of the diagonal and the leading edge would stop
   being locatable — which in turn makes the single brick cell look arbitrary
   rather than like the wave's tip. Cap the ramp here so the edge stays a
   legible step; small grids still get the full 180ms. */
const MAX_RAMP_FRACTION = 0.15;

const DEFAULT_MARK_SIZE = 96;
/** Breathing room around the mark before the hole is snapped to whole cells. */
const KNOCKOUT_PAD = space[2];

/* Six strips stacked back-to-front. Because every strip paints the same fill
   tone, the alphas compose to .18 / .41 / .65 / .84 / .96 / 1 — a smooth
   six-step ramp with only six host elements. */
const STRIP_ALPHA = [0.18, 0.28, 0.4, 0.55, 0.75, 1] as const;

/* The cell the head just left starts here and decays to nothing over the next
   hold, so exactly one cell is ever full-strength brick. */
const ACCENT_GHOST_ALPHA = 0.5;

/** A rectangle, in the grid's own coordinate space, to punch out of the grid. */
export interface HairlineGridKnockout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HairlineGridProps {
  /** Cell edge in pt. Defaults to `HAIRLINE_GRID_CELL` (24). */
  cell?: number;
  /** 0–1. Omit for an indeterminate, looping wave. */
  progress?: number;
  /** Region kept at `bg` with its hairlines suppressed — e.g. the logomark. */
  knockout?: HairlineGridKnockout | null;
  /** Explicit size; omit either and the grid measures its own box. */
  width?: number;
  height?: number;
  /**
   * Set when the grid stands alone. `GridLoader` leaves it unset because it
   * owns the `progressbar` role itself, and nested progressbars read badly.
   */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * What sits in the knockout.
 *
 * `"tile"` — the red `BrandTile`, square and snapped to whole cells, so it
 * fills the punched rectangle exactly. `"wings"` — the monochrome `WingsMark`
 * on `bg`, floating in a hole one step of air larger than the glyph.
 */
export type GridLoaderMark = "tile" | "wings";

export interface GridLoaderProps {
  /** One or two words, uppercased on render. Never a sentence. */
  caption: string;
  /** 0–1. Omit for an indeterminate, looping wave. */
  progress?: number;
  cell?: number;
  /** Which brand lockup fills the knockout. Defaults to `"tile"`. */
  mark?: GridLoaderMark;
  /**
   * Mark height in pt; the knockout is derived from it. `"tile"` rounds it to
   * a whole number of cells so the tile and the hole are the same rectangle.
   */
  markSize?: number;
  /** Runs the 240ms handoff — grid fades to `bg`, mark settles to 0.96. */
  handoff?: boolean;
  /** Explicit size; omit either and the loader measures its own box. */
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/* ---------------------------------------------------------------- geometry */

interface KnockoutCells {
  /** Half-open cell ranges: columns [c0, c1), rows [r0, r1). */
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

interface GridGeometry {
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  /** Non-positive; the grid overhangs so partial cells split evenly. */
  originX: number;
  originY: number;
  /** Anti-diagonal band count: a cell's band is `col + row`, 0 … bands - 1. */
  bands: number;
  knockout: KnockoutCells | null;
  /** Everything a path string depends on, for keying the strip cache. */
  sig: string;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Two decimals is well under a device pixel and keeps path strings short. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Cell count and (non-positive) origin for one axis. One extra cell so the
 * grid always overhangs the box on both sides rather than ending in a half
 * cell at the bottom right. `GridLoader` calls this too, so the mark can be
 * snapped onto exactly the same lattice the grid is drawn on.
 */
function axis(extent: number, cell: number): { count: number; origin: number } {
  const count = Math.ceil(extent / cell) + 1;
  return { count, origin: (extent - count * cell) / 2 };
}

/** Snaps a coordinate onto the nearest grid line of `axis()`'s lattice. */
function snapToLattice(value: number, origin: number, cell: number): number {
  return origin + Math.round((value - origin) / cell) * cell;
}

/* Absorbs float error when a caller hands us an already cell-aligned
   knockout — without it, an exact boundary can land on 3.9999999 and floor to
   the wrong cell, putting a one-cell sliver of grid under the mark. */
const SNAP_EPSILON = 1e-6;

function buildGeometry(
  width: number,
  height: number,
  cell: number,
  knockout: HairlineGridKnockout | null
): GridGeometry {
  const { count: cols, origin: originX } = axis(width, cell);
  const { count: rows, origin: originY } = axis(height, cell);

  let cells: KnockoutCells | null = null;
  if (knockout && knockout.width > 0 && knockout.height > 0) {
    const c0 = clamp(Math.floor((knockout.x - originX) / cell + SNAP_EPSILON), 0, cols);
    const c1 = clamp(
      Math.ceil((knockout.x + knockout.width - originX) / cell - SNAP_EPSILON),
      0,
      cols
    );
    const r0 = clamp(Math.floor((knockout.y - originY) / cell + SNAP_EPSILON), 0, rows);
    const r1 = clamp(
      Math.ceil((knockout.y + knockout.height - originY) / cell - SNAP_EPSILON),
      0,
      rows
    );
    if (c1 > c0 && r1 > r0) cells = { c0, c1, r0, r1 };
  }

  return {
    width,
    height,
    cell,
    cols,
    rows,
    originX,
    originY,
    bands: cols + rows - 1,
    knockout: cells,
    sig: `${fmt(width)}x${fmt(height)}@${fmt(cell)}${
      cells ? `+${cells.c0},${cells.c1},${cells.r0},${cells.r1}` : ""
    }`,
  };
}

/* Strip paths are a pure function of (geometry, lead, trail), so the memo
   lives at module scope: nothing React owns gets mutated, and it stays warm
   across remounts, so flipping away from the lab tab and back repaints
   without rebuilding a single path string. Bounded, and cleared wholesale
   when it overflows — the keys embed the geometry signature, so a resize
   simply stops hitting the old entries. */
const STRIP_CACHE_LIMIT = 2048;
const stripCache = new Map<string, string>();

function stripPath(g: GridGeometry, lead: number, trail: number | null): string {
  const key = `${g.sig}|${lead}|${trail === null ? "c" : trail}`;
  const hit = stripCache.get(key);
  if (hit !== undefined) return hit;
  const d = buildStrip(g, lead, trail);
  if (stripCache.size > STRIP_CACHE_LIMIT) stripCache.clear();
  stripCache.set(key, d);
  return d;
}

/** How many bands a 180ms cell ramp spans at the wave's crossing speed. */
function rampBands(g: GridGeometry): number {
  const crossingMs = HAIRLINE_GRID_PERIOD_MS / 2; /* the head crosses in half a period */
  const wanted = Math.round((g.bands * FILL_RAMP_MS) / crossingMs);
  const cap = Math.max(1, Math.floor(g.bands * MAX_RAMP_FRACTION));
  return clamp(wanted, 1, Math.min(cap, Math.max(1, Math.floor((g.bands - 1) / 2))));
}

/** Discrete stations the brick head visits, one per `ACCENT_HOLD_MS`. */
function stationCount(g: GridGeometry): number {
  const wanted = Math.round(HAIRLINE_GRID_PERIOD_MS / 2 / ACCENT_HOLD_MS);
  return clamp(wanted, 2, Math.max(2, Math.min(g.cols, g.rows)));
}

/* Every hairline in one stroked path. Lines that would cross the knockout are
   split around it — including the hole's own edges, so the mark reads as a
   hole and not as a boxed-in badge. */
function buildGridLines(g: GridGeometry): string {
  const parts: string[] = [];
  const k = g.knockout;
  const kx0 = k ? g.originX + k.c0 * g.cell : 0;
  const kx1 = k ? g.originX + k.c1 * g.cell : 0;
  const ky0 = k ? g.originY + k.r0 * g.cell : 0;
  const ky1 = k ? g.originY + k.r1 * g.cell : 0;
  /* Half a cell of slop absorbs float error at the snapped hole edges. */
  const eps = 0.01;

  for (let c = 0; c <= g.cols; c += 1) {
    const x = g.originX + c * g.cell;
    if (k && x >= kx0 - eps && x <= kx1 + eps) {
      if (ky0 > 0) parts.push(`M${fmt(x)} 0V${fmt(ky0)}`);
      if (ky1 < g.height) parts.push(`M${fmt(x)} ${fmt(ky1)}V${fmt(g.height)}`);
    } else {
      parts.push(`M${fmt(x)} 0V${fmt(g.height)}`);
    }
  }

  for (let r = 0; r <= g.rows; r += 1) {
    const y = g.originY + r * g.cell;
    if (k && y >= ky0 - eps && y <= ky1 + eps) {
      if (kx0 > 0) parts.push(`M0 ${fmt(y)}H${fmt(kx0)}`);
      if (kx1 < g.width) parts.push(`M${fmt(kx1)} ${fmt(y)}H${fmt(g.width)}`);
    } else {
      parts.push(`M0 ${fmt(y)}H${fmt(g.width)}`);
    }
  }

  return parts.join("");
}

function pushCellRun(
  parts: string[],
  g: GridGeometry,
  row: number,
  from: number,
  to: number
): void {
  if (to < from) return;
  const x = g.originX + from * g.cell;
  const y = g.originY + row * g.cell;
  const w = (to - from + 1) * g.cell;
  parts.push(`M${fmt(x)} ${fmt(y)}h${fmt(w)}v${fmt(g.cell)}h${fmt(-w)}Z`);
}

/**
 * All cells whose band sits in `(trail, lead]`, as one rect per row. Pass a
 * null `trail` for a cumulative fill (determinate mode, where cells latch and
 * never empty again).
 */
function buildStrip(g: GridGeometry, lead: number, trail: number | null): string {
  const parts: string[] = [];
  const k = g.knockout;
  for (let r = 0; r < g.rows; r += 1) {
    const end = Math.min(g.cols - 1, lead - r);
    if (end < 0) continue;
    const start = trail === null ? 0 : Math.max(0, trail - r + 1);
    if (start > end) continue;
    if (k && r >= k.r0 && r < k.r1 && end >= k.c0 && start < k.c1) {
      pushCellRun(parts, g, r, start, Math.min(end, k.c0 - 1));
      pushCellRun(parts, g, r, Math.max(start, k.c1), end);
    } else {
      pushCellRun(parts, g, r, start, end);
    }
  }
  return parts.join("");
}

/**
 * The cell the brick head occupies at station `index`: the cell the grid's
 * main diagonal passes through, which is always on the wave's leading edge.
 * Heads that land inside the knockout slide to its left (or top) edge, so the
 * wave visibly routes around the mark instead of vanishing behind it.
 */
function stationCell(
  g: GridGeometry,
  index: number,
  stations: number
): { c: number; r: number } | null {
  const t = (index + 0.5) / stations;
  let c = clamp(Math.floor(t * g.cols), 0, g.cols - 1);
  let r = clamp(Math.floor(t * g.rows), 0, g.rows - 1);
  const k = g.knockout;
  if (k && c >= k.c0 && c < k.c1 && r >= k.r0 && r < k.r1) {
    if (k.c0 > 0) c = k.c0 - 1;
    else if (k.r0 > 0) r = k.r0 - 1;
    else return null;
  }
  return { c, r };
}

/* -------------------------------------------------------------- reduce motion */

/* Deliberately not exported: the loading kit has several sibling files and a
   generically named hook would collide in the package barrel. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduce(enabled);
      })
      .catch(() => {
        /* Older hosts can reject; a missing answer just means "animate". */
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (alive) setReduce(enabled);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Measures a box once laid out, ignoring sub-pixel churn. */
function useMeasuredBox(): [{ w: number; h: number }, (event: LayoutChangeEvent) => void] {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((prev) =>
      Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5
        ? prev
        : { w: width, h: height }
    );
  }, []);
  return [box, onLayout];
}

/* ------------------------------------------------------------ HairlineGrid */

export function HairlineGrid({
  cell = HAIRLINE_GRID_CELL,
  progress,
  knockout = null,
  width,
  height,
  accessibilityLabel,
  style,
}: HairlineGridProps) {
  const tones = useTones();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const [box, onLayout] = useMeasuredBox();

  const w = width ?? box.w;
  const h = height ?? box.h;

  /* Depend on the knockout's numbers, not its identity, so an inline object
     from a caller does not rebuild the geometry on every render. */
  const kx = knockout ? knockout.x : 0;
  const ky = knockout ? knockout.y : 0;
  const kw = knockout ? knockout.width : -1;
  const kh = knockout ? knockout.height : -1;

  const geometry = useMemo(
    () =>
      w > 0 && h > 0
        ? buildGeometry(w, h, cell, kw >= 0 && kh >= 0 ? { x: kx, y: ky, width: kw, height: kh } : null)
        : null,
    [cell, h, kh, kw, kx, ky, w]
  );

  const determinate = typeof progress === "number";
  const target = determinate ? clamp(progress as number, 0, 1) : 0;
  const bands = geometry ? geometry.bands : 0;
  const ramp = geometry ? rampBands(geometry) : 1;
  /* Lead value at which the last cell is fully solid. */
  const fillSpan = Math.max(1, bands - 1 + ramp);

  /* DRIVER OWNERSHIP — `wave` is JS-driven for its entire lifetime. Both of
     its start sites below pass `useNativeDriver: false`, and it is never put
     in a style prop, so RN never moves it into the native graph. The handoff
     in `GridLoader` deliberately uses a *separate* value (`settle`, always
     native) instead of reusing this one: once RN moves a value to native it
     can never be JS-driven again, and a later JS start throws
     "Attempting to run JS driven animation on animated node that has been
     moved to native". Never start `wave` with `useNativeDriver: true`. */
  const [wave] = useState(() => new Animated.Value(0));
  const leadRef = useRef(0);
  const modeRef = useRef<boolean | null>(null);
  const [animatedLead, setAnimatedLead] = useState(0);

  /* Reduce-motion's frame is a pure function of the props, so derive it rather
     than pushing it through state from an effect — same picture, no cascading
     render, and the animated path keeps sole ownership of `animatedLead`. */
  const lead = reduceMotion
    ? Math.round((determinate ? target : 0.5) * fillSpan)
    : animatedLead;

  useEffect(() => {
    if (!geometry) return;

    if (reduceMotion) {
      /* Static frame: a half-filled grid (or the real progress), no wave. The
         mode is cleared so the animated path re-seeds if motion comes back. */
      modeRef.current = null;
      return;
    }

    if (modeRef.current !== determinate) {
      /* Crossing between modes rescales the value's meaning, so re-seed it
         rather than animating through a nonsense intermediate frame. */
      modeRef.current = determinate;
      wave.setValue(determinate ? target : 0);
    }

    const listener = wave.addListener(({ value }) => {
      /* Determinate: 0 → 1 maps onto -ramp → fillSpan, so progress 0 is a
         truly empty grid. Indeterminate: 0 → 1 maps onto a lead that runs
         clean off the far corner, with the trailing edge one grid behind, so
         the loop restarts from an empty grid with no visible seam. */
      const f = determinate ? value * (fillSpan + ramp) - ramp : value * 2 * bands;
      const next = Math.floor(f);
      if (next !== leadRef.current) {
        leadRef.current = next;
        setAnimatedLead(next);
      }
    });

    const animation = determinate
      ? Animated.timing(wave, {
          toValue: target,
          duration: DETERMINATE_FOLLOW_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false /* drives SVG path geometry, not a style */,
        })
      : Animated.loop(
          Animated.timing(wave, {
            toValue: 1,
            duration: HAIRLINE_GRID_PERIOD_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false /* drives SVG path geometry, not a style */,
          })
        );

    animation.start();
    return () => {
      animation.stop();
      wave.removeListener(listener);
    };
  }, [bands, determinate, fillSpan, geometry, ramp, reduceMotion, target, wave]);

  const lines = useMemo(() => (geometry ? buildGridLines(geometry) : ""), [geometry]);

  /* Six cached lookups per band change — see `stripPath`, which is where the
     "allocation-free after the first pass" property actually lives. */
  const strips = useMemo(() => {
    if (!geometry) return [];
    const cumulative = determinate || reduceMotion;
    const last = STRIP_ALPHA.length - 1;

    return STRIP_ALPHA.map((alpha, i) => {
      const offset = Math.round((ramp * i) / last);
      const stripLead = lead - offset;
      const stripTrail = cumulative ? null : lead - geometry.bands + offset;
      /* Keyed by slot, not by path: a tiny grid can round two slots onto the
         same offset and duplicate React keys. */
      return { slot: `strip-${i}`, d: stripPath(geometry, stripLead, stripTrail), alpha };
    }).filter((strip) => strip.d.length > 0);
  }, [determinate, geometry, lead, ramp, reduceMotion]);

  const accents = useMemo(() => {
    if (!geometry) return [];
    /* The head only exists while the wave's leading edge is on the grid. */
    const t = geometry.bands > 0 ? lead / geometry.bands : 0;
    if (t < 0 || t > 1) return [];

    const stations = stationCount(geometry);
    const position = t * stations;
    const index = clamp(Math.floor(position), 0, stations - 1);
    /* How far through this cell's 90ms hold we are; the cell the head left
       fades out across exactly that window. */
    const phase = clamp(position - index, 0, 1);

    const at = (i: number) => {
      const found = i >= 0 ? stationCell(geometry, i, stations) : null;
      if (!found) return null;
      return {
        key: `${found.c}:${found.r}`,
        x: geometry.originX + found.c * geometry.cell,
        y: geometry.originY + found.r * geometry.cell,
      };
    };

    const head = at(index);
    /* Painted first so the full-strength head always wins the overlap. */
    const ghost = reduceMotion ? null : at(index - 1);
    const out: { key: string; x: number; y: number; alpha: number }[] = [];
    if (ghost && (!head || ghost.key !== head.key)) {
      out.push({ ...ghost, alpha: ACCENT_GHOST_ALPHA * (1 - phase) });
    }
    if (head) out.push({ ...head, alpha: 1 });
    return out;
  }, [geometry, lead, reduceMotion]);

  const a11y = accessibilityLabel
    ? ({
        accessible: true,
        accessibilityRole: "progressbar",
        accessibilityLabel,
        accessibilityValue: determinate
          ? { now: Math.round(target * 100), min: 0, max: 100 }
          : undefined,
      } as const)
    : ({
        accessible: false,
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants",
      } as const);

  return (
    <View {...a11y} style={[styles.grid, style]} onLayout={onLayout}>
      {geometry ? (
        <Svg width={geometry.width} height={geometry.height} pointerEvents="none">
          {strips.map((strip) => (
            <Path key={strip.slot} d={strip.d} fill={tones.fill.color} opacity={strip.alpha} />
          ))}
          {accents.map((accent) => (
            <Rect
              key={accent.key}
              x={accent.x}
              y={accent.y}
              width={geometry.cell}
              height={geometry.cell}
              fill={tones.accent.color}
              opacity={accent.alpha}
            />
          ))}
          <Path d={lines} stroke={tones.line.color} strokeWidth={1} fill="none" />
        </Svg>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------- GridLoader */

export function GridLoader({
  caption,
  progress,
  cell = HAIRLINE_GRID_CELL,
  mark = "tile",
  markSize = DEFAULT_MARK_SIZE,
  handoff = false,
  width,
  height,
  style,
}: GridLoaderProps) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const [box, onLayout] = useMeasuredBox();

  const w = width ?? box.w;
  const h = height ?? box.h;

  /* Where the mark sits, and what to punch out for it. The two variants want
     different geometry, and the aspect ratio is not shared: BrandTile is
     square, WingsMark is WINGS_MARK_TRIM_ASPECT (0.9005). */
  const layout = useMemo(() => {
    if (!(w > 0 && h > 0)) return null;

    if (mark === "tile") {
      /* Round the tile to a whole number of cells and land it on the grid's
         own lattice, so the hole and the tile are the SAME rectangle and the
         red drops in with no seam. Snapping can move it up to half a cell off
         true centre, which is under 12pt and reads as centred. */
      const span = Math.max(cell, Math.round(markSize / cell) * cell);
      const rect = {
        x: snapToLattice(w / 2 - span / 2, axis(w, cell).origin, cell),
        y: snapToLattice(h / 2 - span / 2, axis(h, cell).origin, cell),
        width: span,
        height: span,
      };
      return { rect, knockout: rect };
    }

    /* Wings: centred exactly, in a hole one step of air larger, which
       HairlineGrid then snaps out to whole cells. */
    const markWidth = markSize * WINGS_MARK_TRIM_ASPECT;
    const rect = {
      x: (w - markWidth) / 2,
      y: (h - markSize) / 2,
      width: markWidth,
      height: markSize,
    };
    return {
      rect,
      knockout: {
        x: rect.x - KNOCKOUT_PAD,
        y: rect.y - KNOCKOUT_PAD,
        width: rect.width + KNOCKOUT_PAD * 2,
        height: rect.height + KNOCKOUT_PAD * 2,
      },
    };
  }, [cell, h, mark, markSize, w]);

  const knockout: HairlineGridKnockout | null = layout ? layout.knockout : null;

  /* DRIVER OWNERSHIP — 0 = live, 1 = handed off. Opacity and transform only,
     so `settle` is native-driven for its entire lifetime and is never handed
     to a JS-driven animation. It is a different value from `HairlineGrid`'s
     `wave` (always JS-driven) precisely so the two drivers can never meet on
     one node. Never start `settle` with `useNativeDriver: false`. */
  const [settle] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      settle.setValue(handoff ? 1 : 0);
      return;
    }
    const animation = Animated.timing(settle, {
      toValue: handoff ? 1 : 0,
      duration: HANDOFF_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [handoff, reduceMotion, settle]);

  const fade = settle.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const scale = settle.interpolate({ inputRange: [0, 1], outputRange: [1, HANDOFF_SCALE] });

  const determinate = typeof progress === "number";
  const now = determinate ? Math.round(clamp(progress as number, 0, 1) * 100) : 0;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption}
      accessibilityValue={determinate ? { now, min: 0, max: 100 } : undefined}
      style={[styles.loader, style]}
      onLayout={onLayout}
    >
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: fade }]}
      >
        <HairlineGrid cell={cell} progress={progress} knockout={knockout} width={w} height={h} />
      </Animated.View>

      {layout ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        >
          <Animated.View
            style={[
              styles.mark,
              {
                left: layout.rect.x,
                top: layout.rect.y,
                width: layout.rect.width,
                height: layout.rect.height,
                transform: [{ scale }],
              },
            ]}
          >
            {mark === "tile" ? (
              <BrandTile size={layout.rect.width} radius={radius.none} />
            ) : (
              <WingsMark size={layout.rect.height} />
            )}
          </Animated.View>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.caption,
              { top: layout.rect.y + layout.rect.height + space[6], opacity: fade },
            ]}
          >
            {caption.toUpperCase()}
          </Animated.Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The grid's three paints. `react-native-svg` takes plain colour strings
 * rather than styles, so they live in their own `makeStyles` sheet: every
 * per-theme decision still sits in one place at the bottom of the file and
 * still gets the hook's per-theme cache; the component just reads the strings
 * back off the sheet.
 *
 * `fill` is per-theme because the Stone ramp is not perceptually even. In
 * light, `bgMuted` over `bg` is ΔL* 3.6 — on a phone that simply does not
 * survive, and all a viewer saw was one brick square wandering graph paper,
 * which loses the entire idea of the direction; `bgInset` takes it to 10.1.
 * The same token in dark would be ΔL* 30.5, three times the light value and
 * a heavy teal wash, so dark keeps `bgMuted` at ΔL* 19.1. Equal token names
 * would look wildly unequal; these two look like the same wave.
 *
 * `line` is `borderStrong` in both, and it has to be: the ramp aliases the
 * two families, so `border` IS `bgInset` in light and IS `bgMuted` in dark —
 * i.e. the default hairline is exactly the fill colour in one theme or the
 * other, and cells dissolve into a wash the moment the wave covers them.
 * `borderStrong` is the contrastier neighbour of the fill in both directions
 * (darker in light, lighter in dark), which also keeps the hairlines the
 * loudest element and the fill the softer one, in both themes.
 */
const useTones = makeStyles((c, theme) => ({
  fill: { color: theme.isDark ? c.bgMuted : c.bgInset },
  line: { color: c.borderStrong },
  accent: { color: c.accent },
}));

const useStyles = makeStyles((c) => ({
  grid: { flex: 1, backgroundColor: c.bg, overflow: "hidden" },
  loader: { flex: 1, backgroundColor: c.bg, overflow: "hidden" },
  mark: { position: "absolute", alignItems: "center", justifyContent: "center" },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: font.mono,
    fontSize: text.xxs,
    lineHeight: 16,
    letterSpacing: 1.2,
    color: c.fgSubtle,
  },
}));
