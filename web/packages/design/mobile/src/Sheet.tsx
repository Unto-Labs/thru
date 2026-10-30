import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { font, radius, space, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { IconChevronLeft, IconClose, type IconProps } from "./Icons";
import { safeAreaBottomInset } from "./Chrome";
import { scrimAccessibilityProps } from "./scrimAccessibilityProps";
import { REDUCED_MOTION_MS, useReduceMotion } from "./reduceMotion";
import { sheetDragPosition, singleSheetReleaseTarget } from "./sheetGesture";
import { useSheetGesture } from "./useSheetGesture";
import { SheetGrabberBar, useSheetGrabberStyles } from "./SheetGrabber";

/* Clears the home indicator: the environment inset on web, the iPhone value
   natively. */
const DEFAULT_BOTTOM_INSET = safeAreaBottomInset(space[3], 34);

const IS_WEB = Platform.OS === "web";

/** The sheet's slide duration. Under reduced motion the sheet fades in
    REDUCED_MOTION_MS instead of sliding. */
export const SHEET_DURATION_MS = 360;

const SHADOW_ROOM = 48;

const FIXED_SHEET_GAP = space[2];

/* A keyboard is taller than this; a browser toolbar sliding away is not. */
const KEYBOARD_MIN_HEIGHT = 120;
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export interface SheetLayout {
  /** Drawn as a centred dialog rather than a bottom sheet. */
  dialog: boolean;
  /** The on-screen keyboard is up. */
  keyboardOpen: boolean;
}

const SheetLayoutContext = createContext<SheetLayout>({
  dialog: false,
  keyboardOpen: false,
});

/** How the sheet around this component is drawn. */
export function useSheetLayout(): SheetLayout {
  return useContext(SheetLayoutContext);
}

/** Whether a sheet with these settings is a dialog at this window width. */
export function isSheetDialog(
  width: number,
  presentation: "sheet" | "adaptive",
  dialogMinWidth: number
): boolean {
  return IS_WEB && presentation === "adaptive" && width >= dialogMinWidth;
}

/**
 * The part of a sheet page above its action row. It fills the room the row
 * leaves and scrolls when the sheet is too short for it. It needs a bounded
 * page around it: `flex: 1, minHeight: 0` in a `fixed` sheet, otherwise
 * `flexShrink: 1, minHeight: 0`.
 */
export function SheetBody({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const [height, setHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const fit = useMemo<SheetBodyFit>(
    () => ({ height, overflow: height > 0 ? Math.max(0, contentHeight - height) : 0 }),
    [height, contentHeight],
  );
  return (
    <SheetBodyFitContext.Provider value={fit}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(_width, h) => setContentHeight(h)}
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        showsVerticalScrollIndicator={false}
        style={styles.body}
      >
        {children}
      </ScrollView>
    </SheetBodyFitContext.Provider>
  );
}

export interface SheetBodyFit {
  /** The body's own height, 0 until laid out. */
  height: number;
  /** How far its content runs past that height; 0 when it fits. */
  overflow: number;
}

const SheetBodyFitContext = createContext<SheetBodyFit | null>(null);

/**
 * How a `SheetBody` around this component fits its content, or null outside
 * one. Content that can give up height (the Keypad's keys) takes the overflow
 * before the body scrolls.
 */
export function useSheetBodyFit(): SheetBodyFit | null {
  return useContext(SheetBodyFitContext);
}

interface KeyboardFrame {
  /** How far the visible area is panned down the layout viewport. */
  top: number;
  /** The visible area's height; 0 when unknown. */
  height: number;
  open: boolean;
}

const NO_KEYBOARD: KeyboardFrame = { top: 0, height: 0, open: false };

/* The browser globals this reads; the kit is typed without the DOM library. */
interface BrowserViewport {
  height: number;
  offsetTop: number;
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
  removeEventListener(type: "resize" | "scroll", listener: () => void): void;
}
interface BrowserElement {
  parentElement: BrowserElement | null;
  clientHeight: number;
  scrollHeight: number;
  children: ArrayLike<BrowserElement>;
  contains(element: BrowserElement): boolean;
  closest(selector: string): BrowserElement | null;
  querySelector(selector: string): BrowserElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
const browser = globalThis as unknown as {
  visualViewport?: BrowserViewport;
  getComputedStyle?: (element: BrowserElement) => { overflowY: string };
  getSelection?: () => { isCollapsed: boolean } | null;
  document?: {
    documentElement: { clientHeight: number };
    body: BrowserElement & { children: ArrayLike<BrowserElement> };
  };
  MutationObserver?: new (callback: () => void) => {
    observe(
      element: BrowserElement,
      options: {
        childList: boolean;
        subtree: boolean;
        attributes: boolean;
        attributeFilter: string[];
      }
    ): void;
    disconnect(): void;
  };
};

/* Only the top sheet is accessible, including when a second sheet opens. */
const sheetPanels = new Set<BrowserElement>();
const sheetBackgrounds = new Set<BrowserElement>();

function updateSheetBackgrounds(): void {
  sheetBackgrounds.forEach((element) => element.removeAttribute("aria-hidden"));
  sheetBackgrounds.clear();
  /* The SDK makes our portal inert when its wallet iframe takes over. */
  const top = Array.from(sheetPanels).reverse().find((panel) => !panel.closest("[inert]"));
  if (top && browser.document) hideOutside(browser.document.body, top);
}

/* Hides each branch holding neither the top sheet nor a live region; walks into
   branches that hold a live region so announcements still read. */
function hideOutside(parent: BrowserElement, top: BrowserElement): void {
  for (const element of Array.from(parent.children)) {
    if (element.contains(top) || element.closest("[aria-live]")) continue;
    if (element.querySelector("[aria-live]")) { hideOutside(element, top); continue; }
    if (element.getAttribute("aria-hidden") === "true") continue;
    element.setAttribute("aria-hidden", "true");
    sheetBackgrounds.add(element);
  }
}

/* On iOS web the layout viewport keeps its height when the keyboard opens;
   the visual viewport shrinks and is panned down it. The height comes from
   the visual viewport because in an installed iOS web app a fixed element
   fills sometimes the layout viewport and sometimes the whole screen.
   Natively a KeyboardAvoidingView does the moving. */
function useKeyboardFrame(active: boolean): KeyboardFrame {
  const [frame, setFrame] = useState<KeyboardFrame>(NO_KEYBOARD);

  useEffect(() => {
    if (!active) {
      setFrame(NO_KEYBOARD);
      return;
    }
    if (!IS_WEB) {
      const show = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
        () => setFrame({ top: 0, height: 0, open: true })
      );
      const hide = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
        () => setFrame(NO_KEYBOARD)
      );
      return () => {
        show.remove();
        hide.remove();
      };
    }
    const viewport = browser.visualViewport;
    const root = browser.document?.documentElement;
    if (!viewport || !root) return;
    const measure = () => {
      const top = Math.max(0, Math.round(viewport.offsetTop));
      const height = Math.round(viewport.height);
      /* The visible area is a keyboard's height shorter than the layout
         viewport. (An installed iOS web app's visible area is taller than
         its layout viewport, by the status bar, when nothing covers it.) */
      const open = root.clientHeight - height >= KEYBOARD_MIN_HEIGHT;
      setFrame((current) =>
        current.top === top && current.height === height && current.open === open
          ? current
          : { top, height, open }
      );
    };
    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, [active]);

  return frame;
}

/**
 * How far the sheet slides, in px: a dialog drops 24, a bottom sheet its
 * own height plus its shadow, so no part of it is on screen at either end.
 * Until the panel is measured it starts a window's height down, off screen
 * for any sheet. Under reduced motion it does not move; it only fades.
 */
export function sheetTravel({
  reduceMotion,
  dialog,
  panelHeight,
  windowHeight,
}: {
  reduceMotion: boolean;
  dialog: boolean;
  panelHeight: number;
  windowHeight: number;
}): number {
  if (reduceMotion) return 0;
  if (dialog) return 24;
  return (panelHeight > 0 ? panelHeight : windowHeight) + SHADOW_ROOM;
}

/** A plain icon button for sheet headers. */
export function IconButton({
  icon: Icon,
  accessibilityLabel,
  onPress,
  color,
}: {
  icon: ComponentType<IconProps>;
  accessibilityLabel: string;
  onPress: () => void;
  color?: string;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed ? { backgroundColor: colors.bgMuted } : null]}
    >
      <Icon size={20} color={color ?? colors.fgMuted} />
    </Pressable>
  );
}

