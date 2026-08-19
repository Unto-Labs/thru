import { encodeAddress } from '@thru/sdk/helpers';
import { systemProgramPubkey } from '../utils/helpers';

export const MANAGER_PROGRAM_PUBKEY = systemProgramPubkey(0x04);
export const MANAGER_PROGRAM_ADDRESS = encodeAddress(MANAGER_PROGRAM_PUBKEY);

export const MANAGER_META_SIZE = 73;

export const MANAGER_STATE_OPEN = 0x00;
export const MANAGER_STATE_PAUSED = 0x01;
export const MANAGER_STATE_FINALIZED = 0x02;

export const MANAGER_PROGRAM_IMAGE_VERSION = 0x01;
export const MANAGER_PROGRAM_IMAGE_HEADER_SIZE = 8;
export const MANAGER_PROGRAM_IMAGE_TRAILER_SIZE = 8;
export const MANAGER_PROGRAM_IMAGE_MIN_TEXT_SIZE = 4;
