import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { deriveManagedProgramAddresses, MANAGER_PROGRAM_ADDRESS, MANAGER_PROGRAM_SEED } from '../manager';
import { UPLOADER_PROGRAM_SEED, UPLOADER_PROGRAM_ADDRESS } from '../uploader';
import {
  BOOTSTRAP_PROGRAM_ADDRESSES,
  BOOTSTRAP_PROGRAM_SEEDS,
  BOOTSTRAP_PROGRAM_PAIRS,
  BOOTSTRAP_ABI_ADDRESSES,
  BOOTSTRAP_STATE_ADDRESSES,
  CANONICAL_PROGRAMS,
  PREPARED_ABIS,
  E2E_PROGRAMS,
  E2E_PROGRAM_PAIRS,
  CORE_MANAGER_PROGRAM_ADDRESS,
  CREDITS_MINT_ADDRESS,
  CREDITS_MINT_AUTHORITY_ADDRESS,
  CREDITS_MINT_SEED_HEX,
  CORE_BOOTSTRAP_PROGRAMS,
  GENESIS_PROGRAMS,
  PUBLIC_PROGRAMS,
  PUBLIC_PROGRAM_AUTHORITY_ADDRESSES,
} from './index';
import { deriveProgramAddress } from '@thru/sdk';
import { Pubkey } from '@thru/sdk';
import { createThruClient } from '@thru/sdk/client';
import { deriveMintAddress } from '../token';

/** Pre-Core Public-era addresses. The eight applications deployed after
 * genesis (UNTO-3561) return to theirs; every Core-managed program moved. */
const PUBLIC_APPLICATIONS = ['faucet', 'name_service', 'oracle', 'amm', 'clob', 'thru_registrar', 'wallet', 'nft'] as const;
const HISTORICAL_PUBLIC_ADDRESSES = {
  noop: 'taNOOPV4A7S3WTsirr149To2GoGZ9q8zllQaBrbekHfkJT',
  faucet: 'taFCTxR0y2eabGGaEdtTwC9pHz7ZY4CYD7FOiBFUJeAW16',
  name_service: 'taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG',
  oracle: 'taORCLOkTSYq5enR2XOGoSDmzMc0P5NlqjP8nKpfd3vgps',
  multicall: 'taMULTIrOL8WpIFr16C1ECsO60qAsuwmwJephZHDOTvSeP',
  abi_manager: 'taABII8WXcPaPIt47cXjOBbyoBUGBDXznAMHorVMeok3mw',
  token: 'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE',
  amm: 'taAMMx8gG44RcOyRqNYZ55pDaAJoGS0R8kPYxBN96sO8kD',
  clob: 'taCLOBcFk1PT8JTHQM1LzsyK6HLv1YkSJKZ2ZyIxo8fiTe',
  thru_registrar: 'taREGMtyyVIMr27zDpvN0aRiSS2aOVffM9cZCsc0Xomaxw',
  wthru: 'taWTHRUBelpONhTRjYc7n4OovodUsUtZKTIuREWAi9G9lm',
  wallet: 'taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA',
  nft: 'taNFTjOaeDBSPHNf0LVRWAkF4raUFQgrz0EQIgJd60ENb5',
  block_producer: 'taBPUH9m3CXZcBQyCrTmclHtltipiPelIHzdAf8QdIDvnt',
  consensus_validator: 'taCONStGMCE1RJ9ttceyt0FZhYapGJ7zzBuCE5qqYdLhaF',
  eoa: 'taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr',
  uploader: 'taUPLMH5QYOAT4ktwQeO7DXAEKtqBhYehalNGf5BJFQDYq',
  compression: 'taRB54_92jNbBdcmt2jus88F-xrOSne1GR9mmyOh4RidAK',
} as const;

