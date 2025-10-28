import { AddressType, type IThruChain } from '@thru/chain-interfaces';
import { POST_MESSAGE_REQUEST_TYPES, createRequestId } from '@thru/protocol';
import type { EmbeddedProvider } from '../EmbeddedProvider';
import type { IframeManager } from '../IframeManager';

/**
 * EmbeddedThruChain - postMessage-backed Thru chain adapter.
 */
export class EmbeddedThruChain implements IThruChain {
  private readonly iframeManager: IframeManager;
  private readonly provider: EmbeddedProvider;

  constructor(iframeManager: IframeManager, provider: EmbeddedProvider) {
    this.iframeManager = iframeManager;
    this.provider = provider;
  }

  get connected(): boolean {
    return this.provider.isConnected();
  }

  async connect(): Promise<{ publicKey: string }> {
    const result = await this.provider.connect();
    const thruAccount = result.accounts.find((addr) => addr.accountType === AddressType.THRU);

    if (!thruAccount) {
      throw new Error('Thru address not found in connection result');
    }

    return { publicKey: thruAccount.address };
  }

  async disconnect(): Promise<void> {
    await this.provider.disconnect();
  }

  async signTransaction(serializedTransaction: string): Promise<string> {
    if (!this.provider.isConnected()) {
      throw new Error('Wallet not connected');
    }
    if (typeof serializedTransaction !== 'string' || serializedTransaction.length === 0) {
      throw new Error('Transaction payload must be a base64 encoded string');
    }

    this.iframeManager.show();

    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
        payload: { transaction: serializedTransaction },
        origin: window.location.origin,
      });
      return response.result.signedTransaction;
    } finally {
      this.iframeManager.hide();
    }
  }
}
