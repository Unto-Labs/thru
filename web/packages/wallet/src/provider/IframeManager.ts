import { TELEMETRY_EVENTS, type TelemetryAppContext } from '../observability';
import type {
  InferSuccessfulPostMessageResponse,
  PostMessageEvent,
  PostMessageRequest,
  PostMessageResponse,
  TelemetryContextMessage,
} from './types/messages';
import {
  getSafeRequestTelemetryFields,
  getSafeResponseTelemetryFields,
} from '../internal/telemetry-fields';
import type { TelemetryClient } from '../telemetry';
import {
  IFRAME_READY_EVENT,
  POST_MESSAGE_EVENT_TYPE,
  POST_MESSAGE_REQUEST_TYPES,
  TELEMETRY_CONTEXT_MESSAGE_TYPE,
  createRequestId,
} from './types/messages';

/**
 * Allowed production origins for wallet iframe URLs.
 * Development builds additionally allow localhost, LAN, and Tailscale
 * origins so local HTTPS RP-ID testing can use the hosted wallet path.
 */
const TRUSTED_IFRAME_ORIGINS = [
  'https://app.tid.sh',
  'https://staging-app.tid.sh',
  'https://wallet.tid.sh',
  'https://wallet.staging.web.5f1.net',
];

const SLOW_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const FAST_REQUEST_TIMEOUT_MS = 30 * 1000;
const PARENT_ORIGIN_SEARCH_PARAM = 'tn_parent_origin';
export const WALLET_IFRAME_ALLOW =
  'publickey-credentials-get; publickey-credentials-create; payment *';
const WALLET_IFRAME_BACKGROUND = 'transparent';

const SLOW_REQUEST_TYPES: ReadonlySet<string> = new Set([
  POST_MESSAGE_REQUEST_TYPES.CONNECT,
  POST_MESSAGE_REQUEST_TYPES.SIGN_MESSAGE,
  POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
  POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE,
  POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS,
  POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION,
  POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
  POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
  POST_MESSAGE_REQUEST_TYPES.DEPOSIT,
]);

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

function isDevelopmentHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    !hostname.includes('.') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.ts.net') ||
    isPrivateIpv4Host(hostname)
  );
}

function isAllowedDevelopmentOrigin(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (typeof window === 'undefined') return false;

  const appHostname = window.location.hostname.toLowerCase();
  if (!isDevelopmentHostname(appHostname)) return false;

  return isDevelopmentHostname(url.hostname.toLowerCase());
}

/**
 * Validates that the iframe URL is from a trusted origin
 * @throws Error if the origin is not allowed
 */
function validateIframeOrigin(iframeUrl: string): void {
  let url: URL;
  try {
    url = new URL(iframeUrl);
  } catch (error) {
    throw new Error(
      `Invalid iframe URL: ${iframeUrl}. URL must be a valid absolute URL.`
    );
  }

  const origin = url.origin;
  const isAllowed =
    TRUSTED_IFRAME_ORIGINS.includes(origin) || isAllowedDevelopmentOrigin(url);

  if (!isAllowed) {
    throw new Error(
      `Untrusted iframe origin: ${origin}. ` +
        `Only trusted wallet origins are allowed: ${TRUSTED_IFRAME_ORIGINS.join(', ')}. ` +
        `Development builds also allow localhost, LAN, and Tailscale wallet origins. ` +
        `This security check prevents malicious websites from loading unauthorized wallet iframes.`
    );
  }
}

function getCurrentWindowOrigin(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const origin = window.location.origin;
  if (!origin || origin === 'null') {
    return null;
  }

  return origin;
}

/**
 * Manages iframe lifecycle and postMessage communication
 * Handles creating, showing/hiding iframe, and message passing
 */
