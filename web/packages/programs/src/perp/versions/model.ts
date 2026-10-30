import type { Account } from '@thru/sdk';
import type {
  ParsedPerpEvent,
  PerpArenaHeader,
  PerpArenaSlots,
  PerpCbook,
  PerpCbookHeader,
  PerpExchangeMeta,
  PerpFunding,
  PerpMarginAccount,
  PerpMarket,
  PerpOrderEntry,
  PerpSeatEntry,
} from '../index';

/* The version-independent domain model.

   Every ABI version decodes into these types, so the indexer, the UI and
   the margin math (perpEquity, perpCrossTotals, ...) never branch on a
   version.  A field a version does not have is absent (optional fields)
   or neutral: an ABI without funding decodes markets without `funding`
   and seats without funding words, one without cross margin decodes every
   seat with `cross: false` and no `crossUpnlHaircutBps`.  The interfaces
   are the SDK's long-standing Perp* types; the shorter names below are the
   names the domain model documents. */

export type PerpMarketState = PerpMarket;
export type PerpSeat = PerpSeatEntry;
export type PerpFundingState = PerpFunding;
export type PerpOrder = PerpOrderEntry;
export type PerpMarginAccountState = PerpMarginAccount;
export type PerpExchangeState = PerpExchangeMeta;

/** A seat arena decoded: the market header, the arena header and the seats. */
export interface PerpSeatArenaState {
  market: PerpMarket;
  header: PerpArenaHeader;
  slots: PerpArenaSlots<PerpSeatEntry>;
  seats: PerpSeatEntry[];
}

export interface PerpOrderArenaState {
  header: PerpArenaHeader;
  slots: PerpArenaSlots<PerpOrderEntry>;
  orders: PerpOrderEntry[];
}

/** An ABI version's id: `perp-abi@<package-version>` of the program's ABI
    yaml (`abi.package-version` in thru-perps/abi/tn_perp_program.abi.yaml). */
export type PerpAbiVersionId = `perp-abi@${string}`;

/** What a program version can do.  The UI gates features on these, the
    transaction builders refuse an instruction the version does not have. */
export interface PerpFeatureFlags {
  /** Oracle mark, initial / maintenance margin, liquidation (milestone 2). */
  oracleMargin: boolean;
  liquidation: boolean;
  /** Hourly funding: funding_update, market_set_funding, settle_funding,
      the FUNDING_ROUND event, funding words on markets and seats. */
  funding: boolean;
  settleFunding: boolean;
  /** Margin accounts linking seats across markets: margin_account_create,
      margin_record, margin_link / unlink / transfer, the MARGIN event,
      signed balances on cross seats. */
  crossMargin: boolean;
  /** market_set_vault: markets sharing one quote vault. */
  sharedVaults: boolean;
  /** market_set_cross: a haircut on cross seats' positive unrealized pnl. */
  crossUpnlHaircut: boolean;
  /** The loss waterfall: insurance_deposit, resolve_bad_debt,
      market_set_risk_params, the LOSS and INSURANCE events, a market's
      risk state, loss charges in funding settlement, and withdrawals frozen
      while bad debt is outstanding. */
  lossWaterfall: boolean;
  /** Trading fees and builder codes: market_set_fees, fee_claim,
      seat_set_fee_receiver, seat_set_builder_approval, the FEE event, a
      market's fee rates, builder terms in market records and resting
      orders, fee seats and builder approvals. */
  tradingFees: boolean;
}

export type PerpFeature = keyof PerpFeatureFlags;

/** Byte layout of a version's accounts (offsets into account data). */
export interface PerpAbiLayout {
  /** Bytes of the market header (market_t) at the start of the seat arena. */
  marketHeaderSize: number;
  /** Bytes reserved for the market header before the arena header. */
  seatArenaReservedSize: number;
  seatArenaHeaderSize: number;
  seatArenaEntriesOffset: number;
  seatEntrySize: number;
  orderArenaEntriesOffset: number;
  orderEntrySize: number;
  cbookHeaderSize: number;
  cbookLevelSize: number;
  exchangeMetaSize: number;
  /** null when the version has no margin accounts. */
  marginAccountSize: number | null;
}

/** Decoders of one ABI version into the domain model.  Each takes an
    account (or its data) as the chain returns it. */
export interface PerpAbiDecoder {
  exchangeMeta(data: Account | Uint8Array): PerpExchangeMeta;
  /** The market header alone (the first bytes of a seat arena). */
  market(data: Account | Uint8Array): PerpMarket;
  seatArena(data: Account | Uint8Array): PerpSeatArenaState;
  /** One seat entry read on its own (layout.seatEntrySize bytes); null for a free slot. */
  seatEntry(data: Account | Uint8Array, seatIndex: number): PerpSeatEntry | null;
  orderArena(data: Account | Uint8Array): PerpOrderArenaState;
  cbook(data: Account | Uint8Array): PerpCbook;
  cbookHeader(data: Account | Uint8Array): PerpCbookHeader;
  /** Throws on a version without margin accounts. */
  marginAccount(data: Account | Uint8Array): PerpMarginAccount;
  event(data: Uint8Array): ParsedPerpEvent;
}

export interface PerpAbiVersion {
  id: PerpAbiVersionId;
  /** `abi.package-version` of the ABI yaml, e.g. "0.4.0". */
  abiPackageVersion: string;
  /** `abi.abi-version` of the ABI yaml (the ABI format, 1 for every release so far). */
  abiFormatVersion: number;
  /** One line on what the version added. */
  label: string;
  /** sha256 (hex) of program code known to implement this ABI. */
  programHashes: readonly string[];
  features: Readonly<PerpFeatureFlags>;
  layout: Readonly<PerpAbiLayout>;
  /** Instruction tags (PERP_INSTRUCTION_*) the program accepts. */
  instructions: ReadonlySet<number>;
  /** Event types (PERP_EVENT_*) the program emits. */
  events: ReadonlySet<number>;
  decode: PerpAbiDecoder;
}

/** How a version was told apart (see detectPerpAbiVersion). */
export type PerpAbiVersionSource = 'program-hash' | 'abi-account' | 'fallback';

export interface PerpAbiVersionDetection {
  version: PerpAbiVersion;
  source: PerpAbiVersionSource;
  /** sha256 (hex) of the program code, when it was read. */
  programHash: string | null;
  /** package-version the on-chain ABI account carries, when it was read. */
  abiPackageVersion: string | null;
  /** The on-chain ABI account names another version than the program
      hash: the program was upgraded without its ABI (Betanet on
      2026-10-15 kept the 0.2.0 ABI under 0.4.0 code).  The hash wins. */
  abiAccountStale: boolean;
}
