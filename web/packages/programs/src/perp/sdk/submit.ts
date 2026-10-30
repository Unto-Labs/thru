import { forgetAccountStatuses, noteAccountsActive, prefetchAccountStatuses, restoreArchivedAccounts, type RestoreSigner } from './compression';
import { isNonceReject } from './errors';
import { normalizeAddress, type ThruClient } from './rpc';
import { sendAndConfirm, type SendAndConfirmOptions } from './send';
import type { PerpsSigner } from './signers';
import type { PerpTxParts } from './tx';

/* The one path a perp transaction takes from parts to an executed
   signature: PerpsClient.send, the perps tools and the demo UI all go
   through it.

   - Before signing: the signer's own reads (a keypair signer's header
     fields: nonce, start slot, chain id), the caller's chain check and,
     with `archived`, the compression status reads of every account the
     transaction touches all run in parallel; only signing waits for them.
     A restore of archived accounts (which signs) waits for the chain check.
   - A restore that sent a transaction from the signer moved its nonce, so
     the header is read again.
   - Sending: sendAndConfirm, which never re-signs and only ever resends the
     identical bytes.
   - A transaction signed on a cached nonce that the runtime rejects as
     stale (it did not execute) is signed once more on a freshly read nonce;
     anything else is thrown.
   - With `archived`: an executed transaction refreshes the cached status
     of every account it touched (a steady sender then reads none), a failed
     one drops them (one may have been archived since). */

export interface PerpArchivedOptions {
  /** Signs and pays for the restore: the transaction's own key or wallet. */
  signer: RestoreSigner;
  /** Accounts never checked (program accounts, which are not archived);
      the transaction's program is always skipped. */
  skip?: readonly string[];
  /** Called once, before the restore is signed. */
  onRestoring?: (addresses: string[]) => void;
  /** Budget for the restore to confirm (default 30 s). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PerpSubmitOptions extends SendAndConfirmOptions {
  /** Resolves when the RPC is the expected chain (e.g. a chain id check
      over rpcChainId); throws to block the transaction. Nothing is signed
      before it resolved. */
  checkChain?: () => Promise<void>;
  /** Restore archived accounts the transaction touches before signing it. */
  archived?: PerpArchivedOptions;
}

export interface PerpSubmitRequest {
  programAddress: string;
  tx: PerpTxParts & { label?: string };
  /** Default: the transaction's label. */
  label?: string;
}

function restoreSignerAccounts(signer: RestoreSigner): string[] {
  return signer.kind === 'keypair' ? [signer.publicKey] : [signer.feePayer, signer.walletAddress];
}

/** Signs `request.tx` with `signer`, sends it and resolves with its
    signature once it executed (TransactionFailedError otherwise). */
export async function submitPerpTransaction(
  thru: ThruClient,
  signer: PerpsSigner,
  request: PerpSubmitRequest,
  options: PerpSubmitOptions = {},
): Promise<string> {
  const { programAddress } = request;
  const label = request.label ?? request.tx.label ?? 'perp transaction';
  const tx = { ...request.tx, label };
  const { checkChain, archived, ...sendOptions } = options;
  const accounts = [...tx.readWrite, ...tx.readOnly];
  const skip = archived ? [programAddress, ...(archived.skip ?? [])] : [];
  const touched = archived ? [...restoreSignerAccounts(archived.signer), ...accounts] : [];

  signer.prepare?.(thru);
  if (archived) prefetchAccountStatuses(thru, touched, skip);
  const ready = (checkChain ? checkChain() : Promise.resolve()).then(async () => {
    if (!archived) return false;
    const { signatures } = await restoreArchivedAccounts(thru, {
      accounts,
      skip,
      signer: archived.signer,
      ...(archived.onRestoring ? { onRestoring: archived.onRestoring } : {}),
      ...(archived.timeoutMs !== undefined ? { timeoutMs: archived.timeoutMs } : {}),
      ...(archived.signal ? { signal: archived.signal } : {}),
    });
    return signatures.length > 0;
  });
  let moved: boolean;
  try {
    moved = await ready;
  } catch (error) {
    signer.invalidate?.(thru);
    throw error;
  }
  if (moved) signer.invalidate?.(thru);

  const attempt = async (fresh: boolean): Promise<string> => {
    const signed = await signer.sign({ thru, programAddress, tx, fresh });
    try {
      const signature = await sendAndConfirm(thru, signed.raw, label, sendOptions);
      signed.confirmed?.();
      if (archived) {
        const skipped = new Set(skip.map(normalizeAddress));
        noteAccountsActive(thru, touched.filter((address) => !skipped.has(normalizeAddress(address))));
      }
      return signature;
    } catch (error) {
      signed.failed?.();
      if (archived) forgetAccountStatuses(thru, touched);
      if (signed.nonceCached && !fresh && isNonceReject(error)) return attempt(true);
      throw error;
    }
  };
  return attempt(moved);
}
