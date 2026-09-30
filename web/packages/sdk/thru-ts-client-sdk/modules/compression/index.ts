import type { ThruClientContext } from '../../core/client';
import { Pubkey } from '../../domain/primitives';
import { CompressionSession, type SubmissionState, type WorkflowOptions, type SessionOptions, type ReconcileOptions } from './session';
import { compressionInstructions } from './instructions';
import { getAccountStatuses } from './status';
import * as workflows from './workflows';
import { CompressionError, type DecompressionOptions, type KeypairCompressionOptions, type UploadCleanup } from './types';
export { CompressionError } from './types';
export type { CompressionErrorCode, CompressionOptions, KeypairCompressionOptions, WalletCompressionOptions, DecompressionOptions,
  CompressionResult, AccountOutcome, UploadCleanup, CompressionJournal, PendingCompressionTransaction } from './types';
export type { AccountCompressionStatus } from './status';

export function createCompressionModule(ctx: ThruClientContext) {
  const payers = new Map<string, SubmissionState>();
  function run<T>(options: SessionOptions, fn: (operation: WorkflowOptions) => Promise<T>): Promise<T> {
    const key = Pubkey.from(options.feePayer.publicKey).toThruFmt();
    let state = payers.get(key);
    if (!state) { state = { loaded: false, tail: Promise.resolve() }; payers.set(key, state); }
    const current = state;
    const next = current.tail.then(async () => {
      if (options.journal && current.journal !== options.journal) {
        if (current.pending) throw new CompressionError('TRANSACTION_UNCERTAIN', 'Reconcile the existing journal before changing it', { signature: current.pending.signature });
        current.journal = options.journal;
        current.loaded = false;
      }
      const session = new CompressionSession(ctx, options, current);
      await session.reconcilePending(options.signal);
      return fn({ ...options, session, programs: compressionInstructions(options.programAddresses ?? {}) });
    });
    current.tail = next.catch(() => undefined);
    return next;
  }
  return {
    getAccountStatuses: (options: { accounts: readonly string[]; signal?: AbortSignal }) => getAccountStatuses(ctx, options),
    decompressAccounts: (options: DecompressionOptions & { accounts: readonly string[] }) =>
      run(options, operation => workflows.decompressAccounts({ ...operation, accounts: options.accounts })),
    compressAccount: (options: KeypairCompressionOptions & { account: string }) =>
      run(options, operation => workflows.compressAccount({ ...operation, account: options.account })),
    cleanupUploads: (options: DecompressionOptions & { uploads: UploadCleanup[] }) =>
      run(options, operation => workflows.cleanupUploads({ ...operation, uploads: options.uploads })),
    reconcilePending: (options: ReconcileOptions) =>
      // Reconciliation only reads chain/journal state. No signing key is used.
      run(options, async () => {}),
  };
}
export type CompressionModule = ReturnType<typeof createCompressionModule>;
