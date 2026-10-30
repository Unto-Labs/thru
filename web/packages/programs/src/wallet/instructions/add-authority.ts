import type { AddAuthorityInstructionParams, Authority as AuthorityInput } from '../types';
import {
  AUTHORITY_BYTES,
  AUTHORITY_TAG_PASSKEY,
  AUTHORITY_TAG_PUBKEY,
  INSTRUCTION_ADD_AUTHORITY,
} from '../constants';
import {
  AddAuthorityArgs,
  AddAuthorityArgsBuilder,
  Authority,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/wallet/types';
import { buildAuthority, buildAuthorityRecord } from './create';

export function encodeAddAuthorityInstruction(params: AddAuthorityInstructionParams): Uint8Array {
  const { walletAccountIdx } = params;
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }

  const authorityRecordBytes = buildAuthorityRecord(params.authorityRecord);

  const argsPayload = new AddAuthorityArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_authority_record(authorityRecordBytes)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('add_authority')
    .writePayload(argsPayload)
    .finish()
    .build();
}

function writeU16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

/**
 * Encode ADD_AUTHORITY for the currently deployed legacy wallet.
 *
 * Legacy ADD_AUTHORITY appends a bare 65-byte Authority. Expiry remains a
 * local wallet/session policy until the AuthorityRecord program is deployed.
 */
export function encodeLegacyAddAuthorityInstruction(
  params: AddAuthorityInstructionParams
): Uint8Array {
  const { walletAccountIdx } = params;
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }

  const authorityBytes = buildAuthority(params.authorityRecord.authority);
  const output = new Uint8Array(1 + 2 + authorityBytes.length);
  output[0] = INSTRUCTION_ADD_AUTHORITY;
  writeU16LE(output, 1, walletAccountIdx);
  output.set(authorityBytes, 3);
  return output;
}

export interface DecodedAddAuthorityInstruction {
  walletAccountIdx: number;
  authority: AuthorityInput;
  /** null for the legacy layout, which carries no expiry on chain. */
  expiresAtBlockTimeSeconds: bigint | null;
}

function readAuthority(view: Authority): AuthorityInput | null {
  const tag = view.get_tag();
  const data = Uint8Array.from(view.get_data());
  if (tag === AUTHORITY_TAG_PASSKEY) {
    return { tag, pubkeyX: data.slice(0, 32), pubkeyY: data.slice(32, 64) };
  }
  if (tag === AUTHORITY_TAG_PUBKEY) {
    return { tag, pubkey: data.slice(0, 32) };
  }
  return null;
}

/**
 * Decode ADD_AUTHORITY instruction data in either layout produced above.
 * Returns null for anything else (other instructions, truncated data or an
 * unknown authority tag), so a caller can tell "not an ADD_AUTHORITY" apart
 * from a decoded one without a second parser.
 */
export function decodeAddAuthorityInstruction(
  data: Uint8Array
): DecodedAddAuthorityInstruction | null {
  if (data.length === 0 || data[0] !== INSTRUCTION_ADD_AUTHORITY) return null;

  if (data.length === 1 + AddAuthorityArgs.footprint()) {
    const args = AddAuthorityArgs.from_array(data.subarray(1));
    if (!args) return null;
    const record = args.get_authority_record();
    const authority = readAuthority(record.get_authority());
    if (!authority) return null;
    return {
      walletAccountIdx: args.get_wallet_account_idx(),
      authority,
      expiresAtBlockTimeSeconds: record.get_expires_at_block_time_seconds(),
    };
  }

  if (data.length === 3 + AUTHORITY_BYTES) {
    const view = Authority.from_array(data.subarray(3));
    if (!view) return null;
    const authority = readAuthority(view);
    if (!authority) return null;
    return {
      walletAccountIdx: data[1] | (data[2] << 8),
      authority,
      expiresAtBlockTimeSeconds: null,
    };
  }

  return null;
}
