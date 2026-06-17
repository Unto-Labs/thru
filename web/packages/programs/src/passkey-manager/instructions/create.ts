import {
  AUTHORITY_BYTES,
  AUTHORITY_RECORD_BYTES,
  LONG_LIVED_AUTHORITY_EXPIRY_SECONDS,
  INSTRUCTION_CREATE,
} from '../constants';
import type { Authority, AuthorityRecord, CreateInstructionParams } from '../types';
import {
  Authority as AuthorityView,
  AuthorityBuilder,
  AuthorityRecord as AuthorityRecordView,
  CreateArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';

const AUTHORITY_DATA_BYTES = AUTHORITY_BYTES - 1;
const PUBKEY_BYTES = AUTHORITY_DATA_BYTES / 2;
const U64_MAX = 0xffffffffffffffffn;

function buildAuthority(authority: Authority): Uint8Array {
  const data = new Array<number>(AUTHORITY_DATA_BYTES).fill(0);

  if (authority.tag === 1) {
    if (authority.pubkeyX.length !== PUBKEY_BYTES) throw new Error('pubkeyX must be 32 bytes');
    if (authority.pubkeyY.length !== PUBKEY_BYTES) throw new Error('pubkeyY must be 32 bytes');
    for (let i = 0; i < PUBKEY_BYTES; i++) data[i] = authority.pubkeyX[i];
    for (let i = 0; i < PUBKEY_BYTES; i++) data[PUBKEY_BYTES + i] = authority.pubkeyY[i];
  } else if (authority.tag === 2) {
    if (authority.pubkey.length !== PUBKEY_BYTES) throw new Error('pubkey must be 32 bytes');
    for (let i = 0; i < PUBKEY_BYTES; i++) data[i] = authority.pubkey[i];
  } else {
    throw new Error('Invalid authority tag');
  }

  return new AuthorityBuilder()
    .set_tag(authority.tag)
    .set_data(data)
    .build();
}

export { buildAuthority };

function copyGeneratedBuffer(view: unknown, label: string): Uint8Array {
  const buffer = (view as { buffer?: Uint8Array }).buffer;
  if (!buffer) {
    throw new Error(`${label} did not expose a generated buffer`);
  }
  return buffer.slice();
}

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > U64_MAX) {
    throw new Error(`${label} must fit in u64`);
  }
}

export function createAuthorityRecord(
  authority: Authority,
  expiresAtBlockTimeSeconds = LONG_LIVED_AUTHORITY_EXPIRY_SECONDS
): AuthorityRecord {
  return { authority, expiresAtBlockTimeSeconds };
}

export function createSessionAuthorityRecord(
  params: {
    pubkey: Uint8Array;
    expiresAtBlockTimeSeconds: bigint;
  }
): AuthorityRecord {
  return createAuthorityRecord(
    { tag: 2, pubkey: params.pubkey },
    params.expiresAtBlockTimeSeconds
  );
}

export function buildAuthorityRecord(record: AuthorityRecord): Uint8Array {
  assertU64(record.expiresAtBlockTimeSeconds, 'expiresAtBlockTimeSeconds');

  const authority = AuthorityView.from_array(buildAuthority(record.authority));
  if (!authority) {
    throw new Error('Failed to build authority');
  }

  const authorityRecord = AuthorityRecordView.__tnCreateView(
    new Uint8Array(AUTHORITY_RECORD_BYTES)
  );
  authorityRecord.set_authority(authority);
  authorityRecord.set_expires_at_block_time_seconds(
    record.expiresAtBlockTimeSeconds
  );
  return copyGeneratedBuffer(authorityRecord, 'AuthorityRecord');
}

export function encodeCreateInstruction(params: CreateInstructionParams): Uint8Array {
  const { walletAccountIdx, authorityRecord, seed, stateProof } = params;

  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }

  const authorityRecordBytes = buildAuthorityRecord(authorityRecord);

  const argsPayload = new CreateArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_authority_record(authorityRecordBytes)
    .set_seed(seed)
    .set_state_proof(stateProof)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('create')
    .writePayload(argsPayload)
    .finish()
    .build();
}

function writeU16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

/**
 * Encode CREATE for the currently deployed legacy passkey-manager program.
 *
 * Legacy CREATE stores the initial bare Authority directly:
 *   tag || wallet_account_idx || Authority || seed || StateProof
 *
 * Newer program builds should use encodeCreateInstruction, which carries a
 * full AuthorityRecord with an expiry timestamp.
 */
export function encodeLegacyCreateInstruction(params: CreateInstructionParams): Uint8Array {
  const { walletAccountIdx, authorityRecord, seed, stateProof } = params;

  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }

  const authorityBytes = buildAuthority(authorityRecord.authority);
  const output = new Uint8Array(1 + 2 + authorityBytes.length + seed.length + stateProof.length);
  output[0] = INSTRUCTION_CREATE;
  writeU16LE(output, 1, walletAccountIdx);
  output.set(authorityBytes, 3);
  output.set(seed, 3 + authorityBytes.length);
  output.set(stateProof, 3 + authorityBytes.length + seed.length);
  return output;
}
