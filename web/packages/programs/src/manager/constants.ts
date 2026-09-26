import { encodeAddress } from '@thru/sdk/helpers';
import { deriveProgramAddress } from '@thru/sdk';
import { padSeed, systemProgramPubkey } from '../utils/helpers.js';

/** The immutable trust root manages only the upgradeable main Manager. */
export const ROOT_MANAGER_PROGRAM_PUBKEY = systemProgramPubkey(0x01);
export const ROOT_MANAGER_PROGRAM_ADDRESS = encodeAddress(ROOT_MANAGER_PROGRAM_PUBKEY);
export const MANAGER_PROGRAM_SEED = 'thru-main-manager:949457';
const managerMeta = deriveProgramAddress({
  programAddress: ROOT_MANAGER_PROGRAM_ADDRESS,
  seed: padSeed(MANAGER_PROGRAM_SEED),
});
export const MANAGER_PROGRAM_PUBKEY = deriveProgramAddress({
  programAddress: ROOT_MANAGER_PROGRAM_ADDRESS,
  seed: managerMeta.bytes,
}).bytes;
export const MANAGER_PROGRAM_ADDRESS = encodeAddress(MANAGER_PROGRAM_PUBKEY);

export const MANAGER_META_SIZE = 73;

export const MANAGER_STATE_OPEN = 0x00;
export const MANAGER_STATE_PAUSED = 0x01;
export const MANAGER_STATE_FINALIZED = 0x02;

export const MANAGER_PROGRAM_IMAGE_VERSION = 0x01;
export const MANAGER_PROGRAM_IMAGE_HEADER_SIZE = 8;
export const MANAGER_PROGRAM_IMAGE_TRAILER_SIZE = 8;
export const MANAGER_PROGRAM_IMAGE_MIN_TEXT_SIZE = 4;
