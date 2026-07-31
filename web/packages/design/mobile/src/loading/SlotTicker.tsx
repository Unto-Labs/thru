/**
 * Slot Ticker — a split-flap departure board for the chain.
 *
 * `FlapDigits` lays a string out as fixed-width flap cells and flips only the
 * cells whose glyph actually changed, so a rolling slot number reads as an
 * odometer rather than a full re-render. `SlotTicker` composes that with the
 * status word (SYNCING → VERIFYING → READY) and an optional caption.
 * `MetaTable` is the hairline-ruled label/value block that sits under it, and
 * is useful anywhere a compact spec sheet is needed — not just while loading.
 *
 * Motion is plain RN `Animated` (the kit has no reanimated dependency). The
 * flip is a `scaleY` collapse-and-expand and the Reduce Motion fallback is an
 * `opacity` cross-fade, both of which the native driver owns end to end.
 *
 * Every `Animated.Value` in this file is native-driven for its entire
 * lifetime, and that is a hard requirement rather than a preference.
 * `AnimatedStyle.__makeNative()` walks *every* node in a component's style and
 * `AnimatedInterpolation.__makeNative()` walks up to its parent value, so a
 * JS-driven node that merely shares an `Animated.Text` with a native one gets
 * pulled into the native graph — and then throws "Attempting to run JS driven
 * animation on animated node that has been moved to native earlier" the next
 * time anything drives it from JS. The READY tint is therefore a plain state
 * swap rather than an interpolated `color`: `color` is not natively drivable,
 * so it cannot be animated at all in a component that also flips.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { font, space, text, touch } from "../tokens";
import { makeStyles, useThemeColors } from "../theme";
import { BrandTile } from "../BrandTile";

/* One full flip of a single cell: half collapses, half expands. */
const FLAP_MS = 120;
/* Left → right cascade, applied across the cells that actually changed. */
const FLAP_STAGGER_MS = 24;
/* Reduce Motion stand-in for the flip. */
const CROSSFADE_MS = 160;
/* How long the status word holds `forest` once it has finished spelling
   READY. The tint itself switches at the start of the flap so its arrival is
   masked, so the hold has to clear the flap before it starts counting —
   otherwise most of the 400ms is spent tinting the outgoing word. */
const READY_HOLD_MS = 400;
/* The live region republishes at most this often; the slot ticks faster. */
const ANNOUNCE_MS = 1000;

/**
 * How long a whole value takes to finish flipping, for `cells` cells: the
 * last-changed cell waits out the full stagger and then needs a flip of its
 * own. Callers driving a live value should not update faster than this.
 *
 * Over-driving does not throw, it degrades visibly: each new value interrupts
 * flips that have not finished, and cells that never complete a cycle stay
 * collapsed. Measured on device at a 90ms tick against a 6-cell number
 * (240ms of flip), several digits sat flat indefinitely. At the 333ms the
 * demo uses, every flip completes with room to spare.
 */
export function slotTickerSettleMs(cells: number): number {
  return FLAP_MS + Math.max(0, cells - 1) * FLAP_STAGGER_MS;
}

/* JetBrains Mono's advance width, in em. Cells are sized from this constant
   rather than from measured text, so the board's width is a function of the
   cell count and never of the glyphs sitting in them. RN has no `tabular-nums`
   guarantee across faces, and `Animated` transforms operate on views anyway,
   so an explicit per-cell width is both simpler and stricter. */
const MONO_ADVANCE_EM = 0.6;
/* Line box as a multiple of the glyph size. 44pt → 48, matching BalanceHero. */
const MONO_LINE_EM = 1.1;
/* Under this cell height the flap seam reads as noise, so it is dropped. */
const SEAM_MIN_HEIGHT = 24;
/* The half-flap shadow: a band of `bgInset` sitting just under the seam, as
   deep as this fraction of the cell, at this opacity when fully collapsed. */
const SHADOW_DEPTH_EM = 0.26;
const SHADOW_MAX_OPACITY = 0.5;

