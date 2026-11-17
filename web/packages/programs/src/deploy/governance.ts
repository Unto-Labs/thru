import type { Thru } from '@thru/sdk/client';
import { BOOTSTRAP_PROGRAM_SEEDS } from '../bootstrap-addresses';
import { address, buildCoreOperationPlan, coreExecutionCalls, inspectCoreGovernance, submitGovernanceAction, submitGovernanceTransaction, type Address, type CoreAdminKind, type CoreInstance, type GovernancePlan, type CorePlanOptions } from '../core-manager';
import { buildGovernedABIOperationPlan, type GovernedABIOperation } from '../abi-manager/governance';
import { resolveManagerSelection, type ManagerSelection } from '../manager/selection';
import { prepareUpload, uploadArtifact, cleanupUpload, type PreparedUpload } from './uploader';
import { resolveSigner, normalizeBytes, validateABI, validateProgramImage, validateSeedAndChunkSize } from './validation';
import type { DeploymentBytes, DeploymentSigner, DeployProgressEvent } from './types';
import type { UploadCleanupResult } from './types';
import { getOptionalAccount, parseUploaderMeta } from './accounts';
import { deriveUploadAddresses } from '../uploader';
import { bytesEqual } from '../helpers/bytes';

export interface GovernedDeploymentOptions extends ManagerSelection {
  client: Thru; seed?: string; signer: DeploymentSigner; admin?: Address; adminKind?: CoreAdminKind;
  uploadSeed: string; chunkSize?: number; executionAccounts?: CorePlanOptions['executionAccounts'];
  feePayerProofBytes?: number; onProgress?: (event: DeployProgressEvent) => void;
  multisigRequest?: Address; reviewedStatePlan?: unknown;
  executionMode?: CorePlanOptions['executionMode'];
}
export interface PreparedGovernedDeployment { plan: GovernancePlan; upload: PreparedUpload }
async function prepareArtifact(options: GovernedDeploymentOptions, artifact: 'program' | 'abi', input: DeploymentBytes) {
  const bytes = normalizeBytes(input, artifact);
  if (artifact === 'program') validateProgramImage(bytes); else await validateABI(bytes, options.client);
  const signer = await resolveSigner(options.client, options.signer.address, options.signer.privateKey);
  const chunkSize = validateSeedAndChunkSize(options.uploadSeed, options.chunkSize);
  const upload = await prepareUpload(artifact === 'program' ? 'upgradeProgram' : 'upgradeProgramABI', artifact, options.uploadSeed, bytes);
  await uploadArtifact(options.client, signer, upload, chunkSize, options.onProgress);
  return upload;
}
async function currentAdmin(options: GovernedDeploymentOptions, core: CoreInstance = 'a') {
  const current = await inspectCoreGovernance(options.client, core);
  if (options.admin && address(options.admin) !== current.admin) throw new Error('Requested admin differs from live Core config');
  if (options.adminKind && options.adminKind !== current.adminKind) throw new Error('Requested admin kind differs from live Core config');
  return { admin: current.admin, adminKind: current.adminKind };
}
/** Uploads the reviewed image and creates a distinct Core plan. No approvals or upgrades are implicit. */
export async function prepareGovernedProgramDeployment(options: GovernedDeploymentOptions & {
  program: DeploymentBytes; action: 'create' | 'upgrade'; ephemeral?: boolean; pin?: boolean;
  applicationAuthority?: Address; proofSlotSeed?: Uint8Array;
}): Promise<PreparedGovernedDeployment> {
  const seed = options.seed ?? (options.canonicalProgram ? BOOTSTRAP_PROGRAM_SEEDS[options.canonicalProgram] : undefined);
  if (!seed) throw new Error('Provide a program seed or canonical registry entry');
  if (resolveManagerSelection({ ...options, manager: options.manager ?? 'core' }, seed).manager !== 'core') throw new Error('Governed deployment requires Core selection');
  const admin = await currentAdmin(options);
  const upload = await prepareArtifact(options, 'program', options.program);
  const source = { address: upload.addresses.bufferAccountBytes, bytes: upload.bytes };
  const operation = options.action === 'upgrade'
    ? { kind: 'upgrade' as const, seed, ephemeral: options.ephemeral, source }
    : { kind: options.ephemeral ? 'createEphemeral' as const : 'createPermanent' as const, seed, source, applicationAuthority: options.applicationAuthority, pin: options.pin ?? true, proofSlotSeed: options.proofSlotSeed };
  const plan = await buildCoreOperationPlan({ ...admin, operation, executionAccounts: options.executionAccounts, feePayerProofBytes: options.feePayerProofBytes, multisigRequest: options.multisigRequest, reviewedStatePlan: options.reviewedStatePlan, executionMode: options.executionMode });
  return { plan, upload };
}
/** Core A <-> Core B loop (UNTO-3561): upload the reviewed Core image and plan
    Core B's `upgradePeer`, which replaces Core A's executable. Authorized by
    Core B's own config admin. Core B itself is upgraded like any Core pair:
    `prepareGovernedProgramDeployment({ canonicalProgram: 'core_peer_manager', action: 'upgrade' })`. */
