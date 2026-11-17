import { Account, Pubkey, StateProof, SubmissionStatus, Transaction, createThruClient } from '@thru/sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildCoreOperationPlan, accountSlot, hex, integer, concat } from '../core-manager';
import { MULTISIG_PROGRAM_ADDRESS, buildMultisigInvokeRequest, buildMultisigExecutionTransaction, proposeMultisigRequest, approveMultisigRequest, approveAndExecuteMultisigRequest, canApproveAndExecute, executeMultisigRequest, deriveMultisigAccount, buildMultisigManagementPlan, inspectMultisigRequest, parseMultisigState, parseMultisigRequest, assertCurrentRequest } from './index';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
const addr = (n: number) => Pubkey.from(new Uint8Array(32).fill(n)).toThruFmt();
function stateData(): Uint8Array {
  const bytes = new Uint8Array(1048), view = new DataView(bytes.buffer);
  bytes[0] = 1; view.setUint16(2, 2, true); view.setUint16(4, 2, true); view.setUint16(6, 1, true);
  view.setBigUint64(8, 7n, true); view.setBigUint64(16, 5n, true);
  bytes.set(Pubkey.from(addr(11)).toBytes(), 24); bytes.set(Pubkey.from(addr(12)).toBytes(), 56);
  return bytes;
}
function requestData(payload: Uint8Array, approvals = 3n): Uint8Array {
  return concat(integer(2, 1), integer(0, 1), integer(0, 2), integer(2, 2), integer(2, 2), integer(4n, 8), integer(7n, 8), integer(approvals, 8), integer(payload.length, 8), Pubkey.from(addr(33)).toBytes(), Pubkey.from(addr(11)).toBytes(), payload);
}
function account(address: string, data: Uint8Array): Account {
  return { address: Pubkey.from(address), meta: { owner: Pubkey.from(MULTISIG_PROGRAM_ADDRESS), flags: { isProgram: false, isDeleted: false, isCompressed: false } }, data: { data } } as Account;
}
async function fixture() {
  const client = createThruClient();
  const plan = await buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', multisigRequest: addr(34), operation: { kind: 'proposeAdmin', candidate: addr(66), candidateKind: 'eoa' }, executionAccounts: { readWrite: [addr(33), addr(34)], readOnly: [MULTISIG_PROGRAM_ADDRESS] } });
  const payload = await buildMultisigInvokeRequest(plan), state = stateData(), request = requestData(payload);
  vi.spyOn(client.accounts, 'get').mockImplementation(async target => Pubkey.from(target).equals(addr(33)) ? account(addr(33), state) : account(addr(34), request));
  return { client, plan, state, request };
}
describe('Multisig supported workflows', () => {
  it('inspects real packed state and checks threshold/epoch/request linkage', async () => {
    const { client, state, request } = await fixture();
    const inspected = await inspectMultisigRequest(client, addr(33), addr(34));
    expect(inspected.ready).toBe(true); expect(inspected.request.approvals).toBe(2);
    new DataView(state.buffer).setBigUint64(8, 8n, true);
    expect(() => assertCurrentRequest(parseMultisigState(state), parseMultisigRequest(request))).toThrow('Stale');
  });
  it('executes unchanged stored request coordinates with two unrelated fee payers', async () => {
    const { client, plan } = await fixture(), approved = await buildMultisigInvokeRequest(plan);
    const wires: Uint8Array[] = [];
    for (const value of [71, 72]) {
      const privateKey = new Uint8Array(32).fill(value), publicKey = await client.keys.fromPrivateKey(privateKey);
      const options = { client, plan, multisig: addr(33), request: addr(34), executor: { publicKey, privateKey }, reviewedPlanSha256: 'a'.repeat(64) };
      const tx = await buildMultisigExecutionTransaction(options);
      const signed = await client.transactions.buildAndSign({ ...tx, feePayer: options.executor, header: { fee: 0n, nonce: 0n, startSlot: 7n, chainId: 1 } });
      expect(signed.rawTransaction.length).toBeLessThan(32768); wires.push(tx.instructionData);
    }
    expect(wires[0]).toEqual(wires[1]); expect(await buildMultisigInvokeRequest(plan)).toEqual(approved);
    expect(new DataView(approved.buffer).getUint16(0, true)).toBe(accountSlot(plan.accounts, plan.program));
  });
  it('rejects a substituted child, stale epoch, missing approval, and wrong Multisig link before execution', async () => {
    const { client, plan, request } = await fixture();
    const options = { client, plan, multisig: addr(33), request: addr(34), executor: { publicKey: Pubkey.from(addr(71)).toBytes(), privateKey: new Uint8Array(32) }, reviewedPlanSha256: 'a'.repeat(64) };
    request[request.length - 1] ^= 1;
    await expect(buildMultisigExecutionTransaction(options)).rejects.toThrow('differs');
    request[request.length - 1] ^= 1;
    new DataView(request.buffer).setBigUint64(24, 1n, true);
    await expect(buildMultisigExecutionTransaction(options)).rejects.toThrow('insufficient');
    request.set(Pubkey.from(addr(35)).toBytes(), 40);
    await expect(inspectMultisigRequest(client, addr(33), addr(34))).rejects.toThrow('another Multisig');
  });
  it('rejects duplicate and nonmember approvals without submitting a transaction', async () => {
    const { client, plan } = await fixture();
    const options = { client, plan, multisig: addr(33), request: addr(34), executor: { publicKey: Pubkey.from(addr(11)).toBytes(), privateKey: new Uint8Array(32) }, reviewedPlanSha256: 'a'.repeat(64) };
    await expect(approveMultisigRequest(options)).rejects.toThrow('already approved');
    await expect(approveMultisigRequest({ ...options, executor: { ...options.executor, publicKey: Pubkey.from(addr(99)).toBytes() } })).rejects.toThrow('not a Multisig member');
  });
  it.each(['multicall', 'direct'] as const)('proposes, approves and executes %s using real signed transactions and execution-only state receipts', async executionMode => {
    const client = createThruClient(), privateKey = new Uint8Array(32).fill(79);
    const publicKey = await client.keys.fromPrivateKey(privateKey);
    const requestAddress = deriveMultisigAccount('reviewed-request');
    const target = executionMode === 'direct' ? BOOTSTRAP_PROGRAM_ADDRESSES.multicall : addr(44);
    const before = { identity: 'pin-target', address: hex(Pubkey.from(target).toBytes()), owner: '0'.repeat(63) + '1', flags: 1 };
    const reviewedStatePlan = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: before.identity, before, after: { ...before, flags: 5 } }] };
    const plan = await buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', multisigRequest: requestAddress, reviewedStatePlan, operation: { kind: 'setPin', target, pin: true } });
    const payload = await buildMultisigInvokeRequest(plan), state = stateData(), request = requestData(payload, 0n);
    const members = [publicKey, Pubkey.from(addr(12)).toBytes()].sort((a, b) => hex(a).localeCompare(hex(b)));
    state.set(members[0], 24); state.set(members[1], 56);
    // The mock ledger reflects each transaction once it is sent: the
    // approval sets the executor's bit and Execute deletes the request.
    let executed = false, gone = false, targetReads = 0;
    const executorBit = 1n << BigInt(members.findIndex(member => hex(member) === hex(publicKey)));
    vi.spyOn(client.accounts, 'get').mockImplementation(async address => {
      if (gone && Pubkey.from(address).equals(requestAddress)) throw Object.assign(new Error('[not_found] account not found'), { code: 5 });
      if (Pubkey.from(address).equals(target)) {
        targetReads++;
        return { address: Pubkey.from(target), meta: { owner: Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.core_manager), dataSize: 0,
          flags: { isProgram: true, isPrivileged: false, isUncompressable: executed, isEphemeral: false,
            isDeleted: false, isNew: false, isCompressed: false, isNativeReceiver: false } }, data: { data: new Uint8Array(), compressed: false } } as Account;
      }
      return Pubkey.from(address).equals(addr(33)) ? account(addr(33), state) : account(requestAddress, request);
    });
    const creationProof = new Uint8Array(104);
    new DataView(creationProof.buffer).setBigUint64(0, 2n << 62n, true);
    vi.spyOn(client.proofs, 'generate').mockResolvedValue(new StateProof({ proof: creationProof, slot: 7n }));
    const buildAndSign = client.transactions.buildAndSign;
    const sign = vi.spyOn(client.transactions, 'buildAndSign').mockImplementation(args => buildAndSign({ ...args, header: { ...args.header, fee: 0n, nonce: 0n, startSlot: 7n, chainId: 1 } }));
    const wires: Transaction[] = [];
    vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* (raw) {
      wires.push(Transaction.fromWire(raw));
      if (wires.length === 2) new DataView(request.buffer).setBigUint64(24, new DataView(request.buffer).getBigUint64(24, true) | executorBit, true);
      if (wires.length === 3) executed = gone = true;
      yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: 0, userErrorCode: 0n, consumedComputeUnits: 10 } };
    });
    const indexed = vi.spyOn(client.transactions, 'get').mockImplementation(async () => Object.assign(wires[wires.length - 1], { slot: 7n }));
    const options = { client, plan, multisig: addr(33), request: requestAddress, executor: { publicKey, privateKey }, reviewedPlanSha256: plan.reviewedStatePlanSha256! };
    const proposed = await proposeMultisigRequest({ ...options, requestSeed: 'reviewed-request' });
    expect(proposed.operation).toBe('proposed'); expect(proposed).not.toHaveProperty('plan_sha256');
    const approved = await approveMultisigRequest(options);
    expect(approved.operation).toBe('approved'); expect(approved).not.toHaveProperty('plan_sha256');
    expect(targetReads).toBe(0);
    expect(indexed).not.toHaveBeenCalled();
    new DataView(request.buffer).setBigUint64(24, 3n, true);
    const receipt = await executeMultisigRequest(options);
    expect(receipt).toMatchObject({ plan_sha256: plan.reviewedStatePlanSha256, success: true });
    gone = false; // Restore the request for the refusal paths below.
    expect(targetReads).toBe(2);
    expect(indexed).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(3);
    if (executionMode === 'direct') {
      expect(wires.map(tx => new DataView(tx.instructionData!.buffer, tx.instructionData!.byteOffset).getUint32(0, true))).toEqual([1, 2, 3]);
      for (const call of sign.mock.calls) expect(call[0].program).toBe(MULTISIG_PROGRAM_ADDRESS);
      const refs = new DataView(payload.buffer).getUint16(2, true);
      expect(new DataView(payload.buffer).getUint16(44, true)).toBe(1);
      expect(payload.subarray(44 + 2 * refs, 76 + 2 * refs)).toEqual(Pubkey.from(MULTISIG_PROGRAM_ADDRESS).toBytes());
      for (const tx of wires) expect(tx.readWriteAccounts.map(key => key.toThruFmt())).toEqual(plan.accounts.readWrite);
    }
    await expect(executeMultisigRequest({ ...options, reviewedPlanSha256: 'f'.repeat(64) })).rejects.toThrow('not bound');
    expect(sign).toHaveBeenCalledTimes(3);
    await expect(executeMultisigRequest(options)).rejects.toThrow('flags/lifecycle');
    expect(sign).toHaveBeenCalledTimes(3);
    executed = false; // Restore the reviewed before-state to exercise the VM failure path.
    vi.mocked(client.transactions.sendAndTrack).mockImplementation(async function* () {
      yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: 0, userErrorCode: 1n, consumedComputeUnits: 10 } };
    });
    await expect(executeMultisigRequest(options)).rejects.toThrow('failed');
  });
  it('returns from propose only once queries see the request (execution notifications can precede query visibility)', async () => {
    const client = createThruClient(), privateKey = new Uint8Array(32).fill(79);
    const publicKey = await client.keys.fromPrivateKey(privateKey);
    const requestAddress = deriveMultisigAccount('lagging-request');
    const plan = await buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', multisigRequest: requestAddress, operation: { kind: 'proposeAdmin', candidate: addr(66), candidateKind: 'eoa' } });
    const state = stateData(), request = requestData(await buildMultisigInvokeRequest(plan), 0n);
    state.set(publicKey, 24);
    let sent = false, lagging = 2, requestReads = 0;
    vi.spyOn(client.accounts, 'get').mockImplementation(async target => {
      if (Pubkey.from(target).equals(addr(33))) return account(addr(33), state);
      requestReads++;
      if (!sent || lagging-- > 0) throw Object.assign(new Error('[not_found] account not found'), { code: 5 });
      return account(requestAddress, request);
    });
    const creationProof = new Uint8Array(104);
    new DataView(creationProof.buffer).setBigUint64(0, 2n << 62n, true);
    vi.spyOn(client.proofs, 'generate').mockResolvedValue(new StateProof({ proof: creationProof, slot: 7n }));
    const buildAndSign = client.transactions.buildAndSign;
    vi.spyOn(client.transactions, 'buildAndSign').mockImplementation(args => buildAndSign({ ...args, header: { ...args.header, fee: 0n, nonce: 0n, startSlot: 7n, chainId: 1 } }));
    vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* () {
      sent = true;
      yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: 0, userErrorCode: 0n, consumedComputeUnits: 10 } };
    });
    await proposeMultisigRequest({ client, plan, multisig: addr(33), request: requestAddress, executor: { publicKey, privateKey }, requestSeed: 'lagging-request' });
    expect(requestReads).toBe(3);
    expect((await inspectMultisigRequest(client, addr(33), requestAddress)).request.approvals).toBe(0);
  });
  it('lands the threshold approval and Execute in one Multicall transaction, and refuses below threshold or direct plans', async () => {
    const client = createThruClient(), privateKey = new Uint8Array(32).fill(80);
    const publicKey = await client.keys.fromPrivateKey(privateKey);
    const requestAddress = deriveMultisigAccount('approve-execute');
    const plan = await buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', multisigRequest: requestAddress, operation: { kind: 'setPin', target: addr(44), pin: true } });
    expect(plan.accounts.transactionProgram).toBe(BOOTSTRAP_PROGRAM_ADDRESSES.multicall);
    const payload = await buildMultisigInvokeRequest(plan), state = stateData();
    const members = [publicKey, Pubkey.from(addr(12)).toBytes()].sort((a, b) => hex(a).localeCompare(hex(b)));
    state.set(members[0], 24); state.set(members[1], 56);
    const other = hex(members[0]) === hex(publicKey) ? 1 : 0;
    const request = requestData(payload, 1n << BigInt(other));
    let gone = false; // Execute deletes the request; queries see that once the transaction lands.
    vi.spyOn(client.accounts, 'get').mockImplementation(async address => {
      if (Pubkey.from(address).equals(addr(33))) return account(addr(33), state);
      if (gone) throw Object.assign(new Error('[not_found] account not found'), { code: 5 });
      return account(requestAddress, request);
    });
    const wires: Transaction[] = [];
    const buildAndSign = client.transactions.buildAndSign;
    vi.spyOn(client.transactions, 'buildAndSign').mockImplementation(args => buildAndSign({ ...args, header: { ...args.header, fee: 0n, nonce: 0n, startSlot: 7n, chainId: 1 } }));
    vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* (raw) {
      wires.push(Transaction.fromWire(raw)); gone = true;
      yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: 0, userErrorCode: 0n, consumedComputeUnits: 10 } };
    });
    const options = { client, plan, multisig: addr(33), request: requestAddress, executor: { publicKey, privateKey } };
    const live = await inspectMultisigRequest(client, addr(33), requestAddress);
    expect(live.ready).toBe(false); expect(canApproveAndExecute(plan, live.request)).toBe(true);
    const result = await approveAndExecuteMultisigRequest(options);
    expect(result.operation).toBe('approved-and-executed');
    expect(wires).toHaveLength(1);
    expect(wires[0].program.toThruFmt()).toBe(BOOTSTRAP_PROGRAM_ADDRESSES.multicall);
    const data = wires[0].instructionData!, indices = concat(integer(accountSlot(plan.accounts, addr(33)), 2), integer(accountSlot(plan.accounts, requestAddress), 2));
    const find = (needle: Uint8Array) => data.findIndex((_, i) => needle.every((byte, j) => data[i + j] === byte));
    const approveAt = find(concat(integer(2, 4), indices, integer(0, 2))), executeAt = find(concat(integer(3, 4), indices));
    expect(approveAt).toBeGreaterThan(-1); expect(executeAt).toBeGreaterThan(approveAt);
    gone = false;
    // Below threshold: with three required approvals this one cannot execute.
    expect(canApproveAndExecute(plan, { approvals: 1, requiredApprovals: 3 })).toBe(false);
    // Direct plans cannot carry two calls in one transaction.
    const direct = await buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', multisigRequest: requestAddress, executionMode: 'direct', operation: { kind: 'setPin', target: addr(44), pin: true } });
    expect(canApproveAndExecute(direct, { approvals: 1, requiredApprovals: 2 })).toBe(false);
    await expect(approveAndExecuteMultisigRequest({ ...options, plan: direct })).rejects.toThrow();
    expect(wires).toHaveLength(1);
  });
  it('uses strict-majority management requests and sorted unique membership payloads', async () => {
    const threshold = await buildMultisigManagementPlan(addr(33), addr(34), { kind: 'updateThreshold', threshold: 1 });
    expect(threshold.instruction).toEqual(Uint8Array.of(1, 0, 0, 0));
    const membership = await buildMultisigManagementPlan(addr(33), addr(34), { kind: 'updateMembership', members: [addr(12), addr(11)] });
    expect(membership.instruction.subarray(4, 36)).toEqual(Pubkey.from(addr(11)).toBytes());
    await expect(buildMultisigManagementPlan(addr(33), addr(34), { kind: 'updateMembership', members: [addr(11), addr(11)] })).rejects.toThrow('duplicate');
  });
});
