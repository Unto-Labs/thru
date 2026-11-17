import { deriveProgramAddress } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { StateProofType } from '@thru/sdk/proto';
import { getWebCrypto } from '@thru/sdk/helpers';
import { CORE_CONFIG_SEED } from '../bootstrap-addresses/registry';
import { BOOTSTRAP_PROGRAM_ADDRESSES, BOOTSTRAP_PROGRAM_PAIRS, BOOTSTRAP_PROGRAM_SEEDS } from '../bootstrap-addresses';
import { deriveManagedProgramAddresses } from '../manager/derivation';
import type { ManagedProgramAddresses } from '../manager/types';
import { CORE_MANAGER_PROGRAM_ADDRESS } from '../manager/constants';
import { CoreInstruction, CoreManagerAccount } from './abi/thru/program/core_manager/types';
import { decodeAccountRoot } from '../utils/account-root';
import { parseMultisigState } from '../multisig/state';
import { validateManagerProgramImage } from '../manager/validation';
import { normalizeSeed, padSeed } from '../utils/helpers';
import { address, key, equal, concat, integer, digestBytes, sha256, bound, governanceAccountLayout, proofSlotAccounts, sealGovernancePlan, reviewGovernancePlan, assertGovernancePlan, assertTransactionCapacity, type GovernanceExecutionMode, type Address, type ArtifactCommitment, type FixedAccountLayout, type GovernancePlan, type GovernanceCall } from './plan';
export * from './plan';
export { validateReviewedStateOperation, canonicalReviewedJson } from './reviewed-state';
export type { ReviewedOperationWire } from './reviewed-state';
export { verifyProgramState } from './live-state';
export type { ProgramStateClient, ProgramStateVerificationOptions } from './live-state';
export * as CoreABI from './abi/thru/program/core_manager/types';

export const CORE_PROGRAM_ADDRESS = CORE_MANAGER_PROGRAM_ADDRESS;
export const CORE_CONFIG_ADDRESS = deriveProgramAddress({ programAddress: CORE_PROGRAM_ADDRESS, seed: normalizeSeed(CORE_CONFIG_SEED) }).address;
/** Core B (UNTO-3561): the Core A-managed pair at seed "thru-core-peer:v1",
    running the Core binary. Its executable owns Core A's. */
export const CORE_PEER_SEED = BOOTSTRAP_PROGRAM_SEEDS.core_peer_manager;
export const CORE_PEER_PROGRAM_ADDRESS = BOOTSTRAP_PROGRAM_ADDRESSES.core_peer_manager;
export const CORE_PEER_CONFIG_ADDRESS = deriveProgramAddress({ programAddress: CORE_PEER_PROGRAM_ADDRESS, seed: normalizeSeed(CORE_CONFIG_SEED) }).address;
/** Which Core instance executes an operation. Only `upgradePeer` runs on Core B; admin rotation runs on Core A and moves both configs. */
export type CoreInstance = 'a' | 'b';
export const MAX_CREATION_PROOF_BYTES = 8296;
export type CoreAdminKind = 'eoa' | 'multisig';
export interface CoreConfig { adminKind: CoreAdminKind; admin: string; pending?: { kind: CoreAdminKind; address: string } }
/** Core Manager account discriminators (byte 0). Program metadata shares the
    Manager layout and value. Values are never reused. */
export const CORE_ACCOUNT_TYPE_PROGRAM_META_V1 = 1;
export const CORE_ACCOUNT_TYPE_CONFIG_V1 = 2;
export const CORE_ACCOUNT_TYPE_PROOF_SLOT_V1 = 3;
/** Decodes Core Manager account data through its account root (byte 0 is the
    account type); null for any other type or a fixed-size kind of the wrong size. */
