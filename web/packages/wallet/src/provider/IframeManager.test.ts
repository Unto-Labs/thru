// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST_MESSAGE_REQUEST_TYPES } from '../protocol';
import type { TelemetryClient } from '../telemetry';
import { IframeManager, WALLET_IFRAME_ALLOW } from './IframeManager';

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('IframeManager', () => {
  it('delegates Payment Request through the wallet iframe', () => {
    expect(WALLET_IFRAME_ALLOW).toContain('payment *');
  });

  it('uses a transparent iframe background by default', () => {
    const iframe = { style: { cssText: '' } };
    const manager = new IframeManager(
      'https://app.tid.sh/embedded'
    ) as unknown as {
      iframe: typeof iframe;
      applyIframeStyles: () => void;
    };

    manager.iframe = iframe;
    manager.applyIframeStyles();

    expect(iframe.style.cssText).toContain('background: transparent;');
  });

  it('allows trusted deployed wallet origins', () => {
    const thruBridge = new IframeManager('https://app.tid.sh/embedded');
    const tidBridge = new IframeManager('https://wallet.tid.sh/embedded');
    const stagingAppBridge = new IframeManager(
      'https://staging-app.tid.sh/embedded'
    );
    const stagingBridge = new IframeManager(
      'https://wallet.staging.web.5f1.net/embedded'
    );

    expect(thruBridge).toBeInstanceOf(IframeManager);
    expect(tidBridge).toBeInstanceOf(IframeManager);
    expect(stagingAppBridge).toBeInstanceOf(IframeManager);
    expect(stagingBridge).toBeInstanceOf(IframeManager);
  });

  it('rejects untrusted production wallet origins', () => {
    expect(
      () => new IframeManager('https://evil.example.com/embedded')
    ).toThrow(/Untrusted iframe origin/);
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
      }),
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
      }),
    );
    manager.destroy();
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
      }),
    );
    manager.destroy();
  });

  it('records malformed and rejected wallet-origin messages', async () => {
    const { manager, telemetry, frameId } = await readyManager();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://app.tid.sh',
        data: 'not-an-object',
      }),
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
      expect.objectContaining({ outcome: 'malformed' }),
    );
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.message.ignored',
      expect.objectContaining({ outcome: 'frame_mismatch' }),
    );
    expect(telemetry.record).toHaveBeenCalledWith(
      'bridge.response.ignored',
      expect.objectContaining({
        outcome: 'unknown_request',
      }),
    );
    expect(telemetry.record).not.toHaveBeenCalledWith(
      'bridge.response.ignored',
      expect.objectContaining({ requestId: 'unknown-request' }),
    );
    manager.destroy();
  });
});

async function readyManager(): Promise<{
  manager: IframeManager;
  telemetry: { record: ReturnType<typeof vi.fn> };
  iframe: HTMLIFrameElement;
  frameId: string;
}> {
  const telemetry = { record: vi.fn() };
  const manager = new IframeManager(
    'https://app.tid.sh/embedded',
    telemetry as unknown as TelemetryClient,
  );
  const readyPromise = manager.createIframe();
  const iframe = document.querySelector('iframe')!;
  const frameId = new URL(iframe.src).searchParams.get('tn_frame_id')!;
  dispatchWalletMessage(frameId, { type: 'iframe:ready' });
  await readyPromise;
  return { manager, telemetry, iframe, frameId };
}

function dispatchWalletMessage(
  frameId: string,
  data: Record<string, unknown>,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://app.tid.sh',
      data: { ...data, frameId },
    }),
  );
}