export class IframeManager {
  private iframe: HTMLIFrameElement | null = null;
  private iframeUrl: string;
  private iframeOrigin: string;
  private frameId: string;
  private messageHandlers = new Map<string, (response: PostMessageResponse) => void>();
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private displayMode: 'modal' | 'inline' = 'modal';
  private inlineContainer: HTMLElement | null = null;
  private visible = false;
  private telemetry?: TelemetryClient;
  private telemetryAppContextId?: string;
  private telemetryContext?: TelemetryAppContext;
  private telemetryContextUpdated = false;

  /**
   * Callback for event broadcasts from iframe (no request id)
   */
  public onEvent?: (eventType: string, payload: any) => void;

  constructor(iframeUrl: string, telemetry?: TelemetryClient) {
    // Validate origin before accepting the URL
    validateIframeOrigin(iframeUrl);

    this.iframeUrl = iframeUrl;
    this.iframeOrigin = new URL(iframeUrl).origin;
    /* Used to correlate postMessage traffic with the correct iframe instance.
       Important in dev (React Strict Mode) where iframes can be created twice. */
    this.frameId = createRequestId('frame');
    this.telemetry = telemetry;
    this.record(TELEMETRY_EVENTS.BRIDGE_CONSTRUCTED, {
      severity: 'debug',
    });
  }

  private record(
    event: string,
    fields: Parameters<TelemetryClient['record']>[1] = {},
  ): void {
    this.telemetry?.record(event, {
      source: 'bridge',
      frameId: this.frameId,
      ...fields,
    });
  }

  private getIframeSrc(): string {
    const url = new URL(this.iframeUrl);
    url.searchParams.set('tn_frame_id', this.frameId);
    const parentOrigin = getCurrentWindowOrigin();
    if (parentOrigin) {
      url.searchParams.set(PARENT_ORIGIN_SEARCH_PARAM, parentOrigin);
    }
    return url.toString();
  }

  /**
   * Create and inject iframe into DOM
   * Returns a promise that resolves when iframe is ready
   */
  async createIframe(): Promise<void> {
    if (this.readyPromise) {
      this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_CREATE_REUSED, { severity: 'debug' });
      return this.readyPromise;
    }

