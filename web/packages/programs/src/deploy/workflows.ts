import { Pubkey, createThruClient, type InstructionContext } from "@thru/sdk";
import type { Thru } from "@thru/sdk/client";
import {
  createOfficialABIInstruction,
  createOfficialABIMetaInstruction,
  createUpgradeOfficialABIInstruction,
  deriveProgramABIAddresses,
  type ProgramABIAddresses,
} from "../abi-manager";
import {
  createEphemeralProgramInstruction,
  createPermanentProgramInstruction,
  createUpgradeProgramInstruction,
  deriveManagedProgramAddresses,
  type InstructionData,
  type ManagedProgramAddresses,
} from "../manager";
import { buildMulticallInstruction } from "../multicall";
import { bytesEqual } from "../helpers/bytes";
import { temporarySeed } from "./seeds";
import {
  assertABIOpen,
  assertManagedProgramAccount,
  assertManagerOpen,
  assertPubkeyBytes,
  getOptionalAccount,
  parseABIAccount,
  parseABIMeta,
  parseManagerMeta,
  requireAccountData,
  type ParsedABIAccount,
  type ParsedManagerMeta,
} from "./accounts";
import {
  creationProof,
  emitProgress,
  submitTransaction,
  type DeploymentTransaction,
} from "./chain";
import {
  ABI_MANAGER_PROGRAM_ADDRESS,
  MANAGER_PROGRAM_ADDRESS,
  MULTICALL_PROGRAM_ADDRESS,
} from "./constants";
import { DeployError, asDeployError } from "./errors";
import type {
  DeployProgramABIRequest,
  DeployProgramABIResult,
  DeployProgramRequest,
  DeployProgramResult,
  DeployProgressEvent,
  DeploymentOperation,
  DeploymentRequestBase,
  UpgradeProgramABIRequest,
  UpgradeProgramABIResult,
  UpgradeProgramRequest,
  UpgradeProgramResult,
} from "./types";
import {
  cleanupUpload,
  prepareUpload,
  uploadArtifact,
  type PreparedUpload,
} from "./uploader";
import {
  resolveSigner,
  normalizeBytes,
  validateABI,
  validateProgramImage,
  validateSeedAndChunkSize,
  type ResolvedSigner,
} from "./validation";

interface Context {
  operation: DeploymentOperation;
  client: Thru;
  signer: ResolvedSigner;
  seed: string;
  ephemeral: boolean;
  chunkSize: number;
  program: ManagedProgramAddresses;
  abi: ProgramABIAddresses;
  onProgress?: (event: DeployProgressEvent) => void;
}

interface ProgramState {
  meta: ParsedManagerMeta;
}

interface ABIState {
  abi: ParsedABIAccount;
}

function createProgramInstruction(
  context: Context,
  upload: PreparedUpload,
  sourceSize: number,
  metaStateProof: Uint8Array,
  programStateProof: Uint8Array,
): InstructionData {
  const common = {
    metaAccount: context.program.programMetaAccountBytes,
    programAccount: context.program.programAccountBytes,
    sourceBufferAccount: upload.addresses.bufferAccountBytes,
    authorityAccount: context.signer.publicKey,
    sourceSize,
    seed: context.seed,
  };
  return context.ephemeral
    ? createEphemeralProgramInstruction(common)
    : createPermanentProgramInstruction({
        ...common,
        metaStateProof,
        programStateProof,
      });
}

function createABIMetaInstruction(
  context: Context,
  stateProof: Uint8Array,
): InstructionData {
  const common = {
    abiMetaAccount: context.abi.abiMetaAccountBytes,
    programMetaAccount: context.program.programMetaAccountBytes,
    authorityAccount: context.signer.publicKey,
  };
  return context.ephemeral
    ? createOfficialABIMetaInstruction({ ...common, ephemeral: true })
    : createOfficialABIMetaInstruction({
        ...common,
        stateProof,
      });
}

function createABIInstruction(
  context: Context,
  upload: PreparedUpload,
  sourceSize: number,
  stateProof: Uint8Array,
): InstructionData {
  const common = {
    abiMetaAccount: context.abi.abiMetaAccountBytes,
    programMetaAccount: context.program.programMetaAccountBytes,
    abiAccount: context.abi.abiAccountBytes,
    sourceBufferAccount: upload.addresses.bufferAccountBytes,
    authorityAccount: context.signer.publicKey,
    sourceSize,
  };
  return context.ephemeral
    ? createOfficialABIInstruction({ ...common, ephemeral: true })
    : createOfficialABIInstruction({
        ...common,
        stateProof,
      });
}

