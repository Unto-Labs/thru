import type {
  PasskeyPopupAction,
  PasskeyPopupRequestPayload,
  PasskeyPopupRequest,
  PasskeyPopupResponse,
} from './types';

export const PASSKEY_POPUP_PATH = '/passkey/popup';
export const PASSKEY_POPUP_READY_EVENT = 'thru:passkey-popup-ready';
export const PASSKEY_POPUP_REQUEST_EVENT = 'thru:passkey-popup-request';
export const PASSKEY_POPUP_RESPONSE_EVENT = 'thru:passkey-popup-response';
export const PASSKEY_POPUP_CHANNEL = 'thru:passkey-popup-channel';

const PASSKEY_POPUP_TIMEOUT_MS = 60000;

export function closePopup(popup: Window | null | undefined): void {
  if (popup && !popup.closed) {
    popup.close();
  }
}

export function openPasskeyPopupWindow(): Window {
  const popupUrl = new URL(PASSKEY_POPUP_PATH, window.location.origin).toString();
  const popup = window.open(
    popupUrl,
    'thru_passkey_popup',
    'popup=yes,width=440,height=640'
  );

  if (!popup) {
    throw new Error('Passkey popup was blocked');
  }

  return popup;
}

function createPopupRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `passkey_${Date.now()}_${rand}`;
}

export async function requestPasskeyPopup<T>(
  action: PasskeyPopupAction,
  payload: PasskeyPopupRequestPayload,
  preopenedPopup?: Window | null
): Promise<T> {
  if (typeof window === 'undefined') {
    throw new Error('Passkey popup is only available in the browser');
  }

  const requestId = createPopupRequestId();
  const targetOrigin = window.location.origin;
  let popup: Window | null = preopenedPopup ?? null;
  const channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(PASSKEY_POPUP_CHANNEL) : null;

  return new Promise<T>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let closePoll: ReturnType<typeof setInterval> | null = null;
    let requestSent = false;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (closePoll) {
        clearInterval(closePoll);
        closePoll = null;
      }
      window.removeEventListener('message', handleMessage);
      if (channel) {
        channel.removeEventListener('message', handleChannelMessage);
        channel.close();
      }
    };

    const sendRequest = (viaChannel: boolean) => {
      if (requestSent) {
        return;
      }
      requestSent = true;

      const request: PasskeyPopupRequest = {
        type: PASSKEY_POPUP_REQUEST_EVENT,
        requestId,
        action,
        payload,
      };

      if (viaChannel) {
        channel?.postMessage(request);
        return;
      }

      popup?.postMessage(request, targetOrigin);
    };

    const handleResponse = (data: PasskeyPopupResponse) => {
      if (data.requestId !== requestId) {
        return;
      }

      cleanup();
      if (popup && !popup.closed) {
        popup.close();
      }

      if (data.success) {
        resolve((data as Extract<PasskeyPopupResponse, { success: true }>).result as T);
      } else {
        const err = new Error(data.error?.message || 'Passkey popup failed');
        if (data.error?.name) {
          (err as { name?: string }).name = data.error.name;
        }
        reject(err);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) {
        return;
      }

      const data = event.data as PasskeyPopupResponse | { type?: string };
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === PASSKEY_POPUP_READY_EVENT) {
        if (popup && event.source !== popup) {
          return;
        }
        sendRequest(false);
        return;
      }

      if (data.type === PASSKEY_POPUP_RESPONSE_EVENT && 'requestId' in data) {
        handleResponse(data as PasskeyPopupResponse);
      }
    };

    window.addEventListener('message', handleMessage);

    const handleChannelMessage = (event: MessageEvent) => {
      const data = event.data as PasskeyPopupResponse | { type?: string };
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === PASSKEY_POPUP_READY_EVENT) {
        sendRequest(true);
        return;
      }

      if (data.type === PASSKEY_POPUP_RESPONSE_EVENT && 'requestId' in data) {
        handleResponse(data as PasskeyPopupResponse);
      }
    };

    if (channel) {
      channel.addEventListener('message', handleChannelMessage);
    }

    if (!popup) {
      try {
        popup = openPasskeyPopupWindow();
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
    }

    timeout = setTimeout(() => {
      cleanup();
      try {
        popup?.close();
      } catch {
        /* ignore */
      }
      reject(new Error('Passkey popup timed out'));
    }, PASSKEY_POPUP_TIMEOUT_MS);

    closePoll = setInterval(() => {
      if (popup && popup.closed) {
        cleanup();
        reject(new Error('Passkey popup was closed'));
      }
    }, 250);
  });
}
