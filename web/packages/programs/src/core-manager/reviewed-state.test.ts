import { Account, Pubkey, Transaction, SubmissionStatus, createThruClient } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { describe, expect, it, vi } from 'vitest';
import { buildCoreOperationPlan, reviewGovernancePlan, validateReviewedStateOperation, submitGovernanceTransaction, buildGovernanceTransaction, CORE_PROGRAM_ADDRESS, CORE_PEER_PROGRAM_ADDRESS, GovernanceReceiptWithheldError, accountSlot, concat, integer, hex } from './index';
import { buildGovernedABIOperationPlan } from '../abi-manager/governance';
import { buildMultisigInvokeRequest, MULTISIG_PROGRAM_ADDRESS } from '../multisig';
const addr = (n: number) => Pubkey.from(new Uint8Array(32).fill(n)).toThruFmt();
const keyHex = (value: string) => hex(Pubkey.from(value).toBytes());
const zero = '0'.repeat(64);
function pinReview(target = addr(44)) {
  const before = { identity: 'program', address: keyHex(target), owner: keyHex(CORE_PROGRAM_ADDRESS), flags: 1 };
  return { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: before.identity, before, after: { ...before, flags: 5 } }] };
}
async function candidateFixture(operation: 'proposeAdmin' | 'acceptAdmin', drift: 'none' | 'owner' | 'flags' | 'members' | 'threshold', afterExecution: boolean,
  reviewedFlags = 0, candidateFlags: readonly [number, number] = [reviewedFlags, reviewedFlags]) {
  const client = createThruClient(), privateKey = new Uint8Array(32).fill(71), publicKey = await client.keys.fromPrivateKey(privateKey);
  const accepting = operation === 'acceptAdmin', candidate = addr(33);
  const descriptor = { address: keyHex(candidate), flags: reviewedFlags, members: [keyHex(addr(11)), keyHex(addr(12))], threshold: 2 };
  const role = { kind: 'eoa', admin: hex(publicKey), pending_kind: accepting ? 'multisig' : 'none', pending_admin: accepting ? keyHex(candidate) : zero };
  // Paired rotation (UNTO-3561): Core B's role moves with Core A's.
  const before = { core: role, core_peer: role, multisigs: { candidate: descriptor } };
  const next = accepting
    ? { kind: 'multisig', admin: keyHex(candidate), pending_kind: 'none', pending_admin: zero }
    : { ...role, pending_kind: 'multisig', pending_admin: keyHex(candidate) };
  const after = { ...before, core: next, core_peer: next };
  const reviewedStatePlan = { genesis_inventory_sha256: 'a'.repeat(64), changes: [], roles: { before, after } };
  const plan = await buildCoreOperationPlan({ admin: accepting ? candidate : publicKey, adminKind: accepting ? 'multisig' : 'eoa', multisigRequest: accepting ? addr(34) : undefined,
    executionMode: 'direct', operation: accepting ? { kind: 'acceptAdmin' } : { kind: 'proposeAdmin', candidate, candidateKind: 'multisig' }, reviewedStatePlan });
  const state = new Uint8Array(1048), view = new DataView(state.buffer);
  state[0] = 1; view.setUint16(2, 2, true); view.setUint16(4, 2, true); view.setUint16(6, 1, true); view.setBigUint64(16, 1n, true);
  state.set(Pubkey.from(addr(11)).toBytes(), 24); state.set(Pubkey.from(addr(12)).toBytes(), 56);
  const payload = accepting ? await buildMultisigInvokeRequest(plan) : new Uint8Array();
  const request = concat(integer(2, 1), integer(0, 1), integer(0, 2), integer(2, 2), integer(2, 2), integer(0, 8), integer(0, 8), integer(3, 8), integer(payload.length, 8), Pubkey.from(candidate).toBytes(), Pubkey.from(addr(11)).toBytes(), payload);
  let executed = false;
  vi.spyOn(client.accounts, 'get').mockImplementation(async target => {
    const isCandidate = Pubkey.from(target).equals(candidate), changed = isCandidate && (afterExecution ? executed : true);
    const bytes = isCandidate ? state.slice() : request;
    if (changed && drift === 'threshold') new DataView(bytes.buffer).setUint16(4, 1, true);
    if (changed && drift === 'members') bytes.set(Pubkey.from(addr(13)).toBytes(), 56);
    const liveFlags = (isCandidate ? candidateFlags[executed ? 1 : 0] : 0) ^ (changed && drift === 'flags' ? 4 : 0);
    return { address: Pubkey.from(target), meta: { owner: Pubkey.from(changed && drift === 'owner' ? addr(99) : MULTISIG_PROGRAM_ADDRESS),
      flags: { isProgram: Boolean(liveFlags & 1), isPrivileged: Boolean(liveFlags & 2), isUncompressable: Boolean(liveFlags & 4),
        isEphemeral: Boolean(liveFlags & 8), isDeleted: Boolean(liveFlags & 16), isNew: Boolean(liveFlags & 32),
        isCompressed: Boolean(liveFlags & 64), isNativeReceiver: Boolean(liveFlags & 128) } }, data: { data: bytes } } as Account;
  });
  const buildAndSign = client.transactions.buildAndSign, wires: Transaction[] = [];
  const sign = vi.spyOn(client.transactions, 'buildAndSign').mockImplementation(args => buildAndSign({ ...args, header: { ...args.header, nonce: 0n, startSlot: 10n, chainId: 1 } }));
  const send = vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* (raw) {
    wires.push(raw instanceof Transaction ? raw : Transaction.fromWire(raw)); executed = true;
    yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: 0, userErrorCode: 0n, consumedComputeUnits: 10 } };
  });
  vi.spyOn(client.transactions, 'get').mockImplementation(async () => Object.assign(wires[wires.length - 1], { slot: 10n }));
  const instruction = accepting ? concat(integer(3, 4), integer(accountSlot(plan.accounts, candidate), 2), integer(accountSlot(plan.accounts, addr(34)), 2)) : plan.instruction;
  return { plan, sign, send, wires, args: { client, plan, executor: { publicKey, privateKey }, calls: [{ program: plan.accounts.transactionProgram, instruction }], reviewedPlanSha256: plan.reviewedStatePlanSha256! } };
}
describe('reviewed-state execution receipt integrity', () => {
  it('rejects unrelated reviewed subjects and extra effects before sealing', async () => {
    const plan = await buildCoreOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'setPin', target: addr(44), pin: true } });
    await expect(reviewGovernancePlan(plan, pinReview(addr(45)))).rejects.toThrow();
    const extra = pinReview(); extra.changes[0].after.flags = 7;
    await expect(reviewGovernancePlan(plan, extra)).rejects.toThrow('pin flags');
    const reviewed = await reviewGovernancePlan(plan, pinReview());
    expect(reviewed.reviewedStatePlanSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reviewed.planSha256).not.toBe(plan.planSha256);
  });
  it('rejects unrelated receipt digests and substituted calls before signing', async () => {
    const plan = await buildCoreOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'setPin', target: addr(44), pin: true }, reviewedStatePlan: pinReview() });
    const buildAndSign = vi.fn();
    const client = { transactions: { buildAndSign } } as unknown as Thru;
    const args = { client, plan, executor: { publicKey: Pubkey.from(addr(11)).toBytes(), privateKey: new Uint8Array(32) }, calls: [{ program: plan.program, instruction: plan.instruction }], reviewedPlanSha256: 'f'.repeat(64) };
    await expect(submitGovernanceTransaction(args)).rejects.toThrow('not bound');
    const substituted = plan.instruction.slice(); substituted[103] = 0;
    await expect(submitGovernanceTransaction({ ...args, reviewedPlanSha256: plan.reviewedStatePlanSha256!, calls: [{ program: plan.program, instruction: substituted }] })).rejects.toThrow('differs');
    expect(buildAndSign).not.toHaveBeenCalled();
    await expect(buildGovernanceTransaction(plan, addr(11), [...args.calls, ...args.calls])).rejects.toThrow('calls differ');
  });
  it('binds the exact upgraded artifact and version, excluding unrelated authority changes', async () => {
    const image = new Uint8Array(20); image[0] = 1;
    const plan = await buildCoreOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'upgrade', seed: 'reviewed-image', source: { address: addr(55), bytes: image } } });
    const subject = hex(plan.instruction.subarray(105, 137)), metadata = hex(plan.instruction.subarray(71, 103));
    const before = { identity: 'image', address: subject, owner: keyHex(CORE_PROGRAM_ADDRESS), flags: 1, executable: { path: 'old.bin', size: 20, sha256: '1'.repeat(64) }, metadata: { address: metadata, version: '3', state: 'open', authority: zero, candidate: zero, flags: 0 } };
    const after = { ...before, executable: { path: 'reviewed.bin', size: 20, sha256: plan.commitments[0].sha256 }, metadata: { ...before.metadata, version: '4' } };
    const reviewed = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: 'image', before, after }] };
    expect(() => validateReviewedStateOperation(reviewed, plan)).not.toThrow();
    after.executable.sha256 = '2'.repeat(64);
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('artifact digest');
    after.executable.sha256 = plan.commitments[0].sha256;
    after.metadata.authority = '3'.repeat(64);
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('exceed');
  });
  it('requires the canonical empty executable commitment for destroy and preserves artifact identity', async () => {
    const plan = await buildCoreOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'destroy', seed: 'reviewed-destroy' } });
    const subject = hex(plan.instruction.subarray(105, 137)), metadata = hex(plan.instruction.subarray(71, 103));
    const before = {
      identity: 'image', address: subject, owner: keyHex(CORE_PROGRAM_ADDRESS), flags: 5,
      executable: { identity: 'image', address: subject, subject, owner: keyHex(CORE_PROGRAM_ADDRESS), path: 'image.bin', size: 20, sha256: '1'.repeat(64) },
      metadata: { address: metadata, version: '3', state: 'open', authority: zero, candidate: zero, flags: 4 },
    };
    const after = {
      ...before, flags: 4, metadata: { ...before.metadata, state: 'destroyed' },
      executable: { ...before.executable, size: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    };
    const reviewed = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: before.identity, before, after }] };
    await expect(reviewGovernancePlan(plan, reviewed)).resolves.toMatchObject({ reviewedStatePlanSha256: expect.any(String) });
    for (const executable of [
      { ...after.executable, sha256: before.executable.sha256 },
      { ...after.executable, size: 20 },
      { ...after.executable, identity: 'other' },
      { ...after.executable, path: 'other.bin' },
    ]) {
      const invalid = { ...reviewed, changes: [{ ...reviewed.changes[0], after: { ...after, executable } }] };
      expect(() => validateReviewedStateOperation(invalid, plan)).toThrow();
    }
    after.metadata.version = '4';
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('exceed');
  });
  it.each([
    [5, 4, 4, 4], [9, 8, 24, 24], [33, 4, 48, 4], [5, 32, 4, 48], [161, 160, 48, 48],
  ])('binds independent destroy classes %i/%i to %i/%i', async (programFlags, metadataFlags, programAfter, metadataAfter) => {
    const plan = await buildCoreOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'destroy', seed: 'reviewed-classes' } });
    const before = { identity: 'image', address: hex(plan.instruction.subarray(105, 137)), owner: keyHex(CORE_PROGRAM_ADDRESS), flags: programFlags,
      executable: { size: 20, sha256: '1'.repeat(64) },
      metadata: { address: hex(plan.instruction.subarray(71, 103)), flags: metadataFlags, state: 'open' } };
    const after = { ...before, flags: programAfter, metadata: { ...before.metadata, flags: metadataAfter, state: 'destroyed' },
      executable: { size: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' } };
    const reviewed = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: before.identity, before, after }] };
    expect(() => validateReviewedStateOperation(reviewed, plan)).not.toThrow();
    for (const target of [after, after.metadata]) {
      const expected = target.flags;
      for (const wrong of [expected ^ 16, expected ^ 32, expected ^ 4, -1, 256, 0.5]) {
        target.flags = wrong; expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow();
      }
      target.flags = expected;
    }
    for (const target of [before, before.metadata]) {
      const expected = target.flags;
      for (const wrong of [expected | 16, expected | 64, -1, 256, 0.5]) {
        target.flags = wrong; expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow();
      }
      target.flags = expected;
    }
  });
  it.each([[4, 4], [8, 24], [32, 48], [160, 48]])('closes ABI content flags %i -> %i without deleting metadata', async (beforeFlags, afterFlags) => {
    const plan = await buildGovernedABIOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'close', seed: 'reviewed-close-flags' } });
    const before = { identity: 'image', address: hex(plan.instruction.subarray(71, 103)), owner: keyHex(CORE_PROGRAM_ADDRESS),
      abi: { metadata_address: hex(plan.instruction.subarray(139, 171)), content_address: hex(plan.instruction.subarray(173, 205)),
        owner: keyHex(plan.program), state: 'finalized', metadata_flags: 8, content_flags: beforeFlags } };
    const after = { ...before, abi: { ...before.abi, state: 'closed', content_flags: afterFlags } };
    const reviewed = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: before.identity, before, after }] };
    expect(() => validateReviewedStateOperation(reviewed, plan)).not.toThrow();
    for (const wrong of [afterFlags ^ 16, afterFlags ^ 32, afterFlags ^ 4, -1, 256, 0.5]) {
      after.abi.content_flags = wrong; expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow();
    }
    after.abi.content_flags = afterFlags;
    after.abi.metadata_flags |= 16;
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('exceed');
    after.abi.metadata_flags = 8;
    for (const wrong of [beforeFlags | 16, beforeFlags | 64, -1, 256, 0.5]) {
      before.abi.content_flags = wrong; expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow();
    }
  });
  it('binds finalized ABI close to only the lifecycle change', async () => {
    const plan = await buildGovernedABIOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'close', seed: 'reviewed-close' } });
    const before = {
      identity: 'image', address: hex(plan.instruction.subarray(71, 103)), owner: keyHex(CORE_PROGRAM_ADDRESS), flags: 5,
      abi: {
        metadata_address: hex(plan.instruction.subarray(139, 171)), content_address: hex(plan.instruction.subarray(173, 205)),
        owner: keyHex(plan.program), state: 'finalized', revision: '3', metadata_flags: 4, content_flags: 4,
        artifact: { path: 'reviewed.yaml', size: 20, sha256: '1'.repeat(64) },
      },
    };
    const after = { ...before, abi: { ...before.abi, state: 'closed' } };
    const reviewed = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: before.identity, before, after }] };
    await expect(reviewGovernancePlan(plan, reviewed)).resolves.toMatchObject({ reviewedStatePlanSha256: expect.any(String) });
    after.abi = { ...after.abi, artifact: { ...after.abi.artifact, sha256: '2'.repeat(64) } };
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('exceed');
  });
  it('limits reviewed rotation changes to the exact current and candidate identities', async () => {
    const plan = await buildCoreOperationPlan({ admin: addr(11), adminKind: 'eoa', operation: { kind: 'proposeAdmin', candidate: addr(33), candidateKind: 'multisig' } });
    const role = { kind: 'eoa', admin: keyHex(addr(11)), pending_kind: 'none', pending_admin: zero };
    const before = { core: role, core_peer: role, other: { role: keyHex(addr(77)) } };
    const next = { ...role, pending_kind: 'multisig', pending_admin: keyHex(addr(33)) };
    const after = { ...before, core: next, core_peer: next,
      multisigs: { candidate: { address: keyHex(addr(33)), flags: 0, members: [keyHex(addr(11)), keyHex(addr(12))], threshold: 2 } } };
    const reviewed = { genesis_inventory_sha256: 'a'.repeat(64), changes: [], roles: { before, after } };
    expect(() => validateReviewedStateOperation(reviewed, plan)).not.toThrow();
    after.other = { role: keyHex(addr(78)) };
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('rotation roles');
    // Both configs rotate in one instruction: Core B's role must move with Core A's.
    after.other = before.other; after.core_peer = role;
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('rotation roles');
    after.core_peer = next; (before as Record<string, unknown>).core_peer = next;
    expect(() => validateReviewedStateOperation(reviewed, plan)).toThrow('Core B roles equal Core A roles');
  });
  it.each(['proposeAdmin', 'acceptAdmin'] as const)('rejects %s candidate drift before submission and after execution', async operation => {
    for (const reviewedFlags of [0, 4]) for (const drift of ['owner', 'flags', 'members', 'threshold'] as const) {
      const before = await candidateFixture(operation, drift, false, reviewedFlags, [reviewedFlags | 32, reviewedFlags]);
      await expect(submitGovernanceTransaction(before.args)).rejects.toThrow(drift === 'owner' || drift === 'flags' ? 'Candidate owner/flags' : 'Candidate membership/threshold');
      expect(before.send).not.toHaveBeenCalled();
      const after = await candidateFixture(operation, drift, true, reviewedFlags, [reviewedFlags | 32, reviewedFlags]);
      let failure: unknown;
      try { await submitGovernanceTransaction(after.args); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(GovernanceReceiptWithheldError);
      expect((failure as GovernanceReceiptWithheldError).message).toContain('executed');
      expect((failure as GovernanceReceiptWithheldError).receipt.transaction_id).toBeTruthy();
      expect((failure as GovernanceReceiptWithheldError).receipt).not.toHaveProperty('success');
      expect(after.send).toHaveBeenCalledTimes(1);
      expect(after.wires[0].program.toThruFmt()).toBe(after.plan.accounts.transactionProgram);
    }
  });
  it.each(['proposeAdmin', 'acceptAdmin'] as const)('returns a reviewed %s receipt across transient NEW changes', async operation => {
    for (const reviewedFlags of [0, 4]) for (const liveFlags of [[reviewedFlags, reviewedFlags], [reviewedFlags | 32, reviewedFlags | 32], [reviewedFlags | 32, reviewedFlags]] as const) {
      const fixture = await candidateFixture(operation, 'none', false, reviewedFlags, liveFlags);
      await expect(submitGovernanceTransaction(fixture.args)).resolves.toMatchObject({ success: true, plan_sha256: fixture.plan.reviewedStatePlanSha256 });
      expect(fixture.sign).toHaveBeenCalledTimes(1);
      expect(fixture.send).toHaveBeenCalledTimes(1);
      expect(fixture.wires[0].program.toThruFmt()).toBe(fixture.plan.accounts.transactionProgram);
    }
  });
  it.each(['proposeAdmin', 'acceptAdmin'] as const)('rejects noncanonical reviewed %s flags instead of masking them', async operation => {
    for (const flags of [1, 2, 8, 16, 32, 36, 64, 128, -1, 256, 0.5]) {
      await expect(candidateFixture(operation, 'none', false, flags)).rejects.toThrow(/Invalid reviewed/);
    }
  });
  it.each(['proposeAdmin', 'acceptAdmin'] as const)('rejects other live %s capability bits before and after execution', async operation => {
    for (const reviewedFlags of [0, 4]) for (const forbidden of [1, 2, 8, 16, 64, 128]) {
      const before = await candidateFixture(operation, 'none', false, reviewedFlags, [reviewedFlags | 32 | forbidden, reviewedFlags]);
      await expect(submitGovernanceTransaction(before.args)).rejects.toThrow('Candidate owner/flags');
      expect(before.send).not.toHaveBeenCalled();
      const after = await candidateFixture(operation, 'none', false, reviewedFlags, [reviewedFlags | 32, reviewedFlags | forbidden]);
      await expect(submitGovernanceTransaction(after.args)).rejects.toBeInstanceOf(GovernanceReceiptWithheldError);
      expect(after.send).toHaveBeenCalledTimes(1);
    }
  });
  it('refuses missing or malformed existing candidate descriptors instead of trusting RPC roles', async () => {
    const fixture = await candidateFixture('proposeAdmin', 'none', false);
    const reviewed = structuredClone(fixture.plan.reviewedStatePlan) as { roles: { before: { multisigs?: unknown }; after: { multisigs?: unknown } } };
    delete reviewed.roles.before.multisigs; delete reviewed.roles.after.multisigs;
    expect(() => validateReviewedStateOperation(reviewed, fixture.plan)).toThrow('candidate Multisig');
    const invalid = { candidate: { address: keyHex(addr(33)), flags: 1, members: [keyHex(addr(11)), keyHex(addr(12))], threshold: 2 } };
    reviewed.roles.before.multisigs = invalid; reviewed.roles.after.multisigs = invalid;
    expect(() => validateReviewedStateOperation(reviewed, fixture.plan)).toThrow('candidate Multisig');
  });
});
describe('Core A <-> B loop operations (UNTO-3561)', () => {
  const bytes = new Uint8Array(20); bytes[0] = 1; bytes[8] = 0x13;
  const source = { address: addr(55), bytes };
  it('accepts UpgradePeer only on Core B, against Core A, and Core B performs nothing else', async () => {
    const peer = await buildCoreOperationPlan({ admin: addr(9), adminKind: 'eoa', executionMode: 'direct', operation: { kind: 'upgradePeer', source } });
    expect(Pubkey.from(peer.program).equals(CORE_PEER_PROGRAM_ADDRESS)).toBe(true);
    const root = { identity: 'core_manager', address: keyHex(CORE_PROGRAM_ADDRESS), owner: keyHex(CORE_PEER_PROGRAM_ADDRESS), flags: 5,
      executable: { identity: 'core_manager:executable', role: 'executable', path: 'a.so', subject: '', address: '', owner: '', size: 9, sha256: 'b'.repeat(64) } };
    const after = structuredClone(root); after.executable.size = 20; after.executable.sha256 = peer.commitments[0].sha256;
    const reviewed = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: 'core_manager', before: root, after }] };
    expect(() => validateReviewedStateOperation(reviewed, peer)).not.toThrow();
    const lifted = structuredClone(reviewed); lifted.changes[0].after.flags = 1;
    expect(() => validateReviewedStateOperation(lifted, peer)).toThrow('exceed');
    expect(() => validateReviewedStateOperation(reviewed, { ...peer, program: CORE_PROGRAM_ADDRESS })).toThrow('Core A has no UpgradePeer');
    const pin = pinReview();
    const onB = await buildCoreOperationPlan({ admin: addr(9), adminKind: 'eoa', executionMode: 'direct', operation: { kind: 'setPin', target: addr(44), pin: true } });
    expect(() => validateReviewedStateOperation(pin, { ...onB, program: CORE_PEER_PROGRAM_ADDRESS })).toThrow('Core B performs only');
    const rotate = await buildCoreOperationPlan({ admin: addr(9), adminKind: 'eoa', executionMode: 'direct', operation: { kind: 'acceptAdmin' } });
    expect(Pubkey.from(rotate.program).equals(CORE_PROGRAM_ADDRESS)).toBe(true);
    expect(() => validateReviewedStateOperation(pin, { ...rotate, program: CORE_PEER_PROGRAM_ADDRESS })).toThrow('admin rotation runs on Core A');
  });
});
