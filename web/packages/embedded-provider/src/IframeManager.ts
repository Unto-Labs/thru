import type {
  InferSuccessfulPostMessageResponse,
  PostMessageEvent,
  PostMessageRequest,
  PostMessageResponse,
} from './types/messages';
import { IFRAME_READY_EVENT, POST_MESSAGE_EVENT_TYPE } from './types/messages';

/**
 * Manages iframe lifecycle and postMessage communication
 * Handles creating, showing/hiding iframe, and message passing
 */
export class IframeManager {
  private iframe: HTMLIFrameElement | null = null;
  private iframeUrl: string;
  private iframeOrigin: string;
  private messageHandlers = new Map<string, (response: PostMessageResponse) => void>();
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private readyPromise: Promise<void> | null = null;

  /**
   * Callback for event broadcasts from iframe (no request id)
   */
  public onEvent?: (eventType: string, payload: any) => void;

  constructor(iframeUrl: string) {
    this.iframeUrl = iframeUrl;
    this.iframeOrigin = new URL(iframeUrl).origin;
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
        this.iframe.src = this.iframeUrl;
        this.iframe.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          border: none;
          z-index: 999999;
          display: none;
          background: rgba(0, 0, 0, 0.5);
        `;

        document.body.appendChild(this.iframe);

        // Set up message listener
        this.messageListener = this.handleMessage.bind(this);
        window.addEventListener('message', this.messageListener);
      }

      // Wait for iframe ready signal
      await this.waitForReady();
    })();

    return this.readyPromise;
  }

  /**
   * Wait for iframe to send 'ready' signal
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Iframe ready timeout - wallet failed to load'));
      }, 10000); // 10 second timeout

      const readyHandler = (event: MessageEvent) => {
        if (event.origin !== this.iframeOrigin) {
          return;
        }

        if (event.data.type === IFRAME_READY_EVENT) {
          clearTimeout(timeout);
          window.removeEventListener('message', readyHandler);
          resolve();
        }
      };

      window.addEventListener('message', readyHandler);
    });
  }

  /**
   * Show iframe modal
   */
  show(): void {
    if (this.iframe) {
      this.iframe.style.display = 'block';
    }
  }

  /**
   * Hide iframe modal
   */
  hide(): void {
    if (this.iframe) {
      this.iframe.style.display = 'none';
    }
  }

  /**
   * Send message to iframe and wait for response
   */
  async sendMessage<TRequest extends PostMessageRequest>(
    request: TRequest
  ): Promise<InferSuccessfulPostMessageResponse<TRequest>> {
    if (!this.iframe?.contentWindow) {
      throw new Error('Iframe not initialized - call createIframe() first');
    }

    return new Promise<InferSuccessfulPostMessageResponse<TRequest>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(request.id);
        reject(new Error('Request timeout - wallet did not respond'));
      }, 30000); // 30 second timeout

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
    // Validate origin
    const iframeOrigin = new URL(this.iframeUrl).origin;
    if (event.origin !== iframeOrigin) {
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
