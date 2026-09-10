import {
  AddressType,
  type IThruChain,
  type ThruSigningContext,
  type ThruSigningSession,
  type ThruSigningSessionCreateOptions,
  type ThruSigningSessionDescriptor,
  type ThruSigningSessionRenewOptions,
  type ThruPasskeyChallengeIntent,
  type ThruPasskeyChallengeSignature,
  type ThruTransactionIntent,
} from "../../../interfaces";
import { POST_MESSAGE_REQUEST_TYPES, createRequestId } from "../../../protocol";
import { buildWalletAccountContext } from "@thru/programs/passkey-manager";
import type { NativeProvider } from "../NativeProvider";
import type { WebViewBridge } from "../WebViewBridge";
import {
  SigningSessionDescriptorStore,
  isSigningSessionUnavailable,
  resolveSessionExpirySeconds,
} from "../../../signing-sessions";

function descriptorFromWire(session: {
  id: string;
  walletAddress: string;
  publicKey: string;
  authIdx: number;
  expiresAt: string;
  createdAt: string;
}): ThruSigningSessionDescriptor {
  return {
    id: session.id,
    walletAddress: session.walletAddress,
    publicKey: session.publicKey,
    authIdx: session.authIdx,
    expiresAt: Number(BigInt(session.expiresAt)),
    createdAt: Number(BigInt(session.createdAt)),
  };
}

/**
 * NativeThruChain - mirror of EmbeddedThruChain over the WebView bridge.
 * Sign moments toggle the host bottom sheet via provider.requestShow /
 * requestHide instead of iframe.show / hide.
 */
export class NativeThruChain implements IThruChain {
  private readonly bridge: WebViewBridge;
  private readonly provider: NativeProvider;
  private readonly origin: string;
  private readonly signingSessions?: SigningSessionDescriptorStore;
  private readonly broadcastTransaction?: (
    signedTransaction: string,
  ) => Promise<unknown>;

