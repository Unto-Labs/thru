'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PASSKEY_POPUP_READY_EVENT,
  PASSKEY_POPUP_REQUEST_EVENT,
  PASSKEY_POPUP_RESPONSE_EVENT,
  PASSKEY_POPUP_CHANNEL,
  registerPasskey,
  signWithPasskey,
  type PasskeyPopupAction,
  type PasskeyPopupContext,
  type PasskeyPopupRequest,
  type PasskeyPopupResponse,
  type PasskeyPopupAccount,
  buildStoredPasskeyResult,
  buildSuccessResponse,
  decodeChallenge,
  getPopupDisplayInfo,
  getResponseError,
  signWithPreferredPasskey,
  toPopupSigningResult,
} from '@thru/passkey';
import { loadPasskeyProfiles, AccountStorage } from '@thru/wallet-store';
import type { PasskeyMetadata } from '@thru/wallet-store';

type Status = 'idle' | 'ready' | 'working' | 'success' | 'error';
const DEBUG = process.env.NEXT_PUBLIC_PASSKEY_DEBUG === '1';

async function getPreferredStoredPasskey(): Promise<PasskeyMetadata | null> {
  const store = await loadPasskeyProfiles();
  const profiles = store?.profiles ?? [];
  const selected = profiles[store?.selectedIndex ?? 0]?.passkey ?? null;
  if (selected) return selected;
  let latest: PasskeyMetadata | null = null;
  for (const profile of profiles) {
    if (!profile.passkey) continue;
    if (!latest || profile.passkey.lastUsedAt > latest.lastUsedAt) {
      latest = profile.passkey;
    }
  }
  return latest;
}

async function loadPopupAccounts(): Promise<PasskeyPopupAccount[]> {
  const storedAccounts = await AccountStorage.getAccounts();
  return storedAccounts.map((account) => ({
    index: account.index,
    label: account.label,
    publicKey: account.publicKey,
    path: account.path,
    createdAt: account.createdAt instanceof Date
      ? account.createdAt.toISOString()
      : account.createdAt
        ? new Date(account.createdAt).toISOString()
        : undefined,
    addressType: account.addressType ? String(account.addressType) : undefined,
    publicKeyRawBase64: account.publicKeyRawBase64,
  }));
}

