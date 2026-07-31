/**
 * Throughput Meter — the wait rendered as a link-quality readout.
 *
 * Instead of a spinner, each channel the app is actually blocked on gets a row:
 * a 72pt mono label, a bar of 24 discrete cells (1pt gaps, square, never a
 * continuous track), and a mono latency readout. Unknown latency prints an
 * em-dash — the meter never invents a number. `ChannelStatus` stacks the rows
 * under one plain-language phase line and over the endpoint caption.
 *
 * Motion is RN `Animated` only — the kit's peer deps are react / react-native /
 * react-native-svg, so importing react-native-reanimated here is off limits
 * even though the app ships it. Every animated property is `opacity` or
 * `translateX`, chosen so the whole file runs on the native driver: the
 * indeterminate sweep is one value driving one translated band, and the
 * completion flash is one value driving one overlay's opacity. The discrete
 * latch is a re-render, not an animated property, so it steps on a timer.
 *
 * Reduce Motion is honoured: no sweep, no flash, and indeterminate bars render
 * as a static 30% fill so the row still reads as "working, extent unknown".
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { font, space, text, touch } from "../tokens";
import { makeStyles, useThemeColors } from "../theme";
import { Button } from "../Button";
import { BrandTile } from "../BrandTile";

/* The kit compiles with `types: []` and no DOM lib (mobile/tsconfig.json), so
   the timer globals React Native provides at runtime are not in the checker's
   scope. Declaring the two we use module-locally keeps this file working under
   both that config and an app config that does have them. */
declare function setInterval(handler: () => void, ms: number): number;
declare function clearInterval(handle: number): void;

/** Cells per bar. 24 is the spec'd width and what the label column is sized for. */
const DEFAULT_SEGMENTS = 24;
/** Cells lit by the indeterminate sweep band. */
const DEFAULT_BAND = 5;
const CELL_GAP = 1;
const CELL_HEIGHT = 6;
/** One full sweep, left edge to right edge. */
const SWEEP_MS = 1100;
/** Cadence of the determinate latch — one cell at a time. */
const LATCH_MS = 40;
/* 80 + 160 = the 240ms completion flash. */
const FLASH_IN_MS = 80;
const FLASH_OUT_MS = 160;
/** Static stand-in for the sweep when Reduce Motion is on. */
const REDUCED_FILL = 0.3;
const LABEL_WIDTH = 72;
const READOUT_WIDTH = 80;
/** Shown until a real measurement exists. Never `0ms`. */
const READOUT_PLACEHOLDER = "——";
const PHASE_ENTER_MS = 220;
/** Sweep offset between stacked rows, so they do not move as one object. */
const SWEEP_STAGGER_MS = 140;
/* Faceplate badge, not a splash logo: big enough to be the brand, small enough
   that the phase line stays the first thing read. Square — `BrandTile` rounds
   by default, and rounded corners next to hairline chrome look borrowed. */
const MARK_SIZE = 44;
/* Interpolation input ranges must be strictly increasing, so each step of the
   quantised sweep is a near-vertical ramp rather than a true discontinuity. */
const STEP_EPSILON = 0.0001;

