/**
 * Bottom sheet per the kit: scrim rgba(24,27,27,.64), panel radius 12 top,
 * 360ms slide, title row with close.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
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
import { makeStyles } from "./theme";
import { IconClose } from "./Icons";
import { safeAreaBottomInset } from "./Chrome";

/* The sheet reaches the screen edge, so its own spacer clears the home
   indicator: the environment inset on web, the iPhone value natively. */
const DEFAULT_BOTTOM_INSET = safeAreaBottomInset(space[3], 34);

export function Sheet({
  visible,
  title,
  onClose,
  children,
  keyboardAvoiding = false,
  bottomInset = DEFAULT_BOTTOM_INSET,
  presentation = "sheet",
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  keyboardAvoiding?: boolean;
  /** Space under the content; pass a safe-area-derived value when known. */
  bottomInset?: number;
  /** Keep the native bottom sheet by default. `adaptive` uses a bounded
      dialog on wide web viewports while preserving the sheet elsewhere. */
  presentation?: "sheet" | "adaptive";
}) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const isDialog =
    Platform.OS === "web" && presentation === "adaptive" && width >= 840;
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: 360,
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
    outputRange: [isDialog ? 24 : 400, 0],
  });
  const panel = (
    <Animated.View
      style={[
        styles.panel,
        isDialog
          ? styles.dialogPanel
          : keyboardAvoiding
            ? styles.keyboardPanel
            : styles.absolutePanel,
        {
          opacity: isDialog ? progress : 1,
          transform: [{ translateY }],
        },
      ]}
    >
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
      {children}
      <View style={{ height: bottomInset }} />
    </Animated.View>
  );

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable
          accessibilityLabel={`Close ${title}`}
          accessibilityRole="button"
          style={styles.scrimPressable}
          onPress={onClose}
        />
      </Animated.View>
      {isDialog ? (
        <KeyboardAvoidingView
          pointerEvents="box-none"
          style={styles.dialogLayer}
        >
          {panel}
        </KeyboardAvoidingView>
      ) : keyboardAvoiding ? (
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
    maxWidth: 480,
    overflow: "hidden",
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
}));
