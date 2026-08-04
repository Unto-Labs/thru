/**
 * "Mark Draw-On" loading direction — restraint over telemetry.
 *
 * Leans on kit primitives throughout — tokens, theming, `Button`, the wings
 * path — and keeps the kit's peer-dep discipline: RN `Animated` only, never
 * reanimated.
 *
 * The Thru wings glyph strokes itself on over 900ms and then cross-fades from a
 * hairline outline to a solid fill. One sentence of Inter Tight sits under it.
 * Nothing else is on screen until the wait misbehaves: at 2.4s a thin accent
 * arc starts orbiting the mark, and at 8s the copy admits the delay and offers
 * a retry. The escalation ladder is the whole idea — a splash that stays quiet
 * when things are normal and only spends pixels when it owes the user one.
 *
 * Animation drivers are split deliberately:
 *   - transforms and View opacity run on the native driver;
 *   - `strokeDashoffset`, `strokeOpacity` and `fillOpacity` are SVG attributes,
 *     which the native driver cannot touch, so the draw and the stroke-to-fill
 *     cross-fade run with `useNativeDriver: false` on an animated `Path`.
 * Those are separate `Animated.Value`s on purpose: a single value may never be
 * shared between a native-driven and a JS-driven animation.
 *
 * The resting state is the monochrome `WINGS_MARK_PATH` in the theme
 * foreground, not the red `BrandTile` lockup. The stroke-to-fill cross-fade
 * only reads as "the mark solidifying" if the thing that fills in is the same
 * silhouette that was just drawn; a rounded red tile introduces a shape nobody
 * drew and inverts the glyph from dark-on-background to a light knockout mid
 * transition. The tile is also the iOS launch image the user saw a moment
 * earlier, so repeating it here spends the brand hit twice.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { font, space, text } from '../tokens';
import { makeStyles, useThemeColors } from '../theme';
import { Button } from '../Button';
import {
  WINGS_MARK_PATH,
  WINGS_MARK_TRIM_ASPECT,
  WINGS_MARK_TRIM_VIEW_BOX,
} from '../BrandTile';

/* Motion ladder, in ms. */
const DRAW_MS = 900;
const FILL_MS = 220;
const HANDOFF_MS = 200;
const ORBIT_PERIOD_MS = 1200;
const ORBIT_AFTER_MS = 2400;
const ESCALATE_AFTER_MS = 8000;
/* Anything that fades purely to acknowledge a state change. */
const REVEAL_MS = 200;

/* Hairline weights, in pt. */
const MARK_STROKE_PT = 1.5;
const ORBIT_STROKE_PT = 2;

/* The orbit has to clear the glyph. Flattening WINGS_MARK_PATH puts its true
   circumscribed radius at 54.8pt for an 88pt mark — well inside the 59.2pt
   bounding-box half-diagonal, because the wings do not reach their box's
   corners. A 120pt orbit gives a 59pt arc radius, so 4.2pt of air. Reserving
   the box up front means the arc's arrival at 2.4s costs no layout shift. */
const ORBIT_SIZE = 120;
const MARK_SIZE = 88;

/* The glyph's height in viewBox user units, read off the TRIMMED box (332.46,
   not the tile's 400) so the pt-to-user-unit conversion below still yields a
   true 1.5pt hairline, and so this survives a change to the brand asset. */
const VIEW_BOX_HEIGHT = Number(WINGS_MARK_TRIM_VIEW_BOX.split(' ')[3]);

/* react-native-svg exposes no getTotalLength() on iOS, so the dash length is a
   measured constant rather than something we can ask the renderer for.
   WINGS_MARK_PATH is 11 subpaths totalling 4192.9 user units, the longest of
   which is 853.7 and the second 836.6 — the two wings, which is why this mark
   draws coherently: 40% of the ink is in two near-equal strokes that finish
   together at the very end. Both rasterisers under react-native-svg restart the
   dash pattern at every subpath (CoreGraphics inherits PostScript `setdash`
   semantics; Skia restarts per contour), so the number that governs the reveal
   is the longest subpath, not the sum. 880 clears it with ~3% headroom: the
   glyph is completely unpainted at offset 880 and completely painted by offset
   ~26, i.e. the reveal uses 97% of the 900ms and leaves no dead tail. Using the
   4193 sum instead would finish the draw a quarter of the way in and then hold
   a static mark for 675ms. This constant is specific to this path — it was 560
   for the dove in BrandMark.tsx and does not carry over. */
const MARK_DASH = 880;
const MARK_DASH_ARRAY = [MARK_DASH, MARK_DASH];

const SLOW_COPY = 'This is taking longer than usual';
const RETRY_LABEL = 'Try again';

