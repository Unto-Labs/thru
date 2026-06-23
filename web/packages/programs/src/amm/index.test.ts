import { describe, expect, it } from 'vitest';
import { Pubkey, deriveAddress, deriveProgramAddress } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import {
  AMM_PROGRAM_ADDRESS,
  AMM_INSTRUCTION_ADD_LIQUIDITY,
  AMM_INSTRUCTION_INIT_POOL,
  AMM_INSTRUCTION_SWAP,
  AMM_POOL_METADATA_SIZE,
  createAddLiquidityInstruction,
  createInitPoolInstruction,
  createSwapInstruction,
  deriveAmmPoolAddresses,
  parseAmmPoolMetadata,
  quoteAmmSwapExactIn,
  sortAmmMints,
} from './index';

const thru = {
  helpers: {
    deriveAddress,
    deriveProgramAddress,
  },
} as unknown as Thru;

function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  return bytes;
}

function context(indexes: Record<string, number>) {
  return {
    getAccountIndex(pubkey: Uint8Array): number {
      const index = indexes[bytesToHex(pubkey)];
      if (index === undefined) throw new Error(`missing account ${bytesToHex(pubkey)}`);
      return index;
    },
  };
}

function writeU64(target: Uint8Array, offset: number, value: bigint): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength)
    .setBigUint64(offset, value, true);
}

