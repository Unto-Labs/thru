import { decodeAddress } from '@thru/sdk/helpers';
import { UPLOADER_PROGRAM_ADDRESS } from '../../../../src/core-program-addresses';
export { UPLOADER_PROGRAM_ADDRESS };
export const UPLOADER_PROGRAM_SEED = 'thru-program:191563656778';
export const UPLOADER_PROGRAM_PUBKEY = decodeAddress(UPLOADER_PROGRAM_ADDRESS);

/** Account discriminator of the uploader metadata account (byte 0). Values are
    never reused; a new layout takes the next value. Source buffers carry raw
    bytes and have no discriminator. */
export const UPLOADER_ACCOUNT_TYPE_META_V1 = 1;
/** Uploader metadata account size: account_type, authority, expected hash, state. */
export const UPLOADER_META_SIZE = 66;
export const UPLOADER_STATE_OPEN = 0x01;
export const UPLOADER_STATE_FINALIZED = 0x02;

/* Safe uploader write sizes matching the CLI policy under TN_TXN_MTU. */
export const UPLOADER_DEFAULT_CHUNK_SIZE = 30_720;
export const UPLOADER_MIN_CHUNK_SIZE = 1_024;
export const UPLOADER_MAX_CHUNK_SIZE = 31_000;
