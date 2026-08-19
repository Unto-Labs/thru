import type { Account } from "@thru/sdk";
import type { Thru } from "@thru/sdk/client";
import {
  createDestroyUploadInstruction,
  createFinalizeUploadInstruction,
  createUploadBufferInstruction,
  createWriteUploadInstruction,
  deriveUploadAddresses,
  type UploadAddresses,
} from "../uploader";
import { bytesEqual, bytesToHex, sha256 } from "../helpers/bytes";
import {
  getOptionalAccount,
  parseUploaderMeta,
  requireAccountData,
} from "./accounts";
import {
  UPLOADER_PROGRAM_ADDRESS,
  UPLOADER_STATE_FINALIZED,
  UPLOADER_STATE_OPEN,
} from "./constants";
import { emitProgress, submitTransaction } from "./chain";
import { DeployError } from "./errors";
import type {
  DeployProgressEvent,
  DeploymentOperation,
  UploadArtifactResult,
  UploadCleanupResult,
} from "./types";
import type { ResolvedSigner } from "./validation";

export interface PreparedUpload {
  operation: DeploymentOperation;
  artifact: "program" | "abi";
  seed: string;
  bytes: Uint8Array;
  hash: Uint8Array;
  addresses: UploadAddresses;
  result: UploadArtifactResult;
}

async function waitForUploadPair(
  client: Thru,
  metaAddress: string,
  bufferAddress: string,
): Promise<{ metaAccount?: Account; bufferAccount?: Account }> {
  let metaAccount: Account | undefined;
  let bufferAccount: Account | undefined;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    [metaAccount, bufferAccount] = await Promise.all([
      getOptionalAccount(client, metaAddress),
      getOptionalAccount(client, bufferAddress),
    ]);
    if (metaAccount && bufferAccount) break;
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { metaAccount, bufferAccount };
}

async function waitForBufferContent(
  client: Thru,
  bufferAddress: string,
  expected: Uint8Array,
  offset = 0,
): Promise<Account | undefined> {
  let account: Account | undefined;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    account = await getOptionalAccount(client, bufferAddress);
    if (
      account &&
      bytesEqual(
        requireAccountData(account, "uploader buffer account").slice(
          offset,
          offset + expected.length,
        ),
        expected,
      )
    ) {
      return account;
    }
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return account;
}

export async function prepareUpload(
  operation: DeploymentOperation,
  artifact: "program" | "abi",
  seed: string,
  bytes: Uint8Array,
): Promise<PreparedUpload> {
  const hash = await sha256(bytes);
  const addresses = deriveUploadAddresses(seed);
  return {
    operation,
    artifact,
    seed,
    bytes,
    hash,
    addresses,
    result: {
      artifact,
      size: bytes.length,
      sha256: bytesToHex(hash),
      metaAccountAddress: addresses.metaAccountAddress,
      bufferAccountAddress: addresses.bufferAccountAddress,
      reused: false,
      transactionSignatures: [],
      cleanup: { status: "not-needed" },
    },
  };
}

function assertUploaderOwner(account: Account, label: string): void {
  if (!account.meta?.owner?.equals(UPLOADER_PROGRAM_ADDRESS)) {
    throw new DeployError(
      "UPLOAD_CONFLICT",
      `${label} has an unexpected owner`,
    );
  }
}

function assertMatchingUpload(
  upload: PreparedUpload,
  signer: ResolvedSigner,
  metaAccount: Account,
  bufferAccount: Account,
): number {
  const meta = parseUploaderMeta(metaAccount);
  assertUploaderOwner(bufferAccount, "uploader buffer account");
  if (!bytesEqual(meta.authority, signer.publicKey)) {
    throw new DeployError(
      "UPLOAD_CONFLICT",
      "temporary upload belongs to another authority",
    );
  }
  if (!bytesEqual(meta.expectedHash, upload.hash)) {
    throw new DeployError(
      "UPLOAD_CONFLICT",
      "temporary upload has a conflicting SHA-256",
    );
  }
  const buffer = requireAccountData(bufferAccount, "uploader buffer account");
  if (buffer.length !== upload.bytes.length) {
    throw new DeployError(
      "UPLOAD_CONFLICT",
      "temporary upload has a conflicting size",
    );
  }
  if (
    meta.state !== UPLOADER_STATE_OPEN &&
    meta.state !== UPLOADER_STATE_FINALIZED
  ) {
    throw new DeployError(
      "UPLOAD_CONFLICT",
      `temporary upload has invalid state ${meta.state}`,
    );
  }
  return meta.state;
}

