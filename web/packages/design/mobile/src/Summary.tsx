import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { font, space, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { IconAlert, IconEdit, IconInfo, IconWarning } from "./Icons";
import { Spinner } from "./loading/MarkDrawOn";

export interface SummaryRow {
  key: string;
  label: string;
  /** Plain text, or a node such as a mark and an amount. */
  value: ReactNode;
  /** Tapping the row goes back to change it. */
  onEdit?: () => void;
  editLabel?: string;
  /** Wraps anywhere: for an address. */
  mono?: boolean;
}

export function SummaryRows({
  rows,
  locked = false,
}: {
  rows: readonly SummaryRow[];
  /** No editing while what they describe is under way. */
  locked?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.rows}>
      {rows.map((row) => {
        const editable = !locked && !!row.onEdit;
        const value =
          typeof row.value === "string" ? (
            <Text selectable style={[styles.value, row.mono ? styles.valueMono : null]}>
              {row.value}
            </Text>
          ) : (
            row.value
          );
        const body = (
          <>
            <Text style={styles.label}>{row.label}</Text>
            <View style={styles.valueSlot}>{value}</View>
            <View style={styles.edit}>{editable ? <IconEdit size={16} /> : null}</View>
          </>
        );
        return editable ? (
          <Pressable
            accessibilityHint={row.editLabel}
            accessibilityRole="button"
            key={row.key}
            onPress={row.onEdit}
            style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={row.key} style={styles.row}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

export function Callout({
  tone = "neutral",
  title,
  icon,
  children,
}: {
  /** `neutral` spins for something under way; `error` is for a failure;
      `info` is a still note, such as how a balance is split; `warn` is a
      caution, such as which network a transfer must come from. */
  tone?: "neutral" | "error" | "info" | "warn";
  title: string;
  /** Replaces the info glyph; the caller colours it. */
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.callout,
        tone === "error" ? styles.calloutError : tone === "warn" ? styles.calloutWarn : null,
      ]}
    >
      <View style={styles.calloutGlyph}>
        {tone === "error" ? (
          <IconAlert size={16} color={colors.destructive} />
        ) : tone === "warn" ? (
          <IconWarning size={16} color={colors.saffron} />
        ) : tone === "info" ? (
          (icon ?? <IconInfo size={16} color={colors.fg} />)
        ) : (
          <Spinner size={14} color={colors.fgMuted} />
        )}
      </View>
      <View style={styles.calloutCopy}>
        <Text style={styles.calloutTitle}>{title}</Text>
        {children ? <Text style={styles.calloutText}>{children}</Text> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  rows: { borderTopColor: c.border, borderTopWidth: 1 },
  row: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: touch.cellH,
    paddingLeft: touch.screenX,
    paddingVertical: space[2],
  },
  pressed: { backgroundColor: c.bgMuted },
  label: {
    color: c.fgSubtle,
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 0.88,
    textTransform: "uppercase",
    width: 72,
  },
  valueSlot: { flex: 1, minWidth: 0 },
  value: { color: c.fg, fontFamily: font.sans, fontSize: text.sm, lineHeight: 19.5 },
  valueMono: {
    fontFamily: font.mono,
    wordBreak: "break-all",
  } as never,
  edit: {
    alignItems: "center",
    height: touch.hitMin,
    justifyContent: "center",
    width: touch.hitMin,
  },
  callout: {
    backgroundColor: c.bgMuted,
    flexDirection: "row",
    gap: space[3],
    marginTop: space[4],
    paddingHorizontal: 14,
    paddingVertical: space[3],
  },
  calloutError: { backgroundColor: c.accentSoft },
  calloutWarn: { backgroundColor: c.saffronSoft },
  calloutGlyph: { alignItems: "center", height: 19, justifyContent: "center", width: 16 },
  calloutCopy: { flex: 1, gap: 2 },
  calloutTitle: { color: c.fg, fontFamily: font.sansSemiBold, fontSize: text.sm, lineHeight: 19 },
  calloutText: { color: c.fgMuted, fontFamily: font.sans, fontSize: text.sm, lineHeight: 19 },
}));
