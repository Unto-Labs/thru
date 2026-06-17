import {
  AddressType,
  type IThruChain,
  type ThruSigningContext,
  type ThruSigningSession,
  type ThruSigningSessionCreateOptions,
  type ThruSigningSessionDescriptor,
  type ThruSigningSessionInstruction,
  type ThruSigningSessionInstructionCreateOptions,
  type ThruPasskeyChallengeIntent,
  type ThruPasskeyChallengeSignature,
  type ThruTransactionIntent,
} from "../../interfaces";
import { POST_MESSAGE_REQUEST_TYPES, createRequestId } from "../../protocol";
import { base64ToBytes } from "../../encoding";
import type { EmbeddedProvider } from "../EmbeddedProvider";
import type { IframeManager } from "../IframeManager";
import {
  SigningSessionDescriptorStore,
  assertSigningSessionWalletAccountIdx,
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

  constructor(
    iframeManager: IframeManager,
    provider: EmbeddedProvider,
    signingSessions?: SigningSessionDescriptorStore,
  ) {
    this.iframeManager = iframeManager;
    this.provider = provider;
    this.signingSessions = signingSessions;
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
    const signingSessionId = transaction.signingSessionId;
    if (!signingSessionId && !this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }

    const session = signingSessionId
      ? await this.requireSigningSession(signingSessionId)
      : null;
    const shouldShowWallet = !signingSessionId;
    if (shouldShowWallet) {
      this.iframeManager.show();
    }

    try {
      const response = await this.iframeManager.sendMessage({
        id: createRequestId(),
        type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
        payload: {
          walletAddress: transaction.walletAddress ?? session?.walletAddress,
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
    } finally {
      if (shouldShowWallet) {
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

  async createSigningSessionInstruction(
    options: ThruSigningSessionInstructionCreateOptions,
  ): Promise<ThruSigningSessionInstruction> {
    if (!this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }
    if (!this.signingSessions) {
      throw new Error("Signing session storage is not available");
    }

    const expiresAt = resolveSessionExpirySeconds(options);
    assertSigningSessionWalletAccountIdx(options.walletAccountIdx);
    const response = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
      payload: {
        walletAddress: options.walletAddress,
        expiresAt: String(expiresAt),
        walletAccountIdx: options.walletAccountIdx,
      },
      origin: window.location.origin,
    });
    const descriptor = descriptorFromWire(response.result.session);
    return {
      session: this.toSigningSession(descriptor),
      programAddress: response.result.programAddress,
      instructionData: base64ToBytes(response.result.instructionData),
    };
  }

  async confirmSigningSession(id: string): Promise<ThruSigningSession> {
    if (!this.provider.isConnected()) {
      throw new Error("Wallet not connected");
    }
    if (!this.signingSessions) {
      throw new Error("Signing session storage is not available");
    }

    const response = await this.iframeManager.sendMessage({
      id: createRequestId(),
      type: POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
      payload: { sessionId: id },
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

  private async requireSigningSession(
    id: string,
  ): Promise<ThruSigningSessionDescriptor> {
    if (!this.signingSessions) {
      throw new Error("Signing session storage is not available");
    }
    const session = await this.signingSessions.get(id);
    if (!session) {
      throw new Error("Signing session is not known to this app");
    }
    return session;
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
}
