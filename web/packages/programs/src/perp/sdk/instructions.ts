import { Pubkey } from '@thru/sdk';
import {
  concatPerpInstructions,
  createPerpExchangeSetStatusInstruction,
  createPerpFeeClaimInstruction,
  createPerpFundingUpdateInstruction,
  createPerpLiquidateInstruction,
  createPerpMarginAccountCreateInstruction,
  createPerpMarginLinkInstruction,
  createPerpMarginRecordInstruction,
  createPerpMarginTransferInstruction,
  createPerpMarginUnlinkInstruction,
  createPerpMarketRecordInstruction,
  createPerpMarketSetCrossInstruction,
  createPerpMarketSetFeesInstruction,
  createPerpMarketSetFundingInstruction,
  createPerpMarketSetStatusInstruction,
  createPerpMarketSetVaultInstruction,
  createPerpModifyOrderEntryInstruction,
  createPerpOrderEntryInstruction,
  createPerpSeatCreateInstruction,
  createPerpSeatSetBuilderApprovalInstruction,
  createPerpSeatSetFeeReceiverInstruction,
  createPerpSettleFundingInstruction,
  createPerpTokenDepositInstruction,
  createPerpTokenWithdrawInstruction,
  type InstructionData,
  type PerpOrderSide,
  type PerpOrderType,
} from '../index';

/* Perp instructions as plain data.

   A transaction builder returns the instructions it wants as these specs:
   JSON-serialisable (addresses as strings, u64 values as decimal strings,
   byte strings as hex), independent of where the accounts land in the
   final transaction.  encodePerpInstructions turns them into the
   program's bytes once the signer has fixed the account order (a keypair
   signer and a wallet order the same accounts differently), through the
   createPerp*Instruction encoders. */

/** A u64 as a decimal string. */
export type PerpU64 = string;

export type PerpInstructionSpec =
  | {
      ix: 'market_record';
      marketRecordIndex: number;
      seatArena: string;
      orderArena: string;
      bidsCbook: string;
      asksCbook: string;
      exchangeMeta: string;
      seatAuthority?: string;
      seatIndex?: number;
      tokenProgram?: string;
      quoteVault?: string;
      marketAuthority?: string;
      oracleFeed?: string;
      /** Builder code (0.5.0): the fee seat paid and its rate, ppm; needs the seat. */
      builderSeatIndex?: number;
      builderFeePpm?: number;
    }
  | { ix: 'seat_create'; marketRecordIndex: number; seatAuthority: string }
  | { ix: 'token_deposit' | 'token_withdraw'; marketRecordIndex: number; tokenProgram: string; from: string; to: string; amount: PerpU64 }
  | {
      ix: 'create_order_entry';
      marketRecordIndex: number;
      side: PerpOrderSide;
      orderType: PerpOrderType;
      price: PerpU64;
      quantity: PerpU64;
      expirationTime?: PerpU64;
      /** 16 bytes, hex. */
      clientId?: string;
    }
  | {
      ix: 'modify_order_entry';
      marketRecordIndex: number;
      orderEntryIndex: number;
      /** 0 cancels. */
      quantity: PerpU64;
      expirationTime: PerpU64;
      orderId?: PerpU64;
      clientId?: string;
      failIfOutOfRange?: boolean;
    }
  | { ix: 'liquidate'; marketRecordIndex: number; targetSeatIndex: number }
  | { ix: 'funding_update'; marketRecordIndex: number }
  | { ix: 'settle_funding'; marketRecordIndex: number; targetSeatIndex: number }
  | {
      ix: 'market_set_funding';
      marketRecordIndex: number;
      interestRate: number;
      clampSmall: number;
      clampBig: number;
      premiumMultiplier: number;
      impactNotional: PerpU64;
    }
  | { ix: 'market_set_status'; marketRecordIndex: number; statusFlags: number }
  | { ix: 'market_set_cross'; marketRecordIndex: number; crossUpnlHaircutBps: number }
  | { ix: 'market_set_vault'; marketRecordIndex: number; exchangeAdmin: string; newVault: string }
  | {
      ix: 'market_set_fees';
      marketRecordIndex: number;
      takerFeePpm: number;
      makerRebatePpm: number;
      builderFeeCapPpm: number;
      feeInsuranceSharePpm: number;
      liqInsuranceSharePpm: number;
    }
  | { ix: 'fee_claim'; marketRecordIndex: number; amount: PerpU64 }
  | { ix: 'seat_set_fee_receiver'; marketRecordIndex: number }
  | { ix: 'seat_set_builder_approval'; marketRecordIndex: number; builderSeatIndex: number; maxFeePpm: number }
  | { ix: 'exchange_set_status'; exchangeMeta: string; exchangeAdmin: string; statusFlags: number }
  | { ix: 'margin_account_create'; owner: string; marginAccount: string; vault: string; accountId: number; /** hex */ proof: string }
  | {
      ix: 'margin_record';
      marginRecordIndex: number;
      marginAccount: string;
      exchangeMeta: string;
      /** Every link of the account, in link order. */
      entries: Array<{ seatArena: string; oracleFeed?: string }>;
    }
  | { ix: 'margin_link' | 'margin_unlink'; marginRecordIndex: number; marketRecordIndex: number }
  | { ix: 'margin_transfer'; marginRecordIndex: number; fromLink: number; toLink: number; owner: string; amount: PerpU64 };

