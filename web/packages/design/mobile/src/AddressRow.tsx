/**
 * A read-only address shown in full: the mono string wraps inside a 1pt
 * bordered box, with the kit's copy button beside it. `AddressField` is the
 * input; this is for a value the user only reads and copies, such as a
 * token's mint on its screen. The caller owns the clipboard and how long
 * `copied` stays true, as with `CopyButton`.
 */

import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { CopyButton } from "./CopyButton";
import { font, space } from "./tokens";
import { makeStyles } from "./theme";

export interface AddressRowProps {
  address: string;
  copied: boolean;
  onCopy: () => void;
  /** What the address is, e.g. "Mint address": read out before it. */
  label: string;
  style?: StyleProp<ViewStyle>;
}

export function AddressRow({ address, copied, onCopy, label, style }: AddressRowProps) {
  const styles = useStyles();
  return (
    <View style={[styles.row, style]}>
      <View accessible accessibilityLabel={`${label}, ${address}`} style={styles.box}>
        <Text selectable style={styles.address}>
          {address}
        </Text>
      </View>
      <CopyButton
        copied={copied}
        onPress={onCopy}
        accessibilityLabel={`Copy ${label.toLowerCase()}`}
        copiedLabel={`${label} copied`}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { alignItems: "stretch", flexDirection: "row", gap: space[2] },
  box: {
    borderColor: c.border,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: space[3],
    paddingVertical: 10,
  },
  address: {
    color: c.fg,
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 18,
  },
}));
