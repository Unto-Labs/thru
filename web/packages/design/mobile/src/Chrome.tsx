/**
 * Screen chrome: Screen wrapper, NavBar (52pt, 44/1fr/44 grid, hairline),
 * TabBar (56pt items, icon + 10pt mono label, brick indicator when active).
 */
import type { ComponentType, ReactNode } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, font, text, touch } from "./tokens";

export function Screen({
  children,
  scroll = true,
  hasTabBar = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  hasTabBar?: boolean;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={hasTabBar ? styles.scrollContentWithTabBar : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.scroll, hasTabBar ? styles.scrollContentWithTabBar : null]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function NavBar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.nav}>
      <View style={styles.navSide} />
      <Text style={styles.navTitle}>{title}</Text>
      <View style={styles.navSide}>{right}</View>
    </View>
  );
}

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  Icon: ComponentType<{ size?: number; color?: string }>;
}

export function TabBar<K extends string>({
  items,
  active,
  onChange,
}: {
  items: readonly TabItem<K>[];
  active: K;
  onChange: (t: K) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {items.map(({ key, label, Icon }) => {
        const isActive = key === active;
        const tint = isActive ? color.accent : color.fgSubtle;
        return (
          <Pressable
            key={key}
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={styles.tabItem}
            onPress={() => onChange(key)}
          >
            {isActive ? <View style={styles.tabIndicator} /> : null}
            <Icon size={22} color={tint} />
            <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : null, { color: tint }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  scrollContentWithTabBar: { paddingBottom: touch.tabH + 24 },
  nav: {
    height: touch.navH,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
  navSide: { width: 44, alignItems: "center", justifyContent: "center" },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: font.sansSemiBold,
    fontSize: text.md,
    color: color.fg,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  tabItem: {
    flex: 1,
    height: touch.tabH,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tabIndicator: {
    position: "absolute",
    top: -1,
    left: 14,
    right: 14,
    height: 2,
    backgroundColor: color.accent,
  },
  tabLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  tabLabelActive: { fontFamily: font.monoSemiBold },
});
