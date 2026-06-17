import type { AddAuthorityInstructionParams } from '../types';
import { INSTRUCTION_ADD_AUTHORITY } from '../constants';
import {
  AddAuthorityArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';
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
 * Encode ADD_AUTHORITY for the currently deployed legacy passkey-manager.
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
