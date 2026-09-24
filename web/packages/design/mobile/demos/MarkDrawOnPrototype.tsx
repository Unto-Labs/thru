/* Loading-lab prototype — "Mark Draw-On", 1 of 5 competing loading directions.

   Self-driving and offline: no network, no wallet, no navigation. On mount it
   runs the full escalation ladder and loops forever, so the whole direction is
   legible from a single screenshot session.

   The demo timings below are COMPRESSED from the spec. The orbit still arrives
   at the real 2.4s, but the escalation is pulled in from 8.0s to 5.0s — nobody
   is going to sit through the honest eight seconds five times over. The hold on
   the escalated state is stretched the other way, to 2.4s, so there is time to
   read the copy swap and notice the retry button before the handoff. */

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { View } from 'react-native';
import { SplashState, makeStyles } from '../src';

const COPY = 'Setting up your wallet';

/* Offsets in ms from the top of each cycle:
     0     mark draws on (900ms) then fills (220ms)
     2400  accent arc begins orbiting          [spec 2400, unchanged]
     5000  copy escalates, retry fades in      [spec 8000, compressed]
     7400  handoff: scale to 1.04 and fade out (200ms)
     7600  blank beat, so the loop reads as a restart rather than a stutter
     8400  reset                                                             */
const ORBIT_AT = 2400;
const ESCALATE_AT = 5000;
const HANDOFF_AT = 7400;
const BLANK_AT = 7600;
const CYCLE_MS = 8400;

export function MarkDrawOnPrototype(): React.JSX.Element {
  const styles = useStyles();
  const [cycle, setCycle] = useState(0);
  const [handoff, setHandoff] = useState(false);
  const [visible, setVisible] = useState(true);

  /* Also wired to the retry button, so the one affordance in the direction is
     real rather than decorative. */
  const restart = useCallback(() => {
    setHandoff(false);
    setVisible(true);
    setCycle((n) => n + 1);
  }, []);

  useEffect(() => {
    const timers = [
      setTimeout(() => setHandoff(true), HANDOFF_AT),
      setTimeout(() => setVisible(false), BLANK_AT),
      setTimeout(restart, CYCLE_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [cycle, restart]);

  return (
    <View style={styles.root}>
      {/* Remounting on `key` restarts the ladder and redraws the mark. */}
      {visible ? (
        <SplashState
          key={cycle}
          copy={COPY}
          handoff={handoff}
          onRetry={restart}
          orbitAfterMs={ORBIT_AT}
          escalateAfterMs={ESCALATE_AT}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
}));
