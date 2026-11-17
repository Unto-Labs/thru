import type { Thru } from '@thru/sdk/client';
import { StateProofType } from '@thru/sdk/proto';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
import { CORE_CONFIG_ADDRESS, CORE_PROGRAM_ADDRESS, commitArtifact, validateCreationProof, MAX_CREATION_PROOF_BYTES, type CoreAdminKind, type SourceArtifact } from '../core-manager';
import { address, bound, concat, integer, digestBytes, governanceAccountLayout, sealGovernancePlan, reviewGovernancePlan, assertTransactionCapacity, type GovernanceExecutionMode, type Address, type GovernancePlan } from '../core-manager/plan';
import { deriveManagedProgramAddresses } from '../manager/derivation';
import { deriveOfficialABIAddresses } from './derivation';
import { validateABI } from '../deploy/validation';
import { AbiManagerInstruction } from './abi/thru/program/abi_manager/types';

export type GovernedABIOperation =
  | { kind: 'createMetadata'; seed: string | Uint8Array; ephemeral?: boolean; proof?: Uint8Array }
  | { kind: 'createContent'; seed: string | Uint8Array; ephemeral?: boolean; source: SourceArtifact; proof?: Uint8Array }
  | { kind: 'upgrade'; seed: string | Uint8Array; ephemeral?: boolean; source: SourceArtifact }
  | { kind: 'close' | 'finalize'; seed: string | Uint8Array; ephemeral?: boolean }
  | { kind: 'upgradeRoot'; source: SourceArtifact };
export interface GovernedABIPlanOptions {
  admin: Address; adminKind: CoreAdminKind; operation: GovernedABIOperation; client?: Thru;
  executionAccounts?: { readWrite?: Address[]; readOnly?: Address[] }; feePayerProofBytes?: number;
  multisigRequest?: Address; reviewedStatePlan?: unknown;
  executionMode?: GovernanceExecutionMode;
}
/** Hash exact semantically reviewed YAML bytes, never a reserialized document or the ABI header. */
export async function buildGovernedABIOperationPlan(options: GovernedABIPlanOptions): Promise<GovernancePlan> {
  const op = options.operation, root = op.kind === 'upgradeRoot';
  const ephemeral = !root && !!op.ephemeral;
  const managed = !root ? deriveManagedProgramAddresses(op.seed, ephemeral, CORE_PROGRAM_ADDRESS) : undefined;
  const subject = managed?.programAccountAddress ?? CORE_PROGRAM_ADDRESS;
  const abi = deriveOfficialABIAddresses(subject, ephemeral);
  const requiredFeePayer = options.adminKind === 'eoa' ? address(options.admin) : undefined;
  const rw: Address[] = [abi.abiMetaAccountAddress, ...options.executionAccounts?.readWrite ?? []];
  const ro: Address[] = [BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager, CORE_CONFIG_ADDRESS, subject, ...options.executionAccounts?.readOnly ?? []];
  const multisig = options.multisigRequest ? { address: address(options.admin), request: address(options.multisigRequest) } : undefined;
  if (multisig) {
    if (options.adminKind !== 'multisig') throw new Error('EOA plan cannot bind a Multisig request');
    rw.push(multisig.address, multisig.request); ro.push(BOOTSTRAP_PROGRAM_ADDRESSES.multisig);
  }
  if (managed) ro.push(managed.programMetaAccountAddress);
  if (!requiredFeePayer) ro.push(options.admin);
  if (op.kind !== 'createMetadata') rw.push(abi.abiAccountAddress);
  const commitments = 'source' in op ? [await commitArtifact(op.source, false)] : [];
  if ('source' in op) {
    const c = commitments[0];
    await validateABI(op.source.bytes.subarray(c.offset, c.offset + c.length), options.client);
    ro.push(c.address);
  }
  const accounts = governanceAccountLayout(rw, ro.filter(a => address(a) !== requiredFeePayer), BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager, !!requiredFeePayer, options.executionMode);
  const tag = op.kind === 'upgradeRoot' ? 0x0e : op.kind === 'createMetadata' ? (ephemeral ? 0x10 : 0x0f) : op.kind === 'createContent' ? (ephemeral ? 0x12 : 0x11) : op.kind === 'upgrade' ? 0x13 : op.kind === 'close' ? 0x14 : 0x15;
  const zeroBound = new Uint8Array(34), c = commitments[0];
  const parts = [integer(tag, 1), bound(accounts, CORE_CONFIG_ADDRESS), bound(accounts, options.admin, requiredFeePayer), bound(accounts, subject), managed ? bound(accounts, managed.programMetaAccountAddress) : zeroBound,
    bound(accounts, abi.abiMetaAccountAddress), op.kind === 'createMetadata' ? zeroBound : bound(accounts, abi.abiAccountAddress), c ? bound(accounts, c.address) : zeroBound,
    integer(c?.offset ?? 0, 4), integer(c?.length ?? 0, 4), c ? digestBytes(c.sha256) : new Uint8Array(32)];
  if ((op.kind === 'createMetadata' || op.kind === 'createContent') && !ephemeral) {
    let proof = op.proof;
    if (!proof && options.client) proof = (await options.client.proofs.generate({ address: op.kind === 'createMetadata' ? abi.abiMetaAccountAddress : abi.abiAccountAddress, proofType: StateProofType.CREATING })).proof;
    if (!proof) throw new Error('Permanent ABI creation requires a creation proof');
    validateCreationProof(proof); parts.push(proof);
  }
  const instruction = concat(...parts);
  const validation = AbiManagerInstruction.validate(instruction);
  if (!validation.ok || validation.consumed !== instruction.length) throw new Error('Governed ABI instruction disagrees with generated ABI');
  assertTransactionCapacity(accounts, (accounts.transactionProgram === BOOTSTRAP_PROGRAM_ADDRESSES.multicall ? 12 : 0) + instruction.length, options.feePayerProofBytes ?? MAX_CREATION_PROOF_BYTES);
  const stateUnits = op.kind === 'createMetadata' ? 1 : c ? Math.ceil((64 + 45 + c.length) / 4096) : 0;
  const plan = await sealGovernancePlan({ version: 1, operation: `abi:${op.kind}`, program: BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager, accounts, instruction, commitments, requiredFeePayer, stateUnits, multisig });
  return options.reviewedStatePlan === undefined ? plan : reviewGovernancePlan(plan, options.reviewedStatePlan);
}