/* The brand beat above the board. Small enough that the slot number keeps the
   hierarchy, and square because the rest of the kit is square. */
const MARK_SIZE = 40;

/* The status row is padded to the longest word so the block never re-centers
   mid-flip and each letter flaps in place. */
const STATUS_CELLS = 9;
const STATUS_TRACKING = 1.2;
/* Wall time for the whole word to flap: the rightmost cell starts after the
   full stagger and still needs one flip of its own. */
const STATUS_FLAP_MS = FLAP_MS + (STATUS_CELLS - 1) * FLAP_STAGGER_MS;

/* Rendered word vs. what a screen reader should say. */
const STATUS_WORD: Record<SlotTickerStatus, string> = {
  syncing: "SYNCING",
  verifying: "VERIFYING",
  ready: "READY",
};
const STATUS_SPOKEN: Record<SlotTickerStatus, string> = {
  syncing: "Syncing",
  verifying: "Verifying",
  ready: "Ready",
};

/* A cell's glyph tint is always a flat color — see the note at the top of the
   file on why nothing here may hand an animated node to `color`. */

/* ------------------------------------------------------------------ utils */

/**
 * Groups an integer with commas. Written by hand because Hermes' `Intl`
 * support varies by platform and build flavour, and a loading screen must not
 * depend on it.
 */
function groupDigits(value: number): string {
  const digits = Math.abs(Math.trunc(value)).toString();
  let grouped = "";
  for (let index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ",";
    grouped += digits[index];
  }
  return value < 0 ? `-${grouped}` : grouped;
}

/** Pads a word out to `width` cells, keeping it centred on the board. */
function padCentred(word: string, width: number): string {
  if (word.length >= width) return word;
  const slack = width - word.length;
  const left = Math.floor(slack / 2);
  return " ".repeat(left) + word + " ".repeat(slack - left);
}

/**
 * How many leading characters are structural padding — leading zeros and the
 * separators in front of the first significant digit. Those render in
 * `fgSubtle` so the block keeps its width without shouting a fake magnitude.
 */
function leadingZeroRun(value: string): number {
  let index = 0;
  while (index < value.length - 1) {
    const glyph = value[index];
    if (glyph !== "0" && glyph !== "," && glyph !== " ") break;
    index++;
  }
  return index;
}

/**
 * Per-cell start delay for one transition. Cells whose glyph did not change
 * get 0 and never animate; changed cells cascade in document order, so a
 * single rolling digit snaps immediately and a carry ripples left to right.
 */
function staggerFor(previous: string, next: string): number[] {
  const delays: number[] = [];
  let changed = 0;
  for (let index = 0; index < next.length; index++) {
    if (previous[index] === next[index]) {
      delays.push(0);
      continue;
    }
    delays.push(changed * FLAP_STAGGER_MS);
    changed++;
  }
  return delays;
}

/* ------------------------------------------------------------------ hooks */

/**
 * Reads the OS Reduce Motion setting once on mount and then tracks it. Kept
 * private so the loading kit exposes exactly one motion policy.
 */
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      })
      .catch(() => {
        /* Best effort — if the query fails, motion stays on. */
      });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        if (alive) setReduceMotion(enabled);
      }
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

/** Diffs the incoming string against the last one and returns cell delays. */
function useFlapDelays(value: string): number[] {
  const [previous, setPrevious] = useState(value);
  const [delays, setDelays] = useState<number[]>([]);
  /* React's documented "adjust state when a prop changes" pattern, not an
     effect: the delays have to reach the cells in the same commit as the new
     glyphs, otherwise the first frame of every flip uses stale stagger. */
  if (previous !== value) {
    setPrevious(value);
    setDelays(staggerFor(previous, value));
  }
  return delays;
}

/**
 * Trailing-edge throttle. The slot can tick several times a second; letting a
 * live region republish that fast makes VoiceOver unusable, so the announced
 * string only changes once per `intervalMs`.
 */
