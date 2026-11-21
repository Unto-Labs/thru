import { describe, expect, it } from 'vitest';
import { Pubkey, deriveAddress, deriveProgramAddress } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../bootstrap-addresses';
import {
  AMM_PROGRAM_ADDRESS,
  AMM_INSTRUCTION_ADD_LIQUIDITY,
  AMM_INSTRUCTION_INIT_POOL,
  AMM_INSTRUCTION_SWAP,
  AMM_INSTRUCTION_WITHDRAW_LIQUIDITY,
  AmmInstruction,
  AMM_ACCOUNT_TYPE_POOL_V1,
  AMM_POOL_METADATA_SIZE,
  createAddLiquidityInstruction,
  createInitPoolInstruction,
  createSwapInstruction,
  createWithdrawLiquidityInstruction,
  deriveAmmPoolAddresses,
  deriveAmmVaultSeeds,
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

function buildStaticSeedForTest(value: number): Uint8Array {
  const seed = new Uint8Array(32);
  seed[0] = value;
  return seed;
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
    expect(AMM_PROGRAM_ADDRESS).toBe(BOOTSTRAP_PROGRAM_ADDRESSES.amm);
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
    expect(addresses.vaultOneSeed).toEqual(again.vaultOneSeed);
    expect(addresses.vaultTwoSeed).toEqual(again.vaultTwoSeed);
    // Vault seeds are bound to the pool address, not fixed 1-byte constants.
    expect(addresses.vaultOneSeed).toEqual(deriveAmmVaultSeeds(thru, addresses.poolBytes).vaultOneSeed);
    expect(addresses.vaultTwoSeed).toEqual(deriveAmmVaultSeeds(thru, addresses.poolBytes).vaultTwoSeed);
    expect(addresses.vaultOneSeed).not.toEqual(buildStaticSeedForTest(0x01));
    expect(addresses.vaultTwoSeed).not.toEqual(buildStaticSeedForTest(0x02));
  });

  it('derives distinct vault seeds for pools sharing a quote asset (WTHRU)', () => {
    // Simulates TOKEN_A/WTHRU and TOKEN_B/WTHRU, where WTHRU must not collide
    // on a shared vault token account.
    const ammProgramAddress = deriveProgramAddress({
      programAddress: key(1),
      seed: key(2),
    }).address;
    const wthru = deriveProgramAddress({
      programAddress: key(3),
      seed: key(4),
    }).address;
    const tokenA = deriveProgramAddress({
      programAddress: key(5),
      seed: key(6),
    }).address;
    const tokenB = deriveProgramAddress({
      programAddress: key(7),
      seed: key(8),
    }).address;

    const poolA = deriveAmmPoolAddresses(thru, {
      ammProgramAddress,
      mintAAddress: tokenA,
      mintBAddress: wthru,
      swapFeeBps: 30,
    });
    const poolB = deriveAmmPoolAddresses(thru, {
      ammProgramAddress,
      mintAAddress: tokenB,
      mintBAddress: wthru,
      swapFeeBps: 30,
    });

    expect(poolA.poolAddress).not.toBe(poolB.poolAddress);
    expect(poolA.vaultOneSeed).not.toEqual(poolB.vaultOneSeed);
    expect(poolA.vaultTwoSeed).not.toEqual(poolB.vaultTwoSeed);

    // The WTHRU side (mintTwo here) derives distinct vault seeds per pool.
    const wthruSeedA = poolA.mintTwoAddress === wthru ? poolA.vaultTwoSeed : poolA.vaultOneSeed;
    const wthruSeedB = poolB.mintTwoAddress === wthru ? poolB.vaultTwoSeed : poolB.vaultOneSeed;
    expect(wthruSeedA).not.toEqual(wthruSeedB);
  });

  /* The seed inequality above is a proxy; what actually collided is the vault
     token account.  Derive those the way the token program does —
     deriveProgramAddress(token, deriveAddress([owner = AMM, mint, seed])) —
     and assert the accounts differ for both vaults of two WTHRU pools. */
  it('derives distinct vault token accounts for pools sharing a quote asset', () => {
    const tokenProgramAddress = BOOTSTRAP_PROGRAM_ADDRESSES.token;
    const ammProgramAddress = deriveProgramAddress({
      programAddress: key(1),
      seed: key(2),
    }).address;
    const wthru = deriveProgramAddress({
      programAddress: key(3),
      seed: key(4),
    }).address;
    const tokenA = deriveProgramAddress({ programAddress: key(5), seed: key(6) }).address;
    const tokenB = deriveProgramAddress({ programAddress: key(7), seed: key(8) }).address;

    const vaultAccount = (mint: string, seed: Uint8Array): string => {
      const derivedSeed = deriveAddress([
        Pubkey.from(ammProgramAddress).toBytes(),
        Pubkey.from(mint).toBytes(),
        seed,
      ]).bytes;
      return deriveProgramAddress({ programAddress: tokenProgramAddress, seed: derivedSeed }).address;
    };

    const poolA = deriveAmmPoolAddresses(thru, { ammProgramAddress, mintAAddress: tokenA, mintBAddress: wthru, swapFeeBps: 30 });
    const poolB = deriveAmmPoolAddresses(thru, { ammProgramAddress, mintAAddress: tokenB, mintBAddress: wthru, swapFeeBps: 30 });

    /* Each vault account takes its own side's mint: vault one holds mint one, vault
       two holds mint two, after sortAmmMints.  Zipping them here keeps that pairing
       honest instead of deriving both vaults against the same mint. */
    const vaultsOf = (pool: ReturnType<typeof deriveAmmPoolAddresses>) => [
      { mint: pool.mintOneAddress, account: vaultAccount(pool.mintOneAddress, pool.vaultOneSeed) },
      { mint: pool.mintTwoAddress, account: vaultAccount(pool.mintTwoAddress, pool.vaultTwoSeed) },
    ];
    const vaultHolding = (pool: ReturnType<typeof deriveAmmPoolAddresses>, mint: string): string => {
      const vault = vaultsOf(pool).find((entry) => entry.mint === mint);
      if (!vault) throw new Error(`pool has no vault for ${mint}`);
      return vault.account;
    };

    // The collision this fix removes: both pools hold WTHRU, so both would have
    // derived the same WTHRU vault account under the static seeds.
    expect(vaultHolding(poolA, wthru)).not.toBe(vaultHolding(poolB, wthru));

    // And a pool's own two vaults must not alias each other, each against its real mint.
    const [vaultOne, vaultTwo] = vaultsOf(poolA);
    expect(vaultOne!.account).not.toBe(vaultTwo!.account);
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

  it('round-trips bounded instructions with the packed C wire layout', async () => {
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
      minLpOut: 4_000_000n,
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
      minAmountOut: 765_432n,
    })(context(indexes));
    const withdraw = await createWithdrawLiquidityInstruction({
      poolAccountBytes: accounts[0],
      withdrawerAccountBytes: accounts[1],
      withdrawerTokenOneAccountBytes: accounts[2],
      withdrawerTokenTwoAccountBytes: accounts[3],
      withdrawerLpAccountBytes: accounts[4],
      vaultOneAccountBytes: accounts[5],
      vaultTwoAccountBytes: accounts[6],
      lpMintAccountBytes: accounts[7],
      tokenProgramAccountBytes: accounts[8],
      lpAmount: 1_000n,
      minAmountOneOut: 222n,
      minAmountTwoOut: 333n,
    })(context(indexes));

    expect(addLiquidity.length).toBe(46);
    expect(swap.length).toBe(36);
    expect(withdraw.length).toBe(46);
    expect(Array.from(addLiquidity.slice(0, 4))).toEqual([
      AMM_INSTRUCTION_ADD_LIQUIDITY, 0, 0, 0,
    ]);
    expect(Array.from(swap.slice(0, 4))).toEqual([
      AMM_INSTRUCTION_SWAP, 0, 0, 0,
    ]);
    expect(Array.from(withdraw.slice(0, 4))).toEqual([
      AMM_INSTRUCTION_WITHDRAW_LIQUIDITY, 0, 0, 0,
    ]);
    expect(new DataView(addLiquidity.buffer).getBigUint64(22, true)).toBe(5_000_000n);
    expect(new DataView(addLiquidity.buffer).getBigUint64(30, true)).toBe(10_000_000n);
    expect(new DataView(swap.buffer).getBigUint64(20, true)).toBe(1_234_567n);
    expect(new DataView(addLiquidity.buffer).getBigUint64(38, true)).toBe(4_000_000n);
    expect(new DataView(swap.buffer).getBigUint64(28, true)).toBe(765_432n);
    expect(new DataView(withdraw.buffer).getBigUint64(22, true)).toBe(1_000n);
    expect(new DataView(withdraw.buffer).getBigUint64(30, true)).toBe(222n);
    expect(new DataView(withdraw.buffer).getBigUint64(38, true)).toBe(333n);
    expect(AmmInstruction.from_array(addLiquidity)?.payload().asAddLiquidity()?.min_lp_out)
      .toBe(4_000_000n);
    expect(AmmInstruction.from_array(swap)?.payload().asSwap()?.min_amount_out)
      .toBe(765_432n);
    const withdrawal = AmmInstruction.from_array(withdraw)?.payload().asWithdrawLiquidity();
    expect(withdrawal?.min_amount_one_out).toBe(222n);
    expect(withdrawal?.min_amount_two_out).toBe(333n);
    for (const [instruction, oldSize] of [[addLiquidity, 38], [swap, 28], [withdraw, 30]] as const) {
      expect(AmmInstruction.from_array(instruction.subarray(0, oldSize))).toBeNull();
    }
  });

  describe('minimum output input bounds', () => {
    const account = key(1);
    const args = {
      poolAccountBytes: account,
      depositorAccountBytes: account,
      depositorTokenOneAccountBytes: account,
      depositorTokenTwoAccountBytes: account,
      depositorLpAccountBytes: account,
      withdrawerAccountBytes: account,
      withdrawerTokenOneAccountBytes: account,
      withdrawerTokenTwoAccountBytes: account,
      withdrawerLpAccountBytes: account,
      userTransferAuthorityBytes: account,
      userInputAccountBytes: account,
      userOutputAccountBytes: account,
      vaultOneAccountBytes: account,
      vaultTwoAccountBytes: account,
      vaultInputAccountBytes: account,
      vaultOutputAccountBytes: account,
      lpMintAccountBytes: account,
      tokenProgramAccountBytes: account,
      maxAmountMintOne: 1n,
      maxAmountMintTwo: 1n,
      lpAmount: 1n,
      amountIn: 1n,
      minLpOut: 0n,
      minAmountOneOut: 0n,
      minAmountTwoOut: 0n,
      minAmountOut: 0n,
    };
    const lookup = context({ [bytesToHex(account)]: 0 });
    const bounds = [
      { create: createAddLiquidityInstruction, field: 'minLpOut', offset: 38 },
      { create: createWithdrawLiquidityInstruction, field: 'minAmountOneOut', offset: 30 },
      { create: createWithdrawLiquidityInstruction, field: 'minAmountTwoOut', offset: 38 },
      { create: createSwapInstruction, field: 'minAmountOut', offset: 28 },
    ] as const;

    it.each(bounds)('encodes zero and maximum u64 for $field without truncation', async ({ create, field, offset }) => {
      for (const minimum of [0n, 0xffffffffffffffffn]) {
        const data = await create({ ...args, [field]: minimum })(lookup);
        expect(new DataView(data.buffer).getBigUint64(offset, true)).toBe(minimum);
      }
    });

    it.each(bounds)('rejects missing and out-of-range $field', async ({ create, field }) => {
      for (const minimum of [undefined, -1n, 0x10000000000000000n]) {
        await expect(create({ ...args, [field]: minimum })(lookup)).rejects.toThrow(field);
      }
    });
  });

  it('parses pool metadata', () => {
    const data = new Uint8Array(AMM_POOL_METADATA_SIZE);
    expect(data).toHaveLength(204);
    const view = new DataView(data.buffer);
    view.setUint8(0, AMM_ACCOUNT_TYPE_POOL_V1);
    view.setUint8(1, 1);
    view.setBigUint64(2, 1_000_000_000n, true);
    view.setUint16(10, 30, true);
    data.set(key(11), 12);
    data.set(key(12), 44);
    data.set(key(13), 76);
    data.set(key(14), 108);
    data.set(key(15), 140);
    data.set(key(16), 172);

    const parsed = parseAmmPoolMetadata(data);
    expect(parsed.isInitialized).toBe(true);
    expect(parsed.lockedLpSupply).toBe(1_000_000_000n);
    expect(parsed.swapFeeBps).toBe(30);
    expect(parsed.swapPoolAuthority).toBe(encodeAddressForTest(key(11)));
    expect(parsed.lpMint).toBe(encodeAddressForTest(key(16)));

    expect(() => parseAmmPoolMetadata(data.subarray(0, 203))).toThrow('not an AMM pool account');
    data[0] = 2;
    expect(() => parseAmmPoolMetadata(data)).toThrow('not an AMM pool account');
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
