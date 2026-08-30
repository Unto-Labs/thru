import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IFRAME_READY_EVENT,
  POST_MESSAGE_EVENT_TYPE,
  POST_MESSAGE_REQUEST_TYPES,
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
  createRequestId,
} from "../../protocol";
import {
  WebViewBridge,
  type NativeTelemetryFields,
  type WebViewMessageEventLike,
} from './WebViewBridge';

const WALLET_URL = 'http://localhost:3000/embedded';
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function restoreNodeEnv(): void {
  if (ORIGINAL_NODE_ENV === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
    return;
  }
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
}

class MockWebView {
  injected: string[] = [];
  injectJavaScript = (script: string): void => {
    this.injected.push(script);
  };
}

function readyMessage(frameId: string): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({
        type: IFRAME_READY_EVENT,
        frameId,
        data: { ready: true },
      }),
    },
  };
}

function responseMessage(
  frameId: string,
  id: string,
  result: unknown
): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({ id, frameId, success: true, result }),
    },
  };
}

function errorMessage(
  frameId: string,
  id: string,
  code: string,
  message: string
): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({
        id,
        frameId,
        success: false,
        error: { code, message },
      }),
    },
  };
}

function eventMessage(
  frameId: string,
  event: string,
  data?: unknown
): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({
        type: POST_MESSAGE_EVENT_TYPE,
        frameId,
        event,
        data,
      }),
    },
  };
}

function parseInjectedTelemetryContext(script: string): unknown {
  const match = script.match(/var msg = (.*?);\s*if \(window\.__pushIn\)/s);
  if (!match) throw new Error('Injected message not found');
  return JSON.parse(match[1]!);
}

