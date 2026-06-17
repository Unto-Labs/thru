import {
  ErrorCode,
  IFRAME_READY_EVENT,
  POST_MESSAGE_EVENT_TYPE,
  POST_MESSAGE_REQUEST_TYPES,
  createRequestId,
  type InferSuccessfulPostMessageResponse,
  type PostMessageEvent,
  type PostMessageRequest,
  type PostMessageResponse,
} from "../../protocol";

/* RN-side analog of `web/packages/embedded-provider/src/IframeManager.ts`.
   The wallet ships unchanged. The shell HTML (src/shell.html) hosts an
   <iframe src="app.tid.sh/embedded/native"> and forwards
   iframe<->ReactNativeWebView postMessage traffic. This bridge only
   speaks the RN side: webView.injectJavaScript out, onMessage in. */

const PRODUCTION_WALLET_ORIGINS = [
  'https://app.tid.sh',
  'https://wallet.tid.sh',
];

function isDevelopmentBuild(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __DEV__?: boolean;
    process?: { env?: { NODE_ENV?: string } };
  };

  const devFlag = runtime.__DEV__;
  if (typeof devFlag === 'boolean') return devFlag;

  return (
    runtime.process?.env?.NODE_ENV !== undefined &&
    runtime.process.env.NODE_ENV !== 'production'
  );
}

function isPrivateIpv4Host(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isAllowedDevelopmentOrigin(url: URL): boolean {
  if (!isDevelopmentBuild()) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const hostname = url.hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    !hostname.includes('.') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.ts.net') ||
    isPrivateIpv4Host(hostname)
  );
}

function validateWalletOrigin(walletUrl: string): void {
  let url: URL;
  try {
    url = new URL(walletUrl);
  } catch {
    throw new Error(
      `Invalid wallet URL: ${walletUrl}. URL must be a valid absolute URL.`
    );
  }
  const origin = url.origin;
  const isAllowed =
    PRODUCTION_WALLET_ORIGINS.includes(origin) ||
    isAllowedDevelopmentOrigin(url);
  if (!isAllowed) {
    throw new Error(
      `Untrusted wallet origin: ${origin}. Only trusted origins are allowed: ${PRODUCTION_WALLET_ORIGINS.join(', ')}. ` +
        'Development builds also allow localhost, LAN, and Tailscale wallet origins.'
    );
  }
}

function isNativeEmbeddedWalletPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized === '/embedded/native' || normalized.startsWith('/embedded/native/');
}

/* Minimal contract for a react-native-webview ref. We accept both refs
   ({ current: WebView }) and direct WebView instances. */
export interface WebViewRefLike {
  injectJavaScript: (script: string) => void;
}

export interface WebViewMessageEventLike {
  nativeEvent: { data: string };
}

const READY_TIMEOUT_MS = 10_000;
const SLOW_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const FAST_REQUEST_TIMEOUT_MS = 30 * 1000;

const SLOW_REQUEST_TYPES: ReadonlySet<string> = new Set([
  POST_MESSAGE_REQUEST_TYPES.CONNECT,
  POST_MESSAGE_REQUEST_TYPES.CREATE_ACCOUNT,
  POST_MESSAGE_REQUEST_TYPES.SIGN_MESSAGE,
  POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
  POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE,
  POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS,
  POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION,
  POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
  POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
]);

export interface WebViewBridgeOptions {
  walletUrl: string;
}

/**
 * Bidirectional bridge between a host React Native app and the wallet
 * iframe running inside a `react-native-webview`. Mirrors the public
 * surface of `IframeManager` minus DOM-only concerns (visibility
 * styling lives with the host bottom sheet). All other invariants -
 * frameId correlation, IFRAME_READY handshake, request/response
 * routing, timeouts - match the iframe implementation exactly.
 */
export class WebViewBridge {
  readonly walletUrl: string;
  readonly walletOrigin: string;
  readonly frameId: string;

