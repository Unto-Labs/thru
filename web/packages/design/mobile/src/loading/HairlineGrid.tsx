/* One react-native-svg tree of ~10 elements: a View per cell (~680 on a
   phone) drops frames. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { useReduceMotion } from "../reduceMotion";
import { makeStyles } from "../theme";
import { BrandTile, WingsMark, WINGS_MARK_TRIM_ASPECT } from "../BrandTile";

/** Default cell edge in pt. */
export const HAIRLINE_GRID_CELL = 24;

/** One full sweep: the wave fills the grid and clears it again. */
export const HAIRLINE_GRID_PERIOD_MS = 1400;

const FILL_RAMP_MS = 180;
const ACCENT_HOLD_MS = 90;
const DETERMINATE_FOLLOW_MS = 240;
const HANDOFF_MS = 240;
const HANDOFF_SCALE = 0.96;

const MAX_RAMP_FRACTION = 0.15;

const DEFAULT_MARK_SIZE = 96;
const KNOCKOUT_PAD = space[2];

/* The strips stack over each other, so these composite to .18 → 1. */
const STRIP_ALPHA = [0.18, 0.28, 0.4, 0.55, 0.75, 1] as const;

const ACCENT_GHOST_ALPHA = 0.5;

/** A rectangle, in the grid's own coordinate space, to punch out of the grid. */
export interface HairlineGridKnockout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HairlineGridProps {
  /** Cell edge in pt. Defaults to `HAIRLINE_GRID_CELL`. */
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
 * What sits in the knockout: `"tile"` is a `BrandTile` snapped to whole
 * cells; `"wings"` is a `WingsMark` in a padded hole.
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

function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Cell count and (non-positive) origin for one axis. `GridLoader` calls this
 * too, so the mark snaps onto the same lattice the grid is drawn on.
 */
function axis(extent: number, cell: number): { count: number; origin: number } {
  const count = Math.ceil(extent / cell) + 1;
  return { count, origin: (extent - count * cell) / 2 };
}

function snapToLattice(value: number, origin: number, cell: number): number {
  return origin + Math.round((value - origin) / cell) * cell;
}

/* Float error can floor an already cell-aligned edge (3.9999999) into the
   wrong cell. */
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

/** How many bands the fill ramp spans at the wave's crossing speed. */
function rampBands(g: GridGeometry): number {
  const crossingMs = HAIRLINE_GRID_PERIOD_MS / 2;
  const wanted = Math.round((g.bands * FILL_RAMP_MS) / crossingMs);
  const cap = Math.max(1, Math.floor(g.bands * MAX_RAMP_FRACTION));
  return clamp(wanted, 1, Math.min(cap, Math.max(1, Math.floor((g.bands - 1) / 2))));
}

/** Discrete stations the brick head visits, one per `ACCENT_HOLD_MS`. */
function stationCount(g: GridGeometry): number {
  const wanted = Math.round(HAIRLINE_GRID_PERIOD_MS / 2 / ACCENT_HOLD_MS);
  return clamp(wanted, 2, Math.max(2, Math.min(g.cols, g.rows)));
}

function buildGridLines(g: GridGeometry): string {
  const parts: string[] = [];
  const k = g.knockout;
  const kx0 = k ? g.originX + k.c0 * g.cell : 0;
  const kx1 = k ? g.originX + k.c1 * g.cell : 0;
  const ky0 = k ? g.originY + k.r0 * g.cell : 0;
  const ky1 = k ? g.originY + k.r1 * g.cell : 0;
  /* Absorbs float error at the snapped hole edges. */
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

  /* Depend on the numbers, not the identity, so an inline knockout object
     does not rebuild the geometry every render. */
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

  /* JS-driven only. Once RN moves a value to native it can never run a JS
     animation again, so `GridLoader`'s handoff uses a separate value. */
  const [wave] = useState(() => new Animated.Value(0));
  const leadRef = useRef(0);
  const modeRef = useRef<boolean | null>(null);
  const [animatedLead, setAnimatedLead] = useState(0);

  const lead = reduceMotion
    ? Math.round((determinate ? target : 0.5) * fillSpan)
    : animatedLead;

  useEffect(() => {
    if (!geometry) return;

    if (reduceMotion) {
      /* Cleared so the animated path re-seeds if motion comes back. */
      modeRef.current = null;
      return;
    }

    if (modeRef.current !== determinate) {
      modeRef.current = determinate;
      wave.setValue(determinate ? target : 0);
    }

    const listener = wave.addListener(({ value }) => {
      /* Determinate maps 0 → 1 onto -ramp → fillSpan so 0 is empty.
         Indeterminate runs the lead off the far corner so the loop restarts
         from an empty grid. */
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
    const t = geometry.bands > 0 ? lead / geometry.bands : 0;
    if (t < 0 || t > 1) return [];

    const stations = stationCount(geometry);
    const position = t * stations;
    const index = clamp(Math.floor(position), 0, stations - 1);
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

  const layout = useMemo(() => {
    if (!(w > 0 && h > 0)) return null;

    if (mark === "tile") {
      /* Snapped to HairlineGrid's lattice so the hole and the tile are the
         same rectangle. */
      const span = Math.max(cell, Math.round(markSize / cell) * cell);
      const rect = {
        x: snapToLattice(w / 2 - span / 2, axis(w, cell).origin, cell),
        y: snapToLattice(h / 2 - span / 2, axis(h, cell).origin, cell),
        width: span,
        height: span,
      };
      return { rect, knockout: rect };
    }

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

  /* 0 = live, 1 = handed off. Native-driven only; never share it with
     `HairlineGrid`'s JS-driven `wave`. */
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

/* react-native-svg takes colour strings, not styles, so the paints live in
   their own sheet. `line` cannot be `border`: it aliases the fill colour in
   one theme or the other. */
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
