import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runPasskeyCeremony,
  setPasskeyRecoveryHandler,
  type PasskeyRecoveryRequest,
} from './ceremony';
import { resetInlinePasskeyRefusal } from './capabilities';
import { registerPasskey } from './register';
import { signWithPasskey, signWithStoredPasskey, signWithDiscoverablePasskey } from './sign';

let dispose: (() => void) | undefined;
let request: PasskeyRecoveryRequest | null;
let opened: { close: ReturnType<typeof vi.fn>; closed: boolean };
let open: ReturnType<typeof vi.fn>;
function setup(policy = true) {
  opened = { close: vi.fn(), closed: false };
  open = vi.fn(() => opened);
  const parent: any = { location: { origin: 'https://wallet.tid.sh' } };
  parent.parent = parent;
  vi.stubGlobal('window', {
    self: {},
    top: parent,
    parent,
    location: { origin: 'https://app.tid.sh' },
    PublicKeyCredential: function () {},
    isSecureContext: true,
    open,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('navigator', {
    userAgent: 'Chrome/130.0',
    credentials: { get: vi.fn(), create: vi.fn() },
  });
  vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => policy } });
  request = null;
  dispose = setPasskeyRecoveryHandler((next) => {
    request = next;
  });
}
beforeEach(() => {
  resetInlinePasskeyRefusal();
  setup();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const frameError = () =>
  new DOMException(
    'The origin of the document is not the same as its ancestors.',
    'NotAllowedError'
  );

describe('explicit ceremony recovery', () => {
  it('calls inline immediately without capability waits or windows', async () => {
    const inline = vi.fn().mockResolvedValue('signed');
    const result = runPasskeyCeremony('get', inline, vi.fn());
    expect(inline).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe('signed');
    expect(open).not.toHaveBeenCalled();
  });
  it('waits for a fresh click after restriction, prevents duplicates, and returns one result', async () => {
    const inline = vi.fn().mockRejectedValue(frameError());
    let resolve!: (value: string) => void;
    const popup = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    const continuation = vi.fn();
    const result = runPasskeyCeremony('get', inline, popup).then(continuation);
    await flush();
    expect(request?.restriction?.reason).toBe('ancestor-restriction');
    expect(open).not.toHaveBeenCalled();
    const retry = request!.retry;
    retry();
    retry();
    expect(open).toHaveBeenCalledOnce();
    expect(popup).toHaveBeenCalledOnce();
    await expect(runPasskeyCeremony('create', vi.fn(), vi.fn())).rejects.toThrow(
      'already in progress'
    );
    resolve('signed');
    await result;
    expect(continuation).toHaveBeenCalledExactlyOnceWith('signed');
    expect(inline).toHaveBeenCalledOnce();
    expect(request).toBe(null);
    expect(opened.close).toHaveBeenCalled();
  });
  it('keeps blocked and closed popup retries in the recovery sheet', async () => {
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } });
    open.mockReturnValueOnce(null);
    const popup = vi
      .fn()
      .mockRejectedValueOnce(new Error('Passkey popup was closed'))
      .mockResolvedValue('signed');
    const inline = vi.fn();
    const result = runPasskeyCeremony('get', inline, popup);
    request!.retry();
    await flush();
    expect(request?.error).toContain('blocked');
    request!.retry();
    await flush();
    expect(request?.error).toContain('closed');
    request!.retry();
    await expect(result).resolves.toBe('signed');
    expect(popup).toHaveBeenCalledTimes(2);
    expect(inline).not.toHaveBeenCalled();
  });
  it('cancels waiting recovery and releases the ceremony lock', async () => {
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } });
    const result = runPasskeyCeremony('get', vi.fn(), vi.fn());
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    request!.cancel();
    await rejected;
    expect(open).not.toHaveBeenCalled();
    vi.stubGlobal('document', {});
    await expect(runPasskeyCeremony('get', async () => 'ok', vi.fn())).resolves.toBe('ok');
  });
  it('unmount aborts popup and ignores late success', async () => {
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } });
    let resolve!: (value: string) => void;
    const result = runPasskeyCeremony(
      'get',
      vi.fn(),
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    request!.retry();
    dispose!();
    dispose = undefined;
    await rejected;
    resolve('late');
    await flush();
    expect(opened.close).toHaveBeenCalled();
    expect(request).toBe(null);
  });
  it('requires a fresh in-frame click when create lost activation', async () => {
    (navigator as any).userActivation = { isActive: false };
    const inline = vi.fn().mockResolvedValue('created');
    const result = runPasskeyCeremony('create', inline, vi.fn());
    expect(inline).not.toHaveBeenCalled();
    expect(request?.route).toBe('inline');
    request!.retry();
    expect(inline).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe('created');
    expect(open).not.toHaveBeenCalled();
  });
  it('reports typed restrictions without a registered UI', async () => {
    dispose!();
    dispose = undefined;
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } });
    await expect(runPasskeyCeremony('create', vi.fn(), vi.fn())).rejects.toMatchObject({
      name: 'PasskeyIframeRestrictionError',
      action: 'create',
      reason: 'policy-denied',
    });
    expect(open).not.toHaveBeenCalled();
  });
  it('explicit popup mode opens synchronously but respects popup prohibition', async () => {
    const result = runPasskeyCeremony('get', vi.fn(), async () => 'ok', { promptMode: 'popup' });
    expect(open).toHaveBeenCalledOnce();
    await result;
    await expect(
      runPasskeyCeremony('get', vi.fn(), vi.fn(), {
        promptMode: 'popup',
        allowPopupFallback: false,
      })
    ).rejects.toThrow('disabled');
    expect(open).toHaveBeenCalledOnce();
  });
  it.each(['NotAllowedError', 'SecurityError', 'AbortError'])(
    'does not recover generic %s with a popup',
    async (name) => {
      await expect(
        runPasskeyCeremony(
          'get',
          async () => {
            throw new DOMException('failure', name);
          },
          vi.fn()
        )
      ).rejects.toMatchObject({ name });
      expect(request).toBe(null);
      expect(open).not.toHaveBeenCalled();
    }
  );
  it('does not open a popup in an insecure context', async () => {
    (window as any).isSecureContext = false;
    await expect(
      runPasskeyCeremony('get', vi.fn(), vi.fn(), { promptMode: 'popup' })
    ).rejects.toThrow('HTTPS');
    expect(open).not.toHaveBeenCalled();
  });
  it('enforces popup-disabled options across every public ceremony entry point', async () => {
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } });
    vi.mocked(navigator.credentials.get).mockRejectedValue(frameError());
    vi.mocked(navigator.credentials.create).mockRejectedValue(frameError());
    const options = { allowPopupFallback: false };
    for (const call of [
      () => registerPasskey('Wallet', 'id', 'app.tid.sh', options),
      () => signWithPasskey('AQID', new Uint8Array(32), 'app.tid.sh', options),
      () => signWithStoredPasskey(new Uint8Array(32), 'app.tid.sh', null, [], undefined, options),
      () => signWithDiscoverablePasskey(new Uint8Array(32), 'app.tid.sh', options),
    ])
      await expect(call()).rejects.toThrow('ancestors');
    expect(request).toBe(null);
    expect(open).not.toHaveBeenCalled();
  });
});
