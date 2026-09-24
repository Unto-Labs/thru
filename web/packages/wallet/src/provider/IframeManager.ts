import { BridgeNetworkState } from '../bridge-network-state';
import { TELEMETRY_EVENTS, type TelemetryAppContext } from '../observability';
import type {
  InferSuccessfulPostMessageResponse,
  PostMessageEvent,
  PostMessageRequest,
  PostMessageResponse,
  TelemetryContextMessage,
} from './types/messages';
import type {
  IframeReadyData,
  UiHideEventPayload,
  WalletDeveloperModeMessage,
  WalletTheme,
  WalletThemeMessage,
} from '../protocol';
import {
  WALLET_DEVELOPER_MODE_MESSAGE_TYPE,
  WALLET_DEVELOPER_MODE_SEARCH_PARAM,
  WALLET_THEME_MESSAGE_TYPE,
} from '../protocol';
import {
  getSafeRequestTelemetryFields,
  getSafeResponseTelemetryFields,
} from '../internal/telemetry-fields';
import type { TelemetryClient } from '../telemetry';
import {
  EMBEDDED_PROVIDER_EVENTS,
  ErrorCode,
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
/* A managed hide waits for the wallet's exit animation, capped so a bad
   value never parks the frame over the page. */
const MANAGED_HIDE_MAX_EXIT_MS = 1000;
/* If the wallet never announces `ui_hide` after a response, hide anyway. */
const MANAGED_HIDE_FALLBACK_MS = 4000;
const PARENT_ORIGIN_SEARCH_PARAM = 'tn_parent_origin';
const THEME_SEARCH_PARAM = 'tn_theme';
export function walletIframeAllow(walletUrl: string): string {
  const origin = new URL(walletUrl).origin;
  return `publickey-credentials-get ${origin}; publickey-credentials-create ${origin}; payment *; clipboard-write ${origin}`;
}

/** @deprecated Use walletIframeAllow with the configured wallet URL. */
export const WALLET_IFRAME_ALLOW = walletIframeAllow('https://app.tid.sh');
const WALLET_IFRAME_BACKGROUND = 'transparent';

/* Anything the wallet answers by asking the user. Thirty seconds is a timeout
   for a machine, not for someone reading a consent sheet. */
const SLOW_REQUEST_TYPES: ReadonlySet<string> = new Set([
  POST_MESSAGE_REQUEST_TYPES.CONNECT,
  /* Disconnect raises a consent sheet in the wallet's web presentation, so it
     waits on a tap exactly like the rest of these. */
  POST_MESSAGE_REQUEST_TYPES.DISCONNECT,
  POST_MESSAGE_REQUEST_TYPES.SIGN_MESSAGE,
  POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
  POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE,
  POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS,
  POST_MESSAGE_REQUEST_TYPES.ACCOUNT_MENU,
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
  if (process.env.NODE_ENV === 'production') return false;

  /* Browser SDK construction can run during a development SSR pass before a
     window exists. The client constructs and validates its own instance, so
     permit only an explicitly development-shaped wallet hostname here. */
  if (typeof window === 'undefined') {
    return isDevelopmentHostname(url.hostname.toLowerCase());
  }

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
      `Invalid iframe URL: ${iframeUrl}. URL must be a valid absolute URL.`,
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
        `This security check prevents malicious websites from loading unauthorized wallet iframes.`,
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

const HTTPS_DEVELOPMENT_DOCS_URL =
  'https://thru.org/docs/wallet/embedded-wallet-integration/#serve-your-app-over-https-in-development';
let warnedHttpHost = false;

function isLocalhostHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    hostname.startsWith('127.')
  );
}

/* Browsers refuse passkeys inside the wallet frame when this page is plain
   HTTP, even http://localhost (Chrome reports "TLS certificate errors"). On a
   localhost page the wallet continues them in a new window, and a localhost
   wallet frame is exempt. Any other HTTP page is not a secure context, which
   leaves the frame without passkeys at all. */
function warnIfHttpHost(walletOrigin: string): void {
  if (warnedHttpHost || typeof window === 'undefined') return;
  if (window.location.protocol !== 'http:') return;
  const insecurePage = window.isSecureContext === false;
  if (!insecurePage && isLocalhostHostname(new URL(walletOrigin).hostname))
    return;
  warnedHttpHost = true;
  console.warn(
    `[WalletSDK] ${window.location.origin} is served over HTTP. ` +
      (insecurePage
        ? `Passkeys are unavailable in the embedded wallet on this page. ` +
          `Serve your app over HTTPS, or use http://localhost during development: `
        : `Browsers block passkeys inside the embedded wallet on HTTP pages, so passkey ` +
          `prompts continue in a new window. Serve your app over HTTPS in development: `) +
      HTTPS_DEVELOPMENT_DOCS_URL,
  );
}

/**
 * Manages iframe lifecycle and postMessage communication
 * Handles creating, showing/hiding iframe, and message passing
 */
export class IframeManager {
  private readonly networkState = new BridgeNetworkState(
    () => this.rejectPendingRequests(
      'Wallet network changed; reconnect.', ErrorCode.NETWORK_CHANGED,
    ),
    (network) => this.onEvent?.('network_changed', network),
  );
  waitForNetwork(scope: string, name?: string): Promise<void> {
    return this.networkState.waitForNetwork(scope, name);
  }
  supportsNetworkSwitching() {
    return this.networkState.supported;
  }
  getNetwork() {
    return this.networkState.network;
  }
  getNetworkGeneration() {
    return this.networkState.generation;
  }

  private iframe: HTMLIFrameElement | null = null;
  private iframeUrl: string;
  private iframeOrigin: string;
  private frameId: string;
  private messageHandlers = new Map<
    string,
    (response: PostMessageResponse) => void
  >();
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private displayMode: 'modal' | 'inline' = 'modal';
  private inlineContainer: HTMLElement | null = null;
  private visible = false;
  /* Declared by the wallet in its ready handshake: it announces `ui_hide`
     when its UI closes, so a host hide after a response can wait for the
     exit animation instead of cutting it off. */
  private managedHide = false;
  /* The wallet has shown UI (`ui_show`) since the frame was last hidden. */
  private uiClaimed = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private hideFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /* Callers waiting for a deferred hide to finish (`hide()` resolves). */
  private hiddenWaiters: Array<() => void> = [];
  private telemetry?: TelemetryClient;
  /* The host page's resolved color scheme: carried on the URL so the wallet
     document draws to match from its first paint, pushed by message when it
     changes, and mirrored on the <iframe> so Chrome keeps the frame
     transparent (a scheme mismatch paints it opaque). */
  private theme: WalletTheme = 'light';
  /* The theme changed after the frame URL was built, so a wallet document
     that reloads in place must be told again. */
  private themeUpdated = false;
  /* The host's developer mode: on the URL for the first load, by message
     when it changes (see setDeveloperMode). */
  private developerMode = false;
  private developerModeUpdated = false;
  private telemetryAppContextId?: string;
  private telemetryContext?: TelemetryAppContext;
  private telemetryContextUpdated = false;

  /**
   * Callback for event broadcasts from iframe (no request id)
   */
  public onEvent?: (eventType: string, payload: any) => void;

  constructor(
    iframeUrl: string,
    telemetry?: TelemetryClient,
    options: { theme?: WalletTheme; developerMode?: boolean } = {},
  ) {
    // Validate origin before accepting the URL
    validateIframeOrigin(iframeUrl);

    this.iframeUrl = iframeUrl;
    this.theme = options.theme ?? 'light';
    this.developerMode = options.developerMode === true;
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

  getWalletOrigin(): string {
    return this.iframeOrigin;
  }

  getIframeSrc(): string {
    const url = new URL(this.iframeUrl);
    url.searchParams.set('tn_frame_id', this.frameId);
    const parentOrigin = getCurrentWindowOrigin();
    if (parentOrigin) {
      url.searchParams.set(PARENT_ORIGIN_SEARCH_PARAM, parentOrigin);
    }
    url.searchParams.set(THEME_SEARCH_PARAM, this.theme);
    if (this.developerMode) url.searchParams.set(WALLET_DEVELOPER_MODE_SEARCH_PARAM, '1');
    else url.searchParams.delete(WALLET_DEVELOPER_MODE_SEARCH_PARAM);
    return url.toString();
  }

  /**
   * Turn the host's developer mode on or off without reloading the wallet:
   * the wallet document hears it by message, and any later (re)load carries
   * it on the URL.
   */
  setDeveloperMode(enabled: boolean): void {
    if (enabled === this.developerMode) return;
    this.developerMode = enabled;
    this.developerModeUpdated = true;
    this.sendDeveloperMode();
  }

  /* Best effort, like sendTheme: the ready handshake sends it again. */
  private sendDeveloperMode(): void {
    const target = this.iframe?.contentWindow;
    const parentOrigin = getCurrentWindowOrigin();
    if (!target || !parentOrigin) return;
    const message: WalletDeveloperModeMessage = {
      type: WALLET_DEVELOPER_MODE_MESSAGE_TYPE,
      origin: parentOrigin,
      frameId: this.frameId,
      enabled: this.developerMode,
    };
    try {
      target.postMessage(message, this.iframeOrigin);
    } catch {
      /* The frame has not reached the wallet origin yet; ready resends. */
    }
  }

  getTheme(): WalletTheme {
    return this.theme;
  }

  /**
   * Restyle the wallet for a new host color scheme without reloading it: the
   * frame element follows at once, the wallet document hears it by message,
   * and any later (re)load carries it on the URL.
   */
  setTheme(theme: WalletTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.themeUpdated = true;
    if (this.iframe) {
      this.applyIframeStyles();
      /* applyIframeStyles replaces cssText, which drops the visibility styles. */
      this.setVisibility(this.visible);
    }
    this.sendTheme();
  }

  /* Best effort: a wallet that is not ready yet has no listener, and its ready
     handshake sends the theme again. */
  private sendTheme(): void {
    const target = this.iframe?.contentWindow;
    const parentOrigin = getCurrentWindowOrigin();
    if (!target || !parentOrigin) return;
    const message: WalletThemeMessage = {
      type: WALLET_THEME_MESSAGE_TYPE,
      origin: parentOrigin,
      frameId: this.frameId,
      theme: this.theme,
    };
    try {
      target.postMessage(message, this.iframeOrigin);
    } catch {
      /* The frame has not reached the wallet origin yet; ready resends. */
    }
  }

  /** Wallet origin (e.g. https://app.tid.sh) this manager is bound to. */
  get walletOrigin(): string {
    return this.iframeOrigin;
  }

  /**
   * Fail every in-flight request. Used when the host tears the wallet
   * surface down before the wallet answered (e.g. a dismissed sheet).
   */
  rejectPendingRequests(
    message = 'User rejected the request',
    code: ErrorCode = ErrorCode.USER_REJECTED,
  ): void {
    for (const [id, handler] of Array.from(this.messageHandlers.entries())) {
      handler({
        id,
        success: false,
        error: {
          code,
          message,
        },
      });
    }
  }

  /**
   * Create and inject iframe into DOM
   * Returns a promise that resolves when iframe is ready
   */
  async createIframe(): Promise<void> {
    if (this.readyPromise) {
      this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_CREATE_REUSED, {
        severity: 'debug',
      });
      return this.readyPromise;
    }

    warnIfHttpHost(this.iframeOrigin);
    const startedAt = Date.now();
    this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_CREATE_STARTED, {
      operation: 'initialize',
    });
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
        /* Delegate WebAuthn for passkey auth, Payment Request for the
           wallet-owned Coinbase Apple Pay iframe, and clipboard writes for
           the wallet's copy buttons (Chromium blocks them otherwise). */
        this.iframe.allow = walletIframeAllow(this.iframe.src);
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

      try {
        await this.waitForReady();
      } catch (error) {
        /* One more try before giving up: a slow first load (cold caches, a
           slow name lookup) can push the wallet's ready past the deadline
           while the second load, warm, is quick. Without this a host that
           auto-restores its session shows "signed out" until the user
           reloads by hand. */
        if (
          !(error instanceof Error) ||
          !/ready timeout/i.test(error.message) ||
          !this.iframe
        ) {
          throw error;
        }
        this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_READY_RETRY, {
          operation: 'initialize',
          outcome: 'retry',
          severity: 'warn',
          durationMs: Date.now() - startedAt,
        });
        this.iframe.src = this.getIframeSrc();
        await this.waitForReady();
      }
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
          this.readCapabilities(event.data);
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
    this.clearHideTimers();
    this.settleHiddenWaiters();
    if (!this.iframe) {
      this.record(TELEMETRY_EVENTS.BRIDGE_VISIBILITY_IGNORED, {
        severity: 'warn',
        operation: 'show_inline',
        outcome: 'iframe_missing',
      });
      return;
    }
    this.displayMode = 'inline';
    if (
      this.inlineContainer &&
      this.iframe.parentElement !== this.inlineContainer
    ) {
      this.inlineContainer.appendChild(this.iframe);
    }
    this.applyIframeStyles();
    this.setVisibility(true);
  }

  /**
   * Show iframe as a full-screen modal.
   */
  showModal(): void {
    this.clearHideTimers();
    this.settleHiddenWaiters();
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
   * Hide the iframe modal. A wallet that manages its own hiding and has UI
   * up keeps the frame until its `ui_hide` (the exit animation), with a
   * fallback so a lost event never leaves the frame over the page. Resolves
   * once the frame is actually hidden, so a caller can hold its own state
   * (a "Signing in…" button) through the wallet's exit animation.
   */
  hide(): Promise<void> {
    if (this.managedHide && this.uiClaimed && this.visible) {
      if (!this.hideFallbackTimer) {
        this.hideFallbackTimer = setTimeout(
          () => this.finishHide(),
          MANAGED_HIDE_FALLBACK_MS,
        );
      }
      return new Promise((resolve) => {
        this.hiddenWaiters.push(resolve);
      });
    }
    this.finishHide();
    return Promise.resolve();
  }

  isInline(): boolean {
    return this.displayMode === 'inline';
  }

  private applyIframeStyles(): void {
    if (!this.iframe) {
      return;
    }

    /* Chrome paints a cross-origin iframe opaque when the <iframe> element's
       used color scheme differs from the embedded document's. The wallet
       document follows the host theme, so the element carries the same
       scheme; otherwise the host sees a solid sheet instead of its own page
       behind the scrim. */
    if (this.displayMode === 'inline') {
      this.iframe.style.cssText = `
        position: relative;
        width: 100%;
        height: 100%;
        border: none;
        z-index: 1;
        display: block;
        background: ${WALLET_IFRAME_BACKGROUND};
        color-scheme: ${this.theme};
      `;
      return;
    }

    /* --thru-wallet-frame-max-width lets a host that presents itself in a
       fixed-width column (a phone-shaped app on a desktop) keep the wallet
       surface in that same column instead of spanning the viewport. Hosts
       that do not set it resolve to `none`, which with the centering below is
       identical to the full-bleed overlay this has always been. */
    this.iframe.style.cssText = `
      position: fixed;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 100%;
      max-width: var(--thru-wallet-frame-max-width, none);
      height: 100%;
      border: none;
      z-index: 999999;
      display: block;
      background: ${WALLET_IFRAME_BACKGROUND};
      color-scheme: ${this.theme};
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
    request: TRequest,
  ): Promise<InferSuccessfulPostMessageResponse<TRequest>> {
    const queuedGeneration = this.networkState.network
      ? this.networkState.generation
      : null;
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

    if (
      queuedGeneration !== null &&
      queuedGeneration !== this.networkState.generation
    )
      throw Object.assign(new Error('Wallet network changed; reconnect.'), {
        code: ErrorCode.NETWORK_CHANGED,
      });

    return new Promise<InferSuccessfulPostMessageResponse<TRequest>>(
      (resolve, reject) => {
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
        this.messageHandlers.set(
          request.id,
          (response: PostMessageResponse) => {
        clearTimeout(timeout);
        this.messageHandlers.delete(request.id);

        if (response.success) {
          this.record(TELEMETRY_EVENTS.BRIDGE_REQUEST_COMPLETED, {
            requestId: request.id,
            operation: request.type,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
            ...safeRequestFields,
                ...getSafeResponseTelemetryFields(
                  request.type,
                  response.result,
                ),
          });
          resolve(response as InferSuccessfulPostMessageResponse<TRequest>);
        } else {
              const error = new Error(
                response.error?.message || 'Unknown error',
              );
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
          },
        );

      // Send message to iframe
      try {
          this.iframe!.contentWindow!.postMessage(
            {
              ...request,
              networkScope: this.networkState.network?.scope,
              networkGeneration:
                request.networkGeneration ?? this.networkState.generation,
            },
            this.iframeOrigin,
          );
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
      },
    );
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
      this.readCapabilities(data);
      this.record(TELEMETRY_EVENTS.BRIDGE_IFRAME_READY_RECEIVED, {
        severity: 'debug',
      });
      this.sendTelemetryContext();
      if (this.themeUpdated) this.sendTheme();
      if (this.developerModeUpdated) this.sendDeveloperMode();
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
    if (data.event === EMBEDDED_PROVIDER_EVENTS.UI_SHOW) {
      this.uiClaimed = true;
    } else if (data.event === EMBEDDED_PROVIDER_EVENTS.UI_HIDE) {
      const exitMs = (data.data as UiHideEventPayload | undefined)?.exitMs;
      this.hideAfterExit(typeof exitMs === 'number' ? exitMs : 0);
    }
    // Forward to EmbeddedProvider via callback
    if (this.onEvent) {
      this.onEvent(data.event, data.data);
    }
  }

  private readCapabilities(data: { data?: unknown }): void {
    const ready = data.data as IframeReadyData | undefined;
    this.networkState.readReady(ready);
    if (ready?.capabilities?.managedHide === true) {
      this.managedHide = true;
    }
  }

  private clearHideTimers(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.hideFallbackTimer) {
      clearTimeout(this.hideFallbackTimer);
      this.hideFallbackTimer = null;
    }
  }

  /**
   * The wallet's UI is closing: give the host its pointer events back at
   * once and hide the frame once the exit animation has played.
   */
  private hideAfterExit(exitMs: number): void {
    if (this.displayMode === 'inline' || !this.visible) {
      return;
    }
    this.clearHideTimers();
    if (this.iframe) {
      this.iframe.style.pointerEvents = 'none';
    }
    const delay = Math.min(Math.max(exitMs, 0), MANAGED_HIDE_MAX_EXIT_MS);
    if (delay === 0) {
      this.finishHide();
      return;
    }
    this.hideTimer = setTimeout(() => this.finishHide(), delay);
  }

  private finishHide(): void {
    this.clearHideTimers();
    this.uiClaimed = false;
    this.setVisibility(false);
    this.settleHiddenWaiters();
  }

  private settleHiddenWaiters(): void {
    const waiters = this.hiddenWaiters;
    this.hiddenWaiters = [];
    waiters.forEach((resolve) => resolve());
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
    if (
      this.iframe?.contentWindow &&
      event.source !== this.iframe.contentWindow
    ) {
      return 'source_mismatch';
    }
    return null;
  }

  /**
   * Destroy iframe and cleanup
   */
  destroy(): void {
    this.clearHideTimers();
    this.settleHiddenWaiters();
    this.record(TELEMETRY_EVENTS.BRIDGE_DESTROYED, {
      severity: 'debug',
      outcome:
        this.messageHandlers.size > 0 ? 'pending_requests_dropped' : 'success',
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
