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
/** Account discriminators (byte 0 of every Wallet Program account). Values are
    never reused; a new layout takes the next value. */
export const WALLET_ACCOUNT_TYPE_WALLET_V1 = 1;
export const WALLET_ACCOUNT_TYPE_CREDENTIAL_LOOKUP_V1 = 2;
/** Wallet header: account_type, num_auth, nonce. Authority records follow. */
export const WALLET_ACCOUNT_HEADER_SIZE = 10;
/** Credential lookup account: account_type + wallet pubkey. */
export const WALLET_CREDENTIAL_LOOKUP_SIZE = 33;

export const LONG_LIVED_AUTHORITY_EXPIRY_SECONDS = 0xffffffffffffffffn;
