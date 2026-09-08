import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PASSKEY_POPUP_READY_EVENT,
  PASSKEY_POPUP_REQUEST_EVENT,
  PASSKEY_POPUP_RESPONSE_EVENT,
  requestPasskeyPopup,
} from './popup';
import type { PasskeyPopupRequest } from './types';

const ORIGIN = 'https://wallet.example';
const GET_PAYLOAD = {
  credentialId: 'AQID',
  challengeBase64Url: 'BAUG',
  rpId: 'wallet.example',
};
const GET_INFO = {
  kind: 'get',
  mode: 'popup',
  allowCredentials: true,
} as const;

function createHarness(blocked = false) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
  popup.close.mockImplementation(() => {
    popup.closed = true;
  });
  const browser = {
    location: { origin: ORIGIN },
    open: vi.fn(() => (blocked ? null : popup)),
    addEventListener: vi.fn((event: string, listener: (event: MessageEvent) => void) => {
      if (event === 'message') listeners.add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: (event: MessageEvent) => void) => {
      if (event === 'message') listeners.delete(listener);
    }),
  };
  vi.stubGlobal('window', browser);
  const reporter = { started: vi.fn(), finished: vi.fn(), failed: vi.fn() };
  const emit = (data: unknown, origin = ORIGIN) => {
    for (const listener of [...listeners]) {
      listener({ origin, source: popup, data } as unknown as MessageEvent);
    }
  };
  const ready = () => {
    emit({ type: PASSKEY_POPUP_READY_EVENT });
    return popup.postMessage.mock.calls[0][0] as PasskeyPopupRequest;
  };
  const expectCleanedUp = () => {
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  };
  return { popup, browser, reporter, emit, ready, expectCleanedUp };
}

describe('popup ceremony reporting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports a blocked popup once and releases its listeners', async () => {
    const harness = createHarness(true);
    await expect(
      requestPasskeyPopup('get', GET_PAYLOAD, undefined, {
        ceremonyReporter: harness.reporter,
      })
    ).rejects.toThrow('Passkey popup was blocked');

    expect(harness.reporter.started).toHaveBeenCalledExactlyOnceWith(GET_INFO);
    expect(harness.reporter.failed).toHaveBeenCalledExactlyOnceWith({
      ...GET_INFO,
      error: expect.objectContaining({ message: 'Passkey popup was blocked' }),
    });
    expect(harness.reporter.finished).not.toHaveBeenCalled();
    harness.expectCleanedUp();
  });

  it('reports closing the popup once even after its original timeout expires', async () => {
    const harness = createHarness();
    const pending = requestPasskeyPopup('get', GET_PAYLOAD, undefined, {
      ceremonyReporter: harness.reporter,
    });
    const rejected = expect(pending).rejects.toThrow('Passkey popup was closed');
    harness.popup.closed = true;
    await vi.advanceTimersByTimeAsync(250);
    await rejected;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(harness.reporter.failed).toHaveBeenCalledOnce();
    expect(harness.reporter.finished).not.toHaveBeenCalled();
    harness.expectCleanedUp();
  });

  it.each([
    { ready: false, message: 'Passkey popup did not load' },
    { ready: true, message: 'Passkey popup timed out' },
  ])('distinguishes timeout after ready=$ready', async ({ ready, message }) => {
    const harness = createHarness();
    const pending = requestPasskeyPopup('get', GET_PAYLOAD, undefined, {
      ceremonyReporter: harness.reporter,
    });
    const rejected = expect(pending).rejects.toThrow(message);
    if (ready) harness.ready();
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;

    expect(harness.reporter.failed).toHaveBeenCalledExactlyOnceWith({
      ...GET_INFO,
      error: expect.objectContaining({ message }),
    });
    expect(harness.reporter.finished).not.toHaveBeenCalled();
    expect(harness.popup.close).toHaveBeenCalledOnce();
    harness.expectCleanedUp();
  });

  it('preserves original popup results and credential JSON with exactly one completion', async () => {
    const harness = createHarness();
    const pending = requestPasskeyPopup('get', GET_PAYLOAD, undefined, {
      ceremonyReporter: harness.reporter,
    });
    const request = harness.ready();
    harness.ready();
    expect(harness.popup.postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: PASSKEY_POPUP_REQUEST_EVENT,
        requestId: expect.any(String),
        action: 'get',
        payload: GET_PAYLOAD,
      },
      ORIGIN
    );
    const result = {
      signatureBase64Url: 'normalized-wallet-signature',
      credentialJson: {
        id: 'AQID',
        rawId: 'AQID',
        type: 'public-key',
        response: {
          clientDataJSON: 'BwgJ',
          authenticatorData: 'BAUG',
          signature: 'MAYCAQECAQI',
        },
      },
    };
    const response = {
      type: PASSKEY_POPUP_RESPONSE_EVENT,
      requestId: request.requestId,
      success: true,
      result,
    };
    harness.emit(response);
    harness.emit(response);

    await expect(pending).resolves.toBe(result);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.reporter.finished).toHaveBeenCalledExactlyOnceWith({
      ...GET_INFO,
      credential: result.credentialJson,
    });
    expect(harness.reporter.failed).not.toHaveBeenCalled();
    expect(harness.popup.close).toHaveBeenCalledOnce();
    harness.expectCleanedUp();
  });

  it('ignores unrelated responses and preserves the popup error name and message', async () => {
    const harness = createHarness();
    const pending = requestPasskeyPopup('get', GET_PAYLOAD, undefined, {
      ceremonyReporter: harness.reporter,
    });
    const request = harness.ready();
    const response = {
      type: PASSKEY_POPUP_RESPONSE_EVENT,
      requestId: request.requestId,
      success: false,
      error: {
        name: 'NotAllowedError',
        message: 'User cancelled the passkey prompt',
      },
    };
    harness.emit({ ...response, requestId: 'other-request' });
    harness.emit(response, 'https://other.example');
    expect(harness.reporter.failed).not.toHaveBeenCalled();
    expect(harness.popup.close).not.toHaveBeenCalled();
    const rejected = expect(pending).rejects.toMatchObject(response.error);
    harness.emit(response);
    await rejected;

    expect(harness.reporter.failed).toHaveBeenCalledExactlyOnceWith({
      ...GET_INFO,
      error: expect.objectContaining(response.error),
    });
    expect(harness.reporter.finished).not.toHaveBeenCalled();
    harness.expectCleanedUp();
  });

  it('reports a preopened registration popup without opening another window', async () => {
    const harness = createHarness();
    const pending = requestPasskeyPopup(
      'create',
      {
        alias: 'Phone',
        userId: 'profile-1',
        rpId: 'wallet.example',
      },
      harness.popup as unknown as Window,
      { ceremonyReporter: harness.reporter }
    );
    const request = harness.ready();
    const result = {
      credentialId: 'AQID',
      publicKeyX: '00',
      publicKeyY: '11',
      rpId: 'wallet.example',
    };
    harness.emit({
      type: PASSKEY_POPUP_RESPONSE_EVENT,
      requestId: request.requestId,
      success: true,
      result,
    });

    await expect(pending).resolves.toBe(result);
    expect(harness.browser.open).not.toHaveBeenCalled();
    expect(harness.reporter.started).toHaveBeenCalledExactlyOnceWith({
      kind: 'create',
      mode: 'popup',
      allowCredentials: undefined,
    });
    expect(harness.reporter.finished).toHaveBeenCalledOnce();
    harness.expectCleanedUp();
  });
});
