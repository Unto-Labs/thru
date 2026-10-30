import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { IconTile, type IconTileTone } from "./Activity";
import { Skeleton } from "./Bits";
import { safeAreaBottomInset } from "./Chrome";
import type { IconProps } from "./Icons";
import { isReduceMotionEnabled, useReduceMotion } from "./reduceMotion";
import { SHEET_DURATION_MS, Sheet, isSheetDialog } from "./Sheet";
import { scrimAccessibilityProps } from "./scrimAccessibilityProps";
import {
  SHEET_HALF_SCRIM,
  SHEET_SNAP_MS,
  detentTop,
  dragTop,
  releaseTarget,
  sheetGeometry,
  type SheetDetent,
} from "./sheetDetents";
import { font, radius, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { useSheetGesture } from "./useSheetGesture";
import { SheetGrabberBar, useSheetGrabberStyles } from "./SheetGrabber";

const IS_WEB = Platform.OS === "web";
const CURVE = Easing.bezier(0.2, 0.8, 0.2, 1);
const FADE_MS = 200;

export interface DetentSheetProps {
  visible: boolean;
  swipeDismissible?: boolean;
  /** One sentence for assistive tech: "Sent, −$10.00, Completed". */
  accessibilityLabel: string;
  detent: SheetDetent;
  /** The sheet settled at another detent after a drag. */
  onDetentChange: (detent: SheetDetent) => void;
  /** A swipe down, a scrim tap, Escape or the system back. The caller then
      sets `visible` false, and the sheet slides out from wherever it is. */
  onDismiss: () => void;
  /** SheetHeader: a drag surface, with the grabber above it. */
  header: ReactNode;
  /** SheetFooter: pinned at the bottom at every detent. */
  footer: ReactNode;
  /** The body. It is clipped at half height and scrolls at full. */
  children: ReactNode;
  /** Native only: the status bar's height. */
  topInset?: number;
  /** Window width from which this is a centred dialog (web). */
  dialogMinWidth?: number;
  dialogWidth?: number;
}

export function DetentSheet({
  visible,
  swipeDismissible = true,
  accessibilityLabel,
  detent,
  onDetentChange,
  onDismiss,
  header,
  footer,
  children,
  topInset,
  dialogMinWidth = 840,
  dialogWidth = 480,
}: DetentSheetProps) {
  const styles = useStyles();
  const { width, height } = useWindowDimensions();
  const isDialog = isSheetDialog(width, "adaptive", dialogMinWidth);
  /* The web reads env(safe-area-inset-top) off an empty view that tall
     (rendered below), since a drag needs it as a number. */
  const [webSafeTop, setWebSafeTop] = useState(0);
  const safeTop = IS_WEB ? webSafeTop : (topInset ?? 0);
  const geometry = useMemo(() => sheetGeometry(height, safeTop), [height, safeTop]);
  const reduceMotion = useReduceMotion();

  const [mounted, setMounted] = useState(visible);
  const panelRef = useRef<View>(null);
  const dismiss = () => { if (visible) onDismiss(); };
  const top = useRef(new Animated.Value(geometry.closedTop)).current;
  /* Opacity: the reduce-motion fades in and out. */
  const fade = useRef(new Animated.Value(0)).current;

  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const detentRef = useRef(detent);
  detentRef.current = detent;

  const run = (animation: Animated.CompositeAnimation, done?: () => void) => {
    animation.start(({ finished }) => {
      if (finished) done?.();
    });
  };
  const slide = (to: number, ms: number, done?: () => void) =>
    run(Animated.timing(top, { toValue: to, duration: ms, easing: CURVE, useNativeDriver: false }), done);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);
  useEffect(() => {
    if (!mounted) return;
    if (isDialog) {
      /* The kit Sheet draws the dialog and its motion. */
      if (!visible) {
        top.setValue(geometryRef.current.closedTop);
        setMounted(false);
      }
      return;
    }
    const target = visible ? detentTop(detentRef.current, geometryRef.current) : geometryRef.current.closedTop;
    const done = () => {
      if (visible) return;
      top.setValue(geometryRef.current.closedTop);
      setMounted(false);
    };
    if (reduceMotion) {
      if (visible) top.setValue(target);
      run(Animated.timing(fade, { toValue: visible ? 1 : 0, duration: FADE_MS, easing: CURVE, useNativeDriver: false }), done);
    } else {
      fade.setValue(1);
      slide(target, SHEET_DURATION_MS, done);
    }
    /* Open and close only; the effect below moves it between detents. */
  }, [isDialog, mounted, visible]);

  /* Only when the detent moved: setValue stops a running animation, so a
     no-op here would cut the open slide short. */
  const lastGeometry = useRef(geometry);
  useEffect(() => {
    const before = lastGeometry.current;
    lastGeometry.current = geometry;
    if (!mounted || !visible || isDialog) return;
    const target = detentTop(detentRef.current, geometry);
    if (target !== detentTop(detentRef.current, before)) top.setValue(target);
  }, [geometry]);

  const snapTo = (target: SheetDetent) => {
    const to = detentTop(target, geometryRef.current);
    if (isReduceMotionEnabled()) top.setValue(to);
    else slide(to, SHEET_SNAP_MS);
  };

  const lastDetent = useRef(detent);
  const settleAt = (target: SheetDetent) => {
    snapTo(target);
    if (target !== detentRef.current) {
      lastDetent.current = target;
      onDetentChange(target);
    }
  };

  /* A detent set from outside. settleAt has already moved to the detents it
     reports. */
  useEffect(() => {
    const moved = lastDetent.current !== detent;
    lastDetent.current = detent;
    if (moved && mounted && visible) snapTo(detent);
  }, [detent]);

  const scrollY = useRef(0);
  const gesture = useSheetGesture({
    position: top,
    panelRef,
    enabled: swipeDismissible,
    active: mounted && visible && !isDialog,
    canClaim: (surface, g) => {
      if (surface === "header" || detentRef.current === "half") return true;
      /* At full, the body scrolls; only a pull down from its top moves the sheet. */
      return g.dy > 0 && scrollY.current <= 0;
    },
    snapshot: (start) => ({ start, from: detentRef.current }),
    dragPosition: (drag, dy) => dragTop(drag.start, dy, geometryRef.current),
    releaseTarget: (drag, g) => releaseTarget({
      top: dragTop(drag.start, g.dy, geometryRef.current),
      velocity: g.vy,
      from: drag.from,
      geometry: geometryRef.current,
    }),
    settle: settleAt,
    cancel: () => snapTo(detentRef.current),
    onDismiss: dismiss,
  });

  useEffect(() => { gesture.cancel(); }, [geometry, detent, reduceMotion, gesture]);

  const [footerHeight, setFooterHeight] = useState(0);
  const onFooterLayout = (event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  };

  if (isDialog) {
    return (
      <Sheet
        visible={visible}
        swipeDismissible={swipeDismissible}
        title={accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        headerContent={header}
        onClose={onDismiss}
        presentation="adaptive"
        dialogMinWidth={dialogMinWidth}
        dialogWidth={dialogWidth}
        bottomInset={0}
      >
        <ScrollView style={styles.dialogBody}>{children}</ScrollView>
        {footer}
      </Sheet>
    );
  }

  if (!mounted) return null;

  const scrimOpacity = top.interpolate({
    inputRange: [geometry.fullTop, geometry.halfTop, geometry.closedTop],
    outputRange: [1, SHEET_HALF_SCRIM, 0],
    extrapolate: "clamp",
  });

  const panelHeight = geometry.closedTop - geometry.fullTop;
  const footerShift = top.interpolate({
    inputRange: [geometry.halfTop, geometry.closedTop],
    outputRange: [0, geometry.closedTop - geometry.halfTop],
    extrapolateLeft: "clamp",
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      {IS_WEB ? (
        <View
          pointerEvents="none"
          style={styles.safeTopProbe}
          onLayout={(event) => setWebSafeTop(event.nativeEvent.layout.height)}
        />
      ) : null}
      <Animated.View style={[styles.scrim, { opacity: reduceMotion ? Animated.multiply(scrimOpacity, fade) : scrimOpacity }]}>
        {/* It does what the header's Close does, so it is hidden from
            assistive tech and the keyboard; pointers still tap it. */}
        <Pressable {...scrimAccessibilityProps(IS_WEB)} style={styles.fill} onPress={dismiss} />
      </Animated.View>
      {/* Holds the panel and its pinned footer together so VoiceOver's modal
          scope and aria-modal both reach the footer. */}
      <View
        ref={panelRef}
        accessibilityLabel={accessibilityLabel}
        accessibilityViewIsModal
        onAccessibilityEscape={dismiss}
        aria-modal
        role="dialog"
        pointerEvents={visible ? "box-none" : "none"}
        style={styles.dialogLayer}
      >
      <Animated.View
        style={[
          styles.panel,
          {
            top: geometry.fullTop,
            height: panelHeight,
            opacity: fade,
            transform: [{ translateY: reduceMotion ? detentTop(detent, geometry) - geometry.fullTop : Animated.subtract(top, geometry.fullTop) }],
          },
        ]}
      >
        <View style={styles.handle} {...gesture.header.panHandlers}>
          <SheetGrabber
            expanded={detent === "full"}
            onPress={() => settleAt(detent === "full" ? "half" : "full")}
          />
          {header}
        </View>
        <View style={styles.fill} {...gesture.body.panHandlers}>
          <ScrollView
            scrollEnabled={detent === "full"}
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            style={[styles.fill, styles.body]}
            contentContainerStyle={{ paddingBottom: footerHeight }}
          >
            {children}
          </ScrollView>
        </View>
      </Animated.View>
      <Animated.View
        onLayout={onFooterLayout}
        style={[styles.footerLayer, { opacity: fade, transform: [{ translateY: reduceMotion ? 0 : footerShift }] }]}
      >
        {footer}
      </Animated.View>
      </View>
    </Modal>
  );
}

/** The grabber, also a button that expands or collapses the sheet:
    assistive tech cannot drag. */
function SheetGrabber({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const styles = useSheetGrabberStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? "Collapse" : "Expand"}
      aria-expanded={expanded}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={styles.grabberZone}
    >
      <SheetGrabberBar />
    </Pressable>
  );
}

/** A detail sheet's header: the kind's tile and name, then its actions,
    over a hairline. `loading` draws the tile and title as skeletons. */
export function SheetHeader({
  icon,
  tone = "neutral",
  title,
  loading = false,
  actions,
}: {
  icon?: ComponentType<IconProps>;
  tone?: IconTileTone;
  title: string;
  loading?: boolean;
  actions: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.header}>
      {loading ? (
        <>
          <Skeleton height={32} width={32} />
          <View style={styles.headerTitleSlot}>
            <Skeleton height={14} width={120} />
          </View>
        </>
      ) : (
        <>
          {icon ? <IconTile icon={icon} tone={tone} /> : null}
          <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
            {title}
          </Text>
        </>
      )}
      <View style={styles.headerActions}>{actions}</View>
    </View>
  );
}

