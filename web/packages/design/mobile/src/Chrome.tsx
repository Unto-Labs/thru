/**
 * Screen chrome: Screen wrapper, NavBar (52pt, 44/1fr/44 grid, hairline),
 * TabBar (56pt items, icon + 10pt mono label, brick indicator when active).
 */
import type { ComponentType, ReactNode } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { font, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";

export function Screen({
  children,
  scroll = true,
  hasTabBar = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  hasTabBar?: boolean;
}) {
  const styles = useStyles();
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

export function NavBar({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.nav}>
      <View style={styles.navSide}>{left}</View>
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

/* react-native-web implements SafeAreaView as padding on the container -
   including paddingBottom: env(safe-area-inset-bottom). With the tab bar inside
   that container the bar gets pushed up by the home indicator and the inset
   shows as dead space beneath it. A bottom bar should instead reach the edge
   and pad its own content, so on web the screen drops that bottom padding and
   the bar takes it. Native keeps SafeAreaView's behaviour untouched. */
const IS_WEB = Platform.OS === "web";
/* RN style types want a number; react-native-web passes a string through. */
const SAFE_AREA_BOTTOM = "env(safe-area-inset-bottom)" as unknown as number;
function withSafeAreaBottom(base: number): number {
  return IS_WEB
    ? (`calc(${base}px + env(safe-area-inset-bottom))` as unknown as number)
    : base;
}

/* Space under a bottom-anchored footer that the environment decides: on web
   the safe-area inset (the home indicator in an installed PWA, 0 in a
   browser tab whose toolbar already sits under the page) with `min` as the
   floor; elsewhere the fixed `native` value the caller supplies.

   Only a style dimension. On web the result is a CSS `max(...)` expression
   that react-native-web passes through to the stylesheet, typed as a number
   because that is what the style types accept; it is not a number to do
   arithmetic with or compare. For a real number on every platform use
   `useSafeAreaInsets` from react-native-safe-area-context in the app. */
export function safeAreaBottomInset(min: number, native: number): number {
  return IS_WEB
    ? (`max(${min}px, env(safe-area-inset-bottom))` as unknown as number)
    : native;
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
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <View style={styles.tabBar}>
      {items.map(({ key, label, Icon }) => {
        const isActive = key === active;
        const tint = isActive ? colors.accent : colors.fgSubtle;
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

const useStyles = makeStyles((c) => ({
  screen: {
    flex: 1,
    backgroundColor: c.bg,
    ...(IS_WEB ? { paddingBottom: 0 } : null),
  },
  scroll: { flex: 1 },
  scrollContentWithTabBar: { paddingBottom: withSafeAreaBottom(touch.tabH + 24) },
  nav: {
    height: touch.navH,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bg,
  },
  navSide: { width: 44, alignItems: "center", justifyContent: "center" },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: font.sansSemiBold,
    fontSize: text.md,
    color: c.fg,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bg,
    ...(IS_WEB ? { paddingBottom: SAFE_AREA_BOTTOM } : null),
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
    backgroundColor: c.accent,
  },
  tabLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  tabLabelActive: { fontFamily: font.monoSemiBold },
}));
