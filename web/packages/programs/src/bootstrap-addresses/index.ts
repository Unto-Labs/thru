import { deriveManagedProgramAddresses } from '../manager/derivation';

/** Permanent seeds used by programs/bootstrap. Changing a seed changes every
 * managed program and ABI address derived from it. */
export const BOOTSTRAP_PROGRAM_SEEDS = Object.freeze({
  noop: 'thru-noop',
  faucet: 'thru-faucet',
  name_service: 'thru-name_service',
  oracle: 'thru-oracle',
  multicall: 'thru-multicall',
  abi_manager: 'thru-abi_manager',
  token: 'thru-token',
  amm: 'thru-amm',
  clob: 'thru-clob',
  thru_registrar: 'thru-thru_registrar',
  wthru: 'thru-wthru',
  passkey_manager: 'thru-passkey_manager',
  nft: 'thru-nft',
  block_producer: 'thru-block_producer',
  consensus_validator: 'thru-consensus_validator',
} as const);

function managedProgramAddress(seed: string): string {
  return deriveManagedProgramAddresses(seed).programAccountAddress;
}

/** Canonical application-facing addresses for bootstrap-managed programs. */
export const BOOTSTRAP_PROGRAM_ADDRESSES = Object.freeze({
  noop: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.noop),
  faucet: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.faucet),
  name_service: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.name_service),
  oracle: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.oracle),
  multicall: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.multicall),
  abi_manager: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.abi_manager),
  token: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.token),
  amm: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.amm),
  clob: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.clob),
  thru_registrar: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.thru_registrar),
  wthru: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.wthru),
  passkey_manager: managedProgramAddress(
    BOOTSTRAP_PROGRAM_SEEDS.passkey_manager,
  ),
  nft: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.nft),
  block_producer: managedProgramAddress(BOOTSTRAP_PROGRAM_SEEDS.block_producer),
  consensus_validator: managedProgramAddress(
    BOOTSTRAP_PROGRAM_SEEDS.consensus_validator,
  ),
} as const);

/** Permanent CREDITS mint contract recreated by Token bootstrap setup. */
export const CREDITS_MINT_AUTHORITY_ADDRESS =
  'taDOTQyYDVPvYqIFKNBFbOIstmBXeY7Ne06JnUAjmHa4VI';
export const CREDITS_MINT_SEED_HEX =
  '746872752d637265646974730000000000000000000000000000000000000000';
export const CREDITS_MINT_ADDRESS =
  'taYtAFmBxSxFlrTQ4Xhv4l6CoG0wH8wbSCMV80KnBGbal5';

export type BootstrapProgramName = keyof typeof BOOTSTRAP_PROGRAM_SEEDS;
