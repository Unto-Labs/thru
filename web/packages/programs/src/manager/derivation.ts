import { deriveProgramAddress } from '@thru/sdk';
import { MANAGER_PROGRAM_ADDRESS } from './constants';
import {
  padSeed,
  pubkeyBytes,
  type ProgramSeed,
} from '../utils/helpers';
import type { ManagedProgramAddresses } from './types';

export function deriveManagedProgramAddresses(
  seed: ProgramSeed,
  ephemeral = false,
  managerProgramAddress: string | Uint8Array = MANAGER_PROGRAM_ADDRESS
): ManagedProgramAddresses {
  const manager = pubkeyBytes(managerProgramAddress, 'manager program address');
  const meta = deriveProgramAddress({
    programAddress: manager,
    seed: padSeed(seed),
    ephemeral,
  });
  const program = deriveProgramAddress({
    programAddress: manager,
    seed: meta.bytes,
    ephemeral,
  });
  return {
    programMetaAccountAddress: meta.address,
    programMetaAccountBytes: meta.bytes,
    programAccountAddress: program.address,
    programAccountBytes: program.bytes,
  };
}
