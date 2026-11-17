/** Source-only inventory. This module deliberately has no imports. */
export const VALIDATION_POLICY_VERSION = 1;
export const CORE_MANAGER_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
export const CORE_CONFIG_SEED = 'thru-core-config:v1';
export const FEATURE_GATE_GLOBAL_SEED = 'global_feature_gate_account';

export interface PreparedAbi {
  readonly source: string;
  readonly output: string;
  readonly buildDependency: 'abi_cli';
  readonly mirrors?: readonly string[];
}
export interface ProgramRecord {
  readonly name: string;
  readonly seed: string | null;
  /** `core`: a Core A-managed genesis pair. `core_peer`: the fixed root (Core
   * A), owned by Core B. `public`: an application deployed after genesis under
   * the Public program manager (UNTO-3561); never a genesis account. */
  readonly parent: 'core' | 'core_peer' | 'public';
  readonly binary: string;
  readonly abi: PreparedAbi | null;
  /** `core_peer_manager` (Core B, UNTO-3561) is not a manifest input: genesis
   * emits it from `core_program_manager`'s binary and ABI. `core_bootstrap`
   * (the Public Manager) is a Core A-managed pair created after genesis by
   * `bootstrap programs create`, and `public_programs` are deployed after
   * genesis under the Public Manager: neither is a genesis input, and genesis
   * rejects their seeds. */
  readonly placement: 'core_program_manager' | 'core_peer_manager' | 'core_bootstrap' | 'feature_gate_program' | 'programs' | 'public_programs';
  /** Genesis programs are UNCOMPRESSABLE on executable (and metadata, when
   * managed). Public deployments carry no Core pin. */
  readonly pinExecutable: boolean;
  readonly pinMetadata: boolean;
  /** Public applications only: the default name of the application's own
   * program-authority multisig (seed `<name>:v1`), created at genesis through
   * `multisig_accounts`. It becomes the Public metadata authority. */
  readonly programAuthority?: string;
  readonly overlay?: 'e2e';
}
const abi = (basename: string, source = `rpc/abi/type-library/${basename}.abi.yaml`, mirrors?: readonly string[]): PreparedAbi => ({
  source, output: `programs/bootstrap/generated/${basename}.abi.yaml`, buildDependency: 'abi_cli', ...(mirrors ? { mirrors } : {}),
});
const program = <N extends string>(name: N, seed: string | null, binary: string, descriptor: PreparedAbi | null,
  placement: ProgramRecord['placement'] = 'programs'): ProgramRecord & { readonly name: N } => ({
  name, seed, parent: seed === null ? 'core_peer' : 'core', binary: `build/thruvm/bin/${binary}.bin`, abi: descriptor,
  placement, pinExecutable: true, pinMetadata: seed !== null,
});
/** Applications leave genesis (UNTO-3561): their canonical pair is the Public
 * program manager's derivation of their Public-era vanity seed (the "Old seed"
 * column of specs/vanity-core-program-addresses.md), governed by their own
 * multisig. */
