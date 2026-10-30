/* An `Animated.Value` may never be shared between a native-driven and a
   JS-driven animation, so each driver gets its own values. */
import { useEffect, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { font, space, text } from '../tokens';
import { useReduceMotion } from '../reduceMotion';
import { makeStyles, useThemeColors } from '../theme';
import { Button } from '../Button';
import { Spinner } from '../Spinner';

/* Re-exported so the kit's index and existing imports keep their path. */
export { Spinner, type SpinnerProps } from '../Spinner';
import {
  WINGS_MARK_PATH,
  WINGS_MARK_TRIM_ASPECT,
  WINGS_MARK_TRIM_VIEW_BOX,
} from '../BrandTile';

const DRAW_MS = 900;
const FILL_MS = 220;
const HANDOFF_MS = 200;
const ORBIT_AFTER_MS = 2400;
const ESCALATE_AFTER_MS = 8000;
const REVEAL_MS = 200;

const MARK_STROKE_PT = 1.5;

/* Clears the glyph's 54.8pt circumscribed radius at an 88pt mark. */
const ORBIT_SIZE = 120;
const MARK_SIZE = 88;

const VIEW_BOX_HEIGHT = Number(WINGS_MARK_TRIM_VIEW_BOX.split(' ')[3]);

/* react-native-svg has no getTotalLength() on iOS, so this is measured. Both
   rasterisers (CoreGraphics, Skia) restart the dash at every subpath, so it
   covers the longest subpath of WINGS_MARK_PATH (853.7), not the sum. */
const MARK_DASH = 880;
const MARK_DASH_ARRAY = [MARK_DASH, MARK_DASH];

const SLOW_COPY = 'This is taking longer than usual';
const RETRY_LABEL = 'Try again';

/* strokeDashoffset / strokeOpacity / fillOpacity are SVG attributes, not view
   styles, so this component is animated with useNativeDriver: false. */
const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface MarkDrawProps {
  /** Height in pt; width follows WINGS_MARK_TRIM_ASPECT. */
  size?: number;
  /** Defaults to the theme foreground. */
  color?: string;
  /**
   * Play the draw-on. Pass `false` for a mark that is simply present — the same
   * rendering reduce-motion forces regardless of this prop.
   */
  drawing?: boolean;
}

/** The logomark stroking itself on, then filling. */
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

  /* In viewBox units, so the hairline does not scale with the mark. */
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
          /* A square or round cap paints a dot for a zero-length dash. */
          strokeLinecap="butt"
          strokeDasharray={MARK_DASH_ARRAY}
          strokeDashoffset={strokeDashoffset}
          strokeOpacity={strokeOpacity}
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
  /** Defaults to 2400ms. */
  orbitAfterMs?: number;
  /** Defaults to 8000ms. */
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
        {/* The retry stays outside this accessible node so VoiceOver can
            reach it. */}
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
    marginTop: space[2],
    fontFamily: font.sans,
    fontSize: text.md,
    color: c.fgMuted,
    textAlign: 'center',
  },
  retry: { marginTop: space[5] },
}));
