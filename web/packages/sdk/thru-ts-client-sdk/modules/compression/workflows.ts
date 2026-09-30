import type { WorkflowOptions } from './session';
import { CompressionError, type AccountImage,
  type CompressionResult, type CompressionTransaction, type Instruction,
  type UploadCleanup, type UploadPair } from "./types";
import { lookupAccount } from "./status";

const MAX_DATA = 16 * 1024 * 1024;
const MAX_WIRE = 32_768;
const COOLDOWN = 384n;
const CHUNK = 30_000;
const result = (): CompressionResult => ({ accounts: [], signatures: [], uploads: [] });

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompressionError("CANCELLED", "Compression operation cancelled");
}

function checkedLimit(options: WorkflowOptions): number {
  const limit = options.maxTransactionBytes ?? MAX_WIRE;
  if (!Number.isInteger(limit) || limit < 512 || limit > MAX_WIRE)
    throw new RangeError(`maxTransactionBytes must be between 512 and ${MAX_WIRE}`);
  return limit;
}

function validateImage(image: AccountImage): void {
  if (image.meta.length !== 64 || image.data.length > MAX_DATA || image.dataSize !== image.data.length ||
      new DataView(image.meta.buffer, image.meta.byteOffset, image.meta.byteLength).getUint32(4, true) !== image.data.length)
    throw new CompressionError("INVALID_IMAGE", "Malformed archived account image", { address: image.address });
}

function transaction(program: string, readWrite: string[], instructionData: Instruction,
  bytes = 0, readOnly: string[] = [], accounts = 1): CompressionTransaction {
  return { program, readWrite, readOnly, instructionData,
    // One extra unit permits fee-payer activation. Each restored account rounds separately.
    stateUnits: Math.ceil((bytes + 64 * accounts) / 4096) + accounts + 1,
    computeUnits: Math.min(500_000_000, 1_000_000 + 4 * bytes) };
}

async function execute(options: WorkflowOptions, output: CompressionResult,
  tx: CompressionTransaction, signal = options.signal): Promise<string> {
  checkAbort(signal);
  if (await options.session.measure(tx) > checkedLimit(options))
    throw new CompressionError("TRANSACTION_TOO_LARGE", "Compression prerequisite exceeds the transaction wire limit");
  try {
    const signature = await options.session.execute(tx, signal);
    output.signatures.push(signature);
    return signature;
  } catch (error) {
    if (error instanceof CompressionError && error.details.signature)
      output.signatures.push(error.details.signature);
    throw error;
  }
}

function withProgress(error: unknown, output: CompressionResult): CompressionError {
  if (error instanceof CompressionError)
    return new CompressionError(error.code, error.message, { ...error.details, result: output, cause: error });
  return new CompressionError("RPC_ERROR", error instanceof Error ? error.message : String(error),
    { result: output, cause: error });
}

/** Returns only after the target is already inactive or its compression executed. */
export async function compressAccount(options: WorkflowOptions & { account: string }): Promise<CompressionResult> {
  const output = result();
  try {
    checkAbort(options.signal);
    const account = await options.session.current(options.account, options.signal);
    if (!account) {
      output.accounts.push({ address: options.account, status: "skipped", signatures: [] });
      return output;
    }
    if (account.uncompressable || options.account === options.session.feePayer ||
        [options.programs.compression, options.programs.multicall, options.programs.uploader].includes(options.account)) {
      output.accounts.push({ address: options.account, status: "skipped", signatures: [] });
      return output;
    }
    // Runtime requires CREATING for NEW accounts and UPDATING after restoration.
    // A missing updating proof is not permission to switch proof kinds.
    const proof = account.ephemeral ? new Uint8Array(40) :
      await options.session.proof(options.account, account.isNew ? "creating" : "updating", options.signal);
    const request = transaction(options.programs.compression,
      [options.account], options.programs.compress(options.account, proof), account.dataSize);
    // Compression frees active state; the session requires an active fee payer.
    request.stateUnits = 0;
    request.flags = 2; // TN_TXN_FLAG_MAY_COMPRESS_ACCOUNT (bit 1).
    const signature = await execute(options, output, request);
    const deleted = account.ephemeral || (account.isNew && account.dataSize === 0 && account.balance === 0n && account.nonce === 0n);
    output.accounts.push({ address: options.account, status: deleted ? "deleted" : "compressed", signatures: [signature] });
    return output;
  } catch (error) { throw withProgress(error, output); }
}

