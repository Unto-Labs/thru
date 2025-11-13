/**
 * WorkerClient - Main thread client for communicating with SignerWorker
 * Provides typed interface for worker operations
 */

import { WORKER_MESSAGE_TYPE, WORKER_EVENT_MESSAGE_TYPE, createWorkerRequestId } from '@/types/worker-messages';
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerMessageType,
  WorkerEventMessage,
  WorkerEventType,
  WorkerOutboundMessage,
} from '@/types/worker-messages';
import { EncryptedData } from '@thru/crypto';

export class WorkerClient {
  private worker: Worker | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private readonly REQUEST_TIMEOUT_MS = 30000; // 30 seconds
  private eventListeners = new Map<WorkerEventType, Set<(payload?: any) => void>>();

  /**
   * Initialize the worker
   */
  initialize(): void {
    if (this.worker) {
      console.warn('[WorkerClient] Worker already initialized');
      return;
    }

    try {
      // Create worker instance
      this.worker = new Worker(new URL('../../workers/signer.worker.ts', import.meta.url), {
        type: 'module',
      });

      // Set up message handler
      this.worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
        this.handleWorkerMessage(event.data);
      };

      // Set up error handler
      this.worker.onerror = (error) => {
        console.error('[WorkerClient] Worker error:', error);
        this.rejectAllPending(new Error('Worker error: ' + error.message));
      };

      console.log('[WorkerClient] Worker initialized');
    } catch (error) {
      console.error('[WorkerClient] Failed to initialize worker:', error);
      throw new Error('Failed to initialize worker');
    }
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.rejectAllPending(new Error('Worker terminated'));
      console.log('[WorkerClient] Worker terminated');
    }
  }

  /**
   * Check if worker is initialized
   */
  isInitialized(): boolean {
    return this.worker !== null;
  }

  /**
   * Send a request to the worker
   */
  private async sendRequest<T = any>(
    type: WorkerMessageType,
    payload?: any
  ): Promise<T> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    return new Promise<T>((resolve, reject) => {
      const id = createWorkerRequestId();

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${type}`));
      }, this.REQUEST_TIMEOUT_MS);

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Send request to worker
      const request: WorkerRequest = { id, type, payload };
      this.worker!.postMessage(request);
    });
  }

  /**
   * Handle response from worker
   */
  private handleWorkerResponse(response: WorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.warn('[WorkerClient] Received response for unknown request:', response.id);
      return;
    }

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    // Resolve or reject based on response
    if (response.success) {
      pending.resolve(response.result);
    } else {
      const error = new Error(
        response.error?.message || 'Unknown worker error'
      );
      (error as any).code = response.error?.code;
      pending.reject(error);
    }
  }

  /**
   * Reject all pending requests
   */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Handle generic worker message (response or event)
   */
  private handleWorkerMessage(message: WorkerOutboundMessage): void {
    if ((message as WorkerEventMessage).type === WORKER_EVENT_MESSAGE_TYPE) {
      this.handleWorkerEvent(message as WorkerEventMessage);
      return;
    }
    this.handleWorkerResponse(message as WorkerResponse);
  }

  /**
   * Handle worker-sent events (no matching request)
   */
  private handleWorkerEvent(message: WorkerEventMessage): void {
    this.emitEvent(message.event, message.payload);
  }

  /**
   * Register event listener
   */
  onEvent(event: WorkerEventType, listener: (payload?: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  offEvent(event: WorkerEventType, listener: (payload?: any) => void): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  /**
   * Emit worker event to listeners
   */
  private emitEvent(event: WorkerEventType, payload?: any): void {
    this.eventListeners.get(event)?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[WorkerClient] Error in ${event} listener:`, error);
      }
    });
  }

  // ========== Public API Methods ==========

  /**
   * Unlock the wallet with password
   */
  async unlock(encrypted: EncryptedData, password: string): Promise<void> {
    const result = await this.sendRequest<{ unlocked: true }>(WORKER_MESSAGE_TYPE.UNLOCK, {
      encrypted,
      password,
    });
    if (!result.unlocked) {
      throw new Error('Failed to unlock wallet');
    }
  }

  /**
   * Lock the wallet
   */
  async lock(): Promise<void> {
    await this.sendRequest(WORKER_MESSAGE_TYPE.LOCK);
  }

  /**
   * Derive an account by index
   */
  async deriveAccount(accountIndex: number): Promise<{
    publicKey: string;
    path: string;
  }> {
    return await this.sendRequest(WORKER_MESSAGE_TYPE.DERIVE_ACCOUNT, { accountIndex });
  }

  /**
   * Sign a serialized transaction (base64 string) and return the signed base64 payload
   * Used by embedded iframe protocol when receiving serialized transactions from SDK
   */
  async signSerializedTransaction(
    accountIndex: number,
    serializedTransaction: string
  ): Promise<string> {
    const result = await this.sendRequest<{ signedTransaction: string }>(
      WORKER_MESSAGE_TYPE.SIGN_SERIALIZED_TRANSACTION,
      { accountIndex, serializedTransaction }
    );
    return result.signedTransaction;
  }

  /**
   * Get public key for an account
   */
  async getPublicKey(accountIndex: number): Promise<string> {
    const result = await this.sendRequest<{ publicKey: string }>(WORKER_MESSAGE_TYPE.GET_PUBLIC_KEY, {
      accountIndex,
    });
    return result.publicKey;
  }

  /**
   * Check if wallet is unlocked in worker
   */
  async isUnlocked(): Promise<boolean> {
    const result = await this.sendRequest<{ isUnlocked: boolean }>(WORKER_MESSAGE_TYPE.IS_UNLOCKED);
    return result.isUnlocked;
  }
}

// Export singleton instance
export const workerClient = new WorkerClient();
