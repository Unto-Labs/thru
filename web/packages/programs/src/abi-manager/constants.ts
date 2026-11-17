import { Pubkey } from '@thru/sdk';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses/index';

export const ABI_MANAGER_PROGRAM_ADDRESS =
  BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager;
export const ABI_MANAGER_PROGRAM_PUBKEY = Pubkey.from(
  ABI_MANAGER_PROGRAM_ADDRESS
).toBytes();

/** Account discriminators (byte 0). Values are never reused; a new layout
    takes the next value. */
export const ABI_ACCOUNT_TYPE_META_V1 = 1;
export const ABI_ACCOUNT_TYPE_CONTENT_V1 = 2;

/** ABI metadata account size: account_type, kind, flags, 96-byte body. */
export const ABI_META_SIZE = 100;
/** ABI content account header: account_type, meta pubkey, revision, state,
    content_sz. The contents follow. */
export const ABI_ACCOUNT_HEADER_SIZE = 46;

export const ABI_META_KIND_OFFICIAL = 0x00;
export const ABI_META_KIND_EXTERNAL = 0x01;

export const ABI_STATE_OPEN = 0x00;
export const ABI_STATE_FINALIZED = 0x01;

export const ABI_ACCOUNT_SEED_SUFFIX = new TextEncoder().encode('_abi_account');
