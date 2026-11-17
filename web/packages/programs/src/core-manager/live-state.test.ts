import { Account, Pubkey, SubmissionStatus, Transaction, createThruClient } from '@thru/sdk';
import { describe, expect, it, vi } from 'vitest';
import { accountSlot, buildCoreOperationPlan, digestBytes, governanceRequestPayload, buildWriteProofSlot, concat, CORE_PROGRAM_ADDRESS, GovernanceReceiptWithheldError, hex, integer, proofSlotAccounts, reviewGovernancePlan, sha256, submitGovernanceAction, submitGovernanceTransaction, type GovernancePlan } from './index';
import { buildGovernedABIOperationPlan } from '../abi-manager/governance';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';

const addr = (n: number) => Pubkey.from(new Uint8Array(32).fill(n)).toThruFmt();
const keyHex = (value: string) => hex(Pubkey.from(value).toBytes());
const zero = '0'.repeat(64);
const yaml = new TextEncoder().encode(`abi:
  package: test.reviewed
  abi-version: 1
  package-version: "1.0.0"
  description: reviewed fixture
  imports: []
types:
  - name: Value
    kind:
      struct:
        packed: true
        fields:
          - name: count
            field-type:
              primitive: u64
`);
interface Snapshot {
  identity: string; address: string; owner: string; flags: number;
  executable?: { path: string; size: number; sha256: string };
  metadata?: { address: string; owner: string; flags: number; version: string; state: string; authority: string; candidate: string };
  abi?: { metadata_address: string; content_address: string; owner: string; metadata_flags: number; content_flags: number; revision: string; state: string; artifact: { path: string; size: number; sha256: string } };
}
function account(address: string, owner: string, flags: number, bytes: Uint8Array): Account {
  return { address: Pubkey.from(Uint8Array.from(address.match(/../g)!, x => parseInt(x, 16))), meta: {
    owner: Pubkey.from(Uint8Array.from(owner.match(/../g)!, x => parseInt(x, 16))), dataSize: bytes.length,
    flags: { isProgram: Boolean(flags & 1), isPrivileged: Boolean(flags & 2), isUncompressable: Boolean(flags & 4), isEphemeral: Boolean(flags & 8),
      isDeleted: Boolean(flags & 16), isNew: Boolean(flags & 32), isCompressed: Boolean(flags & 64), isNativeReceiver: Boolean(flags & 128) },
  }, data: { data: bytes } } as Account;
}
function install(state: Snapshot, image: Uint8Array, abiBytes = yaml): Map<string, Account> {
  const accounts = new Map([[state.address, account(state.address, state.owner, state.flags, image)]]);
  if (state.metadata) {
    const meta = state.metadata, bytes = new Uint8Array(meta.state === 'destroyed' ? 0 : 74);
    if (bytes.length) {
      bytes[0] = 1;
      bytes.set(Uint8Array.from(meta.authority.match(/../g)!, x => parseInt(x, 16)), 1);
      bytes.set(Uint8Array.from(meta.candidate.match(/../g)!, x => parseInt(x, 16)), 33);
      new DataView(bytes.buffer).setBigUint64(65, BigInt(meta.version), true); bytes[73] = ['open', 'paused', 'finalized'].indexOf(meta.state);
    }
    accounts.set(meta.address, account(meta.address, meta.owner, meta.flags, bytes));
  }
  if (state.abi) {
    const abi = state.abi, meta = new Uint8Array(100); meta[0] = 1;
    meta.set(Uint8Array.from(state.address.match(/../g)!, x => parseInt(x, 16)), 4);
    accounts.set(abi.metadata_address, account(abi.metadata_address, abi.owner, abi.metadata_flags, meta));
    const bytes = new Uint8Array(abi.state === 'closed' ? 0 : 46 + abiBytes.length);
    if (bytes.length) {
      bytes[0] = 2;
      bytes.set(Uint8Array.from(abi.metadata_address.match(/../g)!, x => parseInt(x, 16)), 1);
      new DataView(bytes.buffer).setBigUint64(33, BigInt(abi.revision), true); bytes[41] = abi.state === 'open' ? 0 : 1;
      new DataView(bytes.buffer).setUint32(42, abiBytes.length, true); bytes.set(abiBytes, 46);
    }
    accounts.set(abi.content_address, account(abi.content_address, abi.owner, abi.content_flags, bytes));
  }
  return accounts;
}
type Operation = 'upgrade' | 'abiUpgrade' | 'destroy' | 'abiClose' | 'createPermanent' | 'createEphemeral' | 'createMetadata' | 'createContent' | 'pin';
interface CreationFlags { before: readonly [number, number]; after: readonly [number, number]; pin?: boolean; ephemeral?: boolean }
async function fixture(operation: Operation = 'upgrade', corpse = false, deletionFlags: readonly [number, number] = [0, 0], creation?: CreationFlags) {
  const client = createThruClient(), privateKey = new Uint8Array(32).fill(71), publicKey = await client.keys.fromPrivateKey(privateKey);
  const image = new Uint8Array(20); image[0] = 1;
  const nextImage = image.slice(); nextImage[8] = 42;
  const nextYaml = new TextEncoder().encode(new TextDecoder().decode(yaml) + '\n# reviewed correction\n');
  const options = { admin: publicKey, adminKind: 'eoa' as const, executionMode: 'direct' as const };
  const abiOperation = ['abiUpgrade', 'abiClose', 'createMetadata', 'createContent'].includes(operation);
  const creatingCore = operation === 'createEphemeral' || operation === 'createPermanent';
  const creatingABI = operation === 'createMetadata' || operation === 'createContent';
  const ephemeral = creation?.ephemeral ?? true;
  const creationBefore = creation?.before ?? (corpse ? [24, 24] : [0, 0]);
  const creationAfter = creation?.after ?? (operation === 'createPermanent' ? [33, 32] : [9, 8]);
  const creationProof = new Uint8Array(104); new DataView(creationProof.buffer).setBigUint64(0, 2n << 62n, true);
  let raw: GovernancePlan;
  if (abiOperation) {
    const kind = operation === 'abiUpgrade' ? 'upgrade' : operation === 'abiClose' ? 'close' : operation as 'createMetadata' | 'createContent';
    raw = await buildGovernedABIOperationPlan({ ...options, operation: kind === 'upgrade' || kind === 'createContent'
      ? { kind, seed: 'reviewed-live', ephemeral, source: { address: addr(55), bytes: nextYaml }, ...(creatingABI && !ephemeral ? { proof: creationProof } : {}) }
      : { kind, seed: 'reviewed-live', ephemeral, ...(creatingABI && !ephemeral ? { proof: creationProof } : {}) } });
  } else {
    raw = await buildCoreOperationPlan({ ...options, operation: operation === 'pin' ? { kind: 'setPin', target: addr(44), pin: true }
      : operation === 'destroy' ? { kind: 'destroy', seed: 'reviewed-live' }
      : operation === 'createEphemeral' || operation === 'createPermanent' ? { kind: operation, seed: 'reviewed-live', source: { address: addr(55), bytes: nextImage }, pin: creation?.pin ?? false }
      : { kind: 'upgrade', seed: 'reviewed-live', source: { address: addr(55), bytes: nextImage } } });
  }
  const before: Snapshot = { identity: 'arbitrary-nonregistry-program', address: operation === 'pin' ? keyHex(addr(44)) : hex(raw.instruction.subarray(abiOperation ? 71 : 105, abiOperation ? 103 : 137)), owner: keyHex(CORE_PROGRAM_ADDRESS), flags: 1 };
  if (operation !== 'pin') {
    before.executable = { path: 'before.bin', size: image.length, sha256: await sha256(image) };
    before.metadata = { address: hex(raw.instruction.subarray(abiOperation ? 105 : 71, abiOperation ? 137 : 103)), owner: before.owner, flags: 0, version: '3', state: 'open', authority: zero, candidate: zero };
  }
  if (abiOperation) before.abi = { metadata_address: hex(raw.instruction.subarray(139, 171)), content_address: operation === 'createMetadata' ? keyHex(addr(77)) : hex(raw.instruction.subarray(173, 205)), owner: keyHex(BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager), metadata_flags: 0, content_flags: 0, revision: '3', state: operation === 'abiClose' ? 'finalized' : 'open', artifact: { path: 'before.yaml', size: yaml.length, sha256: await sha256(yaml) } };
  if (operation === 'destroy') { before.flags |= deletionFlags[0]; before.metadata!.flags = deletionFlags[1]; }
  if (operation === 'abiClose') { before.abi!.content_flags = deletionFlags[0]; before.abi!.metadata_flags = deletionFlags[1]; }
  if (creatingCore) { before.flags = creationBefore[0]; before.metadata!.flags = creationBefore[1]; }
  if (creatingABI) before.abi![operation === 'createMetadata' ? 'metadata_flags' : 'content_flags'] = creationBefore[0];
  const after = structuredClone(before);
  if (operation === 'pin') after.flags = 5;
  else if (operation === 'destroy') {
    after.flags = (before.flags & ~(1 | 128)) | (before.flags & (8 | 32) ? 16 : 0);
    after.metadata!.flags = (before.metadata!.flags & ~128) | (before.metadata!.flags & (8 | 32) ? 16 : 0);
    after.metadata!.state = 'destroyed'; after.executable = { ...after.executable!, size: 0, sha256: await sha256(new Uint8Array()) };
  }
  else if (operation === 'abiClose') {
    after.abi!.state = 'closed';
    after.abi!.content_flags = (before.abi!.content_flags & ~128) | (before.abi!.content_flags & (8 | 32) ? 16 : 0);
  }
  else if (operation === 'createMetadata') after.abi!.metadata_flags = creation?.after[0] ?? 8;
  else if (abiOperation) { after.abi!.revision = operation === 'createContent' ? '0' : '4'; after.abi!.artifact = { path: 'after.yaml', size: nextYaml.length, sha256: await sha256(nextYaml) }; if (operation === 'createContent') after.abi!.content_flags = creation?.after[0] ?? 8; }
  else { after.metadata!.version = creatingCore ? '0' : '4'; after.executable = { path: 'after.bin', size: nextImage.length, sha256: await sha256(nextImage) }; if (creatingCore) { after.flags = creationAfter[0]; after.metadata!.flags = creationAfter[1]; } }
  const review = { genesis_inventory_sha256: 'a'.repeat(64), changes: [{ identity: before.identity, before, after }] };
  const plan = await reviewGovernancePlan(raw, review);
  const prior = install(before, image), next = install(after, operation === 'destroy' ? new Uint8Array() : abiOperation || operation === 'pin' ? image : nextImage, nextYaml);
  if (creatingCore || creatingABI) {
    const targets = creatingCore
      ? [[before.address, before.owner, creationBefore[0], creationAfter[0]],
        [before.metadata!.address, before.owner, creationBefore[1], creationAfter[1]]] as const
      : [[operation === 'createMetadata' ? before.abi!.metadata_address : before.abi!.content_address, before.abi!.owner, creationBefore[0], creation?.after[0] ?? 8]] as const;
    for (const [target, owner, oldFlags, newFlags] of targets) {
      if (oldFlags & 16) prior.set(target, account(target, owner, oldFlags, new Uint8Array()));
      else prior.delete(target);
      // Runtime endpoints are explicit test inputs, not copied from the reviewed plan.
      next.set(target, account(target, owner, newFlags, next.get(target)!.data!.data!));
    }
  }
  if (operation === 'createMetadata') { prior.delete(before.abi!.content_address); next.delete(after.abi!.content_address); }
  let executed = false;
  const get = vi.spyOn(client.accounts, 'get').mockImplementation(async target => {
    const found = (executed ? next : prior).get(keyHex(Pubkey.from(target).toThruFmt()));
    if (!found) throw Object.assign(new Error('not found'), { code: 5 });
    return found;
  });
  const buildAndSign = client.transactions.buildAndSign, wires: Transaction[] = [];
  const sign = vi.spyOn(client.transactions, 'buildAndSign').mockImplementation(args => buildAndSign({ ...args, header: { ...args.header, nonce: 0n, startSlot: 10n, chainId: 1 } }));
  const send = vi.spyOn(client.transactions, 'sendAndTrack').mockImplementation(async function* (raw) {
    wires.push(raw instanceof Transaction ? raw : Transaction.fromWire(raw));
    yield { status: SubmissionStatus.ACCEPTED, consensusStatus: 0, executionResult: { vmError: 0, userErrorCode: 0n, consumedComputeUnits: 10 } };
  });
  const indexed = vi.spyOn(client.transactions, 'get').mockImplementation(async () => {
    executed = true;
    return Object.assign(wires[wires.length - 1], { slot: 10n });
  });
  const proof = new Uint8Array(104); new DataView(proof.buffer).setBigUint64(0, 2n << 62n, true);
  const calls = [...(plan.proofSlot ? [{ program: CORE_PROGRAM_ADDRESS, instruction: buildWriteProofSlot(proofSlotAccounts(plan), plan.proofSlot.seed, proof, proof) }] : []), { program: plan.program, instruction: plan.instruction }];
  return { before, after, prior, next, raw, review, plan, sign, send, get, indexed, wires, args: { client, plan, executor: { publicKey, privateKey }, calls, reviewedPlanSha256: plan.reviewedStatePlanSha256! } };
}

