import { address, hex } from '../core-manager/plan';
import { MultisigProgramAccount } from './abi/thru/program/multisig/types';
import { decodeAccountRoot } from '../utils/account-root';
/** Multisig account discriminators (byte 0). Values are never reused; a new
    layout takes the next value. */
export const MULTISIG_ACCOUNT_TYPE_MULTISIG_V1 = 1;
export const MULTISIG_ACCOUNT_TYPE_REQUEST_V1 = 2;
/** Decodes Multisig program account data through its account root (byte 0 is
    the account type); null for any other type or a multisig of the wrong size. */
export function decodeMultisigProgramAccount(data: Uint8Array): MultisigProgramAccount | null {
  return decodeAccountRoot(data, (bytes) => MultisigProgramAccount.from_array(bytes));
}
export interface MultisigState { members: string[]; threshold: number; liveRequests: number; epoch: bigint; nextRequestId: bigint }
export function parseMultisigState(data: Uint8Array): MultisigState {
  if (!decodeMultisigProgramAccount(data)?.payload().asMultisigV1() || data[1] !== 0) throw new Error('Invalid Multisig state layout');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(2, true), threshold = view.getUint16(4, true);
  const liveRequests = view.getUint16(6, true), epoch = view.getBigUint64(8, true), nextRequestId = view.getBigUint64(16, true);
  if (count < 2 || count > 32 || threshold < 1 || threshold > count || BigInt(liveRequests) > nextRequestId) throw new Error('Invalid Multisig counters or threshold');
  const members: string[] = [];
  let previous = '';
  for (let i = 0; i < count; i++) {
    const bytes = data.subarray(24 + i * 32, 56 + i * 32), current = hex(bytes);
    if (bytes.every(x => x === 0) || current <= previous) throw new Error('Multisig members must be nonzero, unique and sorted');
    members.push(address(bytes)); previous = current;
  }
  if (data.subarray(24 + count * 32).some(Boolean)) throw new Error('Invalid unused Multisig members');
  return { members, threshold, liveRequests, epoch, nextRequestId };
}
export interface MultisigRequest {
  kind: number; memberCount: number; requiredApprovals: number; id: bigint; epoch: bigint;
  approvalBitmap: bigint; approvals: number; multisig: string; proposer: string; data: Uint8Array;
  invoke?: { targetProgram: string; targetIndex: number; accounts: { index: number; address: string }[]; instruction: Uint8Array };
}
export function parseMultisigRequest(data: Uint8Array): MultisigRequest {
  if (data.length < 104 || !decodeMultisigProgramAccount(data)?.payload().asRequestV1() || data[1] > 3 || data[2] || data[3]) throw new Error('Invalid Multisig request header');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const memberCount = view.getUint16(4, true), requiredApprovals = view.getUint16(6, true), size = view.getBigUint64(32, true), approvalBitmap = view.getBigUint64(24, true);
  if (size > 4096n || BigInt(data.length) !== 104n + size || memberCount < 2 || memberCount > 32 || requiredApprovals < 1 || requiredApprovals > memberCount || approvalBitmap >> BigInt(memberCount)) throw new Error('Invalid Multisig request size or approvals');
  let bits = approvalBitmap, approvals = 0;
  while (bits) { approvals++; bits &= bits - 1n; }
  const payload = data.subarray(104);
  const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let invoke: MultisigRequest['invoke'];
  if (data[1] === 0) {
    if (payload.length < 44) throw new Error('Truncated invoke request');
    const count = payloadView.getUint16(2, true), length = payloadView.getBigUint64(4, true), offset = 44 + count * 34;
    if (BigInt(offset) + length !== BigInt(payload.length)) throw new Error('Invalid invoke request footprint');
    const accounts = Array.from({ length: count }, (_, i) => ({ index: payloadView.getUint16(44 + i * 2, true), address: address(payload.subarray(44 + count * 2 + i * 32, 76 + count * 2 + i * 32)) }));
    invoke = { targetProgram: address(payload.subarray(12, 44)), targetIndex: payloadView.getUint16(0, true), accounts, instruction: payload.slice(offset) };
  } else if (data[1] === 1) {
    if (payload.length !== 4 || payloadView.getUint16(2, true) || payloadView.getUint16(0, true) < 1 || payloadView.getUint16(0, true) > memberCount) throw new Error('Invalid threshold request');
  } else if (data[1] === 2) {
    if (payload.length < 4) throw new Error('Truncated membership request');
    const count = payloadView.getUint16(0, true);
    if (count < 2 || count > 32 || payloadView.getUint16(2, true) || payload.length !== 4 + 32 * count) throw new Error('Invalid membership request');
    let previous = '';
    for (let i = 0; i < count; i++) {
      const member = hex(payload.subarray(4 + 32 * i, 36 + 32 * i));
      if (member <= previous) throw new Error('Duplicate or unsorted membership request');
      previous = member;
    }
  } else if (payload.length) throw new Error('Invalid delete request');
  return { kind: data[1], memberCount, requiredApprovals, id: view.getBigUint64(8, true), epoch: view.getBigUint64(16, true), approvalBitmap, approvals, multisig: address(data.subarray(40, 72)), proposer: address(data.subarray(72, 104)), data: payload.slice(), invoke };
}
export function assertCurrentRequest(state: MultisigState, request: MultisigRequest): void {
  if (state.epoch !== request.epoch || state.members.length !== request.memberCount || request.id >= state.nextRequestId || !state.liveRequests || request.requiredApprovals !== (request.kind === 0 ? state.threshold : Math.floor(state.members.length / 2) + 1)) throw new Error('Stale or invalid Multisig request');
}
