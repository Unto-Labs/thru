import type { Account } from '@thru/sdk';
import { UploaderProgramMeta } from './abi/thru/program/uploader/types';
import {
  accountData,
  pubkeyAddress,
} from '../utils/helpers';
import {
  UPLOADER_META_SIZE,
  UPLOADER_STATE_FINALIZED,
  UPLOADER_STATE_OPEN,
} from './constants';
import type { UploaderProgramMetaInfo } from './types';

export function parseUploaderProgramMeta(
  account: Account | Uint8Array
): UploaderProgramMetaInfo {
  const data = accountData(account, 'uploader metadata account');
  if (data.length !== UPLOADER_META_SIZE) {
    throw new Error(
      `uploader metadata account must be ${UPLOADER_META_SIZE} bytes, got ${data.length}`
    );
  }
  const parsed = UploaderProgramMeta.from_array(data);
  if (!parsed) throw new Error('uploader metadata account is malformed');
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
