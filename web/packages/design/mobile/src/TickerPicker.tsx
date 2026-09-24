/**
 * Which token an amount is in, and how much of it is available.
 *
 * `TickerPicker` is one row - the token's mark, its availability, a chevron,
 * and Max - that opens a checkable list of the tokens there are. It opens
 * even with one token, so nothing about it changes when a second arrives.
 * `TokenMark` is the round mark: ThruUSD's own logo, or for any other token
 * an ink disc with its sign or its ticker's first letters knocked out of it.
 */
import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { font, space, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { Button } from "./Button";
import { IconCheck, IconChevronDown } from "./Icons";
import { Spinner } from "./loading/MarkDrawOn";
import { ThruUsdLogo } from "./ThruUsdLogo";
import { isThruUsdSymbol } from "../../tokens/src/thrusd";

export function TokenMark({ label, size = 28 }: { label: string; size?: number }) {
  const styles = useStyles();
  if (isThruUsdSymbol(label)) return <ThruUsdLogo size={size} />;
  /* A sign reads alone; a ticker keeps its first two letters. */
  const glyph = label.length <= 1 ? label : label.slice(0, 2);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { borderRadius: size / 2, height: size, width: size }]}
    >
      <Text
        style={[
          styles.markText,
          glyph.length === 1
            ? { fontFamily: font.sansBold, fontSize: Math.round(size * 0.5) }
            : { fontSize: Math.round(size * 0.34) },
        ]}
      >
        {glyph}
      </Text>
    </View>
  );
}

export interface TickerOption {
  key: string;
  /** What the mark shows: the sign, or the ticker. */
  mark: string;
  /** The token's name ("Dollars"). */
  name: string;
  /** "$56 available". */
  availability: string;
}

export interface TickerPickerProps {
  options: readonly TickerOption[];
  selectedKey: string | null;
  /** The row's text: "$56 available", or "Over balance · $56". */
  availability: string;
  /** A token without a currency sign names itself before its availability. */
  ticker?: string | null;
  overBalance?: boolean;
  /** The balance is not known yet. */
  loading?: boolean;
  open: boolean;
  onToggle: () => void;
  onSelect: (key: string) => void;
  onMax?: () => void;
  disabled?: boolean;
}

export function TickerPicker({
  options,
  selectedKey,
  availability,
  ticker,
  overBalance = false,
  loading = false,
  open,
  onToggle,
  onSelect,
  onMax,
  disabled = false,
}: TickerPickerProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const [turn] = useState(() => new Animated.Value(open ? 1 : 0));
  useEffect(() => {
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [open, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const selected = options.find((option) => option.key === selectedKey) ?? options[0];

  if (loading || !selected) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.row}>
        <View style={[styles.mark, styles.markLoading]} />
        <Text style={styles.loadingText}>Loading your balance…</Text>
        <View style={styles.trailing}>
          <Spinner size={16} color={colors.fgMuted} />
        </View>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityHint="Choose which token to send"
          accessibilityLabel={`${selected.name}, ${availability}`}
          accessibilityRole="button"
          accessibilityState={{ disabled, expanded: open }}
          disabled={disabled}
          onPress={onToggle}
          style={styles.rowToggle}
        >
          <TokenMark label={selected.mark} />
          <Text
            numberOfLines={1}
            style={[styles.availability, overBalance ? { color: colors.error } : null]}
          >
            {ticker ? <Text style={styles.ticker}>{ticker} </Text> : null}
            {availability}
          </Text>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <IconChevronDown size={16} color={colors.fgMuted} />
          </Animated.View>
        </Pressable>
        {onMax ? (
          <Button
            disabled={disabled}
            label="Max"
            onPress={onMax}
            size="sm"
            style={styles.max}
            variant="outline"
          />
        ) : null}
      </View>
      {open
        ? options.map((option) => {
            const active = option.key === selected.key;
            return (
              <Pressable
                accessibilityLabel={`${option.name}, ${option.availability}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={option.key}
                onPress={() => onSelect(option.key)}
                style={({ pressed }) => [styles.option, pressed ? styles.pressed : null]}
              >
                <TokenMark label={option.mark} />
                <View style={styles.optionCopy}>
                  <Text numberOfLines={1} style={styles.optionName}>
                    {option.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.optionMeta}>
                    {option.availability}
                  </Text>
                </View>
                {active ? <IconCheck size={16} color={colors.forest} /> : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  mark: {
    alignItems: "center",
    backgroundColor: c.bgInverse,
    justifyContent: "center",
  },
  markText: { color: c.fgInverse, fontFamily: font.monoSemiBold, includeFontPadding: false },
  markLoading: { backgroundColor: c.bgMuted, borderRadius: 14, height: 28, width: 28 },
  row: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: space[3],
    height: touch.cellH,
    paddingLeft: touch.screenX,
    paddingRight: space[2],
  },
  rowToggle: {
    alignItems: "center",
    alignSelf: "stretch",
    flex: 1,
    flexDirection: "row",
    gap: space[3],
    minWidth: 0,
  },
  availability: {
    color: c.fg,
    flexShrink: 1,
    fontFamily: font.mono,
    fontSize: text.base,
  },
  ticker: { fontFamily: font.monoSemiBold },
  loadingText: { color: c.fgMuted, flex: 1, fontFamily: font.sans, fontSize: text.sm },
  trailing: { alignItems: "center", justifyContent: "center", width: touch.hitMin },
  max: { paddingHorizontal: space[3] },
  option: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: space[3],
    height: touch.cellH,
    paddingLeft: touch.screenX,
    paddingRight: touch.screenX,
  },
  pressed: { backgroundColor: c.bgMuted },
  optionCopy: { flex: 1, gap: 2, minWidth: 0 },
  optionName: { color: c.fg, fontFamily: font.sansMedium, fontSize: text.base },
  optionMeta: { color: c.fgMuted, fontFamily: font.sans, fontSize: text.xs },
}));