async function imageFor(options: WorkflowOptions, address: string): Promise<AccountImage | undefined> {
  checkAbort(options.signal);
  const { current, image } = await lookupAccount(options.session.ctx, options, address);
  if (current) return undefined;
  if (!image)
    throw new CompressionError("MISSING_ACCOUNT", "Account does not have a restorable image", { address });
  validateImage(image);
  if (image.slot !== undefined) {
    const retrySlot = image.slot + COOLDOWN;
    if (await options.session.slot(options.signal) < retrySlot)
      throw new CompressionError("NOT_READY", "Account is still in compression cooldown", { address, retrySlot });
  }
  return image;
}

async function pack(options: WorkflowOptions, images: AccountImage[], cached?: Map<string, Uint8Array>): Promise<CompressionTransaction> {
  const calls: Instruction[] = [];
  const proofs = cached ? images.map(image => cached.get(image.address)!) : options.session.proofs ?
    await options.session.proofs(images.map(image => image.address), "existing", options.signal) :
    await Promise.all(images.map(image => options.session.proof(image.address, "existing", options.signal)));
  if (proofs.length !== images.length || proofs.some(proof => !proof))
    throw new CompressionError("RPC_ERROR", "Batch proof response does not match the requested accounts");
  for (const [index, image] of images.entries()) {
    calls.push(options.programs.decompress(image.address, image, proofs[index]!));
  }
  return transaction(images.length === 1 ? options.programs.compression : options.programs.multicall,
    images.map(image => image.address), images.length === 1 ? calls[0]! : options.programs.batch(calls),
    images.reduce((n, image) => n + image.data.length, 0),
    images.length === 1 ? [] : [options.programs.compression], images.length);
}

async function restoreBatch(options: WorkflowOptions, output: CompressionResult, images: AccountImage[]): Promise<void> {
  if (!images.length) return;
  try {
    const signature = await execute(options, output, await pack(options, images));
    for (const image of images)
      output.accounts.push({ address: image.address, status: "restored", signatures: [signature] });
  } catch (error) {
    if (!(error instanceof CompressionError) || error.code !== "TRANSACTION_FAILED") throw error;
    // Another caller may have restored a member, causing this entire atomic batch to fail.
    const remaining: AccountImage[] = [];
    for (const image of images) {
      if (await options.session.current(image.address, options.signal))
        output.accounts.push({ address: image.address, status: "active", signatures: [] });
      else remaining.push(image);
    }
    if (remaining.length === images.length) throw error;
    // Retry only after observing actual progress, so the recursion is bounded by account count.
    await restoreBatch(options, output, remaining);
  }
}

async function upload(options: WorkflowOptions, output: CompressionResult, bytes: Uint8Array): Promise<UploadPair> {
  checkAbort(options.signal);
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  const pair = options.programs.deriveUpload(seed);
  // Register before submission: even a timeout creating the buffer must expose recovery handles.
  output.uploads.push({ ...pair, uploader: options.programs.uploader, status: "pending" });
  await execute(options, output, transaction(options.programs.uploader, [pair.meta, pair.buffer],
    options.programs.createUpload(pair, options.session.authority, seed, bytes.length, hash), bytes.length, [], 2));
  // Reserve room for transaction/accounts and the uploader header at a caller's lower wire limit.
  const chunkSize = Math.min(CHUNK, checkedLimit(options) - (options.session.wallet ? 2048 : 512));
  if (chunkSize < 1) throw new CompressionError("TRANSACTION_TOO_LARGE", "No room for an upload chunk");
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    const request = transaction(options.programs.uploader, [pair.meta, pair.buffer],
      options.programs.writeUpload(pair, offset, chunk), chunk.length);
    // Creation already allocated the buffer; writing does not grow active state.
    request.stateUnits = 0;
    await execute(options, output, request);
  }
  return pair;
}

/** Retry cleanup using the same funded caller/authority. Preserve returned handles on failure. */
export async function cleanupUploads(options: WorkflowOptions & { uploads: UploadCleanup[] }): Promise<CompressionResult> {
  const output = result();
  output.uploads = options.uploads.map(item => ({ ...item }));
  await options.session.reconcilePending(options.signal);
  for (const pair of output.uploads) {
    if (pair.status === "cleaned") continue;
    try {
      checkAbort(options.signal);
      const [meta, buffer] = await Promise.all([
        options.session.current(pair.meta, options.signal), options.session.current(pair.buffer, options.signal),
      ]);
      if (meta || buffer) {
        const request = transaction(pair.uploader ?? options.programs.uploader,
          [pair.meta, pair.buffer], options.programs.destroyUpload(pair));
        // Cleanup frees state and must remain possible when capacity is full.
        request.stateUnits = 0;
        await execute(options, output, request);
      }
      pair.status = "cleaned";
      delete pair.error;
    } catch (error) {
      pair.status = "failed";
      pair.error = error instanceof Error ? error.message : String(error);
    }
  }
  return output;
}

