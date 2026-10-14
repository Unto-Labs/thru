/**
 * The OS Reduce Motion switch, live. It starts false and corrects once the
 * first query answers; a host that cannot answer keeps motion on. The loading
 * kit keeps private copies, since those files are self-contained.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((value) => {
        if (live) setReduce(value);
      });
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduce);
    return () => {
      live = false;
      subscription?.remove();
    };
  }, []);
  return reduce;
}