export default function PasskeyPopupPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('Waiting for passkey request...');
  const [connectContext, setConnectContext] = useState<PasskeyPopupContext | null>(null);
  const [pendingRequest, setPendingRequest] = useState<PasskeyPopupRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const sendMessageRef = useRef<((payload: PasskeyPopupResponse | { type: string }) => void) | null>(null);
  const runRequestRef = useRef<((data: PasskeyPopupRequest) => Promise<void>) | null>(null);
  const pendingRequestRef = useRef<PasskeyPopupRequest | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setStatus('error');
      setMessage('This window must be opened by the Thru wallet.');
      return;
    }

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(PASSKEY_POPUP_CHANNEL)
        : null;

    const canCommunicate = Boolean(window.opener) || Boolean(channel);
    if (!canCommunicate) {
      setStatus('error');
      setMessage('This window must be opened by the Thru wallet.');
      return;
    }

    const sendMessage = (payload: PasskeyPopupResponse | { type: string }) => {
      if (window.opener) {
        window.opener.postMessage(payload, window.location.origin);
      }
      channel?.postMessage(payload);
    };
    sendMessageRef.current = sendMessage;

    setStatus('ready');
    sendMessage({ type: PASSKEY_POPUP_READY_EVENT });

    const sendSuccess = (response: PasskeyPopupResponse, successMessage: string) => {
      sendMessage(response);
      setStatus('success');
      setMessage(successMessage);
      window.close();
    };

    const sendError = (action: PasskeyPopupAction, requestId: string, error: unknown) => {
      const response: PasskeyPopupResponse = {
        type: PASSKEY_POPUP_RESPONSE_EVENT,
        requestId,
        action,
        success: false,
        error: getResponseError(action, error),
      };
      sendMessage(response);
      setStatus('error');
      setMessage(response.error.message);
    };

    const runRequest = async (data: PasskeyPopupRequest) => {
      if (!data || data.type !== PASSKEY_POPUP_REQUEST_EVENT) {
        return;
      }

      setStatus('working');
      setMessage('Complete the passkey prompt to continue.');
      setIsProcessing(true);

      try {
        switch (data.action) {
          case 'get': {
            const payload = data.payload as {
              credentialId: string;
              challengeBase64Url: string;
              rpId: string;
            };
            const result = await signWithPasskey(
              payload.credentialId,
              decodeChallenge(payload.challengeBase64Url),
              payload.rpId
            );
            const response = buildSuccessResponse(data.requestId, 'get', toPopupSigningResult(result));
            sendSuccess(response, 'Passkey verified. You can close this window.');
            return;
          }
          case 'create': {
            const payload = data.payload as { alias: string; userId: string; rpId: string };
            const result = await registerPasskey(payload.alias, payload.userId, payload.rpId);
            const response = buildSuccessResponse(data.requestId, 'create', result);
            sendSuccess(response, 'Passkey created. You can close this window.');
            return;
          }
          case 'getStored': {
            const payload = data.payload as { challengeBase64Url: string; context?: PasskeyPopupContext };
            if (payload.context) {
              setConnectContext(payload.context);
            }
            const challenge = decodeChallenge(payload.challengeBase64Url);
            const store = await loadPasskeyProfiles();
            const profiles = store?.profiles ?? [];
            const preferredPasskey = await getPreferredStoredPasskey();

            if (DEBUG) {
              console.log('[PasskeyPopup] getStored preferred passkey:', {
                profileCount: profiles.length,
                selectedIndex: store?.selectedIndex ?? null,
                selectedHasPasskey: Boolean(preferredPasskey),
                preferredCredentialId: preferredPasskey?.credentialId ?? null,
              });
            }

            let accounts: PasskeyPopupAccount[] = [];
            try {
              accounts = await loadPopupAccounts();
            } catch (err) {
              console.warn('[PasskeyPopup] Failed to load accounts from storage:', err);
            }

            const signResult = await signWithPreferredPasskey(
              preferredPasskey,
              challenge,
              (msg) => console.log('[PasskeyPopup]', msg)
            );
            const storedResult = buildStoredPasskeyResult(signResult, preferredPasskey, profiles, accounts);
            const response = buildSuccessResponse(data.requestId, 'getStored', storedResult);
            sendSuccess(response, 'Passkey verified. You can close this window.');
            return;
          }
          default:
            throw new Error('Unsupported passkey action');
        }
      } catch (error) {
        sendError(data.action, data.requestId, error);
      } finally {
        setIsProcessing(false);
      }
    };
    runRequestRef.current = runRequest;

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (window.opener && event.source !== window.opener) {
        return;
      }

      const data = event.data as PasskeyPopupRequest;
      if (!data || data.type !== PASSKEY_POPUP_REQUEST_EVENT) {
        return;
      }
      if (pendingRequestRef.current) {
        return;
      }
      if (data.action === 'getStored') {
        const payload = data.payload as { context?: PasskeyPopupContext };
        if (payload?.context) {
          setConnectContext(payload.context);
        }
      }
      pendingRequestRef.current = data;
      setPendingRequest(data);
      setStatus('ready');
      setMessage('Review the request to continue.');
    };

    const handleChannelMessage = (event: MessageEvent) => {
      const data = event.data as PasskeyPopupRequest;
      if (!data || data.type !== PASSKEY_POPUP_REQUEST_EVENT) {
        return;
      }
      if (pendingRequestRef.current) {
        return;
      }
      if (data.action === 'getStored') {
        const payload = data.payload as { context?: PasskeyPopupContext };
        if (payload?.context) {
          setConnectContext(payload.context);
        }
      }
      pendingRequestRef.current = data;
      setPendingRequest(data);
      setStatus('ready');
      setMessage('Review the request to continue.');
    };

    window.addEventListener('message', handleMessage);
    channel?.addEventListener('message', handleChannelMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
      channel?.removeEventListener('message', handleChannelMessage);
      channel?.close();
      sendMessageRef.current = null;
      runRequestRef.current = null;
      pendingRequestRef.current = null;
    };
  }, []);

  const displayInfo = connectContext ? getPopupDisplayInfo(connectContext) : null;

  const handleApprove = () => {
    if (!pendingRequest || isProcessing) {
      return;
    }
    const runRequest = runRequestRef.current;
    if (!runRequest) {
      return;
    }
    void runRequest(pendingRequest);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-5">
        <div className="mb-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <img
              src="/logo/thru-logo.svg"
              alt="Thru"
              className="h-[84px] w-[84px]"
            />
            <h1 className="text-sm font-semibold text-neutral-900">Sign in with Thru</h1>
            <p className="text-xs text-neutral-600">Review and approve to continue.</p>
          </div>
        </div>

        {displayInfo ? (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-900 text-sm font-semibold overflow-hidden">
                  {displayInfo.imageUrl ? (
                    <img
                      src={displayInfo.imageUrl}
                      alt={displayInfo.name}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span>{displayInfo.logoText}</span>
                  )}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="text-sm font-semibold text-neutral-900 truncate">
                    {displayInfo.name}
                  </div>
                  {displayInfo.url && (
                    <div className="text-xs text-neutral-500 truncate" title={displayInfo.url}>
                      {displayInfo.url}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-5">
              <div className="mb-2 text-xs font-medium text-neutral-500">Permissions</div>
              <ul className="space-y-1 text-xs text-neutral-700">
                <li>• View your wallet addresses</li>
                <li>• Request transaction approvals</li>
              </ul>
              <div className="mt-2 text-xs text-neutral-500">Only approve if you trust this app.</div>
            </div>
          </>
        ) : (
          <div className="mb-5 text-xs text-neutral-600">
            Waiting for the app details...
          </div>
        )}

        {status === 'error' && (
          <div className="mb-6 rounded-lg bg-surface-brick px-4 py-3 text-sm text-text-primary-inverse">
            {message}
          </div>
        )}

        <div className="flex">
          <button
            type="button"
            onClick={handleApprove}
            disabled={!pendingRequest || isProcessing}
            className="w-full rounded-lg bg-[#D33C43] px-4 py-2 text-sm font-semibold text-white hover:bg-[#bd3138] disabled:opacity-50"
          >
            {isProcessing ? 'Working…' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
