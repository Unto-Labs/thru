import type { Account } from '@thru/sdk';
import { ManagerProgramMeta } from './abi/thru/program/manager/types';
import {
  MANAGER_META_SIZE,
  MANAGER_STATE_FINALIZED,
  MANAGER_STATE_OPEN,
  MANAGER_STATE_PAUSED,
} from './constants';
import {
  accountData,
  pubkeyAddress,
} from '../utils/helpers';
import type { ManagerProgramMetaInfo } from './types';

export function parseManagerProgramMeta(
  account: Account | Uint8Array
): ManagerProgramMetaInfo {
  const data = accountData(account, 'manager metadata account');
  if (data.length !== MANAGER_META_SIZE) {
    throw new Error(
      `manager metadata account must be ${MANAGER_META_SIZE} bytes, got ${data.length}`
    );
  }
  const parsed = ManagerProgramMeta.from_array(data);
  if (!parsed) throw new Error('manager metadata account is malformed');
  const state = parsed.get_state();
  if (
    state !== MANAGER_STATE_OPEN &&
    state !== MANAGER_STATE_PAUSED &&
    state !== MANAGER_STATE_FINALIZED
  ) {
    throw new Error(`manager metadata account has invalid state ${state}`);
  }
  return {
    authorityAddress: pubkeyAddress(
      Uint8Array.from(parsed.get_authority().get_bytes())
    ),
    authorityCandidateAddress: pubkeyAddress(
      Uint8Array.from(parsed.get_authority_candidate().get_bytes())
    ),
    version: parsed.get_version(),
    state,
  };
}
