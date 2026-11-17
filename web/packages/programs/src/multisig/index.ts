import { deriveProgramAddress } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { StateProofType } from '@thru/sdk/proto';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
import { normalizeSeed, padSeed } from '../utils/helpers';
import { refreshCoreProofSlot, validateCreationProof, MAX_CREATION_PROOF_BYTES } from '../core-manager';
import { address, key, hex, equal, concat, integer, sha256, digestBytes, accountSlot, fixedAccountLayout, sealGovernancePlan, assertGovernancePlan, assertTransactionCapacity, usesMulticall, buildGovernanceTransaction, buildGovernanceTransactions, governanceRequestPayload, submitGovernanceAction, submitGovernanceTransaction, type GovernanceExecutionMode, type Address, type GovernancePlan, type GovernanceCall } from '../core-manager/plan';
import { parseMultisigState, parseMultisigRequest, assertCurrentRequest } from './state';
import { MultisigInstruction } from './abi/thru/program/multisig/types';
export * from './state';
export * as MultisigABI from './abi/thru/program/multisig/types';
function checkedMultisigInstruction(instruction: Uint8Array): Uint8Array {
  const validation = MultisigInstruction.validate(instruction);
  if (!validation.ok || validation.consumed !== instruction.length) throw new Error('Multisig instruction disagrees with generated ABI');
  return instruction;
}
export const MULTISIG_PROGRAM_ADDRESS = BOOTSTRAP_PROGRAM_ADDRESSES.multisig;
export function deriveMultisigAccount(seed: string | Uint8Array): string {
  return deriveProgramAddress({ programAddress: MULTISIG_PROGRAM_ADDRESS, seed: normalizeSeed(seed) }).address;
}
export async function inspectMultisig(client: Thru, multisig: Address) {
  const account = await client.accounts.get(address(multisig));
  if (!account.meta?.owner?.equals(MULTISIG_PROGRAM_ADDRESS) || account.meta.flags.isProgram || account.meta.flags.isDeleted || account.meta.flags.isCompressed) throw new Error('Not a Multisig state account');
  return parseMultisigState(account.data?.data ?? new Uint8Array());
}
export async function inspectMultisigRequest(client: Thru, multisig: Address, requestAddress: Address) {
  const [state, account] = await Promise.all([inspectMultisig(client, multisig), client.accounts.get(address(requestAddress))]);
  if (!account.meta?.owner?.equals(MULTISIG_PROGRAM_ADDRESS) || account.meta.flags.isProgram || account.meta.flags.isDeleted || account.meta.flags.isCompressed) throw new Error('Not a Multisig request account');
  const request = parseMultisigRequest(account.data?.data ?? new Uint8Array());
  if (request.multisig !== address(multisig)) throw new Error('Request belongs to another Multisig');
  assertCurrentRequest(state, request);
  return { state, request, ready: request.approvals >= request.requiredApprovals };
}
/** The request stores exact child bytes and fixed coordinates, never executor-relative indexes. */
export async function buildMultisigInvokeRequest(plan: GovernancePlan): Promise<Uint8Array> {
  await assertGovernancePlan(plan);
  if (plan.requiredFeePayer) throw new Error('EOA plan cannot be approved as a Multisig request');
  const payload = governanceRequestPayload(plan).data;
  // Only atomic Multicall execution carries the two creation proofs alongside Execute.
  assertTransactionCapacity(plan.accounts, 8 + (usesMulticall(plan) ? 12 + (plan.proofSlot ? 10 + 75 + 2 * MAX_CREATION_PROOF_BYTES : 0) : 0), MAX_CREATION_PROOF_BYTES);
  return payload;
}
export type MultisigManagementOperation =
  | { kind: 'updateThreshold'; threshold: number }
  | { kind: 'updateMembership'; members: Address[] }
  | { kind: 'deleteMultisig' };
