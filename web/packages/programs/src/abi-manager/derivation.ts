import { deriveProgramAddress } from '@thru/sdk';
import {
  exactBytes,
  hashBytes,
  pubkeyBytes,
} from '../utils/helpers';
import {
  ABI_ACCOUNT_SEED_SUFFIX,
  ABI_MANAGER_PROGRAM_ADDRESS,
  ABI_META_KIND_EXTERNAL,
  ABI_META_KIND_OFFICIAL,
} from './constants';
import type { ProgramABIAddresses } from './types';

const TEXT_ENCODER = new TextEncoder();

export function hashExternalABISeed(seed: string): Uint8Array {
  return hashBytes(TEXT_ENCODER.encode(seed));
}

export function deriveOfficialABIAddresses(
  programAddress: string | Uint8Array,
  ephemeral = false,
  abiManagerProgramAddress: string | Uint8Array = ABI_MANAGER_PROGRAM_ADDRESS
): ProgramABIAddresses {
  const body = new Uint8Array(96);
  body.set(pubkeyBytes(programAddress, 'program address'));
  return deriveAddresses(
    ABI_META_KIND_OFFICIAL,
    body,
    ephemeral,
    abiManagerProgramAddress
  );
}

export const deriveProgramABIAddresses = deriveOfficialABIAddresses;

export function deriveExternalABIAddresses(
  publisherAddress: string | Uint8Array,
  targetProgramAddress: string | Uint8Array,
  seed: Uint8Array,
  ephemeral = false,
  abiManagerProgramAddress: string | Uint8Array = ABI_MANAGER_PROGRAM_ADDRESS
): ProgramABIAddresses {
  const body = new Uint8Array(96);
  body.set(pubkeyBytes(publisherAddress, 'publisher address'), 0);
  body.set(pubkeyBytes(targetProgramAddress, 'target program address'), 32);
  body.set(exactBytes(seed, 32, 'external ABI seed'), 64);
  return deriveAddresses(
    ABI_META_KIND_EXTERNAL,
    body,
    ephemeral,
    abiManagerProgramAddress
  );
}

function deriveAddresses(
  kind: number,
  body: Uint8Array,
  ephemeral: boolean,
  abiManagerProgramAddress: string | Uint8Array
): ProgramABIAddresses {
  const manager = pubkeyBytes(
    abiManagerProgramAddress,
    'ABI manager program address'
  );
  const kindBytes = Uint8Array.of(kind);
  const metaSeed = hashBytes(kindBytes, body);
  const abiSeed = hashBytes(kindBytes, body, ABI_ACCOUNT_SEED_SUFFIX);
  const meta = deriveProgramAddress({
    programAddress: manager,
    seed: metaSeed,
    ephemeral,
  });
  const abi = deriveProgramAddress({
    programAddress: manager,
    seed: abiSeed,
    ephemeral,
  });
  return {
    abiMetaAccountAddress: meta.address,
    abiMetaAccountBytes: meta.bytes,
    abiAccountAddress: abi.address,
    abiAccountBytes: abi.bytes,
  };
}
