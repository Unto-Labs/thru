import {
  Authority,
  AuthorityRecord,
} from './abi/thru/program/passkey_manager/types';

export const PASSKEY_MANAGER_PROGRAM_ADDRESS =
  'tabsq39mzj3DZlutXOGG6VtfMj8fUvI0HIOXfZm7TLLY6N';

// Instruction discriminants
export const INSTRUCTION_CREATE = 0x00;
export const INSTRUCTION_VALIDATE = 0x01;
export const INSTRUCTION_TRANSFER = 0x02;
export const INSTRUCTION_ADD_AUTHORITY = 0x04;
export const INSTRUCTION_REMOVE_AUTHORITY = 0x05;
export const INSTRUCTION_REGISTER_CREDENTIAL = 0x06;

// Authority tags
export const AUTHORITY_TAG_PASSKEY = 1;
export const AUTHORITY_TAG_PUBKEY = 2;

export const AUTHORITY_BYTES = Authority.footprint();
export const AUTHORITY_RECORD_BYTES = AuthorityRecord.footprint();
export const LONG_LIVED_AUTHORITY_EXPIRY_SECONDS = 0xffffffffffffffffn;
