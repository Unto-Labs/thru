import { createThruClient, Pubkey, Transaction, SubmissionStatus, StateProof } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { describe, expect, it, vi } from 'vitest';
import { BOOTSTRAP_PROGRAM_ADDRESSES, BOOTSTRAP_PROGRAM_SEEDS } from '../bootstrap-addresses';
import { MulticallArgs } from '../multicall';
import { buildMultisigInvokeRequest, parseMultisigState } from '../multisig';
import { resolveManagerSelection } from '../manager/selection';
import { buildCoreOperationPlan, buildGovernanceTransaction, CORE_PEER_PROGRAM_ADDRESS, CORE_PEER_SEED, CORE_CONFIG_ADDRESS, CORE_PEER_CONFIG_ADDRESS, buildGovernanceTransactions, buildWriteProofSlot, CORE_PROGRAM_ADDRESS, CORE_ACCOUNT_TYPE_CONFIG_V1, CORE_ACCOUNT_TYPE_PROGRAM_META_V1, parseCoreConfig, parseCoreManagedMetadata, deriveCoreProofSlot, assertGovernancePlan, assertTransactionCapacity, sha256, refreshCoreProofSlot, coreExecutionCalls, proofSlotAccounts, serializeGovernancePlan, submitGovernanceAction, multisigUpgradeBridge, accountSlot, concat, integer, type CoreOperation } from './index';
import { CoreInstruction, WriteProofSlotArgs } from './abi/thru/program/core_manager/types';