function upgradeProgramInstruction(
  context: Context,
  upload: PreparedUpload,
  sourceSize: number,
): InstructionData {
  return createUpgradeProgramInstruction({
    metaAccount: context.program.programMetaAccountBytes,
    programAccount: context.program.programAccountBytes,
    sourceBufferAccount: upload.addresses.bufferAccountBytes,
    sourceSize,
  });
}

function upgradeABIInstruction(
  context: Context,
  upload: PreparedUpload,
  sourceSize: number,
): InstructionData {
  return createUpgradeOfficialABIInstruction({
    abiMetaAccount: context.abi.abiMetaAccountBytes,
    programMetaAccount: context.program.programMetaAccountBytes,
    abiAccount: context.abi.abiAccountBytes,
    sourceBufferAccount: upload.addresses.bufferAccountBytes,
    authorityAccount: context.signer.publicKey,
    sourceSize,
  });
}

function progress(
  context: Context,
  phase: DeployProgressEvent["phase"],
  status: DeployProgressEvent["status"],
  fields: Partial<DeployProgressEvent> = {},
): void {
  emitProgress(context.onProgress, {
    operation: context.operation,
    phase,
    status,
    ...fields,
  });
}

async function createContext(
  operation: DeploymentOperation,
  request: DeploymentRequestBase,
  programAddressAssertion?: string,
): Promise<Context> {
  const client = request.client ?? createThruClient();
  const chunkSize = validateSeedAndChunkSize(request.seed, request.chunkSize);
  const signer = await resolveSigner(
    client,
    request.signer.address,
    request.signer.privateKey,
  );
  const ephemeral = request.ephemeral ?? false;
  const program = deriveManagedProgramAddresses(request.seed, ephemeral);

  if (programAddressAssertion) {
    let supplied: Pubkey;
    try {
      supplied = Pubkey.from(programAddressAssertion);
    } catch (error) {
      throw asDeployError(
        error,
        "INVALID_INPUT",
        "programAddress is not a valid Thru address",
      );
    }
    if (!supplied.equals(program.programAccountAddress)) {
      throw new DeployError(
        "INVALID_INPUT",
        "programAddress does not match the address derived from seed and ephemeral",
      );
    }
  }

  const abi = deriveProgramABIAddresses(
    program.programAccountAddress,
    ephemeral,
  );
  return {
    operation,
    client,
    signer,
    seed: request.seed,
    ephemeral,
    chunkSize,
    program,
    abi,
    onProgress: request.onProgress,
  };
}

function addressDetails(context: Context): Record<string, string> {
  return {
    programMetaAccountAddress: context.program.programMetaAccountAddress,
    programAccountAddress: context.program.programAccountAddress,
    abiMetaAccountAddress: context.abi.abiMetaAccountAddress,
    abiAccountAddress: context.abi.abiAccountAddress,
  };
}

async function assertAbsent(
  context: Context,
  entries: Array<[string, string]>,
): Promise<void> {
  const accounts = await Promise.all(
    entries.map(([, address]) => getOptionalAccount(context.client, address)),
  );
  const existing = entries
    .filter((_, index) => accounts[index])
    .map(([label]) => label);
  if (existing.length) {
    throw new DeployError(
      "TARGET_EXISTS",
      `deployment target already exists: ${existing.join(", ")}`,
      {
        operation: context.operation,
        phase: "preflight",
        addresses: addressDetails(context),
      },
    );
  }
}

async function requireProgram(context: Context): Promise<ProgramState> {
  const [metaAccount, programAccount] = await Promise.all([
    getOptionalAccount(
      context.client,
      context.program.programMetaAccountAddress,
    ),
    getOptionalAccount(context.client, context.program.programAccountAddress),
  ]);
  if (!metaAccount || !programAccount) {
    throw new DeployError(
      "TARGET_NOT_FOUND",
      "managed program or its metadata account is missing",
      {
        operation: context.operation,
        phase: "preflight",
        addresses: addressDetails(context),
      },
    );
  }
  const meta = parseManagerMeta(metaAccount);
  assertManagerOpen(meta);
  if (!bytesEqual(meta.authority, context.signer.publicKey)) {
    throw new DeployError(
      "SIGNER_MISMATCH",
      "signer is not the managed program authority",
      {
        operation: context.operation,
        phase: "preflight",
        addresses: addressDetails(context),
      },
    );
  }
  assertManagedProgramAccount(programAccount);
  return { meta };
}

