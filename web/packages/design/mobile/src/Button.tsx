/**
 * Kit buttons: JetBrains Mono 600 15, square corners, 48pt default (56 CTA,
 * 36 compact). Variants from the Actions sheet: primary (stone-800), brand
 * (brick), outline (stone-300 border), danger-outline (brick-200 border,
 * brick text), ghost. Colors follow the active theme.
 */
import { ActivityIndicator, Pressable, Text, type ViewStyle } from "react-native";
import { font, text, touch } from "./tokens";
import { makeStyles, useThemeColors, type ThemeColors } from "./theme";

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

type VariantStyle = { container: ViewStyle; text: { color: string } };

/* Two themes, so a keyed cache keeps the variant objects referentially stable
   across renders instead of rebuilding six style objects each time. */
const variantCache = new WeakMap<ThemeColors, Record<ButtonVariant, VariantStyle>>();

function variants(c: ThemeColors): Record<ButtonVariant, VariantStyle> {
  const cached = variantCache.get(c);
  if (cached) return cached;
  const built: Record<ButtonVariant, VariantStyle> = {
    primary: { container: { backgroundColor: c.bgInverse }, text: { color: c.fgInverse } },
    brand: { container: { backgroundColor: c.accent }, text: { color: c.onBrand } },
    outline: {
      container: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.borderStrong },
      text: { color: c.fg },
    },
    outlineInverse: {
      container: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.fgMuted },
      text: { color: c.bgMuted },
    },
    dangerOutline: {
      container: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.brickStrong },
      text: { color: c.destructive },
    },
    ghost: { container: { backgroundColor: "transparent" }, text: { color: c.fgMuted } },
  };
  variantCache.set(c, built);
  return built;
}

export function Button({ label, onPress, variant = "primary", size = "md", disabled, loading, style }: ButtonProps) {
  const styles = useStyles();
  const v = variants(useThemeColors())[variant];
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

const useStyles = makeStyles(() => ({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    borderRadius: 0,
  },
  label: { fontFamily: font.monoSemiBold, fontSize: text.base },
}));
