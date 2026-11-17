import { encodeAddress } from '@thru/sdk/helpers';
import { deriveProgramAddress, Pubkey } from '@thru/sdk';
import { padSeed } from '../utils/helpers.js';
import { CANONICAL_PROGRAMS, CORE_MANAGER_HEX } from '../bootstrap-addresses/registry.js';

/** The fixed Core trust root governs canonical programs, including Public Manager. */
export const CORE_MANAGER_PROGRAM_PUBKEY = Pubkey.from(CORE_MANAGER_HEX).toBytes();
export const CORE_MANAGER_PROGRAM_ADDRESS = encodeAddress(CORE_MANAGER_PROGRAM_PUBKEY);
export const MANAGER_PROGRAM_SEED = CANONICAL_PROGRAMS.find(entry => entry.name === 'public_manager')!.seed!;
const managerMeta = deriveProgramAddress({
  programAddress: CORE_MANAGER_PROGRAM_ADDRESS,
  seed: padSeed(MANAGER_PROGRAM_SEED),
});
export const MANAGER_PROGRAM_PUBKEY = deriveProgramAddress({
  programAddress: CORE_MANAGER_PROGRAM_ADDRESS,
  seed: managerMeta.bytes,
}).bytes;
export const MANAGER_PROGRAM_ADDRESS = encodeAddress(MANAGER_PROGRAM_PUBKEY);

/** Account discriminator of program metadata (byte 0); Core Manager uses the
    same value for the same layout. */
export const MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1 = 1;
export const MANAGER_META_SIZE = 74;

export const MANAGER_STATE_OPEN = 0x00;
export const MANAGER_STATE_PAUSED = 0x01;
export const MANAGER_STATE_FINALIZED = 0x02;

export const MANAGER_PROGRAM_IMAGE_VERSION = 0x01;
export const MANAGER_PROGRAM_IMAGE_HEADER_SIZE = 8;
export const MANAGER_PROGRAM_IMAGE_TRAILER_SIZE = 8;
export const MANAGER_PROGRAM_IMAGE_MIN_TEXT_SIZE = 4;