/* Flush enough microtask ticks for sendMessage's `await awaitReady()` to
   land, the injectJavaScript call to fire, and the handler to register. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('WebViewBridge', () => {
  let bridge: WebViewBridge;
  let webView: MockWebView;

  beforeEach(() => {
    bridge = new WebViewBridge({ walletUrl: WALLET_URL });
    webView = new MockWebView();
    bridge.attachWebView(webView);
  });

  afterEach(() => {
    restoreNodeEnv();
    delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    bridge.destroy();
  });

  it('rejects untrusted wallet origins at construction', () => {
    expect(
      () => new WebViewBridge({ walletUrl: 'https://evil.example.com/embed' })
    ).toThrow(/Untrusted wallet origin/);
  });

  it('allows generic dev wallet origins outside production builds', () => {
    const localHostnameBridge = new WebViewBridge({
      walletUrl: 'http://dev-wallet:3000/embedded',
    });
    expect(localHostnameBridge.walletOrigin).toBe('http://dev-wallet:3000');
    localHostnameBridge.destroy();

    const tailscaleBridge = new WebViewBridge({
      walletUrl: 'https://wallet-dev.tailabc.ts.net/embedded',
    });
    expect(tailscaleBridge.walletOrigin).toBe('https://wallet-dev.tailabc.ts.net');
    tailscaleBridge.destroy();

    const tailscaleIpBridge = new WebViewBridge({
      walletUrl: 'http://100.64.0.1:3000/embedded',
    });
    expect(tailscaleIpBridge.walletOrigin).toBe('http://100.64.0.1:3000');
    tailscaleIpBridge.destroy();
  });

  it('allows a Bonjour wallet dev origin', () => {
    const bridge = new WebViewBridge({
      walletUrl: 'http://dev-wallet.local:3000/embedded',
    });
    expect(bridge.walletOrigin).toBe('http://dev-wallet.local:3000');
    bridge.destroy();
  });

  it('allows the Tailscale HTTPS wallet dev origin', () => {
    const bridge = new WebViewBridge({
      walletUrl: 'https://wallet-dev.tailabc.ts.net/embedded',
    });
    expect(bridge.walletOrigin).toBe('https://wallet-dev.tailabc.ts.net');
    bridge.destroy();
  });

  it('rejects dev wallet origins in production builds', () => {
    process.env.NODE_ENV = 'production';

    const productionBridge = new WebViewBridge({
      walletUrl: 'https://app.tid.sh/embedded',
    });
    expect(productionBridge.walletOrigin).toBe('https://app.tid.sh');
    productionBridge.destroy();

    expect(
      () => new WebViewBridge({ walletUrl: 'http://localhost:3000/embedded' })
    ).toThrow(/Untrusted wallet origin/);
    expect(
      () => new WebViewBridge({ walletUrl: 'https://wallet-dev.tailabc.ts.net/embedded' })
    ).toThrow(/Untrusted wallet origin/);
    expect(
      () => new WebViewBridge({ walletUrl: 'http://100.64.0.1:3000/embedded' })
    ).toThrow(/Untrusted wallet origin/);
  });

  it('allows wallet.tid.sh in production builds', () => {
    process.env.NODE_ENV = 'production';

    const productionBridge = new WebViewBridge({
      walletUrl: 'https://wallet.tid.sh/embedded',
    });
    expect(productionBridge.walletOrigin).toBe('https://wallet.tid.sh');
    productionBridge.destroy();
  });

  it('allows staging-app.tid.sh in production builds', () => {
    process.env.NODE_ENV = 'production';

    const stagingBridge = new WebViewBridge({
      walletUrl: 'https://staging-app.tid.sh/embedded/native/transparent',
    });
    expect(stagingBridge.walletOrigin).toBe('https://staging-app.tid.sh');
    stagingBridge.destroy();
  });

  it('allows the staging wallet in production builds', () => {
    process.env.NODE_ENV = 'production';

    const stagingAppBridge = new WebViewBridge({
      walletUrl: 'https://staging-app.tid.sh/embedded',
    });
    expect(stagingAppBridge.walletOrigin).toBe('https://staging-app.tid.sh');
    stagingAppBridge.destroy();

    const stagingBridge = new WebViewBridge({
      walletUrl: 'https://wallet.staging.web.5f1.net/embedded',
    });
    expect(stagingBridge.walletOrigin).toBe(
      'https://wallet.staging.web.5f1.net'
    );
    stagingBridge.destroy();
  });

  it('uses the React Native __DEV__ flag when present', () => {
    process.env.NODE_ENV = 'test';
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

    expect(
      () => new WebViewBridge({ walletUrl: 'http://localhost:3000/embedded' })
    ).toThrow(/Untrusted wallet origin/);

    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
    const bridge = new WebViewBridge({
      walletUrl: 'http://localhost:3000/embedded',
    });
    expect(bridge.walletOrigin).toBe('http://localhost:3000');
    bridge.destroy();
  });

  it('appends tn_frame_id to the iframe src', () => {
    const src = bridge.getIframeSrc();
    expect(src).toContain('tn_frame_id=');
    expect(src).toContain('tn_telemetry=1');
    expect(src).toContain('/embedded/native');
    expect(src.startsWith('http://localhost:3000/embedded')).toBe(true);
  });

  it('propagates telemetry opt-out and session to the iframe src', () => {
    const optedOutBridge = new WebViewBridge({
      walletUrl: WALLET_URL,
      telemetryEnabled: false,
      telemetrySessionId: 'telemetry_native_test',
    });
    const src = new URL(optedOutBridge.getIframeSrc());

    expect(src.searchParams.get('tn_telemetry')).toBe('0');
    expect(src.searchParams.get('tn_telemetry_session')).toBe(
      'telemetry_native_test'
    );

    optedOutBridge.destroy();
  });

  it('pushes runtime telemetry context to an already-loaded wallet', () => {
    bridge.onMessage(readyMessage(bridge.frameId));
    expect(webView.injected).toHaveLength(0);

    bridge.setTelemetryAppContextId('user-42');
    bridge.setTelemetryContext({ anon_id: 'install-7' });

    const messages = webView.injected.map(parseInjectedTelemetryContext);
    expect(messages).toEqual([
      {
        type: 'telemetry:context',
        origin: bridge.walletOrigin,
        frameId: bridge.frameId,
        appContextId: 'user-42',
      },
      {
        type: 'telemetry:context',
        origin: bridge.walletOrigin,
        frameId: bridge.frameId,
        appContextId: 'user-42',
        appContext: { anon_id: 'install-7' },
      },
    ]);
  });

  it('restates telemetry context to a reloaded wallet document', () => {
    bridge.onMessage(readyMessage(bridge.frameId));
    bridge.setTelemetryAppContextId('user-42');
    webView.injected.length = 0;

    bridge.onMessage(readyMessage(bridge.frameId));

    expect(webView.injected.map(parseInjectedTelemetryContext)).toEqual([
      {
        type: 'telemetry:context',
        origin: bridge.walletOrigin,
        frameId: bridge.frameId,
        appContextId: 'user-42',
      },
    ]);
  });

  it('propagates cleared telemetry context to the loaded wallet', () => {
    const contextBridge = new WebViewBridge({
      walletUrl: WALLET_URL,
      telemetryAppContextId: 'user-42',
    });
    const contextWebView = new MockWebView();
    contextBridge.attachWebView(contextWebView);
    contextBridge.onMessage(readyMessage(contextBridge.frameId));

    contextBridge.setTelemetryAppContextId(null);

    expect(parseInjectedTelemetryContext(contextWebView.injected[0]!)).toEqual({
      type: 'telemetry:context',
      origin: contextBridge.walletOrigin,
      frameId: contextBridge.frameId,
    });

    contextBridge.destroy();
  });

  it('preserves transparent native wallet paths', () => {
    const transparentBridge = new WebViewBridge({
      walletUrl: 'http://localhost:3000/embedded/native/transparent',
    });
    const src = new URL(transparentBridge.getIframeSrc());
    expect(src.pathname).toBe('/embedded/native/transparent');
    expect(src.searchParams.get('tn_frame_id')).toBe(transparentBridge.frameId);
    transparentBridge.destroy();
  });

  it('resolves awaitReady on IFRAME_READY_EVENT with matching frameId', async () => {
    const ready = bridge.awaitReady();
    bridge.onMessage(readyMessage(bridge.frameId));
    await expect(ready).resolves.toBeUndefined();
  });

  it('remembers an early IFRAME_READY_EVENT before awaitReady is called', async () => {
    bridge.onMessage(readyMessage(bridge.frameId));
    await expect(bridge.awaitReady()).resolves.toBeUndefined();
  });

  it('ignores ready events tagged with a different frameId', async () => {
    const ready = bridge.awaitReady();
    bridge.onMessage(readyMessage('frame_other'));
    await expect(
      Promise.race([
        ready,
        new Promise((res) => setTimeout(() => res('not-ready'), 30)),
      ])
    ).resolves.toBe('not-ready');
  });

  it('returns the same ready promise on repeated calls', () => {
    expect(bridge.awaitReady()).toBe(bridge.awaitReady());
  });

  it('routes a successful response back to the request promise', async () => {
    bridge.awaitReady();
    bridge.onMessage(readyMessage(bridge.frameId));

    const id = createRequestId();
    const promise = bridge.sendMessage({
      id,
      type: POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS,
      origin: 'app://test',
    });

    await flush();
    expect(webView.injected.length).toBe(1);
    expect(webView.injected[0]).toContain('window.__pushIn');
    expect(webView.injected[0]).toContain("new MessageEvent('message'");
    expect(webView.injected[0]).toContain(bridge.frameId);
    expect(webView.injected[0]).toContain(id);

    bridge.onMessage(responseMessage(bridge.frameId, id, { accounts: [] }));
    const res = await promise;
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ accounts: [] });
  });

  it('rejects with the carried error code on a failure response', async () => {
    bridge.awaitReady();
    bridge.onMessage(readyMessage(bridge.frameId));

    const id = createRequestId();
    const promise = bridge.sendMessage({
      id,
      type: POST_MESSAGE_REQUEST_TYPES.DISCONNECT,
      origin: 'app://test',
    });
    await flush();
    bridge.onMessage(
      errorMessage(bridge.frameId, id, ErrorCode.USER_REJECTED, 'nope')
    );
    await expect(promise).rejects.toMatchObject({
      message: 'nope',
      code: ErrorCode.USER_REJECTED,
    });
  });

  it('rejects in-flight requests when the native sheet is dismissed', async () => {
    bridge.awaitReady();
    bridge.onMessage(readyMessage(bridge.frameId));

    const promise = bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
      origin: 'app://test',
      payload: {
        instructionData: 'AAAA',
        programAddress: 'thru_program',
      },
    });

    await flush();
    bridge.rejectPendingRequests();

    await expect(promise).rejects.toMatchObject({
      message: 'User rejected the request',
      code: ErrorCode.USER_REJECTED,
    });
  });

  it('drops responses tagged with a different frameId', async () => {
    bridge.awaitReady();
    bridge.onMessage(readyMessage(bridge.frameId));

    const id = createRequestId();
    const promise = bridge.sendMessage({
      id,
      type: POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS,
      origin: 'app://test',
    });
    await flush();
    bridge.onMessage(responseMessage('frame_other', id, { accounts: [] }));
    bridge.onMessage(responseMessage(bridge.frameId, id, { accounts: [] }));
    await expect(promise).resolves.toBeDefined();
  });

  it('forwards event broadcasts via onEvent', () => {
    const seen: Array<{ event: string; data: unknown }> = [];
    bridge.onEvent = (event, data) => seen.push({ event, data });
    bridge.onMessage(
      eventMessage(bridge.frameId, EMBEDDED_PROVIDER_EVENTS.UI_SHOW)
    );
    expect(seen).toEqual([
      { event: EMBEDDED_PROVIDER_EVENTS.UI_SHOW, data: undefined },
    ]);
  });

  it('records correlated request telemetry without recording sensitive payloads', async () => {
    const events: Array<{ event: string; fields?: NativeTelemetryFields }> = [];
    const instrumentedBridge = new WebViewBridge({
      walletUrl: WALLET_URL,
      telemetrySessionId: 'telemetry_native_test',
      telemetry: (event, fields) => events.push({ event, fields }),
    });
    const instrumentedWebView = new MockWebView();
    instrumentedBridge.attachWebView(instrumentedWebView);
    instrumentedBridge.onMessage(readyMessage(instrumentedBridge.frameId));

    const id = createRequestId();
    const promise = instrumentedBridge.sendMessage({
      id,
      type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
      origin: 'app://telemetry-test',
      payload: {
        walletAddress: 'thru_wallet_public',
        programAddress: 'thru_program_public',
        instructionData: 'SENSITIVE_INSTRUCTION_DATA',
        review: { appName: 'SENSITIVE_REVIEW' },
      },
    });
    await flush();
    instrumentedBridge.onMessage(
      responseMessage(instrumentedBridge.frameId, id, {
        signedTransaction: 'SENSITIVE_RAW_TRANSACTION',
      })
    );
    await promise;

    expect(events).toContainEqual({
      event: 'bridge.request.sent',
      fields: expect.objectContaining({
        frameId: instrumentedBridge.frameId,
        requestId: id,
        operation: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
        walletAddress: 'thru_wallet_public',
        programAddress: 'thru_program_public',
      }),
    });
    expect(events).toContainEqual({
      event: 'bridge.request.completed',
      fields: expect.objectContaining({
        frameId: instrumentedBridge.frameId,
        requestId: id,
        outcome: 'success',
      }),
    });
    expect(JSON.stringify(events)).not.toContain('SENSITIVE_INSTRUCTION_DATA');
    expect(JSON.stringify(events)).not.toContain('SENSITIVE_REVIEW');
    expect(JSON.stringify(events)).not.toContain('SENSITIVE_RAW_TRANSACTION');

    instrumentedBridge.destroy();
  });

  it('records safe native WebView load lifecycle details without URLs', () => {
    const events: Array<{ event: string; fields?: NativeTelemetryFields }> = [];
    const instrumentedBridge = new WebViewBridge({
      walletUrl: WALLET_URL,
      telemetry: (event, fields) => events.push({ event, fields }),
    });

    instrumentedBridge.recordWebViewLoadStarted();
    instrumentedBridge.recordWebViewLoadEnded();
    instrumentedBridge.recordWebViewTransportError(
      -1009,
      'Offline at https://wallet.example/path?token=secret',
    );
    instrumentedBridge.recordWebViewHttpError(503);
    instrumentedBridge.recordWebViewContentProcessTerminated();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'bridge.webview.load.started',
          fields: expect.objectContaining({ outcome: 'started' }),
        }),
        expect.objectContaining({
          event: 'bridge.webview.load.ended',
          fields: expect.objectContaining({ outcome: 'ended' }),
        }),
        expect.objectContaining({
          event: 'bridge.webview.load.failed',
          fields: expect.objectContaining({
            outcome: 'transport_error',
            errorCode: 'WEBVIEW_-1009',
            message: 'Offline at https://wallet.example/path',
          }),
        }),
        expect.objectContaining({
          event: 'bridge.webview.load.failed',
          fields: expect.objectContaining({
            outcome: 'http_error',
            errorCode: 'HTTP_503',
          }),
        }),
        expect.objectContaining({
          event: 'bridge.webview.content_process.terminated',
          fields: expect.objectContaining({
            errorCode: 'WEBVIEW_CONTENT_PROCESS_TERMINATED',
          }),
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('token=secret');

    instrumentedBridge.destroy();
  });

  it('records malformed and frame-mismatched WebView messages', () => {
    const events: Array<{ event: string; fields?: NativeTelemetryFields }> = [];
    const instrumentedBridge = new WebViewBridge({
      walletUrl: WALLET_URL,
      telemetry: (event, fields) => events.push({ event, fields }),
    });

    instrumentedBridge.onMessage({ nativeEvent: { data: '{invalid' } });
    instrumentedBridge.onMessage(
      responseMessage('frame_other', 'req_other', { accounts: [] })
    );

    expect(events).toContainEqual({
      event: 'bridge.message.malformed',
      fields: expect.objectContaining({ outcome: 'invalid_json' }),
    });
    expect(events).toContainEqual({
      event: 'bridge.message.ignored',
      fields: expect.objectContaining({
        outcome: 'frame_mismatch',
      }),
    });

    instrumentedBridge.destroy();
  });

  it('does not stringify arbitrary values thrown by WebView injection', async () => {
    const events: Array<{ event: string; fields?: NativeTelemetryFields }> = [];
    const sensitiveThrownValue = {
      toString: () => 'SENSITIVE_RAW_PAYLOAD',
    };
    const instrumentedBridge = new WebViewBridge({
      walletUrl: WALLET_URL,
      telemetry: (event, fields) => events.push({ event, fields }),
    });
    instrumentedBridge.attachWebView({
      injectJavaScript: () => {
        throw sensitiveThrownValue;
      },
    });
    instrumentedBridge.onMessage(readyMessage(instrumentedBridge.frameId));

    const promise = instrumentedBridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS,
      origin: 'app://test',
    });

    await expect(promise).rejects.toBe(sensitiveThrownValue);
    const failed = events.find(
      ({ event, fields }) =>
        event === 'bridge.request.failed' &&
        fields?.outcome === 'injection_error'
    );
    expect(failed?.fields?.message).toBe('Unknown wallet bridge error');
    expect(JSON.stringify(events)).not.toContain('SENSITIVE_RAW_PAYLOAD');

    instrumentedBridge.destroy();
  });

  it('rejects in-flight sendMessage if the WebView ref is dropped before injection', async () => {
    bridge.awaitReady();
    bridge.onMessage(readyMessage(bridge.frameId));

    const promise = bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS,
      origin: 'app://test',
    });
    /* Destroy before the post-await body of sendMessage gets to run. */
    bridge.destroy();
    await expect(promise).rejects.toThrow(/WebView not attached/);
  });

  it('rejects awaitReady on destroy when ready hasn\'t arrived', async () => {
    const ready = bridge.awaitReady();
    bridge.destroy();
    await expect(ready).rejects.toThrow(/Bridge destroyed/);
  });

  it('rejects an already-sent request when the bridge is destroyed', async () => {
    bridge.onMessage(readyMessage(bridge.frameId));
    const promise = bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.GET_ACCOUNTS,
      origin: 'app://test',
    });
    await flush();

    bridge.destroy();

    await expect(promise).rejects.toThrow(/Bridge destroyed/);
  });

  /* Note: the 30s / 5min timeout values are exercised by integration
     tests; unit-testing them with fake timers leaks pending rejections
     past test boundaries. See SLOW_REQUEST_TIMEOUT_MS / FAST_REQUEST_TIMEOUT_MS
     in WebViewBridge.ts for the contract. */
});
