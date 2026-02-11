import type {
  InferSuccessfulPostMessageResponse,
  PostMessageEvent,
  PostMessageRequest,
  PostMessageResponse,
} from './types/messages';
import {
  IFRAME_READY_EVENT,
  POST_MESSAGE_EVENT_TYPE,
  POST_MESSAGE_REQUEST_TYPES,
  createRequestId,
} from './types/messages';

/**
 * Allowed origins for wallet iframe URLs
 * Only iframes from these origins can be loaded for security
 */
const ALLOWED_IFRAME_ORIGINS = [
  'https://thru-wallet.up.railway.app',
  'https://wallet.thru.io',
  'https://wallet.thru.org',
  // Allow localhost for development (any port)
  'http://localhost',
];

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

  // Check if origin matches any allowed origin
  // For localhost, we allow any port (e.g., http://localhost:3000)
  const isAllowed = ALLOWED_IFRAME_ORIGINS.some((allowedOrigin) => {
    if (allowedOrigin === 'http://localhost') {
      // Match exactly http://localhost or http://localhost:port
      return origin === 'http://localhost' || origin.match(/^http:\/\/localhost:\d+$/);
    }
    return origin === allowedOrigin;
  });

  if (!isAllowed) {
    throw new Error(
      `Untrusted iframe origin: ${origin}. ` +
        `Only trusted wallet origins are allowed: ${ALLOWED_IFRAME_ORIGINS.join(', ')}. ` +
        `This security check prevents malicious websites from loading unauthorized wallet iframes.`
    );
  }
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

  /**
   * Callback for event broadcasts from iframe (no request id)
   */
  public onEvent?: (eventType: string, payload: any) => void;

  constructor(iframeUrl: string) {
    // Validate origin before accepting the URL
    validateIframeOrigin(iframeUrl);

    this.iframeUrl = iframeUrl;
    this.iframeOrigin = new URL(iframeUrl).origin;
    /* Used to correlate postMessage traffic with the correct iframe instance.
       Important in dev (React Strict Mode) where iframes can be created twice. */
    this.frameId = createRequestId('frame');
  }

  private getIframeSrc(): string {
    const url = new URL(this.iframeUrl);
    url.searchParams.set('tn_frame_id', this.frameId);
    return url.toString();
  }

  /**
   * Create and inject iframe into DOM
   * Returns a promise that resolves when iframe is ready
   */
  async createIframe(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = (async () => {
      if (!this.iframe) {
        this.iframe = document.createElement('iframe');
        this.iframe.src = this.getIframeSrc();
        /* Allow WebAuthn in cross-origin iframe for passkey auth. */
        this.iframe.allow = 'publickey-credentials-get; publickey-credentials-create';
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
    })().catch((error) => {
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
        background: transparent;
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
      background: rgba(0, 0, 0, 0.5);
    `;
  }

  private setVisibility(visible: boolean): void {
    if (!this.iframe) {
      return;
    }
    this.visible = visible;
    this.iframe.style.opacity = visible ? '1' : '0';
    this.iframe.style.pointerEvents = visible ? 'auto' : 'none';
    this.iframe.style.visibility = visible ? 'visible' : 'hidden';
  }

  /**
   * Send message to iframe and wait for response
   */
  async sendMessage<TRequest extends PostMessageRequest>(
    request: TRequest
  ): Promise<InferSuccessfulPostMessageResponse<TRequest>> {
    /* Ensure the iframe has navigated to the wallet origin before we try to
       postMessage to a strict targetOrigin. Otherwise the iframe can still be
       about:blank (same-origin with the dapp) and postMessage will throw. */
    if (this.readyPromise) {
      await this.readyPromise;
    } else {
      await this.createIframe();
    }

    if (!this.iframe?.contentWindow) {
      throw new Error('Iframe not initialized - call createIframe() first');
    }

    return new Promise<InferSuccessfulPostMessageResponse<TRequest>>((resolve, reject) => {
      /* CONNECT/SIGN_* requests require a human click and can take minutes.
         Keep a longer timeout to avoid breaking "inline connect button" flows. */
      const timeoutMs =
        request.type === POST_MESSAGE_REQUEST_TYPES.CONNECT ||
        request.type === POST_MESSAGE_REQUEST_TYPES.SIGN_MESSAGE ||
        request.type === POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION
          ? 5 * 60 * 1000 /* 5 minutes */
          : 30 * 1000; /* 30 seconds */

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(request.id);
        reject(new Error('Request timeout - wallet did not respond'));
      }, timeoutMs);

      // Store handler for this request
      this.messageHandlers.set(request.id, (response: PostMessageResponse) => {
        clearTimeout(timeout);
        this.messageHandlers.delete(request.id);

        if (response.success) {
          resolve(response as InferSuccessfulPostMessageResponse<TRequest>);
        } else {
          const error = new Error(response.error?.message || 'Unknown error');
          (error as any).code = response.error?.code;
          reject(error);
        }
      });

      // Send message to iframe
      this.iframe!.contentWindow!.postMessage(request, this.iframeOrigin);
    });
  }

  /**
   * Handle incoming messages from iframe
   */
  private handleMessage(event: MessageEvent): void {
    if (!this.isMessageFromIframe(event)) {
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

    // Handle event broadcasts (type === 'event')
    if (data.type === POST_MESSAGE_EVENT_TYPE) {
      this.handleEvent(data as PostMessageEvent);
    }
  }

  /**
   * Handle event broadcasts from iframe
   */
  private handleEvent(data: PostMessageEvent): void {
    // Forward to EmbeddedProvider via callback
    if (this.onEvent) {
      this.onEvent(data.event, data.data);
    }
  }

  private isMessageFromIframe(event: MessageEvent): boolean {
    if (event.origin !== this.iframeOrigin) {
      return false;
    }

    const data = event.data as any;
    if (!data || data.frameId !== this.frameId) {
      return false;
    }

    /* Some browsers (notably Safari) can provide a null `event.source` for
       cross-origin postMessage events. Frame id + origin is sufficient. */
    if (!event.source) {
      return true;
    }

    if (this.iframe?.contentWindow && event.source !== this.iframe.contentWindow) {
      return false;
    }

    return true;
  }

  /**
   * Destroy iframe and cleanup
   */
  destroy(): void {
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