export function decodeCoreManagerAccount(data: Uint8Array): CoreManagerAccount | null {
  return decodeAccountRoot(data, (bytes) => CoreManagerAccount.from_array(bytes));
}
const adminKind = (kind: number): CoreAdminKind => kind === 1 ? 'eoa' : 'multisig';
export function parseCoreConfig(data: Uint8Array): CoreConfig {
  const config = decodeCoreManagerAccount(data)?.payload().asConfigV1();
  if (!config || ![1, 2].includes(config.get_admin_kind()) || config.get_pending_present() > 1 || config.get_reserved().some(Boolean)) throw new Error('Invalid Core config');
  const adminBytes = Uint8Array.from(config.get_admin().get_bytes());
  const pendingBytes = Uint8Array.from(config.get_pending_admin().get_bytes());
  if (adminBytes.every(x => x === 0)) throw new Error('Missing Core admin');
  const admin = address(adminBytes);
  if (!config.get_pending_present()) {
    if (config.get_pending_admin_kind() || pendingBytes.some(Boolean)) throw new Error('Invalid absent pending admin');
    return { adminKind: adminKind(config.get_admin_kind()), admin };
  }
  if (![1, 2].includes(config.get_pending_admin_kind()) || pendingBytes.every(x => x === 0)) throw new Error('Invalid pending admin');
  return { adminKind: adminKind(config.get_admin_kind()), admin, pending: { kind: adminKind(config.get_pending_admin_kind()), address: address(pendingBytes) } };
}
export function parseCoreManagedMetadata(data: Uint8Array) {
  const meta = decodeCoreManagerAccount(data)?.payload().asProgramMetaV1();
  if (!meta || meta.get_authority_candidate().get_bytes().some(Boolean) || ![0, 1, 2].includes(meta.get_state())) throw new Error('Invalid Core metadata');
  return { applicationAuthority: address(Uint8Array.from(meta.get_authority().get_bytes())), version: meta.get_version(), state: meta.get_state() };
}
export async function inspectCoreGovernance(client: Thru, core: CoreInstance = 'a') {
  const program = core === 'b' ? CORE_PEER_PROGRAM_ADDRESS : CORE_PROGRAM_ADDRESS;
  const configAddress = core === 'b' ? CORE_PEER_CONFIG_ADDRESS : CORE_CONFIG_ADDRESS;
  const account = await client.accounts.get(configAddress);
  if (!account.meta?.owner?.equals(program) || account.meta.flags.isProgram || account.meta.flags.isDeleted || account.meta.flags.isCompressed || account.meta.flags.isEphemeral || !account.meta.flags.isUncompressable || !account.data?.data) throw new Error('Invalid Core config account');
  const config = parseCoreConfig(account.data.data);
  const admin = await client.accounts.get(config.admin);
  const protectedOwner = config.adminKind === 'eoa' ? BOOTSTRAP_PROGRAM_ADDRESSES.eoa : BOOTSTRAP_PROGRAM_ADDRESSES.multisig;
  if (!admin.meta?.owner?.equals(protectedOwner) || admin.meta.flags.isProgram || admin.meta.flags.isDeleted || admin.meta.flags.isCompressed) throw new Error('Invalid current Core admin');
  if (config.adminKind === 'multisig') {
    parseMultisigState(admin.data?.data ?? new Uint8Array());
  }
  if (config.pending) {
    const pending = await client.accounts.get(config.pending.address);
    const owner = config.pending.kind === 'eoa' ? BOOTSTRAP_PROGRAM_ADDRESSES.eoa : BOOTSTRAP_PROGRAM_ADDRESSES.multisig;
    if (!pending.meta?.owner?.equals(owner) || pending.meta.flags.isProgram || pending.meta.flags.isDeleted || pending.meta.flags.isCompressed) throw new Error('Invalid pending Core admin');
    if (config.pending.kind === 'multisig') parseMultisigState(pending.data?.data ?? new Uint8Array());
  }
  const protectedMetadata = BOOTSTRAP_PROGRAM_PAIRS[config.adminKind === 'eoa' ? 'eoa' : 'multisig'].programMetaAccountAddress;
  return { ...config, configAddress, protectedOwner, protectedMetadata };
}
export async function inspectCoreManagedProgram(client: Thru, seed: string | Uint8Array, ephemeral = false) {
  const pair = deriveManagedProgramAddresses(seed, ephemeral, CORE_PROGRAM_ADDRESS);
  const [metadata, program] = await Promise.all([client.accounts.get(pair.programMetaAccountAddress), client.accounts.get(pair.programAccountAddress)]);
  if (!metadata.meta?.owner?.equals(CORE_PROGRAM_ADDRESS) || !program.meta?.owner?.equals(CORE_PROGRAM_ADDRESS)) throw new Error('Not a Core-managed pair');
  return { ...pair, metadata: parseCoreManagedMetadata(metadata.data?.data ?? new Uint8Array()), program };
}
export interface SourceArtifact { address: Address; bytes: Uint8Array; offset?: number; length?: number }
export async function commitArtifact(source: SourceArtifact, image: boolean): Promise<ArtifactCommitment> {
  const offset = source.offset ?? 0, length = source.length ?? source.bytes.length - offset;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > source.bytes.length || offset + length > 0xffffffff) throw new Error('Invalid artifact range');
  const bytes = source.bytes.subarray(offset, offset + length);
  if (image) validateManagerProgramImage(bytes);
  return { address: address(source.address), offset, length, sha256: await sha256(bytes) };
}
export type CoreOperation =
  | { kind: 'createPermanent' | 'createEphemeral'; seed: string | Uint8Array; source: SourceArtifact; applicationAuthority?: Address; pin: boolean; proofSlotSeed?: Uint8Array }
  | { kind: 'upgrade'; seed: string | Uint8Array; ephemeral?: boolean; source: SourceArtifact }
  | { kind: 'setPause'; seed: string | Uint8Array; ephemeral?: boolean; paused: boolean }
  | { kind: 'destroy' | 'finalize'; seed: string | Uint8Array; ephemeral?: boolean }
  | { kind: 'setApplicationAuthority'; seed: string | Uint8Array; ephemeral?: boolean; applicationAuthority: Address }
  | { kind: 'setPin'; target: Address; pin: boolean }
  /** Admin rotation always moves both Core configs: it runs on Core A, which
      invokes Core B with the mirrored instruction in the same transaction. */
  | { kind: 'proposeAdmin'; candidate: Address; candidateKind: CoreAdminKind }
  | { kind: 'acceptAdmin' }
  /** Core B replaces Core A's executable. Core A upgrades Core B with `upgrade` at `CORE_PEER_SEED`. */
  | { kind: 'upgradePeer'; source: SourceArtifact };
