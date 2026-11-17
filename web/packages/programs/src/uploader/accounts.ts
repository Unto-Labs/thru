import type { Account } from '@thru/sdk';
import { UploaderProgramAccount } from './abi/thru/program/uploader/types';
import {
  accountData,
  pubkeyAddress,
} from '../utils/helpers';
import { decodeAccountRoot } from '../utils/account-root';
import {
  UPLOADER_STATE_FINALIZED,
  UPLOADER_STATE_OPEN,
} from './constants';
import type { UploaderProgramMetaInfo } from './types';

/**
 * Decodes Uploader program account data through its account root (byte 0 is
 * the account type). Source buffers are raw bytes and are not decoded here.
 * Returns null for any other type or size.
 */
export function decodeUploaderProgramAccount(data: Uint8Array): UploaderProgramAccount | null {
  return decodeAccountRoot(data, (bytes) => UploaderProgramAccount.from_array(bytes));
}

export function parseUploaderProgramMeta(
  account: Account | Uint8Array
): UploaderProgramMetaInfo {
  const data = accountData(account, 'uploader metadata account');
  const parsed = decodeUploaderProgramAccount(data)?.payload().asMetaV1();
  if (!parsed) throw new Error('account data is not an uploader metadata account');
  const state = parsed.get_state();
  if (state !== UPLOADER_STATE_OPEN && state !== UPLOADER_STATE_FINALIZED) {
    throw new Error(`uploader metadata account has invalid state ${state}`);
  }
  return {
    authorityAddress: pubkeyAddress(
      Uint8Array.from(parsed.get_authority().get_bytes())
    ),
    expectedHash: Uint8Array.from(
      parsed.get_expected_account_hash().get_bytes()
    ),
    state,
  };
}
