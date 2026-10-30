import { describe, expect, it } from 'vitest';
import { measureWalletRequest } from './wallet';
import { Pubkey } from '../../domain/primitives';
import type { WalletCompressionOptions } from './types';

const address = (value: number) => Pubkey.from(new Uint8Array(32).fill(value)).toThruFmt();

describe('wallet program address compatibility', () => {
  it.each([
    [{ wallet: address(8), passkeyManager: address(9) }, address(8)],
    [{ passkeyManager: address(9) }, address(9)],
  ])('prefers wallet and accepts the deprecated option', async (programAddresses, expected) => {
    const options: WalletCompressionOptions = {
      programAddresses,
      feePayer: { publicKey: address(1) },
      walletAddress: address(2),
      signTransaction: async () => '',
    };
    // The selected wallet program occupies the root program account at index 1.
    await measureWalletRequest({
      program: address(3), readWrite: [], stateUnits: 0, computeUnits: 0,
      instructionData: context => {
        expect(context.getAccountIndex(expected)).toBe(1);
        return new Uint8Array();
      },
    }, options);
  });
});
