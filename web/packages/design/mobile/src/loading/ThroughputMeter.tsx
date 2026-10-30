import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { font, space, text, touch } from "../tokens";
import { useReduceMotion } from "../reduceMotion";
import { makeStyles, useThemeColors } from "../theme";
import { Button } from "../Button";
import { BrandTile } from "../BrandTile";

/* mobile/tsconfig.json has `types: []` and no DOM lib, so RN's timer globals
   are not in scope. */
declare function setInterval(handler: () => void, ms: number): number;
declare function clearInterval(handle: number): void;

const DEFAULT_SEGMENTS = 24;
const DEFAULT_BAND = 5;
const CELL_GAP = 1;
const CELL_HEIGHT = 6;
const SWEEP_MS = 1100;
const LATCH_MS = 40;
const FLASH_IN_MS = 80;
const FLASH_OUT_MS = 160;
const REDUCED_FILL = 0.3;
const LABEL_WIDTH = 72;
const READOUT_WIDTH = 80;
const READOUT_PLACEHOLDER = "——";
const PHASE_ENTER_MS = 220;
const SWEEP_STAGGER_MS = 140;
const MARK_SIZE = 44;
/* Interpolation input ranges must be strictly increasing, so each step of the
   quantised sweep is a near-vertical ramp rather than a true discontinuity. */
const STEP_EPSILON = 0.0001;

export type MeterTone = "default" | "ok" | "error";

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
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

    /* Indeterminate also resets the bar for a fresh attempt. */
    if (indeterminate) {
      commit(reduceMotion ? Math.round(segments * REDUCED_FILL) : 0);
      return;
    }

    if (tone !== "default") {
      commit(segments);
      return;
    }

    const target = clamp(Math.round((progress ?? 0) * segments), 0, segments);
    /* Cells never un-fill within one attempt. */
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
  /* A failed bar fills but did not reach 100%, so it announces no value. */
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
  /** Show a square `BrandTile` above the phase line. */
  mark?: boolean;
  /** Extra slot below the caption. */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Re-mounted by key on change so the fade replays. */
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
