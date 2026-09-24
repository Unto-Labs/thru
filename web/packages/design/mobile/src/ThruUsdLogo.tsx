import { View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import {
  THRUSD_DOLLAR_PATH,
  THRUSD_STEM_PATH,
  THRUSD_WINGS_PATH,
  THRUSD_RED,
} from "../../tokens/src/thrusd";

export interface ThruUsdLogoProps {
  size?: number;
  label?: string;
}

/** White currency mark on the fixed Thru red disc, in either theme. */
export function ThruUsdLogo({ size = 24, label }: ThruUsdLogoProps) {
  return (
    <View
      accessible={Boolean(label)}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 128 128">
        <Circle cx="64" cy="64" r="64" fill={THRUSD_RED} />
        <G
          transform="translate(0 4)"
          fill="none"
          stroke="#fff"
          strokeLinecap="square"
          strokeLinejoin="miter"
        >
          <G transform="translate(22.4 22.4) scale(.65)">
            <Path d={THRUSD_DOLLAR_PATH} strokeWidth={10} />
            <Path d={THRUSD_STEM_PATH} strokeWidth={6} />
          </G>
          <Path d={THRUSD_WINGS_PATH} strokeWidth={6} />
        </G>
      </Svg>
    </View>
  );
}
