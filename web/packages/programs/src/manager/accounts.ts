import type { Account } from '@thru/sdk';
import { ManagerProgramAccount } from './abi/thru/program/manager/types';
import {
  MANAGER_STATE_FINALIZED,
  MANAGER_STATE_OPEN,
  MANAGER_STATE_PAUSED,
} from './constants';
import {
  accountData,
  pubkeyAddress,
} from '../utils/helpers';
import { decodeAccountRoot } from '../utils/account-root';
import type { ManagerProgramMetaInfo } from './types';

/**
 * Decodes Manager program account data through its account root (byte 0 is
 * the account type). Core Manager writes program metadata with the same
 * layout and value. Returns null for any other type or size.
 */
export function decodeManagerProgramAccount(data: Uint8Array): ManagerProgramAccount | null {
  return decodeAccountRoot(data, (bytes) => ManagerProgramAccount.from_array(bytes));
}

export function parseManagerProgramMeta(
  account: Account | Uint8Array
): ManagerProgramMetaInfo {
  const data = accountData(account, 'manager metadata account');
  const parsed = decodeManagerProgramAccount(data)?.payload().asProgramMetaV1();
  if (!parsed) throw new Error('account data is not a manager program metadata account');
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