function event(
  upload: PreparedUpload,
  status: DeployProgressEvent["status"],
  fields: Partial<DeployProgressEvent> = {},
): DeployProgressEvent {
  return {
    operation: upload.operation,
    phase: "upload",
    status,
    artifact: upload.artifact,
    ...fields,
  };
}

export async function uploadArtifact(
  client: Thru,
  signer: ResolvedSigner,
  upload: PreparedUpload,
  chunkSize: number,
  onProgress?: (event: DeployProgressEvent) => void,
): Promise<UploadArtifactResult> {
  const metaAddress = upload.result.metaAccountAddress;
  const bufferAddress = upload.result.bufferAccountAddress;
  emitProgress(onProgress, event(upload, "started"));

  let metaAccount = await getOptionalAccount(client, metaAddress);
  let bufferAccount = await getOptionalAccount(client, bufferAddress);
  if (!!metaAccount !== !!bufferAccount) {
    throw new DeployError(
      "UPLOAD_CONFLICT",
      "temporary upload is only partly present",
    );
  }

  if (!metaAccount || !bufferAccount) {
    let signature: string | undefined;
    let unknownOutcome: DeployError | undefined;
    try {
      signature = await submitTransaction(
        client,
        signer,
        upload.operation,
        "upload",
        {
          program: UPLOADER_PROGRAM_ADDRESS,
          readWrite: [metaAddress, bufferAddress],
          instructionData: createUploadBufferInstruction({
            bufferAccount: upload.addresses.bufferAccountBytes,
            metaAccount: upload.addresses.metaAccountBytes,
            authorityAccount: signer.publicKey,
            bufferSize: upload.bytes.length,
            expectedHash: upload.hash,
            seed: upload.seed,
          }),
          computeUnits: 50_000 + upload.bytes.length * 2,
          stateUnits: 10_000,
          memoryUnits: 10_000,
          expiryAfter: 10,
        },
      );
    } catch (error) {
      if (!(error instanceof DeployError) || error.code !== "OUTCOME_UNKNOWN") {
        throw error;
      }
      unknownOutcome = error;
      signature = error.transactionSignature;
    }
    if (signature) upload.result.transactionSignatures.push(signature);
    ({ metaAccount, bufferAccount } = await waitForUploadPair(
      client,
      metaAddress,
      bufferAddress,
    ));
    if (!metaAccount || !bufferAccount) {
      if (unknownOutcome) throw unknownOutcome;
      throw new DeployError(
        "VERIFICATION_FAILED",
        "temporary upload creation was not visible",
      );
    }
    emitProgress(
      onProgress,
      event(upload, "progress", { uploadStep: "create", signature }),
    );
  } else {
    upload.result.reused = true;
  }

  const state = assertMatchingUpload(
    upload,
    signer,
    metaAccount,
    bufferAccount,
  );
  if (state === UPLOADER_STATE_FINALIZED) {
    if (
      !bytesEqual(
        requireAccountData(bufferAccount, "uploader buffer account"),
        upload.bytes,
      )
    ) {
      throw new DeployError(
        "UPLOAD_CONFLICT",
        "finalized temporary upload contents do not match",
      );
    }
    emitProgress(
      onProgress,
      event(upload, "succeeded", { uploadStep: "finalize" }),
    );
    return upload.result;
  }

  const totalChunks = Math.ceil(upload.bytes.length / chunkSize);
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const offset = chunkIndex * chunkSize;
    const chunk = upload.bytes.slice(
      offset,
      Math.min(offset + chunkSize, upload.bytes.length),
    );
    const current = requireAccountData(
      bufferAccount,
      "uploader buffer account",
    );
    if (bytesEqual(current.slice(offset, offset + chunk.length), chunk)) {
      emitProgress(
        onProgress,
        event(upload, "progress", {
          uploadStep: "write",
          completedChunks: chunkIndex + 1,
          totalChunks,
        }),
      );
      continue;
    }

    let written = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3 && !written; attempt += 1) {
      try {
        const signature = await submitTransaction(
          client,
          signer,
          upload.operation,
          "upload",
          {
            program: UPLOADER_PROGRAM_ADDRESS,
            readWrite: [metaAddress, bufferAddress],
            instructionData: createWriteUploadInstruction({
              bufferAccount: upload.addresses.bufferAccountBytes,
              metaAccount: upload.addresses.metaAccountBytes,
              data: chunk,
              offset,
            }),
            computeUnits: 500_000_000,
            stateUnits: 5_000,
            memoryUnits: 5_000,
            expiryAfter: 10_000,
          },
        );
        upload.result.transactionSignatures.push(signature);
        written = true;
      } catch (error) {
        lastError = error;
        if (error instanceof DeployError && error.transactionSignature) {
          upload.result.transactionSignatures.push(error.transactionSignature);
        }
        bufferAccount = await getOptionalAccount(client, bufferAddress);
        if (
          bufferAccount &&
          bytesEqual(
            requireAccountData(bufferAccount, "uploader buffer account").slice(
              offset,
              offset + chunk.length,
            ),
            chunk,
          )
        ) {
          written = true;
        } else if (
          error instanceof DeployError &&
          error.code === "TRANSACTION_FAILED"
        ) {
          throw error;
        }
      }
    }
    if (!written) throw lastError;
    bufferAccount = await waitForBufferContent(
      client,
      bufferAddress,
      chunk,
      offset,
    );
    if (
      !bufferAccount ||
      !bytesEqual(
        requireAccountData(bufferAccount, "uploader buffer account").slice(
          offset,
          offset + chunk.length,
        ),
        chunk,
      )
    ) {
      throw new DeployError(
        "VERIFICATION_FAILED",
        "temporary upload chunk verification failed",
      );
    }
    emitProgress(
      onProgress,
      event(upload, "progress", {
        uploadStep: "write",
        completedChunks: chunkIndex + 1,
        totalChunks,
        signature: upload.result.transactionSignatures.at(-1),
      }),
    );
  }

  const finalBuffer = await waitForBufferContent(
    client,
    bufferAddress,
    upload.bytes,
  );
  if (
    !finalBuffer ||
    !bytesEqual(
      requireAccountData(finalBuffer, "uploader buffer account"),
      upload.bytes,
    )
  ) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      "temporary upload content verification failed",
    );
  }

  let finalizeSignature: string | undefined;
  let unknownFinalizeOutcome: DeployError | undefined;
  try {
    finalizeSignature = await submitTransaction(
      client,
      signer,
      upload.operation,
      "upload",
      {
        program: UPLOADER_PROGRAM_ADDRESS,
        readWrite: [metaAddress, bufferAddress],
        instructionData: createFinalizeUploadInstruction({
          bufferAccount: upload.addresses.bufferAccountBytes,
          metaAccount: upload.addresses.metaAccountBytes,
          expectedHash: upload.hash,
        }),
        computeUnits: 50_000 + upload.bytes.length * 200,
        stateUnits: 5_000,
        memoryUnits: 5_000,
        expiryAfter: 10_000,
      },
    );
  } catch (error) {
    if (!(error instanceof DeployError) || error.code !== "OUTCOME_UNKNOWN") {
      throw error;
    }
    unknownFinalizeOutcome = error;
    finalizeSignature = error.transactionSignature;
  }
  if (finalizeSignature) {
    upload.result.transactionSignatures.push(finalizeSignature);
  }
  let finalizedMeta: Account | undefined;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    finalizedMeta = await getOptionalAccount(client, metaAddress);
    if (
      finalizedMeta &&
      parseUploaderMeta(finalizedMeta).state === UPLOADER_STATE_FINALIZED
    )
      break;
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (
    !finalizedMeta ||
    parseUploaderMeta(finalizedMeta).state !== UPLOADER_STATE_FINALIZED
  ) {
    if (unknownFinalizeOutcome) throw unknownFinalizeOutcome;
    throw new DeployError(
      "VERIFICATION_FAILED",
      "temporary upload did not finalize",
    );
  }
  emitProgress(
    onProgress,
    event(upload, "succeeded", {
      uploadStep: "finalize",
      signature: finalizeSignature,
    }),
  );
  return upload.result;
}

