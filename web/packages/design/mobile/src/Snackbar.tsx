/**
 * The kit's snackbar: a short confirmation on the inverse surface - a 3 pt
 * bar down its left edge in the tone's colour, a tinted glyph disc, a mono
 * caps title over a line of detail, a dismiss button, and a 2 pt bar along
 * the bottom that runs out over its time on screen. It fades in over 200 ms
 * and dismisses itself when the bar runs out.
 *
 * Where it sits is the caller's: the kit's reference floats it 12 pt in from
 * the sides above the tab bar.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { font, palette, space, text } from "./tokens";
import { makeStyles, useTheme } from "./theme";
import { IconClose } from "./Icons";

export type SnackbarTone = "success" | "error" | "info" | "warn";

/* Each tone's colour on the dark surface, then on the light one (the inverse
   surface is light in the dark theme), and its glyph. */
const TONES: Record<SnackbarTone, { onDark: string; onLight: string; glyph: string }> = {
  success: { onDark: palette.forest[300], onLight: palette.forest[400], glyph: "M20 6 9 17l-5-5" },
  error: { onDark: palette.brick[300], onLight: palette.brick[400], glyph: "M18 6 6 18M6 6l12 12" },
  info: { onDark: palette.ocean[300], onLight: palette.ocean[400], glyph: "M12 8h.01M12 11v5" },
  warn: {
    onDark: palette.saffron[400],
    onLight: palette.saffron[400],
    glyph: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  },
};

/** How long a snackbar stays up by default. */
export const SNACKBAR_DURATION_MS = 4200;

export function Snackbar({
  tone,
  title,
  message,
  durationMs = SNACKBAR_DURATION_MS,
  onDismiss,
}: {
  tone: SnackbarTone;
  /** Set in mono caps: "ADDED". */
  title: string;
  message?: string;
  durationMs?: number;
  /** The dismiss button, or the bar running out. */
  onDismiss: () => void;
}) {
  const styles = useStyles();
  const { isDark } = useTheme();
  const toneColor = isDark ? TONES[tone].onLight : TONES[tone].onDark;
  const fade = useRef(new Animated.Value(0)).current;
  const remaining = useRef(new Animated.Value(1)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 200,
      easing: Easing.bezier(0, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();
    const run = Animated.timing(remaining, {
      toValue: 0,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished) dismissRef.current();
    });
    return () => run.stop();
  }, [durationMs, fade, remaining]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.snackbar, { borderLeftColor: toneColor, opacity: fade }]}
    >
      <View style={[styles.glyph, { backgroundColor: `${toneColor}33` }]}>
        <Svg fill="none" height={12} viewBox="0 0 24 24" width={12}>
          <Path d={TONES[tone].glyph} stroke={toneColor} strokeLinecap="square" strokeWidth={2} />
        </Svg>
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {message ? (
          <Text style={[styles.message, { color: isDark ? palette.stone[600] : palette.stone[300] }]}>
            {message}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel="Dismiss"
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => dismissRef.current()}
        style={styles.dismiss}
      >
        <IconClose size={12} color={palette.stone[400]} />
      </Pressable>
      <Animated.View
        style={[
          styles.bar,
          { backgroundColor: toneColor, transform: [{ scaleX: remaining }] },
        ]}
      />
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  snackbar: {
    alignItems: "flex-start",
    backgroundColor: c.bgInverse,
    borderLeftWidth: 3,
    boxShadow: `0 20px 48px ${c.sheetShadow}`,
    flexDirection: "row",
    gap: space[3],
    overflow: "hidden",
    paddingBottom: 13,
    paddingLeft: 14,
    paddingRight: 34,
    paddingTop: space[3],
  } as never,
  glyph: {
    alignItems: "center",
    borderRadius: 11,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  copy: { flex: 1, minWidth: 0 },
  title: {
    color: c.fgInverse,
    fontFamily: font.mono,
    fontSize: text.xs,
    letterSpacing: 0.48,
    textTransform: "uppercase",
  },
  message: { fontFamily: font.sans, fontSize: text.xs, lineHeight: 17, marginTop: 2 },
  dismiss: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 6,
    top: 6,
    width: 24,
  },
  bar: {
    bottom: 0,
    height: 2,
    left: 0,
    position: "absolute",
    right: 0,
    transformOrigin: "left",
  } as never,
}));