async function requireABI(context: Context): Promise<ABIState> {
  const [metaAccount, abiAccount] = await Promise.all([
    getOptionalAccount(context.client, context.abi.abiMetaAccountAddress),
    getOptionalAccount(context.client, context.abi.abiAccountAddress),
  ]);
  if (!metaAccount || !abiAccount) {
    throw new DeployError(
      "TARGET_NOT_FOUND",
      "program ABI or its metadata account is missing",
      {
        operation: context.operation,
        phase: "preflight",
        addresses: addressDetails(context),
      },
    );
  }
  const meta = parseABIMeta(metaAccount);
  const abi = parseABIAccount(abiAccount);
  assertABIOpen(abi);
  assertPubkeyBytes(
    meta.program,
    context.program.programAccountAddress,
    "ABI metadata points to another program",
  );
  assertPubkeyBytes(
    abi.abiMetaAccount,
    context.abi.abiMetaAccountAddress,
    "ABI account points to another metadata account",
  );
  return { abi };
}

async function verifyProgram(
  context: Context,
  expectedBytes: Uint8Array | undefined,
  expectedVersion: bigint,
): Promise<bigint> {
  const [metaAccount, programAccount] = await Promise.all([
    getOptionalAccount(
      context.client,
      context.program.programMetaAccountAddress,
    ),
    getOptionalAccount(context.client, context.program.programAccountAddress),
  ]);
  if (!metaAccount || !programAccount) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      "managed program readback is missing",
    );
  }
  const meta = parseManagerMeta(metaAccount);
  assertManagerOpen(meta);
  assertPubkeyBytes(
    meta.authority,
    context.signer.publicKey,
    "managed program authority mismatch",
  );
  if (meta.version !== expectedVersion) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      `program version mismatch: expected ${expectedVersion}, got ${meta.version}`,
    );
  }
  assertManagedProgramAccount(programAccount);
  if (
    expectedBytes &&
    !bytesEqual(
      requireAccountData(programAccount, "program account"),
      expectedBytes,
    )
  ) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      "managed program bytes do not match the upload",
    );
  }
  return meta.version;
}

async function verifyABI(
  context: Context,
  expectedBytes: Uint8Array,
  expectedRevision: bigint,
): Promise<bigint> {
  const [metaAccount, abiAccount] = await Promise.all([
    getOptionalAccount(context.client, context.abi.abiMetaAccountAddress),
    getOptionalAccount(context.client, context.abi.abiAccountAddress),
  ]);
  if (!metaAccount || !abiAccount) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      "program ABI readback is missing",
    );
  }
  const meta = parseABIMeta(metaAccount);
  const abi = parseABIAccount(abiAccount);
  assertABIOpen(abi);
  assertPubkeyBytes(
    meta.program,
    context.program.programAccountAddress,
    "ABI metadata program mismatch",
  );
  assertPubkeyBytes(
    abi.abiMetaAccount,
    context.abi.abiMetaAccountAddress,
    "ABI metadata link mismatch",
  );
  if (abi.revision !== expectedRevision) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      `ABI revision mismatch: expected ${expectedRevision}, got ${abi.revision}`,
    );
  }
  if (!bytesEqual(abi.content, expectedBytes)) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      "ABI contents do not match the upload",
    );
  }
  return abi.revision;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retryVerification<T>(verify: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await verify();
    } catch (error) {
      lastError = error;
      if (attempt < 7) await delay(250);
    }
  }
  throw asDeployError(
    lastError,
    "VERIFICATION_FAILED",
    "Deployment readback verification failed",
  );
}

