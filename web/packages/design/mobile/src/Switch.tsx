import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useReduceMotion } from "./reduceMotion";
import { makeStyles, useThemeColors } from "./theme";
import { font, radius, space, text, touch } from "./tokens";

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}

export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: SwitchProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(value ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 120,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, value]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      aria-checked={value}
      disabled={disabled}
      onPress={(event) => {
        event.stopPropagation();
        onValueChange(!value);
      }}
      style={[styles.target, disabled ? { opacity: 0.5 } : null]}
    >
      <View
        style={[styles.track, { backgroundColor: value ? colors.fg : colors.borderStrong }]}
      >
        <Animated.View
          style={[
            styles.thumb,
            {
              /* The on track is fg, white in dark, so the thumb inverts with it. */
              backgroundColor: value ? colors.bg : colors.onBrand,
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, space[4]],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

export interface SwitchRowProps {
  title: string;
  /** Help text under the title; it wraps. */
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A settings row: title and help text on the left, a Switch on the right.
    The whole row toggles; the Switch carries the name for assistive tech. */
export function SwitchRow({ title, subtitle, value, onValueChange, disabled = false, style }: SwitchRowProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessible={false}
      disabled={disabled}
      focusable={false}
      onPress={() => onValueChange(!value)}
      style={[styles.row, style]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Switch accessibilityLabel={title} disabled={disabled} onValueChange={onValueChange} value={value} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
    minHeight: touch.cellH,
    paddingHorizontal: touch.screenX,
    paddingVertical: space[2],
  },
  copy: { flex: 1, gap: 2 },
  title: { color: c.fg, fontFamily: font.sansMedium, fontSize: text.base },
  subtitle: { color: c.fgMuted, fontFamily: font.sans, fontSize: text.sm, lineHeight: 20 },
  target: {
    minWidth: touch.hitMin,
    minHeight: touch.hitMin,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    width: space[7],
    height: space[5],
    borderRadius: radius.pill,
    justifyContent: "center",
    paddingHorizontal: space[1],
  },
  thumb: {
    width: space[4],
    height: space[4],
    borderRadius: radius.pill,
  },
}));