function useThrottled<T>(value: T, intervalMs: number): T {
  const [published, setPublished] = useState(value);
  const publishedAt = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, intervalMs - (Date.now() - publishedAt.current));
    /* Always go through a timer, even when the value is already due, so the
       publish never happens synchronously inside the effect body. */
    const timer = setTimeout(() => {
      publishedAt.current = Date.now();
      setPublished(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [intervalMs, value]);
  return published;
}

/* ------------------------------------------------------------------- cell */

interface FlapCellProps {
  char: string;
  delay: number;
  fontFamily: string;
  height: number;
  reduceMotion: boolean;
  seam: boolean;
  size: number;
  tint: string;
  tracking: number;
  width: number;
}

/** One flap on the board. Owns the glyph it is currently showing. */
function FlapCell({
  char,
  delay,
  fontFamily,
  height,
  reduceMotion,
  seam,
  size,
  tint,
  tracking,
  width,
}: FlapCellProps) {
  const styles = useStyles();
  const [glyph, setGlyph] = useState(char);
  /* What the cell has been told to show, which can run ahead of `glyph` for
     the duration of a flip. Guards against re-animating on unrelated props. */
  const target = useRef(char);
  /* One value per driven property, and both are native for their whole
     lifetime — nothing in this component may ever drive either from JS. */
  const flip = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  /* Built once: a fresh interpolation per render would churn native nodes. */
  const shadow = useMemo(
    () => flip.interpolate({ inputRange: [0, 1], outputRange: [SHADOW_MAX_OPACITY, 0] }),
    [flip]
  );

  /* Switching motion policy mid-flight would strand one driver at 0. */
  useEffect(() => {
    flip.setValue(1);
    fade.setValue(1);
  }, [fade, flip, reduceMotion]);

  useEffect(() => {
    /* `delay` is in the deps, so this can re-run while a flip is mid-flight
       without the glyph having changed: `staggerFor` gives a cell a non-zero
       delay when it is the 2nd-or-later changed cell, then 0 on the next
       transition once it stops changing. The cleanup below has already
       stopped that flip, so returning without restarting it would strand the
       driver part-collapsed — an invisible glyph until the cell next changes.
       Reset instead, exactly as the reduce-motion switch above does. */
    if (target.current === char) {
      flip.setValue(1);
      fade.setValue(1);
      return;
    }
    target.current = char;

    let cancelled = false;
    const driver = reduceMotion ? fade : flip;
    const half = (reduceMotion ? CROSSFADE_MS : FLAP_MS) / 2;
    const easing = Easing.out(Easing.cubic);
    /* scaleY and opacity are both natively drivable, so the whole flip runs
       off the JS thread even while the ticker is re-rendering. */
    const collapse = Animated.timing(driver, {
      toValue: 0,
      duration: half,
      delay,
      easing,
      useNativeDriver: true,
    });
    const expand = Animated.timing(driver, {
      toValue: 1,
      duration: half,
      easing,
      useNativeDriver: true,
    });

    collapse.start(({ finished }) => {
      /* `finished` is false when a newer glyph or unmount interrupted us; the
         newer run owns the swap in that case. */
      if (cancelled || !finished) return;
      setGlyph(char);
      expand.start();
    });

    return () => {
      cancelled = true;
      collapse.stop();
      expand.stop();
    };
  }, [char, delay, fade, flip, reduceMotion]);

  return (
    <View style={[styles.cell, { height, marginLeft: tracking, width }]}>
      {seam ? (
        <>
          <Animated.View
            style={[
              styles.cellShadow,
              {
                height: Math.round(height * SHADOW_DEPTH_EM),
                opacity: shadow,
                top: Math.round(height / 2),
              },
            ]}
          />
          <View style={[styles.cellSeam, { top: Math.round(height / 2) }]} />
        </>
      ) : null}
      <Animated.Text
        /* Cell widths are computed from `size`, so Dynamic Type would push
           glyphs out of their flaps. The surrounding copy still scales. */
        allowFontScaling={false}
        style={[
          styles.glyph,
          {
            color: tint,
            fontFamily,
            fontSize: size,
            lineHeight: height,
            opacity: fade,
            transform: [{ scaleY: flip }],
          },
        ]}
      >
        {glyph}
      </Animated.Text>
    </View>
  );
}

/* -------------------------------------------------------------------- row */

interface FlapRowProps {
  fontFamily: string;
  reduceMotion: boolean;
  size: number;
  tintAt: (index: number) => string;
  tracking: number;
  value: string;
}

/** The shared board: N cells, one per character, diffed as a unit. */
function FlapRow({
  fontFamily,
  reduceMotion,
  size,
  tintAt,
  tracking,
  value,
}: FlapRowProps) {
  const styles = useStyles();
  const delays = useFlapDelays(value);
  /* Ceil the width so a glyph never clips against its own advance; round the
     height so 44pt lands on the 48pt line box the rest of the kit uses. */
  const width = Math.ceil(size * MONO_ADVANCE_EM);
  const height = Math.round(size * MONO_LINE_EM);
  const chars = Array.from(value);

  return (
    <View
      /* The composing component publishes one label for the whole board. */
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.row}
    >
      {chars.map((char, index) => (
        <FlapCell
          /* Position is the identity here: a cell is a physical slot on the
             board, and its glyph is the thing that changes. */
          key={index}
          char={char}
          delay={delays[index] ?? 0}
          fontFamily={fontFamily}
          height={height}
          reduceMotion={reduceMotion}
          seam={height >= SEAM_MIN_HEIGHT}
          size={size}
          tint={tintAt(index)}
          tracking={index === 0 ? 0 : tracking}
          width={width}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------- FlapDigits */

export interface FlapDigitsProps {
  /** The string to display. Every character gets its own flap cell. */
  value: string;
  /** Glyph size in pt; cell metrics derive from it. Defaults to the 44pt step. */
  size?: number;
  /** Glyph tint. Leading zeros always fall back to `fgSubtle`. */
  color?: string;
}

/**
 * A run of split-flap cells. Only the cells whose character differs from the
 * previous `value` animate, so an incrementing number behaves like an
 * odometer. The rendered width depends solely on `value.length`.
 *
 * The cells are hidden from assistive tech — reading a slot number one glyph
 * at a time is useless — so wrap standalone use in a labelled container the
 * way `SlotTicker` does.
 */
export function FlapDigits({ value, size = text.display, color }: FlapDigitsProps) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const tint = color ?? colors.fg;
  const padded = leadingZeroRun(value);

  return (
    <FlapRow
      fontFamily={font.monoMedium}
      reduceMotion={reduceMotion}
      size={size}
      tintAt={(index) => (index < padded ? colors.fgSubtle : tint)}
      tracking={0}
      value={value}
    />
  );
}

/* -------------------------------------------------------------- MetaTable */

export interface MetaTableRow {
  label: string;
  value: string;
}

export interface MetaTableProps {
  rows: readonly MetaTableRow[];
  style?: StyleProp<ViewStyle>;
}

/**
 * Hairline-ruled label/value rows. Each row carries its own rule on top, so
 * the block reads as a ruled table with a leading rule and no trailing one.
 */
export function MetaTable({ rows, style }: MetaTableProps) {
  const styles = useStyles();
  return (
    <View style={[styles.meta, style]}>
      {rows.map((row) => (
        <View
          key={row.label}
          accessible
          accessibilityLabel={`${row.label}, ${row.value}`}
          style={styles.metaRow}
        >
          <Text style={styles.metaLabel} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={styles.metaValue} numberOfLines={1} ellipsizeMode="tail">
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------- SlotTicker */

export type SlotTickerStatus = "syncing" | "verifying" | "ready";

export interface SlotTickerProps {
  /** Drives the status word and the READY tint. */
  status: SlotTickerStatus;
  /** `null` until the first response lands — renders `placeholder`, not a zero. */
  slot: number | null;
  /** One line of sentence copy under the board. */
  caption?: string;
  /** Shown while `slot` is null; give it the width you expect the slot to be. */
  placeholder?: string;
  /**
   * Draw the brand tile above the status word. Opt-in, so the board can be
   * judged on its own and so an in-app loading state (as opposed to a launch
   * screen) can skip the lockup.
   */
  mark?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The loading board: status word over the slot number over optional copy.
 * Exposed to assistive tech as a single indeterminate progress bar whose
 * label is throttled to one update per second.
 */
export function SlotTicker({
  caption,
  mark = false,
  placeholder = "------",
  slot,
  status,
  style,
}: SlotTickerProps) {
  const colors = useThemeColors();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();

  const digits = slot === null ? placeholder : groupDigits(slot);
  const label =
    slot === null
      ? `${STATUS_SPOKEN[status]}, waiting for the first slot`
      : `${STATUS_SPOKEN[status]}, slot ${digits}`;
  const announced = useThrottled(label, ANNOUNCE_MS);

  /* The READY tint is state, not animation. It arrives under cover of the
     flap that resolves the word, holds, then returns. */
  const [tinted, setTinted] = useState(status === "ready");
  const [lastStatus, setLastStatus] = useState(status);
  if (lastStatus !== status) {
    setLastStatus(status);
    setTinted(status === "ready");
  }

  useEffect(() => {
    /* Reduce Motion keeps the resolved tint for as long as READY lasts
       instead of timing it out. */
    if (!tinted || reduceMotion) return;
    const timer = setTimeout(
      () => setTinted(false),
      STATUS_FLAP_MS + READY_HOLD_MS
    );
    return () => clearTimeout(timer);
  }, [reduceMotion, tinted]);

  const statusTint = tinted ? colors.forest : colors.fgSubtle;

  return (
    <View
      /* One element, one announcement: the flap cells underneath are hidden,
         and the caption rides along as a hint so the live region can repeat
         the status without re-reading the sentence every second. */
      accessible
      accessibilityHint={caption}
      accessibilityLabel={announced}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[styles.ticker, style]}
    >
      {mark ? (
        /* A plain `View`, deliberately: `BrandTile` draws SVG, and an SVG
           subtree must never end up under a style carrying a native-driven
           transform. Nothing in this branch animates. */
        <View style={styles.mark}>
          <BrandTile size={MARK_SIZE} radius={0} />
        </View>
      ) : null}
      <FlapRow
        fontFamily={font.monoSemiBold}
        reduceMotion={reduceMotion}
        size={text.xxs}
        tintAt={() => statusTint}
        tracking={STATUS_TRACKING}
        value={padCentred(STATUS_WORD[status], STATUS_CELLS)}
      />
      <FlapDigits
        color={slot === null ? colors.fgSubtle : colors.fg}
        value={digits}
      />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  ticker: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: space[2],
  },
  /* Plus the container's 8pt gap, so 32 between the tile and the status word —
     enough that the mark reads as a separate beat, not as a label for it. */
  mark: {
    marginBottom: space[5],
  },
  caption: {
    color: c.fgMuted,
    fontFamily: font.sans,
    fontSize: text.sm,
    marginTop: space[1],
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
  },
  cell: {
    alignItems: "center",
    justifyContent: "center",
  },
  /* Cast by the falling flap onto the card below it; height set per cell. */
  cellShadow: {
    backgroundColor: c.bgInset,
    left: 0,
    position: "absolute",
    right: 0,
  },
  cellSeam: {
    backgroundColor: c.bgInset,
    height: 1,
    left: 0,
    position: "absolute",
    right: 0,
  },
  glyph: {
    textAlign: "center",
    width: "100%",
  },
  meta: {
    alignSelf: "stretch",
  },
  metaRow: {
    alignItems: "center",
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: space[4],
    justifyContent: "space-between",
    minHeight: touch.controlSm,
    paddingVertical: space[2],
  },
  metaLabel: {
    color: c.fgSubtle,
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  metaValue: {
    color: c.fg,
    flexShrink: 1,
    fontFamily: font.monoMedium,
    fontSize: text.sm,
    textAlign: "right",
  },
}));
