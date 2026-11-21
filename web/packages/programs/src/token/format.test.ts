import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createThruClient } from '@thru/sdk/client';
import { BOOTSTRAP_PROGRAM_ADDRESSES, CREDITS_MINT_AUTHORITY_ADDRESS, CREDITS_MINT_SEED_HEX } from '../bootstrap-addresses';
import { bytesToHex, hexToBytes } from './format';
import { deriveMintAddress } from './derivation';
import { hexToBytes as initializeMintHexToBytes } from './instructions/initialize-mint';

/* `parseInt` returns NaN for a non-hex pair and NaN assigned into a
   Uint8Array becomes 0, so an unchecked decoder maps a typo to 0x00.  A seed
   (deriveMintAddress, initialize_mint's seedHex) would then derive a
   different, valid-looking address nobody controls. */
describe('strict hex decoding', () => {
  it('decodes valid hex, with and without 0x', () => {
    expect([...hexToBytes('deadBEEF')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...hexToBytes('0xdeadBEEF')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...hexToBytes('')]).toEqual([]);
    expect([...hexToBytes('0x')]).toEqual([]);
    expect(bytesToHex(hexToBytes('00ff'))).toBe('00ff');
  });

  it('rejects odd lengths and non-hex characters instead of mapping them to 0x00', () => {
    for (const bad of ['abc', 'zz', '0x0g', 'de ad', '0y', 'deadbee']) {
      expect(() => hexToBytes(bad)).toThrow();
      expect(() => initializeMintHexToBytes(bad)).toThrow();
    }
    expect(() => hexToBytes('zz')).toThrow('invalid characters');
    expect(() => initializeMintHexToBytes('zz')).toThrow('invalid characters');
  });

  it('refuses a mistyped mint seed rather than deriving another address', () => {
    const thru = createThruClient({ baseUrl: 'https://rpc.test' });
    const authority = CREDITS_MINT_AUTHORITY_ADDRESS;
    const tokenProgram = BOOTSTRAP_PROGRAM_ADDRESSES.token;
    const seed = CREDITS_MINT_SEED_HEX;
    expect(createHash('sha256').update('thru:credits:app-wide-mint:v1').digest('hex')).toBe(seed);
    /* The good seed still derives an address. */
    expect(deriveMintAddress(thru, authority, seed, tokenProgram).address).toMatch(/^ta/);
    /* One typo (z for a) used to decode to 0x00 and derive a different mint. */
    const mistyped = seed.replace(/[0-9a-f]/, 'z');
    expect(mistyped).not.toBe(seed);
    expect(() => deriveMintAddress(thru, authority, mistyped, tokenProgram)).toThrow('invalid characters');
  });
});
