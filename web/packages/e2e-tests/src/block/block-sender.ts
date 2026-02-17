import { spawn } from "child_process";

export interface BlockSenderConfig {
  /** Path to send-block binary */
  sendBlockPath: string;

  /** Block producer key (32-byte Ed25519 seed, hex encoded) */
  producerKey: string;

  /** Block builder BTP endpoint */
  target: string;

  /** gRPC endpoint for auto-slot */
  grpcEndpoint: string;

  /** Chain ID for transactions */
  chainId?: number;
}

export interface SendBlockOptions {
  bondAmount?: bigint;
  attestorPayment?: bigint;
}

export interface SendBlockResult {
  slot: bigint;
  transactionCount: number;
}

/**
 * BlockSender wraps the send-block CLI for sending transactions as blocks.
 * TypeScript tests spawn this process to submit blocks to the network.
 */
export class BlockSender {
  private config: BlockSenderConfig;
  private nextStartSlot: bigint = 0n;

  constructor(config: BlockSenderConfig) {
    this.config = config;
  }

  /**
   * Seed the local slot counter from the current finalized height.
   * Must be called before sendAsBlock().
   */
  seedSlot(finalized: bigint): void {
    this.nextStartSlot = finalized + 1n;
  }

  /**
   * Send transactions as a block with a locally-incremented start slot.
   * Uses --slot instead of --auto-slot to avoid duplicate start_slot when
   * sending blocks faster than the chain finalizes.
   */
  async sendAsBlock(transactions: Uint8Array[], options?: SendBlockOptions): Promise<SendBlockResult> {
    const slot = this.nextStartSlot++;
    return this.sendBlockAtSlot(transactions, slot, options);
  }

  /**
   * Send transactions as a block with auto-slot.
   */
  async sendBlockWithAutoSlot(
    transactions: Uint8Array[],
    options?: SendBlockOptions
  ): Promise<SendBlockResult> {
    const args = [
      "--producer-key",
      this.config.producerKey,
      "--auto-slot",
      "--target",
      this.config.target,
      "--grpc",
      this.config.grpcEndpoint,
    ];

    if (this.config.chainId !== undefined) {
      args.push("--chain-id", this.config.chainId.toString());
    }
    if (options?.bondAmount !== undefined) {
      args.push("--bond-amount", options.bondAmount.toString());
    }
    if (options?.attestorPayment !== undefined) {
      args.push("--attestor-payment", options.attestorPayment.toString());
    }

    return this.runSendBlock(args, transactions);
  }

  /**
   * Send transactions as a block at a specific slot.
   */
  async sendBlockAtSlot(
    transactions: Uint8Array[],
    slot: bigint,
    options?: SendBlockOptions
  ): Promise<SendBlockResult> {
    const args = [
      "--producer-key",
      this.config.producerKey,
      "--slot",
      slot.toString(),
      "--target",
      this.config.target,
      "--grpc",
      this.config.grpcEndpoint,
    ];

    if (this.config.chainId !== undefined) {
      args.push("--chain-id", this.config.chainId.toString());
    }
    if (options?.bondAmount !== undefined) {
      args.push("--bond-amount", options.bondAmount.toString());
    }
    if (options?.attestorPayment !== undefined) {
      args.push("--attestor-payment", options.attestorPayment.toString());
    }

    return this.runSendBlock(args, transactions);
  }

  /**
   * Run the send-block process with the given arguments and transactions.
   */
  private async runSendBlock(args: string[], transactions: Uint8Array[]): Promise<SendBlockResult> {
    // Build stdin: length-prefixed transactions
    // Format: <4-byte little-endian length><transaction bytes>...
    const chunks: Buffer[] = [];
    for (const tx of transactions) {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(tx.length, 0);
      chunks.push(lenBuf);
      chunks.push(Buffer.from(tx));
    }
    const stdin = Buffer.concat(chunks);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.sendBlockPath, args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn send-block: ${err.message}`));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`send-block exited with code ${code}: ${stderr}`));
          return;
        }

        // Parse output: "slot=123\ntransactions=5"
        const slotMatch = stdout.match(/slot=(\d+)/);
        const txMatch = stdout.match(/transactions=(\d+)/);

        const slot = slotMatch ? BigInt(slotMatch[1]) : 0n;
        const transactionCount = txMatch ? parseInt(txMatch[1], 10) : transactions.length;

        resolve({ slot, transactionCount });
      });

      // Write transactions to stdin and close
      proc.stdin.write(stdin);
      proc.stdin.end();
    });
  }
}