const addr = (n: number) => Pubkey.from(new Uint8Array(32).fill(n)).toThruFmt();
const image = () => { const bytes = new Uint8Array(20); bytes[0] = 1; bytes[8] = 0x13; return bytes; };
const slotSeed = () => { const bytes = new Uint8Array(32).fill(9); bytes.set(new TextEncoder().encode('coreprf1')); return bytes; };
function proof(maximum = false): Uint8Array {
  const bytes = new Uint8Array(maximum ? 8296 : 104);
  new DataView(bytes.buffer).setBigUint64(0, 2n << 62n | 7n, true);
  if (maximum) bytes.fill(255, 8, 40);
  return bytes;
}
async function plan(operation: CoreOperation = { kind: 'createPermanent', seed: 'governed-test', source: { address: addr(44), bytes: image() }, pin: true, proofSlotSeed: slotSeed() }) {
  return buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', multisigRequest: addr(34), operation, executionAccounts: { readWrite: [addr(33), addr(34)], readOnly: [BOOTSTRAP_PROGRAM_ADDRESSES.multisig] } });
}
describe('Core approved-operation builders', () => {
  it('runs upgradePeer on Core B with its config and Core A as the peer', async () => {
    const approved = await plan({ kind: 'upgradePeer', source: { address: addr(44), bytes: image() } });
    const [caller, config, peer] = [CORE_PEER_PROGRAM_ADDRESS, CORE_PEER_CONFIG_ADDRESS, CORE_PROGRAM_ADDRESS];
    expect(approved.program).toBe(caller);
    expect(approved.instruction.length).toBe(177);
    expect(approved.instruction[0]).toBe(11);
    expect(approved.instruction.subarray(3, 35)).toEqual(Pubkey.from(config).toBytes());
    expect(approved.instruction.subarray(71, 103)).toEqual(Pubkey.from(peer).toBytes());
    expect(approved.accounts.readWrite).toContain(peer);
    expect(approved.accounts.readWrite).not.toContain(caller);
    expect(approved.commitments[0]).toEqual({ address: addr(44), offset: 0, length: 20, sha256: await sha256(image()) });
    expect(CoreInstruction.validate(approved.instruction)).toMatchObject({ ok: true, consumed: 177 });
  });
  it('upgrades Core B as the ordinary Core A pair at CORE_PEER_SEED', async () => {
    expect(CORE_PEER_SEED).toBe('thru-core-peer:v1');
    const approved = await plan({ kind: 'upgrade', seed: CORE_PEER_SEED, source: { address: addr(44), bytes: image() } });
    expect(approved.program).toBe(CORE_PROGRAM_ADDRESS);
    expect(approved.instruction[0]).toBe(2);
    expect(approved.instruction.subarray(3, 35)).toEqual(Pubkey.from(CORE_CONFIG_ADDRESS).toBytes());
    expect(approved.instruction.subarray(105, 137)).toEqual(Pubkey.from(CORE_PEER_PROGRAM_ADDRESS).toBytes());
  });
  it.each(['s', 'governed-test', 's'.repeat(32)])('encodes fixed-width seeds in both create forms: %s', async seed => {
    const expectedSeed = new Uint8Array(32);
    expectedSeed.set(new TextEncoder().encode(seed));
    for (const kind of ['createPermanent', 'createEphemeral'] as const) {
      const approved = await plan({ kind, seed, source: { address: addr(44), bytes: image() }, pin: true });
      expect(approved.instruction.length).toBe(kind === 'createPermanent' ? 342 : 276);
      expect(approved.instruction.subarray(137, 169)).toEqual(expectedSeed);
      expect(approved.commitments[0].sha256).toBe(await sha256(image()));
    }
  });
  it('binds all targets, complete image range and exact image hash in the distinct permanent wire', async () => {
    const approved = await plan();
    expect(approved.instruction.length).toBe(342);
    expect(approved.instruction[0]).toBe(0);
    expect(approved.commitments[0]).toEqual({ address: addr(44), offset: 0, length: 20, sha256: await sha256(image()) });
    expect(approved.instruction.subarray(105, 137)).toEqual(Pubkey.from(approved.proofSlot!.program).toBytes());
    expect(approved.instruction.subarray(203, 207)).toEqual(Uint8Array.of(0, 0, 0, 0));
    expect(approved.instruction.subarray(207, 211)).toEqual(Uint8Array.of(20, 0, 0, 0));
    const other = image(); other[9] = 7;
    const mutated = await plan({ kind: 'createPermanent', seed: 'governed-test', source: { address: addr(44), bytes: other }, pin: true, proofSlotSeed: slotSeed() });
    expect(mutated.planSha256).not.toBe(approved.planSha256);
    approved.instruction[105] ^= 1;
    await expect(assertGovernancePlan(approved)).rejects.toThrow('modified');
  });
  it('keeps approved request and fixed child slots unchanged across real signed transactions with different executors', async () => {
    const approved = await plan(), request = await buildMultisigInvokeRequest(approved);
    const writer = buildWriteProofSlot(approved.accounts, slotSeed(), proof(true), proof(true));
    const execute = concat(integer(3, 4), integer(accountSlot(approved.accounts, addr(33)), 2), integer(accountSlot(approved.accounts, addr(34)), 2));
    const calls = [{ program: CORE_PROGRAM_ADDRESS, instruction: writer }, { program: BOOTSTRAP_PROGRAM_ADDRESSES.multisig, instruction: execute }];
    const client = createThruClient();
    const transactions = [];
    for (const byte of [71, 72]) {
      const privateKey = new Uint8Array(32).fill(byte), publicKey = await client.keys.fromPrivateKey(privateKey);
      const tx = await buildGovernanceTransaction(approved, publicKey, calls);
      const signed = await client.transactions.buildAndSign({ ...tx, feePayer: { publicKey, privateKey }, header: { fee: 0n, nonce: 0n, startSlot: 10n, chainId: 1 } });
      expect(signed.rawTransaction.length).toBeLessThanOrEqual(32768);
      expect(MulticallArgs.validate(tx.instructionData).ok).toBe(true);
      transactions.push(Transaction.fromWire(signed.rawTransaction));
    }
    expect(transactions[0].instructionData).toEqual(transactions[1].instructionData);
    expect(transactions[0].readWriteAccounts.map(p => p.toThruFmt())).toEqual(transactions[1].readWriteAccounts.map(p => p.toThruFmt()));
    expect(await buildMultisigInvokeRequest(approved)).toEqual(request);
  });
  it('refreshes two target-specific proofs without changing approved bytes or adding a marker', async () => {
    const approved = await plan(), before = approved.instruction.slice();
    const generate = vi.fn(async (_request: { address: string }) => ({ proof: proof() }));
    const call = await refreshCoreProofSlot({ proofs: { generate } } as unknown as Thru, approved);
    expect(call.instruction.length).toBe(75 + 208);
    const decoded = WriteProofSlotArgs.from_array(call.instruction.subarray(1));
    expect(decoded).not.toBeNull();
    expect(decoded!.get_metadata_proof_size()).toBe(104);
    expect(decoded!.get_metadata_proof_length()).toBe(104);
    expect(decoded!.get_program_proof_size()).toBe(104);
    expect(decoded!.get_program_proof_length()).toBe(104);
    expect(generate.mock.calls.map(([r]) => r.address)).toEqual([approved.proofSlot!.metadata, approved.proofSlot!.program]);
    expect(approved.instruction).toEqual(before);
    expect(deriveCoreProofSlot(slotSeed())).toBe(approved.proofSlot!.address);
    const bad = proof(); bad[7] = 0;
    expect(() => buildWriteProofSlot(approved.accounts, slotSeed(), bad, proof())).toThrow('creation proof');
    expect(() => buildWriteProofSlot(approved.accounts, slotSeed(), new Uint8Array(105), proof())).toThrow();
  });
  it('rejects oversized approved requests and accounts for maximal proofs and fee-payer suffix', async () => {
    const approved = await plan({ kind: 'setPin', target: addr(40), pin: true });
    const many = await buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', operation: { kind: 'setPin', target: addr(40), pin: true }, executionAccounts: { readOnly: Array.from({ length: 120 }, (_, i) => addr(i + 80)) } });
    await expect(buildMultisigInvokeRequest(many)).rejects.toThrow('4096');
    expect(() => assertTransactionCapacity(approved.accounts, 25000, 8296)).toThrow('32768');
    expect(() => assertTransactionCapacity(approved.accounts, 16000, 8296)).not.toThrow();
  });
  it('encodes both two-step rotation directions and the protected-owner upgrade bridge', async () => {
    const proposed = await plan({ kind: 'proposeAdmin', candidate: addr(66), candidateKind: 'eoa' });
    expect(proposed.instruction[0]).toBe(8);
    expect(proposed.instruction.length).toBe(172);
    expect(proposed.instruction[103]).toBe(1);
    const accepted = await buildCoreOperationPlan({ admin: addr(66), adminKind: 'eoa', operation: { kind: 'acceptAdmin' } });
    expect(accepted.instruction.length).toBe(137);
    expect(new DataView(accepted.instruction.buffer).getUint16(35, true)).toBe(0);
    // Paired rotation (UNTO-3561): runs on Core A, binds Core B and both configs writable.
    for (const [rotation, peer] of [[proposed, 104], [accepted, 69]] as const) {
      expect(rotation.program).toBe(CORE_PROGRAM_ADDRESS);
      expect(Pubkey.from(rotation.instruction.subarray(peer + 2, peer + 34)).toThruFmt()).toBe(CORE_PEER_PROGRAM_ADDRESS);
      expect(Pubkey.from(rotation.instruction.subarray(peer + 36, peer + 68)).toThruFmt()).toBe(CORE_PEER_CONFIG_ADDRESS);
      expect(rotation.accounts.readWrite).toEqual(expect.arrayContaining([CORE_CONFIG_ADDRESS, CORE_PEER_CONFIG_ADDRESS]));
      expect(rotation.accounts.readOnly).toContain(CORE_PEER_PROGRAM_ADDRESS);
    }
    await expect(buildGovernanceTransaction(accepted, addr(67), [{ program: accepted.program, instruction: accepted.instruction }])).rejects.toThrow('fee payer');
    const bridge = multisigUpgradeBridge(addr(33), addr(66), 'multisig-seed', { address: addr(44), bytes: image() });
    expect(bridge.map(step => step.kind)).toEqual(['proposeAdmin', 'acceptAdmin', 'upgrade', 'proposeAdmin', 'acceptAdmin']);
    expect(bridge[3]).toMatchObject({ candidateKind: 'multisig' });
  });
  it.each(['eoa', 'multisig'] as const)('serializes canonical Multicall lifecycle operations with a direct %s wrapper', async adminKind => {
    const client = createThruClient(), privateKey = new Uint8Array(32).fill(71), publicKey = await client.keys.fromPrivateKey(privateKey);
    const operations: CoreOperation[] = [
      { kind: 'setPause', seed: BOOTSTRAP_PROGRAM_SEEDS.multicall, paused: true },
      { kind: 'setPause', seed: BOOTSTRAP_PROGRAM_SEEDS.multicall, paused: false },
      { kind: 'upgrade', seed: BOOTSTRAP_PROGRAM_SEEDS.multicall, source: { address: addr(44), bytes: image() } },
      { kind: 'destroy', seed: BOOTSTRAP_PROGRAM_SEEDS.multicall },
      { kind: 'finalize', seed: BOOTSTRAP_PROGRAM_SEEDS.multicall },
      { kind: 'setPin', target: BOOTSTRAP_PROGRAM_ADDRESSES.multicall, pin: true },
    ];
    for (const operation of operations) {
      const approved = await buildCoreOperationPlan({ admin: adminKind === 'eoa' ? publicKey : addr(33), adminKind, multisigRequest: adminKind === 'multisig' ? addr(34) : undefined, operation });
      const wrapper = adminKind === 'eoa' ? CORE_PROGRAM_ADDRESS : BOOTSTRAP_PROGRAM_ADDRESSES.multisig;
      expect(approved.accounts.readWrite).toContain(BOOTSTRAP_PROGRAM_ADDRESSES.multicall);
      expect(accountSlot(approved.accounts, wrapper)).toBe(1);
      expect(approved.accounts.readOnly).not.toContain(wrapper);
      expect(CoreInstruction.validate(approved.instruction).ok).toBe(true);
      const execute = adminKind === 'eoa' ? approved.instruction : concat(integer(3, 4), integer(accountSlot(approved.accounts, addr(33)), 2), integer(accountSlot(approved.accounts, addr(34)), 2));
      const tx = await buildGovernanceTransaction(approved, publicKey, [{ program: wrapper, instruction: execute }]);
      const signed = await client.transactions.buildAndSign({ ...tx, feePayer: { publicKey, privateKey }, header: { fee: 0n, nonce: 0n, startSlot: 10n, chainId: 1 } });
      const decoded = Transaction.fromWire(signed.rawTransaction);
      expect(decoded.instructionData).toEqual(execute);
      expect(decoded.readWriteAccounts.map(p => p.toThruFmt())).toEqual(approved.accounts.readWrite);
      expect(tx.program).toBe(wrapper);
      expect(JSON.parse(await serializeGovernancePlan(approved)).accounts.transactionProgram).toBe(wrapper);
      const targetOffset = operation.kind === 'setPin' ? 69 : 103;
      const targetSlot = new DataView(approved.instruction.buffer).getUint16(targetOffset, true);
      expect(targetSlot).toBe(accountSlot(approved.accounts, BOOTSTRAP_PROGRAM_ADDRESSES.multicall));
      if (adminKind === 'multisig') {
        const payload = await buildMultisigInvokeRequest(approved);
        expect(new DataView(payload.buffer).getUint16(44, true)).toBe(1);
        const count = new DataView(payload.buffer).getUint16(2, true);
        expect(payload.subarray(44 + count * 2, 76 + count * 2)).toEqual(Pubkey.from(wrapper).toBytes());
      }
    }
  });
  it.each(['eoa', 'multisig'] as const)('uses separate proof-refresh coordinates for direct permanent %s creation', async adminKind => {
    const approved = await buildCoreOperationPlan({ admin: addr(33), adminKind, multisigRequest: adminKind === 'multisig' ? addr(34) : undefined, executionMode: 'direct',
      operation: { kind: 'createPermanent', seed: BOOTSTRAP_PROGRAM_SEEDS.multicall, source: { address: addr(44), bytes: image() }, pin: true, proofSlotSeed: slotSeed() } });
    const writer = buildWriteProofSlot(proofSlotAccounts(approved), slotSeed(), proof(true), proof(true));
    const wrapper = approved.accounts.transactionProgram;
    const execute = adminKind === 'eoa' ? approved.instruction : concat(integer(3, 4), integer(accountSlot(approved.accounts, addr(33)), 2), integer(accountSlot(approved.accounts, addr(34)), 2));
    const calls = [{ program: CORE_PROGRAM_ADDRESS, instruction: writer }, { program: wrapper, instruction: execute }];
    const executor = adminKind === 'eoa' ? addr(33) : addr(71);
    await expect(buildGovernanceTransaction(approved, executor, calls)).rejects.toThrow('confirmed standalone proof refresh');
    const transactions = await buildGovernanceTransactions(approved, executor, calls, 8296);
    expect(transactions).toHaveLength(2);
    expect(transactions[0].program).toBe(CORE_PROGRAM_ADDRESS);
    expect(transactions[0].accounts).toEqual({ readWrite: [approved.proofSlot!.address], readOnly: [] });
    expect(new DataView(transactions[0].instructionData.buffer).getUint16(1, true)).toBe(2);
    expect(transactions[1].instructionData).toEqual(execute);
    expect(transactions[1].program).toBe(wrapper);
    for (const tx of transactions) expect(CoreInstruction.validate(tx === transactions[0] ? tx.instructionData : approved.instruction).ok).toBe(true);
  });
  it('confirms standalone proof refresh before signing direct creation and reports both transaction IDs', async () => {
    const client = createThruClient(), privateKey = new Uint8Array(32).fill(71), publicKey = await client.keys.fromPrivateKey(privateKey);
    const approved = await buildCoreOperationPlan({ admin: publicKey, adminKind: 'eoa', executionMode: 'direct',
      operation: { kind: 'createPermanent', seed: 'direct-create', source: { address: addr(44), bytes: image() }, pin: true, proofSlotSeed: slotSeed() } });
    vi.spyOn(client.proofs, 'generate').mockResolvedValue(new StateProof({ proof: proof(), slot: 7n }));
    const calls = await coreExecutionCalls(client, approved), events: string[] = [];
    const buildAndSign = client.transactions.buildAndSign;
    vi.spyOn(client.transactions, 'buildAndSign').mockImplementation(args => {
      events.push(`sign:${args.instructionData instanceof Uint8Array ? args.instructionData[0] : 'unexpected'}`);
      return buildAndSign({ ...args, header: { ...args.header, nonce: 0n, startSlot: 10n, chainId: 1 } });
    });
    vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* (raw) {
      const tx = Transaction.fromWire(raw);
      events.push(`confirmed:${tx.instructionData![0]}`);
      yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: 0, userErrorCode: 0n, consumedComputeUnits: 10 } };
    });
    const receipt = await submitGovernanceAction({ client, plan: approved, executor: { publicKey, privateKey }, calls }, 'execute');
    expect(events).toEqual(['sign:10', 'confirmed:10', 'sign:0', 'confirmed:0']);
    expect(receipt.proof_refresh_transaction_id).toBeTruthy();
    expect(receipt.transaction_id).not.toBe(receipt.proof_refresh_transaction_id);
  });
  it('re-signs and resends a governance transaction rejected for a stale nonce, and fails on other errors', async () => {
    const client = createThruClient(), privateKey = new Uint8Array(32).fill(72), publicKey = await client.keys.fromPrivateKey(privateKey);
    const approved = await buildCoreOperationPlan({ admin: publicKey, adminKind: 'eoa', executionMode: 'direct',
      operation: { kind: 'createPermanent', seed: 'stale-nonce', source: { address: addr(45), bytes: image() }, pin: true, proofSlotSeed: slotSeed() } });
    vi.spyOn(client.proofs, 'generate').mockResolvedValue(new StateProof({ proof: proof(), slot: 7n }));
    const calls = await coreExecutionCalls(client, approved), events: string[] = [];
    const buildAndSign = client.transactions.buildAndSign;
    vi.spyOn(client.transactions, 'buildAndSign').mockImplementation(args => {
      events.push(`sign:${args.instructionData instanceof Uint8Array ? args.instructionData[0] : 'unexpected'}`);
      return buildAndSign({ ...args, header: { ...args.header, nonce: 0n, startSlot: 10n, chainId: 1 } });
    });
    let stale = 2;
    vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* (raw) {
      const op = Transaction.fromWire(raw).instructionData![0];
      const vmError = op === 0 && stale-- > 0 ? -511 : 0;
      events.push(`${vmError ? 'stale' : 'confirmed'}:${op}`);
      yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError, userErrorCode: 0n, consumedComputeUnits: 0 } };
    });
    await submitGovernanceAction({ client, plan: approved, executor: { publicKey, privateKey }, calls }, 'execute');
    expect(events).toEqual(['sign:10', 'confirmed:10', 'sign:0', 'stale:0', 'sign:0', 'stale:0', 'sign:0', 'confirmed:0']);

    vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* () {
      yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: -765, userErrorCode: 1n, consumedComputeUnits: 10 } };
    });
    events.length = 0;
    await expect(submitGovernanceAction({ client, plan: approved, executor: { publicKey, privateKey }, calls }, 'execute')).rejects.toThrow(/vm_error=-765/);
    expect(events).toEqual(['sign:10']);
  });
  it('keeps Public as the arbitrary-seed default and rejects mismatched manager selection', () => {
    expect(resolveManagerSelection({}, 'user-program').manager).toBe('public');
    expect(resolveManagerSelection({ manager: 'core' }, 'user-program').programAddress).toBe(CORE_PROGRAM_ADDRESS);
    expect(() => resolveManagerSelection({ manager: 'public', managerProgramAddress: CORE_PROGRAM_ADDRESS }, 'user-program')).toThrow();
  });
  it('rejects malformed config and request-shaped Multisig state', () => {
    const bytes = new Uint8Array(72); bytes[0] = CORE_ACCOUNT_TYPE_CONFIG_V1; bytes[1] = 1; bytes.set(Pubkey.from(addr(33)).toBytes(), 8);
    expect(parseCoreConfig(bytes)).toMatchObject({ adminKind: 'eoa', admin: addr(33) });
    expect(() => parseCoreConfig(bytes.subarray(0, 71))).toThrow('Invalid Core config');
    const metadataTagged = Uint8Array.from(bytes); metadataTagged[0] = CORE_ACCOUNT_TYPE_PROGRAM_META_V1;
    expect(() => parseCoreConfig(metadataTagged)).toThrow('Invalid Core config');
    bytes[40] = 1;
    expect(() => parseCoreConfig(bytes)).toThrow('pending');
    bytes[3] = 1; bytes[2] = 2;
    expect(parseCoreConfig(bytes).pending?.kind).toBe('multisig');
    const metadata = new Uint8Array(74); metadata[0] = CORE_ACCOUNT_TYPE_PROGRAM_META_V1; metadata.fill(4, 1, 33);
    new DataView(metadata.buffer).setBigUint64(65, 3n, true); metadata[73] = 2;
    expect(parseCoreManagedMetadata(metadata)).toMatchObject({ version: 3n, state: 2 });
    expect(() => parseCoreManagedMetadata(bytes)).toThrow('Invalid Core metadata');
    metadata[40] = 1;
    expect(() => parseCoreManagedMetadata(metadata)).toThrow('Invalid Core metadata');
    const paddedRequest = new Uint8Array(1048); paddedRequest[0] = 2;
    expect(() => parseMultisigState(paddedRequest)).toThrow();
  });
});
