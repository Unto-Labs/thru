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
    name:'pinned',tables:{},writer:writer as any,generation:'1',chainId:7,intervalMs:1,
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
