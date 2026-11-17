import { Pubkey, type Account } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { getWebCrypto } from '@thru/sdk/helpers';
import { parseManagerProgramMeta } from '../manager/accounts';
import { parseABIAccount, parseABIMetaAccount } from '../abi-manager/accounts';
import { isAccountNotFoundError } from '../token/accounts';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
import type { ReviewedOperationWire } from './reviewed-state';

export interface ProgramStateClient { accounts: Pick<Thru['accounts'], 'get'> }
type Snapshot = Record<string, unknown>;
function object(value: unknown, label: string): Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid reviewed ${label}`);
  return value as Snapshot;
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function address(value: unknown): string {
  check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Invalid reviewed account address');
  return Pubkey.from(Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16))).toThruFmt();
}
function compare(actual: unknown, expected: unknown, label: string): void {
  if (expected !== undefined) check(actual === expected, `${label} differs from selected expected state`);
}
function accountFlags(account: Account): number {
  check(account.meta, 'account metadata missing');
  const flags = account.meta.flags;
  return [flags.isProgram, flags.isPrivileged, flags.isUncompressable, flags.isEphemeral, flags.isDeleted,
    flags.isNew, flags.isCompressed, flags.isNativeReceiver].reduce((mask, bit, i) => mask | (bit ? 1 << i : 0), 0);
}
function removableCorpse(flags: unknown): boolean {
  return typeof flags === 'number' && Number.isInteger(flags) && flags >= 0 && flags <= 255
    && (flags & 16) !== 0 && (flags & (8 | 32)) !== 0 && (flags & (1 | 64 | 128)) === 0;
}
async function readAccount(client: ProgramStateClient, expected: Snapshot, label: string, creating = false, terminal = false): Promise<Uint8Array> {
  let account: Account;
  try { account = await client.accounts.get(address(expected.address)); }
  catch (cause) {
    if (!isAccountNotFoundError(cause)) throw cause;
    if (creating && !(Number(expected.flags) & 16)) return new Uint8Array();
    if (!creating && terminal && typeof expected.owner === 'string' && removableCorpse(expected.flags)) return new Uint8Array();
    throw new Error(`${label} required account is missing`);
  }
  // A reviewed deleted, empty account may be revived; an active account is never absence.
  if (creating) check(typeof expected.owner === 'string' && typeof expected.flags === 'number' && (expected.flags & 16) !== 0, `${label} expected absent account already exists`);
  check(account.meta?.owner, `${label} account metadata missing`);
  compare(hex(account.meta.owner.toBytes()), expected.owner, `${label} owner`);
  compare(accountFlags(account), expected.flags, `${label} flags/lifecycle`);
  check(!account.data?.compressed, `${label} account data is compressed`);
  const bytes = account.data?.data ?? new Uint8Array();
  check(bytes.length === Number(account.meta.dataSize), `${label} account data truncated`);
  if (creating) check(bytes.length === 0, `${label} revived account is not empty`);
  return bytes;
}
async function digest(bytes: Uint8Array, value: unknown, label: string): Promise<void> {
  if (value === undefined) return;
  const expected = object(value, 'artifact');
  compare(bytes.length, expected.size, `${label} content hash/length`);
  if (expected.sha256 !== undefined) compare(hex(new Uint8Array(await getWebCrypto().subtle.digest('SHA-256', new Uint8Array(bytes)))), expected.sha256, `${label} content hash/length`);
}
export interface ProgramStateVerificationOptions {
  /** Only wire-created accounts can be absent in the reviewed before-state. */
  createProgram?: boolean;
  createABIMetadata?: boolean;
  createABIContent?: boolean;
  /** Metadata creation precedes content creation; that operation does not touch content. */
  skipABIContent?: boolean;
}
/** Compare only reviewed fields, without registry policy or adopting any observed state. */
export async function verifyProgramState(client: ProgramStateClient, value: unknown, options: ProgramStateVerificationOptions = {}): Promise<{ abiContent?: Uint8Array }> {
  const entry = object(value, 'program state'), label = String(entry.identity ?? 'program');
  const destroyed = entry.metadata !== undefined && object(entry.metadata, 'metadata').state === 'destroyed';
  const image = await readAccount(client, entry, label, options.createProgram, destroyed);
  if (!options.createProgram) await digest(image, entry.executable, label);
  if (entry.metadata !== undefined) {
    const meta = object(entry.metadata, 'metadata');
    const data = await readAccount(client, meta, `${label}:metadata`, options.createProgram, destroyed);
    if (!options.createProgram) {
      if (meta.state === 'destroyed') check(data.length === 0 && image.length === 0, `${label} expected destroyed pair is not truncated`);
      else if (['version', 'state', 'authority', 'candidate'].some(field => meta[field] !== undefined)) {
        const parsed = parseManagerProgramMeta(data);
        compare(parsed.version.toString(), meta.version, `${label} version`);
        compare(['open', 'paused', 'finalized'][parsed.state], meta.state, `${label} lifecycle`);
        compare(hex(Pubkey.from(parsed.authorityAddress).toBytes()), meta.authority, `${label} subordinate authority`);
        compare(hex(Pubkey.from(parsed.authorityCandidateAddress).toBytes()), meta.candidate, `${label} subordinate candidate`);
      }
    }
  }
  if (entry.abi === undefined) return {};
  const abi = object(entry.abi, 'ABI state');
  if (abi.metadata_address !== undefined) {
    const data = await readAccount(client, { address: abi.metadata_address, owner: abi.owner, flags: abi.metadata_flags }, `${label}:abi_metadata`, options.createABIMetadata);
    if (!options.createABIMetadata) {
      const parsed = parseABIMetaAccount(data);
      check(parsed.kind === 'official' && hex(Pubkey.from(parsed.programAddress).toBytes()) === entry.address && parsed.flags === 0, `${label} official ABI metadata link differs`);
    }
  }
  if (options.skipABIContent || abi.content_address === undefined) return {};
  const data = await readAccount(client, { address: abi.content_address, owner: abi.owner, flags: abi.content_flags }, `${label}:abi_content`, options.createABIContent, abi.state === 'closed');
  if (options.createABIContent) return {};
  if (abi.state === 'closed') { check(data.length === 0, `${label} ABI is not closed`); return {}; }
  const parsed = parseABIAccount(data);
  compare(hex(Pubkey.from(parsed.abiMetaAccountAddress).toBytes()), abi.metadata_address, `${label} ABI content link`);
  compare(parsed.revision.toString(), abi.revision, `${label} ABI revision`);
  compare(parsed.state === 0 ? 'open' : 'finalized', abi.state, `${label} ABI lifecycle`);
  const abiContent = parsed.contents;
  await digest(abiContent, abi.artifact, `${label} ABI`);
  return { abiContent };
}
/** Creation absence is derived from validated wire bytes, never from a missing RPC field. */
export async function verifyReviewedProgramStates(client: ProgramStateClient, reviewed: unknown, operation: ReviewedOperationWire, phase: 'before' | 'after'): Promise<void> {
  const review = object(reviewed, 'state plan');
  check(Array.isArray(review.changes), 'Invalid reviewed changes');
  const core = Pubkey.from(operation.program).equals(BOOTSTRAP_PROGRAM_ADDRESSES.core_manager), tag = operation.instruction[0];
  const metadataCreation = !core && (tag === 0x0f || tag === 0x10);
  for (const value of review.changes) {
    const change = object(value, 'change');
    await verifyProgramState(client, change[phase], {
      createProgram: phase === 'before' && core && (tag === 0 || tag === 1),
      createABIMetadata: phase === 'before' && metadataCreation,
      createABIContent: phase === 'before' && !core && (tag === 0x11 || tag === 0x12),
      skipABIContent: metadataCreation,
    });
  }
}
