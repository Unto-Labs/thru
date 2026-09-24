import {
  classifyIframeRestriction,
  getPasskeyRestriction,
  isInIframe,
  isWebAuthnSupported,
  markInlinePasskeyRefused,
  type PasskeyIframeRestrictionError,
  type PasskeyPromptAction,
} from './capabilities';
import { closePopup, openPasskeyPopupWindow } from './popup';
import type { PasskeyReportingOptions } from './reporter';

export interface PasskeyRecoveryRequest {
  action: PasskeyPromptAction;
  route: 'inline' | 'popup';
  restriction: PasskeyIframeRestrictionError | null;
  busy: boolean;
  error: string | null;
  /** Invoke directly from a click handler; opens the popup synchronously. */
  retry(): void;
  cancel(): void;
}

export interface PasskeyRouteEvent {
  action: PasskeyPromptAction;
  route: 'inline' | 'popup';
  phase: 'started' | 'recovery' | 'succeeded' | 'failed';
  reason?: string;
}
type RouteReporter = (event: PasskeyRouteEvent) => void;
let routeReporter: RouteReporter | undefined;

type RecoveryHandler = (request: PasskeyRecoveryRequest | null) => void;
let recoveryHandler: RecoveryHandler | null = null;
let activeCeremony: AbortController | null = null;

/** Install the hosted wallet's recovery UI. Unmounting cancels pending work. */
export function setPasskeyRecoveryHandler(
  handler: RecoveryHandler,
  report?: RouteReporter
): () => void {
  if (recoveryHandler) throw new Error('Passkey recovery UI is already installed');
  recoveryHandler = handler;
  routeReporter = report;
  return () => {
    if (recoveryHandler !== handler) return;
    cancelPasskeyCeremony();
    recoveryHandler = null;
    routeReporter = undefined;
  };
}

export function cancelPasskeyCeremony(): void {
  activeCeremony?.abort();
}

/** One transaction-independent ceremony; recovery never replays wallet writes. */
export async function runPasskeyCeremony<T>(
  action: PasskeyPromptAction,
  inline: (signal: AbortSignal) => Promise<T>,
  popup: (window: Window, signal: AbortSignal) => Promise<T>,
  options: PasskeyReportingOptions = {}
): Promise<T> {
  if (activeCeremony) throw new Error('A passkey request is already in progress');
  /* Before the support check: a frame under a non-localhost HTTP page is not a
     secure context, so WebAuthn is hidden there too and would read as unsupported. */
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error('Passkeys require a secure HTTPS connection.');
  }
  if (!isWebAuthnSupported()) throw new Error('WebAuthn is not supported in this browser');
  if (options.promptMode === 'popup' && options.allowPopupFallback === false) {
    throw new Error('Passkey popups are disabled');
  }
  let route: 'inline' | 'popup' = options.promptMode === 'popup' ? 'popup' : 'inline';
  const report = (phase: PasskeyRouteEvent['phase'], reason?: string) => {
    try {
      routeReporter?.({ action, route, phase, reason });
    } catch {
      /* Observation cannot alter authentication. */
    }
  };
  const controller = new AbortController();
  activeCeremony = controller;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', abort);
  const signal = controller.signal;
  const allowPopup = options.allowPopupFallback !== false && options.promptMode !== 'inline';
  try {
    signal.throwIfAborted();
    report('started');
    if (options.promptMode === 'popup') {
      const opened = openPasskeyPopupWindow();
      try {
        const result = await popup(opened, signal);
        signal.throwIfAborted();
        report('succeeded');
        return result;
      } finally {
        closePopup(opened);
      }
    }
    const restriction = allowPopup ? getPasskeyRestriction(action) : null;
    if (restriction) return await recover('popup', restriction);
    // Async account/challenge preparation may have consumed the original tap.
    // A fresh click in the frame calls create immediately, without redoing that work.
    if (
      action === 'create' &&
      isInIframe() &&
      typeof navigator !== 'undefined' &&
      navigator.userActivation?.isActive === false &&
      recoveryHandler
    ) {
      return await recover('inline', null);
    }
    try {
      const result = await inline(signal);
      signal.throwIfAborted();
      report('succeeded');
      return result;
    } catch (error) {
      const refused = allowPopup ? classifyIframeRestriction(error, action) : null;
      if (!refused) throw error;
      markInlinePasskeyRefused(action, refused.reason);
      return await recover('popup', refused);
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const reason =
      name === 'AbortError'
        ? 'aborted'
        : name === 'NotAllowedError'
          ? 'not-allowed'
          : name === 'SecurityError'
            ? 'security-error'
            : 'ceremony-failed';
    report('failed', reason);
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', abort);
    recoveryHandler?.(null);
    if (activeCeremony === controller) activeCeremony = null;
  }

  function recover(
    recoveryRoute: 'inline' | 'popup',
    restriction: PasskeyIframeRestrictionError | null
  ): Promise<T> {
    route = recoveryRoute;
    report('recovery', restriction?.reason ?? 'user-activation');
    const handler = recoveryHandler;
    if (!handler) return Promise.reject(restriction ?? new Error('Please retry from the wallet.'));
    return new Promise<T>((resolve, reject) => {
      let busy = false;
      let settled = false;
      let opened: Window | null = null;
      let failure: string | null = null;
      const finish = (result: { value: T } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        closePopup(opened);
        handler(null);
        if ('value' in result) {
          report('succeeded');
          resolve(result.value);
        } else reject(result.error);
      };
      const onAbort = () =>
        finish({ error: new DOMException('Passkey request cancelled', 'AbortError') });
      const show = () =>
        handler({ action, route, restriction, busy, error: failure, retry, cancel: abort });
      function retry() {
        if (busy || settled || signal.aborted) return;
        busy = true;
        failure = null;
        show();
        report('started', restriction?.reason ?? 'user-activation');
        // No await before either window.open or navigator.credentials.*.
        let attempt: Promise<T>;
        try {
          if (route === 'popup') {
            opened = openPasskeyPopupWindow();
            attempt = popup(opened, signal);
          } else attempt = inline(signal);
        } catch (error) {
          attempt = Promise.reject(error);
        }
        void attempt.then(
          (value) => finish({ value }),
          (error) => {
            closePopup(opened);
            opened = null;
            if (settled) return;
            if (signal.aborted) {
              onAbort();
              return;
            }
            const refused = allowPopup ? classifyIframeRestriction(error, action) : null;
            if (refused) {
              markInlinePasskeyRefused(action, refused.reason);
              restriction = refused;
              route = 'popup';
            }
            report('recovery', refused?.reason ?? 'popup-or-ceremony-failed');
            busy = false;
            failure =
              error instanceof Error ? error.message : 'The passkey request failed. Please retry.';
            show();
          }
        );
      }
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      else show();
    });
  }
}