export async function cleanupUpload(
  client: Thru,
  signer: ResolvedSigner,
  upload: PreparedUpload,
  onProgress?: (event: DeployProgressEvent) => void,
): Promise<UploadCleanupResult> {
  const metaAddress = upload.result.metaAccountAddress;
  const bufferAddress = upload.result.bufferAccountAddress;
  const meta = await getOptionalAccount(client, metaAddress);
  const buffer = await getOptionalAccount(client, bufferAddress);
  if (!meta && !buffer) {
    upload.result.cleanup = { status: "not-needed" };
    return upload.result.cleanup;
  }
  emitProgress(onProgress, {
    operation: upload.operation,
    phase: "cleanup",
    status: "started",
    artifact: upload.artifact,
  });
  let cleanupSignature: string | undefined;
  let remainingAccountAddresses: string[] | undefined;
  try {
    if (!meta || !buffer)
      throw new Error("temporary upload is only partly present");
    const signature = await submitTransaction(
      client,
      signer,
      upload.operation,
      "cleanup",
      {
        program: UPLOADER_PROGRAM_ADDRESS,
        readWrite: [metaAddress, bufferAddress],
        instructionData: createDestroyUploadInstruction({
          bufferAccount: upload.addresses.bufferAccountBytes,
          metaAccount: upload.addresses.metaAccountBytes,
        }),
        computeUnits: 50_000,
        stateUnits: 5_000,
        memoryUnits: 5_000,
        expiryAfter: 10_000,
      },
    );
    cleanupSignature = signature;
    let remaining = true;
    for (let attempt = 0; attempt < 4 && remaining; attempt += 1) {
      const [remainingMeta, remainingBuffer] = await Promise.all([
        getOptionalAccount(client, metaAddress),
        getOptionalAccount(client, bufferAddress),
      ]);
      remaining = !!remainingMeta || !!remainingBuffer;
      remainingAccountAddresses = [
        ...(remainingMeta ? [metaAddress] : []),
        ...(remainingBuffer ? [bufferAddress] : []),
      ];
      if (remaining && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (remaining) {
      throw new Error("temporary upload accounts remain after cleanup");
    }
    upload.result.cleanup = {
      status: "succeeded",
      transactionSignature: signature,
    };
    emitProgress(onProgress, {
      operation: upload.operation,
      phase: "cleanup",
      status: "succeeded",
      artifact: upload.artifact,
      signature,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DeployError && error.transactionSignature) {
      cleanupSignature ??= error.transactionSignature;
    }
    upload.result.cleanup = {
      status: "failed",
      error: message,
      transactionSignature: cleanupSignature,
      remainingAccountAddresses: remainingAccountAddresses ?? [
        metaAddress,
        bufferAddress,
      ],
    };
    emitProgress(onProgress, {
      operation: upload.operation,
      phase: "cleanup",
      status: "failed",
      artifact: upload.artifact,
      message,
    });
  }
  return upload.result.cleanup;
}
