import { deriveManagedProgramAddresses } from "../manager/derivation.js";

export const UPLOADER_PROGRAM_SEED = "thru-program:1073768";
const uploader = deriveManagedProgramAddresses(UPLOADER_PROGRAM_SEED);
export const UPLOADER_PROGRAM_PUBKEY = uploader.programAccountBytes;
export const UPLOADER_PROGRAM_ADDRESS = uploader.programAccountAddress;

export const UPLOADER_META_SIZE = 65;
export const UPLOADER_STATE_OPEN = 0x01;
export const UPLOADER_STATE_FINALIZED = 0x02;

/* Safe uploader write sizes matching the CLI policy under TN_TXN_MTU. */
export const UPLOADER_DEFAULT_CHUNK_SIZE = 30_720;
export const UPLOADER_MIN_CHUNK_SIZE = 1_024;
export const UPLOADER_MAX_CHUNK_SIZE = 31_000;
