import { deriveManagedProgramAddresses } from '../manager/derivation.js';
import { deriveAddress, deriveProgramAddress, Pubkey } from '@thru/sdk';

/** Permanent seeds used by programs/bootstrap. Changing a seed changes every
 * managed program and ABI address derived from it. */
export const BOOTSTRAP_PROGRAM_SEEDS = Object.freeze({
  noop: 'thru-program:22654259',
  faucet: 'thru-program:310129',
  name_service: 'thru-program:2236909',
  oracle: 'thru-program:87959905',
  multicall: 'thru-program:3153525730',
  abi_manager: 'thru-program:167497',
  token: 'thru-program:3767426089',
  amm: 'thru-program:4614050',
  clob: 'thru-program:79287062',
  thru_registrar: 'thru-program:449594',
  wthru: 'thru-program:1687299648',
  passkey_manager: 'thru-program:1746189',
  nft: 'thru-program:1654635',
  block_producer: 'thru-program:8222',
  consensus_validator: 'thru-program:35555736',
} as const);

function managedProgramAddress(seed: string): string {
  return deriveManagedProgramAddresses(seed).programAccountAddress;
}

/** EOA is installed by genesis, not uploaded by application bootstrap. */
export const GENESIS_EOA_PROGRAM_SEED = 'thru-program:207434';
export const GENESIS_EOA_PROGRAM_ADDRESS = managedProgramAddress(GENESIS_EOA_PROGRAM_SEED);

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

function stateAddress(program: string, label: string): string {
  const seed = new Uint8Array(32);
  seed.set(new TextEncoder().encode(label));
  return deriveProgramAddress({ programAddress: program, seed }).address;
}

const wthruSeed = new Uint8Array(32);
/** Created by Faucet initialization after deployment, never by genesis. */
export const BOOTSTRAP_FAUCET_VAULT_ADDRESS = stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.faucet, 'vault');

wthruSeed.set(new TextEncoder().encode('wthru'));
const wthruMintSeed = deriveAddress([
  Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.wthru).toBytes(), wthruSeed,
]).bytes;

/** State pre-created by mksnap before the managed executables are deployed.
 * Consensus state uses its own namespace; WTHRU matches program initialization. */
export const BOOTSTRAP_STATE_ADDRESSES = Object.freeze({
  attestor_table: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'attestor_table'),
  attestor_mint: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'attestor_mint'),
  converted_vault: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'converted_vault'),
  unclaimed_vault: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'unclaimed_vault'),
  validator_token_base: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'validator_token'),
  wthru_mint: deriveProgramAddress({
    programAddress: BOOTSTRAP_PROGRAM_ADDRESSES.token, seed: wthruMintSeed,
  }).address,
  wthru_vault: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.wthru, 'vault'),
});

/** Alphanet production THRUSD mint after the approved fresh-network reset.
 * Keep the legacy CREDITS export names for consumers. The seed is SHA-256 of
 * thru:credits:app-wide-mint:v1, matching the wallet mint setup default.
 * Application mints are initialized separately, not by core ensure all. */
export const CREDITS_MINT_AUTHORITY_ADDRESS =
  'taDOTQyYDVPvYqIFKNBFbOIstmBXeY7Ne06JnUAjmHa4VI';
export const CREDITS_MINT_SEED_HEX =
  '93dd69ed3fd6776d814430ec1d9de70716cdac46f89184d88251cabc4865f211';
export const CREDITS_MINT_ADDRESS =
  'taRfWjryqWSRRp6ZU_ahCHXKhEA0oRVKWZlE4Us86vnOOt';

export type BootstrapProgramName = keyof typeof BOOTSTRAP_PROGRAM_SEEDS;
