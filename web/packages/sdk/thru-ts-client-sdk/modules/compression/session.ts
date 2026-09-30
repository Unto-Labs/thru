import { Code, ConnectError } from '@connectrpc/connect';
import type { ThruClientContext } from '../../core/client';
import { AccountView, StateProofType, TransactionVmError } from '@thru/sdk/proto';
import { Pubkey, Signature } from '../../domain/primitives';
import { Transaction } from '../../domain/transactions/Transaction';
import { buildTransaction, buildAndSignTransaction, sendTransaction, getTransactionStatus, type BuildTransactionOptions } from '../transactions';
import { getAccount } from '../accounts';
import { getBlockHeight } from '../height';
import { generateStateProof, generateStateProofs, getStateRoots } from '../proofs';
import { cancelled, readAccount } from './accounts';
import { signWalletRequest, measureWalletRequest } from './wallet';
import { compressionInstructions } from './instructions';
import { CompressionError, type CompressionOptions, type DecompressionOptions, type CompressionTransaction, type CompressionJournal, type PendingCompressionTransaction } from './types';
function notFound(error: unknown): boolean { return error instanceof ConnectError && error.code === Code.NotFound; }
function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
export type ReconcileOptions = Pick<CompressionOptions, 'journal' | 'signal'> & {
  feePayer: Pick<KeypairFeePayer, 'publicKey'>;
  walletAddress?: never;
  signTransaction?: never;
};
type KeypairFeePayer = import('../transactions').BuildAndSignTransactionOptions['feePayer'];
export type SessionOptions = DecompressionOptions | (CompressionOptions & ReconcileOptions);
export interface SubmissionState {
  pending?: PendingCompressionTransaction;
  loaded: boolean;
  journal?: CompressionJournal;
  tail: Promise<unknown>;
}
export interface WorkflowOptions extends DecompressionOptionsBase {
  session: CompressionSession;
  programs: ReturnType<typeof compressionInstructions>;
}
type DecompressionOptionsBase = Omit<DecompressionOptions, 'feePayer' | 'walletAddress' | 'signTransaction'>;
// These outcomes occur after the pinned runtime's nonce advancement. Format,
// expiry, missing-payer and nonce rejections do not advance it.
const ADVANCES_NONCE = new Set<number>([
  TransactionVmError.TRANSACTION_VM_EXECUTE_SUCCESS,
  TransactionVmError.TRANSACTION_VM_ERROR_INSUFFICIENT_FEE_PAYER_BALANCE,
  TransactionVmError.TRANSACTION_VM_ERROR_VM_FAILED,
  TransactionVmError.TRANSACTION_VM_ERROR_INVALID_PROGRAM_ACCOUNT,
  TransactionVmError.TRANSACTION_VM_ERROR_VM_REVERT,
  TransactionVmError.TRANSACTION_VM_ERROR_CU_EXHAUSTED,
  TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED,
]);