  constructor(
    bridge: WebViewBridge,
    provider: NativeProvider,
    origin: string,
    signingSessions?: SigningSessionDescriptorStore,
    broadcastTransaction?: (signedTransaction: string) => Promise<unknown>,
  ) {
    this.bridge = bridge;
    this.provider = provider;
    this.origin = origin;
    this.signingSessions = signingSessions;
    this.broadcastTransaction = broadcastTransaction;
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
    if (!this.provider.isConnected() && !this.provider.isTransparent()) {
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
    const walletAddress =
      transaction.walletAddress ?? this.provider.getSelectedAccount()?.address;
    let signingSessionId = transaction.signingSessionId;
    let session =
      signingSessionId && this.signingSessions
        ? await this.signingSessions.get(signingSessionId)
        : null;
    if (!signingSessionId && this.signingSessions && walletAddress) {
      session = await this.signingSessions.getActive(walletAddress);
      signingSessionId = session?.id;
    }
    if (
      !signingSessionId &&
      !this.provider.isConnected() &&
      !this.provider.isTransparent()
    ) {
      throw new Error("Wallet not connected");
    }

    const shouldShowWallet = !signingSessionId || !session;
    let walletShown = shouldShowWallet;
    if (shouldShowWallet) {
      await this.provider.requestShow("sign-transaction-open");
    }
    try {
      try {
        return await this.requestSignedTransaction(
          transaction,
          walletAddress ?? session?.walletAddress,
          signingSessionId,
        );
      } catch (error) {
        if (!signingSessionId || !isSigningSessionUnavailable(error)) throw error;
        await this.signingSessions?.remove(signingSessionId);
        if (!shouldShowWallet) {
          await this.provider.requestShow("sign-transaction-session-fallback");
          walletShown = true;
        }
        return await this.requestSignedTransaction(transaction, walletAddress, undefined);
      }
    } finally {
      if (walletShown) {
        this.provider.requestHide("sign-transaction-settled");
      }
    }
  }

  async signPasskeyChallenge(
    challenge: ThruPasskeyChallengeIntent,
  ): Promise<ThruPasskeyChallengeSignature> {
    if (!this.provider.isConnected() && !this.provider.isTransparent()) {
      throw new Error("Wallet not connected");
    }
    await this.provider.requestShow("sign-passkey-challenge-open");
    try {
      const response = await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE,
        payload: {
          challenge: challenge.challenge,
          walletAddress: challenge.walletAddress,
        },
        origin: this.origin,
      });
      return response.result;
    } finally {
      this.provider.requestHide("sign-passkey-challenge-settled");
    }
  }

  async createSigningSession(
    options: ThruSigningSessionCreateOptions,
  ): Promise<ThruSigningSession> {
    if (!this.provider.isConnected() && !this.provider.isTransparent()) {
      throw new Error("Wallet not connected");
    }
    if (!this.signingSessions) {
      throw new Error("NativeSDKStorage is required for signing sessions");
    }

    const expiresAt = resolveSessionExpirySeconds(options);
    await this.provider.requestShow("create-signing-session-open");
    try {
      const response = await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION,
        payload: {
          walletAddress: options.walletAddress,
          expiresAt: String(expiresAt),
          review: options.review,
        },
        origin: this.origin,
      });
      const descriptor = descriptorFromWire(response.result.session);
      await this.signingSessions.saveReplacingWalletSessions(descriptor);
      return this.toSigningSession(descriptor);
    } finally {
      this.provider.requestHide("create-signing-session-settled");
    }
  }

  async renewSession(
    options: ThruSigningSessionRenewOptions,
  ): Promise<ThruSigningSession> {
    /* Renewal is non-interactive and must keep working after auto-lock. The
       existing session authorizes and broadcasts the replacement authority
       before the wallet confirms it. */
    if (!this.signingSessions) {
      throw new Error("NativeSDKStorage is required for signing sessions");
    }
    if (!this.broadcastTransaction) {
      throw new Error("Signing session transaction broadcast is not available");
    }

    const current = await this.signingSessions.getActive(options.walletAddress);
    if (!current) {
      throw new Error("An active signing session is required for renewal");
    }

    const expiresAt = resolveSessionExpirySeconds(options);
    const context = buildWalletAccountContext({
      walletAddress: options.walletAddress,
      readWriteAccounts: [],
      readOnlyAccounts: [],
    });
    const prepared = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
      payload: {
        walletAddress: options.walletAddress,
        expiresAt: String(expiresAt),
        walletAccountIdx: context.walletAccountIdx,
      },
      origin: this.origin,
    });
    const signedTransaction = await this.signTransaction({
      walletAddress: options.walletAddress,
      programAddress: prepared.result.programAddress,
      instructionData: prepared.result.instructionData,
      readWriteAddresses: context.readWriteAddresses,
      readOnlyAddresses: context.readOnlyAddresses,
      signingSessionId: current.id,
    });
    await this.broadcastTransaction(signedTransaction);

    const response = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
      payload: { sessionId: prepared.result.session.id },
      origin: this.origin,
    });
    const descriptor = descriptorFromWire(response.result.session);
    await this.signingSessions.saveReplacingWalletSessions(descriptor);
    return this.toSigningSession(descriptor);
  }

  async getSigningSession(id: string): Promise<ThruSigningSession | null> {
    if (!this.signingSessions) return null;
    const descriptor = await this.signingSessions.get(id);
    return descriptor ? this.toSigningSession(descriptor) : null;
  }

  async getSigningSessions(): Promise<ThruSigningSession[]> {
    if (!this.signingSessions) return [];
    return (await this.signingSessions.list()).map((descriptor) =>
      this.toSigningSession(descriptor),
    );
  }

  async getActiveSigningSession(
    walletAddress?: string,
  ): Promise<ThruSigningSession | null> {
    if (!this.signingSessions) return null;
    const descriptor = await this.signingSessions.getActive(
      walletAddress ?? this.provider.getSelectedAccount()?.address,
    );
    return descriptor ? this.toSigningSession(descriptor) : null;
  }

  async revokeSigningSession(id: string): Promise<void> {
    try {
      await this.bridge.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.REVOKE_SIGNING_SESSION,
        payload: { sessionId: id },
        origin: this.origin,
      });
    } finally {
      await this.signingSessions?.remove(id);
    }
  }

  private toSigningSession(
    descriptor: ThruSigningSessionDescriptor,
  ): ThruSigningSession {
    return {
      ...descriptor,
      signTransaction: (transaction) =>
        this.signTransaction({
          ...transaction,
          walletAddress: transaction.walletAddress ?? descriptor.walletAddress,
          signingSessionId: descriptor.id,
        }),
      revoke: () => this.revokeSigningSession(descriptor.id),
      toJSON: () => ({ ...descriptor }),
    };
  }

  private async requestSignedTransaction(
    transaction: ThruTransactionIntent,
    walletAddress?: string,
    signingSessionId?: string,
  ): Promise<string> {
    const response = await this.bridge.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
      payload: {
        walletAddress,
        programAddress: transaction.programAddress,
        instructionData: transaction.instructionData,
        readWriteAddresses: transaction.readWriteAddresses,
        readOnlyAddresses: transaction.readOnlyAddresses,
        review: transaction.review,
        signingSessionId,
      },
      origin: this.origin,
    });
    return response.result.signedTransaction;
  }
}
