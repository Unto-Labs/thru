/**
 * Accessibility props for a modal's scrim: the full-screen pressable behind a
 * sheet or dialog that puts it away on a tap.
 *
 * A scrim that does what the close button does is a second control with the
 * same name, so it is hidden: pointer users still tap it, everyone else uses
 * the close button, Escape or the system back. A scrim that does something
 * the close button does not is a named button so screen-reader users can
 * reach that action.
 *
 * Hiding has to differ per platform:
 * - react-native-web drops `accessible`, `importantForAccessibility` and
 *   `accessibilityElementsHidden`; only a literal `aria-hidden` reaches the
 *   DOM.
 * - The web scrim must carry no `tabindex` at all. react-native-web's modal
 *   focus trap focuses the first descendant that has one, -1 included, and
 *   `Pressable` turns an undefined `tabIndex` into 0 but passes `null`
 *   through, so `null` leaves the attribute out.
 * - Native keeps the usual props; React Native also maps `aria-hidden` to
 *   hiding the element and its children.
 *
 * Pure: no runtime import of react-native, so tests can call it directly.
 */
import type { PressableProps } from "react-native";

export type ScrimAccessibilityProps = Pick<
  PressableProps,
  | "accessible"
  | "accessibilityLabel"
  | "accessibilityRole"
  | "aria-hidden"
  | "focusable"
  | "importantForAccessibility"
  | "tabIndex"
>;

/**
 * `label` names the scrim as a button; without it the scrim is hidden from
 * accessibility on `isWeb` and on native alike.
 */
export function scrimAccessibilityProps(
  isWeb: boolean,
  label?: string,
): ScrimAccessibilityProps {
  if (label) return { accessibilityRole: "button", accessibilityLabel: label };
  if (isWeb) {
    /* React Native types `tabIndex` as 0 | -1; null is react-native-web's
       "no tabindex attribute" (see above). */
    return { "aria-hidden": true, tabIndex: null as unknown as undefined };
  }
  return {
    accessible: false,
    "aria-hidden": true,
    focusable: false,
    importantForAccessibility: "no-hide-descendants",
  };
}