export type MeterTone = "default" | "ok" | "error";

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Live Reduce Motion state; starts optimistic and corrects on the first query. */
function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {
        /* Best effort — if the query fails, motion stays on. */
      });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      if (active) setReduced(value);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export interface SegmentBarProps {
  /** Cell count. Defaults to 24. */
  segments?: number;
  /** 0..1. Omit entirely for the indeterminate sweep. */
  progress?: number;
  /** `ok` snaps full and flashes forest; `error` fills brick. */
  tone?: MeterTone;
  /** Width of the indeterminate sweep band, in cells. */
  band?: number;
  /** Stagger, in ms, so stacked bars do not sweep in lockstep. */
  sweepDelay?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A bar of discrete cells. Decorative on its own — `MeterRow` supplies the
 * accessible label and value, so a bare `SegmentBar` is hidden from VoiceOver.
 */
export function SegmentBar({
  segments = DEFAULT_SEGMENTS,
  progress,
  tone = "default",
  band = DEFAULT_BAND,
  sweepDelay = 0,
  style,
}: SegmentBarProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();

  const [width, setWidth] = useState(0);
  const [latched, setLatched] = useState(0);
  const latchedRef = useRef(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const previousTone = useRef<MeterTone>(tone);

  /* No progress and nothing resolved yet: the band carries the motion. */
  const indeterminate = progress === undefined && tone === "default";

  const cellWidth = width > 0 ? Math.max((width - CELL_GAP * (segments - 1)) / segments, 1) : 0;
  const pitch = cellWidth + CELL_GAP;
  const indices = useMemo(() => Array.from({ length: segments }, (_, index) => index), [segments]);
  const bandIndices = useMemo(() => Array.from({ length: band }, (_, index) => index), [band]);

  useEffect(() => {
    const commit = (value: number) => {
      if (latchedRef.current === value) return;
      latchedRef.current = value;
      setLatched(value);
    };

    /* Indeterminate is also the reset point for a fresh attempt: cells go dark
       and the sweep takes over, or hold a static fill under Reduce Motion. */
    if (indeterminate) {
      commit(reduceMotion ? Math.round(segments * REDUCED_FILL) : 0);
      return;
    }

    /* Resolved either way — the bar snaps, it does not crawl to full. */
    if (tone !== "default") {
      commit(segments);
      return;
    }

    const target = clamp(Math.round((progress ?? 0) * segments), 0, segments);
    /* Cells latch. Within one attempt they never un-fill. */
    if (target <= latchedRef.current) return;
    if (reduceMotion) {
      commit(target);
      return;
    }

    const handle = setInterval(() => {
      const next = latchedRef.current + 1;
      commit(next);
      if (next >= target) clearInterval(handle);
    }, LATCH_MS);
    return () => clearInterval(handle);
  }, [indeterminate, progress, reduceMotion, segments, tone]);

  useEffect(() => {
    if (!indeterminate || reduceMotion) return;
    sweep.setValue(0);
    const pass = Animated.timing(sweep, {
      toValue: 1,
      duration: SWEEP_MS,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    });
    const animation =
      sweepDelay > 0
        ? Animated.sequence([Animated.delay(sweepDelay), Animated.loop(pass)])
        : Animated.loop(pass);
    animation.start();
    return () => animation.stop();
  }, [indeterminate, reduceMotion, sweep, sweepDelay]);

  useEffect(() => {
    const previous = previousTone.current;
    previousTone.current = tone;
    /* Only the transition into `ok` flashes — a bar mounted already-connected
       stays quiet. */
    if (tone !== "ok" || previous === "ok" || reduceMotion) return;
    flash.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(flash, {
        toValue: 1,
        duration: FLASH_IN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(flash, {
        toValue: 0,
        duration: FLASH_OUT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [flash, reduceMotion, tone]);

  /* One value, quantised to the cell pitch: the band jumps cell to cell rather
     than sliding between them, which is what keeps the bar reading as discrete
     hardware segments. Positions run from fully off-left to fully off-right so
     the loop restarts out of frame. */
  const sweepX = useMemo(() => {
    if (pitch <= 0) return null;
    const stops = segments + band + 1;
    const inputRange: number[] = [];
    const outputRange: number[] = [];
    for (let stop = 0; stop < stops; stop++) {
      const offset = (stop - band) * pitch;
      inputRange.push(stop / stops, (stop + 1) / stops - STEP_EPSILON);
      outputRange.push(offset, offset);
    }
    inputRange.push(1);
    outputRange.push(segments * pitch);
    return sweep.interpolate({ inputRange, outputRange });
  }, [band, pitch, segments, sweep]);

  const fill = tone === "error" ? colors.destructive : colors.fg;
  const showSweep = indeterminate && !reduceMotion && sweepX !== null;
  /* The flash layer only exists in the `ok` state, so the extra cells are not
     carried for the whole wait. */
  const showFlash = tone === "ok" && !reduceMotion;

  const handleLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setWidth((previous) => (previous === measured ? previous : measured));
  };

  const cellStyle = (index: number, background: string) => [
    styles.cell,
    {
      width: cellWidth,
      marginRight: index === segments - 1 ? 0 : CELL_GAP,
      backgroundColor: background,
    },
  ];

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={handleLayout}
      style={[styles.track, style]}
    >
      {width > 0
        ? indices.map((index) => (
            <View key={index} style={cellStyle(index, index < latched ? fill : colors.bgInset)} />
          ))
        : null}

      {showSweep ? (
        <Animated.View
          style={[
            styles.overlay,
            { width: band * pitch - CELL_GAP, transform: [{ translateX: sweepX }] },
          ]}
        >
          {bandIndices.map((index) => (
            <View
              key={index}
              style={[
                styles.cell,
                {
                  width: cellWidth,
                  marginRight: index === band - 1 ? 0 : CELL_GAP,
                  backgroundColor: colors.fg,
                },
              ]}
            />
          ))}
        </Animated.View>
      ) : null}

      {showFlash ? (
        <Animated.View style={[styles.overlay, styles.overlayFull, { opacity: flash }]}>
          {indices.map((index) => (
            <View key={index} style={cellStyle(index, colors.forest)} />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

export interface MeterRowProps {
  /** Channel name. Rendered uppercase in the fixed label column. */
  label: string;
  /** Real measurement, e.g. `240ms`. Omit and the row prints an em-dash. */
  readout?: string;
  /** Spoken form of the readout, e.g. `240 milliseconds`. */
  readoutLabel?: string;
  /** Spoken state word. Derived from `tone`/`progress` when omitted. */
  status?: string;
  progress?: number;
  segments?: number;
  tone?: MeterTone;
  /** Width of the label column. Keep identical across stacked rows. */
  labelWidth?: number;
  sweepDelay?: number;
  /** Slot under the bar, indented to the bar column — the retry lives here. */
  footer?: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function defaultStatus(tone: MeterTone, progress?: number): string {
  if (tone === "ok") return "connected";
  if (tone === "error") return "failed";
  if (progress !== undefined) return `connecting, ${Math.round(clamp(progress, 0, 1) * 100)} percent`;
  return "connecting";
}

/**
 * One channel: label column, bar, readout. This is the accessible unit — the
 * whole row is a single `progressbar` element with its own label.
 */
export function MeterRow({
  label,
  readout,
  readoutLabel,
  status,
  progress,
  segments,
  tone = "default",
  labelWidth = LABEL_WIDTH,
  sweepDelay,
  footer,
  accessibilityLabel,
  style,
}: MeterRowProps) {
  const styles = useStyles();
  const colors = useThemeColors();

  const pending = readout === undefined || readout.length === 0;
  /* A failed channel reports no value at all — the bar fills brick, but it did
     not reach 100%, and announcing that it did would be a lie. */
  const percent =
    tone === "ok"
      ? 100
      : tone === "error" || progress === undefined
        ? undefined
        : Math.round(clamp(progress, 0, 1) * 100);
  const spoken = `${label}, ${status ?? defaultStatus(tone, progress)}, ${
    pending ? "latency unknown" : (readoutLabel ?? readout)
  }`;

  return (
    <View style={style}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel ?? spoken}
        accessibilityValue={percent === undefined ? undefined : { min: 0, max: 100, now: percent }}
        style={styles.row}
      >
        <Text numberOfLines={1} style={[styles.rowLabel, { width: labelWidth }]}>
          {label}
        </Text>
        <View style={styles.rowBar}>
          <SegmentBar segments={segments} progress={progress} tone={tone} sweepDelay={sweepDelay} />
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.readout,
            pending ? styles.readoutPending : null,
            tone === "error" ? { color: colors.destructive } : null,
          ]}
        >
          {pending ? READOUT_PLACEHOLDER : readout}
        </Text>
      </View>
      {/* Indented to the bar's left edge so the retry reads as belonging to
          this channel and not to the block. */}
      {footer ? <View style={[styles.rowFooter, { marginLeft: labelWidth }]}>{footer}</View> : null}
    </View>
  );
}

export interface MeterChannel {
  /** Stable key. */
  id: string;
  label: string;
  readout?: string;
  readoutLabel?: string;
  status?: string;
  progress?: number;
  tone?: MeterTone;
  /** Present on a failed channel: renders the inline retry. */
  onRetry?: () => void;
  retryLabel?: string;
}

export interface ChannelStatusProps {
  /** One plain sentence: "Connecting to alphanet". */
  phase: string;
  /** Endpoint host. Truncated in the middle so both ends stay readable. */
  caption?: string;
  channels: readonly MeterChannel[];
  segments?: number;
  labelWidth?: number;
  /**
   * Opt-in brand beat: a square `BrandTile` above the phase line, on the same
   * gutter as everything else. Off by default so the meter can be judged on
   * its own.
   */
  mark?: boolean;
  /** Extra slot below the caption. */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Phase sentence. Re-mounted by key on change, so the fade replays. */
function PhaseLine({ children, reduceMotion }: { children: string; reduceMotion: boolean }) {
  const styles = useStyles();
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: PHASE_ENTER_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enter, reduceMotion]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [4, 0] });

  return (
    <Animated.Text
      accessibilityLiveRegion="polite"
      style={[styles.phase, { opacity: enter, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.Text>
  );
}

/** Phase line, N aligned `MeterRow`s, endpoint caption, retry slot. */
export function ChannelStatus({
  phase,
  caption,
  channels,
  segments,
  labelWidth = LABEL_WIDTH,
  mark,
  footer,
  style,
}: ChannelStatusProps) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();

  return (
    <View style={[styles.status, style]}>
      {/* Decorative: the phase line already names the product, so repeating it
          to VoiceOver would be noise. */}
      {mark ? (
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.mark}
        >
          <BrandTile size={MARK_SIZE} radius={0} />
        </View>
      ) : null}

      <PhaseLine key={phase} reduceMotion={reduceMotion}>
        {phase}
      </PhaseLine>

      <View style={styles.rows}>
        {channels.map((channel, index) => (
          <MeterRow
            key={channel.id}
            label={channel.label}
            readout={channel.readout}
            readoutLabel={channel.readoutLabel}
            status={channel.status}
            progress={channel.progress}
            tone={channel.tone}
            segments={segments}
            labelWidth={labelWidth}
            /* Staggered so two waiting channels read as two independent links
               rather than one wide object. */
            sweepDelay={index * SWEEP_STAGGER_MS}
            footer={
              channel.onRetry ? (
                <Button
                  label={channel.retryLabel ?? "Retry"}
                  onPress={channel.onRetry}
                  variant="outline"
                  size="sm"
                />
              ) : null
            }
          />
        ))}
      </View>

      {caption ? (
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.caption}>
          {caption}
        </Text>
      ) : null}
      {footer}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  track: {
    height: CELL_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderRadius: 0,
  },
  cell: {
    height: CELL_HEIGHT,
    borderRadius: 0,
  },
  overlay: {
    position: "absolute",
    left: 0,
    top: 0,
    flexDirection: "row",
  },
  overlayFull: {
    right: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: space[5],
  },
  rowLabel: {
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: c.fgSubtle,
  },
  rowBar: {
    flex: 1,
    marginRight: touch.gutter,
  },
  readout: {
    width: READOUT_WIDTH,
    textAlign: "right",
    /* Medium once there is a real number to show — same advance width as the
       regular cut, so nothing shifts when the placeholder resolves. */
    fontFamily: font.monoMedium,
    fontSize: text.sm,
    color: c.fgMuted,
  },
  readoutPending: {
    fontFamily: font.mono,
    color: c.fgSubtle,
  },
  rowFooter: {
    alignSelf: "flex-start",
    marginTop: space[3],
  },
  status: {
    paddingHorizontal: touch.screenX,
  },
  mark: {
    alignSelf: "flex-start",
    marginBottom: space[5],
  },
  phase: {
    fontFamily: font.sans,
    fontSize: text.md,
    lineHeight: 24,
    color: c.fg,
  },
  rows: {
    marginTop: space[5],
    gap: space[4],
  },
  caption: {
    marginTop: space[5],
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 0.4,
    color: c.fgSubtle,
  },
}));
