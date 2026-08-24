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
} from "react-native";
import { font, radius, text, touch } from "./tokens";
import { makeStyles } from "./theme";
import { IconClose } from "./Icons";

export function Sheet({
  visible,
  title,
  onClose,
  children,
  keyboardAvoiding = false,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  keyboardAvoiding?: boolean;
}) {
  const styles = useStyles();
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

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });
  const panel = (
    <Animated.View
      style={[
        styles.panel,
        keyboardAvoiding ? styles.keyboardPanel : styles.absolutePanel,
        { transform: [{ translateY }] },
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
      <View style={styles.bottomInset} />
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
      {keyboardAvoiding ? (
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
  header: {
    height: touch.navH,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: touch.screenX,
    paddingRight: 6,
  },
  title: { flex: 1, fontFamily: font.sansSemiBold, fontSize: text.md, color: c.fg },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  bottomInset: { height: 34 },
}));