    const startedAt = Date.now();
    this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_CREATE_STARTED, { operation: 'initialize' });
    this.readyPromise = (async () => {
      if (!this.iframe) {
        this.iframe = document.createElement('iframe');
        this.iframe.src = this.getIframeSrc();
        this.iframe.addEventListener('load', () => {
          this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_LOADED, {
            operation: 'initialize',
            durationMs: Date.now() - startedAt,
          });
        });
        this.iframe.addEventListener('error', () => {
          this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_LOAD_FAILED, {
            operation: 'initialize',
            outcome: 'error',
            severity: 'error',
            durationMs: Date.now() - startedAt,
          });
        });
        /* Delegate WebAuthn for passkey auth and Payment Request for the
           wallet-owned Coinbase Apple Pay iframe. */
        this.iframe.allow = WALLET_IFRAME_ALLOW;
        this.applyIframeStyles();
        /* Keep hidden (but still load) until the wallet asks to show UI. */
        this.setVisibility(false);

        if (this.displayMode === 'inline' && this.inlineContainer) {
          this.inlineContainer.appendChild(this.iframe);
        } else {
          document.body.appendChild(this.iframe);
        }

        // Set up message listener
        this.messageListener = this.handleMessage.bind(this);
        window.addEventListener('message', this.messageListener);
      }

      await this.waitForReady();
      this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_READY, {
        operation: 'initialize',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });
    })().catch((error) => {
      this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_CREATE_FAILED, {
        operation: 'initialize',
        outcome: 'error',
        severity: 'error',
        durationMs: Date.now() - startedAt,
        message: error,
      });
      this.readyPromise = null;
      throw error;
    });

    return this.readyPromise;
  }

  /**
   * Wait for iframe to send 'ready' signal
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let readyHandler: (event: MessageEvent) => void;
      const cleanup = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        window.removeEventListener('message', readyHandler);
        clearTimeout(timeout);
      };

      const timeout = setTimeout(() => {
        cleanup();
        this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_READY_TIMEOUT, {
          operation: 'initialize',
          outcome: 'timeout',
          severity: 'error',
          errorCode: 'IFRAME_READY_TIMEOUT',
          durationMs: 10_000,
        });
        reject(new Error('Iframe ready timeout - wallet failed to load'));
      }, 10000);

      readyHandler = (event: MessageEvent) => {
        if (!this.isMessageFromIframe(event)) {
          return;
        }

        if (event.data?.type === IFRAME_READY_EVENT) {
          cleanup();
          resolve();
        }
      };

      window.addEventListener('message', readyHandler);
    });
  }

  /**
   * Record the load-time correlation values, which the iframe URL already
   * carries, so a later update never clears them by omission.
   */
  primeTelemetryContext(
    appContextId: string | null,
    context: TelemetryAppContext | null,
  ): void {
    this.telemetryAppContextId = appContextId ?? undefined;
    this.telemetryContext = context ?? undefined;
  }

  /** Set or clear the correlation label carried by wallet telemetry. */
  setTelemetryAppContextId(value: string | null): void {
    this.telemetryAppContextId = value ?? undefined;
    this.telemetryContextUpdated = true;
    this.sendTelemetryContext();
  }

  /** Set or clear the host-app dimensions carried by wallet telemetry. */
  setTelemetryContext(value: TelemetryAppContext | null): void {
    this.telemetryContext = value ?? undefined;
    this.telemetryContextUpdated = true;
    this.sendTelemetryContext();
  }

  /**
   * Push the current correlation values to an already-loaded wallet so its own
   * telemetry carries them too. Best effort, and only once the host app has
   * changed them: the iframe URL already carries the load-time values.
   */
  sendTelemetryContext(): void {
    if (!this.telemetryContextUpdated) return;
    const target = this.iframe?.contentWindow;
    const parentOrigin = getCurrentWindowOrigin();
    if (!target || !parentOrigin) return;
    const message: TelemetryContextMessage = {
      type: TELEMETRY_CONTEXT_MESSAGE_TYPE,
      origin: parentOrigin,
      frameId: this.frameId,
      ...(this.telemetryAppContextId
        ? { appContextId: this.telemetryAppContextId }
        : {}),
      ...(this.telemetryContext ? { appContext: this.telemetryContext } : {}),
    };
    try {
      target.postMessage(message, this.iframeOrigin);
    } catch {
      /* Telemetry correlation is best effort and never blocks wallet use. */
    }
  }

  /**
   * Mount iframe inline inside the provided container.
   */
  async mountInline(container: HTMLElement): Promise<void> {
    this.inlineContainer = container;
    this.displayMode = 'inline';
    await this.createIframe();
    this.showInline();
  }

  /**
   * Show iframe inline (embedded in container).
   */
  showInline(): void {
    if (!this.iframe) {
      this.record(TELEMETRY_EVENTS.BRIDGE_VISIBILITY_IGNORED, {
        severity: 'warn',
        operation: 'show_inline',
        outcome: 'iframe_missing',
      });
      return;
    }
    this.displayMode = 'inline';
    if (this.inlineContainer && this.iframe.parentElement !== this.inlineContainer) {
      this.inlineContainer.appendChild(this.iframe);
    }
    this.applyIframeStyles();
    this.setVisibility(true);
  }

  /**
   * Show iframe as a full-screen modal.
   */
  showModal(): void {
    if (!this.iframe) {
      this.record(TELEMETRY_EVENTS.BRIDGE_VISIBILITY_IGNORED, {
        severity: 'warn',
        operation: 'show_modal',
        outcome: 'iframe_missing',
      });
      return;
    }
    this.displayMode = 'modal';
    if (this.iframe.parentElement !== document.body) {
      document.body.appendChild(this.iframe);
    }
    this.applyIframeStyles();
    this.setVisibility(true);
  }

  /**
   * Show iframe modal
   */
  show(): void {
    this.showModal();
  }

  /**
   * Hide iframe modal
   */
  hide(): void {
    this.setVisibility(false);
  }

  isInline(): boolean {
    return this.displayMode === 'inline';
  }

  private applyIframeStyles(): void {
    if (!this.iframe) {
      return;
    }

    if (this.displayMode === 'inline') {
      this.iframe.style.cssText = `
        position: relative;
        width: 100%;
        height: 100%;
        border: none;
        z-index: 1;
        display: block;
        background: ${WALLET_IFRAME_BACKGROUND};
      `;
      return;
    }

    this.iframe.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      z-index: 999999;
      display: block;
      background: ${WALLET_IFRAME_BACKGROUND};
    `;
  }

  private setVisibility(visible: boolean): void {
    if (!this.iframe) {
      return;
    }
    const changed = this.visible !== visible;
    this.visible = visible;
    this.iframe.style.opacity = visible ? '1' : '0';
    this.iframe.style.pointerEvents = visible ? 'auto' : 'none';
    this.iframe.style.visibility = visible ? 'visible' : 'hidden';
    if (changed) {
      this.record(visible ? 'bridge.iframe.shown' : 'bridge.iframe.hidden', {
        severity: 'debug',
        operation: this.displayMode,
      });
    }
  }

  /**
   * Send message to iframe and wait for response
   */
  async sendMessage<TRequest extends PostMessageRequest>(
    request: TRequest
  ): Promise<InferSuccessfulPostMessageResponse<TRequest>> {
    const startedAt = Date.now();
    const safeRequestFields = getSafeRequestTelemetryFields(request);
    this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_QUEUED, {
      requestId: request.id,
      operation: request.type,
      ...safeRequestFields,
    });
    /* Ensure the iframe has navigated to the wallet origin before we try to
       postMessage to a strict targetOrigin. Otherwise the iframe can still be
       about:blank (same-origin with the dapp) and postMessage will throw. */
    try {
      if (this.readyPromise) {
        await this.readyPromise;
      } else {
        await this.createIframe();
      }
    } catch (error) {
      this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
        requestId: request.id,
        operation: request.type,
        outcome: 'iframe_not_ready',
        severity: 'error',
        durationMs: Date.now() - startedAt,
        message: error,
      });
      throw error;
    }

    if (!this.iframe?.contentWindow) {
      this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
        requestId: request.id,
        operation: request.type,
        outcome: 'iframe_missing',
        severity: 'error',
        durationMs: Date.now() - startedAt,
      });
      throw new Error('Iframe not initialized - call createIframe() first');
    }

    return new Promise<InferSuccessfulPostMessageResponse<TRequest>>((resolve, reject) => {
      /* CONNECT, signing, and account-management requests require a human click and can take minutes.
         Keep a longer timeout to avoid breaking "inline connect button" flows. */
      const timeoutMs = SLOW_REQUEST_TYPES.has(request.type)
        ? SLOW_REQUEST_TIMEOUT_MS
        : FAST_REQUEST_TIMEOUT_MS;

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(request.id);
        this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_TIMEOUT, {
          requestId: request.id,
          operation: request.type,
          outcome: 'timeout',
          severity: 'error',
          errorCode: 'TIMEOUT',
          durationMs: Date.now() - startedAt,
        });
        reject(new Error('Request timeout - wallet did not respond'));
      }, timeoutMs);

      // Store handler for this request
      this.messageHandlers.set(request.id, (response: PostMessageResponse) => {
        clearTimeout(timeout);
        this.messageHandlers.delete(request.id);

        if (response.success) {
          this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_COMPLETED, {
            requestId: request.id,
            operation: request.type,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
            ...safeRequestFields,
            ...getSafeResponseTelemetryFields(request.type, response.result),
          });
          resolve(response as InferSuccessfulPostMessageResponse<TRequest>);
        } else {
          const error = new Error(response.error?.message || 'Unknown error');
          (error as any).code = response.error?.code;
          (error as any).data = response.error?.data;
          this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
            requestId: request.id,
            operation: request.type,
            outcome: 'wallet_error',
            severity: 'error',
            errorCode: response.error?.code,
            durationMs: Date.now() - startedAt,
            message: error,
            ...safeRequestFields,
          });
          reject(error);
        }
      });

      // Send message to iframe
      try {
        this.iframe!.contentWindow!.postMessage(request, this.iframeOrigin);
        this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_STARTED, {
          requestId: request.id,
          operation: request.type,
          ...safeRequestFields,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.messageHandlers.delete(request.id);
        this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_FAILED, {
          requestId: request.id,
          operation: request.type,
          outcome: 'post_message_error',
          severity: 'error',
          durationMs: Date.now() - startedAt,
          message: error,
        });
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages from iframe
   */
  private handleMessage(event: MessageEvent): void {
    const rejection = this.messageRejectionReason(event);
    if (rejection) {
      /* Do not log unrelated cross-origin page traffic. Same-origin wallet
         traffic with invalid correlation is useful and safe to diagnose. */
      const cameFromManagedIframe =
        !!event.source &&
        !!this.iframe?.contentWindow &&
        event.source === this.iframe.contentWindow;
      if (rejection !== 'origin_mismatch' || cameFromManagedIframe) {
        this.record(TELEMETRY_EVENTS.BRIDGE_MESSAGE_IGNORED, {
          severity: 'warn',
          outcome: rejection,
        });
      }
      return; // Ignore messages from other origins
    }

    const data = event.data;

    // Handle response to a specific request (has id)
    if (data.id && this.messageHandlers.has(data.id)) {
      const handler = this.messageHandlers.get(data.id);
      if (handler) {
        handler(data as PostMessageResponse);
      }
      return;
    }

    if (data?.id) {
      this.record(TELEMETRY_EVENTS.BRIDGE_RESPONSE_IGNORED, {
        severity: 'warn',
        outcome: 'unknown_request',
      });
      return;
    }

    if (data?.type === IFRAME_READY_EVENT) {
      this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_READY_RECEIVED, { severity: 'debug' });
      this.sendTelemetryContext();
      return;
    }

    // Handle event broadcasts (type === 'event')
    if (data.type === POST_MESSAGE_EVENT_TYPE) {
      this.handleEvent(data as PostMessageEvent);
      return;
    }

    this.record(TELEMETRY_EVENTS.BRIDGE_MESSAGE_MALFORMED, {
      severity: 'warn',
      outcome: 'unknown_shape',
    });
  }

  /**
   * Handle event broadcasts from iframe
   */
  private handleEvent(data: PostMessageEvent): void {
    this.record(TELEMETRY_EVENTS.BRIDGE_EVENT_RECEIVED, {
      operation: data.event,
    });
    // Forward to EmbeddedProvider via callback
    if (this.onEvent) {
      this.onEvent(data.event, data.data);
    }
  }

  private isMessageFromIframe(event: MessageEvent): boolean {
    return this.messageRejectionReason(event) === null;
  }

  private messageRejectionReason(event: MessageEvent): string | null {
    if (event.origin !== this.iframeOrigin) return 'origin_mismatch';

    const data = event.data as any;
    if (!data || typeof data !== 'object') return 'malformed';
    if (data.frameId !== this.frameId) return 'frame_mismatch';

    /* Some browsers (notably Safari) can provide a null `event.source` for
       cross-origin postMessage events. Frame id + origin is sufficient. */
    if (!event.source) return null;
    if (this.iframe?.contentWindow && event.source !== this.iframe.contentWindow) {
      return 'source_mismatch';
    }
    return null;
  }

  /**
   * Destroy iframe and cleanup
   */
  destroy(): void {
    this.record(TELEMETRY_EVENTS.BRIDGE_DESTROYED, {
      severity: 'debug',
      outcome: this.messageHandlers.size > 0 ? 'pending_requests_dropped' : 'success',
    });
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }

    this.readyPromise = null;

    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }

    this.messageHandlers.clear();
  }
}