/** Private concrete operation. RPC, building and sending use the SDK directly. */
export class CompressionSession {
  readonly feePayer: string;
  readonly authority: string;
  readonly wallet: boolean;
  readonly fee: bigint;
  readonly timeout: number;
  readonly interval: number;
  constructor(readonly ctx: ThruClientContext, readonly options: SessionOptions,
    readonly state: SubmissionState) {
    this.feePayer = Pubkey.from(options.feePayer.publicKey).toThruFmt();
    this.wallet = options.walletAddress !== undefined;
    this.authority = options.walletAddress ?? this.feePayer;
    this.fee = options.fee ?? (this.wallet ? 0n : 1n);
    this.timeout = options.timeoutMs ?? 60_000;
    this.interval = options.pollIntervalMs ?? 250;
    if (typeof this.fee !== 'bigint' || this.fee < 0n || this.fee > 0xffffffffffffffffn)
      throw new RangeError('fee must be an unsigned 64-bit bigint');
    if (this.wallet && this.fee !== 0n) throw new RangeError('Wallet intents currently support zero-fee transactions only');
    if (!Number.isFinite(this.timeout) || this.timeout <= 0 || !Number.isFinite(this.interval) || this.interval <= 0)
      throw new RangeError('timeoutMs and pollIntervalMs must be positive');
  }
  current(address: string, signal?: AbortSignal) { return readAccount(this.ctx, address, false, signal); }
  historical(address: string, signal?: AbortSignal) { return readAccount(this.ctx, address, true, signal); }
  async slot(signal?: AbortSignal) { cancelled(signal); return (await getBlockHeight(this.ctx)).locallyExecuted; }
  async proof(address: string, kind: 'creating' | 'updating' | 'existing', signal?: AbortSignal) {
    cancelled(signal);
    const proofType = kind === 'existing' ? StateProofType.EXISTING : kind === 'creating' ? StateProofType.CREATING : StateProofType.UPDATING;
    return (await generateStateProof(this.ctx, { address, proofType })).proof;
  }
  async proofs(addresses: readonly string[], kind: 'creating' | 'updating' | 'existing', signal?: AbortSignal) {
    cancelled(signal);
    const proofType = kind === 'existing' ? StateProofType.EXISTING : kind === 'creating' ? StateProofType.CREATING : StateProofType.UPDATING;
    const outcomes = await generateStateProofs(this.ctx, { requests: addresses.map(address => ({ address, proofType })), signal });
    return outcomes.map((outcome, index) => {
      if (outcome.error) throw new CompressionError('RPC_ERROR', 'State proof unavailable', { address: addresses[index], cause: outcome.error });
      return outcome.proof.proof;
    });
  }
  private buildOptions(request: CompressionTransaction, measure: boolean, nonce?: bigint): BuildTransactionOptions {
    return { feePayer: this.options.feePayer, program: request.program,
      accounts: { readWrite: request.readWrite, readOnly: request.readOnly },
      header: { fee: this.fee, stateUnits: request.stateUnits, computeUnits: request.computeUnits,
        memoryUnits: 10_000, expiryAfter: 128, flags: request.flags,
        ...(measure ? { nonce: 0n, startSlot: 0n, chainId: 1 } : { nonce }) },
      instructionData: async context => request.instructionData({
        getAccountIndex: address => context.getAccountIndex(address),
        instructionDataOffset: 112 + 32 * (context.accounts.length - 2),
      }),
    };
  }
  async measure(request: CompressionTransaction): Promise<number> {
    if (this.options.walletAddress !== undefined) return measureWalletRequest(request, this.options);
    return (await buildTransaction(this.ctx, this.buildOptions(request, true))).toWire().length;
  }
  private async sign(request: CompressionTransaction, nonce: bigint): Promise<Uint8Array> {
    if (this.options.walletAddress !== undefined) return signWalletRequest(this.ctx, request, this.options, nonce);
    if (!('privateKey' in this.options.feePayer) || !this.options.feePayer.privateKey)
      throw new Error('Fee payer private key is required to sign the transaction');
    const result = await buildAndSignTransaction(this.ctx, { ...this.buildOptions(request, false, nonce),
      feePayer: { ...this.options.feePayer, privateKey: this.options.feePayer.privateKey } });
    return result.rawTransaction;
  }
  private async clearPending(): Promise<void> {
    await this.state.journal?.save(undefined);
    this.state.pending = undefined;
  }
  private async reconcile(): Promise<{ vmError: number; userErrorCode: bigint } | "expired" | undefined> {
    if (!this.state.pending) return undefined;
    let result: { vmError: number; userErrorCode: bigint } | undefined;
    try {
      result = (await getTransactionStatus(this.ctx, this.state.pending.signature)).executionResult;
    } catch (error) {
      if (!notFound(error)) throw error;
    }
    if (result) {
      const payer = await getAccount(this.ctx, this.feePayer, { view: AccountView.META_ONLY });
      // Wait for account indexing too, so the next build does not reuse a stale nonce.
      if (ADVANCES_NONCE.has(result.vmError) && (payer.meta?.nonce ?? 0n) <= this.state.pending.nonce) return undefined;
      await this.clearPending();
      return result;
    }
    if ((await getBlockHeight(this.ctx)).finalized <= this.state.pending.validUntilSlot) return undefined;
    // GetHeight is an observation clock. State roots are bounded by the RPC's
    // durable export frontier; wait for it before trusting an unchanged nonce.
    const { stateRoots } = await getStateRoots(this.ctx);
    if (!stateRoots.some(root => root.slot > this.state.pending!.validUntilSlot)) return undefined;
    const payer = await getAccount(this.ctx, this.feePayer, { view: AccountView.META_ONLY });
    // An advanced nonce can mean committed work whose status is still missing.
    // Keep its signature until the actual result arrives, never infer failure.
    if (!payer.meta || payer.meta.flags.isCompressed || payer.meta.flags.isDeleted ||
        payer.meta.nonce !== this.state.pending.nonce) return undefined;
    await this.clearPending();
    return "expired";
  }