describe('live reviewed program submission', () => {
  it.each([
    ['createPermanent', false, 0, 0, 33, 32],
    ['createPermanent', true, 0, 0, 37, 36],
    ['createPermanent', false, 0, 16, 33, 0],
    ['createPermanent', false, 16, 0, 1, 32],
    ['createPermanent', false, 48, 16, 33, 0],
    ['createPermanent', false, 16, 48, 1, 32],
    ['createPermanent', false, 180, 16, 37, 0],
    ['createPermanent', true, 16, 176, 5, 36],
    ['createEphemeral', false, 0, 0, 9, 8],
    ['createEphemeral', true, 0, 0, 13, 12],
    ['createEphemeral', false, 156, 24, 9, 8],
    ['createEphemeral', true, 24, 156, 13, 12],
  ] as const)('certifies independent %s creation flags, pin=%s, %i/%i -> %i/%i', async (operation, pin, first, second, firstAfter, secondAfter) => {
    const f = await fixture(operation, false, [0, 0], { pin, before: [first, second], after: [firstAfter, secondAfter] });
    await expect(submitGovernanceTransaction(f.args)).resolves.toMatchObject({ success: true, plan_sha256: f.plan.reviewedStatePlanSha256 });
    expect(f.send).toHaveBeenCalledTimes(operation === 'createPermanent' ? 2 : 1);
  });
  it.each(['createMetadata', 'createContent'] as const)('certifies %s fresh and revived permanent/ephemeral flags', async operation => {
    for (const [ephemeral, before, after] of [[false, 0, 32], [false, 16, 0], [false, 48, 32], [false, 180, 36], [true, 0, 8], [true, 156, 8]] as const) {
      const f = await fixture(operation, false, [0, 0], { ephemeral, before: [before, 0], after: [after, 0] });
      await expect(submitGovernanceTransaction(f.args)).resolves.toMatchObject({ success: true, plan_sha256: f.plan.reviewedStatePlanSha256 });
      expect(f.send).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['createPermanent', 'createEphemeral', 'createMetadata', 'createContent'] as const)('rejects impossible %s reviews before any transaction is signed or submitted', async operation => {
    for (const ephemeral of operation === 'createMetadata' || operation === 'createContent' ? [false, true] : [operation === 'createEphemeral']) {
      const core = operation === 'createPermanent' || operation === 'createEphemeral';
      const f = await fixture(operation, false, [0, 0], { ephemeral, before: [0, 0], after: core ? (ephemeral ? [9, 8] : [33, 32]) : [ephemeral ? 8 : 32, 0] });
      for (const phase of ['before', 'after'] as const) for (const target of core ? ['program', 'metadata'] : ['abi']) {
        const valid = phase === 'before' ? 0 : core ? target === 'program' ? f.after.flags : f.after.metadata!.flags : f.after.abi![operation === 'createMetadata' ? 'metadata_flags' : 'content_flags'];
        const invalidFlags = phase === 'before'
          ? [1, 4, 8, 32, 64, 128, ephemeral ? 16 : 24, ephemeral ? 56 : 80, -1, 256, 0.5]
          : [valid ^ 32, valid ^ 4, valid ^ 8, valid | 16, valid | 64, valid | 128, -1, 256, 0.5];
        for (const wrong of invalidFlags) {
          const review = structuredClone(f.review), state = review.changes[0][phase];
          if (target === 'program') state.flags = wrong;
          else if (target === 'metadata') state.metadata!.flags = wrong;
          else state.abi![operation === 'createMetadata' ? 'metadata_flags' : 'content_flags'] = wrong;
          await expect(reviewGovernancePlan(f.raw, review).then(plan => submitGovernanceTransaction({ ...f.args, plan, reviewedPlanSha256: plan.reviewedStatePlanSha256! }))).rejects.toThrow(/flags/);
        }
      }
      expect(f.sign).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    }
  });
  it.each(['createPermanent', 'createEphemeral', 'createMetadata', 'createContent'] as const)('withholds %s receipts when NEW differs from the exact approved result', async operation => {
    const f = await fixture(operation), target = operation === 'createPermanent' || operation === 'createEphemeral' ? f.after.address : operation === 'createMetadata' ? f.after.abi!.metadata_address : f.after.abi!.content_address;
    const live = f.next.get(target)!; live.meta!.flags.isNew = !live.meta!.flags.isNew;
    await expect(submitGovernanceTransaction(f.args)).rejects.toBeInstanceOf(GovernanceReceiptWithheldError);
    expect(f.send).toHaveBeenCalled();
  });
  it.each(['upgrade', 'abiUpgrade', 'destroy', 'abiClose', 'createEphemeral', 'createMetadata', 'createContent', 'pin'] as const)('certifies the legitimate %s transition', async operation => {
    const f = await fixture(operation);
    await expect(submitGovernanceTransaction(f.args)).resolves.toMatchObject({ success: true, plan_sha256: f.plan.reviewedStatePlanSha256 });
    expect(f.sign).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.wires[0].program.toThruFmt()).toBe(f.plan.program);
  });
  it.each(['destroy', 'abiClose'] as const)('certifies %s removable corpses or sealed absence without masking NEW', async operation => {
    for (const pair of [[8, 8], [32, 4], [4, 32], [160, 160]] as const) {
      for (const sealed of [false, true]) {
        const f = await fixture(operation, false, pair);
        const targets = operation === 'destroy' ? [f.after.address, f.after.metadata!.address] : [f.after.abi!.content_address];
        if (sealed) for (const target of targets) if (f.next.get(target)!.meta!.flags.isDeleted) f.next.delete(target);
        await expect(submitGovernanceTransaction(f.args)).resolves.toMatchObject({ success: true });
      }
    }
  });
  it.each(['destroy', 'abiClose'] as const)('withholds %s receipts for missing permanent accounts, resurrection, drift, or RPC failure', async operation => {
    for (const drift of ['permanentMissing', 'metadataMissing', 'resurrected', 'owner', 'flags', 'nonempty', 'rpc', 'newCleared'] as const) {
      const f = await fixture(operation, false, drift === 'permanentMissing' ? [4, 4] : [32, 8]);
      const target = operation === 'destroy' ? f.after.address : f.after.abi!.content_address;
      const owner = operation === 'destroy' ? f.after.owner : f.after.abi!.owner;
      const flags = operation === 'destroy' ? f.after.flags : f.after.abi!.content_flags;
      if (drift === 'permanentMissing') f.next.delete(target);
      else if (drift === 'metadataMissing') {
        if (operation === 'destroy') continue; // Removable Core metadata may disappear; ABI metadata is never closed.
        f.next.delete(f.after.abi!.metadata_address);
      }
      else if (drift === 'resurrected') f.next.set(target, account(target, owner, flags & ~16, new Uint8Array()));
      else if (drift === 'owner') f.next.set(target, account(target, keyHex(addr(99)), flags, new Uint8Array()));
      else if (drift === 'flags') f.next.set(target, account(target, owner, flags | 2, new Uint8Array()));
      else if (drift === 'newCleared') f.next.set(target, account(target, owner, flags & ~(16 | 32), new Uint8Array()));
      else if (drift === 'nonempty') f.next.set(target, account(target, owner, flags, new Uint8Array(1)));
      else {
        const get = f.get.getMockImplementation()!;
        f.get.mockImplementation(async address => {
          if (f.indexed.mock.calls.length) throw Object.assign(new Error('RPC unavailable'), { code: 14 });
          return get(address);
        });
      }
      const failure = await submitGovernanceTransaction(f.args).catch(error => error);
      expect(failure).toBeInstanceOf(GovernanceReceiptWithheldError);
      expect(failure.receipt.transaction_id).toBeTruthy();
      expect(failure.receipt).not.toHaveProperty('success');
    }
  });
  it.each(['destroy', 'abiClose'] as const)('rejects %s NEW cleared by prior decompression instead of adopting a different deletion class', async operation => {
    const f = await fixture(operation, false, [32, 4]);
    const target = operation === 'destroy' ? f.before.address : f.before.abi!.content_address;
    const live = f.prior.get(target)!;
    const owner = operation === 'destroy' ? f.before.owner : f.before.abi!.owner;
    f.prior.set(target, account(target, owner, operation === 'destroy' ? 1 : 0, live.data!.data!));
    await expect(submitGovernanceTransaction(f.args)).rejects.toThrow('flags');
    expect(f.sign).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['upgrade', 'abiUpgrade'] as const)('rejects stale %s before signing and withholds a racing receipt', async operation => {
    for (const post of [false, true]) {
      const f = await fixture(operation), abi = operation === 'abiUpgrade', snapshot = post ? f.after : f.before;
      const target = abi ? snapshot.abi!.content_address : snapshot.metadata!.address;
      const live = (post ? f.next : f.prior).get(target)!;
      new DataView(live.data!.data!.buffer).setBigUint64(abi ? 33 : 65, post ? 5n : 4n, true);
      if (!post) {
        await expect(submitGovernanceTransaction(f.args)).rejects.toThrow(abi ? 'revision' : 'version');
        expect(f.sign).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
      } else {
        let failure: unknown;
        try { await submitGovernanceTransaction(f.args); } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(GovernanceReceiptWithheldError);
        expect((failure as GovernanceReceiptWithheldError).receipt.transaction_id).toBeTruthy();
        expect((failure as GovernanceReceiptWithheldError).receipt).not.toHaveProperty('success');
        expect(f.send).toHaveBeenCalledTimes(1);
      }
    }
  });
  it.each(['owner', 'flags', 'new', 'metadataOwner', 'metadataFlags', 'authority', 'candidate', 'lifecycle', 'image', 'truncated', 'abiOwner', 'abiFlags', 'abiLink', 'contentLink', 'abiLifecycle', 'abiHash'] as const)('rejects approved durable %s drift before and after execution', async drift => {
    for (const post of [false, true]) {
      const f = await fixture(drift.startsWith('abi') || drift === 'contentLink' ? 'abiUpgrade' : 'upgrade'), state = post ? f.after : f.before, accounts = post ? f.next : f.prior;
      const image = accounts.get(state.address)!, meta = accounts.get(state.metadata!.address)!;
      if (drift === 'owner') image.meta!.owner = Pubkey.from(addr(99));
      else if (drift === 'flags') image.meta!.flags.isUncompressable = true;
      else if (drift === 'new') image.meta!.flags.isNew = true;
      else if (drift === 'metadataOwner') meta.meta!.owner = Pubkey.from(addr(99));
      else if (drift === 'metadataFlags') meta.meta!.flags.isUncompressable = true;
      else if (drift === 'authority' || drift === 'candidate') meta.data!.data![drift === 'authority' ? 1 : 33] = 1;
      else if (drift === 'lifecycle') meta.data!.data![73] = 1;
      else if (drift === 'image') image.data!.data![8] ^= 1;
      else if (drift === 'truncated') accounts.set(state.address, account(state.address, state.owner, state.flags, new Uint8Array()));
      else {
        const abi = state.abi!, metadata = accounts.get(abi.metadata_address)!, content = accounts.get(abi.content_address)!;
        if (drift === 'abiOwner') metadata.meta!.owner = Pubkey.from(addr(99));
        else if (drift === 'abiFlags') content.meta!.flags.isUncompressable = true;
        else if (drift === 'abiLink') metadata.data!.data![4] ^= 1;
        else if (drift === 'contentLink') content.data!.data![1] ^= 1;
        else if (drift === 'abiLifecycle') content.data!.data![41] = 1;
        else content.data!.data![46] ^= 1;
      }
      if (post) await expect(submitGovernanceTransaction(f.args)).rejects.toBeInstanceOf(GovernanceReceiptWithheldError);
      else { await expect(submitGovernanceTransaction(f.args)).rejects.toThrow(); expect(f.send).not.toHaveBeenCalled(); }
    }
  });
  it('permits explicitly reviewed empty deleted accounts to be revived', async () => {
    const f = await fixture('createEphemeral', true);
    await expect(submitGovernanceTransaction(f.args)).resolves.toMatchObject({ success: true });
  });
  it.each(['createEphemeral', 'createMetadata', 'createContent'] as const)('refuses a present non-deleted %s creation target', async operation => {
    const f = await fixture(operation), target = operation === 'createEphemeral' ? f.before.address : operation === 'createMetadata' ? f.before.abi!.metadata_address : f.before.abi!.content_address;
    f.prior.set(target, f.next.get(target)!);
    await expect(submitGovernanceTransaction(f.args)).rejects.toThrow('expected absent'); expect(f.send).not.toHaveBeenCalled();
  });
  it('checks creation state around the operation, not the standalone proof refresh', async () => {
    const f = await fixture('createPermanent');
    const receipt = await submitGovernanceTransaction(f.args);
    expect(receipt.success).toBe(true); expect(receipt.proof_refresh_transaction_id).toBeTruthy();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.get).toHaveBeenCalledTimes(6);
  });
  it('does not compare unexecuted after-state when approving a Multisig request', async () => {
    const f = await fixture('pin');
    const plan = await buildCoreOperationPlan({ admin: addr(33), adminKind: 'multisig', multisigRequest: addr(34), executionMode: 'direct',
      operation: { kind: 'setPin', target: addr(44), pin: true }, reviewedStatePlan: f.plan.reviewedStatePlan });
    // Approvals name the request id and sha256 of the approved request data.
    const instruction = concat(integer(2, 4), integer(accountSlot(plan.accounts, addr(33)), 2), integer(accountSlot(plan.accounts, addr(34)), 2), integer(0, 2), integer(0, 8), digestBytes(await sha256(governanceRequestPayload(plan).data)));
    const receipt = await submitGovernanceAction({ ...f.args, plan, calls: [{ program: plan.accounts.transactionProgram, instruction }] }, 'approve');
    expect(receipt.transaction_id).toBeTruthy(); expect(receipt).not.toHaveProperty('success');
    expect(f.get).not.toHaveBeenCalled();
    expect(f.indexed).not.toHaveBeenCalled();
  });
  it.each(['missing', 'nonempty', 'owner'] as const)('rejects a %s reviewed revival corpse', async drift => {
    const f = await fixture('createEphemeral', true);
    if (drift === 'missing') f.prior.delete(f.before.address);
    else f.prior.set(f.before.address, account(f.before.address, drift === 'owner' ? zero : f.before.owner, f.before.flags, new Uint8Array(drift === 'nonempty' ? 1 : 0)));
    await expect(submitGovernanceTransaction(f.args)).rejects.toThrow(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['missing', 'zero-slot'] as const)('waits for indexed visibility after an early execution notification and %s query, without reading stale after-state', async pending => {
    const f = await fixture();
    vi.useFakeTimers();
    try {
      let queried!: () => void;
      const queryStarted = new Promise<void>(resolve => { queried = resolve; });
      f.indexed.mockImplementationOnce(async () => {
        queried();
        if (pending === 'missing') throw Object.assign(new Error('not indexed'), { code: 5 });
        return Object.assign(f.wires[0], { slot: 0n });
      });
      const receipt = submitGovernanceTransaction(f.args);
      await queryStarted;
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.get).toHaveBeenCalledTimes(2); // Only the reviewed before-state has been read.
      await vi.advanceTimersByTimeAsync(500);
      await expect(receipt).resolves.toMatchObject({ success: true });
      expect(f.indexed).toHaveBeenCalledTimes(2);
      expect(f.get).toHaveBeenCalledTimes(4);
      expect(f.send).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('preserves the executed ID and cause when indexed visibility fails', async () => {
    const f = await fixture(), cause = Object.assign(new Error('query unavailable'), { code: 14 });
    f.indexed.mockRejectedValue(cause);
    const failure = await submitGovernanceTransaction(f.args).catch(error => error);
    expect(failure).toBeInstanceOf(GovernanceReceiptWithheldError);
    expect(failure.cause).toBe(cause);
    expect(failure.receipt.transaction_id).toBe(f.wires[0].getSignature()!.toThruFmt());
    expect(failure.receipt).not.toHaveProperty('success');
    expect(f.indexed).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.get).toHaveBeenCalledTimes(2);
  });
  it('bounds NOT_FOUND visibility waiting and retains the executed ID on timeout', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    try {
      let queried!: () => void;
      const queryStarted = new Promise<void>(resolve => { queried = resolve; });
      f.indexed.mockImplementation(async () => { queried(); throw Object.assign(new Error('not indexed'), { code: 5 }); });
      const result = submitGovernanceTransaction(f.args).catch(error => error);
      await queryStarted;
      await vi.advanceTimersByTimeAsync(60000);
      const failure = await result;
      expect(failure).toBeInstanceOf(GovernanceReceiptWithheldError);
      expect(failure.message).toContain('not indexed within timeout');
      expect(failure.receipt.transaction_id).toBe(f.wires[0].getSignature()!.toThruFmt());
      expect(failure.receipt).not.toHaveProperty('success');
      expect(f.send).toHaveBeenCalledTimes(1); expect(f.get).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
