import type { Account } from '@thru/sdk';
import { AbiManagerProgramAccount } from './abi/thru/program/abi_manager/types';
import {
  accountData,
  pubkeyAddress,
} from '../utils/helpers';
import { decodeAccountRoot } from '../utils/account-root';
import {
  ABI_ACCOUNT_HEADER_SIZE,
  ABI_META_KIND_EXTERNAL,
  ABI_META_KIND_OFFICIAL,
  ABI_STATE_FINALIZED,
  ABI_STATE_OPEN,
} from './constants';
import type { ABIAccountInfo, ABIMetaAccountInfo } from './types';

/**
 * Decodes ABI Manager account data through its account root (byte 0 is the
 * account type: ABI metadata or ABI content). Returns null for any other type,
 * a metadata account of the wrong size, or a content account shorter than
 * its header.
 */
export function decodeAbiManagerProgramAccount(
  data: Uint8Array
): AbiManagerProgramAccount | null {
  return decodeAccountRoot(data, (bytes) => AbiManagerProgramAccount.from_array(bytes));
}

export function parseABIMetaAccount(
  account: Account | Uint8Array
): ABIMetaAccountInfo {
  const data = accountData(account, 'ABI metadata account');
  const parsed = decodeAbiManagerProgramAccount(data)?.payload().asMetaV1();
  if (!parsed) throw new Error('account data is not an ABI metadata account');
  const flags = parsed.get_flags();
  const kind = parsed.get_kind();
  /* The body starts at byte 4, after account_type, kind and flags. */
  if (kind === ABI_META_KIND_OFFICIAL) {
    return {
      kind: 'official',
      flags,
      programAddress: pubkeyAddress(data.slice(4, 36)),
    };
  }
  if (kind === ABI_META_KIND_EXTERNAL) {
    return {
      kind: 'external',
      flags,
      publisherAddress: pubkeyAddress(data.slice(4, 36)),
      targetProgramAddress: pubkeyAddress(data.slice(36, 68)),
      seed: data.slice(68, 100),
    };
  }
  throw new Error(`ABI metadata account has invalid kind ${kind}`);
}

export function parseABIAccount(account: Account | Uint8Array): ABIAccountInfo {
  const data = accountData(account, 'ABI account');
  const parsed =
    data.length >= ABI_ACCOUNT_HEADER_SIZE
      ? decodeAbiManagerProgramAccount(data)?.payload().asContentV1()
      : null;
  if (!parsed) throw new Error('account data is not an ABI content account');
  const expectedLength = ABI_ACCOUNT_HEADER_SIZE + parsed.get_content_sz();
  if (data.length !== expectedLength) {
    throw new Error(
      `ABI account content length expects ${expectedLength} bytes, got ${data.length}`
    );
  }
  const state = parsed.get_state();
  if (state !== ABI_STATE_OPEN && state !== ABI_STATE_FINALIZED) {
    throw new Error(`ABI account has invalid state ${state}`);
  }
  return {
    abiMetaAccountAddress: pubkeyAddress(
      Uint8Array.from(parsed.get_abi_meta_acc().get_bytes())
    ),
    revision: parsed.get_revision(),
    state,
    contents: Uint8Array.from(parsed.get_contents()),
  };
}
