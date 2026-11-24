import { expect, it, vi } from 'vitest';
import { runAccounts, type AccountProjectionState } from './processor';
import type { AccountProjectionOptions } from './define';
const initial = (): AccountProjectionState => ({ready:false,lastSlot:0n,minimum:0n});
function fixture() {
  const abort = new AbortController();
  let height = 100n;
  const close = vi.fn();
  const factory = () => ({getHeight:async () => ({finalized:height}),getChainInfo:async () => ({chainId:7}),close}) as any;
  const writer = {transaction:async (fn: any) => fn({tx:{sql:{}},revision:'1'}),activate:vi.fn()};
  const options: AccountProjectionOptions<{}, string, string, unknown> = {
    name:'pinned',tables:{},writer:writer as any,chainId:7,intervalMs:1,
    resolveGroups:vi.fn(async () => [{key:'required',value:'required'}]),
    project:vi.fn(async (g) => g),commit:vi.fn(async () => {}),onCommitted:() => abort.abort(),
  };
  return {abort,factory,close,options,setHeight:(slot:bigint) => {height=slot;}};
}
it('retains the selected cut when dependency discovery or a required account fails', async () => {
  const f = fixture(), state = initial();
  f.options.resolveGroups = vi.fn().mockRejectedValueOnce(new Error('dependency unavailable')).mockResolvedValue([{key:'required',value:'required'}]);
  await expect(runAccounts(f.options,state,f.factory,f.abort.signal,{})).rejects.toThrow('dependency unavailable');
  f.setHeight(200n);
  f.options.project = vi.fn().mockRejectedValueOnce(new Error('deleted account at pinned cut')).mockResolvedValue('required');
  await expect(runAccounts(f.options,state,f.factory,f.abort.signal,{})).rejects.toThrow('deleted account');
  f.setHeight(300n);
  await runAccounts(f.options,state,f.factory,f.abort.signal,{});
  expect(vi.mocked(f.options.project).mock.calls.map(c => c[1].slot)).toEqual([100n,100n]);
  expect(state.lastSlot).toBe(100n);
  expect(f.options.commit).toHaveBeenCalledTimes(1);
});
it('waits beyond the old timeout for finalized notifications and cancels the update subscription', async () => {
  vi.useFakeTimers();
  const f = fixture(), state = initial();
  let unsubscribed = false;
  f.options.updates = async function* (signal) {
    try {
      yield {slot:200n};
      await new Promise<void>(resolve => signal.addEventListener('abort',() => resolve(),{once:true}));
    } finally {unsubscribed=true;}
  };
  try {
    const running = runAccounts(f.options,state,f.factory,f.abort.signal,{});
    await vi.advanceTimersByTimeAsync(3100);
    expect(f.options.project).not.toHaveBeenCalled();
    f.setHeight(200n);
    await vi.advanceTimersByTimeAsync(50);
    await running;
    expect(state.lastSlot).toBe(200n);
    expect(unsubscribed).toBe(true);
  } finally { f.abort.abort(); vi.useRealTimers(); }
});
it('commits a finalized target despite continuous newer notifications, then processes the queued target', async () => {
  const f = fixture(), state = initial();
  const cuts: bigint[] = [];
  f.options.updates = async function* (signal) {
    let slot = 200n;
    while (!signal.aborted) {
      yield { slot: slot++ };
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 10);
        signal.addEventListener('abort', done, {once:true});
      });
    }
  };
  f.options.onCommitted = at => {
    cuts.push(at.slot);
    if (cuts.length === 2) f.abort.abort();
  };
  const running = runAccounts(f.options,state,f.factory,f.abort.signal,{});
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(state.waitingFor).toBe(200n);
    expect(state.minimum).toBeGreaterThan(200n);
    f.setHeight(200n);
    await vi.waitFor(() => expect(cuts).toEqual([200n]));
    const next = state.waitingFor!;
    expect(next).toBeGreaterThan(200n);
    f.setHeight(next);
    await running;
    expect(cuts).toEqual([200n,next]);
  } finally { f.abort.abort(); await running.catch(() => {}); }
});
it('backs off the notification stream while the source cannot be reached, and starts over once it streams', async () => {
  /* F-G4-2: a refused connection was retried (and logged) every second. */
  vi.useFakeTimers();
  const f = fixture(), state = initial();
  f.options.intervalMs = 3_600_000;
  f.options.onCommitted = () => {};
  const errors: number[] = [];
  f.options.onError = () => { errors.push(Date.now()); };
  let up = false;
  const refused = () => Object.assign(new Error('[unavailable] connect ECONNREFUSED 127.0.0.1:8473'), { code: 14 });
  f.options.updates = async function* (signal) {
    if (!up) throw refused();
    yield { slot: 1n };
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  };
  const running = runAccounts(f.options, state, f.factory, f.abort.signal, {});
  try {
    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(120_000);
    /* 1, 2, 4, 8, 16, 30, 30, 30 s apart (plus jitter): 7 or 8 attempts in two minutes, not 120. */
    expect(errors.length).toBeGreaterThanOrEqual(6);
    expect(errors.length).toBeLessThanOrEqual(8);
    const gaps = errors.slice(1).map((t, i) => t - errors[i]);
    [1000, 2000, 4000, 8000, 16000].forEach((ms, i) => {
      expect(gaps[i]).toBeGreaterThanOrEqual(ms);
      expect(gaps[i]).toBeLessThanOrEqual(ms * 1.2 + 50);
    });
    expect(Math.max(...gaps)).toBeLessThanOrEqual(36_050);
    expect(errors[0] - t0).toBeLessThan(100);
    /* The source is back: the next attempt (at most one step later) streams and resets the backoff. */
    up = true;
    const before = errors.length;
    await vi.advanceTimersByTimeAsync(36_000);
    expect(errors.length).toBe(before);
    expect(state.minimum).toBe(1n);
  } finally { f.abort.abort(); await running.catch(() => {}); vi.useRealTimers(); }
});
