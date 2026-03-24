import type { ThruSigningContext } from "./types";

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
   * through an embedded manager profile.
   */
  getSigningContext(): Promise<ThruSigningContext>;

  /**
   * Sign a serialized Thru transaction (base64 string) and return canonical
   * raw transaction bytes encoded as base64.
   *
   * Implementations may accept either:
   * - signing payload bytes produced by `Transaction.toWireForSigning()`
   * - raw transaction bytes produced by `Transaction.toWire()`
   *
   * The returned bytes are always safe for direct submission via the supported
   * RPC path without any app-side wire reordering.
   */
  signTransaction(serializedTransaction: string): Promise<string>;
}
