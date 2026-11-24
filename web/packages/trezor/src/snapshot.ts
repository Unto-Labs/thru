/**
 * Copies of what a caller hands to an asynchronous call (plan B5): the call
 * reads its arguments once, when it is made, and uses only the copies for the
 * preview, the request, the verification and the storage. A caller may go on
 * to change its arrays (a `Buffer` is a view, and so is anything cut from one
 * with `slice`) or its options object while the call awaits the device, a
 * network request or the person.
 */
import type { TokenHint } from '@thru/ledger/protocol';
import type { BuildTransactionOptions } from '@thru/sdk';

import { copyBytes } from './bytes';

/**
 * `value` as memory of its own when it is bytes; as it is otherwise (text and
 * functions cannot be changed through a reference, and anything else is left
 * for the check that follows to refuse). For positions that hold bytes and
 * nothing else: instruction data, the parts of a token hint.
 */
function ownBytes<T>(value: T): T {
  if (value instanceof Uint8Array) return copyBytes(value) as unknown as T;
  return value;
}

/**
 * As {@link ownBytes}, for a public key: also the copy of the bytes of an SDK
 * `Pubkey` (its `toBytesUnsafe()` hands out the storage it keeps, so the
 * object itself is not kept). A `Pubkey` is recognized by its `toBytes`, not by
 * its class: an application may hold a second copy of the SDK.
 */
function ownKey<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !(value instanceof Uint8Array) && typeof (value as { toBytes?: unknown }).toBytes === 'function') {
    return copyBytes((value as unknown as { toBytes(): Uint8Array }).toBytes()) as unknown as T;
  }
  return ownBytes(value);
}

/** A token hint (its 129 bytes, or the object they are made from) with every array copied. */
export function snapshotTokenHint(hint: TokenHint | Uint8Array | undefined): TokenHint | Uint8Array | undefined {
  if (hint === undefined) return undefined;
  if (hint instanceof Uint8Array) return copyBytes(hint);
  return {
    mint: ownBytes(hint.mint),
    recipientOwner: ownBytes(hint.recipientOwner),
    recipientSeed: ownBytes(hint.recipientSeed),
    sourceSeed: ownBytes(hint.sourceSeed),
  };
}

/**
 * The transaction to build, without its fee payer, with every array and every
 * object the builder reads copied: the SDK reads them after it has fetched the
 * header, which is after the caller's call has returned control.
 */
export function snapshotBuild(build: Omit<BuildTransactionOptions, 'feePayer'>): Omit<BuildTransactionOptions, 'feePayer'> {
  const out: Omit<BuildTransactionOptions, 'feePayer'> = { ...build, program: ownKey(build.program) };
  if (build.header !== undefined) out.header = { ...build.header };
  if (build.accounts !== undefined) {
    out.accounts = { ...build.accounts };
    if (build.accounts.readWrite !== undefined) out.accounts.readWrite = build.accounts.readWrite.map(ownKey);
    if (build.accounts.readOnly !== undefined) out.accounts.readOnly = build.accounts.readOnly.map(ownKey);
  }
  if (build.instructionData !== undefined) out.instructionData = ownBytes(build.instructionData);
  if (build.feePayerStateProof !== undefined) out.feePayerStateProof = copyBytes(build.feePayerStateProof);
  if (build.feePayerAccountMetaRaw !== undefined) out.feePayerAccountMetaRaw = copyBytes(build.feePayerAccountMetaRaw);
  return out;
}