export async function prepareGovernedCorePeerUpgrade(options: GovernedDeploymentOptions & {
  program: DeploymentBytes;
}): Promise<PreparedGovernedDeployment> {
  const admin = await currentAdmin(options, 'b');
  const upload = await prepareArtifact(options, 'program', options.program);
  const source = { address: upload.addresses.bufferAccountBytes, bytes: upload.bytes };
  const plan = await buildCoreOperationPlan({ ...admin, operation: { kind: 'upgradePeer', source }, executionAccounts: options.executionAccounts,
    feePayerProofBytes: options.feePayerProofBytes, multisigRequest: options.multisigRequest, reviewedStatePlan: options.reviewedStatePlan, executionMode: options.executionMode });
  return { plan, upload };
}
/** Official Core ABI publication and fixed-root correction bind the exact reviewed YAML artifact.
    `proof` may be a function: it runs only after the ABI buffer is uploaded and
    finalized, so a CREATING proof's validity window is not spent on the upload. */
export async function prepareGovernedABIDeployment(options: GovernedDeploymentOptions & {
  abi: DeploymentBytes; action: 'createContent' | 'upgrade' | 'upgradeRoot'; ephemeral?: boolean;
  proof?: Uint8Array | (() => Promise<Uint8Array>);
}): Promise<PreparedGovernedDeployment> {
  const admin = await currentAdmin(options);
  const seed = options.seed ?? (options.canonicalProgram ? BOOTSTRAP_PROGRAM_SEEDS[options.canonicalProgram] : undefined);
  if (options.action !== 'upgradeRoot' && !seed) throw new Error('Provide a program seed or canonical registry entry');
  const upload = await prepareArtifact(options, 'abi', options.abi);
  const source = { address: upload.addresses.bufferAccountBytes, bytes: upload.bytes };
  const proof = typeof options.proof === 'function' ? await options.proof() : options.proof;
  const operation: GovernedABIOperation = options.action === 'upgradeRoot' ? { kind: 'upgradeRoot', source } : { kind: options.action, source, seed: seed!, ephemeral: options.ephemeral, ...(options.action === 'createContent' ? { proof } : {}) };
  const plan = await buildGovernedABIOperationPlan({ ...admin, operation, client: options.client, executionAccounts: options.executionAccounts, feePayerProofBytes: options.feePayerProofBytes, multisigRequest: options.multisigRequest, reviewedStatePlan: options.reviewedStatePlan, executionMode: options.executionMode });
  return { plan, upload };
}
export async function executeEOAGovernance(options: {
  client: Thru; signer: DeploymentSigner; plan: GovernancePlan; reviewedPlanSha256?: string;
  feePayerStateProof?: Uint8Array; feePayerAccountMetaRaw?: Uint8Array; stateUnits?: number;
}) {
  if (!options.plan.requiredFeePayer) throw new Error('Use Multisig request execution for a Multisig plan');
  const signer = await resolveSigner(options.client, options.signer.address, options.signer.privateKey);
  const calls = await coreExecutionCalls(options.client, options.plan);
  return options.reviewedPlanSha256 === undefined
    ? submitGovernanceAction({ ...options, executor: signer, calls }, 'execute')
    : submitGovernanceTransaction({ ...options, reviewedPlanSha256: options.reviewedPlanSha256, executor: signer, calls });
}
/** Explicit cleanup after confirmed execution; sources remain available throughout review and voting. */
export async function cleanupGovernedDeployment(options: { client: Thru; signer: DeploymentSigner; prepared: PreparedGovernedDeployment }) {
  const signer = await resolveSigner(options.client, options.signer.address, options.signer.privateKey);
  return cleanupUpload(options.client, signer, options.prepared.upload);
}
/** Outcome of cleanupGovernedUpload. `not-owned`: the pair is left in place. */
export type GovernedUploadCleanup =
  | { status: 'absent' }
  | { status: 'not-owned'; reason: string; accounts: string[] }
  | (UploadCleanupResult & { accounts: string[] });
/** Destroy the temporary Uploader pair at `uploadSeed` once the governed
    request that read it has executed, when no PreparedGovernedDeployment is
    in hand: a Multisig request executed by another member, or a rerun after
    execution. The pair is re-derived from the seed and destroyed only when
    `signer` is its upload authority; a pair held by another authority, or a
    buffer with no metadata to prove its authority, is left in place. */
export async function cleanupGovernedUpload(options: {
  client: Thru; signer: DeploymentSigner; uploadSeed: string; artifact: 'program' | 'abi';
}): Promise<GovernedUploadCleanup> {
  const addresses = deriveUploadAddresses(options.uploadSeed);
  const accounts = [addresses.metaAccountAddress, addresses.bufferAccountAddress];
  const [meta, buffer] = await Promise.all(accounts.map((account) => getOptionalAccount(options.client, account)));
  if (!meta && !buffer) return { status: 'absent' };
  if (!meta) return { status: 'not-owned', reason: 'upload buffer has no metadata account naming its authority', accounts };
  let authority: Uint8Array;
  try { authority = parseUploaderMeta(meta).authority; }
  catch (error) { return { status: 'not-owned', reason: error instanceof Error ? error.message : String(error), accounts }; }
  const signer = await resolveSigner(options.client, options.signer.address, options.signer.privateKey);
  if (!bytesEqual(authority, signer.publicKey)) return { status: 'not-owned', reason: 'temporary upload belongs to another authority', accounts };
  const upload = await prepareUpload(options.artifact === 'program' ? 'upgradeProgram' : 'upgradeProgramABI', options.artifact, options.uploadSeed, new Uint8Array());
  return { ...await cleanupUpload(options.client, signer, upload), accounts };
}
