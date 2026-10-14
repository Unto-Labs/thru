import { View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";

export type Coin = "btc" | "eth";

export interface CoinLogoProps {
  coin: Coin;
  size?: number;
  label?: string;
}

/** Bitcoin and Ether brand marks, drawn from the web kit's net-btc.svg and
    net-eth.svg so a token row and a deposit network show the same logo. */
export function CoinLogo({ coin, size = 24, label }: CoinLogoProps) {
  return (
    <View
      accessible={Boolean(label)}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 32 32">
        {coin === "btc" ? (
          <>
            <Circle cx="16" cy="16" r="16" fill="#F7931A" />
            <G transform="rotate(-12 16 16)" fill="#fff">
              <Path d="M12.2 8h5.6c2.6 0 4.3 1.4 4.3 3.6 0 1.5-.9 2.7-2.3 3.1 1.8.4 2.9 1.7 2.9 3.5 0 2.5-1.9 4-4.8 4h-5.7V8zm2.6 2.2v3.7h2.6c1.3 0 2.1-.7 2.1-1.9s-.8-1.8-2.1-1.8h-2.6zm0 5.8v4h2.9c1.5 0 2.4-.8 2.4-2s-.9-2-2.4-2h-2.9z" />
              <Path d="M14.2 6h1.6v2.4h-1.6zM17 6h1.6v2.4H17zM14.2 22h1.6v2.4h-1.6zM17 22h1.6v2.4H17z" />
            </G>
          </>
        ) : (
          <>
            <Circle cx="16" cy="16" r="16" fill="#627EEA" />
            <Path d="M16 5v8.1l6.9 3.1L16 5z" fill="#fff" fillOpacity={0.6} />
            <Path d="M16 5 9.1 16.2l6.9-3.1V5z" fill="#fff" />
            <Path d="M16 21.9V27l6.9-9.6-6.9 4.5z" fill="#fff" fillOpacity={0.6} />
            <Path d="M16 27v-5.1L9.1 17.4 16 27z" fill="#fff" />
            <Path d="m16 20.6 6.9-4.4L16 13.1v7.5z" fill="#fff" fillOpacity={0.2} />
            <Path d="m9.1 16.2 6.9 4.4v-7.5l-6.9 3.1z" fill="#fff" fillOpacity={0.6} />
          </>
        )}
      </Svg>
    </View>
  );
}