async function restoreLarge(options: WorkflowOptions, output: CompressionResult, image: AccountImage): Promise<void> {
  const firstUpload = output.uploads.length;
  let uncertain = false;
  try {
    let metaBuffer: string;
    let dataBuffer: string;
    let dataOffset: number;
    if (image.meta.length + image.data.length <= MAX_DATA) {
      const bytes = new Uint8Array(image.meta.length + image.data.length);
      bytes.set(image.meta); bytes.set(image.data, image.meta.length);
      metaBuffer = dataBuffer = (await upload(options, output, bytes)).buffer;
      dataOffset = image.meta.length;
    } else {
      metaBuffer = (await upload(options, output, image.meta)).buffer;
      dataBuffer = (await upload(options, output, image.data)).buffer;
      dataOffset = 0;
    }
    if (await options.session.current(image.address, options.signal)) {
      output.accounts.push({ address: image.address, status: "active", signatures: [] });
      return;
    }
    const proof = await options.session.proof(image.address, "existing", options.signal);
    // Wallet wrapping changes the transaction-data offset. An account pointer
    // is stable across passkey and signing-session envelope sizes.
    const proofBuffer = options.session.wallet ? (await upload(options, output, proof)).buffer : undefined;
    const signature = await execute(options, output, transaction(options.programs.compression, [image.address],
      options.programs.decompressUploaded(image.address, image, metaBuffer, dataBuffer, dataOffset, proof, proofBuffer),
      image.data.length, [...new Set([metaBuffer, dataBuffer, ...(proofBuffer ? [proofBuffer] : [])])]));
    output.accounts.push({ address: image.address, status: "restored", signatures: [signature] });
  } catch (error) {
    uncertain = error instanceof CompressionError && error.code === "TRANSACTION_UNCERTAIN";
    if (error instanceof CompressionError && error.code === "TRANSACTION_FAILED" &&
        await options.session.current(image.address, options.signal))
      output.accounts.push({ address: image.address, status: "active", signatures: [] });
    else throw error;
  } finally {
    // Do not delete staging that an uncertain restoration could still read.
    if (!uncertain) {
      const cleaned = await cleanupUploads({ ...options, signal: undefined, uploads: output.uploads.slice(firstUpload) });
      output.uploads.splice(firstUpload, cleaned.uploads.length, ...cleaned.uploads);
      output.signatures.push(...cleaned.signatures);
    }
  }
}

/** Explicit prerequisite operation. Never builds, signs or sends the application transaction. */
export async function decompressAccounts(options: WorkflowOptions & { accounts: readonly string[] }): Promise<CompressionResult> {
  const output = result();
  let batch: AccountImage[] = [];
  const packingProofs = new Map<string, Uint8Array>();
  try {
    checkedLimit(options);
    for (const address of new Set(options.accounts)) {
      const image = await imageFor(options, address);
      if (!image) {
        output.accounts.push({ address, status: "active", signatures: [] });
        continue;
      }
      // Huge images cannot fit regardless of proof size; avoid materializing a huge instruction.
      if (image.data.length + 512 > checkedLimit(options)) {
        await restoreBatch(options, output, batch); batch = [];
        await restoreLarge(options, output, image);
        continue;
      }
      packingProofs.set(image.address, await options.session.proof(image.address, "existing", options.signal));
      const candidate = [...batch, image];
      if (await options.session.measure(await pack(options, candidate, packingProofs)) <= checkedLimit(options)) {
        batch = candidate;
      } else {
        await restoreBatch(options, output, batch); batch = [];
        if (await options.session.measure(await pack(options, [image], packingProofs)) <= checkedLimit(options)) batch = [image];
        else await restoreLarge(options, output, image);
      }
    }
    await restoreBatch(options, output, batch);
    if (output.uploads.some(pair => pair.status !== "cleaned"))
      throw new CompressionError("CLEANUP_FAILED", "Accounts restored, but temporary upload cleanup needs retry");
    return output;
  } catch (error) { throw withProgress(error, output); }
}
