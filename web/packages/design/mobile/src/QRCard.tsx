/**
 * Dark-on-light in both themes, since scanners read dark-on-light; error
 * correction H so the mark can cover the centre. Encodes the value as given:
 * the bare address, no URI scheme.
 */

import { useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import QRCode from "qrcode";
import { BrandMark } from "./BrandMark";
import { makeStyles } from "./theme";

const QR_INK = "#181B1B";
const QR_PAPER = "#F9FBFB";
const QR_EDGE = "#B6CECE";
const PAD = 10;
const MARK = 32;
const MARK_PAD = 3;

export interface QRCardProps {
  value: string;
  /** The outer box, border included (default 200). */
  size?: number;
  /** Read out for the card, e.g. "QR code of your address". */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/* One path in module coordinates: each row's runs of dark modules as one
   rectangle, so neighbours never show a seam between them. */
function modulesPath(value: string): { size: number; d: string } | null {
  try {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "H" });
    const { size, data } = modules;
    let d = "";
    for (let y = 0; y < size; y += 1) {
      let x = 0;
      while (x < size) {
        if (!data[y * size + x]) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < size && data[y * size + x]) x += 1;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      }
    }
    return { size, d };
  } catch {
    return null;
  }
}

export function QRCard({ value, size = 200, accessibilityLabel, style }: QRCardProps) {
  const styles = useStyles();
  const matrix = useMemo(() => modulesPath(value), [value]);
  const inner = size - 2 - PAD * 2;
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={[styles.card, { height: size, width: size }, style]}
    >
      {matrix ? (
        <Svg
          height={inner}
          viewBox={`0 0 ${matrix.size} ${matrix.size}`}
          width={inner}
        >
          <Path d={matrix.d} fill={QR_INK} />
        </Svg>
      ) : null}
      <View pointerEvents="none" style={styles.markPad}>
        <BrandMark color={QR_INK} size={MARK} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: {
    alignItems: "center",
    backgroundColor: QR_PAPER,
    borderColor: QR_EDGE,
    borderWidth: 1,
    justifyContent: "center",
    padding: PAD,
  },
  markPad: {
    alignItems: "center",
    backgroundColor: QR_PAPER,
    height: MARK + MARK_PAD * 2,
    justifyContent: "center",
    position: "absolute",
    width: MARK + MARK_PAD * 2,
  },
}));