/* strokeDashoffset / strokeOpacity / fillOpacity are SVG attributes, not view
   styles, so this component is animated with useNativeDriver: false. */
const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * Tracks the OS "Reduce Motion" switch. Local to this file on purpose: it is a
 * generic name, and this prototype is deliberately self-contained.
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
        /* Treat an unavailable a11y bridge as "motion is fine". */
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}

export interface MarkDrawProps {
  /** Height in pt; width follows WINGS_MARK_TRIM_ASPECT. */
  size?: number;
  /** Defaults to the theme foreground, so the mark inverts for free. */
  color?: string;
  /**
   * Play the draw-on. Pass `false` for a mark that is simply present — the same
   * rendering reduce-motion forces regardless of this prop.
   */
  drawing?: boolean;
}

/**
 * The logomark stroking itself on and then filling. The outline and the fill
 * are two stacked copies of the same path; the draw runs the dash offset down
 * to zero, then the fill rises as the stroke retires and the mark settles from
 * 0.98 to 1.0.
 */
export function MarkDraw({ size = MARK_SIZE, color, drawing = true }: MarkDrawProps) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const tint = color ?? colors.fg;
  const animate = drawing && !reduceMotion;

  /* JS-driven: both feed SVG attributes. */
  const [draw] = useState(() => new Animated.Value(0));
  const [fill] = useState(() => new Animated.Value(0));
  /* Native-driven: feeds a transform. */
  const [settle] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!animate) {
      /* Jump to the resting state: no stroke, full fill, no scale. */
      draw.setValue(1);
      fill.setValue(1);
      settle.setValue(1);
      return;
    }

    draw.setValue(0);
    fill.setValue(0);
    settle.setValue(0);

    const animation = Animated.parallel([
      Animated.timing(draw, {
        toValue: 1,
        duration: DRAW_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.delay(DRAW_MS),
        Animated.timing(fill, {
          toValue: 1,
          duration: FILL_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
      Animated.sequence([
        Animated.delay(DRAW_MS),
        Animated.timing(settle, {
          toValue: 1,
          duration: FILL_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start();
    return () => animation.stop();
  }, [animate, draw, fill, settle]);

  /* 1.5pt expressed in viewBox units, so the hairline reads as 1.5pt at any
     rendered size instead of scaling with the mark. */
  const strokeWidth = (MARK_STROKE_PT * VIEW_BOX_HEIGHT) / size;

  const strokeDashoffset = draw.interpolate({
    inputRange: [0, 1],
    outputRange: [MARK_DASH, 0],
  });
  const strokeOpacity = fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const scale = settle.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] });

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ transform: [{ scale }] }}
    >
      {/* Trimmed box: the wings sit low and right inside their 400 tile, so the
          full box would centre the padding rather than the glyph. */}
      <Svg
        width={size * WINGS_MARK_TRIM_ASPECT}
        height={size}
        viewBox={WINGS_MARK_TRIM_VIEW_BOX}
        fill="none"
      >
        <AnimatedPath d={WINGS_MARK_PATH} fill={tint} fillOpacity={fill} stroke="none" />
        <AnimatedPath
          d={WINGS_MARK_PATH}
          fill="none"
          stroke={tint}
          strokeWidth={strokeWidth}
          /* Butt caps: a square or round cap can paint a dot for a zero-length
             dash, which would leave the mark faintly visible at offset 880. */
          strokeLinecap="butt"
          strokeDasharray={MARK_DASH_ARRAY}
          strokeDashoffset={strokeDashoffset}
          strokeOpacity={strokeOpacity}
        />
      </Svg>
    </Animated.View>
  );
}

export interface SpinnerProps {
  /** Outer diameter in pt. */
  size?: number;
  /** Defaults to the theme accent. */
  color?: string;
}

/**
 * A 90-degree accent arc orbiting once every 1200ms, built as a Thru-shaped
 * stand-in for the platform `ActivityIndicator`. Prototype-local, so it is not
 * a general-purpose kit spinner today.
 * The sweep is a static dash pattern on a circle and the revolution is a
 * native-driven rotation, so nothing crosses the bridge per frame. Honours
 * reduce motion by holding the arc still.
 */
export function Spinner({ size = 20, color }: SpinnerProps) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const styles = useStyles();
  const tint = color ?? colors.accent;
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: ORBIT_PERIOD_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);

  /* Inset by half the stroke so the arc sits inside the declared box. */
  const radius = (size - ORBIT_STROKE_PT) / 2;
  const circumference = 2 * Math.PI * radius;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.orbit, { width: size, height: size, transform: [{ rotate }] }]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={tint}
          strokeWidth={ORBIT_STROKE_PT}
          strokeLinecap="butt"
          /* A quarter on, a full circumference off: the gap outlasts the
             contour, so exactly one arc exists no matter the radius. */
          strokeDasharray={[circumference / 4, circumference]}
        />
      </Svg>
    </Animated.View>
  );
}

