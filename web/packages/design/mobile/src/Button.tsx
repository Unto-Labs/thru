/**
 * Kit buttons: JetBrains Mono 600 15, square corners, 48pt default (56 CTA,
 * 36 compact). Variants from the Actions sheet: primary (stone-800), brand
 * (brick), outline (stone-300 border), danger-outline (brick-200 border,
 * brick text), ghost.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { color, font, palette, text, touch } from "./tokens";

export type ButtonVariant = "primary" | "brand" | "outline" | "outlineInverse" | "dangerOutline" | "ghost";
export type ButtonSize = "lg" | "md" | "sm";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

const HEIGHTS: Record<ButtonSize, number> = { lg: touch.controlLg, md: touch.controlMd, sm: touch.controlSm };

export function Button({ label, onPress, variant = "primary", size = "md", disabled, loading, style }: ButtonProps) {
  const v = VARIANTS[variant];
  const busy = Boolean(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(loading), disabled: busy }}
      disabled={busy}
      hitSlop={size === "sm" ? (touch.hitMin - touch.controlSm) / 2 : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHTS[size] },
        v.container,
        pressed && !busy ? { opacity: 0.85 } : null,
        busy ? { opacity: 0.4 } : null,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={v.text.color} /> : null}
      <Text
        style={[
          styles.label,
          size === "sm" ? { fontSize: text.sm } : null,
          size === "lg" ? { fontSize: 16 } : null,
          v.text,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const VARIANTS: Record<ButtonVariant, { container: ViewStyle; text: { color: string } }> = {
  primary: { container: { backgroundColor: color.bgInverse }, text: { color: color.fgInverse } },
  brand: { container: { backgroundColor: color.accent }, text: { color: color.fgInverse } },
  outline: {
    container: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.borderStrong },
    text: { color: color.fg },
  },
  outlineInverse: {
    container: { backgroundColor: "transparent", borderWidth: 1, borderColor: palette.stone[600] },
    text: { color: palette.stone[100] },
  },
  dangerOutline: {
    container: { backgroundColor: "transparent", borderWidth: 1, borderColor: palette.brick[200] },
    text: { color: color.destructive },
  },
  ghost: { container: { backgroundColor: "transparent" }, text: { color: color.fgMuted } },
};

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    borderRadius: 0,
  },
  label: { fontFamily: font.monoSemiBold, fontSize: text.base },
});
