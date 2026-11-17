import { Pubkey, Signature, deriveProgramAddress } from '@thru/sdk';
import { buildMulticallInstruction } from '../multicall';
import type { Thru } from '@thru/sdk/client';
import { getWebCrypto } from '@thru/sdk/helpers';
import { ConsensusStatus } from '@thru/sdk/proto';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
import { parseMultisigRequest, parseMultisigState, assertCurrentRequest } from '../multisig/state';
import { canonicalReviewedJson, validateReviewedStateOperation, reviewedMultisigCandidate } from './reviewed-state';
import { verifyReviewedProgramStates } from './live-state';

export type Address = string | Uint8Array;
export const address = (value: Address): string => Pubkey.from(value).toThruFmt();
export const key = (value: Address): Uint8Array => Pubkey.from(value).toBytes();
export const hex = (value: Uint8Array): string => Array.from(value, x => x.toString(16).padStart(2, '0')).join('');
export const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
export function integer(value: number | bigint, width: 1 | 2 | 4 | 8): Uint8Array {
  const n = BigInt(value);
  if (n < 0n || n >= 1n << BigInt(width * 8)) throw new Error(`Integer exceeds u${width * 8}`);
  const bytes = new Uint8Array(width);
  let remaining = n;
  for (let i = 0; i < width; i++) { bytes[i] = Number(remaining & 255n); remaining >>= 8n; }
  return bytes;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await getWebCrypto().subtle.digest('SHA-256', new Uint8Array(bytes))));
}
export function digestBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Expected lowercase SHA-256');
  return Uint8Array.from(value.match(/../g)!, x => parseInt(x, 16));
}
export interface FixedAccountLayout { transactionProgram: string; readWrite: string[]; readOnly: string[] }
export type GovernanceExecutionMode = 'multicall' | 'direct';
export function fixedAccountLayout(readWrite: Address[], readOnly: Address[], transactionProgram: Address = BOOTSTRAP_PROGRAM_ADDRESSES.multicall): FixedAccountLayout {
  const program = address(transactionProgram);
  const normalize = (items: Address[]) => [...new Set(items.map(address))].sort((a, b) => hex(key(a)).localeCompare(hex(key(b))));
  const rw = normalize(readWrite);
  if (rw.includes(program)) throw new Error('Transaction program cannot occupy a writable fixed slot');
  const ro = normalize(readOnly).filter(a => !rw.includes(a) && a !== program);
  if (rw.length + ro.length > 1022) throw new Error('Transaction account limit exceeded');
  return { transactionProgram: program, readWrite: rw, readOnly: ro };
}
/** Default to atomic Multicall unless it is itself an operand; direct also works while Multicall is paused.
    An explicit 'multicall' mode may also name Multicall as a read-only operand
    (e.g. a Multisig request whose child is a Multicall batch): it then shares
    the transaction-program slot 1, so the stored request coordinates stay fixed. */
