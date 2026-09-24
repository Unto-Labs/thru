/**
 * Entering an amount: the big centred figure with its currency sign leading,
 * and the in-sheet numeric keypad that feeds it.
 *
 * The keypad is used in place of the system decimal pad on phones: in a Home
 * Screen web app the system pad does not reliably resize the viewport, it
 * covers the controls under the amount, and its decimal key follows the
 * locale. A wide layout has a real keyboard, so there the figure takes typed
 * input instead (`editable`).
 */
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { font, space, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { IconBackspace } from "./Icons";
import type { FieldHandle } from "./AddressField";

/* The figure starts shrinking past this many characters, sign included. */
const AMOUNT_FULL_SIZE_CHARS = 9;
const AMOUNT_MIN_SIZE = text.xxl;
/* A figure with the screen to itself - Send's amount and review steps on a
   phone - reads larger. */
const AMOUNT_SIZES = { default: text.display, large: 64 } as const;

function amountFontSize(chars: number, full: number): number {
  if (chars <= AMOUNT_FULL_SIZE_CHARS) return full;
  return Math.max(
    AMOUNT_MIN_SIZE,
    Math.floor((full * AMOUNT_FULL_SIZE_CHARS) / chars)
  );
}

export interface AmountDisplayProps {
  /** The amount as it should read, grouping included; empty shows "0" in the
      placeholder tone. */
  value: string;
  /** A currency sign drawn before the figure ("$"). */
  sign?: string | null;
  /** A ticker drawn after the figure, for a token without a sign. */
  suffix?: string | null;
  accessibilityLabel?: string;
  /** Takes typed input through an invisible field over the figure, and shows
      a caret while it has focus. */
  editable?: boolean;
  /** The raw text typed, for `editable`. */
  inputValue?: string;
  onChangeText?: (value: string) => void;
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  autoFocus?: boolean;
  inputRef?: RefObject<FieldHandle | null>;
  /** The figure's size at full length; long amounts shrink from it. */
  size?: keyof typeof AMOUNT_SIZES;
}

export function AmountDisplay({
  value,
  sign,
  suffix,
  accessibilityLabel,
  editable = false,
  inputValue,
  onChangeText,
  onSubmitEditing,
  autoFocus,
  inputRef,
  size: sizeName = "default",
}: AmountDisplayProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const empty = value === "";
  const shown = empty ? "0" : value;
  const size = amountFontSize(
    (sign ?? "").length + shown.length,
    AMOUNT_SIZES[sizeName]
  );
  const tone = empty ? colors.fgSubtle : colors.fg;

  return (
    <View style={styles.display}>
      <View
        accessibilityLabel={editable ? undefined : accessibilityLabel}
        accessibilityRole={editable ? undefined : "text"}
        accessible={!editable}
        style={styles.figureRow}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.figure,
            { color: tone, fontSize: size, lineHeight: Math.round(size * 1.15) },
          ]}
        >
          {sign ?? ""}
          {shown}
        </Text>
        {editable && focused ? <Caret height={Math.round(size * 0.9)} /> : null}
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
      {editable ? (
        <TextInput
          accessibilityLabel={accessibilityLabel}
          autoComplete="off"
          autoCorrect={false}
          autoFocus={autoFocus}
          caretHidden
          inputMode="decimal"
          keyboardType="decimal-pad"
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={onSubmitEditing}
          ref={inputRef as RefObject<TextInput | null> | undefined}
          returnKeyType="next"
          style={styles.hiddenInput}
          value={inputValue ?? ""}
        />
      ) : null}
    </View>
  );
}

function Caret({ height }: { height: number }) {
  const styles = useStyles();
  const [blink] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, {
          toValue: 0,
          duration: 120,
          delay: 480,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(blink, {
          toValue: 1,
          duration: 120,
          delay: 360,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);
  return <Animated.View style={[styles.caret, { height, opacity: blink }]} />;
}

export type KeypadKey =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "." | "delete" | "clear";

const KEY_ROWS: readonly (readonly KeypadKey[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "delete"],
];

export interface KeypadProps {
  /** A key pressed; holding delete sends `clear`. */
  onKey: (key: KeypadKey) => void;
  disabled?: boolean;
  /** The decimal key's label. */
  decimalLabel?: string;
}

/** A 3 x 4 numeric keypad: digits, a decimal point and delete. */
export function Keypad({ onKey, disabled = false, decimalLabel = "." }: KeypadProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  /* A long press on delete clears, and the release that ends it must not
     also delete a character. */
  const clearedRef = useRef(false);
  return (
    <View style={styles.keypad}>
      {KEY_ROWS.map((row) => (
        <View key={row.join("")} style={styles.keyRow}>
          {row.map((key) => {
            const isDelete = key === "delete";
            return (
              <Pressable
                accessibilityHint={isDelete ? "Hold to clear the amount" : undefined}
                accessibilityLabel={
                  isDelete ? "Delete" : key === "." ? "Decimal point" : key
                }
                accessibilityRole="button"
                disabled={disabled}
                key={key}
                onLongPress={
                  isDelete
                    ? () => {
                        clearedRef.current = true;
                        onKey("clear");
                      }
                    : undefined
                }
                onPress={() => {
                  if (clearedRef.current) {
                    clearedRef.current = false;
                    return;
                  }
                  onKey(key);
                }}
                onPressIn={() => {
                  clearedRef.current = false;
                }}
                style={({ pressed }) => [
                  styles.key,
                  pressed && !disabled ? styles.keyPressed : null,
                  disabled ? styles.keyDisabled : null,
                ]}
              >
                {isDelete ? (
                  <IconBackspace size={24} color={colors.fg} />
                ) : (
                  <Text style={styles.keyText}>
                    {key === "." ? decimalLabel : key}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  display: {
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    minHeight: 120,
    position: "relative",
  },
  figureRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    maxWidth: "100%",
  },
  figure: {
    fontFamily: font.sansBold,
    includeFontPadding: false,
    letterSpacing: -1,
  },
  suffix: {
    color: c.fgMuted,
    fontFamily: font.monoSemiBold,
    fontSize: text.base,
    marginLeft: space[2],
  },
  caret: {
    backgroundColor: c.accent,
    marginLeft: 2,
    width: 2,
  },
  /* Laid over the figure so a click on it focuses the field; drawn
     transparent because the figure is what reads. */
  hiddenInput: {
    bottom: 0,
    color: "transparent",
    left: 0,
    opacity: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  keypad: { marginTop: space[2] },
  keyRow: { flexDirection: "row" },
  key: {
    alignItems: "center",
    flex: 1,
    height: touch.controlLg,
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: c.bgMuted },
  keyDisabled: { opacity: 0.45 },
  keyText: {
    color: c.fg,
    fontFamily: font.sansMedium,
    fontSize: text.xl,
  },
}));