export type PerpInstructionName = PerpInstructionSpec['ix'];

const key = (address: string) => Pubkey.from(address).toBytes();
const optionalKey = (address: string | undefined) => (address ? key(address) : undefined);
const u64 = (value: PerpU64, label: string): bigint => {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string, got ${JSON.stringify(value)}`);
  return BigInt(value);
};

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error('expected a hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** One spec as the program's instruction encoder. */
export function encodePerpInstruction(spec: PerpInstructionSpec): InstructionData {
  switch (spec.ix) {
    case 'market_record':
      return createPerpMarketRecordInstruction({
        marketRecordIndex: spec.marketRecordIndex,
        seatArenaAccountBytes: key(spec.seatArena),
        orderArenaAccountBytes: key(spec.orderArena),
        bidsCbookAccountBytes: key(spec.bidsCbook),
        asksCbookAccountBytes: key(spec.asksCbook),
        exchangeMetaAccountBytes: key(spec.exchangeMeta),
        seatAuthorityAccountBytes: optionalKey(spec.seatAuthority),
        seatIndex: spec.seatIndex,
        tokenProgramAccountBytes: optionalKey(spec.tokenProgram),
        quoteVaultAccountBytes: optionalKey(spec.quoteVault),
        marketAuthorityAccountBytes: optionalKey(spec.marketAuthority),
        oracleFeedAccountBytes: optionalKey(spec.oracleFeed),
        builderSeatIndex: spec.builderSeatIndex,
        builderFeePpm: spec.builderFeePpm,
      });
    case 'seat_create':
      return createPerpSeatCreateInstruction({ marketRecordIndex: spec.marketRecordIndex, seatAuthorityAccountBytes: key(spec.seatAuthority) });
    case 'token_deposit':
    case 'token_withdraw': {
      const args = {
        marketRecordIndex: spec.marketRecordIndex,
        tokenProgramAccountBytes: key(spec.tokenProgram),
        fromAccountBytes: key(spec.from),
        toAccountBytes: key(spec.to),
        amount: u64(spec.amount, 'amount'),
      };
      return spec.ix === 'token_deposit' ? createPerpTokenDepositInstruction(args) : createPerpTokenWithdrawInstruction(args);
    }
    case 'create_order_entry':
      return createPerpOrderEntryInstruction({
        marketRecordIndex: spec.marketRecordIndex,
        side: spec.side,
        orderType: spec.orderType,
        price: u64(spec.price, 'price'),
        quantity: u64(spec.quantity, 'quantity'),
        expirationTime: spec.expirationTime === undefined ? undefined : u64(spec.expirationTime, 'expirationTime'),
        clientId: spec.clientId ? hexToBytes(spec.clientId) : undefined,
      });
    case 'modify_order_entry':
      /* A cancel is a modify to quantity 0 (createPerpCancelOrderInstruction). */
      return createPerpModifyOrderEntryInstruction({
        marketRecordIndex: spec.marketRecordIndex,
        orderEntryIndex: spec.orderEntryIndex,
        quantity: u64(spec.quantity, 'quantity'),
        expirationTime: u64(spec.expirationTime, 'expirationTime'),
        orderId: spec.orderId === undefined ? undefined : u64(spec.orderId, 'orderId'),
        clientId: spec.clientId ? hexToBytes(spec.clientId) : undefined,
        failIfOutOfRange: spec.failIfOutOfRange,
      });
    case 'liquidate':
      return createPerpLiquidateInstruction({ marketRecordIndex: spec.marketRecordIndex, targetSeatIndex: spec.targetSeatIndex });
    case 'funding_update':
      return createPerpFundingUpdateInstruction({ marketRecordIndex: spec.marketRecordIndex });
    case 'settle_funding':
      return createPerpSettleFundingInstruction({ marketRecordIndex: spec.marketRecordIndex, targetSeatIndex: spec.targetSeatIndex });
    case 'market_set_funding':
      return createPerpMarketSetFundingInstruction({ ...spec, impactNotional: u64(spec.impactNotional, 'impactNotional') });
    case 'market_set_status':
      return createPerpMarketSetStatusInstruction({ marketRecordIndex: spec.marketRecordIndex, statusFlags: spec.statusFlags });
    case 'market_set_cross':
      return createPerpMarketSetCrossInstruction({ marketRecordIndex: spec.marketRecordIndex, crossUpnlHaircutBps: spec.crossUpnlHaircutBps });
    case 'market_set_vault':
      return createPerpMarketSetVaultInstruction({
        marketRecordIndex: spec.marketRecordIndex,
        exchangeAdminAccountBytes: key(spec.exchangeAdmin),
        newVaultAccountBytes: key(spec.newVault),
      });
    case 'market_set_fees':
      return createPerpMarketSetFeesInstruction({
        marketRecordIndex: spec.marketRecordIndex,
        takerFeePpm: spec.takerFeePpm,
        makerRebatePpm: spec.makerRebatePpm,
        builderFeeCapPpm: spec.builderFeeCapPpm,
        feeInsuranceSharePpm: spec.feeInsuranceSharePpm,
        liqInsuranceSharePpm: spec.liqInsuranceSharePpm,
      });
    case 'fee_claim':
      return createPerpFeeClaimInstruction({ marketRecordIndex: spec.marketRecordIndex, amount: u64(spec.amount, 'amount') });
    case 'seat_set_fee_receiver':
      return createPerpSeatSetFeeReceiverInstruction({ marketRecordIndex: spec.marketRecordIndex });
    case 'seat_set_builder_approval':
      return createPerpSeatSetBuilderApprovalInstruction({
        marketRecordIndex: spec.marketRecordIndex,
        builderSeatIndex: spec.builderSeatIndex,
        maxFeePpm: spec.maxFeePpm,
      });
    case 'exchange_set_status':
      return createPerpExchangeSetStatusInstruction({
        exchangeMetaAccountBytes: key(spec.exchangeMeta),
        exchangeAdminAccountBytes: key(spec.exchangeAdmin),
        statusFlags: spec.statusFlags,
      });
    case 'margin_account_create':
      return createPerpMarginAccountCreateInstruction({
        ownerAccountBytes: key(spec.owner),
        marginAccountBytes: key(spec.marginAccount),
        vaultAccountBytes: key(spec.vault),
        accountId: spec.accountId,
        proof: hexToBytes(spec.proof),
      });
    case 'margin_record':
      return createPerpMarginRecordInstruction({
        marginRecordIndex: spec.marginRecordIndex,
        marginAccountBytes: key(spec.marginAccount),
        exchangeMetaAccountBytes: key(spec.exchangeMeta),
        entries: spec.entries.map((entry) => ({ seatArenaAccountBytes: key(entry.seatArena), oracleFeedAccountBytes: optionalKey(entry.oracleFeed) })),
      });
    case 'margin_link':
      return createPerpMarginLinkInstruction({ marginRecordIndex: spec.marginRecordIndex, marketRecordIndex: spec.marketRecordIndex });
    case 'margin_unlink':
      return createPerpMarginUnlinkInstruction({ marginRecordIndex: spec.marginRecordIndex, marketRecordIndex: spec.marketRecordIndex });
    case 'margin_transfer':
      return createPerpMarginTransferInstruction({
        marginRecordIndex: spec.marginRecordIndex,
        fromLink: spec.fromLink,
        toLink: spec.toLink,
        ownerAccountBytes: key(spec.owner),
        amount: u64(spec.amount, 'amount'),
      });
    default: {
      const unknown: never = spec;
      throw new Error(`unknown perp instruction ${(unknown as { ix?: string }).ix}`);
    }
  }
}

/** The specs, in order, as one instruction payload (the perp entrypoint
    runs concatenated instructions). */
export function encodePerpInstructions(specs: readonly PerpInstructionSpec[]): InstructionData {
  return concatPerpInstructions(...specs.map(encodePerpInstruction));
}
