/** Default block builder endpoints by mode */
export const DEFAULT_BTP_ENDPOINT = "127.0.0.1:9002";
export const DEFAULT_BPROT_ENDPOINT = "127.0.0.1:11237";

export interface TestConfig {
  /** gRPC-Web endpoint (default: http://127.0.0.1:8472) */
  baseUrl: string;

  /** Block builder BTP endpoint (default: 127.0.0.1:9002) */
  blockBuilderEndpoint: string;

  /** Path to send-block binary */
  sendBlockPath: string;

  /** Block producer key (32-byte Ed25519 seed, hex encoded) */
  producerKey: string;

  /** Maximum concurrent tests (default: 1) */
  maxConcurrency: number;

  /** Per-test timeout in milliseconds (default: 5 minutes) */
  testTimeoutMs: number;

  /** Stop on first failure */
  failFast: boolean;

  /** Enable verbose logging */
  verbose: boolean;

  /** RNG seed for determinism */
  seed: bigint;

  /** Chain ID for transactions */
  chainId: number;

  /** gRPC endpoint for send-block auto-slot (default: 127.0.0.1:8472) */
  grpcEndpoint: string;

  /** Wait for consensus vote before sending next block */
  waitForVote: boolean;

  /** Timeout in ms waiting for vote per block (default: 30s) */
  voteTimeoutMs?: number;

  /** Use bprot UDP protocol instead of BTP (for sequencer nodes) */
  sequencerMode: boolean;
}

export function defaultTestConfig(): TestConfig {
  return {
    baseUrl: "http://127.0.0.1:8472",
    blockBuilderEndpoint: DEFAULT_BTP_ENDPOINT,
    sendBlockPath: "./send-block",
    producerKey: "",
    maxConcurrency: 1,
    testTimeoutMs: 5 * 60 * 1000, // 5 minutes
    failFast: false,
    verbose: false,
    seed: BigInt(Date.now()),
    chainId: 1,
    grpcEndpoint: "127.0.0.1:8472",
    waitForVote: false,
    sequencerMode: false,
  };
}