  async reconcilePending(signal?: AbortSignal): Promise<void> {
    cancelled(signal);
    if (!this.state.loaded) {
      this.state.pending = await this.state.journal?.load();
      this.state.loaded = true;
    }
    if (this.state.pending) {
      await this.reconcile();
      if (this.state.pending) throw new CompressionError("TRANSACTION_UNCERTAIN",
        "Previous submission is unresolved; reconcile its signature before reusing this payer", { signature: this.state.pending.signature });
    }
    cancelled(signal);
  }
  async execute(request: CompressionTransaction, signal?: AbortSignal): Promise<string> {
    await this.reconcilePending(signal);
    const payer = await getAccount(this.ctx, this.feePayer, { view: AccountView.META_ONLY });
    if (!payer.meta || payer.meta.flags.isCompressed || payer.meta.flags.isDeleted)
      throw new CompressionError("MISSING_ACCOUNT", "Compression prerequisites require an active funded fee payer", { address: this.feePayer });
    const nonce = payer.meta.nonce ?? 0n;
    cancelled(signal);
    const signed = await this.sign(request, nonce);
    const unsigned = Transaction.fromWire(signed);
    const signatureBytes = signed.slice(-64);
    if (!signatureBytes.some(byte => byte !== 0)) throw new Error("Signer returned an unsigned transaction");
    const signature = Signature.from(signatureBytes).toThruFmt();
    cancelled(signal);
    this.state.pending = { signature, nonce, validUntilSlot: unsigned.startSlot + BigInt(unsigned.expiryAfter) };
    await this.state.journal?.save(this.state.pending);
    if (signal?.aborted) {
      await this.clearPending(); // Definitely not sent yet.
      cancelled(signal);
    }
    const deadline = Date.now() + this.timeout;
    let submissionError: unknown;
    try { await sendTransaction(this.ctx, signed); }
    catch (error) { submissionError = error; }
    // Even a failed transport response may have submitted the transaction. Never blindly resend it.
    while (Date.now() < deadline) {
      try {
        const execution = await this.reconcile();
        if (execution) {
          if (execution === "expired") throw new CompressionError("TRANSACTION_FAILED",
            "Transaction validity window durably finalized without consuming its payer nonce", { signature });
          if (execution.vmError !== 0 || execution.userErrorCode !== 0n)
            throw new CompressionError("TRANSACTION_FAILED", "Compression prerequisite execution failed",
              { signature, vmError: execution.vmError, userErrorCode: execution.userErrorCode });
          return signature;
        }
      } catch (error) {
        if (error instanceof CompressionError) throw error;
        submissionError = error;
      }
      if (signal?.aborted) break;
      await pause(this.interval);
    }
    throw new CompressionError("TRANSACTION_UNCERTAIN", "Submission outcome is not confirmed; retain its signature for recovery",
      { signature, cause: submissionError });
  }

}
