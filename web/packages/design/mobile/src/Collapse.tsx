import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from "react-native";
import { useReduceMotion } from "./reduceMotion";

export function useCollapse(open: boolean): { turn: Animated.Value; shown: boolean } {
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [shown, setShown] = useState(open);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (open) setShown(true);
    if (reduceMotion) {
      turn.setValue(open ? 1 : 0);
      setShown(open);
      return;
    }
    const animation = Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
    return () => animation.stop();
  }, [open, reduceMotion, turn]);
  return { turn, shown: open || shown };
}

export function CollapseBody({ open, turn, style, children }: {
  open: boolean;
  turn: Animated.Value;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      aria-hidden={!open}
      {...(Platform.OS === "web" ? { inert: !open } : {})}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      style={[style, { opacity: turn }]}
    >
      {children}
    </Animated.View>
  );
}
