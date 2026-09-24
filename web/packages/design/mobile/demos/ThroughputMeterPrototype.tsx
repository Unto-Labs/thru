/**
 * Throughput Meter prototype — direction 4 of the loading-screen bake-off.
 *
 * Self-driving: no props, no network, no wallet, no navigation. On mount it
 * replays a simulated cold start on a ~7.4s loop so the whole state machine is
 * visible without touching the screen — indeterminate sweep, determinate latch,
 * one channel resolved next to one still waiting, both green, and (every third
 * cycle) a failed wallet bridge with its inline retry.
 *
 * The two channels resolve at different times on purpose: RPC 1.4s after the
 * connect begins, WALLET 2.6s. Latency readouts come from a fixed sample table
 * rather than a random source, so the same frame renders the same numbers.
 */
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import {
  ChannelStatus,
  makeStyles,
  space,
  type MeterChannel,
  type MeterTone,
} from '../src';

const PHASE_BOOT = 'Starting Thru';
const PHASE_CONNECT = 'Connecting to alphanet';
const PHASE_WALLET = 'Opening the wallet bridge';
const PHASE_RETRY = 'Retrying the wallet bridge';
const PHASE_READY = 'Ready';
const PHASE_FAILED = 'Wallet bridge did not answer';

const ENDPOINT = 'rpc-alphanet-01.iad.thru.network:8899';

/* Fixed samples keep the demo deterministic while still looking live. */
const RPC_SAMPLES = ['238ms', '244ms', '231ms', '252ms', '240ms', '236ms'];
const WALLET_SAMPLES = ['118ms', '126ms', '112ms', '131ms', '121ms'];
const ERROR_CODE = 'ETIMEDOUT';

/* Cycle timeline, ms from the start of each loop. Both channels sweep
   indeterminate for the first second, then RPC lands 1.4s after the connect
   begins and WALLET 2.6s, so every intermediate combination is on screen. */
const T_CONNECT = 1000;
const T_RPC_HALF = 1400;
const T_RPC_MOST = 1900;
const T_RPC_DONE = 2400;
const T_WALLET_START = 2560;
const T_WALLET_MOST = 3050;
const T_WALLET_DONE = 3600;
/* 1.2s of quiet all-green hold (3600 -> 4800), then a beat of steady state
   where the readouts resample the way a real link meter would. */
const T_SAMPLES = [4800, 5300, 5800] as const;
const T_FADE_OUT = 6200;
const T_RESTART = 7400;

const FADE_IN_MS = 380;
const FADE_OUT_MS = 500;

/** One cycle in three fails, so the error state shows up unprompted. */
const FAILING_CYCLE = 3;
/** Cycle 1 (not 0): the happy path plays first, the failure follows it. */
const FAILING_OFFSET = 1;

interface ChannelSnapshot {
  tone: MeterTone;
  progress?: number;
  readout?: string;
  readoutLabel?: string;
}

interface Snapshot {
  phase: string;
  rpc: ChannelSnapshot;
  wallet: ChannelSnapshot;
  visible: boolean;
}

/** `240ms` -> `240 milliseconds`, so VoiceOver does not spell out "m s". */
function spoken(latency: string): string {
  return `${latency.replace('ms', '')} milliseconds`;
}

const waiting = (): ChannelSnapshot => ({ tone: 'default' });
const linking = (progress: number): ChannelSnapshot => ({ tone: 'default', progress });
const connected = (latency: string): ChannelSnapshot => ({
  tone: 'ok',
  progress: 1,
  readout: latency,
  readoutLabel: spoken(latency),
});
const failed = (): ChannelSnapshot => ({
  tone: 'error',
  readout: ERROR_CODE,
  readoutLabel: 'error, timed out',
});

function coldStart(): Snapshot {
  return { phase: PHASE_BOOT, rpc: waiting(), wallet: waiting(), visible: true };
}

