import { deriveManagedProgramAddresses } from '../manager/derivation.js';
import { CORE_MANAGER_PROGRAM_ADDRESS, MANAGER_PROGRAM_ADDRESS } from '../manager/constants.js';
import type { ManagedProgramAddresses } from '../manager/types.js';
import { deriveAddress, deriveProgramAddress, Pubkey } from '@thru/sdk';
import { hashBytes } from '../utils/helpers.js';
import {
  CANONICAL_PROGRAMS, E2E_PROGRAMS, CORE_CONFIG_SEED,
  FEATURE_GATE_GLOBAL_SEED, programAuthoritySeed, type CanonicalProgramName,
} from './registry.js';
export * from './registry.js';
function withDeprecatedPasskeyManagerAlias<T extends { wallet: string }>(values: T) {
  return Object.freeze(Object.defineProperty(values, 'passkey_manager', {
    value: values.wallet,
    enumerable: false,
  }) as T & {
    /** @deprecated Use wallet. This alias is intentionally non-enumerable. */
    readonly passkey_manager: T['wallet'];
  });
}

export { CORE_MANAGER_PROGRAM_ADDRESS } from '../manager/constants.js';

/** Canonical genesis children always select Core explicitly. The eight
 * applications (parent `public`, UNTO-3561) are deployed after genesis under
 * the Public program manager, so their pair is Public's derivation of the
 * same seed. */
// Object.fromEntries erases the literal registry keys; every non-root record
// below produces the same concrete managed-pair type.
const managedProgramPairs = Object.fromEntries(
  CANONICAL_PROGRAMS.flatMap((record) => record.seed === null ? [] : [
    [record.name, deriveManagedProgramAddresses(record.seed, false,
      record.parent === 'public' ? MANAGER_PROGRAM_ADDRESS : CORE_MANAGER_PROGRAM_ADDRESS)] as const,
  ]),
) as Record<Exclude<CanonicalProgramName, 'core_manager'>, ManagedProgramAddresses>;
export const BOOTSTRAP_PROGRAM_PAIRS = Object.freeze({
  core_manager: {
    programAccountAddress: CORE_MANAGER_PROGRAM_ADDRESS,
    programMetaAccountAddress: null,
  },
  ...managedProgramPairs,
});
export const BOOTSTRAP_PROGRAM_SEEDS = withDeprecatedPasskeyManagerAlias(Object.fromEntries(
  CANONICAL_PROGRAMS.filter((record) => record.seed !== null).map((record) => [record.name, record.seed!]),
) as Record<Exclude<CanonicalProgramName, 'core_manager'>, string>);
export const BOOTSTRAP_PROGRAM_ADDRESSES = withDeprecatedPasskeyManagerAlias(Object.fromEntries(
  CANONICAL_PROGRAMS.map((record) => [record.name, BOOTSTRAP_PROGRAM_PAIRS[record.name].programAccountAddress]),
) as Record<CanonicalProgramName, string>);
/** Core B executable: an ordinary Core A-managed pair that owns Core A (UNTO-3561). */
export const CORE_PEER_MANAGER_PROGRAM_ADDRESS = BOOTSTRAP_PROGRAM_ADDRESSES.core_peer_manager;
export const E2E_PROGRAM_PAIRS = Object.freeze(Object.fromEntries(
  E2E_PROGRAMS.map((record) => [record.name, deriveManagedProgramAddresses(record.seed!, false, CORE_MANAGER_PROGRAM_ADDRESS)]),
));
export const GENESIS_EOA_PROGRAM_SEED = BOOTSTRAP_PROGRAM_SEEDS.eoa;
export const GENESIS_EOA_PROGRAM_ADDRESS = BOOTSTRAP_PROGRAM_ADDRESSES.eoa;

/** Avoid importing abi-manager/constants here: it consumes this module. */
export const BOOTSTRAP_ABI_ADDRESSES = Object.freeze(Object.fromEntries(
  CANONICAL_PROGRAMS.filter((record) => record.abi !== null).map((record) => {
    const body = new Uint8Array(96);
    body.set(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES[record.name]).toBytes());
    const kind = Uint8Array.of(0);
    const derive = (seed: Uint8Array) => deriveProgramAddress({
      programAddress: BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager, seed,
    }).address;
    return [record.name, {
      abiMetaAccountAddress: derive(hashBytes(kind, body)),
      abiAccountAddress: derive(hashBytes(kind, body, new TextEncoder().encode('_abi_account'))),
    }];
  }),
));

/** Each Public application's own program-authority multisig (UNTO-3561): the
 * Multisig program PDA of its `<name>:v1` seed, initialized at genesis. */
