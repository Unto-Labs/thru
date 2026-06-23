import { Pubkey } from '@thru/sdk';
import { encodeAddress } from '@thru/sdk/helpers';
import type { Account } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { compareBytes } from '../helpers/bytes';
import {
  AmmAddLiquidityInstructionBuilder,
  AmmInitPoolInstructionBuilder,
  AmmInstructionBuilder,
  AmmPoolMetadata as AmmPoolMetadataView,
  AmmSwapInstructionBuilder,
  AmmWithdrawLiquidityInstructionBuilder,
} from './abi/thru/program/amm/types';

export {
  AmmAddLiquidityInstruction,
  AmmAddLiquidityInstructionBuilder,
  AmmError,
  AmmErrorBuilder,
  AmmEvent,
  AmmEventBuilder,
  AmmInitPoolInstruction,
  AmmInitPoolInstructionBuilder,
  AmmInstruction,
  AmmInstructionBuilder,
  AmmPoolMetadata as AmmPoolMetadataView,
  AmmPoolMetadataBuilder,
  AmmSwapInstruction,
  AmmSwapInstructionBuilder,
  AmmWithdrawLiquidityInstruction,
  AmmWithdrawLiquidityInstructionBuilder,
  BurnEventData,
  BurnEventDataBuilder,
  MintEventData,
  MintEventDataBuilder,
  PoolInitEventData,
  PoolInitEventDataBuilder,
  Seed32,
  SwapEventData,
  SwapEventDataBuilder,
  SyncEventData,
  SyncEventDataBuilder,
} from './abi/thru/program/amm/types';

export const AMM_INSTRUCTION_INIT_POOL = 0;
export const AMM_INSTRUCTION_ADD_LIQUIDITY = 1;
export const AMM_INSTRUCTION_WITHDRAW_LIQUIDITY = 2;
export const AMM_INSTRUCTION_SWAP = 3;

export const AMM_EVENT_POOL_INIT = 0;
export const AMM_EVENT_MINT = 1;
export const AMM_EVENT_BURN = 2;
export const AMM_EVENT_SWAP = 3;
export const AMM_EVENT_SYNC = 4;

export const AMM_BPS_DENOMINATOR = 10_000;
export const AMM_DEFAULT_SWAP_FEE_BPS = 30;
export const AMM_MAX_SWAP_FEE_BPS = 500;
export const AMM_MINIMUM_LIQUIDITY = 1_000n;
export const AMM_LP_DECIMALS = 6;
export const AMM_LP_SCALE = 1_000_000n;
export const AMM_POOL_METADATA_SIZE = 203;
export const AMM_PROGRAM_ADDRESS =
  'taCnhMCcBZSJ8MDLGYBnTIRgmWxZx_jNjoNwOwzk1g4ST1';

type AmmInstructionVariant = 'init_pool' | 'add_liquidity' | 'withdraw_liquidity' | 'swap';

export const AMM_ERROR_LABELS: Record<number, string> = {
  1: 'Invalid instruction data size',
  2: 'Invalid instruction',
  3: 'Account already initialized',
  4: 'Account not initialized',
  5: 'Invalid account index',
  6: 'Invalid mint ordering',
  7: 'Unauthorized operation',
  8: 'Pool create failed',
  9: 'LP mint create failed',
  10: 'Vault one create failed',
  11: 'Vault two create failed',
  12: 'Account resize failed',
  13: 'Account set writable failed',
  14: 'LP mint init failed',
  15: 'Vault one init failed',
  16: 'Vault two init failed',
  17: 'Liquidity bounds',
  18: 'Vault mismatch',
  19: 'LP mint mismatch',
};

const PUBKEY_LENGTH = 32;
const LP_MINT_SEED_LABEL = asciiBytes('lp_mint');
export const AMM_VAULT_ONE_SEED = oneByteSeed(0x01);
export const AMM_VAULT_TWO_SEED = oneByteSeed(0x02);

export type AccountLookupContext = {
  getAccountIndex: (pubkey: Uint8Array) => number;
};

export type InstructionData = (context: AccountLookupContext) => Promise<Uint8Array>;

export interface SortedAmmMints {
  mintOneBytes: Uint8Array;
  mintTwoBytes: Uint8Array;
  mintOneAddress: string;
  mintTwoAddress: string;
  inputOrder: 'already-sorted' | 'swapped';
}

export interface AmmPoolAddresses {
  mintOneAddress: string;
  mintTwoAddress: string;
  mintOneBytes: Uint8Array;
  mintTwoBytes: Uint8Array;
  poolAddress: string;
  poolBytes: Uint8Array;
  poolSeed: Uint8Array;
  lpMintSeed: Uint8Array;
  vaultOneSeed: Uint8Array;
  vaultTwoSeed: Uint8Array;
  swapFeeBps: number;
  inputOrder: 'already-sorted' | 'swapped';
}