export function ThroughputMeterPrototype(): React.JSX.Element {
  const styles = useStyles();
  const [cycle, setCycle] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>(coldStart);

  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  /* Lazy state rather than a ref: the value is read during render, which the
     app's react-hooks/refs rule (rightly) rejects for refs. */
  const [fade] = useState(() => new Animated.Value(1));

  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current.clear();
  }, []);

  /* Every scheduled step goes through here, so unmount (and each new cycle)
     cancels the whole script — nothing can set state afterwards. */
  const at = useCallback((delay: number, run: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      run();
    }, delay);
    timers.current.add(id);
  }, []);

  /* Rewinding to a cold start and bumping the cycle together keeps the reset
     out of the effect body — the effect only ever schedules timers. */
  const restart = useCallback(() => {
    setSnapshot(coldStart());
    setCycle((value) => value + 1);
  }, []);

  const retryWallet = useCallback(() => {
    clearTimers();
    setSnapshot((previous) => ({ ...previous, phase: PHASE_RETRY, wallet: waiting() }));
    at(1200, () =>
      setSnapshot((previous) => ({
        ...previous,
        phase: PHASE_READY,
        wallet: connected(WALLET_SAMPLES[0]),
      }))
    );
    at(2600, () => setSnapshot((previous) => ({ ...previous, visible: false })));
    at(3200, () => restart());
  }, [at, clearTimers, restart]);

  useEffect(() => {
    const failing = cycle % FAILING_CYCLE === FAILING_OFFSET;
    const rpcLatency = RPC_SAMPLES[cycle % RPC_SAMPLES.length];
    const walletLatency = WALLET_SAMPLES[cycle % WALLET_SAMPLES.length];

    at(T_CONNECT, () =>
      setSnapshot((previous) => ({ ...previous, phase: PHASE_CONNECT, rpc: linking(0.28) }))
    );
    at(T_RPC_HALF, () => setSnapshot((previous) => ({ ...previous, rpc: linking(0.55) })));
    at(T_RPC_MOST, () => setSnapshot((previous) => ({ ...previous, rpc: linking(0.82) })));
    at(T_RPC_DONE, () => setSnapshot((previous) => ({ ...previous, rpc: connected(rpcLatency) })));

    at(T_WALLET_START, () =>
      setSnapshot((previous) => ({ ...previous, phase: PHASE_WALLET, wallet: linking(0.3) }))
    );
    at(T_WALLET_MOST, () => setSnapshot((previous) => ({ ...previous, wallet: linking(0.68) })));
    at(T_WALLET_DONE, () =>
      setSnapshot((previous) =>
        failing
          ? { ...previous, phase: PHASE_FAILED, wallet: failed() }
          : { ...previous, phase: PHASE_READY, wallet: connected(walletLatency) }
      )
    );

    /* Steady state: the meter keeps sampling. The failed channel holds its
       error code — only a live link gets a new number. */
    T_SAMPLES.forEach((time, index) => {
      at(time, () =>
        setSnapshot((previous) => ({
          ...previous,
          rpc: connected(RPC_SAMPLES[(cycle + index + 1) % RPC_SAMPLES.length]),
          wallet: failing
            ? previous.wallet
            : connected(WALLET_SAMPLES[(cycle + index + 1) % WALLET_SAMPLES.length]),
        }))
      );
    });

    at(T_FADE_OUT, () => setSnapshot((previous) => ({ ...previous, visible: false })));
    at(T_RESTART, () => restart());

    return clearTimers;
  }, [at, clearTimers, cycle, restart]);

  useEffect(() => {
    const animation = Animated.timing(fade, {
      toValue: snapshot.visible ? 1 : 0,
      duration: snapshot.visible ? FADE_IN_MS : FADE_OUT_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fade, snapshot.visible]);

  const channels = useMemo<MeterChannel[]>(
    () => [
      { id: 'rpc', label: 'RPC', ...snapshot.rpc },
      {
        id: 'wallet',
        label: 'Wallet',
        ...snapshot.wallet,
        onRetry: snapshot.wallet.tone === 'error' ? retryWallet : undefined,
      },
    ],
    [retryWallet, snapshot.rpc, snapshot.wallet]
  );

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.block, { opacity: fade }]}>
        <ChannelStatus mark phase={snapshot.phase} caption={ENDPOINT} channels={channels} />
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.bg,
    /* Content lives in the lower half; the space above is the design. */
    justifyContent: 'flex-end',
    paddingBottom: space[8] + space[7],
  },
  block: {
    width: '100%',
  },
}));
