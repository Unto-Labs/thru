/**
 * Small kit pieces: Field (48pt mono input), Cell (56pt list row), Badge
 * (11pt mono chip), BalanceHero (11 mono label over 44pt display), Card
 * (hairline panel), SectionLabel. All colors follow the active theme.
 */
import type { ReactNode } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type AccessibilityState,
  type DimensionValue,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { font, text, touch } from "./tokens";
import { makeStyles, useThemeColors, type ThemeColors } from "./theme";
import { IconChevronRight } from "./Icons";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export interface SkeletonProps {
  height: number;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}

/** Layout-preserving placeholder for content that has not loaded yet. */
export function Skeleton({ height, width = "100%", style }: SkeletonProps) {
  const styles = useStyles();
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
  const styles = useStyles();
  const colors = useThemeColors();
  const { accessibilityHint, error, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.fgSubtle}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
      accessibilityHint={error ? `Invalid input${accessibilityHint ? `. ${accessibilityHint}` : ""}` : accessibilityHint}
      style={[styles.field, error ? { borderColor: colors.error } : null, style]}
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
  const styles = useStyles();
  const colors = useThemeColors();
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
        pressed && onPress && !disabled ? { backgroundColor: colors.bgMuted } : null,
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

function badgeTone(c: ThemeColors, tone: BadgeTone): { bg: string; fg: string } {
  switch (tone) {
    case "success":
      return { bg: c.forestSoft, fg: c.forest };
    case "warn":
      return { bg: c.saffronSoft, fg: c.saffron };
    case "brand":
      return { bg: c.brickSoft, fg: c.accent };
    default:
      return { bg: c.bgMuted, fg: c.fgMuted };
  }
}

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const styles = useStyles();
  const t = badgeTone(useThemeColors(), tone);
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
  const styles = useStyles();
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
  const styles = useStyles();
  const colors = useThemeColors();
  const c = kind === "ok" ? colors.forest : kind === "err" ? colors.destructive : colors.fgMuted;
  return <Text style={[styles.status, { color: c }]}>{children}</Text>;
}

export interface SegmentedOption<T extends string> {
  label: string;
  value: T;
}

export interface SegmentedProps<T extends string> {
  accessibilityLabel?: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * One square group with shared hairlines — not N separate boxes. The selected
 * segment inverts to the foreground fill; 44pt tall so every segment is a
 * full hit target.
 */
export function Segmented<T extends string>({
  accessibilityLabel,
  options,
  value,
  onChange,
  disabled,
  style,
}: SegmentedProps<T>) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="tablist" style={[styles.segmented, style]}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              index > 0 ? styles.segmentDivided : null,
              selected ? { backgroundColor: colors.fg } : null,
              !selected && pressed ? { backgroundColor: colors.bgMuted } : null,
              disabled ? { opacity: 0.5 } : null,
            ]}
          >
            <Text style={[styles.segmentText, { color: selected ? colors.bg : colors.fgMuted }]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.border,
  },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: c.fgSubtle,
  },
  skeleton: {
    backgroundColor: c.bgInset,
  },
  field: {
    height: touch.controlMd,
    paddingHorizontal: 14,
    fontFamily: font.mono,
    fontSize: text.base,
    color: c.fg,
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.borderStrong,
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
  cellTitle: { fontFamily: font.sansMedium, fontSize: text.base, color: c.fg },
  cellSubtitle: { fontFamily: font.mono, fontSize: text.sm, color: c.fgMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontFamily: font.monoMedium, fontSize: text.xxs, letterSpacing: 0.5, textTransform: "uppercase" },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  segment: {
    flex: 1,
    height: touch.hitMin,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  segmentDivided: {
    borderLeftWidth: 1,
    borderLeftColor: c.borderStrong,
  },
  segmentText: {
    fontFamily: font.mono,
    fontSize: text.sm,
  },
  hero: { paddingHorizontal: touch.screenX, paddingTop: 24 },
  heroLabel: {
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: c.fgSubtle,
    marginBottom: 8,
  },
  heroValue: {
    fontFamily: font.sansBold,
    fontSize: text.display,
    letterSpacing: -1,
    lineHeight: 48,
    color: c.fg,
  },
  heroChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  status: { fontFamily: font.mono, fontSize: text.sm, minHeight: 20 },
}));
