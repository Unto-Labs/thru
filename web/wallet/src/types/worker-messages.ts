/**
 * Worker Message Protocol Types
 * Defines the message structure for communication between main thread and worker
 */

import { EncryptedData } from '@thru/crypto';
import { createRequestId } from '@thru/protocol';

export const WORKER_MESSAGE_TYPE = {
  UNLOCK: 'unlock',
  LOCK: 'lock',
  DERIVE_ACCOUNT: 'deriveAccount',
  SIGN_SERIALIZED_TRANSACTION: 'signSerializedTransaction',
  GET_PUBLIC_KEY: 'getPublicKey',
  IS_UNLOCKED: 'isUnlocked',
} as const;

export type WorkerMessageType = typeof WORKER_MESSAGE_TYPE[keyof typeof WORKER_MESSAGE_TYPE];

// Request messages from main thread to worker
export interface WorkerRequest {
  id: string;
  type: WorkerMessageType;
  payload?: any;
}

export interface UnlockRequest extends WorkerRequest {
  type: typeof WORKER_MESSAGE_TYPE.UNLOCK;
  payload: {
    encrypted: EncryptedData;
    password: string;
  };
}

export interface LockRequest extends WorkerRequest {
  type: typeof WORKER_MESSAGE_TYPE.LOCK;
  payload?: undefined;
}

export interface DeriveAccountRequest extends WorkerRequest {
  type: typeof WORKER_MESSAGE_TYPE.DERIVE_ACCOUNT;
  payload: {
    accountIndex: number;
  };
}

export interface SignSerializedTransactionRequest extends WorkerRequest {
  type: typeof WORKER_MESSAGE_TYPE.SIGN_SERIALIZED_TRANSACTION;
  payload: {
    accountIndex: number;
    serializedTransaction: string; // Base64 encoded transaction from SDK
  };
}

export interface GetPublicKeyRequest extends WorkerRequest {
  type: typeof WORKER_MESSAGE_TYPE.GET_PUBLIC_KEY;
  payload: {
    accountIndex: number;
  };
}

export interface IsUnlockedRequest extends WorkerRequest {
  type: typeof WORKER_MESSAGE_TYPE.IS_UNLOCKED;
  payload?: undefined;
}

// Response messages from worker to main thread
export interface WorkerResponse {
  id: string;
  success: boolean;
  result?: any;
  error?: {
    code: string;
    message: string;
  };
}

// Event messages from worker to main thread (unsolicited)
export const WORKER_EVENT_TYPE = {
  AUTO_LOCK: 'auto_lock',
} as const;

export type WorkerEventType = typeof WORKER_EVENT_TYPE[keyof typeof WORKER_EVENT_TYPE];

export const WORKER_EVENT_MESSAGE_TYPE = 'event' as const;

export interface WorkerEventMessage {
  type: typeof WORKER_EVENT_MESSAGE_TYPE;
  event: WorkerEventType;
  payload?: any;
}

export type WorkerOutboundMessage = WorkerResponse | WorkerEventMessage;

export interface UnlockResponse extends WorkerResponse {
  result?: {
    unlocked: true;
  };
}

export interface DeriveAccountResponse extends WorkerResponse {
  result?: {
    publicKey: string;
    path: string;
  };
}

export interface SignSerializedTransactionResponse extends WorkerResponse {
  result?: {
    signedTransaction: string; // Base64 encoded signed transaction
  };
}

export interface GetPublicKeyResponse extends WorkerResponse {
  result?: {
    publicKey: string;
  };
}

export interface IsUnlockedResponse extends WorkerResponse {
  result?: {
    isUnlocked: boolean;
  };
}

// Error codes
export enum WorkerErrorCode {
  WALLET_LOCKED = 'WALLET_LOCKED',
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  SIGNING_FAILED = 'SIGNING_FAILED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// Helper type for all possible requests
export type AnyWorkerRequest =
  | UnlockRequest
  | LockRequest
  | DeriveAccountRequest
  | SignSerializedTransactionRequest
  | GetPublicKeyRequest
  | IsUnlockedRequest;

// Helper type for all possible responses
export type AnyWorkerResponse =
  | UnlockResponse
  | DeriveAccountResponse
  | SignSerializedTransactionResponse
  | GetPublicKeyResponse
  | IsUnlockedResponse;

export const createWorkerRequestId = (): string => createRequestId('worker');
