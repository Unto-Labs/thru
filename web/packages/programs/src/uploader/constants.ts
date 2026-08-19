import { encodeAddress } from "@thru/sdk/helpers";
import { systemProgramPubkey } from "../utils/helpers";

export const UPLOADER_PROGRAM_PUBKEY = systemProgramPubkey(0x02);
export const UPLOADER_PROGRAM_ADDRESS = encodeAddress(UPLOADER_PROGRAM_PUBKEY);

export const UPLOADER_META_SIZE = 65;
export const UPLOADER_STATE_OPEN = 0x01;
export const UPLOADER_STATE_FINALIZED = 0x02;

/* Safe uploader write sizes matching the CLI policy under TN_TXN_MTU. */
export const UPLOADER_DEFAULT_CHUNK_SIZE = 30_720;
export const UPLOADER_MIN_CHUNK_SIZE = 1_024;
export const UPLOADER_MAX_CHUNK_SIZE = 31_000;
