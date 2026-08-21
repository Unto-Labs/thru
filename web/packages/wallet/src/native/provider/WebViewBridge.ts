import { TELEMETRY_EVENTS } from "@thru/observability";
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
import {
  getErrorCode as getSharedErrorCode,
  getErrorMessage as getSharedErrorMessage,
  getSafeRequestTelemetryFields,
  getSafeResponseTelemetryFields,
} from "../../internal/telemetry-fields";
import { sanitizeTelemetryMessage } from "../../telemetry";

/* RN-side analog of `web/packages/embedded-provider/src/IframeManager.ts`.
   The wallet ships unchanged. The shell HTML (src/shell.html) hosts an
   <iframe src="app.tid.sh/embedded/native"> and forwards
   iframe<->ReactNativeWebView postMessage traffic. This bridge only
   speaks the RN side: webView.injectJavaScript out, onMessage in. */

const TRUSTED_WALLET_ORIGINS = [
  'https://app.tid.sh',
  'https://staging-app.tid.sh',
  'https://wallet.tid.sh',
  'https://wallet.staging.web.5f1.net',
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
    TRUSTED_WALLET_ORIGINS.includes(origin) ||
    isAllowedDevelopmentOrigin(url);
  if (!isAllowed) {
    throw new Error(
      `Untrusted wallet origin: ${origin}. Only trusted origins are allowed: ${TRUSTED_WALLET_ORIGINS.join(', ')}. ` +
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
  POST_MESSAGE_REQUEST_TYPES.DEPOSIT,
  POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION,
  POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
  POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
]);

export interface WebViewBridgeOptions {
  walletUrl: string;
  telemetryEnabled?: boolean;
  telemetrySessionId?: string;
  /** Opaque host-app-provided correlation label forwarded to the wallet. */
  telemetryAppContextId?: string;
  telemetry?: NativeTelemetryRecorder;
}

export interface NativeTelemetryFields {
  severity?: 'debug' | 'info' | 'warn' | 'error';
  frameId?: string;
  requestId?: string;
  appOrigin?: string;
  network?: string;
  operation?: string;
  durationMs?: number;
  outcome?: string;
  errorCode?: string;
  walletAddress?: string;
  programAddress?: string;
  transactionSignature?: string;
  message?: string;
}

export type NativeTelemetryRecorder = (
  event: string,
  fields?: NativeTelemetryFields,
) => void;

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

  private readonly telemetryEnabled: boolean;
  private readonly telemetrySessionId?: string;
  private telemetryAppContextId?: string;
  private readonly telemetry?: NativeTelemetryRecorder;

  private webView: WebViewRefLike | null = null;
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((err: Error) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private webViewLoadStartedAt: number | null = null;

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
    this.telemetryEnabled = options.telemetryEnabled ?? true;
    this.telemetrySessionId = options.telemetrySessionId;
    this.telemetryAppContextId = options.telemetryAppContextId;
    this.telemetry = options.telemetry;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_CONSTRUCTED, {
      severity: 'info',
      outcome: 'created',
    });
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
    url.searchParams.set('tn_telemetry', this.telemetryEnabled ? '1' : '0');
    if (this.telemetrySessionId) {
      url.searchParams.set('tn_telemetry_session', this.telemetrySessionId);
    }
    if (this.telemetryAppContextId) {
      url.searchParams.set('tn_telemetry_app_context', this.telemetryAppContextId);
    } else {
      url.searchParams.delete('tn_telemetry_app_context');
    }
    return url.toString();
  }

  /** Set or clear the correlation label carried by later WebView loads. */
  setTelemetryAppContextId(value: string | null): void {
    this.telemetryAppContextId = value ?? undefined;
  }

  /**
   * Hand the bridge a WebView ref. Required before `awaitReady()` /
   * `sendMessage()` will resolve.
   */
  attachWebView(ref: WebViewRefLike): void {
    this.webView = ref;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_WEBVIEW_ATTACHED, {
      severity: 'info',
      outcome: 'attached',
    });
  }

  /** Record the native host WebView lifecycle without accepting its URL. */
  recordWebViewLoadStarted(): void {
    this.webViewLoadStartedAt = Date.now();
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_WEBVIEW_LOAD_STARTED, {
      severity: 'info',
      operation: 'webview_load',
      outcome: 'started',
    });
  }

  /** Record onLoadEnd. This is an end marker, not proof of HTTP success. */
  recordWebViewLoadEnded(): void {
    const duration = this.getWebViewLoadDuration();
    this.webViewLoadStartedAt = null;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_WEBVIEW_LOAD_ENDED, {
      severity: 'info',
      operation: 'webview_load',
      outcome: 'ended',
      ...duration,
    });
  }

  /** Record a transport failure using only its numeric code and safe message. */
  recordWebViewTransportError(
    code: number | undefined,
    description: string,
  ): void {
    const message = sanitizeTelemetryMessage(description);
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_WEBVIEW_LOAD_FAILED, {
      severity: 'error',
      operation: 'webview_load',
      outcome: 'transport_error',
      ...(typeof code === 'number' && Number.isFinite(code)
        ? { errorCode: `WEBVIEW_${Math.trunc(code)}` }
        : {}),
      ...this.getWebViewLoadDuration(),
      ...(message ? { message } : {}),
    });
  }

  /** Record an HTTP load failure without retaining the response URL. */
  recordWebViewHttpError(statusCode: number): void {
    const safeStatus =
      Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
        ? statusCode
        : undefined;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_WEBVIEW_LOAD_FAILED, {
      severity: 'error',
      operation: 'webview_load',
      outcome: 'http_error',
      ...(safeStatus ? { errorCode: `HTTP_${safeStatus}` } : {}),
      ...this.getWebViewLoadDuration(),
      ...(safeStatus ? { message: `Wallet returned HTTP ${safeStatus}` } : {}),
    });
  }

  /** Record an iOS WebKit process termination without native event details. */
  recordWebViewContentProcessTerminated(): void {
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_WEBVIEW_CONTENT_PROCESS_TERMINATED, {
      severity: 'error',
      operation: 'webview_load',
      outcome: 'content_process_terminated',
      errorCode: 'WEBVIEW_CONTENT_PROCESS_TERMINATED',
      ...this.getWebViewLoadDuration(),
    });
  }

  /**
   * Mark the bridge ready when the native host loads the wallet as the
   * top-level WebView document instead of through the shell iframe.
   */
  markReady(): void {
    if (this.ready) {
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_READY_DUPLICATE, {
        severity: 'debug',
        outcome: 'ignored',
      });
      return;
    }
    this.ready = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const r = this.resolveReady;
    this.resolveReady = null;
    this.rejectReady = null;
    r?.();
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_READY_RECEIVED, {
      severity: 'info',
      outcome: 'ready',
    });
  }

  /**
   * Returns a promise that resolves when the iframe sends
   * IFRAME_READY_EVENT. Idempotent: returns the same promise on
   * subsequent calls. Rejects after READY_TIMEOUT_MS.
   */
  awaitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;
    const startedAt = Date.now();
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_READY_WAITING, {
      severity: 'debug',
      outcome: 'started',
    });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null;
        if (this.rejectReady) {
          const r = this.rejectReady;
          this.rejectReady = null;
          this.resolveReady = null;
          this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_READY_TIMEOUT, {
            severity: 'error',
            durationMs: Date.now() - startedAt,
            outcome: 'timeout',
            errorCode: ErrorCode.TIMEOUT,
            message: 'Wallet WebView did not become ready',
          });
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
    const startedAt = Date.now();
    const safeRequestFields = getSafeRequestTelemetryFields(request);
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_STARTED, {
      severity: 'debug',
      requestId: request.id,
      operation: request.type,
      appOrigin: request.origin,
      outcome: 'started',
      ...safeRequestFields,
    });
    if (this.destroyed) {
      const error = new Error('Bridge destroyed');
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
        severity: 'error',
        requestId: request.id,
        operation: request.type,
        appOrigin: request.origin,
        durationMs: Date.now() - startedAt,
        outcome: 'bridge_destroyed',
        errorCode: ErrorCode.UNKNOWN_ERROR,
        message: error.message,
        ...safeRequestFields,
      });
      throw error;
    }
    try {
      await this.awaitReady();
    } catch (error) {
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
        severity: 'error',
        requestId: request.id,
        operation: request.type,
        appOrigin: request.origin,
        durationMs: Date.now() - startedAt,
        outcome: 'bridge_not_ready',
        errorCode: getErrorCode(error),
        message: getErrorMessage(error),
        ...safeRequestFields,
      });
      throw error;
    }
    if (!this.webView) {
      const error = new Error('WebView not attached - call attachWebView() first');
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
        severity: 'error',
        requestId: request.id,
        operation: request.type,
        appOrigin: request.origin,
        durationMs: Date.now() - startedAt,
        outcome: 'webview_not_attached',
        errorCode: ErrorCode.UNKNOWN_ERROR,
        message: error.message,
        ...safeRequestFields,
      });
      throw error;
    }

    const timeoutMs = SLOW_REQUEST_TYPES.has(request.type)
      ? SLOW_REQUEST_TIMEOUT_MS
      : FAST_REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageHandlers.delete(request.id);
        this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_TIMEOUT, {
          severity: 'error',
          requestId: request.id,
          operation: request.type,
          appOrigin: request.origin,
          durationMs: Date.now() - startedAt,
          outcome: 'timeout',
          errorCode: ErrorCode.TIMEOUT,
          message: 'Wallet did not respond before the request timeout',
          ...safeRequestFields,
        });
        reject(new Error('Request timeout - wallet did not respond'));
      }, timeoutMs);

      this.messageHandlers.set(request.id, (response) => {
        clearTimeout(timer);
        this.messageHandlers.delete(request.id);
        if (response.success) {
          this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_COMPLETED, {
            severity: 'info',
            requestId: request.id,
            operation: request.type,
            appOrigin: request.origin,
            durationMs: Date.now() - startedAt,
            outcome: 'success',
            ...safeRequestFields,
            ...getSafeResponseTelemetryFields(request.type, response.result),
          });
          resolve(
            response as InferSuccessfulPostMessageResponse<TRequest>
          );
        } else {
          const err = new Error(response.error?.message || 'Unknown error');
          (err as { code?: string; data?: unknown }).code = response.error?.code;
          (err as { code?: string; data?: unknown }).data = response.error?.data;
          this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
            severity: 'warn',
            requestId: request.id,
            operation: request.type,
            appOrigin: request.origin,
            durationMs: Date.now() - startedAt,
            outcome: 'wallet_error',
            errorCode: response.error?.code ?? ErrorCode.UNKNOWN_ERROR,
            message: err.message,
            ...safeRequestFields,
          });
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
      try {
        this.webView!.injectJavaScript(script);
        this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_SENT, {
          severity: 'debug',
          requestId: request.id,
          operation: request.type,
          appOrigin: request.origin,
          outcome: 'sent',
          ...safeRequestFields,
        });
      } catch (error) {
        clearTimeout(timer);
        this.messageHandlers.delete(request.id);
        this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
          severity: 'error',
          requestId: request.id,
          operation: request.type,
          appOrigin: request.origin,
          durationMs: Date.now() - startedAt,
          outcome: 'injection_error',
          errorCode: getErrorCode(error),
          message: getErrorMessage(error),
          ...safeRequestFields,
        });
        reject(error);
      }
    });
  }

  /**
   * Reject all in-flight wallet requests when the native host dismisses the
   * WebView without waiting for a wallet-side response.
   */
  rejectPendingRequests(message = 'User rejected the request'): void {
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_REQUESTS_REJECTED, {
      severity: 'warn',
      outcome: 'user_rejected',
      errorCode: ErrorCode.USER_REJECTED,
      message,
    });
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
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_MESSAGE_MALFORMED, {
        severity: 'warn',
        outcome: 'invalid_json',
        errorCode: ErrorCode.UNKNOWN_ERROR,
        message: 'Received a non-JSON WebView message',
      });
      return;
    }
    if (!data || typeof data !== 'object') {
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_MESSAGE_MALFORMED, {
        severity: 'warn',
        outcome: 'non_object',
        errorCode: ErrorCode.UNKNOWN_ERROR,
        message: 'Received a non-object WebView message',
      });
      return;
    }
    const msg = data as Record<string, unknown>;

    /* Frame-id check matches the iframe model: ignore traffic that
       isn't tagged for this bridge instance. */
    if (msg.frameId !== this.frameId) {
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_MESSAGE_IGNORED, {
        severity: 'debug',
        outcome: 'frame_mismatch',
      });
      return;
    }

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
      this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_EVENT_RECEIVED, {
        severity: 'debug',
        operation: evt.event,
        outcome: 'received',
      });
      this.onEvent?.(evt.event, evt.data);
      return;
    }

    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_MESSAGE_IGNORED, {
      severity: 'debug',
      outcome:
        typeof msg.id === 'string' ? 'unknown_request_id' : 'unknown_message',
    });
  }

  /**
   * Drop pending handlers and clear ready promise. Call when the host
   * unmounts the WebView.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
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
    for (const [id, handler] of Array.from(this.messageHandlers.entries())) {
      handler({
        id,
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Bridge destroyed',
        },
      });
    }
    this.webView = null;
    this.recordTelemetry(TELEMETRY_EVENTS.BRIDGE_DESTROYED, {
      severity: 'info',
      outcome: 'destroyed',
    });
  }

  private recordTelemetry(
    event: string,
    fields?: NativeTelemetryFields,
  ): void {
    try {
      this.telemetry?.(event, { frameId: this.frameId, ...fields });
    } catch {
      /* Telemetry must never affect wallet behavior. */
    }
  }

  private getWebViewLoadDuration(): Pick<NativeTelemetryFields, 'durationMs'> {
    return this.webViewLoadStartedAt === null
      ? {}
      : { durationMs: Math.max(0, Date.now() - this.webViewLoadStartedAt) };
  }
}

function getErrorCode(error: unknown): string {
  return getSharedErrorCode(error) ?? ErrorCode.UNKNOWN_ERROR;
}

function getErrorMessage(error: unknown): string {
  return getSharedErrorMessage(error, 'Unknown wallet bridge error');
}
