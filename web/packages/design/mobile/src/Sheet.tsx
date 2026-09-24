/**
 * Bottom sheet per the kit: scrim rgba(24,27,27,.64), panel radius 12 top,
 * 360ms slide, title row with close.
 *
 * Two headers: the default leading title with a close button, and a centred
 * title between a back slot and the close button, ruled off with a hairline,
 * for a sheet that steps through pages. Two heights: the content's own, and
 * `fixed`, which runs from just under the status bar to the bottom of the
 * screen so the header never moves between pages.
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
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
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { font, radius, space, text, touch } from "./tokens";
import { makeStyles, useThemeColors } from "./theme";
import { IconChevronLeft, IconClose } from "./Icons";
import { safeAreaBottomInset } from "./Chrome";

/* The sheet reaches the screen edge, so its own spacer clears the home
   indicator: the environment inset on web, the iPhone value natively. */
const DEFAULT_BOTTOM_INSET = safeAreaBottomInset(space[3], 34);

const IS_WEB = Platform.OS === "web";

/** The kit's sheet motion: 360ms on the standard curve. */
export const SHEET_DURATION_MS = 360;

/** Gap between the status bar and the top of a fixed-height sheet. */
const FIXED_SHEET_GAP = space[2];

/* A keyboard is taller than this; a browser toolbar sliding away is not. */
const KEYBOARD_MIN_HEIGHT = 120;

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
const browser = globalThis as unknown as {
  visualViewport?: BrowserViewport;
  document?: { documentElement: { clientHeight: number } };
};

/* Where the visible area is, for a sheet pinned to the layout viewport. On
   iOS web the layout viewport keeps its height when the keyboard opens; the
   visual viewport shrinks to what is above the keyboard and is panned down
   the layout viewport to keep the focused field in view. So the sheet's top
   follows the pan and its height is what is visible. The height is taken
   from the visual viewport rather than worked out from the layout
   viewport's: in an installed iOS web app the box a fixed element fills is
   sometimes the layout viewport and sometimes the whole screen. Natively a
   KeyboardAvoidingView does the moving, and only whether the keyboard is up
   is reported. */
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

export function Sheet({
  visible,
  title,
  onClose,
  onDismiss,
  onBack,
  backLabel = "Back",
  header = "leading",
  height = "content",
  topInset,
  animateIn = true,
  children,
  keyboardAvoiding = false,
  bottomInset = DEFAULT_BOTTOM_INSET,
  presentation = "sheet",
  dialogMinWidth = 840,
  dialogWidth = 480,
}: {
  visible: boolean;
  title: string;
  /** The close button. */
  onClose: () => void;
  /** A tap on the scrim, Escape, or the system back; defaults to `onClose`.
      Separate so a sheet can keep what was entered when it is only put
      away, and discard it on the close button. */
  onDismiss?: () => void;
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
  /** The dialog's width. */
  dialogWidth?: number;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isDialog = isSheetDialog(width, presentation, dialogMinWidth);
  const isFixed = height === "fixed" && !isDialog;
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible && !animateIn ? 1 : 0)).current;
  const keyboard = useKeyboardFrame(mounted && isFixed);
  const dismiss = onDismiss ?? onClose;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: SHEET_DURATION_MS,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [mounted, progress, visible]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [isDialog ? 24 : isFixed ? 800 : 400, 0],
  });

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
  const panel = (
    <Animated.View
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
        {
          opacity: isDialog ? progress : 1,
          transform: [{ translateY }],
        },
      ]}
    >
      {centered ? (
        <View style={styles.centeredHeader}>
          <View style={styles.headerSlot}>
            {onBack ? (
              <Pressable
                accessibilityLabel={backLabel}
                accessibilityRole="button"
                style={styles.headerButton}
                onPress={onBack}
              >
                <IconChevronLeft size={20} />
              </Pressable>
            ) : null}
          </View>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.centeredTitle}>
            {title}
          </Text>
          <View style={styles.headerSlot}>
            <Pressable
              accessibilityLabel={`Close ${title}`}
              accessibilityRole="button"
              style={styles.headerButton}
              onPress={onClose}
            >
              <IconClose color={colors.fgMuted} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            accessibilityLabel={`Close ${title}`}
            accessibilityRole="button"
            style={styles.close}
            onPress={onClose}
            hitSlop={8}
          >
            <IconClose />
          </Pressable>
        </View>
      )}
      <SheetLayoutContext.Provider value={{ dialog: isDialog, keyboardOpen: keyboard.open }}>
        {isFixed ? <View style={styles.fixedBody}>{children}</View> : children}
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
    <Modal visible={mounted} transparent animationType="none" onRequestClose={dismiss}>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable
          accessibilityLabel={`Close ${title}`}
          accessibilityRole="button"
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
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  centeredHeader: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    height: touch.navH,
    paddingHorizontal: space[1],
  },
  headerSlot: { width: touch.hitMin, height: touch.hitMin },
  headerButton: {
    width: touch.hitMin,
    height: touch.hitMin,
    alignItems: "center",
    justifyContent: "center",
  },
  centeredTitle: {
    flex: 1,
    color: c.fg,
    fontFamily: font.sansSemiBold,
    fontSize: text.md,
    textAlign: "center",
  },
}));