export function governanceAccountLayout(readWrite: Address[], readOnly: Address[], target: string, eoa: boolean, mode?: GovernanceExecutionMode): FixedAccountLayout {
  const operand = [...readWrite, ...readOnly].some(a => address(a) === BOOTSTRAP_PROGRAM_ADDRESSES.multicall);
  const direct = mode === 'direct' || mode === undefined && operand;
  if (!direct && readWrite.some(a => address(a) === BOOTSTRAP_PROGRAM_ADDRESSES.multicall)) throw new Error('Multicall operand cannot be writable');
  return fixedAccountLayout(readWrite, readOnly, direct ? eoa ? target : BOOTSTRAP_PROGRAM_ADDRESSES.multisig : BOOTSTRAP_PROGRAM_ADDRESSES.multicall);
}
export function usesMulticall(plan: GovernancePlan): boolean {
  return plan.accounts.transactionProgram === BOOTSTRAP_PROGRAM_ADDRESSES.multicall;
}
export function proofSlotAccounts(plan: GovernancePlan): FixedAccountLayout {
  if (!plan.proofSlot) throw new Error('Plan has no proof slot');
  return usesMulticall(plan) ? plan.accounts : fixedAccountLayout([plan.proofSlot.address], [], BOOTSTRAP_PROGRAM_ADDRESSES.core_manager);
}
export function accountSlot(layout: FixedAccountLayout, value: Address): number {
  if (address(value) === layout.transactionProgram) return 1;
  const index = [...layout.readWrite, ...layout.readOnly].indexOf(address(value));
  if (index < 0) throw new Error(`Missing fixed account ${address(value)}`);
  return index + 2;
}
export function bound(layout: FixedAccountLayout, value: Address, feePayer?: string): Uint8Array {
  return concat(integer(feePayer === address(value) ? 0 : accountSlot(layout, value), 2), key(value));
}
export interface ArtifactCommitment { address: string; offset: number; length: number; sha256: string }
export interface ProofSlotPlan { address: string; seed: Uint8Array; metadata: string; program: string }
export interface GovernancePlan {
  version: 1;
  operation: string;
  program: string;
  accounts: FixedAccountLayout;
  instruction: Uint8Array;
  commitments: ArtifactCommitment[];
  proofSlot?: ProofSlotPlan;
  multisig?: { address: string; request: string };
  reviewedStatePlan?: unknown;
  reviewedStatePlanSha256?: string;
  /** Conservative growth budget; execution can supply a tighter live-state budget. */
  stateUnits?: number;
  /** Set only for an EOA-authorized plan. Multisig execution is executor-independent. */
  requiredFeePayer?: string;
  planSha256: string;
}
function planJSON(plan: Omit<GovernancePlan, 'planSha256'>): string {
  return JSON.stringify({ version: plan.version, operation: plan.operation, program: plan.program,
    accounts: plan.accounts, instruction: hex(plan.instruction), commitments: plan.commitments,
    proofSlot: plan.proofSlot && { ...plan.proofSlot, seed: hex(plan.proofSlot.seed) }, requiredFeePayer: plan.requiredFeePayer, stateUnits: plan.stateUnits,
    multisig: plan.multisig, reviewedStatePlan: plan.reviewedStatePlan, reviewedStatePlanSha256: plan.reviewedStatePlanSha256 });
}
export async function sealGovernancePlan(plan: Omit<GovernancePlan, 'planSha256'>): Promise<GovernancePlan> {
  return { ...plan, planSha256: await sha256(new TextEncoder().encode(planJSON(plan))) };
}
export async function assertGovernancePlan(plan: GovernancePlan): Promise<void> {
  if (await sha256(new TextEncoder().encode(planJSON(plan))) !== plan.planSha256) throw new Error('Approved operation plan was modified');
  const wrapper = plan.accounts.transactionProgram;
  if (![BOOTSTRAP_PROGRAM_ADDRESSES.multicall, plan.requiredFeePayer ? plan.program : BOOTSTRAP_PROGRAM_ADDRESSES.multisig].includes(wrapper)
    || [...plan.accounts.readWrite, ...plan.accounts.readOnly].includes(wrapper)) throw new Error('Invalid approved transaction program layout');
  if (plan.reviewedStatePlan !== undefined) {
    validateReviewedStateOperation(plan.reviewedStatePlan, plan);
    if (await sha256(new TextEncoder().encode(canonicalReviewedJson(plan.reviewedStatePlan))) !== plan.reviewedStatePlanSha256) throw new Error('Reviewed state commitment was modified');
  }
}
/** Review binding is derived from validated effects, never a caller-supplied digest label. */
export async function reviewGovernancePlan(plan: GovernancePlan, reviewed: unknown): Promise<GovernancePlan> {
  await assertGovernancePlan(plan);
  const reviewedStatePlan = structuredClone(reviewed);
  validateReviewedStateOperation(reviewedStatePlan, plan);
  const reviewedStatePlanSha256 = await sha256(new TextEncoder().encode(canonicalReviewedJson(reviewedStatePlan)));
  return sealGovernancePlan({ ...plan, reviewedStatePlan, reviewedStatePlanSha256 });
}
/** Portable operation-plan JSON consumed by bootstrap expected-state:update. */
export async function serializeGovernancePlan(plan: GovernancePlan): Promise<string> {
  await assertGovernancePlan(plan);
  return JSON.stringify({ ...JSON.parse(planJSON(plan)), planSha256: plan.planSha256 }, null, 2);
}
/** Exact signed wire overhead: 112-byte header includes payer/program, 64-byte signature. */
export function assertTransactionCapacity(layout: FixedAccountLayout, instructionBytes: number, feePayerProofBytes = 0): number {
  if (!Number.isSafeInteger(feePayerProofBytes) || feePayerProofBytes < 0) throw new Error('Invalid fee-payer proof length');
  const size = 176 + 32 * (layout.readWrite.length + layout.readOnly.length) + instructionBytes + feePayerProofBytes + (feePayerProofBytes ? 64 : 0);
  if (size > 32768) throw new Error(`Transaction requires ${size} bytes, exceeding 32768`);
  return size;
}
export interface GovernanceCall { program: string; instruction: Uint8Array }
/** `approve-execute`: the approval that reaches the threshold and the
    Execute land in one Multicall transaction, so nothing can change between
    the final approval and execution (UNTO-3561). */