export async function buildMultisigManagementPlan(multisig: Address, request: Address, operation: MultisigManagementOperation, executionMode: GovernanceExecutionMode = 'multicall'): Promise<GovernancePlan> {
  const accounts = fixedAccountLayout([multisig, request], [MULTISIG_PROGRAM_ADDRESS], executionMode === 'direct' ? MULTISIG_PROGRAM_ADDRESS : BOOTSTRAP_PROGRAM_ADDRESSES.multicall);
  let instruction: Uint8Array;
  if (operation.kind === 'updateThreshold') {
    if (!Number.isInteger(operation.threshold) || operation.threshold < 1 || operation.threshold > 32) throw new Error('Invalid Multisig threshold');
    instruction = concat(integer(operation.threshold, 2), integer(0, 2));
  } else if (operation.kind === 'updateMembership') {
    const members = operation.members.map(key).sort((a, b) => hex(a).localeCompare(hex(b)));
    if (members.length < 2 || members.length > 32 || members.some((member, i) => member.every(x => x === 0) || i > 0 && equal(member, members[i - 1]))) throw new Error('Invalid or duplicate Multisig members');
    instruction = concat(integer(members.length, 2), integer(0, 2), ...members);
  } else {
    instruction = new Uint8Array();
  }
  return sealGovernancePlan({ version: 1, operation: `multisig:${operation.kind}`, program: MULTISIG_PROGRAM_ADDRESS, accounts, instruction, commitments: [], multisig: { address: address(multisig), request: address(request) } });
}
async function reviewedRequest(plan: GovernancePlan): Promise<{ kind: number; data: Uint8Array }> {
  await assertGovernancePlan(plan);
  return governanceRequestPayload(plan);
}
export interface MultisigWorkflowOptions {
  client: Thru; plan: GovernancePlan; multisig: Address; request: Address;
  executor: { publicKey: Uint8Array; privateKey: Uint8Array }; reviewedPlanSha256?: string;
  feePayerStateProof?: Uint8Array; feePayerAccountMetaRaw?: Uint8Array; stateUnits?: number;
}
function indices(options: MultisigWorkflowOptions): Uint8Array {
  const { accounts } = options.plan;
  if (options.plan.multisig?.address !== address(options.multisig) || options.plan.multisig.request !== address(options.request)) throw new Error('Multisig identity differs from approved execution plan');
  for (const target of [options.multisig, options.request]) if (!accounts.readWrite.includes(address(target))) throw new Error('Multisig and request must occupy approved writable slots');
  accountSlot(accounts, MULTISIG_PROGRAM_ADDRESS);
  return concat(integer(accountSlot(accounts, options.multisig), 2), integer(accountSlot(accounts, options.request), 2));
}
/** Execution notifications can precede query visibility (see
    submitGovernanceAction), so a workflow step returns only once GetAccount
    reflects it. Otherwise the next read right after a proposal finds no
    request ([not_found]) or stale approvals (UNTO-3561). `reached` sees the
    live request, or undefined once it is gone (executed or deleted). */
