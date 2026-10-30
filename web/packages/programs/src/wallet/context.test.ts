import { describe, expect, it } from 'vitest';
import { encodeAddress } from '@thru/sdk/helpers';
import {
  assertWalletFeePayerCompatible,
  buildAccountContext,
  buildWalletAccountContext,
} from './context';

function account(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

describe('buildWalletAccountContext', () => {
  it('matches concrete account indices for any non-colliding fee payer', () => {
    const wallet = account(10);
    const writable = account(20);
    const targetProgram = account(30);
    const mint = account(40);
    const wrapperProgram = encodeAddress(account(50));
    const params = {
      walletAddress: encodeAddress(wallet),
      readWriteAccounts: [writable],
      readOnlyAccounts: [targetProgram, mint],
      programAddress: wrapperProgram,
    };
    const deferred = buildWalletAccountContext(params);

    for (const feePayer of [account(1), account(2)]) {
      const concrete = buildAccountContext({
        ...params,
        feePayerAddress: encodeAddress(feePayer),
      });
      expect(deferred.readWriteAddresses).toEqual(concrete.readWriteAddresses);
      expect(deferred.readOnlyAddresses).toEqual(concrete.readOnlyAddresses);
      expect(deferred.walletAccountIdx).toBe(concrete.walletAccountIdx);
      for (const target of [wallet, writable, targetProgram, mint]) {
        expect(deferred.getAccountIndex(target)).toBe(concrete.getAccountIndex(target));
      }
    }
  });

  it('rejects a fee payer that overlaps any encoded instruction account', () => {
    const wallet = account(10);
    const writable = account(20);
    const targetProgram = account(30);
    const mint = account(40);
    const params = {
      walletAddress: encodeAddress(wallet),
      readWriteAccounts: [writable],
      readOnlyAccounts: [targetProgram, mint],
      programAddress: encodeAddress(account(50)),
    };

    for (const collision of [wallet, writable, targetProgram, mint, account(50)]) {
      expect(() =>
        assertWalletFeePayerCompatible({
          ...params,
          feePayerAddress: encodeAddress(collision),
        })
      ).toThrow('Wallet fee payer must not overlap instruction accounts');
    }
  });
});
