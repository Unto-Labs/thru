/**
 * The Desktop shell's sidebar (the Activity handoff, §7; design/History.dc.html
 * section 06), for web at the wide layout:
 * - 224 wide, a hairline at its right. The handoff drew 240; 224 leaves the
 *   page 416 at the app's 640 breakpoint and 800 at 1024, for two columns;
 * - the 64pt lockup (disc 24 and wordmark) over a hairline;
 * - nav rows of 44: a 20 glyph and a 15/500 label in fgMuted, the active row
 *   in fg on bgMuted with a 2pt brick bar at its left edge;
 * - the account row of 64 at the bottom: a 32 avatar, the account's name and
 *   its shortened address.
 * The page column beside it is the app's: centred, 40 side padding, capped
 * per screen (880 for a feed, 800 for a detail).
 */
import { useState } from "react";
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { BrandLockup } from "./BrandWordmark";
import type { TabItem } from "./Chrome";
import { TapHaptic } from "./TapHaptic";
import { font, text } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";

export const DESKTOP_SHELL = {
  sidebarWidth: 224,
  gutter: 40,
  feedWidth: 880,
  detailWidth: 800,
} as const;

export interface DesktopSidebarProps<K extends string> {
  items: readonly TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  /** The signed-in account, for the row at the bottom. */
  account?: { name: string; address: string } | null;
  /** Which rows tick on iOS web when pressed (see TapHaptic). */
  tapHaptic?: (key: K) => boolean;
  style?: StyleProp<ViewStyle>;
}

const pointer = Platform.OS === "web" ? ({ cursor: "pointer" } as unknown as ViewStyle) : null;

/* ta1kqV…9fq2: six, an ellipsis, four. */
function sidebarAddress(address: string): string {
  return address.length <= 11 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function SidebarRow<K extends string>({
  item,
  active,
  onPress,
  tapHaptic,
}: {
  item: TabItem<K>;
  active: boolean;
  onPress: () => void;
  tapHaptic: boolean;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const tint = active || hovered ? colors.fg : colors.fgMuted;
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pointer,
        active || hovered || pressed ? { backgroundColor: colors.bgMuted } : null,
      ]}
    >
      {active ? <View style={styles.bar} /> : null}
      <item.Icon size={20} color={tint} />
      <Text style={[styles.label, { color: tint }]}>{item.label}</Text>
      {tapHaptic ? <TapHaptic /> : null}
    </Pressable>
  );
}

export function DesktopSidebar<K extends string>({
  items,
  active,
  onChange,
  account,
  tapHaptic,
  style,
}: DesktopSidebarProps<K>) {
  const styles = useStyles();
  return (
    <View style={[styles.sidebar, style]}>
      <View accessibilityLabel="Thru" accessibilityRole="image" style={styles.lockup}>
        <BrandLockup />
      </View>
      <View accessibilityRole="tablist" style={styles.nav}>
        {items.map((item) => (
          <SidebarRow
            key={item.key}
            item={item}
            active={item.key === active}
            onPress={() => onChange(item.key)}
            tapHaptic={tapHaptic?.(item.key) ?? false}
          />
        ))}
      </View>
      {account ? (
        <View
          accessible
          accessibilityLabel={`${account.name}, ${sidebarAddress(account.address)}`}
          style={styles.account}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{account.address.slice(0, 2).toUpperCase()}</Text>
          </View>
          <View style={styles.accountText}>
            <Text style={styles.accountName} numberOfLines={1}>
              {account.name}
            </Text>
            <Text style={styles.accountAddress} numberOfLines={1}>
              {sidebarAddress(account.address)}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  sidebar: {
    width: DESKTOP_SHELL.sidebarWidth,
    flexDirection: "column",
    backgroundColor: c.bg,
    borderRightWidth: 1,
    borderRightColor: c.border,
  },
  lockup: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: c.bgMuted,
  },
  nav: { paddingVertical: 12 },
  row: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
  },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: c.accent },
  label: { fontFamily: font.sansMedium, fontSize: text.base },
  account: {
    marginTop: "auto",
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: c.bgMuted,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.bgInset,
  },
  avatarText: { fontFamily: font.mono, fontSize: text.xxs, color: c.fgMuted },
  accountText: { flex: 1, minWidth: 0, gap: 2 },
  accountName: { fontFamily: font.sansMedium, fontSize: 13, color: c.fg },
  accountAddress: { fontFamily: font.mono, fontSize: text.xxs, color: c.fgMuted },
}));
