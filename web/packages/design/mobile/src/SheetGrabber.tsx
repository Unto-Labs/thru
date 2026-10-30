import { View } from "react-native";
import { makeStyles } from "./theme";

export function SheetGrabberBar() {
  const styles = useSheetGrabberStyles();
  return <View style={styles.grabber} />;
}

export const useSheetGrabberStyles = makeStyles((c) => ({
  grabberZone: { height: 16, alignItems: "center", justifyContent: "center" },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong },
}));
