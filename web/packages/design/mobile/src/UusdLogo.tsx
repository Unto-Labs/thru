import { Text, View } from "react-native";
import { UUSD_PLACEHOLDER_COLOR } from "../../tokens/src/uusd";

export interface UusdLogoProps {
  size?: number;
  label?: string;
}

/** Generic "$" disc standing in for the Unto dollar's logo. */
export function UusdLogo({ size = 24, label }: UusdLogoProps) {
  return (
    <View
      accessible={Boolean(label)}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: UUSD_PLACEHOLDER_COLOR,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        allowFontScaling={false}
        style={{ color: "#fff", fontSize: Math.round(size * 0.56), fontWeight: "700" }}
      >
        $
      </Text>
    </View>
  );
}