const app = <N extends string>(name: N, seed: string, binary: string, descriptor: PreparedAbi, programAuthority: string): ProgramRecord & { readonly name: N } => ({
  name, seed, parent: 'public', binary: `build/thruvm/bin/${binary}.bin`, abi: descriptor,
  placement: 'public_programs', pinExecutable: false, pinMetadata: false, programAuthority,
});
/** Seed of an application's program-authority multisig. */
export const programAuthoritySeed = (name: string): string => `${name}:v1`;
export const CANONICAL_PROGRAMS = [
  program('core_manager', null, 'tn_core_manager_program_c', abi('core_manager'), 'core_program_manager'),
  /* Core B (UNTO-3561): an ordinary Core A-managed pair running the Core
     binary. It owns Core A's executable, so Core A is upgraded by Core B's
     UpgradePeer while Core A upgrades Core B with the ordinary Upgrade. */
  program('core_peer_manager', 'thru-core-peer:v1', 'tn_core_manager_program_c', abi('core_manager'), 'core_peer_manager'),
  /* The Public Manager leaves genesis (UNTO-3561): Core A creates it after
     genesis at the same seed, pinned, with zero application authority. */
  program('public_manager', 'thru-main-manager:949457', 'tn_manager_program_c', abi('tn_manager_program'), 'core_bootstrap'),
  program('feature_gate', 'feature_gate_program', 'tn_feature_gate_program_c', null, 'feature_gate_program'),
  program('noop', 'thru-program:20843460', 'tn_noop_program_c', abi('tn_noop_program')),
  app('faucet', 'thru-program:310129', 'tn_faucet_program_c', abi('tn_faucet_program'), 'faucet-authority'),
  app('name_service', 'thru-program:2236909', 'tn_name_service_program_c', abi('tn_name_service_program'), 'name-service-authority'),
  app('oracle', 'thru-program:87959905', 'tn_oracle_program_c', abi('tn_oracle_program'), 'oracle-authority'),
  program('multicall', 'thru-program:75603645', 'tn_multicall_program_c', abi('tn_multicall')),
  program('abi_manager', 'thru-program:17187266', 'tn_abi_manager_program_c', abi('tn_abi_manager_program')),
  program('token', 'thru-program:1023374292', 'tn_token_program_rust', abi('tn_token_program', undefined, ['rpc/cli/crates/thru-core/abi/tn_token_program.abi.yaml'])),
  app('amm', 'thru-program:4614050', 'tn_amm_program_c', abi('tn_amm_program'), 'amm-authority'),
  app('clob', 'thru-program:79287062', 'tn_clob_program', abi('tn_clob_program'), 'clob-authority'),
  app('thru_registrar', 'thru-program:449594', 'tn_thru_registrar_program_c', abi('tn_thru_registrar_program'), 'registrar-authority'),
  program('wthru', 'thru-program:170806538', 'tn_wthru_program_c', abi('tn_wthru_program')),
  app('wallet', 'thru-program:1746189', 'tn_wallet_program_rust', abi('tn_wallet'), 'wallet-authority'),
  app('nft', 'thru-program:1654635', 'tn_nft_program_c', abi('tn_nft_program'), 'nft-authority'),
  program('block_producer', 'thru-program:1698028031', 'tn_block_producer_program_c', abi('tn_block_producer_program')),
  program('consensus_validator', 'thru-program:12467360', 'tn_consensus_validator_program_c', abi('tn_consensus_validator_program')),
  program('eoa', 'thru-program:142650', 'tn_eoa_program_c', abi('tn_eoa_program')),
  program('uploader', 'thru-program:191563656778', 'tn_uploader_program_c', abi('tn_uploader_program')),
  program('compression', 'thru-program:79012', 'tn_compression_program_c', abi('compression', 'web/packages/programs/src/compression/compression.abi.yaml')),
  program('multisig', 'thru-program:43791523', 'tn_multisig_program_c', abi('multisig')),
  /* UNTO-3561: owns the absent-block-producer fee receiver; withdrawals by
     the native-token-vault-authority multisig. */
  program('native_token_vault', 'thru-program:2904762572', 'tn_native_token_vault_program_c', abi('tn_native_token_vault_program')),
] as const;
export type CanonicalProgramName = typeof CANONICAL_PROGRAMS[number]['name'];
/** The 15 programs genesis installs (Core A, Core B, Feature Gate and the
 * twelve Core-managed system programs, including noop and the Native Token
 * Vault). */
export const GENESIS_PROGRAMS: readonly ProgramRecord[] = CANONICAL_PROGRAMS.filter((record) => record.parent !== 'public' && record.placement !== 'core_bootstrap');
/** Core A-managed programs created after genesis by `bootstrap programs create`
 * (the Public Manager). */
export const CORE_BOOTSTRAP_PROGRAMS: readonly ProgramRecord[] = CANONICAL_PROGRAMS.filter((record) => record.placement === 'core_bootstrap');
/** The eight applications deployed after genesis under the Public program manager. */
export const PUBLIC_PROGRAMS: readonly ProgramRecord[] = CANONICAL_PROGRAMS.filter((record) => record.parent === 'public');
export const BUILD_ONLY_ABIS: readonly PreparedAbi[] = [
  abi('account_meta'), abi('state_proof'), abi('tn_nft_market_program'),
  abi('tn_perp_program', 'thru-perps/abi/tn_perp_program.abi.yaml'),
];
/** Core A and Core B share the Core ABI source; prepare each output once. */
export const PREPARED_ABIS: readonly PreparedAbi[] = [
  ...CANONICAL_PROGRAMS.flatMap((record) => record.abi ? [record.abi] : []), ...BUILD_ONLY_ABIS,
].filter((descriptor, index, all) => all.findIndex((other) => other.output === descriptor.output) === index);
const fixture = (name: string, seed: string, binary: string): ProgramRecord => ({
  ...program(name, seed, binary, null), overlay: 'e2e',
});
export const E2E_PROGRAMS: readonly ProgramRecord[] = [
  fixture('test_uploader', 'e2e:test-uploader', 'tn_test_uploader_program_c'),
  fixture('event_emission', 'e2e:event-emission', 'tn_event_emission_program_c'),
  fixture('event_invoke', 'e2e:event-invoke', 'tn_event_emission_program_c'),
  fixture('heap_manip', 'e2e:heap-manip', 'tn_heap_manip_program_c'),
  fixture('fibonacci', 'e2e:fibonacci', 'tn_fibonacci_program_c'),
  fixture('debug_primary', 'e2e:debug-primary', 'tn_debug_test_program_c'),
  fixture('debug_secondary', 'e2e:debug-secondary', 'tn_debug_test_program_c'),
];
/** Stable serialization shared by the address generator and semantic preflight. */
export const REGISTRY_IDENTITY = JSON.stringify({
  validation_policy_version: VALIDATION_POLICY_VERSION,
  canonical: CANONICAL_PROGRAMS, overlays: E2E_PROGRAMS, buildOnly: BUILD_ONLY_ABIS,
});
