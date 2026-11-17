import { Pubkey } from '@thru/sdk';
import { BOOTSTRAP_PROGRAM_ADDRESSES, BOOTSTRAP_STATE_ADDRESSES } from '../bootstrap-addresses';

export interface ReviewedOperationWire {
  program: string;
  instruction: Uint8Array;
  commitments: readonly { address: string; offset: number; length: number; sha256: string }[];
}
type RecordValue = Record<string, unknown>;
function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid reviewed ${label}`);
  return value as RecordValue;
}
function at(value: unknown, path: string): unknown {
  for (const part of path.split('/').filter(Boolean)) value = record(value, path)[part];
  return value;
}
function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (canonicalReviewedJson(actual) !== canonicalReviewedJson(expected)) throw new Error(`Reviewed ${label} differs from approved operation`);
}
export function canonicalReviewedJson(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-JSON reviewed state');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalReviewedJson).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, item]) => `${JSON.stringify(name)}:${canonicalReviewedJson(item)}`).join(',')}}`;
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
function flags(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid reviewed account flags');
  return value;
}
/** Zero denotes absence; permanent revival preserves flags, ephemeral revival resets them. */
function createdFlags(value: unknown, ephemeral: boolean): number {
  const before = flags(value);
  if (before !== 0 && (!(before & 16) || (before & (1 | 64)) || Boolean(before & 8) !== ephemeral || ephemeral && (before & 32))) throw new Error('Invalid reviewed creation before flags');
  return ephemeral ? 8 : before & 16 ? before & ~(16 | 128) : 32;
}
/** Deletion preserves class/capability bits, clears native receipt, and marks only removable classes. */
function deletedFlags(value: unknown, executable = false): number {
  const before = flags(value);
  if (before & (16 | 64) || !executable && (before & 1)) throw new Error('Reviewed deletion requires a live uncompressed account of the correct kind');
  return (before & ~128) | (before & (8 | 32) ? 16 : 0);
}
function nextVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) >= 0xffffffffffffffffn) throw new Error('Invalid reviewed version');
  return (BigInt(value) + 1n).toString();
}
function differences(before: unknown, after: unknown, path = ''): string[] {
  if (before === undefined || after === undefined) return before === after ? [] : [path];
  if (canonicalReviewedJson(before) === canonicalReviewedJson(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const left = record(before, path), right = record(after, path);
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(name => differences(left[name], right[name], `${path}/${name}`));
  }
  return [path];
}
export interface ReviewedMultisigCandidate { address: string; flags: number; members: string[]; threshold: number }
/** The descriptor must already be present in the reviewed roles, including for existing roles. */
/** Expected-state role key of the Core instance an operation executes on:
    `core` (Core A) or `core_peer` (Core B, UNTO-3561); undefined otherwise. */
export function coreRoleKey(program: string): 'core' | 'core_peer' | undefined {
  if (Pubkey.from(program).equals(BOOTSTRAP_PROGRAM_ADDRESSES.core_manager)) return 'core';
  if (Pubkey.from(program).equals(BOOTSTRAP_PROGRAM_ADDRESSES.core_peer_manager)) return 'core_peer';
  return undefined;
}
export function reviewedMultisigCandidate(reviewed: unknown, operation: ReviewedOperationWire): ReviewedMultisigCandidate | undefined {
  // Admin rotation runs on Core A and moves both configs (`core` and `core_peer`) together.
  if (coreRoleKey(operation.program) !== 'core') return;
  const bytes = operation.instruction, tag = bytes[0];
  if (tag !== 8 && tag !== 9) return;
  const after = record(at(reviewed, '/roles/after'), 'roles after'), core = record(after.core, 'Core roles');
  if (tag === 8 ? bytes[103] !== 2 : core.kind !== 'multisig') return;
  const candidate = hex(bytes.subarray(tag === 8 ? 71 : 37, tag === 8 ? 103 : 69));
  const descriptors = record(after.multisigs, 'candidate Multisig descriptors');
  const value = Object.values(descriptors).find(value => record(value, 'Multisig descriptor').address === candidate);
  const descriptor = record(value, 'candidate Multisig descriptor'), members = descriptor.members;
  if (Object.keys(descriptor).sort().join(',') !== 'address,flags,members,threshold'
    || !Array.isArray(members) || members.length < 2 || members.length > 32
    || members.some((member, i) => typeof member !== 'string' || !/^[0-9a-f]{64}$/.test(member) || member === '0'.repeat(64) || i > 0 && member <= members[i - 1])
    || typeof descriptor.threshold !== 'number' || !Number.isInteger(descriptor.threshold)
    || descriptor.threshold < 1 || descriptor.threshold > members.length || (flags(descriptor.flags) !== 0 && descriptor.flags !== 4)) throw new Error('Invalid reviewed candidate Multisig state');
  return descriptor as unknown as ReviewedMultisigCandidate;
}
/** Shared SDK/bootstrap boundary: derive permitted state effects from actual approved wire bytes. */
export function validateReviewedStateOperation(reviewed: unknown, operation: ReviewedOperationWire): void {
  const review = record(reviewed, 'plan');
  if (typeof review.genesis_inventory_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(review.genesis_inventory_sha256) || !Array.isArray(review.changes)) throw new Error('Invalid reviewed genesis provenance or changes');
  if (Object.keys(review).some(k => !['genesis_inventory_sha256', 'changes', 'roles'].includes(k))) throw new Error('Unknown reviewed state field');
  const bytes = operation.instruction, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const roleKey = coreRoleKey(operation.program), core = roleKey !== undefined, coreB = roleKey === 'core_peer';
  const abi = Pubkey.from(operation.program).equals(BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager);
  if (!core && !abi) throw new Error('Expected-state receipts require a Core or governed ABI operation');
  const tag = bytes[0];
  // A top-level Core B operation is only UpgradePeer (on Core A): Core B's
  // rotation runs inside Core A's paired rotation. Core A has no UpgradePeer
  // and upgrades Core B with the ordinary Upgrade.
  if (coreB && tag !== 11) throw new Error('Core B performs only UpgradePeer; admin rotation runs on Core A for both configs');
  if (core && !coreB && tag === 11) throw new Error('Core A has no UpgradePeer; it upgrades Core B with Upgrade');
  const boundAddress = (offset: number): string => {
    if (offset + 34 > bytes.length) throw new Error('Truncated approved account binding');
    return hex(bytes.subarray(offset + 2, offset + 34));
  };
  const literal = (offset: number): string => {
    if (offset + 32 > bytes.length) throw new Error('Truncated approved address');
    return hex(bytes.subarray(offset, offset + 32));
  };
  const zero = '0'.repeat(64);
  if (core && (tag === 8 || tag === 9)) {
    requireEqual(review.changes, [], 'rotation program changes');
    const roles = record(review.roles, 'roles'), before = record(roles.before, 'roles before'), after = record(roles.after, 'roles after');
    const oldCore = record(before.core, 'Core roles'), expected = structuredClone(before), newCore = record(expected.core, 'Core roles');
    // Both configs rotate in one instruction, so they are reviewed in lockstep.
    requireEqual(before.core_peer, before.core, 'Core B roles equal Core A roles');
    const peerOffset = tag === 8 ? 104 : 69;
    requireEqual(boundAddress(peerOffset), hex(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.core_peer_manager).toBytes()), 'paired Core B');
    requireEqual(boundAddress(peerOffset + 34), hex(Pubkey.from(BOOTSTRAP_STATE_ADDRESSES.core_peer_config).toBytes()), 'paired Core B config');
    if (tag === 8) {
      if (bytes.length !== 172 || ![1, 2].includes(bytes[103])) throw new Error('Invalid approved admin proposal');
      requireEqual(oldCore.admin, boundAddress(35), 'current admin');
      newCore.pending_admin = boundAddress(69); newCore.pending_kind = bytes[103] === 1 ? 'eoa' : 'multisig';
    } else {
      if (bytes.length !== 137) throw new Error('Invalid approved admin acceptance');
      requireEqual(oldCore.pending_admin, boundAddress(35), 'pending admin');
      if (!['eoa', 'multisig'].includes(String(oldCore.pending_kind))) throw new Error('Invalid reviewed pending admin kind');
      newCore.admin = oldCore.pending_admin; newCore.kind = oldCore.pending_kind; newCore.pending_admin = zero; newCore.pending_kind = 'none';
    }
    const candidateKind = tag === 8 ? newCore.pending_kind : newCore.kind;
    const candidateAddress = tag === 8 ? newCore.pending_admin : newCore.admin;
    if (after.multisigs !== undefined) {
      const previous = record(before.multisigs ?? {}, 'prior Multisig roles'), next = record(after.multisigs, 'Multisig roles');
      for (const [name, descriptor] of Object.entries(previous)) requireEqual(next[name], descriptor, 'existing Multisig role');
      const additions = Object.entries(next).filter(([name]) => !(name in previous));
      if (additions.length > 1) throw new Error('Rotation cannot add unrelated Multisig roles');
      if (additions.length) {
        const [name, value] = additions[0], descriptor = record(value, 'candidate Multisig descriptor');
        if (!name || candidateKind !== 'multisig' || descriptor.address !== candidateAddress || Object.keys(descriptor).sort().join(',') !== 'address,flags,members,threshold') throw new Error('Reviewed Multisig descriptor is not the approved candidate');
        expected.multisigs = { ...previous, [name]: structuredClone(descriptor) };
      }
    }
    expected.core_peer = structuredClone(newCore);
    requireEqual(after, expected, 'rotation roles');
    reviewedMultisigCandidate(reviewed, operation);
    return;
  }
  if (review.roles !== undefined || review.changes.length !== 1) throw new Error('Operation must review exactly its one affected program and no role changes');
  const change = record(review.changes[0], 'change'), before = record(change.before, 'before state'), after = record(change.after, 'after state');
  for (const field of ['identity', 'address', 'owner']) requireEqual(after[field], before[field], field);
  requireEqual(change.identity, after.identity, 'record identity');
  const metadata = (): RecordValue => record(after.metadata, 'metadata');
  const abiState = (): RecordValue => record(after.abi, 'ABI state');
  let allowed: string[] = [];
  let imageOffset: number | undefined;
  let artifact: RecordValue | undefined;
  if (core) {
    if (tag === 11) {
      // Core B replaces Core A's executable (A <-> B loop): only the bytes change.
      if (bytes.length !== 177) throw new Error('Invalid approved UpgradePeer');
      const coreA = hex(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.core_manager).toBytes());
      requireEqual(after.address, boundAddress(69), 'peer subject'); requireEqual(after.address, coreA, 'Core A subject');
      requireEqual(after.owner, hex(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.core_peer_manager).toBytes()), 'Core A owner');
      imageOffset = 103; artifact = record(after.executable, 'executable artifact');
      allowed = ['/executable/path', '/executable/size', '/executable/sha256'];
    }
    if (tag <= 6) {
      requireEqual(after.address, boundAddress(103), 'program subject');
      requireEqual(metadata().address, boundAddress(69), 'managed metadata');
      requireEqual(after.owner, hex(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.core_manager).toBytes()), 'Core owner');
    }
    if (tag === 11) { /* bound above */ } else if (tag === 0 || tag === 1) {
      if (bytes.length !== (tag === 0 ? 342 : 276)) throw new Error('Invalid approved Core create');
      imageOffset = 169; artifact = record(after.executable, 'executable artifact');
      requireEqual(metadata().version, '0', 'created version'); requireEqual(metadata().state, 'open', 'created state');
      requireEqual(metadata().candidate, zero, 'created authority candidate'); requireEqual(metadata().authority, literal(243), 'created authority');
      if (bytes[275] > 1) throw new Error('Invalid approved create pin policy');
      const pin = bytes[275] ? 4 : 0;
      requireEqual(after.flags, createdFlags(before.flags, tag === 1) | pin | 1, 'created program flags');
      requireEqual(metadata().flags, createdFlags(at(before, '/metadata/flags'), tag === 1) | pin, 'created metadata flags');
      allowed = ['/executable/path', '/executable/size', '/executable/sha256', '/metadata/version', '/metadata/state', '/metadata/authority', '/metadata/candidate', '/metadata/flags', '/flags'];
    } else if (tag === 2) {
      if (bytes.length !== 211) throw new Error('Invalid approved Core upgrade');
      imageOffset = 137; artifact = record(after.executable, 'executable artifact');
      requireEqual(metadata().version, nextVersion(at(before, '/metadata/version')), 'upgrade version');
      allowed = ['/executable/path', '/executable/size', '/executable/sha256', '/metadata/version'];
    } else if (tag === 3) {
      if (bytes.length !== 138 || bytes[137] > 1) throw new Error('Invalid approved pause');
      requireEqual(metadata().state, bytes[137] ? 'paused' : 'open', 'pause state');
      requireEqual(after.flags, bytes[137] ? flags(before.flags) & ~1 : flags(before.flags) | 1, 'pause flags');
      allowed = ['/metadata/state', '/flags'];
    } else if (tag === 4 || tag === 5) {
      if (bytes.length !== 137) throw new Error('Invalid approved lifecycle instruction');
      requireEqual(metadata().state, tag === 4 ? 'destroyed' : 'finalized', 'lifecycle state');
      if (tag === 4) {
        requireEqual(after.flags, deletedFlags(before.flags, true) & ~1, 'destroy flags');
        requireEqual(metadata().flags, deletedFlags(at(before, '/metadata/flags')), 'destroy metadata flags');
        requireEqual(at(after, '/executable/size'), 0, 'destroyed executable length');
        requireEqual(at(after, '/executable/sha256'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'destroyed executable digest');
      }
      allowed = tag === 4 ? ['/metadata/state', '/metadata/flags', '/flags', '/executable/size', '/executable/sha256'] : ['/metadata/state'];
    } else if (tag === 6) {
      if (bytes.length !== 169) throw new Error('Invalid approved authority instruction');
      requireEqual(metadata().authority, literal(137), 'application authority'); allowed = ['/metadata/authority'];
    } else if (tag === 7) {
      if (bytes.length !== 104 || bytes[103] > 1) throw new Error('Invalid approved pin instruction');
      const target = boundAddress(69), path = after.address === target ? '/flags' : metadata().address === target ? '/metadata/flags' : undefined;
      if (!path) throw new Error('Reviewed pin target differs');
      const oldFlags = flags(at(before, path));
      requireEqual(at(after, path), bytes[103] ? oldFlags | 4 : oldFlags & ~4, 'pin flags'); allowed = [path];
    } else throw new Error('No reviewed state receipt for permissionless proof writes');
  } else {
    if (tag < 0x0e || tag > 0x15 || bytes.length < 279) throw new Error('Expected governed ABI instruction');
    requireEqual(after.address, boundAddress(69), 'ABI subject');
    const state = abiState();
    requireEqual(state.metadata_address, boundAddress(137), 'ABI metadata');
    if (![0x0f, 0x10].includes(tag)) requireEqual(state.content_address, boundAddress(171), 'ABI content');
    requireEqual(state.owner, hex(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager).toBytes()), 'ABI owner');
    if ([0x0e, 0x11, 0x12, 0x13].includes(tag)) {
      imageOffset = 205; artifact = record(state.artifact, 'ABI artifact');
      requireEqual(state.revision, tag === 0x11 || tag === 0x12 ? '0' : nextVersion(at(before, '/abi/revision')), 'ABI revision');
      requireEqual(state.state, 'open', 'ABI open state');
      allowed = ['/abi/artifact/path', '/abi/artifact/size', '/abi/artifact/sha256', '/abi/revision'];
      if (tag === 0x11 || tag === 0x12) {
        requireEqual(state.content_flags, createdFlags(at(before, '/abi/content_flags'), tag === 0x12), 'created ABI content flags');
        allowed.push('/abi/state', '/abi/content_flags');
      }
    } else if (tag === 0x14 || tag === 0x15) {
      requireEqual(state.state, tag === 0x14 ? 'closed' : 'finalized', 'ABI lifecycle'); allowed = ['/abi/state'];
      if (tag === 0x14) {
        requireEqual(state.content_flags, deletedFlags(at(before, '/abi/content_flags')), 'closed ABI content flags');
        allowed.push('/abi/content_flags');
      }
    } else {
      requireEqual(state.metadata_flags, createdFlags(at(before, '/abi/metadata_flags'), tag === 0x10), 'created ABI metadata flags');
      allowed = ['/abi/metadata_flags'];
    }
    if (tag === 0x0e) requireEqual(after.address, hex(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.core_manager).toBytes()), 'fixed root subject');
    else if (after.address === hex(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.core_manager).toBytes())) throw new Error('Fixed-root ABI supports only its dedicated correction instruction');
  }
  if (imageOffset !== undefined && artifact) {
    const source = boundAddress(imageOffset), offset = view.getUint32(imageOffset + 34, true), length = view.getUint32(imageOffset + 38, true), digest = literal(imageOffset + 42);
    requireEqual(artifact.sha256, digest, 'exact artifact digest'); requireEqual(artifact.size, length, 'exact artifact length');
    if (operation.commitments.length !== 1) throw new Error('Missing approved source commitment');
    const commitment = operation.commitments[0];
    requireEqual(hex(Pubkey.from(commitment.address).toBytes()), source, 'source account'); requireEqual(commitment.offset, offset, 'source offset'); requireEqual(commitment.length, length, 'source length'); requireEqual(commitment.sha256, digest, 'source digest');
  } else if (operation.commitments.length) throw new Error('Unexpected artifact commitment');
  if (differences(before, after).some(path => !allowed.some(prefix => path === prefix || path.startsWith(`${prefix}/`)))) throw new Error('Reviewed state changes exceed approved operation');
}