async function commitAndVerify<T>(
  context: Context,
  transaction: DeploymentTransaction,
  verify: () => Promise<T>,
): Promise<{ signature: string; verified: T }> {
  progress(context, "commit", "started");
  let signature: string;
  try {
    signature = await submitTransaction(
      context.client,
      context.signer,
      context.operation,
      "commit",
      transaction,
    );
  } catch (error) {
    if (
      error instanceof DeployError &&
      error.code === "OUTCOME_UNKNOWN" &&
      error.transactionSignature
    ) {
      try {
        try {
          const status = await context.client.transactions.getStatus(
            error.transactionSignature,
          );
          const execution = status.executionResult;
          if (
            execution &&
            (execution.vmError !== 0 || execution.userErrorCode !== 0n)
          ) {
            throw new DeployError(
              "TRANSACTION_FAILED",
              "Deployment transaction failed",
              {
                operation: context.operation,
                phase: "commit",
                transactionSignature: error.transactionSignature,
                vmError: execution.vmError,
                userErrorCode: execution.userErrorCode,
              },
            );
          }
        } catch (statusError) {
          if (statusError instanceof DeployError) throw statusError;
          /* The final account read below is the second reconciliation source. */
        }
        const verified = await retryVerification(verify);
        progress(context, "commit", "succeeded", {
          signature: error.transactionSignature,
        });
        progress(context, "verification", "succeeded");
        return { signature: error.transactionSignature, verified };
      } catch (reconciliationError) {
        if (
          reconciliationError instanceof DeployError &&
          reconciliationError.code === "TRANSACTION_FAILED"
        ) {
          throw reconciliationError;
        }
        throw error;
      }
    }
    throw error;
  }
  progress(context, "commit", "succeeded", { signature });
  progress(context, "verification", "started");
  const verified = await retryVerification(verify);
  progress(context, "verification", "succeeded");
  return { signature, verified };
}

