import { decodeAddress } from '@thru/sdk/helpers';
import { UPLOADER_PROGRAM_ADDRESS } from '../../../../src/core-program-addresses';
export { UPLOADER_PROGRAM_ADDRESS };
export const UPLOADER_PROGRAM_SEED = 'thru-program:1073768';
export const UPLOADER_PROGRAM_PUBKEY = decodeAddress(UPLOADER_PROGRAM_ADDRESS);

export const UPLOADER_META_SIZE = 65;
export const UPLOADER_STATE_OPEN = 0x01;
export const UPLOADER_STATE_FINALIZED = 0x02;

/* Safe uploader write sizes matching the CLI policy under TN_TXN_MTU. */
export const UPLOADER_DEFAULT_CHUNK_SIZE = 30_720;
export const UPLOADER_MIN_CHUNK_SIZE = 1_024;
export const UPLOADER_MAX_CHUNK_SIZE = 31_000;
