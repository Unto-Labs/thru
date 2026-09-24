/**
 * Loading-lab prototype — "Slot Ticker".
 *
 * A self-driving demo of the split-flap board: it fakes a chain sync on a
 * loop so the direction can be judged on a simulator without touching it.
 * One 333ms interval drives everything, and every visible state is derived
 * from the step counter, so there is exactly one timer to tear down.
 *
 * No network, no wallet, no navigation — the numbers are invented.
 */
import type React from 'react';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import {
  MetaTable,
  SlotTicker,
  makeStyles,
  space,
  touch,
  type MetaTableRow,
  type SlotTickerStatus,
} from '../src';

/* One step is one simulated slot: ~3 slots per second. */
const STEP_MS = 333;
/* 21 steps × 333ms ≈ 7s per loop. */
const CYCLE_STEPS = 21;
/* ~1s of "connected, but no number yet" before the first slot lands. */
const PRE_DATA_STEPS = 3;
const VERIFYING_STEP = 11;
/* Leaves 4 steps ≈ 1.3s of READY before the loop resets. */
const READY_STEP = 17;
/* Chosen so the board rolls through 84,100 early and the carry cascade — the
   whole point of the odometer — is visible within the first second of data. */
const START_SLOT = 84098;
/* Same cell count as the slot it stands in for, so the block never resizes. */
const PLACEHOLDER = '------';
/* The frame shown when Reduce Motion is on: the resolved end state. */
const STATIC_STEP = CYCLE_STEPS - 1;

const CAPTION: Record<SlotTickerStatus, string> = {
  syncing: 'Replaying recent blocks from the network.',
  verifying: 'Verifying the state root against the last checkpoint.',
  ready: 'Chain state is current.',
};

function statusForStep(step: number): SlotTickerStatus {
  if (step < VERIFYING_STEP) return 'syncing';
  if (step < READY_STEP) return 'verifying';
  return 'ready';
}

export function SlotTickerPrototype(): React.JSX.Element {
  const styles = useStyles();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      })
      .catch(() => {
        /* Best effort — if the query fails, the loop runs. */
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (alive) setReduceMotion(enabled);
      }
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    /* Reduce Motion runs no loop at all — the frame below is derived. */
    if (reduceMotion) return;
    const timer = setInterval(() => {
      setTick((current) => (current + 1) % CYCLE_STEPS);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const step = reduceMotion ? STATIC_STEP : tick;
  const hasData = step >= PRE_DATA_STEPS;
  const slot = hasData ? START_SLOT + (step - PRE_DATA_STEPS) : null;
  const status = statusForStep(step);

  const rows: MetaTableRow[] = [
    { label: 'Network', value: 'alphanet' },
    { label: 'RPC', value: 'rpc.alphanet.thru.sh' },
    { label: 'Height', value: hasData ? '+3 / sec' : 'awaiting' },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.stack}>
        <SlotTicker
          caption={CAPTION[status]}
          mark
          placeholder={PLACEHOLDER}
          slot={slot}
          status={status}
        />
        <MetaTable rows={rows} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: {
    alignItems: 'center',
    backgroundColor: c.bg,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: touch.screenX,
  },
  stack: {
    alignSelf: 'stretch',
    gap: space[5],
  },
}));