export interface SplashStateProps {
  /** The one reassuring sentence. Sentence case, one line, never two. */
  copy: string;
  /** Omit to suppress the retry affordance entirely. */
  onRetry?: () => void;
  /** Runs the handoff: the mark scales to 1.04 and fades over 200ms. */
  handoff?: boolean;
  /** Escape hatch for prototypes and tests; the default is the spec's 2.4s. */
  orbitAfterMs?: number;
  /** Escape hatch for prototypes and tests; the default is the spec's 8.0s. */
  escalateAfterMs?: number;
}

/**
 * The whole direction: mark, copy, and the escalation ladder. The ladder is
 * scheduled from mount, so a caller that needs to restart it (after a retry,
 * say) should remount with a fresh `key`.
 */
export function SplashState({
  copy,
  onRetry,
  handoff = false,
  orbitAfterMs = ORBIT_AFTER_MS,
  escalateAfterMs = ESCALATE_AFTER_MS,
}: SplashStateProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const [orbiting, setOrbiting] = useState(false);
  const [escalated, setEscalated] = useState(false);

  /* All three are native-driven: View opacity and transforms only. */
  const [orbitIn] = useState(() => new Animated.Value(0));
  const [retryIn] = useState(() => new Animated.Value(0));
  const [exit] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const timers = [
      setTimeout(() => setOrbiting(true), orbitAfterMs),
      setTimeout(() => setEscalated(true), escalateAfterMs),
    ];
    return () => timers.forEach(clearTimeout);
  }, [orbitAfterMs, escalateAfterMs]);

  useEffect(() => {
    if (!orbiting) return;
    if (reduceMotion) {
      /* No orbit at all under reduce motion; only the copy swap survives. */
      orbitIn.setValue(0);
      return;
    }
    const animation = Animated.timing(orbitIn, {
      toValue: 1,
      duration: REVEAL_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [orbiting, reduceMotion, orbitIn]);

  useEffect(() => {
    if (!escalated || !onRetry) return;
    if (reduceMotion) {
      retryIn.setValue(1);
      return;
    }
    const animation = Animated.timing(retryIn, {
      toValue: 1,
      duration: REVEAL_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [escalated, onRetry, reduceMotion, retryIn]);

  useEffect(() => {
    if (!handoff) {
      exit.setValue(0);
      return;
    }
    if (reduceMotion) {
      exit.setValue(1);
      return;
    }
    const animation = Animated.timing(exit, {
      toValue: 1,
      duration: HANDOFF_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [handoff, reduceMotion, exit]);

  const line = escalated ? SLOW_COPY : copy;
  const exitOpacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const exitScale = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <View style={styles.root}>
      <Animated.View
        style={[styles.stack, { opacity: exitOpacity, transform: [{ scale: exitScale }] }]}
      >
        {/* One accessible node for the whole indeterminate wait; the retry
            button stays outside it so VoiceOver can still reach it. */}
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={line}
          accessibilityLiveRegion="polite"
          style={styles.stack}
        >
          <View style={styles.markBox}>
            <MarkDraw size={MARK_SIZE} />
            {orbiting && !reduceMotion ? (
              <Animated.View style={[styles.orbitLayer, { opacity: orbitIn }]}>
                <Spinner size={ORBIT_SIZE} color={colors.accent} />
              </Animated.View>
            ) : null}
          </View>
          <Text style={styles.copy} numberOfLines={1}>
            {line}
          </Text>
        </View>

        {escalated && onRetry ? (
          <Animated.View style={[styles.retry, { opacity: retryIn }]}>
            <Button label={RETRY_LABEL} onPress={onRetry} variant="outline" size="sm" />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bg,
    paddingHorizontal: space[4],
  },
  stack: { alignItems: 'center' },
  markBox: {
    width: ORBIT_SIZE,
    height: ORBIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitLayer: { position: 'absolute' },
  copy: {
    /* The orbit box already contributes 16pt of air below the 88pt mark, so
       8 + 16 lands the spec's 24pt optical gap. */
    marginTop: space[2],
    fontFamily: font.sans,
    fontSize: text.md,
    color: c.fgMuted,
    textAlign: 'center',
  },
  retry: { marginTop: space[5] },
  orbit: { alignItems: 'center', justifyContent: 'center' },
}));
