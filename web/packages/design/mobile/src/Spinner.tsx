/**
 * The kit's spinner: a 90-degree arc orbiting once every 1200 ms, a
 * Thru-shaped stand-in for the platform `ActivityIndicator`. Every loading
 * state uses it, buttons included, so the app has one spinner at one pace.
 * 1.2 s sits where the platforms' do: about 1 s on iOS, 1.33 s in Material;
 * react-native-web's ActivityIndicator turns in 0.75 s.
 *
 * The sweep is a static dash pattern on a circle. The turn is a CSS animation
 * on the web, as ActivityIndicator's is, so it keeps turning while the
 * JS thread is busy (a button's work usually keeps it busy); natively it is
 * a native-driven loop. Holds the arc still under Reduce Motion.
 */
import { useEffect, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useReduceMotion } from "./motion";
import { useThemeColors } from "./theme";

const IS_WEB = Platform.OS === "web";
const ORBIT_PERIOD_MS = 1200;
const ORBIT_STROKE_PT = 2;

export interface SpinnerProps {
  /** Outer diameter in pt. */
  size?: number;
  /** Defaults to the theme accent. */
  color?: string;
}

export function Spinner({ size = 20, color }: SpinnerProps) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
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
  const turn = IS_WEB
    ? reduceMotion
      ? null
      : styles.webTurn
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
