import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { deriveManagedProgramAddresses, MANAGER_PROGRAM_PUBKEY, MANAGER_PROGRAM_ADDRESS, MANAGER_PROGRAM_SEED, ROOT_MANAGER_PROGRAM_ADDRESS } from '../manager';
import { UPLOADER_PROGRAM_SEED, UPLOADER_PROGRAM_ADDRESS } from '../uploader';
import {
  BOOTSTRAP_PROGRAM_ADDRESSES,
  BOOTSTRAP_PROGRAM_SEEDS,
  CREDITS_MINT_ADDRESS,
  CREDITS_MINT_AUTHORITY_ADDRESS,
  CREDITS_MINT_SEED_HEX,
} from './index';
import { createThruClient } from '@thru/sdk/client';
import { deriveMintAddress } from '../token';

const EXPECTED_ADDRESSES = {
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
  passkey_manager: 'taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA',
  nft: 'taNFTjOaeDBSPHNf0LVRWAkF4raUFQgrz0EQIgJd60ENb5',
  block_producer: 'taBPUH9m3CXZcBQyCrTmclHtltipiPelIHzdAf8QdIDvnt',
  consensus_validator: 'taCONStGMCE1RJ9ttceyt0FZhYapGJ7zzBuCE5qqYdLhaF',
} as const;

describe('bootstrap-managed program addresses', () => {
  it('pins the root, approved main Manager and Uploader derivations', () => {
    expect(ROOT_MANAGER_PROGRAM_ADDRESS).toBe('taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB');
    expect(deriveManagedProgramAddresses(MANAGER_PROGRAM_SEED, false, ROOT_MANAGER_PROGRAM_ADDRESS).programAccountAddress)
      .toBe('taMGRmPoSTkUtF6UlmCIq58K8OYsnXshOMPdobxxHytqmu');
    expect(MANAGER_PROGRAM_ADDRESS).toBe('taMGRmPoSTkUtF6UlmCIq58K8OYsnXshOMPdobxxHytqmu');
    expect(deriveManagedProgramAddresses(UPLOADER_PROGRAM_SEED).programAccountAddress).toBe(UPLOADER_PROGRAM_ADDRESS);
    expect(UPLOADER_PROGRAM_ADDRESS).toBe('taUPLMH5QYOAT4ktwQeO7DXAEKtqBhYehalNGf5BJFQDYq');
  });
  it('matches all fifteen approved fresh-network vanity addresses', () => {
    expect(BOOTSTRAP_PROGRAM_ADDRESSES).toEqual(EXPECTED_ADDRESSES);
  });

  it('pins the NFT seed, metadata, raw executable, and requested presentation', () => {
    expect(BOOTSTRAP_PROGRAM_SEEDS.nft).toBe('thru-program:1654635');
    const padded = Buffer.alloc(32);
    padded.write(BOOTSTRAP_PROGRAM_SEEDS.nft);
    expect(padded.toString('hex')).toBe(
      '746872752d70726f6772616d3a31363534363335000000000000000000000000',
    );
    const nft = deriveManagedProgramAddresses(BOOTSTRAP_PROGRAM_SEEDS.nft, false);
    expect(nft.programMetaAccountAddress).toBe(
      'taIclvuHJiNtJxssqjw42tsrWMc5Kb7Rteeta4E4YOfOaE',
    );
    expect(Buffer.from(nft.programAccountBytes).toString('hex')).toBe(
      '3454e339a7830523c735fd0b551580905e2b69415082bcf411022025deb410d6',
    );
    expect(nft.programAccountAddress).toMatch(/^taNFTj[A-Za-z0-9]+$/);
  });

  it('derives every address from its permanent bootstrap seed', () => {
    for (const name of Object.keys(BOOTSTRAP_PROGRAM_SEEDS) as Array<
      keyof typeof BOOTSTRAP_PROGRAM_SEEDS
    >) {
      expect(
        deriveManagedProgramAddresses(BOOTSTRAP_PROGRAM_SEEDS[name])
          .programAccountAddress,
      ).toBe(BOOTSTRAP_PROGRAM_ADDRESSES[name]);
    }
  });

  it('independently derives permanent executable addresses and their checksums', () => {
    const manager = MANAGER_PROGRAM_PUBKEY;
    const derive = (seed: Uint8Array) => createHash('sha256')
      .update(manager).update(Uint8Array.of(0)).update(seed).digest();
    const seeds = Object.values(BOOTSTRAP_PROGRAM_SEEDS);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(new Set(Object.values(EXPECTED_ADDRESSES)).size).toBe(seeds.length);
    for (const name of Object.keys(BOOTSTRAP_PROGRAM_SEEDS) as Array<
      keyof typeof BOOTSTRAP_PROGRAM_SEEDS
    >) {
      const seed = Buffer.from(BOOTSTRAP_PROGRAM_SEEDS[name], 'utf8');
      expect(seed.length).toBeGreaterThan(0);
      expect(seed.length).toBeLessThanOrEqual(32);
      const padded = Buffer.alloc(32);
      seed.copy(padded);
      const executable = derive(derive(padded));
      const checksum = executable.reduce((sum, byte) => sum + byte, 0) & 0xff;
      const address = 'ta' + Buffer.concat([executable, Buffer.from([checksum])])
        .toString('base64url');
      expect(address).toBe(EXPECTED_ADDRESSES[name]);
    }
  });

  it('derives the approved Alphanet THRUSD mint with the wallet setup default', () => {
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
