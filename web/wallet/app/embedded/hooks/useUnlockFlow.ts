'use client';

import { useCallback, useState } from 'react';
import type { AppMetadata, ModalType, PendingRequest, SendResponseFn } from '../types';
import { ErrorCode, POST_MESSAGE_REQUEST_TYPES } from '../types';

interface UnlockFlowDeps {
  unlockWallet: (password: string) => Promise<void>;
  pendingRequest: PendingRequest | null;
  approveConnection: (options?: { skipUnlockCheck?: boolean }) => Promise<void>;
  setModalType: (value: ModalType) => void;
  setError: (value: string | null) => void;
  setIsLoading: (value: boolean) => void;
  setPendingRequest: (value: PendingRequest | null) => void;
  setAppMetadata: (value: AppMetadata | null) => void;
  sendResponse: SendResponseFn;
  onUnlockForTransaction: () => void;
}

export function useUnlockFlow({
  unlockWallet,
  pendingRequest,
  approveConnection,
  setModalType,
  setError,
  setIsLoading,
  setPendingRequest,
  setAppMetadata,
  sendResponse,
  onUnlockForTransaction,
}: UnlockFlowDeps) {
  const [password, setPassword] = useState('');

  const handleUnlock = useCallback(async () => {
    if (!password) {
      setError('Password required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await unlockWallet(password);
      setPassword('');

      if (pendingRequest?.type === POST_MESSAGE_REQUEST_TYPES.CONNECT) {
        await approveConnection({ skipUnlockCheck: true });
      } else {
        onUnlockForTransaction();
      }
    } catch (err) {
      console.error('[Embedded] Unlock failed:', err);
      setError('Incorrect password');
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  }, [
    approveConnection,
    onUnlockForTransaction,
    password,
    pendingRequest,
    sendResponse,
    setAppMetadata,
    setError,
    setIsLoading,
    setModalType,
    setPendingRequest,
    unlockWallet,
  ]);

  return {
    password,
    setPassword,
    handleUnlock,
  };
}
