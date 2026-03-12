import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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

  /** Forward send-block stderr to console */
  verbose?: boolean;

  /** Wait for consensus vote before returning (paces by finalization) */
  waitForVote?: boolean;

  /** Timeout in ms waiting for vote per block (default 30s) */
  voteTimeoutMs?: number;

  /** Use bprot UDP protocol instead of BTP (for sequencer nodes) */
  sequencerMode?: boolean;
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

  /** Append --wait-for-vote and --vote-timeout flags if configured. */
  private appendVoteArgs(args: string[]): void {
    if (this.config.waitForVote) {
      args.push("--wait-for-vote");
      if (this.config.voteTimeoutMs !== undefined) {
        args.push("--vote-timeout", this.config.voteTimeoutMs.toString());
      }
    }
  }

  /** Append --sequencer-mode flag if configured. */
  private appendSequencerArgs(args: string[]): void {
    if (this.config.sequencerMode) {
      args.push("--sequencer-mode");
    }
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
    this.appendVoteArgs(args);
    this.appendSequencerArgs(args);

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
    this.appendVoteArgs(args);
    this.appendSequencerArgs(args);

    return this.runSendBlock(args, transactions);
  }

  /**
   * Send multiple blocks over a single BTP connection.
   * Writes a temp JSON file and spawns one send-block --blocks-file process.
   */
  async sendMultipleBlocks(
    blocks: Array<{ transactions: Uint8Array[] }>,
    options?: { pauseMs?: number }
  ): Promise<SendBlockResult[]> {
    const pauseMs = options?.pauseMs ?? 1000;
    const payload = {
      blocks: blocks.map((block, i) => ({
        slot: Number(this.nextStartSlot + BigInt(i)),
        transactions: block.transactions.map((tx) =>
          Buffer.from(tx).toString("base64")
        ),
      })),
      pause_ms: pauseMs,
    };
    this.nextStartSlot += BigInt(blocks.length);

    const tempPath = join(
      tmpdir(),
      `send-blocks-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    writeFileSync(tempPath, JSON.stringify(payload));

    try {
      const args = [
        "--producer-key",
        this.config.producerKey,
        "--blocks-file",
        tempPath,
        "--target",
        this.config.target,
        "--grpc",
        this.config.grpcEndpoint,
      ];

      if (this.config.chainId !== undefined) {
        args.push("--chain-id", this.config.chainId.toString());
      }
      this.appendVoteArgs(args);
      this.appendSequencerArgs(args);

      return await this.runSendBlockMulti(args, blocks.length, pauseMs);
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  /**
   * Run the send-block process with the given arguments and transactions.
   *
   * send-block prints output (slot=, transactions=) before its BTP disconnect,
   * which can hang. We resolve as soon as stdout contains both lines — the
   * block is already sent and SACKed at that point. The process is left
   * running for a normal exit; a 30s hard-kill prevents zombie accumulation.
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
      let settled = false;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      // Hard kill if the process hangs beyond the grace period.
      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, 30_000);

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        // Resolve as soon as we have both output lines. The block has
        // already been sent and SACKed by this point.
        if (stdout.includes("slot=") && stdout.includes("transactions=")) {
          const result = this.parseOutput(stdout, transactions.length);
          settle(() => resolve(result));
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (this.config.verbose) {
          process.stderr.write(`[send-block] ${chunk}`);
        }
      });

      proc.on("error", (err) => {
        clearTimeout(killTimer);
        settle(() => reject(new Error(`Failed to spawn send-block: ${err.message}`)));
      });

      proc.on("close", (code) => {
        clearTimeout(killTimer);
        if (code !== 0 && code !== null) {
          settle(() => reject(new Error(`send-block exited with code ${code}: ${stderr}`)));
          return;
        }
        // Process exited normally or was killed after we got output
        const result = this.parseOutput(stdout, transactions.length);
        settle(() => resolve(result));
      });

      // Handle stdin errors (e.g. EPIPE if send-block dies before we write)
      proc.stdin.on("error", (err) => {
        clearTimeout(killTimer);
        settle(() => reject(new Error(`send-block stdin error: ${err.message}\nstderr: ${stderr}`)));
      });

      // Write transactions to stdin and close
      proc.stdin.write(stdin);
      proc.stdin.end();
    });
  }

  private parseOutput(stdout: string, fallbackTxCount: number): SendBlockResult {
    const slotMatch = stdout.match(/slot=(\d+)/);
    const txMatch = stdout.match(/transactions=(\d+)/);
    const slot = slotMatch ? BigInt(slotMatch[1]) : 0n;
    const transactionCount = txMatch ? parseInt(txMatch[1], 10) : fallbackTxCount;
    return { slot, transactionCount };
  }

  /**
   * Run send-block in multi-block mode (--blocks-file). No stdin needed.
   * Resolves when all expected output lines are received.
   */
  private async runSendBlockMulti(
    args: string[],
    expectedBlocks: number,
    pauseMs: number = 1000
  ): Promise<SendBlockResult[]> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.sendBlockPath, args);
      let stdout = "";
      let stderr = "";
      let settled = false;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      // Scale timeout: 30s base + pause per block, max 10 minutes
      const killTimeout = Math.min(30_000 + expectedBlocks * (pauseMs + 500), 600_000);
      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, killTimeout);

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        const results = this.parseMultiBlockOutput(stdout);
        if (results.length >= expectedBlocks) {
          settle(() => resolve(results));
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (this.config.verbose) {
          process.stderr.write(`[send-block] ${chunk}`);
        }
      });

      proc.on("error", (err) => {
        clearTimeout(killTimer);
        settle(
          () =>
            reject(new Error(`Failed to spawn send-block: ${err.message}`))
        );
      });

      proc.on("close", (code) => {
        clearTimeout(killTimer);
        if (code !== 0 && code !== null) {
          settle(
            () =>
              reject(
                new Error(`send-block exited with code ${code}: ${stderr}`)
              )
          );
          return;
        }
        const results = this.parseMultiBlockOutput(stdout);
        settle(() => resolve(results));
      });

      // Close stdin — multi-block mode reads from file, not stdin
      proc.stdin.end();
    });
  }

  private parseMultiBlockOutput(stdout: string): SendBlockResult[] {
    const results: SendBlockResult[] = [];
    const lines = stdout.split("\n");
    for (const line of lines) {
      const slotMatch = line.match(/slot=(\d+)/);
      const txMatch = line.match(/transactions=(\d+)/);
      if (slotMatch && txMatch) {
        results.push({
          slot: BigInt(slotMatch[1]),
          transactionCount: parseInt(txMatch[1], 10),
        });
      }
    }
    return results;
  }
}
