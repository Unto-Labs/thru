/**
 * Iframe Message Protocol Types
 *
 * Defines the postMessage protocol between dApps and the wallet iframe.
 * All messages follow a request/response pattern with type-safe payloads.
 */

/**
 * Message sent from dApp to wallet iframe
 */
export interface IframeRequest {
  type: 'signTransaction:request';
  id: string; // Unique request ID for correlation
  params: SignTransactionParams;
}

/**
 * Parameters for transaction signing request
 */
export interface SignTransactionParams {
  to: string; // Recipient address
  amount: string; // Amount in lamports (as string, since BigInt doesn't serialize)
}

/**
 * Message sent from wallet iframe back to dApp
 */
export interface IframeResponse {
  type: 'signTransaction:response';
  id: string; // Matches request ID
  success: boolean;
  signature?: string; // Transaction signature (if successful)
  error?: string; // Error message (if failed)
}

/**
 * Internal state for transaction approval modal
 */
export interface TransactionApprovalState {
  isVisible: boolean;
  request: IframeRequest | null;
  selectedAccountIndex: number;
  isUnlocking: boolean;
  error: string | null;
  isSending: boolean;
}