export interface AmmPoolMetadata {
  isInitialized: boolean;
  lockedLpSupply: bigint;
  swapFeeBps: number;
  swapPoolAuthority: string;
  mintOne: string;
  mintTwo: string;
  vaultOne: string;
  vaultTwo: string;
  lpMint: string;
}

export interface AmmQuoteExactIn {
  amountIn: bigint;
  amountInAfterFee: bigint;
  feeAmount: bigint;
  amountOut: bigint;
}

export interface InitPoolArgs {
  payerAccountBytes: Uint8Array;
  poolAccountBytes: Uint8Array;
  lpMintAccountBytes: Uint8Array;
  vaultOneAccountBytes: Uint8Array;
  vaultTwoAccountBytes: Uint8Array;
  mintOneAccountBytes: Uint8Array;
  mintTwoAccountBytes: Uint8Array;
  tokenProgramAccountBytes: Uint8Array;
  swapFeeBps: number;
  lpMintSeed: Uint8Array;
  poolStateProof: Uint8Array;
  lpMintStateProof: Uint8Array;
  vaultOneStateProof: Uint8Array;
  vaultTwoStateProof: Uint8Array;
}

export interface AddLiquidityArgs {
  poolAccountBytes: Uint8Array;
  depositorAccountBytes: Uint8Array;
  depositorTokenOneAccountBytes: Uint8Array;
  depositorTokenTwoAccountBytes: Uint8Array;
  depositorLpAccountBytes: Uint8Array;
  vaultOneAccountBytes: Uint8Array;
  vaultTwoAccountBytes: Uint8Array;
  lpMintAccountBytes: Uint8Array;
  tokenProgramAccountBytes: Uint8Array;
  maxAmountMintOne: bigint;
  maxAmountMintTwo: bigint;
}

export interface WithdrawLiquidityArgs {
  poolAccountBytes: Uint8Array;
  withdrawerAccountBytes: Uint8Array;
  withdrawerTokenOneAccountBytes: Uint8Array;
  withdrawerTokenTwoAccountBytes: Uint8Array;
  withdrawerLpAccountBytes: Uint8Array;
  vaultOneAccountBytes: Uint8Array;
  vaultTwoAccountBytes: Uint8Array;
  lpMintAccountBytes: Uint8Array;
  tokenProgramAccountBytes: Uint8Array;
  lpAmount: bigint;
}

export interface SwapArgs {
  poolAccountBytes: Uint8Array;
  userTransferAuthorityBytes: Uint8Array;
  userInputAccountBytes: Uint8Array;
  userOutputAccountBytes: Uint8Array;
  vaultInputAccountBytes: Uint8Array;
  vaultOutputAccountBytes: Uint8Array;
  lpMintAccountBytes: Uint8Array;
  tokenProgramAccountBytes: Uint8Array;
  amountIn: bigint;
}

export function sortAmmMints(
  mintA: Uint8Array | string,
  mintB: Uint8Array | string
): SortedAmmMints {
  const mintABytes = toPubkeyBytes(mintA);
  const mintBBytes = toPubkeyBytes(mintB);
  const comparison = compareBytes(mintABytes, mintBBytes);
  if (comparison === 0) throw new Error('AMM mints must be distinct');
  const alreadySorted = comparison < 0;
  const mintOneBytes = alreadySorted ? mintABytes : mintBBytes;
  const mintTwoBytes = alreadySorted ? mintBBytes : mintABytes;
  return {
    mintOneBytes,
    mintTwoBytes,
    mintOneAddress: encodeAddress(mintOneBytes),
    mintTwoAddress: encodeAddress(mintTwoBytes),
    inputOrder: alreadySorted ? 'already-sorted' : 'swapped',
  };
}

export function deriveAmmLpMintSeed(thru: Thru, poolBytes: Uint8Array | string): Uint8Array {
  return thru.helpers.deriveAddress([
    toPubkeyBytes(poolBytes),
    LP_MINT_SEED_LABEL,
  ]).bytes;
}

