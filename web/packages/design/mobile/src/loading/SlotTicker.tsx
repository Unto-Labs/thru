/*
 * Every `Animated.Value` here must stay native-driven: a JS-driven node that
 * shares an `Animated.Text` with a native one is pulled into the native graph
 * and throws on its next JS drive. `color` is not natively drivable, so the
 * READY tint is a state swap.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { font, space, text, touch } from "../tokens";
import { useReduceMotion } from "../reduceMotion";
import { makeStyles, useThemeColors } from "../theme";
import { BrandTile } from "../BrandTile";
import { CopyButton } from "../CopyButton";

const FLAP_MS = 120;
const FLAP_STAGGER_MS = 24;
const CROSSFADE_MS = 160;
/* Counted from the end of the status flap: the tint switches at its start. */
const READY_HOLD_MS = 400;
const ANNOUNCE_MS = 1000;

/**
 * How long a whole value takes to finish flipping, for `cells` cells: the
 * last-changed cell waits out the full stagger and then needs a flip of its
 * own. Callers driving a live value should not update faster than this.
 * Over-driving interrupts unfinished flips and can leave cells collapsed.
 */
export function slotTickerSettleMs(cells: number): number {
  return FLAP_MS + Math.max(0, cells - 1) * FLAP_STAGGER_MS;
}

/* JetBrains Mono's advance width, in em. RN has no `tabular-nums` guarantee
   across faces, so cells get an explicit width. */
const MONO_ADVANCE_EM = 0.6;
const MONO_LINE_EM = 1.1;
const SEAM_MIN_HEIGHT = 24;
const SHADOW_DEPTH_EM = 0.26;
const SHADOW_MAX_OPACITY = 0.5;

const MARK_SIZE = 40;

/* The status row is padded to the longest word so the block never re-centers
   mid-flip and each letter flaps in place. */
const STATUS_CELLS = 9;
const STATUS_TRACKING = 1.2;
const STATUS_FLAP_MS = FLAP_MS + (STATUS_CELLS - 1) * FLAP_STAGGER_MS;

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

/** Groups an integer with commas by hand: Hermes' `Intl` support varies by platform and build. */
function groupDigits(value: number): string {
  const digits = Math.abs(Math.trunc(value)).toString();
  let grouped = "";
  for (let index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ",";
    grouped += digits[index];
  }
  return value < 0 ? `-${grouped}` : grouped;
}

function padCentred(word: string, width: number): string {
  if (word.length >= width) return word;
  const slack = width - word.length;
  const left = Math.floor(slack / 2);
  return " ".repeat(left) + word + " ".repeat(slack - left);
}

/** Leading zeros and separators before the first significant digit. */
function leadingZeroRun(value: string): number {
  let index = 0;
  while (index < value.length - 1) {
    const glyph = value[index];
    if (glyph !== "0" && glyph !== "," && glyph !== " ") break;
    index++;
  }
  return index;
}

/** Per-cell start delay: unchanged cells get 0; changed cells cascade left to right. */
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

function useFlapDelays(value: string): number[] {
  const [previous, setPrevious] = useState(value);
  const [delays, setDelays] = useState<number[]>([]);
  /* Set during render, not in an effect, so the delays land in the same
     commit as the new glyphs. */
  if (previous !== value) {
    setPrevious(value);
    setDelays(staggerFor(previous, value));
  }
  return delays;
}

/** Trailing-edge throttle: a live region republishing several times a second makes VoiceOver unusable. */
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
  /* Runs ahead of `glyph` for the duration of a flip. */
  const target = useRef(char);
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
    /* A `delay` change re-runs this with the same glyph after the cleanup
       stopped the flip; reset, or the cell stays part-collapsed. */
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
        /* Cell widths derive from `size`; Dynamic Type would push glyphs out. */
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

interface FlapRowProps {
  fontFamily: string;
  reduceMotion: boolean;
  size: number;
  tintAt: (index: number) => string;
  tracking: number;
  value: string;
}

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
  /* Ceil so a glyph never clips against its own advance. */
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

export interface FlapDigitsProps {
  /** The string to display. Every character gets its own flap cell. */
  value: string;
  /** Glyph size in pt; cell metrics derive from it. Defaults to `text.display`. */
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

export interface MetaTableRow {
  label: string;
  value: string;
  /** detail variant: a copy button after the value (addresses, signatures). */
  copy?: boolean;
  /** Read out for the copy button; defaults to "Copy <label>". */
  copyLabel?: string;
  /** detail variant: the value in brick, as a failure's error code. */
  danger?: boolean;
}

export interface MetaTableProps {
  rows: readonly MetaTableRow[];
  /** `board` (default): the loading boards' ruled table. `detail`: a detail
      screen's label/value table with an optional copy button per row. */
  variant?: "board" | "detail";
  /** Called with the row whose copy button was pressed. */
  onCopy?: (row: MetaTableRow) => void;
  /** The label of the row just copied: its button shows a check for now. */
  copied?: string | null;
  style?: StyleProp<ViewStyle>;
}

export function MetaTable({ rows, variant = "board", onCopy, copied = null, style }: MetaTableProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  if (variant === "detail") {
    return (
      <View style={[styles.detailTable, style]}>
        {rows.map((row) => {
          const copyable = Boolean(row.copy && onCopy);
          return (
            <View key={row.label} style={styles.detailRow}>
              <View accessible accessibilityLabel={`${row.label}, ${row.value}`} style={styles.detailText}>
                <Text style={styles.detailLabel} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text
                  style={[styles.detailValue, row.danger ? { color: colors.accent } : null]}
                  numberOfLines={2}
                  ellipsizeMode="middle"
                >
                  {row.value}
                </Text>
              </View>
              {copyable ? (
                <CopyButton
                  copied={copied === row.label}
                  onPress={() => onCopy?.(row)}
                  accessibilityLabel={row.copyLabel ?? `Copy ${row.label.toLowerCase()}`}
                  copiedLabel={`${row.label} copied`}
                  style={styles.copyButton}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    );
  }
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
  /** Draw the brand tile above the status word. */
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

  const [tinted, setTinted] = useState(status === "ready");
  const [lastStatus, setLastStatus] = useState(status);
  if (lastStatus !== status) {
    setLastStatus(status);
    setTinted(status === "ready");
  }

  useEffect(() => {
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
      /* The caption is a hint so the live region repeats only the status. */
      accessible
      accessibilityHint={caption}
      accessibilityLabel={announced}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[styles.ticker, style]}
    >
      {mark ? (
        /* A plain View: an SVG subtree must never sit under a native-driven
           transform. */
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
  detailTable: {
    alignSelf: "stretch",
    borderTopColor: c.bgMuted,
    borderTopWidth: 1,
  },
  detailRow: {
    alignItems: "center",
    borderBottomColor: c.bgMuted,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 52,
    paddingLeft: touch.screenX,
    paddingRight: touch.screenX,
  },
  detailText: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: touch.gutter,
    minWidth: 0,
  },
  detailLabel: {
    color: c.fgMuted,
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    width: 96,
  },
  detailValue: {
    color: c.fg,
    flex: 1,
    fontFamily: font.mono,
    fontSize: text.sm,
    lineHeight: 18,
    minWidth: 0,
    textAlign: "right",
  },
  copyButton: { marginLeft: touch.gutter },
}));