export const PUBLIC_PROGRAM_AUTHORITY_ADDRESSES = Object.freeze(Object.fromEntries(
  CANONICAL_PROGRAMS.flatMap((record) => 'programAuthority' in record && record.programAuthority ? [[record.name, {
    name: record.programAuthority, seed: programAuthoritySeed(record.programAuthority),
    address: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.multisig, programAuthoritySeed(record.programAuthority)),
  }]] : []),
) as Record<string, { readonly name: string; readonly seed: string; readonly address: string }>);

/** Native Token Vault PDA seeds (tn_native_token_vault_program.h). */
export const NATIVE_TOKEN_VAULT_RECEIVER_SEED = 'absent-producer-fees:v1';
export const NATIVE_TOKEN_VAULT_CONFIG_SEED = 'native-token-vault-config:v1';
/** The vault authority multisig (seed `native-token-vault-authority:v1`). */
export const NATIVE_TOKEN_VAULT_AUTHORITY_MULTISIG = 'native-token-vault-authority';

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
const wthruMintAddress = deriveProgramAddress({
  programAddress: BOOTSTRAP_PROGRAM_ADDRESSES.token, seed: wthruMintSeed,
}).address;

/** The WTHRU token account the Token program creates for `owner` with `seed`
 * (UTF-8, at most 32 bytes, zero-padded; empty is the default account): the
 * Token PDA of SHA256(owner || WTHRU mint || seed), as the Token SDK's
 * deriveTokenAccountAddress computes it. */
export function deriveWthruTokenAccountAddress(owner: string, seed = ''): string {
  const padded = new Uint8Array(32);
  padded.set(new TextEncoder().encode(seed));
  return deriveProgramAddress({
    programAddress: BOOTSTRAP_PROGRAM_ADDRESSES.token,
    seed: deriveAddress([Pubkey.from(owner).toBytes(), Pubkey.from(wthruMintAddress).toBytes(), padded]).bytes,
  }).address;
}

/** State pre-created by mksnap before the managed executables are deployed.
 * The attestor table uses the consensus program's own namespace.  The
 * consensus vaults and the WTHRU mint and vault are created where the
 * programs' initialization creates them; the consensus vaults are WTHRU
 * token accounts and are not published as constants (generate-addresses.ts):
 * consumers derive them or read them from the attestor table header. */
export const BOOTSTRAP_STATE_ADDRESSES = Object.freeze({
  core_config: stateAddress(CORE_MANAGER_PROGRAM_ADDRESS, CORE_CONFIG_SEED),
  core_peer_config: stateAddress(CORE_PEER_MANAGER_PROGRAM_ADDRESS, CORE_CONFIG_SEED),
  feature_gate_global_account: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.feature_gate, FEATURE_GATE_GLOBAL_SEED),
  attestor_table: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'attestor_table'),
  converted_vault: deriveWthruTokenAccountAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'converted_vault'),
  unclaimed_vault: deriveWthruTokenAccountAddress(BOOTSTRAP_PROGRAM_ADDRESSES.consensus_validator, 'unclaimed_vault'),
  wthru_mint: wthruMintAddress,
  wthru_vault: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.wthru, 'vault'),
  /* UNTO-3561: genesis-only Native Token Vault accounts. The receiver is the
     runtime's TN_ABSENT_BLOCK_PRODUCER_FEE_RECEIVER_ADDR_BYTES. */
  native_token_vault_receiver: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.native_token_vault, NATIVE_TOKEN_VAULT_RECEIVER_SEED),
  native_token_vault_config: stateAddress(BOOTSTRAP_PROGRAM_ADDRESSES.native_token_vault, NATIVE_TOKEN_VAULT_CONFIG_SEED),
});

/** Separately configured application mint identity, not a genesis account or
 * bootstrap initialization hook. Preserve the authority/seed, while deriving
 * its address under the current canonical Token executable. */
export const CREDITS_MINT_AUTHORITY_ADDRESS =
  'taDOTQyYDVPvYqIFKNBFbOIstmBXeY7Ne06JnUAjmHa4VI';
export const CREDITS_MINT_SEED_HEX =
  '93dd69ed3fd6776d814430ec1d9de70716cdac46f89184d88251cabc4865f211';
export const CREDITS_MINT_ADDRESS = deriveProgramAddress({
  programAddress: BOOTSTRAP_PROGRAM_ADDRESSES.token,
  seed: deriveAddress([
    Pubkey.from(CREDITS_MINT_AUTHORITY_ADDRESS).toBytes(),
    Pubkey.from(CREDITS_MINT_SEED_HEX).toBytes(),
  ]).bytes,
}).address;

export type BootstrapProgramName = CanonicalProgramName;