export function deriveAmmPoolAddresses(
  thru: Thru,
  args: {
    ammProgramAddress: string;
    mintAAddress: string;
    mintBAddress: string;
    swapFeeBps?: number;
  }
): AmmPoolAddresses {
  const swapFeeBps = args.swapFeeBps ?? AMM_DEFAULT_SWAP_FEE_BPS;
  assertU16(swapFeeBps, 'swapFeeBps');
  if (swapFeeBps <= 0 || swapFeeBps > AMM_MAX_SWAP_FEE_BPS) {
    throw new Error(`swapFeeBps must be 1-${AMM_MAX_SWAP_FEE_BPS}`);
  }

  const sorted = sortAmmMints(args.mintAAddress, args.mintBAddress);
  const feeBytes = new Uint8Array(2);
  new DataView(feeBytes.buffer).setUint16(0, swapFeeBps, true);
  const poolSeed = thru.helpers.deriveAddress([
    sorted.mintOneBytes,
    sorted.mintTwoBytes,
    feeBytes,
  ]).bytes;
  const pool = thru.helpers.deriveProgramAddress({
    programAddress: args.ammProgramAddress,
    seed: poolSeed,
    ephemeral: false,
  });
  const lpMintSeed = deriveAmmLpMintSeed(thru, pool.bytes);

  return {
    ...sorted,
    poolAddress: pool.address,
    poolBytes: pool.bytes,
    poolSeed,
    lpMintSeed,
    vaultOneSeed: AMM_VAULT_ONE_SEED.slice(),
    vaultTwoSeed: AMM_VAULT_TWO_SEED.slice(),
    swapFeeBps,
  };
}

export function createInitPoolInstruction(args: InitPoolArgs): InstructionData {
  assertU16(args.swapFeeBps, 'swapFeeBps');
  const lpMintSeed = Pubkey.from(args.lpMintSeed).toBytes();
  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    const builder = new AmmInitPoolInstructionBuilder()
      .set_payer_account_idx(accountIndex(context, args.payerAccountBytes))
      .set_pool_account_idx(accountIndex(context, args.poolAccountBytes))
      .set_lp_mint_account_idx(accountIndex(context, args.lpMintAccountBytes))
      .set_vault_one_account_idx(accountIndex(context, args.vaultOneAccountBytes))
      .set_vault_two_account_idx(accountIndex(context, args.vaultTwoAccountBytes))
      .set_mint_one_account_idx(accountIndex(context, args.mintOneAccountBytes))
      .set_mint_two_account_idx(accountIndex(context, args.mintTwoAccountBytes))
      .set_token_program_account_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_swap_fee_bps(args.swapFeeBps)
      .set_lp_mint_seed(lpMintSeed);
    builder.pool_proof().write(args.poolStateProof).finish();
    builder.lp_mint_proof().write(args.lpMintStateProof).finish();
    builder.vault_one_proof().write(args.vaultOneStateProof).finish();
    builder.vault_two_proof().write(args.vaultTwoStateProof).finish();
    return buildAmmInstruction('init_pool', builder.build());
  };
}

export function createAddLiquidityInstruction(args: AddLiquidityArgs): InstructionData {
  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    assertU64(args.maxAmountMintOne, 'maxAmountMintOne');
    assertU64(args.maxAmountMintTwo, 'maxAmountMintTwo');
    const payload = new AmmAddLiquidityInstructionBuilder()
      .set_pool_account_idx(accountIndex(context, args.poolAccountBytes))
      .set_depositor_account_idx(accountIndex(context, args.depositorAccountBytes))
      .set_depositor_token_one_account_idx(accountIndex(context, args.depositorTokenOneAccountBytes))
      .set_depositor_token_two_account_idx(accountIndex(context, args.depositorTokenTwoAccountBytes))
      .set_depositor_lp_account_idx(accountIndex(context, args.depositorLpAccountBytes))
      .set_vault_one_account_idx(accountIndex(context, args.vaultOneAccountBytes))
      .set_vault_two_account_idx(accountIndex(context, args.vaultTwoAccountBytes))
      .set_lp_mint_account_idx(accountIndex(context, args.lpMintAccountBytes))
      .set_token_program_account_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_max_amount_mint_one(args.maxAmountMintOne)
      .set_max_amount_mint_two(args.maxAmountMintTwo)
      .build();
    return buildAmmInstruction('add_liquidity', payload);
  };
}

export function createWithdrawLiquidityInstruction(args: WithdrawLiquidityArgs): InstructionData {
  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    assertU64(args.lpAmount, 'lpAmount');
    const payload = new AmmWithdrawLiquidityInstructionBuilder()
      .set_pool_account_idx(accountIndex(context, args.poolAccountBytes))
      .set_withdrawer_account_idx(accountIndex(context, args.withdrawerAccountBytes))
      .set_withdrawer_token_one_account_idx(accountIndex(context, args.withdrawerTokenOneAccountBytes))
      .set_withdrawer_token_two_account_idx(accountIndex(context, args.withdrawerTokenTwoAccountBytes))
      .set_withdrawer_lp_account_idx(accountIndex(context, args.withdrawerLpAccountBytes))
      .set_vault_one_account_idx(accountIndex(context, args.vaultOneAccountBytes))
      .set_vault_two_account_idx(accountIndex(context, args.vaultTwoAccountBytes))
      .set_lp_mint_account_idx(accountIndex(context, args.lpMintAccountBytes))
      .set_token_program_account_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_lp_amount(args.lpAmount)
      .build();
    return buildAmmInstruction('withdraw_liquidity', payload);
  };
}

