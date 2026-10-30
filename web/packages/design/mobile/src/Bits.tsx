import { useEffect, type ReactNode } from "react";
import {
  Animated,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type AccessibilityState,
  type DimensionValue,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { font, space, text, touch } from "./tokens";
import { pulseLoop } from "./Spinner";
import { makeStyles, useThemeColors, type ThemeColors } from "./theme";
import { IconChevronRight } from "./Icons";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/* `muted` is for labels that carry content; fgSubtle is 2.5:1 on light and
   only fits decoration. */
export function SectionLabel({
  children,
  tone = "subtle",
  style,
}: {
  children: ReactNode;
  tone?: "subtle" | "muted";
  style?: StyleProp<TextStyle>;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <Text style={[styles.sectionLabel, tone === "muted" ? { color: colors.fgMuted } : null, style]}>
      {children}
    </Text>
  );
}

/** A section header's trailing link ("View all"): the label's type in the
    accent, with an arrow. */
export function SectionAction({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.sectionActionTarget}
    >
      <Text style={[styles.sectionLabel, { color: colors.accent }]}>{label} →</Text>
    </Pressable>
  );
}

/* One clock for every skeleton on screen, so blocks that mount at different
   times pulse together. It runs while any skeleton is mounted. */
const skeletonOpacity = new Animated.Value(1);
let skeletonUsers = 0;
let skeletonLoop: Animated.CompositeAnimation | null = null;

/** The opacity every skeleton block pulses on. Opacity is non-spatial, so it
    pulses under reduced motion too, as the Spinner's pulse does. */
export function useSkeletonPulse(): Animated.Value {
  useEffect(() => {
    skeletonUsers += 1;
    if (skeletonUsers === 1) {
      skeletonLoop = pulseLoop(skeletonOpacity);
      skeletonLoop.start();
    }
    return () => {
      skeletonUsers -= 1;
      if (skeletonUsers > 0) return;
      skeletonLoop?.stop();
      skeletonLoop = null;
      skeletonOpacity.setValue(1);
    };
  }, []);
  return skeletonOpacity;
}

export interface SkeletonProps {
  height: number;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}

/** Layout-preserving placeholder for content that has not loaded yet. */
export function Skeleton({ height, width = "100%", style }: SkeletonProps) {
  const styles = useStyles();
  const opacity = useSkeletonPulse();
  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, { height, width }, style, { opacity }]}
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
  style?: StyleProp<ViewStyle>;
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
  style,
}: CellProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const interactive = Boolean(onPress);
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityState={accessibilityState}
      /* react-native-web drops accessibilityState; expanded is the one state valid on a button. */
      aria-expanded={accessibilityState?.expanded}
      disabled={!interactive || Boolean(disabled)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        subtitle ? { height: touch.cellHLg } : null,
        style,
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
      {right ? <View style={styles.cellRight}>{right}</View> : null}
      {chevron ? <IconChevronRight /> : null}
    </Pressable>
  );
}

/* `error` is solid: the `brand` tone, brick on brickSoft, is 3.9:1 and too
   faint to say "failed". */
export type BadgeTone = "neutral" | "success" | "warn" | "brand" | "error";

function badgeTone(c: ThemeColors, tone: BadgeTone): { bg: string; fg: string } {
  switch (tone) {
    case "success":
      return { bg: c.forestSoft, fg: c.forest };
    case "warn":
      return { bg: c.saffronSoft, fg: c.saffron };
    case "brand":
      return { bg: c.brickSoft, fg: c.accent };
    case "error":
      return { bg: c.accent, fg: c.bg };
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
  unavailable = false,
  chips,
  style,
}: {
  label: string;
  /** Null while it loads: a skeleton holds the value's place. */
  value: string | null;
  /** The value is a status such as "Unavailable", not money. */
  unavailable?: boolean;
  chips?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.hero, style]}>
      <Text style={styles.heroLabel}>{label}</Text>
      {value === null ? (
        <Skeleton height={48} width="64%" />
      ) : (
        <Text style={[styles.heroValue, unavailable ? styles.heroUnavailable : null]} numberOfLines={1}>
          {value}
        </Text>
      )}
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
 * One square group with shared hairlines. The selected segment inverts to
 * the foreground fill; every segment is a full hit target.
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
            aria-selected={selected}
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
  sectionActionTarget: { paddingVertical: space[4], marginVertical: -space[4] },
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
  /* Its own box so an accessory that pins itself (Badge's alignSelf
     flex-start) still centres in the row. */
  cellRight: { flexDirection: "row", alignItems: "center", gap: touch.gutter, flexShrink: 1, minWidth: 0 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontFamily: font.monoMedium, fontSize: text.xxs, letterSpacing: 0.5, textTransform: "uppercase" },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  /* On the web a segment never shrinks below its label, so a long one takes
     the room a short one leaves instead of truncating. */
  segment: {
    flex: 1,
    height: touch.hitMin,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    ...(Platform.OS === "web" ? { minWidth: "auto" as const } : null),
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
    color: c.fgMuted,
    marginBottom: 8,
  },
  heroValue: {
    fontFamily: font.sansBold,
    fontSize: text.display,
    letterSpacing: -1,
    lineHeight: 48,
    color: c.fg,
  },
  /* Keeps the 48 line, so the hero holds its height between states. */
  heroUnavailable: { color: c.fgMuted, fontSize: text.lg, letterSpacing: 0 },
  heroChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  status: { fontFamily: font.mono, fontSize: text.sm, minHeight: 20 },
}));
