import {
  AddressType,
  type IThruChain,
  type ThruSigningContext,
  type ThruTransactionIntent,
} from "../../../interfaces";
import { POST_MESSAGE_REQUEST_TYPES, createRequestId } from "../../../protocol";
import type { NativeProvider } from "../NativeProvider";
import type { WebViewBridge } from "../WebViewBridge";

/**
 * NativeThruChain - mirror of EmbeddedThruChain over the WebView bridge.
 * Sign moments toggle the host bottom sheet via provider.requestShow /
 * requestHide instead of iframe.show / hide.
 */
export class NativeThruChain implements IThruChain {
  private readonly bridge: WebViewBridge;
  private readonly provider: NativeProvider;
  private readonly origin: string;

  constructor(bridge: WebViewBridge, provider: NativeProvider, origin: string) {
    this.bridge = bridge;
    this.provider = provider;
    this.origin = origin;
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
    const response = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.GET_SIGNING_CONTEXT,
      origin: this.origin,
    });
    return response.result.signingContext;
  }

  async signTransaction(transaction: ThruTransactionIntent): Promise<string> {
    if (!this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }

    this.provider.requestShow();
    try {
      const response = await this.bridge.sendMessage({
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
        origin: this.origin,
      });
      return response.result.signedTransaction;
    } finally {
      this.provider.requestHide();
    }
  }
}