export function createSwapInstruction(args: SwapArgs): InstructionData {
  return async (context: AccountLookupContext): Promise<Uint8Array> => {
    assertU64(args.amountIn, 'amountIn');
    const payload = new AmmSwapInstructionBuilder()
      .set_pool_account_idx(accountIndex(context, args.poolAccountBytes))
      .set_user_transfer_authority_idx(accountIndex(context, args.userTransferAuthorityBytes))
      .set_user_input_account_idx(accountIndex(context, args.userInputAccountBytes))
      .set_user_output_account_idx(accountIndex(context, args.userOutputAccountBytes))
      .set_vault_input_account_idx(accountIndex(context, args.vaultInputAccountBytes))
      .set_vault_output_account_idx(accountIndex(context, args.vaultOutputAccountBytes))
      .set_lp_mint_account_idx(accountIndex(context, args.lpMintAccountBytes))
      .set_token_program_account_idx(accountIndex(context, args.tokenProgramAccountBytes))
      .set_amount_in(args.amountIn)
      .build();
    return buildAmmInstruction('swap', payload);
  };
}

export function parseAmmPoolMetadata(accountOrData: Account | Uint8Array): AmmPoolMetadata {
  const data = accountOrData instanceof Uint8Array ? accountOrData : accountOrData.data?.data;
  if (!data) throw new Error('AMM pool account data is missing');
  if (data.length < AMM_POOL_METADATA_SIZE) throw new Error('AMM pool account data is malformed');

  const metadata = AmmPoolMetadataView.from_array(data);
  if (!metadata) throw new Error('AMM pool account data is malformed');
  return {
    isInitialized: metadata.get_is_initialized() !== 0,
    lockedLpSupply: metadata.get_locked_lp_supply(),
    swapFeeBps: metadata.get_swap_fee_bps(),
    swapPoolAuthority: pubkeyViewToAddress(metadata.get_swap_pool_authority()),
    mintOne: pubkeyViewToAddress(metadata.get_mint_one()),
    mintTwo: pubkeyViewToAddress(metadata.get_mint_two()),
    vaultOne: pubkeyViewToAddress(metadata.get_vault_one()),
    vaultTwo: pubkeyViewToAddress(metadata.get_vault_two()),
    lpMint: pubkeyViewToAddress(metadata.get_lp_mint()),
  };
}

export function quoteAmmSwapExactIn(args: {
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  swapFeeBps: number;
}): AmmQuoteExactIn {
  if (args.amountIn <= 0n) throw new Error('amountIn must be positive');
  if (args.reserveIn <= 0n || args.reserveOut <= 0n) {
    throw new Error('reserves must be positive');
  }
  assertU16(args.swapFeeBps, 'swapFeeBps');
  const feeAmount = (args.amountIn * BigInt(args.swapFeeBps)) / BigInt(AMM_BPS_DENOMINATOR);
  const amountInAfterFee = args.amountIn - feeAmount;
  if (amountInAfterFee <= 0n) throw new Error('amountIn is fully consumed by fees');
  const amountOut = (amountInAfterFee * args.reserveOut) / (args.reserveIn + amountInAfterFee);
  return {
    amountIn: args.amountIn,
    amountInAfterFee,
    feeAmount,
    amountOut,
  };
}

function toPubkeyBytes(value: Uint8Array | string): Uint8Array {
  return Pubkey.from(value).toBytes();
}

function assertU16(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`${label} must be an integer between 0 and 65535`);
  }
}

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`${label} must be between 0 and 18446744073709551615`);
  }
}

function accountIndex(context: AccountLookupContext, pubkey: Uint8Array): number {
  const index = context.getAccountIndex(pubkey);
  assertU16(index, 'account index');
  return index;
}

function buildAmmInstruction(variant: AmmInstructionVariant, payload: Uint8Array): Uint8Array {
  const builder = new AmmInstructionBuilder();
  builder.payload().select(variant).writePayload(payload).finish();
  return builder.build();
}

function pubkeyViewToAddress(pubkey: unknown): string {
  const buffer = (pubkey as { buffer?: Uint8Array }).buffer;
  if (!buffer) throw new Error('generated Pubkey view did not expose a buffer');
  return encodeAddress(buffer);
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function oneByteSeed(value: number): Uint8Array {
  const seed = new Uint8Array(PUBKEY_LENGTH);
  seed[0] = value;
  return seed;
}