describe('bootstrap-managed program addresses', () => {
  it('keeps unrelated wallet aliases non-enumerable', () => {
    expect(BOOTSTRAP_PROGRAM_SEEDS.passkey_manager).toBe(BOOTSTRAP_PROGRAM_SEEDS.wallet);
    expect(BOOTSTRAP_PROGRAM_ADDRESSES.passkey_manager).toBe(BOOTSTRAP_PROGRAM_ADDRESSES.wallet);
    expect(Object.keys(BOOTSTRAP_PROGRAM_SEEDS)).not.toContain('passkey_manager');
    expect(Object.keys(BOOTSTRAP_PROGRAM_ADDRESSES)).not.toContain('passkey_manager');
  });

  it('preserves Public identity and the arbitrary deployment default', () => {
    expect(CORE_MANAGER_PROGRAM_ADDRESS).toBe('taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB');
    expect(deriveManagedProgramAddresses(MANAGER_PROGRAM_SEED, false, CORE_MANAGER_PROGRAM_ADDRESS).programAccountAddress)
      .toBe('taMGRmPoSTkUtF6UlmCIq58K8OYsnXshOMPdobxxHytqmu');
    expect(BOOTSTRAP_PROGRAM_ADDRESSES.public_manager).toBe(MANAGER_PROGRAM_ADDRESS);
    expect(deriveManagedProgramAddresses('ordinary-user-program')).toEqual(
      deriveManagedProgramAddresses('ordinary-user-program', false, MANAGER_PROGRAM_ADDRESS),
    );
    expect(deriveManagedProgramAddresses(UPLOADER_PROGRAM_SEED, false, CORE_MANAGER_PROGRAM_ADDRESS).programAccountAddress)
      .toBe(UPLOADER_PROGRAM_ADDRESS);
  });

  it('contains exactly 24 canonical programs, 23 official ABIs and seven isolated fixtures', () => {
    expect(CANONICAL_PROGRAMS).toHaveLength(24);
    expect(Object.keys(BOOTSTRAP_PROGRAM_ADDRESSES)).toHaveLength(24);
    expect(Object.keys(BOOTSTRAP_ABI_ADDRESSES)).toHaveLength(23);
    // Native Token Vault (UNTO-3561): Core-managed genesis program, vanity seed.
    expect(BOOTSTRAP_PROGRAM_SEEDS.native_token_vault).toBe('thru-program:2904762572');
    expect(BOOTSTRAP_PROGRAM_ADDRESSES.native_token_vault).toBe('taVAULTGNf6TnaGDjzW_lEj1Oc11O0Lb5xGcxithvOgnrj');
    expect(CANONICAL_PROGRAMS.filter((entry) => !entry.abi).map((entry) => entry.name)).toEqual(['feature_gate']);
    expect(E2E_PROGRAMS).toHaveLength(7);
    // Core B (UNTO-3561): an ordinary Core A pair that shares Core A's ABI document.
    const peer = CANONICAL_PROGRAMS.find((entry) => entry.name === 'core_peer_manager')!;
    expect(peer).toMatchObject({ seed: 'thru-core-peer:v1', parent: 'core', placement: 'core_peer_manager', binary: 'build/thruvm/bin/tn_core_manager_program_c.bin' });
    expect(peer.abi).toEqual(CANONICAL_PROGRAMS.find((entry) => entry.name === 'core_manager')!.abi);
    expect(BOOTSTRAP_PROGRAM_PAIRS.core_peer_manager).toEqual(deriveManagedProgramAddresses('thru-core-peer:v1', false, CORE_MANAGER_PROGRAM_ADDRESS));
    expect(PREPARED_ABIS.filter((descriptor) => descriptor.output.endsWith('/core_manager.abi.yaml'))).toHaveLength(1);
    const accounts = new Set<string>();
    for (const pair of [...Object.values(BOOTSTRAP_PROGRAM_PAIRS), ...Object.values(E2E_PROGRAM_PAIRS)]) {
      for (const address of [pair.programAccountAddress, pair.programMetaAccountAddress]) {
        if (address === null) continue;
        expect(accounts.has(address)).toBe(false);
        accounts.add(address);
      }
    }
    for (const pair of Object.values(BOOTSTRAP_ABI_ADDRESSES)) {
      for (const address of [pair.abiAccountAddress, pair.abiMetaAccountAddress]) {
        expect(accounts.has(address)).toBe(false);
        accounts.add(address);
      }
    }
    for (const address of Object.values(BOOTSTRAP_STATE_ADDRESSES)) expect(accounts.has(address)).toBe(false);
  });

  it('keeps exactly 15 genesis programs, creates the Public Manager in bootstrap and moves eight applications to Public', () => {
    expect(GENESIS_PROGRAMS.map((entry) => entry.name)).toEqual([
      'core_manager', 'core_peer_manager', 'feature_gate', 'noop', 'multicall', 'abi_manager', 'token',
      'wthru', 'block_producer', 'consensus_validator', 'eoa', 'uploader', 'compression', 'multisig', 'native_token_vault',
    ]);
    expect(CORE_BOOTSTRAP_PROGRAMS.map((entry) => entry.name)).toEqual(['public_manager']);
    expect(CORE_BOOTSTRAP_PROGRAMS[0]).toMatchObject({ parent: 'core', placement: 'core_bootstrap', pinExecutable: true, pinMetadata: true });
    // Same seed under Core A: the Public Manager keeps its address.
    expect(BOOTSTRAP_PROGRAM_ADDRESSES.public_manager).toBe(MANAGER_PROGRAM_ADDRESS);
    expect(PUBLIC_PROGRAMS.map((entry) => [entry.name, entry.programAuthority])).toEqual([
      ['faucet', 'faucet-authority'], ['name_service', 'name-service-authority'],
      ['oracle', 'oracle-authority'], ['amm', 'amm-authority'], ['clob', 'clob-authority'],
      ['thru_registrar', 'registrar-authority'], ['wallet', 'wallet-authority'], ['nft', 'nft-authority'],
    ]);
    for (const record of PUBLIC_PROGRAMS) {
      expect(record).toMatchObject({ parent: 'public', placement: 'public_programs', pinExecutable: false, pinMetadata: false });
      expect(BOOTSTRAP_PROGRAM_PAIRS[record.name as keyof typeof BOOTSTRAP_PROGRAM_PAIRS])
        .toEqual(deriveManagedProgramAddresses(record.seed!, false, MANAGER_PROGRAM_ADDRESS));
      const authority = PUBLIC_PROGRAM_AUTHORITY_ADDRESSES[record.name]!;
      const seed = new Uint8Array(32); seed.set(new TextEncoder().encode(`${record.programAuthority}:v1`));
      expect(authority).toEqual({ name: record.programAuthority, seed: `${record.programAuthority}:v1`,
        address: deriveProgramAddress({ programAddress: BOOTSTRAP_PROGRAM_ADDRESSES.multisig, seed }).address });
    }
    for (const record of GENESIS_PROGRAMS) {
      expect(record.pinExecutable).toBe(true);
      expect(record.pinMetadata).toBe(record.seed !== null);
    }
  });

  it('independently derives Core-owned and Public-owned pairs without changing existing seeds', () => {
    const derive = (parent: string, seed: Uint8Array) => createHash('sha256')
      .update(Pubkey.from(parent).toBytes()).update(Uint8Array.of(0)).update(seed).digest();
    for (const record of [...CANONICAL_PROGRAMS, ...E2E_PROGRAMS]) {
      if (record.seed === null) {
        expect(record.parent).toBe('core_peer');
        continue;
      }
      const seed = Buffer.alloc(32);
      expect(Buffer.byteLength(record.seed)).toBeLessThanOrEqual(seed.length);
      seed.write(record.seed);
      const parent = record.parent === 'public' ? MANAGER_PROGRAM_ADDRESS : CORE_MANAGER_PROGRAM_ADDRESS;
      const metadata = derive(parent, seed);
      const executable = derive(parent, metadata);
      const pair = record.overlay
        ? E2E_PROGRAM_PAIRS[record.name]
        : BOOTSTRAP_PROGRAM_PAIRS[record.name as keyof typeof BOOTSTRAP_PROGRAM_PAIRS];
      expect(Pubkey.from(executable).toThruFmt()).toBe(pair.programAccountAddress);
      expect(Pubkey.from(metadata).toThruFmt()).toBe(pair.programMetaAccountAddress);
      if (record.parent === 'public') continue;
      expect(record.parent).toBe('core');
      expect(record.pinExecutable).toBe(true);
      expect(record.pinMetadata).toBe(true);
    }
    for (const [name, previous] of Object.entries(HISTORICAL_PUBLIC_ADDRESSES)) {
      const current = BOOTSTRAP_PROGRAM_ADDRESSES[name as keyof typeof HISTORICAL_PUBLIC_ADDRESSES];
      if ((PUBLIC_APPLICATIONS as readonly string[]).includes(name)) expect(current).toBe(previous);
      else expect(current).not.toBe(previous);
    }
    expect(BOOTSTRAP_PROGRAM_SEEDS.nft).toBe('thru-program:1654635');
    expect(BOOTSTRAP_PROGRAM_ADDRESSES.noop).toBe('taNOOP7zyQMAKczxK6lbJcGzHDsfe5A_QNZY-uObL99Rx8');
    expect(BOOTSTRAP_PROGRAM_SEEDS.multisig).toBe('thru-program:43791523');
  });

  it('derives the approved Alphanet UUSD mint with the wallet setup default', () => {
    const client = createThruClient({ baseUrl: 'https://rpc.test' });
    expect(createHash('sha256').update('thru:credits:app-wide-mint:v1').digest('hex'))
      .toBe(CREDITS_MINT_SEED_HEX);
    expect(
      deriveMintAddress(
        client,
        CREDITS_MINT_AUTHORITY_ADDRESS,
        CREDITS_MINT_SEED_HEX,
        BOOTSTRAP_PROGRAM_ADDRESSES.token,
      ).address,
    ).toBe(CREDITS_MINT_ADDRESS);
  });
});