  private webView: WebViewRefLike | null = null;
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((err: Error) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  private messageHandlers = new Map<
    string,
    (response: PostMessageResponse) => void
  >();

  /* Event broadcasts from the iframe (type === 'event'). */
  public onEvent?: (eventType: string, payload: unknown) => void;

  constructor(options: WebViewBridgeOptions) {
    validateWalletOrigin(options.walletUrl);
    this.walletUrl = options.walletUrl;
    this.walletOrigin = new URL(options.walletUrl).origin;
    this.frameId = createRequestId('frame');
  }

  /**
   * Compose the URL to load inside the shell <iframe>. The host
   * (ThruWalletSheet) calls this when building the shell HTML.
   */
  getIframeSrc(): string {
    const url = new URL(this.walletUrl);
    if (!isNativeEmbeddedWalletPath(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/native`;
    }
    url.searchParams.set('tn_frame_id', this.frameId);
    return url.toString();
  }

  /**
   * Hand the bridge a WebView ref. Required before `awaitReady()` /
   * `sendMessage()` will resolve.
   */
  attachWebView(ref: WebViewRefLike): void {
    this.webView = ref;
  }

  /**
   * Mark the bridge ready when the native host loads the wallet as the
   * top-level WebView document instead of through the shell iframe.
   */
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const r = this.resolveReady;
    this.resolveReady = null;
    this.rejectReady = null;
    r?.();
  }

  /**
   * Returns a promise that resolves when the iframe sends
   * IFRAME_READY_EVENT. Idempotent: returns the same promise on
   * subsequent calls. Rejects after READY_TIMEOUT_MS.
   */
  awaitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null;
        if (this.rejectReady) {
          const r = this.rejectReady;
          this.rejectReady = null;
          this.resolveReady = null;
          r(new Error('WebView ready timeout - wallet failed to load'));
        }
      }, READY_TIMEOUT_MS);
    });
    return this.readyPromise;
  }

  /**
   * Send a request to the iframe (via injectJavaScript -> shell ->
   * iframe.postMessage) and resolve with the matching response.
   */
  async sendMessage<TRequest extends PostMessageRequest>(
    request: TRequest
  ): Promise<InferSuccessfulPostMessageResponse<TRequest>> {
    await this.awaitReady();
    if (!this.webView) {
      throw new Error('WebView not attached - call attachWebView() first');
    }

    const timeoutMs = SLOW_REQUEST_TYPES.has(request.type)
      ? SLOW_REQUEST_TIMEOUT_MS
      : FAST_REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageHandlers.delete(request.id);
        reject(new Error('Request timeout - wallet did not respond'));
      }, timeoutMs);

      this.messageHandlers.set(request.id, (response) => {
        clearTimeout(timer);
        this.messageHandlers.delete(request.id);
        if (response.success) {
          resolve(
            response as InferSuccessfulPostMessageResponse<TRequest>
          );
        } else {
          const err = new Error(response.error?.message || 'Unknown error');
          (err as { code?: string; data?: unknown }).code = response.error?.code;
          (err as { code?: string; data?: unknown }).data = response.error?.data;
          reject(err);
        }
      });

      const script = `try {
        var msg = ${JSON.stringify({ ...request, frameId: this.frameId })};
        if (window.__pushIn) {
          window.__pushIn(msg);
        } else {
          window.postMessage(msg, window.location.origin);
        }
      } catch (e) {} ; true;`;
      this.webView!.injectJavaScript(script);
    });
  }

  /**
   * Reject all in-flight wallet requests when the native host dismisses the
   * WebView without waiting for a wallet-side response.
   */
  rejectPendingRequests(message = 'User rejected the request'): void {
    for (const [id, handler] of Array.from(this.messageHandlers.entries())) {
      handler({
        id,
        success: false,
        error: {
          code: ErrorCode.USER_REJECTED,
          message,
        },
      });
    }
  }

  /**
   * Hook this into <WebView onMessage>. The shell forwards iframe
   * postMessage payloads to ReactNativeWebView; we route them here.
   */
  onMessage(event: WebViewMessageEventLike): void {
    let data: unknown;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    const msg = data as Record<string, unknown>;

    /* Frame-id check matches the iframe model: ignore traffic that
       isn't tagged for this bridge instance. */
    if (msg.frameId !== this.frameId) return;

    if (msg.type === IFRAME_READY_EVENT) {
      this.markReady();
      return;
    }

    /* Response to a specific request (has `id`). */
    if (typeof msg.id === 'string' && this.messageHandlers.has(msg.id)) {
      const handler = this.messageHandlers.get(msg.id)!;
      handler(msg as unknown as PostMessageResponse);
      return;
    }

    /* Event broadcast (no id). */
    if (msg.type === POST_MESSAGE_EVENT_TYPE) {
      const evt = msg as unknown as PostMessageEvent;
      this.onEvent?.(evt.event, evt.data);
    }
  }

  /**
   * Drop pending handlers and clear ready promise. Call when the host
   * unmounts the WebView.
   */
  destroy(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    if (this.rejectReady && this.readyPromise) {
      /* Attach a swallow handler so Node doesn't flag the rejection as
         unhandled if the host wasn't awaiting it at destroy time. */
      this.readyPromise.catch(() => {});
      this.rejectReady(new Error('Bridge destroyed'));
    }
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
    this.ready = false;
    this.messageHandlers.clear();
    this.webView = null;
  }
}
