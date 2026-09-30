/**
 * Tap haptic for iOS web: a transparent switch laid over a pressable.
 *
 * iOS Safari has no `navigator.vibrate`, and WebKit plays its switch tick only
 * for a switch the user really taps — a script-driven click toggles the switch
 * in silence. So the only web haptic on an iPhone is a real
 * `<input type="checkbox" switch>` under the finger. This one fills its
 * parent, invisible, as the tap's own click target: WebKit ticks, and the
 * click bubbles to the pressable, whose `onPress` (react-native-web fires it
 * from the native click) runs once as usual.
 *
 * Render it as the last child of a pressable, and only when a press should
 * buzz — iOS picks the click target at touch start, so the decision cannot
 * wait for the press handler. It renders nothing outside iOS-class web.
 */
import { createElement } from "react";
import { Platform } from "react-native";

/* This package builds without the DOM lib, so the browser globals it reads are
   typed here. */
const webGlobal = globalThis as {
  navigator?: object;
  matchMedia?: (query: string) => { matches: boolean };
};

/* The same test expo-haptics uses for its switch path: no Vibration API and a
   touch screen. Evaluated once — neither changes while the page is open. */
export const TAP_HAPTIC_SUPPORTED: boolean =
  Platform.OS === "web" &&
  webGlobal.navigator !== undefined &&
  !("vibrate" in webGlobal.navigator) &&
  typeof webGlobal.matchMedia === "function" &&
  webGlobal.matchMedia("(pointer: coarse)").matches;

/* A switch with `appearance: none` is still a switch to WebKit, so it ticks
   while drawing nothing; opacity 0 keeps it out of sight either way. */
const switchStyle = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: "100%",
  height: "100%",
  margin: 0,
  padding: 0,
  opacity: 0,
  appearance: "none",
  WebkitAppearance: "none",
  WebkitTapHighlightColor: "transparent",
  cursor: "inherit",
  zIndex: 1,
} as const;

export function TapHaptic() {
  if (!TAP_HAPTIC_SUPPORTED) return null;
  /* A raw DOM element: react-native-web has no switch-flavoured checkbox. It
     stays out of the accessibility tree and the tab order — the pressable it
     covers is the control. */
  return createElement("input", {
    type: "checkbox",
    switch: "",
    "aria-hidden": true,
    tabIndex: -1,
    style: switchStyle,
  });
}
