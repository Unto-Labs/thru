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
} from "../../interfaces";
import { POST_MESSAGE_REQUEST_TYPES, createRequestId } from "../../protocol";
import { buildWalletAccountContext } from "@thru/programs/passkey-manager";
import type { EmbeddedProvider } from "../EmbeddedProvider";
import type { IframeManager } from "../IframeManager";
import {
  SigningSessionDescriptorStore,
  isSigningSessionUnavailable,
  resolveSessionExpirySeconds,
} from "../../signing-sessions";

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
 * EmbeddedThruChain - postMessage-backed Thru chain adapter.
 */
export class EmbeddedThruChain implements IThruChain {
  private readonly iframeManager: IframeManager;
  private readonly provider: EmbeddedProvider;
  private readonly signingSessions?: SigningSessionDescriptorStore;
  private readonly broadcastTransaction?: (
    signedTransaction: string,
  ) => Promise<unknown>;

  constructor(
    iframeManager: IframeManager,
    provider: EmbeddedProvider,
    signingSessions?: SigningSessionDescriptorStore,
    broadcastTransaction?: (signedTransaction: string) => Promise<unknown>,
  ) {
    this.iframeManager = iframeManager;
    this.provider = provider;
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
    const walletAddress =
      transaction.walletAddress ?? this.provider.getSelectedAccount()?.address;
    let signingSessionId = transaction.signingSessionId;
    let session =
      signingSessionId && this.signingSessions
        ? await this.signingSessions.get(signingSessionId)
        : null;
    if (!signingSessionId && this.signingSessions) {
      session = await this.signingSessions.getActive(walletAddress);
      signingSessionId = session?.id;
    }
    if (!signingSessionId && !this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }

    const shouldShowWallet = !signingSessionId || !session;
    let walletShown = shouldShowWallet;
    if (shouldShowWallet) {
      this.iframeManager.show();
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
          this.iframeManager.show();
          walletShown = true;
        }
        return await this.requestSignedTransaction(
          transaction,
          walletAddress ?? session?.walletAddress,
          undefined,
        );
      }
    } finally {
      if (walletShown) {
        this.iframeManager.hide();
      }
    }
  }

  async signPasskeyChallenge(
    challenge: ThruPasskeyChallengeIntent,
  ): Promise<ThruPasskeyChallengeSignature> {
    if (!this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }

    this.iframeManager.show();
    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE,
        payload: {
          challenge: challenge.challenge,
          walletAddress: challenge.walletAddress,
        },
        origin: window.location.origin,
      });
      return response.result;
    } finally {
      this.iframeManager.hide();
    }
  }

  async createSigningSession(
    options: ThruSigningSessionCreateOptions,
  ): Promise<ThruSigningSession> {
    if (!this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }
    if (!this.signingSessions) {
      throw new Error("Signing session storage is not available");
    }

    const expiresAt = resolveSessionExpirySeconds(options);
    this.iframeManager.show();
    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION,
        payload: {
          walletAddress: options.walletAddress,
          expiresAt: String(expiresAt),
          review: options.review,
        },
        origin: window.location.origin,
      });
      const descriptor = descriptorFromWire(response.result.session);
      await this.signingSessions.saveReplacingWalletSessions(descriptor);
      return this.toSigningSession(descriptor);
    } finally {
      this.iframeManager.hide();
    }
  }

  async renewSession(
    options: ThruSigningSessionRenewOptions,
  ): Promise<ThruSigningSession> {
    /* Renewal is non-interactive and must keep working after auto-lock. The
       existing session authorizes and broadcasts the replacement authority
       before the wallet confirms it. */
    if (!this.signingSessions) {
      throw new Error("Signing session storage is not available");
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
    const prepared = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
      payload: {
        walletAddress: options.walletAddress,
        expiresAt: String(expiresAt),
        walletAccountIdx: context.walletAccountIdx,
      },
      origin: window.location.origin,
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

    const response = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
      payload: { sessionId: prepared.result.session.id },
      origin: window.location.origin,
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
      await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.REVOKE_SIGNING_SESSION,
        payload: { sessionId: id },
        origin: window.location.origin,
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
    const response = await this.iframeManager.sendMessage({
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
      origin: window.location.origin,
    });
    return response.result.signedTransaction;
  }
}