describe('amm helpers', () => {
  it('exports the standardized AMM program address', () => {
    expect(AMM_PROGRAM_ADDRESS).toBe(
      deriveProgramAddress({
        programAddress: 'taNz_xi2ZJcAkg3nIbD0Tgy6-P4ckJGUUwLQPPqobPQbsc',
        seed: 'amm',
      }).address
    );
  });

  it('sorts mint addresses lexicographically', () => {
    const sorted = sortAmmMints(key(9), key(2));
    expect(sorted.inputOrder).toBe('swapped');
    expect(sorted.mintOneBytes[0]).toBe(2);
    expect(sorted.mintTwoBytes[0]).toBe(9);
  });

  it('derives pool, LP mint, and vault addresses deterministically', () => {
    const addresses = deriveAmmPoolAddresses(thru, {
      ammProgramAddress: deriveProgramAddress({
        programAddress: key(1),
        seed: key(2),
      }).address,
      mintAAddress: deriveProgramAddress({
        programAddress: key(5),
        seed: key(6),
      }).address,
      mintBAddress: deriveProgramAddress({
        programAddress: key(7),
        seed: key(8),
      }).address,
      swapFeeBps: 30,
    });

    const again = deriveAmmPoolAddresses(thru, {
      ammProgramAddress: deriveProgramAddress({
        programAddress: key(1),
        seed: key(2),
      }).address,
      mintAAddress: deriveProgramAddress({
        programAddress: key(5),
        seed: key(6),
      }).address,
      mintBAddress: deriveProgramAddress({
        programAddress: key(7),
        seed: key(8),
      }).address,
      swapFeeBps: 30,
    });

    expect(addresses.poolAddress).toBe(again.poolAddress);
    expect(addresses.lpMintSeed).toEqual(again.lpMintSeed);
    expect(addresses.vaultOneSeed[0]).toBe(1);
    expect(addresses.vaultTwoSeed[0]).toBe(2);
  });

  it('packs init_pool as the C header layout', async () => {
    const seed = new Uint8Array(32).fill(0xaa);
    const poolProof = new Uint8Array([0x10, 0x11]);
    const lpProof = new Uint8Array([0x20]);
    const vaultOneProof = new Uint8Array([0x30, 0x31, 0x32]);
    const vaultTwoProof = new Uint8Array([0x40]);
    const accounts = {
      payer: key(1),
      pool: key(2),
      lpMint: key(3),
      vaultOne: key(4),
      vaultTwo: key(5),
      mintOne: key(6),
      mintTwo: key(7),
      tokenProgram: key(8),
    };
    const instruction = await createInitPoolInstruction({
      payerAccountBytes: accounts.payer,
      poolAccountBytes: accounts.pool,
      lpMintAccountBytes: accounts.lpMint,
      vaultOneAccountBytes: accounts.vaultOne,
      vaultTwoAccountBytes: accounts.vaultTwo,
      mintOneAccountBytes: accounts.mintOne,
      mintTwoAccountBytes: accounts.mintTwo,
      tokenProgramAccountBytes: accounts.tokenProgram,
      swapFeeBps: 30,
      lpMintSeed: seed,
      poolStateProof: poolProof,
      lpMintStateProof: lpProof,
      vaultOneStateProof: vaultOneProof,
      vaultTwoStateProof: vaultTwoProof,
    })(context({
      [bytesToHex(accounts.payer)]: 0,
      [bytesToHex(accounts.pool)]: 2,
      [bytesToHex(accounts.lpMint)]: 3,
      [bytesToHex(accounts.vaultOne)]: 4,
      [bytesToHex(accounts.vaultTwo)]: 5,
      [bytesToHex(accounts.mintOne)]: 6,
      [bytesToHex(accounts.mintTwo)]: 7,
      [bytesToHex(accounts.tokenProgram)]: 8,
    }));

    expect(instruction.length).toBe(4 + 82 + 7);
    expect(Array.from(instruction.slice(0, 22))).toEqual([
      AMM_INSTRUCTION_INIT_POOL, 0, 0, 0,
      0, 0,
      2, 0,
      3, 0,
      4, 0,
      5, 0,
      6, 0,
      7, 0,
      8, 0,
      30, 0,
    ]);
    expect(instruction.slice(22, 54)).toEqual(seed);
    expect(Array.from(instruction.slice(54, 86))).toEqual([
      2, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      3, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(Array.from(instruction.slice(86))).toEqual([
      ...poolProof,
      ...lpProof,
      ...vaultOneProof,
      ...vaultTwoProof,
    ]);
  });

  it('packs add_liquidity and swap instructions', async () => {
    const accounts = Array.from({ length: 10 }, (_, idx) => key(idx + 1));
    const indexes = Object.fromEntries(accounts.map((account, idx) => [bytesToHex(account), idx + 2]));
    const addLiquidity = await createAddLiquidityInstruction({
      poolAccountBytes: accounts[0],
      depositorAccountBytes: accounts[1],
      depositorTokenOneAccountBytes: accounts[2],
      depositorTokenTwoAccountBytes: accounts[3],
      depositorLpAccountBytes: accounts[4],
      vaultOneAccountBytes: accounts[5],
      vaultTwoAccountBytes: accounts[6],
      lpMintAccountBytes: accounts[7],
      tokenProgramAccountBytes: accounts[8],
      maxAmountMintOne: 5_000_000n,
      maxAmountMintTwo: 10_000_000n,
    })(context(indexes));
    const swap = await createSwapInstruction({
      poolAccountBytes: accounts[0],
      userTransferAuthorityBytes: accounts[1],
      userInputAccountBytes: accounts[2],
      userOutputAccountBytes: accounts[3],
      vaultInputAccountBytes: accounts[4],
      vaultOutputAccountBytes: accounts[5],
      lpMintAccountBytes: accounts[6],
      tokenProgramAccountBytes: accounts[7],
      amountIn: 1_234_567n,
    })(context(indexes));

    expect(addLiquidity.length).toBe(38);
    expect(swap.length).toBe(28);
    expect(Array.from(addLiquidity.slice(0, 4))).toEqual([
      AMM_INSTRUCTION_ADD_LIQUIDITY, 0, 0, 0,
    ]);
    expect(Array.from(swap.slice(0, 4))).toEqual([
      AMM_INSTRUCTION_SWAP, 0, 0, 0,
    ]);
    expect(new DataView(addLiquidity.buffer).getBigUint64(22, true)).toBe(5_000_000n);
    expect(new DataView(addLiquidity.buffer).getBigUint64(30, true)).toBe(10_000_000n);
    expect(new DataView(swap.buffer).getBigUint64(20, true)).toBe(1_234_567n);
  });

  it('parses pool metadata', () => {
    const data = new Uint8Array(AMM_POOL_METADATA_SIZE);
    const view = new DataView(data.buffer);
    view.setUint8(0, 1);
    view.setBigUint64(1, 1_000_000_000n, true);
    view.setUint16(9, 30, true);
    data.set(key(11), 11);
    data.set(key(12), 43);
    data.set(key(13), 75);
    data.set(key(14), 107);
    data.set(key(15), 139);
    data.set(key(16), 171);

    const parsed = parseAmmPoolMetadata(data);
    expect(parsed.isInitialized).toBe(true);
    expect(parsed.lockedLpSupply).toBe(1_000_000_000n);
    expect(parsed.swapFeeBps).toBe(30);
    expect(parsed.swapPoolAuthority).toBe(encodeAddressForTest(key(11)));
    expect(parsed.lpMint).toBe(encodeAddressForTest(key(16)));
  });

  it('quotes exact-in swaps with fee math matching the C program', () => {
    const quote = quoteAmmSwapExactIn({
      amountIn: 10_000_000n,
      reserveIn: 1_000_000_000n,
      reserveOut: 10_000_000n,
      swapFeeBps: 30,
    });

    expect(quote.feeAmount).toBe(30_000n);
    expect(quote.amountInAfterFee).toBe(9_970_000n);
    expect(quote.amountOut).toBe(98_715n);
  });
});

function encodeAddressForTest(bytes: Uint8Array): string {
  return Pubkey.from(bytes).toThruFmt();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