export interface CorePlanOptions {
  admin: Address; adminKind: CoreAdminKind; operation: CoreOperation;
  /** Include the Multisig state, request, and executable before collecting approvals. */
  executionAccounts?: { readWrite?: Address[]; readOnly?: Address[] };
  feePayerProofBytes?: number;
  multisigRequest?: Address;
  reviewedStatePlan?: unknown;
  /** Omit for atomic Multicall by default, or automatic direct execution when governing Multicall itself. */
  executionMode?: GovernanceExecutionMode;
}
export function createCoreProofSlotSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  seed.set(new TextEncoder().encode('coreprf1'));
  getWebCrypto().getRandomValues(seed.subarray(8));
  return seed;
}
export function deriveCoreProofSlot(seed: Uint8Array): string {
  if (seed.length !== 32 || new TextDecoder().decode(seed.subarray(0, 8)) !== 'coreprf1') throw new Error('Proof-slot seed must start with coreprf1 and contain 32 bytes');
  return deriveProgramAddress({ programAddress: CORE_PROGRAM_ADDRESS, seed, ephemeral: true }).address;
}
export async function buildCoreOperationPlan(options: CorePlanOptions): Promise<GovernancePlan> {
  const { operation: op } = options;
  const onB = op.kind === 'upgradePeer';
  const rotation = op.kind === 'proposeAdmin' || op.kind === 'acceptAdmin';
  const caller = onB ? CORE_PEER_PROGRAM_ADDRESS : CORE_PROGRAM_ADDRESS;
  const callerConfig = onB ? CORE_PEER_CONFIG_ADDRESS : CORE_CONFIG_ADDRESS;
  const peer = op.kind === 'upgradePeer' ? CORE_PROGRAM_ADDRESS : undefined;
  const requiredFeePayer = options.adminKind === 'eoa' ? address(options.admin) : undefined;
  const rw: Address[] = [...options.executionAccounts?.readWrite ?? []];
  const ro: Address[] = [caller, ...options.executionAccounts?.readOnly ?? []];
  const multisig = options.multisigRequest ? { address: address(options.admin), request: address(options.multisigRequest) } : undefined;
  if (multisig) {
    if (options.adminKind !== 'multisig') throw new Error('EOA plan cannot bind a Multisig request');
    rw.push(multisig.address, multisig.request); ro.push(BOOTSTRAP_PROGRAM_ADDRESSES.multisig);
  }
  if (rotation) { rw.push(callerConfig, CORE_PEER_CONFIG_ADDRESS); ro.push(CORE_PEER_PROGRAM_ADDRESS); } else ro.push(callerConfig);
  if (peer) rw.push(peer);
  if (!requiredFeePayer) ro.push(options.admin);
  let pair: ManagedProgramAddresses | undefined;
  if ('seed' in op) {
    const seed = padSeed(op.seed);
    if (new TextDecoder().decode(seed.subarray(0, 8)) === 'coreprf1' || equal(seed, padSeed(CORE_CONFIG_SEED))) throw new Error('Reserved Core seed');
    pair = deriveManagedProgramAddresses(seed, op.kind === 'createEphemeral' || ('ephemeral' in op && !!op.ephemeral), CORE_PROGRAM_ADDRESS);
    rw.push(pair.programMetaAccountAddress, pair.programAccountAddress);
  }
  if (op.kind === 'setPin') rw.push(op.target);
  if (op.kind === 'proposeAdmin') ro.push(op.candidate);
  const commitments = 'source' in op ? [await commitArtifact(op.source, true)] : [];
  if (commitments.length) ro.push(commitments[0].address);
  const proofSlotSeed = op.kind === 'createPermanent' ? new Uint8Array(op.proofSlotSeed ?? createCoreProofSlotSeed()) : undefined;
  const proofSlot = proofSlotSeed ? { address: deriveCoreProofSlot(proofSlotSeed), seed: proofSlotSeed, metadata: pair!.programMetaAccountAddress, program: pair!.programAccountAddress } : undefined;
  if (proofSlot) rw.push(proofSlot.address);
  const accounts = governanceAccountLayout(rw, ro.filter(a => address(a) !== requiredFeePayer), caller, !!requiredFeePayer, options.executionMode);
  const tags = { createPermanent: 0, createEphemeral: 1, upgrade: 2, setPause: 3, destroy: 4, finalize: 5, setApplicationAuthority: 6, setPin: 7, proposeAdmin: 8, acceptAdmin: 9, upgradePeer: 11 };
  const parts = [integer(tags[op.kind], 1), bound(accounts, callerConfig), bound(accounts, options.admin, requiredFeePayer)];
  if (peer) parts.push(bound(accounts, peer));
  if (pair) parts.push(bound(accounts, pair.programMetaAccountAddress), bound(accounts, pair.programAccountAddress));
  if (op.kind === 'createPermanent' || op.kind === 'createEphemeral') parts.push(padSeed(op.seed));
  if (commitments.length) { const c = commitments[0]; parts.push(bound(accounts, c.address), integer(c.offset, 4), integer(c.length, 4), digestBytes(c.sha256)); }
  if (op.kind === 'createPermanent' || op.kind === 'createEphemeral') parts.push(op.applicationAuthority ? key(op.applicationAuthority) : new Uint8Array(32), integer(Number(op.pin), 1));
  if (proofSlot) parts.push(bound(accounts, proofSlot.address), proofSlot.seed);
  if (op.kind === 'setPause') parts.push(integer(Number(op.paused), 1));
  if (op.kind === 'setApplicationAuthority') parts.push(key(op.applicationAuthority));
  if (op.kind === 'setPin') parts.push(bound(accounts, op.target), integer(Number(op.pin), 1));
  if (op.kind === 'proposeAdmin') parts.push(bound(accounts, op.candidate), integer(op.candidateKind === 'eoa' ? 1 : 2, 1));
  if (rotation) parts.push(bound(accounts, CORE_PEER_PROGRAM_ADDRESS), bound(accounts, CORE_PEER_CONFIG_ADDRESS));
  const instruction = concat(...parts);
  const validation = CoreInstruction.validate(instruction);
  if (!validation.ok || validation.consumed !== instruction.length) throw new Error('Core instruction disagrees with generated ABI');
  const wrapped = accounts.transactionProgram === BOOTSTRAP_PROGRAM_ADDRESSES.multicall;
  assertTransactionCapacity(accounts, (wrapped ? 12 : 0) + instruction.length + (proofSlot && wrapped ? 10 + 75 + MAX_CREATION_PROOF_BYTES * 2 : 0), options.feePayerProofBytes ?? MAX_CREATION_PROOF_BYTES);
  const stateUnits = (commitments.length ? Math.ceil((64 + commitments[0].length) / 4096) : 0)
    + (op.kind === 'createPermanent' || op.kind === 'createEphemeral' ? 1 : 0)
    + (proofSlot ? Math.ceil((64 + 20 + 2 * MAX_CREATION_PROOF_BYTES) / 4096) : 0);
  const plan = await sealGovernancePlan({ version: 1, operation: op.kind, program: caller, accounts, instruction, commitments, proofSlot, requiredFeePayer, stateUnits, multisig });
  return options.reviewedStatePlan === undefined ? plan : reviewGovernancePlan(plan, options.reviewedStatePlan);
}
export function validateCreationProof(proof: Uint8Array): void {
  if (proof.length < 104 || proof.length > MAX_CREATION_PROOF_BYTES) throw new Error('Invalid creation proof size');
  const view = new DataView(proof.buffer, proof.byteOffset, proof.byteLength);
  if (view.getBigUint64(0, true) >> 62n !== 2n) throw new Error('Not a creation proof');
  let count = 0;
  for (const byte of proof.subarray(8, 40)) { let n = byte; while (n) { count++; n &= n - 1; } }
  if (proof.length !== 104 + count * 32) throw new Error('Truncated or trailing creation proof');
}
export async function refreshCoreProofSlot(client: Thru, plan: GovernancePlan): Promise<GovernanceCall> {
  await assertGovernancePlan(plan);
  if (!plan.proofSlot) throw new Error('Plan does not create a permanent Core program');
  const slot = plan.proofSlot;
  const [metadata, program] = await Promise.all([client.proofs.generate({ address: slot.metadata, proofType: StateProofType.CREATING }), client.proofs.generate({ address: slot.program, proofType: StateProofType.CREATING })]);
  return { program: CORE_PROGRAM_ADDRESS, instruction: buildWriteProofSlot(proofSlotAccounts(plan), slot.seed, metadata.proof, program.proof) };
}
export function buildWriteProofSlot(accounts: FixedAccountLayout, seed: Uint8Array, metadataProof: Uint8Array, programProof: Uint8Array): Uint8Array {
  validateCreationProof(metadataProof); validateCreationProof(programProof);
  return concat(integer(10, 1), bound(accounts, deriveCoreProofSlot(seed)), seed, integer(metadataProof.length, 4), integer(programProof.length, 4), metadataProof, programProof);
}
export async function coreExecutionCalls(client: Thru, plan: GovernancePlan): Promise<GovernanceCall[]> {
  await assertGovernancePlan(plan);
  return [...(plan.proofSlot ? [await refreshCoreProofSlot(client, plan)] : []), { program: plan.program, instruction: plan.instruction }];
}
/** Each step requires its own reviewed plan and successful receipt; no protection override exists. */
export function multisigUpgradeBridge(multisig: Address, bridgeEOA: Address, seed: string | Uint8Array, source: SourceArtifact): CoreOperation[] {
  return [{ kind: 'proposeAdmin', candidate: bridgeEOA, candidateKind: 'eoa' }, { kind: 'acceptAdmin' }, { kind: 'upgrade', seed, source }, { kind: 'proposeAdmin', candidate: multisig, candidateKind: 'multisig' }, { kind: 'acceptAdmin' }];
}