export function Sheet({
  visible,
  title,
  onClose,
  onDismiss,
  swipeDismissible = true,
  dismissLabel,
  onBack,
  backLabel = "Back",
  header = "leading",
  height = "content",
  topInset,
  animateIn = true,
  onExited,
  children,
  keyboardAvoiding = false,
  bottomInset = DEFAULT_BOTTOM_INSET,
  presentation = "sheet",
  dialogMinWidth = 840,
  dialogWidth = 480,
  headerContent,
  headerOverContent = false,
  titleIcon,
  accessibilityLabel,
}: {
  visible: boolean;
  title: string;
  /** The close button. */
  onClose: () => void;
  /** A tap on the scrim, Escape, or the system back; defaults to `onClose`.
      Separate so a sheet can keep what was entered when it is only put
      away, and discard it on the close button. */
  onDismiss?: () => void;
  /** Allow downward drag dismissal from the header and, on web, fitting content. */
  swipeDismissible?: boolean;
  /** Names the scrim, only while `onDismiss` does something the close
      button does not. Without it the scrim is hidden from accessibility,
      since it would be a second "Close <title>". A tap, Escape and the
      system back dismiss either way. Ignored without `onDismiss`. */
  dismissLabel?: string;
  /** The centred header's back button; hidden when absent. */
  onBack?: () => void;
  backLabel?: string;
  /** `centered` puts the title between a back slot and the close button
      and rules the header off with a hairline. */
  header?: "leading" | "centered";
  /** `fixed` runs the sheet from just under the status bar to the bottom
      of the screen, so its header stays put while its content changes. On
      web it shortens from the bottom while the keyboard is up. */
  height?: "content" | "fixed";
  /** Native only: the status bar's height, for a fixed-height sheet. Web
      reads it from the environment. */
  topInset?: number;
  /** False shows the sheet already open - for a sheet that was on screen a
      moment ago and has only been remounted. */
  animateIn?: boolean;
  /** The sheet has finished leaving after `visible` went false. A parent
      that unmounts the sheet waits for this, so the sheet slides away
      instead of vanishing. */
  onExited?: () => void;
  children: ReactNode;
  keyboardAvoiding?: boolean;
  /** Space under the content; pass a safe-area-derived value when known.
      A fixed-height sheet drops it while the keyboard is up and in the
      dialog. */
  bottomInset?: number;
  /** Keep the native bottom sheet by default. `adaptive` uses a bounded
      dialog on wide web viewports while preserving the sheet elsewhere. */
  presentation?: "sheet" | "adaptive";
  /** Window width from which an adaptive sheet is a dialog. */
  dialogMinWidth?: number;
  dialogWidth?: number;
  /** Replaces the title row, for a sheet that draws its own header with
      its own close. */
  headerContent?: ReactNode;
  /** Draws the grabber and `headerContent` over the content instead of
      above it, for content that fills the sheet edge to edge (a camera). */
  headerOverContent?: boolean;
  /** Centred header only: a mark before the title, such as a logo. */
  titleIcon?: ReactNode;
  /** Names the panel as a modal dialog for assistive tech. */
  accessibilityLabel?: string;
}) {
  const styles = useStyles();
  const grabberStyles = useSheetGrabberStyles();
  const colors = useThemeColors();
  const { width, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const isDialog = isSheetDialog(width, presentation, dialogMinWidth);
  const isFixed = height === "fixed" && !isDialog;
  const [mounted, setMounted] = useState(visible);
  const panelRef = useRef<View>(null);
  const sheetRef = useRef<View>(null);
  const position = useRef(new Animated.Value(visible && !animateIn ? 0 : sheetTravel({
    reduceMotion: false, dialog: isDialog, panelHeight: 0, windowHeight,
  }))).current;
  const fade = useRef(new Animated.Value(visible && !animateIn ? 1 : 0)).current;
  const keyboard = useKeyboardFrame(mounted && isFixed);
  const dismiss = () => { if (visible) (onDismiss ?? onClose)(); };
  const close = () => { if (visible) onClose(); };
  const [panelHeight, setPanelHeight] = useState(0);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  const travel = sheetTravel({ reduceMotion: false, dialog: isDialog, panelHeight, windowHeight });
  const progress = position.interpolate({
    inputRange: [0, travel], outputRange: [1, 0], extrapolate: "clamp",
  });
  const springOpen = () => {
    if (reduceMotion) position.setValue(0);
    else Animated.spring(position, {
      toValue: 0, stiffness: 300, damping: 30, mass: 1,
      overshootClamping: true, useNativeDriver: true,
    }).start();
  };
  const gesture = useSheetGesture({
    position,
    panelRef: sheetRef,
    active: mounted && visible && !isDialog && panelHeight > 0,
    enabled: swipeDismissible && !keyboard.open,
    canStart: (event, surface) => {
      /* shortcut: native body drags stay with content until fit can be measured at the touch target. */
      if (!IS_WEB) return surface === "header";
      const panel = sheetRef.current as unknown as BrowserElement | null;
      if (browser.getSelection?.()?.isCollapsed === false) return false;
      if (event.nativeEvent.pageX < 24 || event.nativeEvent.pageX > width - 24) return false;
      const target = event.nativeEvent.target as unknown as BrowserElement;
      if (target.closest(EDITABLE_SELECTOR)) return false;
      if (surface === "header") return true;
      if (target.closest("button, a, [role='button'], [role='slider'], [role='checkbox'], [role='radio'], [role='switch'], video, audio, iframe")) return false;
      for (let node: BrowserElement | null = target; node && node !== panel; node = node.parentElement) {
        const overflow = browser.getComputedStyle?.(node).overflowY;
        if ((overflow === "auto" || overflow === "scroll") && node.clientHeight === 0) return false;
        if (node.clientHeight > 0 && node.scrollHeight > node.clientHeight) return false;
      }
      return true;
    },
    canClaim: () => true,
    snapshot: (start) => ({ start, height: panelHeight }),
    dragPosition: (drag, dy) => sheetDragPosition(drag.start, dy),
    releaseTarget: (drag, g) => singleSheetReleaseTarget({ dy: g.dy, velocity: g.vy, height: drag.height }),
    settle: springOpen,
    cancel: springOpen,
    onDismiss: dismiss,
  });

  useEffect(() => {
    gesture.cancel();
  }, [panelHeight, windowHeight, width, isDialog, reduceMotion, gesture]);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!IS_WEB || !mounted || !panelRef.current || !browser.document) return;
    const panel = panelRef.current as unknown as BrowserElement;
    sheetPanels.add(panel);
    updateSheetBackgrounds();
    const observer = browser.MutationObserver
      ? new browser.MutationObserver(updateSheetBackgrounds)
      : null;
    observer?.observe(browser.document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["inert", "aria-live"],
    });
    return () => {
      observer?.disconnect();
      sheetPanels.delete(panel);
      updateSheetBackgrounds();
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    if (!reduceMotion) fade.setValue(1);
    if (reduceMotion && visible) position.setValue(0);
    const animation = Animated.timing(reduceMotion ? fade : position, {
      toValue: reduceMotion ? (visible ? 1 : 0) : (visible ? 0 : travel),
      duration: reduceMotion ? REDUCED_MOTION_MS : SHEET_DURATION_MS,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
        onExitedRef.current?.();
      }
    });
    return () => animation.stop();
  }, [mounted, position, fade, reduceMotion, visible, travel]);

  const translateY = reduceMotion ? 0 : position;

  /* On web the fixed sheet follows the visible area: its top stays just under
     the status bar even when iOS pans the page for the keyboard, and its
     bottom rides the keyboard. */
  const fixedWebFrame =
    isFixed && IS_WEB
      ? {
          top: `calc(env(safe-area-inset-top, 0px) + ${
            FIXED_SHEET_GAP + keyboard.top
          }px)` as unknown as number,
          ...(keyboard.height > 0
            ? {
                height: `calc(${keyboard.height - FIXED_SHEET_GAP}px - env(safe-area-inset-top, 0px))` as unknown as number,
              }
            : { bottom: 0 }),
        }
      : null;

  const centered = header === "centered";
  const closeButton = <IconButton icon={IconClose} accessibilityLabel={`Close ${title}`} onPress={close} />;
  const chrome = (
    <>
      {!isDialog && swipeDismissible ? (
        <View
          testID="sheet-grabber"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          style={[grabberStyles.grabberZone, styles.headerDrag, styles.dragArea]}
          {...gesture.header.panHandlers}
        >
          <SheetGrabberBar />
        </View>
      ) : null}
      {headerContent != null ? (isDialog ? headerContent : (
        <View style={[styles.headerDrag, styles.dragArea]} {...gesture.header.panHandlers}>
          {headerContent}
        </View>
      )) : (centered ? (
        <View style={[styles.centeredHeader, !isDialog ? styles.headerDrag : null]} {...gesture.header.panHandlers}>
          <View style={styles.headerSlot}>
            {onBack ? (
              <IconButton icon={IconChevronLeft} accessibilityLabel={backLabel} onPress={onBack} color={colors.fg} />
            ) : null}
          </View>
          <View style={[styles.centeredTitleSlot, !isDialog ? styles.dragArea : null]}>
            {titleIcon}
            <Text accessibilityRole="header" numberOfLines={1} style={styles.centeredTitle}>
              {title}
            </Text>
          </View>
          {closeButton}
        </View>
      ) : (
        <View style={[styles.header, !isDialog ? styles.headerDrag : null]} {...gesture.header.panHandlers}>
          <Text style={[styles.title, !isDialog ? styles.dragArea : null]}>{title}</Text>
          {closeButton}
        </View>
      ))}
    </>
  );
  const panel = (
    <Animated.View
      ref={sheetRef}
      pointerEvents={visible ? "auto" : "none"}
      onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
      style={[
        styles.panel,
        isDialog
          ? [styles.dialogPanel, { maxWidth: dialogWidth }]
          : isFixed
            ? IS_WEB
              ? [styles.fixedPanel, fixedWebFrame]
              : [styles.fixedNativePanel, { marginTop: (topInset ?? 0) + FIXED_SHEET_GAP }]
            : keyboardAvoiding
              ? styles.keyboardPanel
              : styles.absolutePanel,
        /* Edge-to-edge content takes the sheet's rounded top. */
        headerOverContent ? styles.clip : null,
        {
          opacity: reduceMotion ? fade : isDialog ? progress : 1,
          transform: [{ translateY }],
        },
      ]}
      {...(accessibilityLabel
        ? { accessibilityLabel, accessibilityViewIsModal: true, "aria-modal": true, role: "dialog" as const }
        : null)}
    >
      {headerOverContent ? (
        <View pointerEvents="box-none" style={styles.headerOver}>{chrome}</View>
      ) : chrome}
      <SheetLayoutContext.Provider value={{ dialog: isDialog, keyboardOpen: keyboard.open }}>
        {IS_WEB || isFixed ? <View style={isFixed ? styles.fixedBody : styles.contentBody} {...(IS_WEB ? gesture.body.panHandlers : null)}>
          {children}
        </View> : children}
      </SheetLayoutContext.Provider>
      {(height === "fixed" && isDialog) || keyboard.open ? null : (
        <View style={{ height: bottomInset }} />
      )}
      {isFixed && IS_WEB && keyboard.open ? (
        /* The sheet ends where the visible area does, above the keyboard.
           iOS 26 draws the form accessory bar as a floating translucent pill,
           so the strip around it would show the page behind the sheet; this
           carries the sheet's own ground down under the keyboard instead. */
        <View pointerEvents="none" style={styles.keyboardSkirt} />
      ) : null}
    </Animated.View>
  );

  return (
    <Modal
      aria-label={title}
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={dismiss}
    >
      <Animated.View ref={panelRef} style={[styles.scrim, { opacity: reduceMotion ? Animated.multiply(progress, fade) : progress }]}>
        <Pressable
          {...scrimAccessibilityProps(IS_WEB, onDismiss ? dismissLabel : undefined)}
          style={styles.scrimPressable}
          onPress={dismiss}
        />
      </Animated.View>
      {isDialog ? (
        <KeyboardAvoidingView
          pointerEvents="box-none"
          style={styles.dialogLayer}
        >
          {panel}
        </KeyboardAvoidingView>
      ) : isFixed && !IS_WEB ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          pointerEvents="box-none"
          style={styles.fixedNativeLayer}
        >
          {panel}
        </KeyboardAvoidingView>
      ) : keyboardAvoiding && !isFixed ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          pointerEvents="box-none"
          style={styles.keyboardLayer}
        >
          {panel}
        </KeyboardAvoidingView>
      ) : (
        panel
      )}
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: c.scrim },
  scrimPressable: { flex: 1 },
  panel: {
    backgroundColor: c.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 4,
  },
  absolutePanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    ...(IS_WEB
      ? {
          maxHeight: `calc(100dvh - env(safe-area-inset-top, 0px) - ${FIXED_SHEET_GAP}px)` as unknown as number,
        }
      : null),
  },
  fixedPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingTop: 0,
    boxShadow: `0 -20px 48px ${c.sheetShadow}`,
  } as never,
  fixedNativeLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  fixedNativePanel: {
    flex: 1,
    paddingTop: 0,
    shadowColor: c.sheetShadow,
    shadowOffset: { width: 0, height: -20 },
    shadowOpacity: 1,
    shadowRadius: 24,
  },
  fixedBody: { flex: 1, minHeight: 0 },
  contentBody: { flexShrink: 1, minHeight: 0 },
  headerOver: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 1 },
  clip: { overflow: "hidden" },
  headerDrag: IS_WEB ? { userSelect: "none" } as never : {},
  dragArea: IS_WEB ? { touchAction: "pan-x pinch-zoom" } as never : {},
  /* react-native-web puts every ScrollView on its own layer
     (translateZ(0)), and text in it can land a pixel off where the sheet
     would draw it. The body stays on the sheet's layer. */
  body: IS_WEB ? { transform: "none" } : {},
  bodyContent: { flexGrow: 1 },
  keyboardSkirt: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "100%",
    /* Taller than any keyboard; the screen edge clips it. */
    height: 1000,
    backgroundColor: c.bg,
  },
  keyboardLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  keyboardPanel: { width: "100%" },
  dialogLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialogPanel: {
    borderColor: c.border,
    borderRadius: radius.sheet,
    borderWidth: 1,
    maxHeight: "calc(100dvh - 48px)" as unknown as number,
    overflow: "hidden",
    paddingTop: 0,
    width: "100%",
  },
  header: {
    height: touch.navH,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: touch.screenX,
    paddingRight: 6,
  },
  title: { flex: 1, fontFamily: font.sansSemiBold, fontSize: text.md, color: c.fg },
  centeredHeader: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    height: touch.navH,
    paddingHorizontal: 6,
  },
  headerSlot: { width: touch.hitMin, height: touch.hitMin },
  iconButton: { width: touch.hitMin, height: touch.hitMin, alignItems: "center", justifyContent: "center" },
  centeredTitleSlot: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: space[2],
    justifyContent: "center",
    minWidth: 0,
  },
  centeredTitle: {
    flexShrink: 1,
    color: c.fg,
    fontFamily: font.sansSemiBold,
    fontSize: text.md,
    textAlign: "center",
  },
}));
