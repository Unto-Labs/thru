import { deriveProgramAddress } from '@thru/sdk';
import {
  padSeed,
  pubkeyBytes,
  type ProgramSeed,
} from '../utils/helpers';
import { UPLOADER_PROGRAM_ADDRESS } from './constants';
import type { UploadAddresses } from './types';

export function deriveUploadAddresses(
  seed: ProgramSeed,
  uploaderProgramAddress: string | Uint8Array = UPLOADER_PROGRAM_ADDRESS
): UploadAddresses {
  const uploader = pubkeyBytes(
    uploaderProgramAddress,
    'uploader program address'
  );
  const meta = deriveProgramAddress({
    programAddress: uploader,
    seed: padSeed(seed),
    ephemeral: true,
  });
  const buffer = deriveProgramAddress({
    programAddress: uploader,
    seed: meta.bytes,
    ephemeral: true,
  });
  return {
    metaAccountAddress: meta.address,
    metaAccountBytes: meta.bytes,
    bufferAccountAddress: buffer.address,
    bufferAccountBytes: buffer.bytes,
  };
}
