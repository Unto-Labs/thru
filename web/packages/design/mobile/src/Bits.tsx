/**
 * Small kit pieces: Field (48pt mono input), Cell (56pt list row), Badge
 * (11pt mono chip), BalanceHero (11 mono label over 44pt display), Card
 * (hairline panel), SectionLabel.
 */
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityState,
  type DimensionValue,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { color, font, palette, text, touch } from "./tokens";
import { IconChevronRight } from "./Icons";

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export interface SkeletonProps {
  height: number;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}

/** Layout-preserving placeholder for content that has not loaded yet. */
export function Skeleton({ height, width = "100%", style }: SkeletonProps) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, { height, width }, style]}
    />
  );
}

export function Field(props: TextInputProps & { error?: boolean }) {
  const { accessibilityHint, error, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={color.fgSubtle}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
      accessibilityHint={error ? `Invalid input${accessibilityHint ? `. ${accessibilityHint}` : ""}` : accessibilityHint}
      style={[styles.field, error ? { borderColor: color.error } : null, style]}
    />
  );
}

export interface CellProps {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  chevron?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export function Cell({
  accessibilityHint,
  accessibilityLabel,
  accessibilityState,
  icon,
  title,
  subtitle,
  right,
  chevron,
  disabled,
  onPress,
}: CellProps) {
  const interactive = Boolean(onPress);
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityState={
        interactive
          ? { ...accessibilityState, disabled: Boolean(disabled) }
          : accessibilityState
      }
      disabled={!interactive || Boolean(disabled)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        subtitle ? { height: touch.cellHLg } : null,
        pressed && onPress && !disabled ? { backgroundColor: color.bgMuted } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {icon ? <View style={styles.cellIcon}>{icon}</View> : null}
      <View style={styles.cellBody}>
        <Text style={styles.cellTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.cellSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <IconChevronRight /> : null}
    </Pressable>
  );
}

export type BadgeTone = "neutral" | "success" | "warn" | "brand";

const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: palette.stone[100], fg: palette.stone[600] },
  success: { bg: palette.forest[100], fg: palette.forest[400] },
  warn: { bg: palette.saffron[100], fg: "#8A5A00" },
  brand: { bg: palette.brick[100], fg: palette.brick[500] },
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const t = BADGE_TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

export function BalanceHero({
  label,
  value,
  chips,
  style,
}: {
  label: string;
  value: string;
  chips?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.hero, style]}>
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.heroValue} numberOfLines={1}>
        {value}
      </Text>
      {chips ? <View style={styles.heroChips}>{chips}</View> : null}
    </View>
  );
}

export function StatusText({ kind = "muted", children }: { kind?: "muted" | "ok" | "err"; children: ReactNode }) {
  const c = kind === "ok" ? palette.forest[400] : kind === "err" ? color.destructive : color.fgMuted;
  return <Text style={[styles.status, { color: c }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.border,
  },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: color.fgSubtle,
  },
  skeleton: {
    backgroundColor: color.bgInset,
  },
  field: {
    height: touch.controlMd,
    paddingHorizontal: 14,
    fontFamily: font.mono,
    fontSize: text.base,
    color: color.fg,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: 0,
  },
  cell: {
    height: touch.cellH,
    flexDirection: "row",
    alignItems: "center",
    gap: touch.gutter,
    paddingHorizontal: touch.screenX,
  },
  cellIcon: { width: 24, alignItems: "center" },
  cellBody: { flex: 1, gap: 2 },
  cellTitle: { fontFamily: font.sansMedium, fontSize: text.base, color: color.fg },
  cellSubtitle: { fontFamily: font.mono, fontSize: text.sm, color: color.fgMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontFamily: font.monoMedium, fontSize: text.xxs, letterSpacing: 0.5, textTransform: "uppercase" },
  hero: { paddingHorizontal: touch.screenX, paddingTop: 24 },
  heroLabel: {
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: color.fgSubtle,
    marginBottom: 8,
  },
  heroValue: {
    fontFamily: font.sansBold,
    fontSize: text.display,
    letterSpacing: -1,
    lineHeight: 48,
    color: color.fg,
  },
  heroChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  status: { fontFamily: font.mono, fontSize: text.sm, minHeight: 20 },
});
