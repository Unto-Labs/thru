import { useEffect, useRef } from 'react';
import { useEmbeddedAppStore } from '../store/useEmbeddedAppStore';
import { EMBEDDED_PROVIDER_EVENTS, ErrorCode, type EmbeddedProviderEvent } from '../types';

interface UseAutoLockHandlerParams {
  autoLockCount: number;
  sendResponse: (response: any) => void;
  sendEvent: (eventName: EmbeddedProviderEvent, data?: any) => void;
}

/**
 * Handles wallet auto-lock detection and state reset
 */
export function useAutoLockHandler({ autoLockCount, sendResponse, sendEvent }: UseAutoLockHandlerParams) {
  const pendingRequest = useEmbeddedAppStore(state => state.pendingRequest);
  const resetState = useEmbeddedAppStore(state => state.resetState);
  const autoLockCountRef = useRef(autoLockCount);

  useEffect(() => {
    if (autoLockCount > autoLockCountRef.current) {
      if (pendingRequest) {
        sendResponse({
          id: pendingRequest.id,
          success: false,
          error: {
            code: ErrorCode.WALLET_LOCKED,
            message: 'Wallet auto-locked',
          },
        });
      }

      resetState();
      sendEvent(EMBEDDED_PROVIDER_EVENTS.LOCK, { reason: 'auto_lock' });
    }
    autoLockCountRef.current = autoLockCount;
  }, [autoLockCount, pendingRequest, sendEvent, sendResponse, resetState]);
}

