/**
 * SignerWorker - Web Worker for isolated key operations
 * Handles all signing operations in a separate thread for security
 */

import type {
  DeriveAccountRequest,
  GetPublicKeyRequest,
  SignSerializedTransactionRequest,
  WorkerEventMessage,
  WorkerEventType,
  WorkerRequest,
  WorkerResponse,
} from '@/types/worker-messages';
import {
  WORKER_EVENT_MESSAGE_TYPE,
  WORKER_EVENT_TYPE,
  WORKER_MESSAGE_TYPE,
  WorkerErrorCode,
} from '@/types/worker-messages';
import { KeyManager } from './key-manager';

const emitWorkerEvent = (event: WorkerEventType, payload?: any) => {
  const message: WorkerEventMessage = {
    type: WORKER_EVENT_MESSAGE_TYPE,
    event,
    payload,
  };
  self.postMessage(message);
};

// Initialize key manager
const keyManager = new KeyManager(() => emitWorkerEvent(WORKER_EVENT_TYPE.AUTO_LOCK));

/**
 * Handle incoming messages from main thread
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  console.log('[SignerWorker] Received request:', request.type);

  try {
    let result: any;

    switch (request.type) {
      case WORKER_MESSAGE_TYPE.LOCK:
        result = handleLock();
        break;

      case WORKER_MESSAGE_TYPE.DERIVE_ACCOUNT:
        result = await handleDeriveAccount(request as DeriveAccountRequest);
        break;

      case WORKER_MESSAGE_TYPE.SIGN_SERIALIZED_TRANSACTION:
        result = await handleSignSerializedTransaction(
          request as SignSerializedTransactionRequest
        );
        break;

      case WORKER_MESSAGE_TYPE.GET_PUBLIC_KEY:
        result = await handleGetPublicKey(request as GetPublicKeyRequest);
        break;

      case WORKER_MESSAGE_TYPE.IS_UNLOCKED:
        result = handleIsUnlocked();
        break;

      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }

    // Send success response
    const response: WorkerResponse = {
      id: request.id,
      success: true,
      result,
    };

    self.postMessage(response);
  } catch (error) {
    console.error('[SignerWorker] Error handling request:', error);

    // Send error response
    const response: WorkerResponse = {
      id: request.id,
      success: false,
      error: {
        code: getErrorCode(error),
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };

    self.postMessage(response);
  }
};

/**
 * Handle lock request
 */
function handleLock(): { locked: true } {
  keyManager.lock();
  return { locked: true };
}

/**
 * Handle derive account request
 */
async function handleDeriveAccount(request: DeriveAccountRequest): Promise<{
  publicKey: string;
  path: string;
}> {
  const { accountIndex } = request.payload;
  return keyManager.deriveAccount(accountIndex);
}

/**
 * Handle sign serialized transaction request (base64 string from SDK)
 */
async function handleSignSerializedTransaction(
  request: SignSerializedTransactionRequest
): Promise<{ signedTransaction: string }> {
  const { accountIndex, serializedTransaction } = request.payload;

  const signedTransaction = await keyManager.signSerializedTransaction(
    accountIndex,
    serializedTransaction
  );

  return { signedTransaction };
}

/**
 * Handle get public key request
 */
async function handleGetPublicKey(request: GetPublicKeyRequest): Promise<{
  publicKey: string;
}> {
  const { accountIndex } = request.payload;
  const publicKey = await keyManager.getPublicKey(accountIndex);
  return { publicKey };
}

/**
 * Handle is unlocked request
 */
function handleIsUnlocked(): { isUnlocked: boolean } {
  return { isUnlocked: keyManager.isUnlocked() };
}

/**
 * Map errors to error codes
 */
function getErrorCode(error: any): string {
  if (error instanceof Error) {
    if (error.message.includes('locked')) {
      return WorkerErrorCode.WALLET_LOCKED;
    }
    if (error.message.includes('account')) {
      return WorkerErrorCode.ACCOUNT_NOT_FOUND;
    }
    if (error.message.includes('sign')) {
      return WorkerErrorCode.SIGNING_FAILED;
    }
  }
  return WorkerErrorCode.UNKNOWN_ERROR;
}

// Log worker initialization
console.log('[SignerWorker] Initialized and ready');
