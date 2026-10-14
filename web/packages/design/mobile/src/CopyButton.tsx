/**
 * The copy button: a 44 square with a 1pt strong border, the copy glyph at
 * 18 in `fgMuted`. After a copy the glyph cross-fades to a forest check, and
 * back when `copied` clears; the label says what was copied. The caller owns
 * the clipboard and how long `copied` stays true. Settings' wallet address
 * and every copyable `MetaTable` row draw this one.
 *
 * Motion is RN `Animated` (the kit has no reanimated): the check fades in
 * over 160ms and the glyph out over 120ms, as the app's small icon swaps do.
 * With Reduce Motion on, the swap is instant.
 */

import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { IconCheck, IconCopy } from "./Icons";
import { useReduceMotion } from "./motion";

const FADE_IN_MS = 160;
const FADE_OUT_MS = 120;

export interface CopyButtonProps {
  /** Whether the check is showing. */
  copied: boolean;
  onPress: () => void;
  /** "Copy wallet address". */
  accessibilityLabel: string;
  /** "Wallet address copied"; "Copied" when left out. */
  copiedLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function CopyButton({
  copied,
  onPress,
  accessibilityLabel,
  copiedLabel = "Copied",
  disabled = false,
  style,
}: CopyButtonProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const progress = useRef(new Animated.Value(copied ? 1 : 0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    const to = copied ? 1 : 0;
    if (reduceMotion) {
      progress.setValue(to);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: to,
      duration: copied ? FADE_IN_MS : FADE_OUT_MS,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [copied, progress, reduceMotion]);

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={copied ? copiedLabel : accessibilityLabel}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null, style]}
    >
      <Animated.View style={[styles.layer, { opacity: Animated.subtract(1, progress) }]}>
        <IconCopy color={colors.fgMuted} />
      </Animated.View>
      <Animated.View style={[styles.layer, { opacity: progress }]}>
        <IconCheck color={colors.forest} />
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  button: {
    alignItems: "center",
    borderColor: c.borderStrong,
    borderWidth: 1,
    height: touch.hitMin,
    justifyContent: "center",
    width: touch.hitMin,
  },
  pressed: { backgroundColor: c.bgMuted },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
}));
