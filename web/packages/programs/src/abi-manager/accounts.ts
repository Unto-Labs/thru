import type { Account } from '@thru/sdk';
import {
  AbiAccount,
  AbiMetaAccount,
} from './abi/thru/program/abi_manager/types';
import {
  accountData,
  pubkeyAddress,
} from '../utils/helpers';
import {
  ABI_ACCOUNT_HEADER_SIZE,
  ABI_META_KIND_EXTERNAL,
  ABI_META_KIND_OFFICIAL,
  ABI_META_SIZE,
  ABI_META_VERSION,
  ABI_STATE_FINALIZED,
  ABI_STATE_OPEN,
} from './constants';
import type { ABIAccountInfo, ABIMetaAccountInfo } from './types';

export function parseABIMetaAccount(
  account: Account | Uint8Array
): ABIMetaAccountInfo {
  const data = accountData(account, 'ABI metadata account');
  if (data.length !== ABI_META_SIZE) {
    throw new Error(
      `ABI metadata account must be ${ABI_META_SIZE} bytes, got ${data.length}`
    );
  }
  const parsed = AbiMetaAccount.from_array(data);
  if (!parsed) throw new Error('ABI metadata account is malformed');
  const version = parsed.get_version();
  if (version !== ABI_META_VERSION) {
    throw new Error(`unsupported ABI metadata version ${version}`);
  }
  const flags = parsed.get_flags();
  const kind = parsed.get_kind();
  if (kind === ABI_META_KIND_OFFICIAL) {
    return {
      kind: 'official',
      version,
      flags,
      programAddress: pubkeyAddress(data.slice(4, 36)),
    };
  }
  if (kind === ABI_META_KIND_EXTERNAL) {
    return {
      kind: 'external',
      version,
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
  if (data.length < ABI_ACCOUNT_HEADER_SIZE) {
    throw new Error(
      `ABI account must be at least ${ABI_ACCOUNT_HEADER_SIZE} bytes, got ${data.length}`
    );
  }
  const contentSize = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  ).getUint32(41, true);
  const expectedLength = ABI_ACCOUNT_HEADER_SIZE + contentSize;
  if (data.length !== expectedLength) {
    throw new Error(
      `ABI account content length expects ${expectedLength} bytes, got ${data.length}`
    );
  }
  const parsed = AbiAccount.from_array(data);
  if (!parsed) throw new Error('ABI account is malformed');
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