export type GovernancePhase = 'execute' | 'propose' | 'approve' | 'approve-execute';
/** Phases whose transaction executes the approved operation. */
export function executesOperation(phase: GovernancePhase): boolean { return phase === 'execute' || phase === 'approve-execute'; }
export function governanceRequestPayload(plan: GovernancePlan): { kind: number; data: Uint8Array } {
  const kind = plan.operation === 'multisig:updateThreshold' ? 1 : plan.operation === 'multisig:updateMembership' ? 2 : plan.operation === 'multisig:deleteMultisig' ? 3 : 0;
  const refs = [plan.accounts.transactionProgram, ...plan.accounts.readWrite, ...plan.accounts.readOnly];
  const data = kind ? plan.instruction : concat(integer(accountSlot(plan.accounts, plan.program), 2), integer(refs.length, 2), integer(plan.instruction.length, 8), key(plan.program), ...refs.map((_, i) => integer(i + 1, 2)), ...refs.map(key), plan.instruction);
  if (data.length > 4096) throw new Error(`Multisig request requires ${data.length} bytes, exceeding 4096`);
  return { kind, data };
}
function checkedProof(proof: Uint8Array): void {
  if (proof.length < 104 || proof.length > 8296 || new DataView(proof.buffer, proof.byteOffset, proof.byteLength).getBigUint64(0, true) >> 62n !== 2n) throw new Error('Invalid creation proof');
  let count = 0;
  for (let n of proof.subarray(8, 40)) while (n) { count++; n &= n - 1; }
  if (proof.length !== 104 + 32 * count) throw new Error('Invalid creation proof footprint');
}
async function assertApprovedCalls(plan: GovernancePlan, calls: GovernanceCall[], phase: GovernancePhase): Promise<void> {
  if (phase === 'approve-execute') {
    if (!plan.multisig || !usesMulticall(plan)) throw new Error('Approve-and-execute requires a Multicall Multisig plan');
    if (calls.length < 2) throw new Error('Transaction calls differ from approved execution');
    await assertApprovedCalls(plan, calls.slice(0, 1), 'approve');
    await assertApprovedCalls(plan, calls.slice(1), 'execute');
    return;
  }
  const refresh = phase === 'execute' && !!plan.proofSlot;
  if (calls.length !== (refresh ? 2 : 1)) throw new Error('Transaction calls differ from approved execution');
  if (refresh) {
    const slot = plan.proofSlot!, writer = calls[0], bytes = writer.instruction;
    const prefix = concat(integer(10, 1), bound(proofSlotAccounts(plan), slot.address), slot.seed);
    if (writer.program !== BOOTSTRAP_PROGRAM_ADDRESSES.core_manager || bytes.length < 75 || !equal(bytes.subarray(0, 67), prefix)) throw new Error('Proof refresh differs from approved slot');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), first = view.getUint32(67, true), second = view.getUint32(71, true);
    if (75 + first + second !== bytes.length) throw new Error('Invalid proof refresh envelope');
    checkedProof(bytes.subarray(75, 75 + first)); checkedProof(bytes.subarray(75 + first));
  }
  const last = calls[calls.length - 1];
  if (phase === 'execute' && plan.requiredFeePayer) {
    if (last.program !== plan.program || !equal(last.instruction, plan.instruction)) throw new Error('Execution child differs from approved operation');
    return;
  }
  if (!plan.multisig || last.program !== BOOTSTRAP_PROGRAM_ADDRESSES.multisig) throw new Error('Missing approved Multisig execution identity');
  const indices = concat(integer(accountSlot(plan.accounts, plan.multisig.address), 2), integer(accountSlot(plan.accounts, plan.multisig.request), 2));
  if (!plan.accounts.readWrite.includes(plan.multisig.address) || !plan.accounts.readWrite.includes(plan.multisig.request)) throw new Error('Approved Multisig/request slots must be writable');
  if (phase === 'execute') {
    if (!equal(last.instruction, concat(integer(3, 4), indices))) throw new Error('Multisig wrapper differs from approved request');
  } else if (phase === 'approve') {
    // u32 tag, indices, approver slot 0, then the request id (read from chain) and
    // sha256 of the request data, which must be the approved request.
    const bytes = last.instruction;
    if (bytes.length !== 50 || !equal(bytes.subarray(0, 10), concat(integer(2, 4), indices, integer(0, 2)))) throw new Error('Multisig wrapper differs from approved request');
    if (!equal(bytes.subarray(18), digestBytes(await sha256(governanceRequestPayload(plan).data)))) throw new Error('Approval names a request other than the approved one');
  } else {
    const bytes = last.instruction, expected = governanceRequestPayload(plan);
    if (bytes.length < 60 || !equal(bytes.subarray(0, 12), concat(integer(1, 4), indices, integer(0, 2), integer(expected.kind, 1), integer(0, 1)))) throw new Error('Proposal header differs from approved request');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), length = view.getBigUint64(44, true), proofLength = view.getBigUint64(52, true);
    if (length !== BigInt(expected.data.length) || 60n + length + proofLength !== BigInt(bytes.length) || !equal(bytes.subarray(60, 60 + expected.data.length), expected.data)) throw new Error('Proposal child differs from approved request');
    const derived = deriveProgramAddress({ programAddress: BOOTSTRAP_PROGRAM_ADDRESSES.multisig, seed: bytes.subarray(12, 44) }).address;
    if (derived !== plan.multisig.request) throw new Error('Proposal seed differs from approved request');
    checkedProof(bytes.subarray(60 + expected.data.length));
  }
}
/** Build every required transaction. Direct permanent creation refreshes proofs separately, not atomically. */
export async function buildGovernanceTransactions(plan: GovernancePlan, executor: Address, calls: GovernanceCall[], feePayerProofBytes = 0, phase: GovernancePhase = 'execute') {
  await assertGovernancePlan(plan);
  await assertApprovedCalls(plan, calls, phase);
  const payer = address(executor);
  if (plan.requiredFeePayer && payer !== plan.requiredFeePayer) throw new Error('EOA admin must be the fee payer');
  if (payer === plan.accounts.transactionProgram || [...plan.accounts.readWrite, ...plan.accounts.readOnly].includes(payer)) throw new Error('Executor collides with approved fixed account slots');
  const transaction = (accounts: FixedAccountLayout, instructionData: Uint8Array, proofBytes: number) => {
    assertTransactionCapacity(accounts, instructionData.length, proofBytes);
    return { program: accounts.transactionProgram, accounts: { readWrite: accounts.readWrite, readOnly: accounts.readOnly }, instructionData };
  };
  if (usesMulticall(plan)) return [transaction(plan.accounts, buildMulticallInstruction(calls.map(call => ({ programIdx: accountSlot(plan.accounts, call.program), instructionData: call.instruction }))), feePayerProofBytes)];
  const last = calls[calls.length - 1];
  if (last.program !== plan.accounts.transactionProgram) throw new Error('Direct execution must call the approved transaction program');
  const refresh = phase === 'execute' && !!plan.proofSlot;
  return [
    ...(refresh ? [transaction(proofSlotAccounts(plan), calls[0].instruction, feePayerProofBytes)] : []),
    transaction(plan.accounts, last.instruction, refresh ? 0 : feePayerProofBytes),
  ];
}
/** Single-transaction API deliberately refuses non-atomic direct permanent creation. */
export async function buildGovernanceTransaction(plan: GovernancePlan, executor: Address, calls: GovernanceCall[], feePayerProofBytes = 0, phase: GovernancePhase = 'execute') {
  const transactions = await buildGovernanceTransactions(plan, executor, calls, feePayerProofBytes, phase);
  if (transactions.length !== 1) throw new Error('Direct permanent creation requires buildGovernanceTransactions and a confirmed standalone proof refresh');
  return transactions[0];
}
export interface GovernanceActionReceipt { transaction_id: string; proof_refresh_transaction_id?: string }
export interface GovernanceReceipt extends GovernanceActionReceipt { plan_sha256: string; success: true }
/** The operation already executed; this error withholds only the reviewed-state receipt. */
export class GovernanceReceiptWithheldError extends Error {
  constructor(readonly receipt: GovernanceActionReceipt, readonly cause: unknown) {
    super(`Governance transaction ${receipt.transaction_id} executed, but the successful reviewed-state receipt is withheld: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'GovernanceReceiptWithheldError';
  }
}
/** TN_RUNTIME_TXN_ERR_NONCE_TOO_LOW: rejected before execution. */
const VM_ERROR_NONCE_TOO_LOW = -511;
class StaleNonceError extends Error {
  constructor(signature: string) { super(`Governance transaction ${signature} failed: vm_error=${VM_ERROR_NONCE_TOO_LOW} (nonce too low) user_error_code=0`); }
}
export interface GovernanceSubmission {
  client: Thru; plan: GovernancePlan; executor: { publicKey: Uint8Array; privateKey: Uint8Array };
  calls: GovernanceCall[]; feePayerStateProof?: Uint8Array; feePayerAccountMetaRaw?: Uint8Array; stateUnits?: number;
}
/** Submission-only result cannot advance the expected-state manifest. */
export async function submitGovernanceAction(args: GovernanceSubmission, phase: GovernancePhase): Promise<GovernanceActionReceipt> {
  const transactions = await buildGovernanceTransactions(args.plan, args.executor.publicKey, args.calls, args.feePayerStateProof?.length, phase);
  const executes = executesOperation(phase);
  if (executes && args.plan.reviewedStatePlan !== undefined) await verifyReviewedProgramStates(args.client, args.plan.reviewedStatePlan, args.plan, 'before');
  await verifyReviewedCandidate(args.client, args.plan);
  if (executes && args.plan.multisig) {
    const [stateAccount, requestAccount] = await Promise.all([args.client.accounts.get(args.plan.multisig.address), args.client.accounts.get(args.plan.multisig.request)]);
    for (const account of [stateAccount, requestAccount]) if (!account.meta?.owner?.equals(BOOTSTRAP_PROGRAM_ADDRESSES.multisig) || account.meta.flags.isProgram || account.meta.flags.isDeleted || account.meta.flags.isCompressed) throw new Error('Invalid Multisig execution account');
    const state = parseMultisigState(stateAccount.data?.data ?? new Uint8Array()), request = parseMultisigRequest(requestAccount.data?.data ?? new Uint8Array());
    assertCurrentRequest(state, request);
    const expected = governanceRequestPayload(args.plan);
    if (request.multisig !== args.plan.multisig.address || request.kind !== expected.kind || !equal(request.data, expected.data) || request.approvals + (phase === 'approve-execute' ? 1 : 0) < request.requiredApprovals) throw new Error('On-chain request differs from approved execution');
  }
  // A transaction rejected for a stale nonce (the node's account read lags a
  // just-executed transaction by the same fee payer) never executed, so it is
  // rebuilt with a fresh nonce and resent, for up to ~15 s.
  const submit = async (tx: typeof transactions[number], first: boolean, refresh: boolean): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      try { return await submitOnce(tx, first, refresh); }
      catch (cause) {
        if (!(cause instanceof StaleNonceError) || attempt >= 30) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };
  const submitOnce = async (tx: typeof transactions[number], first: boolean, refresh: boolean): Promise<string> => {
    await assertGovernancePlan(args.plan);
    const signed = await args.client.transactions.buildAndSign({ ...tx, feePayer: args.executor,
      feePayerStateProof: first ? args.feePayerStateProof : undefined, feePayerAccountMetaRaw: first ? args.feePayerAccountMetaRaw : undefined,
      header: { fee: 0n, computeUnits: 500_000_000, memoryUnits: 5000, stateUnits: refresh ? 5 : args.stateUnits ?? args.plan.stateUnits ?? 0, expiryAfter: 10000 } });
    if (signed.rawTransaction.length > 32768) throw new Error('Signed transaction exceeds 32768 bytes');
    for await (const update of args.client.transactions.sendAndTrack(signed.rawTransaction, { timeoutMs: 60000 })) {
      if (!update.executionResult) continue;
      if (update.executionResult.vmError === VM_ERROR_NONCE_TOO_LOW) throw new StaleNonceError(signed.signature.toThruFmt());
      if (update.executionResult.vmError !== 0 || update.executionResult.userErrorCode !== 0n) throw new Error(`Governance transaction ${update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : signed.signature.toThruFmt()} failed: vm_error=${update.executionResult.vmError} user_error_code=${update.executionResult.userErrorCode}`);
      return update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : signed.signature.toThruFmt();
    }
    throw new Error('Governance transaction outcome unknown; expected state must not advance');
  };
  const proofRefresh = transactions.length === 2 ? await submit(transactions[0], true, true) : undefined;
  // A standalone proof refresh is not the reviewed transition; recheck before the actual operation.
  if (proofRefresh && args.plan.reviewedStatePlan !== undefined) await verifyReviewedProgramStates(args.client, args.plan.reviewedStatePlan, args.plan, 'before');
  const visibilityDeadline = Date.now() + 60000;
  const transaction_id = await submit(transactions[transactions.length - 1], !proofRefresh, false);
  const receipt = { transaction_id, ...(proofRefresh ? { proof_refresh_transaction_id: proofRefresh } : {}) };
  try {
    if (executes && args.plan.reviewedStatePlan !== undefined) {
      // Match the CLI's GetTransaction indexing boundary: execution notifications can precede query visibility.
      for (;;) {
        if (Date.now() >= visibilityDeadline) throw new Error('Executed governance transaction was not indexed within timeout');
        try {
          const indexed = await args.client.transactions.get(transaction_id, { minConsensus: ConsensusStatus.INCLUDED });
          if (indexed.slot !== undefined && indexed.slot > 0n) break;
        } catch (cause) {
          if ((cause as { code?: number } | null)?.code !== 5) throw cause;
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, visibilityDeadline - Date.now()))));
      }
    }
    await verifyReviewedCandidate(args.client, args.plan);
    if (executes && args.plan.reviewedStatePlan !== undefined) await verifyReviewedProgramStates(args.client, args.plan.reviewedStatePlan, args.plan, 'after');
  }
  catch (cause) { throw new GovernanceReceiptWithheldError(receipt, cause); }
  return receipt;
}
export async function submitGovernanceTransaction(args: GovernanceSubmission & { reviewedPlanSha256: string }, phase: 'execute' | 'approve-execute' = 'execute'): Promise<GovernanceReceipt> {
  await assertGovernancePlan(args.plan);
  const reviewed = args.plan.reviewedStatePlan;
  if (reviewed === undefined || !args.plan.reviewedStatePlanSha256 || args.reviewedPlanSha256 !== args.plan.reviewedStatePlanSha256) throw new Error('Reviewed state digest is not bound to the approved operation plan');
  validateReviewedStateOperation(reviewed, args.plan);
  const digest = await sha256(new TextEncoder().encode(canonicalReviewedJson(reviewed)));
  if (digest !== args.plan.reviewedStatePlanSha256) throw new Error('Reviewed state commitment was modified');
  const receipt = await submitGovernanceAction(args, phase);
  return { ...receipt, plan_sha256: digest, success: true };
}
/** Compare only caller-reviewed descriptors; RPC state can never create or approve a role. */
async function verifyReviewedCandidate(client: Thru, plan: GovernancePlan): Promise<void> {
  if (plan.reviewedStatePlan === undefined) return;
  const descriptor = reviewedMultisigCandidate(plan.reviewedStatePlan, plan);
  if (!descriptor) return;
  const account = await client.accounts.get(Pubkey.from(digestBytes(descriptor.address)).toThruFmt());
  const meta = account.meta, flags = meta?.flags;
  const liveFlags = flags && [flags.isProgram, flags.isPrivileged, flags.isUncompressable, flags.isEphemeral, flags.isDeleted, flags.isNew, flags.isCompressed, flags.isNativeReceiver].reduce((mask, bit, i) => mask | (bit ? 1 << i : 0), 0);
  // NEW is transient live state, never part of the reviewed durable flags.
  if (!meta?.owner?.equals(BOOTSTRAP_PROGRAM_ADDRESSES.multisig) || liveFlags === undefined || (liveFlags & ~32) !== descriptor.flags || account.data?.compressed) throw new Error('Candidate owner/flags differ from reviewed descriptor');
  const state = parseMultisigState(account.data?.data ?? new Uint8Array());
  if (state.threshold !== descriptor.threshold || canonicalReviewedJson(state.members.map(member => hex(key(member)))) !== canonicalReviewedJson(descriptor.members)) throw new Error('Candidate membership/threshold differ from reviewed descriptor');
}
