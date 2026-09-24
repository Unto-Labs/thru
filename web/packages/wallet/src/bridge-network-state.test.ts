import { afterEach, expect, it, vi } from 'vitest';
import { BridgeNetworkState } from './bridge-network-state';
import type { ResolvedWalletNetwork } from './networks';

const network = (endpoint: string): ResolvedWalletNetwork => ({
  id: 'custom',
  custom: true,
  name: endpoint,
  rpcUrl: `https://${endpoint}`,
  chainId: 2,
  scope: `custom:https://${endpoint}:2`,
});
afterEach(() => vi.useRealTimers());

it('invalidates old requests before announcing a different endpoint with the same chain ID', async () => {
  const events: string[] = [];
  const state = new BridgeNetworkState(
    () => events.push(`reject:${state.network?.name}`),
    (value) => events.push(`ready:${value.name}`),
  );
  const a = network('a.example');
  const b = network('b.example');
  state.readReady({
    network: a,
    networkGeneration: 1,
    capabilities: { networkSwitching: true },
  });
  await state.waitForNetwork(a.scope);
  const switched = state.waitForNetwork(b.scope, b.name);
  state.readReady({
    network: b,
    networkGeneration: 2,
    capabilities: { networkSwitching: true },
  });
  await switched;
  state.readReady({
    network: b,
    networkGeneration: 2,
    capabilities: { networkSwitching: true },
  });
  expect(events).toEqual([
    'ready:a.example',
    'reject:a.example',
    'ready:b.example',
  ]);
  expect(state.network).toBe(b);
  expect(state.generation).toBe(2);
  expect(state.supported).toBe(true);
});

it('supports the recovery handshake without a resolved network and preserves legacy capability checks', () => {
  const state = new BridgeNetworkState(vi.fn(), vi.fn());
  state.readReady({ capabilities: { networkSwitching: true } });
  expect(state.supported).toBe(true);
  expect(state.network).toBeNull();
  state.readReady(undefined);
  expect(state.supported).toBe(false);
});

it('times out waiting for a destination instead of accepting an unrelated ready event', async () => {
  vi.useFakeTimers();
  const state = new BridgeNetworkState(vi.fn(), vi.fn());
  const target = network('target.example');
  const pending = state.waitForNetwork(target.scope, target.name);
  const rejected = expect(pending).rejects.toThrow('Network switch timed out');
  state.readReady({ network: network('other.example'), networkGeneration: 1 });
  await vi.advanceTimersByTimeAsync(20000);
  await rejected;
});