async function cleanupAll(
  context: Context,
  uploads: PreparedUpload[],
): Promise<string[]> {
  const warnings: string[] = [];
  for (const upload of uploads) {
    try {
      const result = await cleanupUpload(
        context.client,
        context.signer,
        upload,
        context.onProgress,
      );
      if (result.status === "failed") {
        const remaining = result.remainingAccountAddresses ?? [
          upload.result.metaAccountAddress,
          upload.result.bufferAccountAddress,
        ];
        warnings.push(
          `Failed to clean ${upload.artifact} upload; remaining accounts: ${remaining.join(", ")}: ${result.error}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      upload.result.cleanup = {
        status: "failed",
        error: message,
        remainingAccountAddresses: [
          upload.result.metaAccountAddress,
          upload.result.bufferAccountAddress,
        ],
      };
      warnings.push(
        `Failed to clean ${upload.artifact} upload (${upload.result.metaAccountAddress}, ${upload.result.bufferAccountAddress}): ${message}`,
      );
    }
  }
  return warnings;
}

async function withCleanup<T>(
  context: Context,
  uploads: PreparedUpload[],
  work: () => Promise<T>,
): Promise<{ value: T; warnings: string[] }> {
  try {
    const value = await work();
    const warnings = await cleanupAll(context, uploads);
    return { value, warnings };
  } catch (error) {
    await cleanupAll(context, uploads);
    const deployError = asDeployError(error, "RPC_ERROR", "Deployment failed", {
      operation: context.operation,
      addresses: addressDetails(context),
    });
    deployError.cleanup = uploads.map((upload) => upload.result.cleanup);
    deployError.addresses ??= addressDetails(context);
    throw deployError;
  }
}

async function multicall(
  context: InstructionContext,
  calls: Array<{ program: string; instructionData: InstructionData }>,
): Promise<Uint8Array> {
  return buildMulticallInstruction(
    await Promise.all(
      calls.map(async (call) => ({
        programIdx: context.getAccountIndex(call.program),
        instructionData: await call.instructionData(context),
      })),
    ),
  );
}

function commonResult(
  context: Context,
  signature: string,
  version: bigint,
  warnings: string[],
) {
  return {
    seed: context.seed,
    ephemeral: context.ephemeral,
    authorityAddress: context.signer.address,
    programMetaAccountAddress: context.program.programMetaAccountAddress,
    programAccountAddress: context.program.programAccountAddress,
    programVersion: version,
    transactionSignature: signature,
    warnings,
  };
}

export async function deployProgram(
  request: DeployProgramRequest,
): Promise<DeployProgramResult> {
  const operation: DeploymentOperation = "deployProgram";
  const programBytes = normalizeBytes(request.program, "program");
  const abiBytes =
    request.abi === undefined ? undefined : normalizeBytes(request.abi, "abi");
  validateProgramImage(programBytes);
  const context = await createContext(operation, request);
  if (abiBytes) await validateABI(abiBytes, context.client);
  progress(context, "validation", "succeeded");
  progress(context, "preflight", "started");
  const absent: Array<[string, string]> = [
    ["program metadata", context.program.programMetaAccountAddress],
    ["program", context.program.programAccountAddress],
  ];
  if (abiBytes) {
    absent.push(
      ["ABI metadata", context.abi.abiMetaAccountAddress],
      ["ABI", context.abi.abiAccountAddress],
    );
  }
  await assertAbsent(context, absent);
  progress(context, "preflight", "succeeded");

  const programUpload = await prepareUpload(
    operation,
    "program",
    await temporarySeed(request.seed, "temporary"),
    programBytes,
  );
  const abiUpload = abiBytes
    ? await prepareUpload(
        operation,
        "abi",
        await temporarySeed(request.seed, "abi_temp"),
        abiBytes,
      )
    : undefined;
  const uploads = abiUpload ? [programUpload, abiUpload] : [programUpload];

  const { value, warnings } = await withCleanup(context, uploads, async () => {
    await uploadArtifact(
      context.client,
      context.signer,
      programUpload,
      context.chunkSize,
      context.onProgress,
    );
    if (abiUpload) {
      await uploadArtifact(
        context.client,
        context.signer,
        abiUpload,
        context.chunkSize,
        context.onProgress,
      );
    }
    const [programMetaProof, programProof] = await Promise.all([
      creationProof(
        context.client,
        context.program.programMetaAccountAddress,
        context.ephemeral,
      ),
      creationProof(
        context.client,
        context.program.programAccountAddress,
        context.ephemeral,
      ),
    ]);

    let transaction: DeploymentTransaction;
    if (!abiBytes || !abiUpload) {
      transaction = {
        program: MANAGER_PROGRAM_ADDRESS,
        readWrite: [
          context.program.programMetaAccountAddress,
          context.program.programAccountAddress,
        ],
        readOnly: [programUpload.result.bufferAccountAddress],
        instructionData: createProgramInstruction(
          context,
          programUpload,
          programBytes.length,
          programMetaProof,
          programProof,
        ),
      };
    } else {
      const [abiMetaProof, abiProof] = await Promise.all([
        creationProof(
          context.client,
          context.abi.abiMetaAccountAddress,
          context.ephemeral,
        ),
        creationProof(
          context.client,
          context.abi.abiAccountAddress,
          context.ephemeral,
        ),
      ]);
      transaction = {
        program: MULTICALL_PROGRAM_ADDRESS,
        stateUnits: 10_000,
        memoryUnits: 10_000,
        readWrite: [
          context.program.programMetaAccountAddress,
          context.program.programAccountAddress,
          context.abi.abiMetaAccountAddress,
          context.abi.abiAccountAddress,
        ],
        readOnly: [
          MANAGER_PROGRAM_ADDRESS,
          ABI_MANAGER_PROGRAM_ADDRESS,
          programUpload.result.bufferAccountAddress,
          abiUpload.result.bufferAccountAddress,
        ],
        instructionData: (tx) =>
          multicall(tx, [
            {
              program: MANAGER_PROGRAM_ADDRESS,
              instructionData: createProgramInstruction(
                context,
                programUpload,
                programBytes.length,
                programMetaProof,
                programProof,
              ),
            },
            {
              program: ABI_MANAGER_PROGRAM_ADDRESS,
              instructionData: createABIMetaInstruction(context, abiMetaProof),
            },
            {
              program: ABI_MANAGER_PROGRAM_ADDRESS,
              instructionData: createABIInstruction(
                context,
                abiUpload,
                abiBytes.length,
                abiProof,
              ),
            },
          ]),
      };
    }
    return commitAndVerify(context, transaction, async () => ({
      version: await verifyProgram(context, programBytes, 0n),
      revision: abiBytes ? await verifyABI(context, abiBytes, 0n) : undefined,
    }));
  });

  return {
    ...commonResult(context, value.signature, value.verified.version, warnings),
    programSize: programBytes.length,
    abiSize: abiBytes?.length,
    abiMetaAccountAddress: abiBytes
      ? context.abi.abiMetaAccountAddress
      : undefined,
    abiAccountAddress: abiBytes ? context.abi.abiAccountAddress : undefined,
    abiRevision: value.verified.revision,
    programUpload: programUpload.result,
    abiUpload: abiUpload?.result,
  };
}

export async function deployProgramABI(
  request: DeployProgramABIRequest,
): Promise<DeployProgramABIResult> {
  const operation: DeploymentOperation = "deployProgramABI";
  const abiBytes = normalizeBytes(request.abi, "abi");
  const context = await createContext(
    operation,
    request,
    request.programAddress,
  );
  await validateABI(abiBytes, context.client);
  progress(context, "validation", "succeeded");
  progress(context, "preflight", "started");
  const programState = await requireProgram(context);
  await assertAbsent(context, [
    ["ABI metadata", context.abi.abiMetaAccountAddress],
    ["ABI", context.abi.abiAccountAddress],
  ]);
  progress(context, "preflight", "succeeded");

  const abiUpload = await prepareUpload(
    operation,
    "abi",
    await temporarySeed(request.seed, "abi_temp"),
    abiBytes,
  );
  const { value, warnings } = await withCleanup(
    context,
    [abiUpload],
    async () => {
      await uploadArtifact(
        context.client,
        context.signer,
        abiUpload,
        context.chunkSize,
        context.onProgress,
      );
      const [metaProof, abiProof] = await Promise.all([
        creationProof(
          context.client,
          context.abi.abiMetaAccountAddress,
          context.ephemeral,
        ),
        creationProof(
          context.client,
          context.abi.abiAccountAddress,
          context.ephemeral,
        ),
      ]);
      const transaction: DeploymentTransaction = {
        program: MULTICALL_PROGRAM_ADDRESS,
        stateUnits: 10_000,
        memoryUnits: 10_000,
        readWrite: [
          context.abi.abiMetaAccountAddress,
          context.abi.abiAccountAddress,
        ],
        readOnly: [
          ABI_MANAGER_PROGRAM_ADDRESS,
          context.program.programMetaAccountAddress,
          abiUpload.result.bufferAccountAddress,
        ],
        instructionData: (tx) =>
          multicall(tx, [
            {
              program: ABI_MANAGER_PROGRAM_ADDRESS,
              instructionData: createABIMetaInstruction(context, metaProof),
            },
            {
              program: ABI_MANAGER_PROGRAM_ADDRESS,
              instructionData: createABIInstruction(
                context,
                abiUpload,
                abiBytes.length,
                abiProof,
              ),
            },
          ]),
      };
      return commitAndVerify(context, transaction, async () => ({
        version: await verifyProgram(
          context,
          undefined,
          programState.meta.version,
        ),
        revision: await verifyABI(context, abiBytes, 0n),
      }));
    },
  );

  return {
    ...commonResult(context, value.signature, value.verified.version, warnings),
    abiMetaAccountAddress: context.abi.abiMetaAccountAddress,
    abiAccountAddress: context.abi.abiAccountAddress,
    abiRevision: value.verified.revision,
    abiSize: abiBytes.length,
    abiUpload: abiUpload.result,
  };
}

export async function upgradeProgram(
  request: UpgradeProgramRequest,
): Promise<UpgradeProgramResult> {
  const operation: DeploymentOperation = "upgradeProgram";
  const programBytes = normalizeBytes(request.program, "program");
  const abiBytes =
    request.abi === undefined ? undefined : normalizeBytes(request.abi, "abi");
  validateProgramImage(programBytes);
  const context = await createContext(
    operation,
    request,
    request.programAddress,
  );
  if (abiBytes) await validateABI(abiBytes, context.client);
  progress(context, "validation", "succeeded");
  progress(context, "preflight", "started");
  const programState = await requireProgram(context);
  const abiState = abiBytes ? await requireABI(context) : undefined;
  progress(context, "preflight", "succeeded");

  const programUpload = await prepareUpload(
    operation,
    "program",
    await temporarySeed(request.seed, "upgrade_temporary"),
    programBytes,
  );
  const abiUpload = abiBytes
    ? await prepareUpload(
        operation,
        "abi",
        await temporarySeed(request.seed, "abi_upgrade"),
        abiBytes,
      )
    : undefined;
  const uploads = abiUpload ? [programUpload, abiUpload] : [programUpload];
  const expectedVersion = programState.meta.version + 1n;
  const expectedRevision = abiState ? abiState.abi.revision + 1n : undefined;

  const { value, warnings } = await withCleanup(context, uploads, async () => {
    await uploadArtifact(
      context.client,
      context.signer,
      programUpload,
      context.chunkSize,
      context.onProgress,
    );
    if (abiUpload) {
      await uploadArtifact(
        context.client,
        context.signer,
        abiUpload,
        context.chunkSize,
        context.onProgress,
      );
    }
    const transaction: DeploymentTransaction =
      abiBytes && abiUpload
        ? {
            program: MULTICALL_PROGRAM_ADDRESS,
            stateUnits: 10_000,
            memoryUnits: 10_000,
            readWrite: [
              context.program.programMetaAccountAddress,
              context.program.programAccountAddress,
              context.abi.abiAccountAddress,
            ],
            readOnly: [
              MANAGER_PROGRAM_ADDRESS,
              ABI_MANAGER_PROGRAM_ADDRESS,
              context.abi.abiMetaAccountAddress,
              programUpload.result.bufferAccountAddress,
              abiUpload.result.bufferAccountAddress,
            ],
            instructionData: (tx) =>
              multicall(tx, [
                {
                  program: MANAGER_PROGRAM_ADDRESS,
                  instructionData: upgradeProgramInstruction(
                    context,
                    programUpload,
                    programBytes.length,
                  ),
                },
                {
                  program: ABI_MANAGER_PROGRAM_ADDRESS,
                  instructionData: upgradeABIInstruction(
                    context,
                    abiUpload,
                    abiBytes.length,
                  ),
                },
              ]),
          }
        : {
            program: MANAGER_PROGRAM_ADDRESS,
            readWrite: [
              context.program.programMetaAccountAddress,
              context.program.programAccountAddress,
            ],
            readOnly: [programUpload.result.bufferAccountAddress],
            instructionData: upgradeProgramInstruction(
              context,
              programUpload,
              programBytes.length,
            ),
          };
    return commitAndVerify(context, transaction, async () => ({
      version: await verifyProgram(context, programBytes, expectedVersion),
      revision:
        abiBytes && expectedRevision !== undefined
          ? await verifyABI(context, abiBytes, expectedRevision)
          : undefined,
    }));
  });

  return {
    ...commonResult(context, value.signature, value.verified.version, warnings),
    programSize: programBytes.length,
    abiSize: abiBytes?.length,
    abiMetaAccountAddress: abiBytes
      ? context.abi.abiMetaAccountAddress
      : undefined,
    abiAccountAddress: abiBytes ? context.abi.abiAccountAddress : undefined,
    abiRevision: value.verified.revision,
    programUpload: programUpload.result,
    abiUpload: abiUpload?.result,
  };
}

export async function upgradeProgramABI(
  request: UpgradeProgramABIRequest,
): Promise<UpgradeProgramABIResult> {
  const operation: DeploymentOperation = "upgradeProgramABI";
  const abiBytes = normalizeBytes(request.abi, "abi");
  const context = await createContext(
    operation,
    request,
    request.programAddress,
  );
  await validateABI(abiBytes, context.client);
  progress(context, "validation", "succeeded");
  progress(context, "preflight", "started");
  const programState = await requireProgram(context);
  const abiState = await requireABI(context);
  progress(context, "preflight", "succeeded");

  const abiUpload = await prepareUpload(
    operation,
    "abi",
    await temporarySeed(request.seed, "abi_upgrade"),
    abiBytes,
  );
  const expectedRevision = abiState.abi.revision + 1n;
  const { value, warnings } = await withCleanup(
    context,
    [abiUpload],
    async () => {
      await uploadArtifact(
        context.client,
        context.signer,
        abiUpload,
        context.chunkSize,
        context.onProgress,
      );
      const transaction: DeploymentTransaction = {
        program: ABI_MANAGER_PROGRAM_ADDRESS,
        readWrite: [context.abi.abiAccountAddress],
        readOnly: [
          context.abi.abiMetaAccountAddress,
          context.program.programMetaAccountAddress,
          abiUpload.result.bufferAccountAddress,
        ],
        instructionData: upgradeABIInstruction(
          context,
          abiUpload,
          abiBytes.length,
        ),
      };
      return commitAndVerify(context, transaction, async () => ({
        version: await verifyProgram(
          context,
          undefined,
          programState.meta.version,
        ),
        revision: await verifyABI(context, abiBytes, expectedRevision),
      }));
    },
  );

  return {
    ...commonResult(context, value.signature, value.verified.version, warnings),
    abiMetaAccountAddress: context.abi.abiMetaAccountAddress,
    abiAccountAddress: context.abi.abiAccountAddress,
    abiRevision: value.verified.revision,
    abiSize: abiBytes.length,
    abiUpload: abiUpload.result,
  };
}
