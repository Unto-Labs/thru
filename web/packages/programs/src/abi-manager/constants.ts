import { Pubkey } from '@thru/sdk';

export const ABI_MANAGER_PROGRAM_ADDRESS =
  'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACrG7';
export const ABI_MANAGER_PROGRAM_PUBKEY = Pubkey.from(
  ABI_MANAGER_PROGRAM_ADDRESS
).toBytes();

export const ABI_META_SIZE = 100;
export const ABI_ACCOUNT_HEADER_SIZE = 45;
export const ABI_META_VERSION = 1;

export const ABI_META_KIND_OFFICIAL = 0x00;
export const ABI_META_KIND_EXTERNAL = 0x01;

export const ABI_STATE_OPEN = 0x00;
export const ABI_STATE_FINALIZED = 0x01;

export const ABI_ACCOUNT_SEED_SUFFIX = new TextEncoder().encode('_abi_account');