/** The action row pinned under a sheet's body, then the safe area, or a
    fixed inset in a panel or dialog. */
export function SheetFooter({ children, inset = "safe-area" }: { children: ReactNode; inset?: "safe-area" | "panel" }) {
  const styles = useStyles();
  return (
    <View style={styles.footer}>
      {children}
      <View style={{ height: inset === "panel" ? 16 : safeAreaBottomInset(16, 34) }} />
    </View>
  );
}

/** The detail as a column at the right of a wide web layout. Opening and
    closing animate its width, so the column beside it gives way and comes
    back. */
export function DetailPanel({
  open,
  closing = false,
  opening = false,
  accessibilityLabel,
  header,
  footer,
  children,
  style,
}: {
  open: boolean;
  /** Mounting just as it closes (a route change mounts the screen anew):
      start open, then close, so the close still slides. */
  closing?: boolean;
  /** Mounting just as it opens: start at no width, so the open slides.
      Otherwise an open panel mounts at full width - a page loaded on a
      transaction, or a move from one transaction to the next. */
  opening?: boolean;
  accessibilityLabel: string;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const width = useRef(
    new Animated.Value(closing || (open && !opening) ? DETAIL_PANEL_WIDTH : 0),
  ).current;
  const [shown, setShown] = useState(open || closing);
  useEffect(() => {
    if (reduceMotion) {
      width.setValue(open ? DETAIL_PANEL_WIDTH : 0);
      setShown(open);
      return;
    }
    if (open) setShown(true);
    const animation = Animated.timing(width, {
      toValue: open ? DETAIL_PANEL_WIDTH : 0,
      duration: SHEET_SNAP_MS,
      easing: CURVE,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
    return () => animation.stop();
  }, [open, reduceMotion, width]);
  if (!shown) return null;
  return (
    <Animated.View style={[styles.panelColumn, { width }, style]}>
      <View accessibilityLabel={accessibilityLabel} role="region" style={styles.panelInner}>
        {header}
        <ScrollView style={styles.fill}>{children}</ScrollView>
        {footer}
      </View>
    </Animated.View>
  );
}

export const DETAIL_PANEL_WIDTH = 440;

const useStyles = makeStyles((c) => ({
  fill: { flex: 1, minHeight: 0 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: c.scrim },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: c.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: "hidden",
    boxShadow: `0 -20px 48px ${c.sheetShadow}`,
  },
  footerLayer: { position: "absolute", left: 0, right: 0, bottom: 0 },
  safeTopProbe: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 0,
    height: "env(safe-area-inset-top, 0px)" as unknown as number,
  },
  dialogBody: { flexShrink: 1 },
  /* The web: a pull down from the top of the body at full moves the sheet,
     so the browser must not bounce the body under it. */
  body: (IS_WEB ? { overscrollBehavior: "none" } : {}) as object,
  /* The drag surface: a mouse drag must not select the title. */
  handle: { userSelect: "none" } as object,
  dialogLayer: { ...StyleSheet.absoluteFillObject },
  header: {
    height: touch.navH,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: touch.screenX,
    paddingRight: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bg,
  },
  headerTitleSlot: { flex: 1 },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.sansSemiBold,
    fontSize: text.md,
    lineHeight: 22,
    letterSpacing: -0.25,
    color: c.fg,
  },
  headerActions: { flexDirection: "row", alignItems: "center" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 12,
    paddingHorizontal: touch.screenX,
    backgroundColor: c.bg,
  },
  panelColumn: { overflow: "hidden", alignSelf: "stretch" },
  panelInner: {
    width: DETAIL_PANEL_WIDTH,
    flex: 1,
    backgroundColor: c.bg,
    borderLeftWidth: 1,
    borderLeftColor: c.border,
  },
}));
