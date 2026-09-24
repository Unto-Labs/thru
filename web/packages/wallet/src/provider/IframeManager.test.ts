// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST_MESSAGE_REQUEST_TYPES } from '../protocol';
import type { TelemetryClient } from '../telemetry';
import { IframeManager, WALLET_IFRAME_ALLOW, walletIframeAllow } from './IframeManager';

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('IframeManager', () => {
  it.each(['https://app.tid.sh', 'https://staging-app.tid.sh'])(
    'delegates WebAuthn and clipboard writes only to configured origin %s',
    (origin) => {
      expect(walletIframeAllow(`${origin}/embedded?theme=dark`)).toBe(
        `publickey-credentials-get ${origin}; publickey-credentials-create ${origin}; payment *; clipboard-write ${origin}`
      );
    }
  );
  it('delegates Payment Request through the wallet iframe', () => {
    expect(WALLET_IFRAME_ALLOW).toContain('payment *');
  });

  it('uses a transparent iframe background by default', () => {
    const iframe = { style: { cssText: '' } };
    const manager = new IframeManager('https://app.tid.sh/embedded') as unknown as {
      iframe: typeof iframe;
      applyIframeStyles: () => void;
    };

    manager.iframe = iframe;
    manager.applyIframeStyles();

    expect(iframe.style.cssText).toContain('background: transparent;');
    /* Matches the light wallet document so Chrome keeps the frame transparent
       over a dark host (a color-scheme mismatch paints it opaque). */
    expect(iframe.style.cssText).toContain('color-scheme: light;');
  });

  it('carries the host theme on the frame URL and the frame element', () => {
    const iframe = { style: { cssText: '' } };
    const manager = new IframeManager('https://app.tid.sh/embedded', undefined, {
      theme: 'dark',
    }) as unknown as {
      iframe: typeof iframe;
      applyIframeStyles: () => void;
      getIframeSrc: () => string;
      getTheme: () => string;
    };
    manager.iframe = iframe;
    manager.applyIframeStyles();
    expect(iframe.style.cssText).toContain('color-scheme: dark;');
    expect(new URL(manager.getIframeSrc()).searchParams.get('tn_theme')).toBe('dark');
    expect(manager.getTheme()).toBe('dark');
  });

  it('restyles the frame element for a new theme and keeps it on screen', () => {
    const iframe = { style: { cssText: '' } as Record<string, string>, contentWindow: null };
    const manager = new IframeManager('https://app.tid.sh/embedded') as unknown as {
      iframe: typeof iframe;
      visible: boolean;
      setTheme: (theme: 'light' | 'dark') => void;
    };
    manager.iframe = iframe;
    manager.visible = true;

    manager.setTheme('dark');

    expect(iframe.style.cssText).toContain('color-scheme: dark;');
    expect(iframe.style.visibility).toBe('visible');
    expect(iframe.style.pointerEvents).toBe('auto');
  });

  it('tells a loaded wallet about a new theme without reloading it', async () => {
    const { manager, frameId, iframe } = await readyManager();
    const src = iframe.src;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    manager.setTheme('dark');

    expect(manager.getTheme()).toBe('dark');
    expect(iframe.src).toBe(src);
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'wallet:theme', origin: window.location.origin, frameId, theme: 'dark' },
      'https://app.tid.sh'
    );
    /* A later (re)load starts in the new theme. */
    expect(new URL(manager.getIframeSrc()).searchParams.get('tn_theme')).toBe('dark');

    postMessage.mockClear();
    manager.setTheme('dark');
    expect(postMessage).not.toHaveBeenCalled();
    manager.destroy();
  });

  it('resends a changed theme when the wallet document reloads', async () => {
    const { manager, frameId, iframe } = await readyManager();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    /* Nothing to say while the load-time theme still holds. */
    dispatchWalletMessage(frameId, { type: 'iframe:ready', data: { ready: true } });
    expect(postMessage).not.toHaveBeenCalled();

    manager.setTheme('dark');
    postMessage.mockClear();
    dispatchWalletMessage(frameId, { type: 'iframe:ready', data: { ready: true } });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wallet:theme', theme: 'dark' }),
      'https://app.tid.sh'
    );
    manager.destroy();
  });

  it('carries developer mode on the frame URL only while it is on', () => {
    const off = new IframeManager('https://app.tid.sh/embedded');
    expect(new URL(off.getIframeSrc()).searchParams.has('tn_developer_mode')).toBe(false);

    const on = new IframeManager('https://app.tid.sh/embedded', undefined, {
      developerMode: true,
    });
    expect(new URL(on.getIframeSrc()).searchParams.get('tn_developer_mode')).toBe('1');

    on.setDeveloperMode(false);
    expect(new URL(on.getIframeSrc()).searchParams.has('tn_developer_mode')).toBe(false);
  });

  it('tells a loaded wallet about developer mode and restates it after a reload', async () => {
    const { manager, frameId, iframe } = await readyManager();
    const src = iframe.src;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    /* Nothing to say while the load-time value still holds. */
    dispatchWalletMessage(frameId, { type: 'iframe:ready', data: { ready: true } });
    expect(postMessage).not.toHaveBeenCalled();

    manager.setDeveloperMode(true);
    expect(iframe.src).toBe(src);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'wallet:developer-mode',
        origin: window.location.origin,
        frameId,
        enabled: true,
      },
      'https://app.tid.sh'
    );

    postMessage.mockClear();
    manager.setDeveloperMode(true);
    expect(postMessage).not.toHaveBeenCalled();

    dispatchWalletMessage(frameId, { type: 'iframe:ready', data: { ready: true } });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wallet:developer-mode', enabled: true }),
      'https://app.tid.sh'
    );
    manager.destroy();
  });

  it('allows trusted deployed wallet origins', () => {
    const thruBridge = new IframeManager('https://app.tid.sh/embedded');
    const tidBridge = new IframeManager('https://wallet.tid.sh/embedded');
    const stagingAppBridge = new IframeManager('https://staging-app.tid.sh/embedded');
    const stagingBridge = new IframeManager('https://wallet.staging.web.5f1.net/embedded');

    expect(thruBridge).toBeInstanceOf(IframeManager);
    expect(tidBridge).toBeInstanceOf(IframeManager);
    expect(stagingAppBridge).toBeInstanceOf(IframeManager);
    expect(stagingBridge).toBeInstanceOf(IframeManager);
  });

  it('rejects untrusted production wallet origins', () => {
    expect(() => new IframeManager('https://evil.example.com/embedded')).toThrow(
      /Untrusted iframe origin/
    );
  });

  it('records a correlated request success', async () => {
    const { manager, telemetry, frameId, iframe } = await readyManager();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');
    const request = {
      id: 'request-success',
      type: POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE,
      origin: window.location.origin,
      payload: {},
    } as const;

    const resultPromise = manager.sendMessage(request);
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    dispatchWalletMessage(frameId, {
      id: request.id,
      success: true,
      result: { status: 'disconnected', accounts: [], selectedAccount: null },
    });
    await expect(resultPromise).resolves.toMatchObject({ success: true });

    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.request.completed',
      expect.objectContaining({
        frameId,
        requestId: request.id,
        operation: request.type,
        outcome: 'success',
      })
    );
    manager.destroy();
  });

  it('records a correlated wallet error', async () => {
    const { manager, telemetry, frameId, iframe } = await readyManager();
    vi.spyOn(iframe.contentWindow!, 'postMessage');
    const request = {
      id: 'request-error',
      type: POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE,
      origin: window.location.origin,
      payload: {},
    } as const;

    const resultPromise = manager.sendMessage(request);
    await Promise.resolve();
    dispatchWalletMessage(frameId, {
      id: request.id,
      success: false,
      error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' },
    });
    await expect(resultPromise).rejects.toMatchObject({ code: 'WALLET_LOCKED' });
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.request.failed',
      expect.objectContaining({
        requestId: request.id,
        outcome: 'wallet_error',
        errorCode: 'WALLET_LOCKED',
      })
    );
    manager.destroy();
  });

  it('reloads the frame once when the first ready deadline passes, then fails for good', async () => {
    vi.useFakeTimers();
    const telemetry = { record: vi.fn() };
    const manager = new IframeManager(
      'https://app.tid.sh/embedded',
      telemetry as unknown as TelemetryClient
    );
    const readyPromise = manager.createIframe();
    const iframe = document.querySelector('iframe')!;
    const firstSrc = iframe.src;
    const frameId = new URL(iframe.src).searchParams.get('tn_frame_id')!;

    /* First deadline: no ready → one reload with the same frame id. */
    await vi.advanceTimersByTimeAsync(10_000);
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.iframe.ready.retry',
      expect.objectContaining({ outcome: 'retry' })
    );
    expect(new URL(iframe.src).searchParams.get('tn_frame_id')).toBe(frameId);
    expect(iframe.src).toBe(firstSrc);

    /* The warm second load answers in time. */
    dispatchWalletMessage(frameId, { type: 'iframe:ready', data: { ready: true } });
    await readyPromise;
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.iframe.ready',
      expect.objectContaining({ outcome: 'success' })
    );
    manager.destroy();

    /* Two silences in a row is the real failure. */
    document.body.replaceChildren();
    const failing = new IframeManager(
      'https://app.tid.sh/embedded',
      telemetry as unknown as TelemetryClient
    );
    const failingPromise = failing.createIframe();
    const rejection = expect(failingPromise).rejects.toThrow(/Iframe ready timeout/);
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    failing.destroy();
  });

  it('records request timeouts', async () => {
    const { manager, telemetry, iframe } = await readyManager();
    vi.spyOn(iframe.contentWindow!, 'postMessage');
    vi.useFakeTimers();
    const request = {
      id: 'request-timeout',
      type: POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE,
      origin: window.location.origin,
      payload: {},
    } as const;

    const resultPromise = manager.sendMessage(request);
    const rejection = expect(resultPromise).rejects.toThrow(/Request timeout/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.request.timeout',
      expect.objectContaining({
        requestId: request.id,
        errorCode: 'TIMEOUT',
        outcome: 'timeout',
      })
    );
    manager.destroy();
  });

  it('hides at once on a response when the wallet does not manage hiding', async () => {
    const { manager, frameId, iframe } = await readyManager();
    dispatchWalletMessage(frameId, {
      type: 'event',
      event: 'ui_show',
      data: { reason: 'connect' },
    });
    manager.showModal();
    expect(iframe.style.visibility).toBe('visible');

    manager.hide();
    expect(iframe.style.visibility).toBe('hidden');
    manager.destroy();
  });

  it('keeps a managed frame up through the wallet exit animation', async () => {
    vi.useFakeTimers();
    const { manager, frameId, iframe } = await readyManager({ managedHide: true });
    dispatchWalletMessage(frameId, {
      type: 'event',
      event: 'ui_show',
      data: { reason: 'connect' },
    });
    manager.showModal();
    expect(iframe.style.visibility).toBe('visible');

    /* The host's own hide (a response arrived) waits for the wallet. */
    manager.hide();
    expect(iframe.style.visibility).toBe('visible');
    expect(iframe.style.pointerEvents).toBe('auto');

    /* The wallet announces its exit: pointer events go at once, the frame
       hides once the animation has played. */
    dispatchWalletMessage(frameId, { type: 'event', event: 'ui_hide', data: { exitMs: 480 } });
    expect(iframe.style.visibility).toBe('visible');
    expect(iframe.style.pointerEvents).toBe('none');
    await vi.advanceTimersByTimeAsync(479);
    expect(iframe.style.visibility).toBe('visible');
    await vi.advanceTimersByTimeAsync(1);
    expect(iframe.style.visibility).toBe('hidden');

    /* Once hidden the claim is cleared: a host hide with no wallet UI up is
       immediate again. */
    manager.showModal();
    manager.hide();
    expect(iframe.style.visibility).toBe('hidden');
    manager.destroy();
  });

  it('resolves a deferred hide only once the frame is hidden', async () => {
    vi.useFakeTimers();
    const { manager, frameId, iframe } = await readyManager({ managedHide: true });
    dispatchWalletMessage(frameId, {
      type: 'event',
      event: 'ui_show',
      data: { reason: 'connect' },
    });
    manager.showModal();
    let settled = false;
    const hidden = manager.hide().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    dispatchWalletMessage(frameId, { type: 'event', event: 'ui_hide', data: { exitMs: 480 } });
    await vi.advanceTimersByTimeAsync(480);
    await hidden;
    expect(settled).toBe(true);
    expect(iframe.style.visibility).toBe('hidden');
    /* An unmanaged or already-hidden frame settles at once. */
    await expect(manager.hide()).resolves.toBeUndefined();
    manager.destroy();
  });

  it('falls back to hiding a managed frame when ui_hide never arrives', async () => {
    vi.useFakeTimers();
    const { manager, frameId, iframe } = await readyManager({ managedHide: true });
    dispatchWalletMessage(frameId, {
      type: 'event',
      event: 'ui_show',
      data: { reason: 'connect' },
    });
    manager.showModal();
    manager.hide();
    expect(iframe.style.visibility).toBe('visible');
    await vi.advanceTimersByTimeAsync(4000);
    expect(iframe.style.visibility).toBe('hidden');
    manager.destroy();
  });

  it('cancels a pending managed hide when the wallet shows again', async () => {
    vi.useFakeTimers();
    const { manager, frameId, iframe } = await readyManager({ managedHide: true });
    dispatchWalletMessage(frameId, {
      type: 'event',
      event: 'ui_show',
      data: { reason: 'connect' },
    });
    manager.showModal();
    manager.hide();
    dispatchWalletMessage(frameId, { type: 'event', event: 'ui_hide', data: { exitMs: 480 } });
    manager.showModal();
    expect(iframe.style.pointerEvents).toBe('auto');
    await vi.advanceTimersByTimeAsync(5000);
    expect(iframe.style.visibility).toBe('visible');
    manager.destroy();
  });

  it('records malformed and rejected wallet-origin messages', async () => {
    const { manager, telemetry, frameId } = await readyManager();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://app.tid.sh',
        data: 'not-an-object',
      })
    );
    dispatchWalletMessage('different-frame', {
      id: 'wrong-frame',
      success: true,
      result: {},
    });
    dispatchWalletMessage(frameId, {
      id: 'unknown-request',
      success: true,
      result: {},
    });

    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.message.ignored',
      expect.objectContaining({ outcome: 'malformed' })
    );
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.message.ignored',
      expect.objectContaining({ outcome: 'frame_mismatch' })
    );
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.response.ignored',
      expect.objectContaining({
        outcome: 'unknown_request',
      })
    );
    expect(telemetry.record).not.toHaveBeenCalledWith(
      'bridge.response.ignored',
      expect.objectContaining({ requestId: 'unknown-request' })
    );
    manager.destroy();
  });

  it.each([
    /* http://localhost: a secure context whose wallet continues passkeys in a new window. */
    { secure: true, expected: 'continue in a new window', silentWallet: true },
    /* Any other HTTP page: not a secure context, so the frame has no passkeys. */
    { secure: false, expected: 'Passkeys are unavailable', silentWallet: false },
  ])(
    'warns once on an HTTP page (secure context: $secure)',
    async ({ secure, expected, silentWallet }) => {
      vi.resetModules();
      vi.stubGlobal('isSecureContext', secure);
      const { IframeManager: FreshManager } = await import('./IframeManager');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(window.location.protocol).toBe('http:');
      const localWallet = new FreshManager('http://localhost:3013/embedded');
      void localWallet.createIframe().catch(() => {});
      /* A localhost wallet frame is exempt only while the page is a secure context. */
      expect(warn).toHaveBeenCalledTimes(silentWallet ? 0 : 1);
      const managers = [
        localWallet,
        new FreshManager('https://app.tid.sh/embedded'),
        new FreshManager('https://app.tid.sh/embedded'),
      ];
      for (const manager of managers.slice(1)) void manager.createIframe().catch(() => {});

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain(expected);
      expect(warn.mock.calls[0][0]).toContain(
        'https://thru.org/docs/wallet/embedded-wallet-integration/#serve-your-app-over-https-in-development'
      );
      for (const manager of managers) manager.destroy();
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  );

  it('allows a Tailscale wallet during development SSR', () => {
    const bridge = new IframeManager('https://wallet-dev.tailabc.ts.net/embedded');

    expect(bridge).toBeInstanceOf(IframeManager);
  });
});

async function readyManager(capabilities?: { managedHide?: boolean }): Promise<{
  manager: IframeManager;
  telemetry: { record: ReturnType<typeof vi.fn> };
  iframe: HTMLIFrameElement;
  frameId: string;
}> {
  const telemetry = { record: vi.fn() };
  const manager = new IframeManager(
    'https://app.tid.sh/embedded',
    telemetry as unknown as TelemetryClient
  );
  const readyPromise = manager.createIframe();
  const iframe = document.querySelector('iframe')!;
  const frameId = new URL(iframe.src).searchParams.get('tn_frame_id')!;
  dispatchWalletMessage(frameId, {
    type: 'iframe:ready',
    data: capabilities ? { ready: true, capabilities } : { ready: true },
  });
  await readyPromise;
  return { manager, telemetry, iframe, frameId };
}

function dispatchWalletMessage(frameId: string, data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://app.tid.sh',
      data: { ...data, frameId },
    })
  );
}
