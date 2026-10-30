import { useState, type ComponentType, type ReactNode } from "react";
import {
  Animated,
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { Badge, Skeleton } from "./Bits";
import { Button } from "./Button";
import { IconAlert, IconChevronDown, IconClock, IconClose, type IconProps } from "./Icons";
import { font, space, text, touch } from "./tokens";
import { CollapseBody, useCollapse } from "./Collapse";
import { makeStyles, useThemeColors, type ThemeColors } from "./theme";

export type IconTileTone = "neutral" | "incoming" | "pending" | "failed";
export type ActivityRowStatus = "done" | "pending" | "failed";
/** How an amount reads: money in, money out, or not settled (pending or
    failed). */
export type ActivityAmountTone = "in" | "out" | "muted";

function tileColors(c: ThemeColors, tone: IconTileTone): { bg: string; fg: string } {
  switch (tone) {
    case "incoming":
      return { bg: c.forestSoft, fg: c.forest };
    case "pending":
      return { bg: c.saffronSoft, fg: c.saffron };
    case "failed":
      return { bg: c.accentSoft, fg: c.accent };
    default:
      return { bg: c.bgMuted, fg: c.fg };
  }
}

function amountColor(c: ThemeColors, tone: ActivityAmountTone): string {
  if (tone === "in") return c.forest;
  if (tone === "muted") return c.fgMuted;
  return c.fg;
}

export interface IconTileProps {
  icon: ComponentType<IconProps>;
  tone?: IconTileTone;
  /** `sm` in rows, `lg` in the hero. */
  size?: "sm" | "lg";
}

/** A kind's glyph on a square soft fill. Decorative: the row or hero says it. */
export function IconTile({ icon: Icon, tone = "neutral", size = "sm" }: IconTileProps) {
  const t = tileColors(useThemeColors(), tone);
  const box = size === "lg" ? 48 : 32;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: box, height: box, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}
    >
      <Icon size={size === "lg" ? 24 : 18} color={t.fg} />
    </View>
  );
}

export interface ActivityRowProps {
  icon: ComponentType<IconProps>;
  tone: IconTileTone;
  title: string;
  status?: ActivityRowStatus;
  /** One mono line: "to taB3…9kDe", "Expires Oct 6, 9:41 AM". */
  sub?: string | null;
  /** Signed and formatted ("+$25.00"); omitted for account events. */
  amount?: string | null;
  amountTone?: ActivityAmountTone;
  /** "2:16 PM". Sits alone, centred, when there is no amount. */
  time?: string | null;
  /** The whole row as one sentence; its children are hidden from readers. */
  accessibilityLabel: string;
  onPress?: () => void;
  /** The hairline under the row. */
  separator?: boolean;
  /** Its detail is open. */
  selected?: boolean;
}

/** A Cell for the feed: tile, title with its status badge, mono subline, and
    the amount over the time. The row is the control. */
export function ActivityRow({
  icon,
  tone,
  title,
  status = "done",
  sub,
  amount,
  amountTone = "out",
  time,
  accessibilityLabel,
  onPress,
  separator = true,
  selected = false,
}: ActivityRowProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected ? { selected } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        (pressed && onPress) || selected ? { backgroundColor: colors.bgMuted } : null,
      ]}
    >
      {selected ? <View style={styles.selectedBar} /> : null}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.rowInner}>
        <IconTile icon={icon} tone={tone} />
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            {status === "pending" ? <Badge tone="warn">Pending</Badge> : null}
            {status === "failed" ? <Badge tone="error">Failed</Badge> : null}
          </View>
          {sub ? (
            <Text style={styles.rowSub} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        <View style={styles.rowEnd}>
          {amount ? (
            <Text style={[styles.rowAmount, { color: amountColor(colors, amountTone) }]} numberOfLines={1}>
              {amount}
            </Text>
          ) : null}
          {time ? <Text style={styles.rowTime}>{time}</Text> : null}
        </View>
      </View>
      {separator ? <View style={styles.separator} /> : null}
    </Pressable>
  );
}

