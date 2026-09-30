/**
 * The parts Deposit adds to Send's.
 *
 * `PresetChips` are the quick amounts under the amount, one selected when the
 * typed amount equals it. `QuoteLine` is the single line under the amount
 * that says what it gets, or why it can't go on yet.
 */
import { Pressable, Text, View } from "react-native";
import { font, space, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { Spinner } from "./loading/MarkDrawOn";

export interface PresetChip {
  key: string;
  /** "$25". */
  label: string;
}

export function PresetChips({
  options,
  selectedKey,
  onSelect,
  disabled = false,
}: {
  options: readonly PresetChip[];
  /** The chip whose amount the typed amount equals, if any. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = option.key === selectedKey;
        return (
          <Pressable
            accessibilityLabel={`Amount ${option.label}`}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            key={option.key}
            onPress={() => onSelect(option.key)}
            style={({ pressed }) => [
              styles.chip,
              selected ? styles.chipSelected : null,
              pressed && !selected ? styles.chipPressed : null,
              disabled ? styles.disabled : null,
            ]}
          >
            <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type QuoteLineTone = "subtle" | "muted" | "loading" | "error";

export function QuoteLine({
  tone,
  message,
  onRetry,
}: {
  /** `subtle` before there is anything to price, `muted` for a price,
      `loading` while one is on its way, `error` for a problem. */
  tone: QuoteLineTone;
  message: string;
  /** Shown after an error's message. */
  onRetry?: () => void;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  const color =
    tone === "error" ? colors.error : tone === "subtle" ? colors.fgSubtle : colors.fgMuted;
  return (
    <View accessibilityLiveRegion="polite" style={styles.quote}>
      {tone === "loading" ? <Spinner size={12} color={colors.fgMuted} /> : null}
      <Text style={[styles.quoteText, { color }]}>{message}</Text>
      {tone === "error" && onRetry ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  disabled: { opacity: 0.45 },

  chips: {
    flexDirection: "row",
    gap: space[2],
    paddingHorizontal: touch.screenX,
  },
  chip: {
    alignItems: "center",
    backgroundColor: c.bgMuted,
    flex: 1,
    height: touch.controlMd,
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: c.bgInverse },
  chipPressed: { backgroundColor: c.bgInset },
  chipLabel: { color: c.fg, fontFamily: font.monoSemiBold, fontSize: text.base },
  chipLabelSelected: { color: c.fgInverse },

  quote: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 20,
  },
  quoteText: { fontFamily: font.sans, fontSize: text.sm, lineHeight: 19, textAlign: "center" },
  retry: { marginLeft: 2 },
  retryLabel: {
    color: c.fg,
    fontFamily: font.monoSemiBold,
    fontSize: text.sm,
    textDecorationLine: "underline",
  },
}));
