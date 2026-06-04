import {
  AddressType,
  type IThruChain,
  type ThruSigningContext,
  type ThruTransactionIntent,
} from "../../interfaces";
import { POST_MESSAGE_REQUEST_TYPES, createRequestId } from "../../protocol";
import type { EmbeddedProvider } from "../EmbeddedProvider";
import type { IframeManager } from "../IframeManager";

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
    const selectedAccount = result.selectedAccount;
    const thruAccount =
      selectedAccount?.accountType === AddressType.THRU
        ? selectedAccount
        : result.accounts.find((addr) => addr.accountType === AddressType.THRU);

    if (!thruAccount) {
      throw new Error("Thru address not found in connection result");
    }

    return { publicKey: thruAccount.address };
  }

  async disconnect(): Promise<void> {
    await this.provider.disconnect();
  }

  async getSigningContext(): Promise<ThruSigningContext> {
    if (!this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }

    const response = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.GET_SIGNING_CONTEXT,
      origin: window.location.origin,
    });

    return response.result.signingContext;
  }

  async signTransaction(transaction: ThruTransactionIntent): Promise<string> {
    if (!this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }

    this.iframeManager.show();

    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
        payload: {
          walletAddress: transaction.walletAddress,
          programAddress: transaction.programAddress,
          instructionData: transaction.instructionData,
          readWriteAddresses: transaction.readWriteAddresses,
          readOnlyAddresses: transaction.readOnlyAddresses,
          review: transaction.review,
        },
        origin: window.location.origin,
      });
      return response.result.signedTransaction;
    } finally {
      this.iframeManager.hide();
    }
  }
}
