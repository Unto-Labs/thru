import type {
  ThruSigningContext,
  ThruSigningSession,
  ThruSigningSessionCreateOptions,
  ThruSigningSessionInstruction,
  ThruSigningSessionInstructionCreateOptions,
  ThruPasskeyChallengeIntent,
  ThruPasskeyChallengeSignature,
  ThruTransactionIntent,
} from "./types";

/**
 * Minimal Thru chain interface exposed to SDK consumers.
 * The concrete implementation will evolve as the Thru transaction
 * flow is fleshed out, but maintaining a dedicated contract now
 * keeps the Surface area aligned with other chain adapters.
 */
export interface IThruChain {
  /** Indicates whether the wallet has approved a Thru connection. */
  readonly connected: boolean;

  /**
   * Initiate a Thru connection flow. Resolves with the connected address once
   * the user has approved the request.
   */
  connect(): Promise<{ publicKey: string }>;

  /** Disconnect the currently connected Thru account. */
  disconnect(): Promise<void>;

  /**
   * Return the current embedded signing contract for Thru transactions.
   *
   * The selected account is the managed wallet account shown to the user.
   * The fee payer / signer can differ when the wallet routes transactions
   * through a wallet-local fee payer.
   */
  getSigningContext(): Promise<ThruSigningContext>;

  /**
   * Sign a wallet-managed transaction intent and return canonical raw
   * transaction bytes encoded as base64. The wallet owns fee payer choice,
   * account ordering, headers, nonces, and final wire layout.
   */
  signTransaction(transaction: ThruTransactionIntent): Promise<string>;

  /**
   * Sign a backend-prepared passkey-manager challenge with the wallet-owned
   * selected passkey and return submit-ready signature fields.
   */
  signPasskeyChallenge(
    challenge: ThruPasskeyChallengeIntent,
  ): Promise<ThruPasskeyChallengeSignature>;

  /**
   * Create a temporary wallet-owned signing session. The SDK stores the
   * returned descriptor in app-local storage; the wallet stores the private key.
   */
  createSigningSession(
    options: ThruSigningSessionCreateOptions,
  ): Promise<ThruSigningSession>;

  /**
   * Prepare a temporary signing-session authority instruction without asking
   * for passkey approval. The returned instruction must be included in a
   * later passkey-approved transaction before the session can sign.
   */
  createSigningSessionInstruction(
    options: ThruSigningSessionInstructionCreateOptions,
  ): Promise<ThruSigningSessionInstruction>;

  /**
   * Confirm that a prepared signing-session instruction landed on-chain and
   * publish the resulting session descriptor into SDK storage.
   */
  confirmSigningSession(id: string): Promise<ThruSigningSession>;

  /** Return a locally known signing session by id. */
  getSigningSession(id: string): Promise<ThruSigningSession | null>;

  /** Return locally known signing sessions for this SDK app scope only. */
  getSigningSessions(): Promise<ThruSigningSession[]>;

  /** Delete a locally known session and ask the wallet to delete its key. */
  revokeSigningSession(id: string): Promise<void>;
}
