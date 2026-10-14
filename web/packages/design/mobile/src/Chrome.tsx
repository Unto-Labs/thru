/**
 * Screen chrome: Screen wrapper, NavBar (52pt, 44/1fr/44 grid, hairline; on
 * web it starts lower under an overlaid status bar, see NAV_TOP_GAP),
 * TabBar (56pt items, icon + 10pt mono label, brick indicator when active).
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { TapHaptic } from "./TapHaptic";
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

export interface NavBarProps {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  /** The large-title variant's compact bar. Put LargeTitle (28/700) at the
      top of the scroll content and this bar over it, as a sibling of the
      ScrollView: it stays hidden while the large title shows, and fades in
      (150ms, instant under reduce motion) once `collapsed` says the title
      has scrolled under it. */
  large?: { collapsed: boolean };
}

export function NavBar({ title, left, right, large }: NavBarProps) {
  const styles = useStyles();
  const bar = (
    <View style={styles.nav}>
      <View style={styles.navSide}>{left}</View>
      <Text accessibilityRole="header" style={styles.navTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.navSide}>{right}</View>
    </View>
  );
  return large ? <CollapsingBar collapsed={large.collapsed}>{bar}</CollapsingBar> : bar;
}

function CollapsingBar({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(collapsed ? 1 : 0)).current;
  const reduceMotion = useRef(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        reduceMotion.current = reduce;
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (reduceMotion.current) {
      opacity.setValue(collapsed ? 1 : 0);
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: collapsed ? 1 : 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [collapsed, opacity]);
  return (
    <Animated.View
      aria-hidden={!collapsed}
      accessibilityElementsHidden={!collapsed}
      importantForAccessibility={collapsed ? "auto" : "no-hide-descendants"}
      style={[styles.navOverlay, { opacity, pointerEvents: collapsed ? "box-none" : "none" }]}
    >
      {children}
    </Animated.View>
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
/* iOS 27 blurs a band below the status bar of an installed web app, about
   40pt deep, and whatever is drawn there comes out soft: a bar right under
   the status bar, its title included. On web the bar starts this much lower:
   24pt where the page runs under the status bar (an installed iPhone app in
   portrait), nothing where the top inset is 0 (a browser tab, desktop,
   Android, landscape). */
const NAV_TOP_GAP = "min(24px, env(safe-area-inset-top))";

/** The NavBar's height, the gap above it included: what content that sticks
    under the bar offsets by. On web a CSS expression typed as a number, like
    safeAreaBottomInset's, so a style value only. */
export const navBarHeight: number = IS_WEB
  ? (`calc(${touch.navH}px + ${NAV_TOP_GAP})` as unknown as number)
  : touch.navH;

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
  tapHaptic,
}: {
  items: readonly TabItem<K>[];
  active: K;
  onChange: (t: K) => void;
  /** Which tabs tick on iOS web when pressed (see TapHaptic). */
  tapHaptic?: (key: K) => boolean;
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
            {tapHaptic?.(key) ? <TapHaptic /> : null}
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
    height: navBarHeight,
    ...(IS_WEB ? { paddingTop: NAV_TOP_GAP as unknown as number } : null),
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bg,
  },
  navSide: { width: 44, alignItems: "center", justifyContent: "center" },
  navOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3 },
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
