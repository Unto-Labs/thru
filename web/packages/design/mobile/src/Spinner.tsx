/*
 * The turn is a CSS animation on the web, as ActivityIndicator's is, so it
 * keeps turning while the JS thread is busy; natively it is a native-driven
 * loop. Under Reduce Motion, only its opacity pulses.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useReduceMotion } from "./reduceMotion";
import { useThemeColors } from "./theme";

const IS_WEB = Platform.OS === "web";
const ORBIT_PERIOD_MS = 1200;
const ORBIT_STROKE_PT = 2;

/** The kit's one loading pulse on `opacity`: 1 to 0.55 and back. */
export function pulseLoop(opacity: Animated.Value): Animated.CompositeAnimation {
  return Animated.loop(
    Animated.sequence([
      Animated.timing(opacity, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]),
  );
}

/* Non-spatial loading feedback, including under reduced motion. */
export function usePulse(enabled = true): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!enabled) return;
    const loop = pulseLoop(opacity);
    loop.start();
    return () => {
      loop.stop();
      opacity.setValue(1);
    };
  }, [enabled, opacity]);
  return opacity;
}

export interface SpinnerProps {
  /** Outer diameter in pt. */
  size?: number;
  /** Defaults to the theme accent. */
  color?: string;
}

export function Spinner({ size = 20, color }: SpinnerProps) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const pulse = usePulse(reduceMotion);
  const tint = color ?? colors.accent;
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (IS_WEB || reduceMotion) {
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
  const turn = reduceMotion
    ? { opacity: pulse }
    : IS_WEB
      ? styles.webTurn
      : { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] };

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.orbit, { width: size, height: size }, turn]}
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

const styles = StyleSheet.create({
  orbit: { alignItems: "center", justifyContent: "center" },
  /* react-native-web turns these into an @keyframes rule. */
  webTurn: {
    animationKeyframes: [{ "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } }],
    animationDuration: `${ORBIT_PERIOD_MS}ms`,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  } as unknown as ViewStyle,
});
