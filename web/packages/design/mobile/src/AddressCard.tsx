/**
 * The caller owns the clipboard, the share sheet, and how long `copied`
 * stays true.
 */

import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { IconCheck, IconCopy, IconShare } from "./Icons";
import { font, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";

export interface AddressCardProps {
  address: string;
  copied: boolean;
  onCopy: () => void;
  /** Omit where nothing can share; the copy action then fills the row. */
  onShare?: () => void;
  /** What the address is, e.g. "Your address": read out before it. */
  label: string;
  style?: StyleProp<ViewStyle>;
}

export function AddressCard({ address, copied, onCopy, onShare, label, style }: AddressCardProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <View style={[styles.card, style]}>
      <View accessible accessibilityLabel={`${label}, ${address}`} style={styles.addressBox}>
        <Text selectable style={styles.address}>
          {address}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={copied ? `${label} copied` : "Copy address"}
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          onPress={onCopy}
          style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
        >
          {copied ? (
            <IconCheck size={16} color={colors.forest} />
          ) : (
            <IconCopy size={16} color={colors.fg} />
          )}
          <Text style={[styles.actionText, copied ? { color: colors.forest } : null]}>
            {copied ? "Copied" : "Copy address"}
          </Text>
        </Pressable>
        {onShare ? (
          <>
            <View style={styles.divider} />
            <Pressable
              accessibilityLabel="Share address"
              accessibilityRole="button"
              onPress={onShare}
              style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
            >
              <IconShare size={16} color={colors.fg} />
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { alignSelf: "stretch", borderColor: c.borderStrong, borderWidth: 1 },
  addressBox: { paddingHorizontal: 16, paddingVertical: 14 },
  address: {
    color: c.fg,
    fontFamily: font.mono,
    fontSize: text.sm,
    lineHeight: 19.5,
    textAlign: "center",
  },
  actions: {
    backgroundColor: c.bgMuted,
    borderTopColor: c.borderStrong,
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: touch.hitMin,
  },
  action: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: touch.hitMin,
  },
  pressed: { backgroundColor: c.bgInset },
  divider: { backgroundColor: c.borderStrong, width: 1 },
  actionText: { color: c.fg, fontFamily: font.monoMedium, fontSize: text.xs },
}));