export const MULTISIG_VISIBILITY_TIMEOUT_MS = 60_000;
async function awaitRequestVisibility(client: Thru, request: Address, what: string, reached: (live: ReturnType<typeof parseMultisigRequest> | undefined) => boolean): Promise<void> {
  const deadline = Date.now() + MULTISIG_VISIBILITY_TIMEOUT_MS;
  for (;;) {
    let live: ReturnType<typeof parseMultisigRequest> | undefined;
    try {
      const account = await client.accounts.get(address(request));
      if (!account.meta?.flags.isDeleted) live = parseMultisigRequest(account.data?.data ?? new Uint8Array());
    } catch (cause) {
      if ((cause as { code?: number } | null)?.code !== 5) throw cause;
    }
    if (reached(live)) return;
    if (Date.now() >= deadline) throw new Error(`Multisig request ${address(request)}: ${what} not visible to queries within ${MULTISIG_VISIBILITY_TIMEOUT_MS / 1000}s`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
export async function proposeMultisigRequest(options: MultisigWorkflowOptions & { requestSeed: string | Uint8Array }) {
  const reviewed = await reviewedRequest(options.plan), payload = reviewed.data;
  const state = await inspectMultisig(options.client, options.multisig);
  if (!state.members.includes(address(options.executor.publicKey))) throw new Error('Proposer is not a Multisig member');
  if (state.liveRequests >= 65535 || state.nextRequestId === 0xffffffffffffffffn) throw new Error('Multisig request limit reached');
  if (reviewed.kind === 1 && new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0, true) > state.members.length) throw new Error('Threshold exceeds current member count');
  if (deriveMultisigAccount(options.requestSeed) !== address(options.request)) throw new Error('Request seed/address mismatch');
  const proof = await options.client.proofs.generate({ address: address(options.request), proofType: StateProofType.CREATING });
  validateCreationProof(proof.proof);
  const instruction = concat(integer(1, 4), indices(options), integer(0, 2), integer(reviewed.kind, 1), integer(0, 1), padSeed(options.requestSeed), integer(payload.length, 8), integer(proof.proof.length, 8), payload, proof.proof);
  const receipt = await submitGovernanceAction({ ...options, stateUnits: Math.ceil((64 + 104 + payload.length) / 4096), calls: [{ program: MULTISIG_PROGRAM_ADDRESS, instruction: checkedMultisigInstruction(instruction) }] }, 'propose');
  await awaitRequestVisibility(options.client, options.request, 'proposal', live => live !== undefined);
  return { operation: 'proposed' as const, request: address(options.request), transaction_id: receipt.transaction_id };
}
async function approvalCall(options: MultisigWorkflowOptions): Promise<{ call: GovernanceCall; state: Awaited<ReturnType<typeof inspectMultisig>>; request: ReturnType<typeof parseMultisigRequest> }> {
  const { state, request } = await inspectMultisigRequest(options.client, options.multisig, options.request);
  const member = state.members.indexOf(address(options.executor.publicKey));
  if (member < 0) throw new Error('Approver is not a Multisig member');
  if (request.approvalBitmap & 1n << BigInt(member)) throw new Error('Member already approved');
  const reviewed = await reviewedRequest(options.plan);
  if (request.kind !== reviewed.kind || !equal(request.data, reviewed.data)) throw new Error('On-chain request differs from reviewed operation');
  // Bind the approval to the request generation and contents just reviewed.
  const instruction = concat(integer(2, 4), indices(options), integer(0, 2), integer(request.id, 8), digestBytes(await sha256(request.data)));
  return { call: { program: MULTISIG_PROGRAM_ADDRESS, instruction: checkedMultisigInstruction(instruction) }, state, request };
}
export async function approveMultisigRequest(options: MultisigWorkflowOptions) {
  const { call, state, request } = await approvalCall(options);
  const receipt = await submitGovernanceAction({ ...options, stateUnits: 0, calls: [call] }, 'approve');
  const member = state.members.indexOf(address(options.executor.publicKey));
  await awaitRequestVisibility(options.client, options.request, 'approval', live => !live || live.id !== request.id || (live.approvalBitmap & 1n << BigInt(member)) !== 0n);
  return { operation: 'approved' as const, request: address(options.request), transaction_id: receipt.transaction_id };
}
/** True when one more approval reaches the threshold and the plan can carry
    approve + Execute in one Multicall transaction. */
export function canApproveAndExecute(plan: GovernancePlan, request: { approvals: number; requiredApprovals: number }): boolean {
  return !!plan.multisig && usesMulticall(plan) && request.approvals + 1 >= request.requiredApprovals;
}
/** The final approval and the Execute in ONE transaction (UNTO-3561): the
    approver's signature and the execution are atomic, so the approved request
    cannot execute later against changed inputs, and a failed execution also
    reverts the approval. Refuses unless this approval reaches the threshold. */
export async function approveAndExecuteMultisigRequest(options: MultisigWorkflowOptions) {
  const { call, state, request } = await approvalCall(options);
  if (!canApproveAndExecute(options.plan, request)) throw new Error('This approval does not reach the threshold, or the plan does not execute through Multicall');
  if (request.kind === 3 && state.liveRequests !== 1) throw new Error('Multisig has outstanding requests');
  const calls = [call, ...await executeCalls(options)];
  const receipt = options.reviewedPlanSha256 === undefined
    ? await submitGovernanceAction({ ...options, calls }, 'approve-execute')
    : await submitGovernanceTransaction({ ...options, reviewedPlanSha256: options.reviewedPlanSha256, calls }, 'approve-execute');
  // Execute deletes the request account.
  await awaitRequestVisibility(options.client, options.request, 'approval and execution', live => live === undefined);
  return { operation: 'approved-and-executed' as const, request: address(options.request), ...receipt };
}
async function executeCalls(options: Pick<MultisigWorkflowOptions, 'client' | 'plan' | 'multisig' | 'request'>): Promise<GovernanceCall[]> {
  for (const target of [options.multisig, options.request]) if (!options.plan.accounts.readWrite.includes(address(target))) throw new Error('Multisig and request must be writable');
  const instruction = concat(integer(3, 4), integer(accountSlot(options.plan.accounts, options.multisig), 2), integer(accountSlot(options.plan.accounts, options.request), 2));
  return [...(options.plan.proofSlot ? [await refreshCoreProofSlot(options.client, options.plan)] : []), { program: MULTISIG_PROGRAM_ADDRESS, instruction: checkedMultisigInstruction(instruction) }];
}
export async function multisigExecutionCalls(options: Pick<MultisigWorkflowOptions, 'client' | 'plan' | 'multisig' | 'request'>): Promise<GovernanceCall[]> {
  const { state, request, ready } = await inspectMultisigRequest(options.client, options.multisig, options.request);
  if (!ready) throw new Error('Multisig request has insufficient approvals');
  const reviewed = await reviewedRequest(options.plan);
  if (request.kind !== reviewed.kind || !equal(request.data, reviewed.data)) throw new Error('On-chain request differs from reviewed operation');
  if (request.kind === 3 && state.liveRequests !== 1) throw new Error('Multisig has outstanding requests');
  return executeCalls(options);
}
export async function executeMultisigRequest(options: MultisigWorkflowOptions) {
  const calls = await multisigExecutionCalls(options);
  const receipt = options.reviewedPlanSha256 === undefined
    ? await submitGovernanceAction({ ...options, calls }, 'execute')
    : await submitGovernanceTransaction({ ...options, reviewedPlanSha256: options.reviewedPlanSha256, calls });
  // Execute deletes the request account.
  await awaitRequestVisibility(options.client, options.request, 'execution', live => live === undefined);
  return receipt;
}
export async function buildMultisigExecutionTransaction(options: MultisigWorkflowOptions) {
  return buildGovernanceTransaction(options.plan, options.executor.publicKey, await multisigExecutionCalls(options), options.feePayerStateProof?.length);
}
/** Direct permanent creation returns a proof-refresh transaction followed by the approved Execute. */
export async function buildMultisigExecutionTransactions(options: MultisigWorkflowOptions) {
  return buildGovernanceTransactions(options.plan, options.executor.publicKey, await multisigExecutionCalls(options), options.feePayerStateProof?.length);
}
