'use client';

import { useCallback } from 'react';
import { ErrorCode, POST_MESSAGE_REQUEST_TYPES } from '../types';
import type {
  ModalType,
  PendingRequest,
  SendResponseFn,
  SignTransactionRequestMessage,
} from '../types';

interface TransactionFlowDeps {
  accounts: Array<{ publicKey: string; index: number }>;
  selectedAccountIndex: number;
  pendingRequest: PendingRequest | null;
  setPendingRequest: (value: PendingRequest | null) => void;
  setModalType: (value: ModalType) => void;
  setError: (value: string | null) => void;
  setIsLoading: (value: boolean) => void;
  isConnected: boolean;
  isUnlocked: boolean;
  sendResponse: SendResponseFn;
  signSerializedTransaction: (accountIndex: number, serializedTransaction: string) => Promise<string>;
}

export function useTransactionFlow({
  accounts,
  selectedAccountIndex,
  pendingRequest,
  setPendingRequest,
  setModalType,
  setError,
  setIsLoading,
  isConnected,
  isUnlocked,
  sendResponse,
  signSerializedTransaction,
}: TransactionFlowDeps) {
  const handleSignTransaction = useCallback(
    (message: SignTransactionRequestMessage) => {
      if (!isConnected) {
        sendResponse<SignTransactionRequestMessage>({
          id: message.id,
          success: false,
          error: {
            code: ErrorCode.WALLET_LOCKED,
            message: 'Wallet not connected',
          },
        });
        return;
      }

      if (!isUnlocked) {
        setModalType('unlock');
      } else {
        setModalType('approve-transaction');
      }
    },
    [isConnected, isUnlocked, sendResponse, setModalType]
  );

  const handleApproveTransaction = useCallback(async () => {
    if (!pendingRequest) {
      console.warn('[Embedded] Approve transaction called without pending request');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const selectedAccount = accounts[selectedAccountIndex];
      if (!selectedAccount) {
        throw new Error('No account selected');
      }

      if (pendingRequest.type !== POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION) {
        throw new Error(`Unsupported request type: ${pendingRequest.type}`);
      }

      const serializedTransaction = pendingRequest.payload.transaction;
      if (typeof serializedTransaction !== 'string' || serializedTransaction.length === 0) {
        throw new Error('Missing transaction payload');
      }

      const signedTransaction = await signSerializedTransaction(
        selectedAccount.index,
        serializedTransaction
      );

      sendResponse<SignTransactionRequestMessage>({
        id: pendingRequest.id,
        success: true,
        result: { signedTransaction },
      });

      setModalType(null);
      setPendingRequest(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      setError(message);

      if (pendingRequest) {
        sendResponse<SignTransactionRequestMessage>({
          id: pendingRequest.id,
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message,
          },
        });
      }

      setPendingRequest(null);
      setModalType(null);
    } finally {
      setIsLoading(false);
    }
  }, [
    accounts,
    pendingRequest,
    selectedAccountIndex,
    sendResponse,
    setError,
    setIsLoading,
    setModalType,
    setPendingRequest,
    signSerializedTransaction,
  ]);

  return {
    handleSignTransaction,
    handleApproveTransaction,
  };
}