/** A loading row: tile, two lines, and the amount and time column. */
export function ActivityRowSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.rowInner}>
        <Skeleton height={32} width={32} />
        <View style={styles.skeletonLines}>
          <Skeleton height={12} width={132} />
          <Skeleton height={9} width={92} />
        </View>
        <View style={[styles.skeletonLines, styles.rowEnd]}>
          <Skeleton height={12} width={52} />
          <Skeleton height={9} width={40} />
        </View>
      </View>
      <View style={styles.separator} />
    </View>
  );
}

/** Day labels over rows, as the feed lays them out while it loads. Announced
    once as "Loading activity". */
export function ActivitySkeleton({ groups = 2, rows = 3 }: { groups?: number; rows?: number }) {
  const styles = useStyles();
  return (
    <View accessible accessibilityLabel="Loading activity" accessibilityRole="progressbar" aria-busy>
      {Array.from({ length: groups }, (_, group) => (
        <View key={group}>
          <View style={styles.skeletonLabel}>
            <Skeleton height={10} width={56} />
          </View>
          <View style={styles.groupRule}>
            {Array.from({ length: rows }, (__, row) => (
              <ActivityRowSkeleton key={row} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** A Try again, for the error variant. */
  action?: { label: string; onPress: () => void };
  /** `error` is announced as an alert; `empty` politely. */
  variant?: "empty" | "error";
  /** Inside a section, under other content, instead of filling the list. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A list with nothing to show: title, one line of body, an optional action. */
export function EmptyState({ title, body, action, variant = "empty", compact = false, style }: EmptyStateProps) {
  const styles = useStyles();
  return (
    <View
      accessibilityRole={variant === "error" ? "alert" : undefined}
      accessibilityLiveRegion="polite"
      style={[compact ? styles.emptyCompact : styles.empty, style]}
    >
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? (
        <Button label={action.label} onPress={action.onPress} variant="outline" style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

export interface InlineErrorProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** A failed refresh, as one line above rows that stay, with a retry. */
export function InlineError({ message, actionLabel = "Try again", onAction }: InlineErrorProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <View accessibilityRole="alert" style={styles.inline}>
      <IconAlert size={16} color={colors.accent} />
      <Text style={styles.inlineText}>{message}</Text>
      {onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.inlineAction, pressed ? { backgroundColor: colors.bgMuted } : null]}
        >
          <Text style={styles.inlineActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface DisclosureProps {
  title: string;
  children: ReactNode;
  /** Starts closed. Remount it (a new key) to forget an open state. */
  defaultOpen?: boolean;
  /** Set to control it: the press then only calls `onToggle`. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
}

/** A header whose chevron turns as its body opens. */
export function Disclosure({ title, children, defaultOpen = false, open: controlled, onToggle }: DisclosureProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const { turn, shown } = useCollapse(open);
  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setInner(next);
    onToggle?.(next);
  };
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        onPress={toggle}
        style={({ pressed }) => [styles.disclosureHeader, pressed ? { backgroundColor: colors.bgMuted } : null]}
      >
        <Text style={styles.disclosureTitle}>{title}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <IconChevronDown size={18} color={colors.fgMuted} />
        </Animated.View>
      </Pressable>
      {shown ? (
        <CollapseBody open={open} turn={turn} style={styles.disclosureBody}>
          {children}
        </CollapseBody>
      ) : null}
    </View>
  );
}

function StatusGlyph({ status, color }: { status: ActivityRowStatus; color: string }) {
  if (status === "pending") return <IconClock size={16} color={color} />;
  if (status === "failed") return <IconClose size={16} color={color} />;
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M20 6 9 17l-5-5" stroke={color} strokeWidth={1.5} strokeLinecap="square" />
    </Svg>
  );
}

const STATUS_WORDS: Record<ActivityRowStatus, string> = {
  done: "Completed",
  pending: "Pending",
  failed: "Failed",
};

export interface DetailHeroProps {
  icon?: ComponentType<IconProps>;
  tone?: IconTileTone;
  title?: string;
  /** Signed and formatted; omitted for account events. */
  amount?: string | null;
  amountTone?: ActivityAmountTone;
  /** Omitted when it is not known, and so is its line. */
  status?: ActivityRowStatus;
  /** The plain-words reason under a pending or failed status. */
  reason?: string | null;
  /** The detail sheet's hero: the kind is in the sheet's header, so this is
      the amount and the status alone. */
  compact?: boolean;
}

/** The detail screen's header: tile, title, the amount, and the status,
    then the reason in plain words. */
export function DetailHero({
  icon,
  tone = "neutral",
  title,
  amount,
  amountTone = "out",
  status,
  reason,
  compact = false,
}: DetailHeroProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const statusColor = status === "failed" ? colors.accent : status === "pending" ? colors.saffron : colors.forest;
  if (compact) {
    return (
      <View style={[styles.heroCompact, amount ? null : styles.heroCompactNoAmount]}>
        {amount ? (
          <Text style={[styles.heroAmount, { color: amountColor(colors, amountTone) }]} numberOfLines={1}>
            {amount}
          </Text>
        ) : null}
        {status ? (
          <View style={styles.heroStatusCompact}>
            <StatusGlyph status={status} color={statusColor} />
            <Text style={[styles.heroStatusText, { color: statusColor }]}>{STATUS_WORDS[status]}</Text>
          </View>
        ) : null}
        {reason ? <Text style={styles.heroReason}>{reason}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.hero}>
      {icon ? <IconTile icon={icon} tone={tone} size="lg" /> : null}
      <View style={styles.heroBody}>
        <Text accessibilityRole="header" style={styles.heroTitle}>
          {title}
        </Text>
        {amount ? (
          <Text style={[styles.heroAmount, { color: amountColor(colors, amountTone) }]} numberOfLines={1}>
            {amount}
          </Text>
        ) : null}
        {status ? (
          <View style={styles.heroStatus}>
            <StatusGlyph status={status} color={statusColor} />
            <Text style={[styles.heroStatusText, { color: statusColor }]}>{STATUS_WORDS[status]}</Text>
          </View>
        ) : null}
        {reason ? <Text style={styles.heroReason}>{reason}</Text> : null}
      </View>
    </View>
  );
}

/* JetBrains Mono advances 0.6em: 7.2 a character at 12. Long keys break
   after a dot or an underscore. */
const MONO_12_ADVANCE = 7.2;
const breakableKey = (key: string) => key.replace(/([._])/g, "$1\u200B");
const wrapAnywhere = Platform.OS === "web" ? ({ wordBreak: "break-all" } as unknown as TextStyle) : null;

/** Decoded data as key/value rows. */
export function KeyValueGrid({ rows }: { rows: readonly (readonly [string, string])[] }) {
  const styles = useStyles();
  const longest = rows.reduce((width, [key]) => Math.max(width, key.length), 0);
  const keyWidth = Math.ceil(longest * MONO_12_ADVANCE) + 2;
  return (
    <View style={styles.grid}>
      {rows.map(([key, value], index) => (
        <View key={`${key}-${index}`} style={styles.gridRow}>
          <Text accessibilityLabel={key} style={[styles.gridKey, { width: keyWidth, maxWidth: "42%" }]}>
            {breakableKey(key)}
          </Text>
          <Text selectable style={[styles.gridValue, wrapAnywhere]}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface DataCardProps {
  /** "transfer", "Raw instruction bytes". */
  title: string;
  /** "PasskeyInstruction", "1 instruction · 164 bytes". */
  meta?: string | null;
  defaultOpen?: boolean;
  /** An action at the header's end, after a hairline: Copy. */
  action?: { label: string; accessibilityLabel: string; onPress: () => void };
  children?: ReactNode;
}

/** A card of decoded data under Transaction details, with a header that
    opens and closes it on its own. A card with nothing in it is a plain
    header. */
export function DataCard({ title, meta, defaultOpen = false, action, children }: DataCardProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);
  const expandable = children !== undefined && children !== null;
  const expanded = open && expandable;
  const { turn, shown } = useCollapse(expanded);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  return (
    <View style={styles.dataCard}>
      <View style={styles.dataHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
          onPress={() => setOpen((value) => !value)}
          style={({ pressed }) => [styles.dataToggle, pressed ? { backgroundColor: colors.bgInset } : null]}
        >
          <Text style={styles.dataTitle} numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text style={styles.dataMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <View style={styles.flexSpacer} />
          {expandable ? (
            <Animated.View style={[styles.chevron, { transform: [{ rotate }] }]}>
              <IconChevronDown size={16} color={colors.fgMuted} />
            </Animated.View>
          ) : null}
        </Pressable>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel}
            onPress={action.onPress}
            style={({ pressed }) => [styles.dataAction, pressed ? { backgroundColor: colors.bgInset } : null]}
          >
            <Text style={styles.dataActionText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {shown ? (
        <CollapseBody open={expanded} turn={turn} style={styles.dataBody}>
          {children}
        </CollapseBody>
      ) : null}
    </View>
  );
}

/** The detail's body while it loads: the amount and status, then four rows.
    Pair it with SheetHeader's `loading`. */
export function DetailSkeleton() {
  const styles = useStyles();
  return (
    <View accessible accessibilityLabel="Loading transaction" accessibilityRole="progressbar" aria-busy>
      <View style={styles.skeletonHero}>
        <Skeleton height={30} width={160} />
        <Skeleton height={12} width={96} />
      </View>
      <View style={styles.groupRule}>
        {[0, 1, 2, 3].map((row) => (
          <View key={row} style={styles.skeletonRow}>
            <Skeleton height={9} width={64} />
            <Skeleton height={11} width={128} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** A screen's title, left-aligned above its content: the large-title
    variant of NavBar, which lays the compact bar over it once it has
    scrolled under (NavBar `large`). */
export function LargeTitle({
  title,
  right,
  style,
}: {
  title: string;
  right?: ReactNode;
  /** The desktop header sets its own padding. */
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.largeTitleRow, style]}>
      <Text accessibilityRole="header" style={styles.largeTitle} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { minHeight: touch.cellH, justifyContent: "center", backgroundColor: c.bg },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: touch.gutter,
    paddingHorizontal: touch.screenX,
    paddingVertical: 8,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  rowTitle: { flexShrink: 1, fontFamily: font.sansMedium, fontSize: text.base, lineHeight: 20, color: c.fg },
  rowSub: { fontFamily: font.mono, fontSize: text.xxs, lineHeight: 14, color: c.fgMuted },
  rowEnd: { alignItems: "flex-end", gap: 2 },
  rowAmount: { fontFamily: font.monoMedium, fontSize: 14, lineHeight: 20 },
  rowTime: { fontFamily: font.mono, fontSize: text.xxs, lineHeight: 14, color: c.fgMuted },
  separator: { position: "absolute", left: touch.screenX, right: touch.screenX, bottom: 0, height: 1, backgroundColor: c.bgMuted },
  selectedBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: c.accent },
  skeletonLines: { flex: 1, gap: 7 },
  skeletonLabel: { paddingTop: 22, paddingBottom: 10, paddingHorizontal: touch.screenX },
  groupRule: { borderTopWidth: 1, borderTopColor: c.bgMuted },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingBottom: 96,
  },
  emptyTitle: { fontFamily: font.sansSemiBold, fontSize: text.md, lineHeight: 22, color: c.fg, textAlign: "center" },
  emptyBody: {
    fontFamily: font.sans,
    fontSize: 14,
    lineHeight: 20,
    color: c.fgMuted,
    textAlign: "center",
    maxWidth: 280,
  },
  /* No flex: under react-native-web, flex 0 over the base flex 1 is a zero-height
     box, and the centred text spills over whatever sits above it. */
  emptyCompact: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingTop: space[4],
    paddingBottom: space[4],
  },
  emptyAction: { marginTop: 12 },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: touch.hitMin,
    paddingLeft: touch.screenX,
    paddingRight: 4,
    borderTopWidth: 1,
    borderTopColor: c.bgMuted,
  },
  inlineText: { flex: 1, minWidth: 0, fontFamily: font.sans, fontSize: text.sm, lineHeight: 18, color: c.accent },
  inlineAction: { height: touch.hitMin, paddingHorizontal: 12, justifyContent: "center" },
  inlineActionText: {
    fontFamily: font.monoSemiBold,
    fontSize: text.xxs,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: c.fg,
  },
  disclosure: { borderTopWidth: 1, borderTopColor: c.border },
  disclosureHeader: {
    height: touch.controlLg,
    flexDirection: "row",
    alignItems: "center",
    gap: touch.gutter,
    paddingHorizontal: touch.screenX,
  },
  disclosureTitle: { flex: 1, fontFamily: font.sansMedium, fontSize: text.base, color: c.fg },
  disclosureBody: { borderTopWidth: 1, borderTopColor: c.bgMuted },
  hero: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingHorizontal: touch.screenX,
    paddingTop: 24,
    paddingBottom: 20,
  },
  heroBody: { flex: 1, minWidth: 0, gap: 4 },
  heroTitle: { fontFamily: font.sansSemiBold, fontSize: text.lg, letterSpacing: -0.3, lineHeight: 26, color: c.fg },
  heroAmount: { fontFamily: font.sansBold, fontSize: text.xxxl, letterSpacing: -0.75, lineHeight: 40 },
  heroStatus: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  heroStatusText: { fontFamily: font.sansMedium, fontSize: 14, lineHeight: 20 },
  heroReason: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: c.fgMuted },
  heroCompact: { gap: 6, paddingTop: 20, paddingBottom: 16, paddingHorizontal: touch.screenX },
  heroCompactNoAmount: { paddingTop: 16, paddingBottom: 16 },
  heroStatusCompact: { flexDirection: "row", alignItems: "center", gap: 6 },
  grid: { gap: 6 },
  gridRow: { flexDirection: "row", columnGap: 16 },
  gridKey: { flexShrink: 0, fontFamily: font.mono, fontSize: 12, lineHeight: 18, color: c.fgMuted },
  gridValue: { flex: 1, minWidth: 0, fontFamily: font.mono, fontSize: 12, lineHeight: 18, color: c.fg },
  dataCard: { borderWidth: 1, borderColor: c.border },
  dataHeader: { height: touch.hitMin, flexDirection: "row", alignItems: "center", backgroundColor: c.bgMuted },
  dataToggle: { flex: 1, minWidth: 0, height: touch.hitMin, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  dataTitle: { flexShrink: 1, minWidth: 0, fontFamily: font.monoMedium, fontSize: 13, color: c.fg },
  dataMeta: { flexShrink: 3, minWidth: 0, fontFamily: font.mono, fontSize: text.xxs, color: c.fgMuted },
  chevron: { flexShrink: 0 },
  flexSpacer: { flex: 1 },
  dataAction: {
    height: touch.hitMin,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: c.border,
  },
  dataActionText: {
    fontFamily: font.monoSemiBold,
    fontSize: text.xxs,
    letterSpacing: 0.88,
    textTransform: "uppercase",
    color: c.fg,
  },
  dataBody: { paddingVertical: 12, paddingHorizontal: 14 },
  skeletonHero: { gap: 10, paddingTop: 20, paddingBottom: 16, paddingHorizontal: touch.screenX },
  skeletonRow: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: touch.screenX,
    borderBottomWidth: 1,
    borderBottomColor: c.bgMuted,
  },
  largeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingTop: 6,
    paddingBottom: 12,
    paddingHorizontal: touch.screenX,
  },
  largeTitle: { flex: 1, fontFamily: font.sansBold, fontSize: text.xxl, letterSpacing: -0.5, lineHeight: 34, color: c.fg },
}));
