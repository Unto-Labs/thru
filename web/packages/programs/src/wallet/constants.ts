import {
  Authority,
  AuthorityRecord,
} from './abi/thru/program/wallet/types';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';

export const WALLET_PROGRAM_ADDRESS =
  BOOTSTRAP_PROGRAM_ADDRESSES.wallet;

/** @deprecated Use WALLET_PROGRAM_ADDRESS. */
export const PASSKEY_MANAGER_PROGRAM_ADDRESS = WALLET_PROGRAM_ADDRESS;

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
