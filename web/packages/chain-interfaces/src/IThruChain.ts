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
   * Sign a serialized Thru transaction payload (base64 string) and return the
   * signed payload encoded as base64.
   */
  signTransaction(serializedTransaction: string): Promise<string>;
}
