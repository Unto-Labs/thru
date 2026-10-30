import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Pubkey } from '@thru/sdk';
import {
  PERP_CBOOK_HEADER_SIZE,
  PERP_CBOOK_LEVEL_SIZE,
  PERP_EVENT_FEE,
  PERP_EVENT_FUNDING_ROUND,
  PERP_EVENT_INSURANCE,
  PERP_EVENT_LIQUIDATION,
  PERP_EVENT_LOSS,
  PERP_EVENT_MARGIN,
  PERP_EXCHANGE_META_ACCOUNT_SIZE,
  PERP_INSTRUCTION_FEE_CLAIM,
  PERP_INSTRUCTION_FUNDING_UPDATE,
  PERP_INSTRUCTION_INSURANCE_DEPOSIT,
  PERP_INSTRUCTION_LIQUIDATE,
  PERP_INSTRUCTION_MARGIN_RECORD,
  PERP_INSTRUCTION_MARKET_SET_CROSS,
  PERP_INSTRUCTION_MARKET_SET_FEES,
  PERP_INSTRUCTION_SEAT_SET_BUILDER_APPROVAL,
  PERP_INSTRUCTION_SEAT_SET_FEE_RECEIVER,
  PERP_INSTRUCTION_SETTLE_FUNDING,
  PERP_MARGIN_ACCOUNT_SIZE,
  PERP_MARKET_ACCOUNT_SIZE,
  PERP_MARKET_MAGIC,
  PERP_ORDER_ARENA_ENTRIES_OFFSET,
  PERP_ORDER_ENTRY_SIZE,
  PERP_SEAT_ARENA_ENTRIES_OFFSET,
  PERP_SEAT_ARENA_HEADER_SIZE,
  PERP_SEAT_ENTRY_SIZE,
  PERP_SEAT_MANAGER_RESERVED_SIZE,
  perpCrossTotals,
  perpEquity,
  type PerpSeatEntry,
} from '../index';
import {
  PERP_ABI_LATEST,
  PERP_ABI_V0_2,
  PERP_ABI_V0_3,
  PERP_ABI_V0_4,
  PERP_ABI_V0_5,
  PERP_CURRENT_LAYOUT,
  detectPerpAbiVersion,
  fetchPerpAbiVersion,
  getPerpAbiVersion,
  parsePerpAbiYamlHeader,
  perpAbiVersionForPackageVersion,
  perpAbiVersionForProgramHash,
  perpAbiVersions,
  perpProgramCodeHash,
  registerPerpAbiVersion,
  registerPerpProgramHash,
  assertPerpSupports,
  type PerpAbiVersion,
} from './index';

const REPO = fileURLToPath(new URL('../../../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`);

function key(id: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = id;
  bytes[31] = 0xa0 + id;
  return bytes;
}
const address = (id: number) => Pubkey.from(key(id)).toThruFmt();

/* One logical market state, written in either layout. */
interface SeatFixture {
  authority: number;
  quantityQuote: bigint;
  longLots: bigint;
  shortLots: bigint;
  entryNotional: bigint;
  /** Current layout only. */
  cross?: boolean;
  fundingSnapshot?: bigint;
  fundingCarry?: number;
}

const SEATS: SeatFixture[] = [
  { authority: 20, quantityQuote: 50_000_000n, longLots: 10n, shortLots: 0n, entryNotional: 85_000_000n },
  { authority: 21, quantityQuote: 9_000_000n, longLots: 0n, shortLots: 4n, entryNotional: 34_000_000n },
];

/** The market header's first 320 bytes, identical in every version. */
function writeM2Header(data: Uint8Array): void {
  const view = new DataView(data.buffer, data.byteOffset);
  data[0] = PERP_MARKET_MAGIC;
  data[1] = 0x02;
  view.setBigUint64(8, 1n, true); /* lot_size */
  view.setBigUint64(16, 1_000n, true); /* tick_size */
  view.setBigUint64(24, 77n, true); /* next_order_id */
  view.setBigUint64(32, 200_000_000n, true); /* price_cap */
  view.setBigUint64(40, 1_000_000n, true); /* max_position_lots */
  view.setBigUint64(48, 14n, true); /* open_interest_lots */
  view.setBigUint64(56, 0n, true); /* bad_debt */
  for (const [offset, id] of [[64, 1], [96, 2], [128, 3], [160, 4], [192, 5], [224, 6]] as const) data.set(key(id), offset);
  view.setBigUint64(256, 100_000n, true); /* mark_num */
  view.setBigUint64(264, 1n, true); /* mark_den */
  view.setUint32(272, 500, true); /* initial_margin_bps */
  view.setUint32(276, 250, true); /* maintenance_margin_bps */
  view.setUint32(280, 100, true); /* liquidation_fee_bps */
  view.setInt32(284, -8, true); /* oracle_exponent */
  view.setBigUint64(288, 60_000_000_000n, true); /* max_mark_age_ns */
}

/** A seat arena as the given program version writes it. */
function seatArena(layout: '0.2' | 'current', options: { funding?: boolean; haircut?: number; seats?: SeatFixture[] } = {}): Uint8Array {
  const seats = options.seats ?? SEATS;
  const data = new Uint8Array(PERP_SEAT_ARENA_ENTRIES_OFFSET + seats.length * PERP_SEAT_ENTRY_SIZE);
  const view = new DataView(data.buffer);
  writeM2Header(data);
  if (layout === 'current' && options.funding) {
    view.setBigInt64(320, 1_250_000n, true); /* funding_index lo */
    view.setBigUint64(344, 3_600_000_000_000n, true); /* funding_last_round_ns */
    view.setBigInt64(376, 12n, true); /* funding_rate */
    view.setUint32(392, 40_000, true); /* clamp_big */
    view.setUint32(396, 100, true); /* premium_multiplier */
    view.setBigUint64(368, 19_400n, true); /* impact_notional */
  }
  if (layout === 'current' && options.haircut) view.setUint32(404, options.haircut, true);
  view.setUint32(PERP_SEAT_MANAGER_RESERVED_SIZE + 116, seats.length + 1, true); /* next_entry_idx */
  seats.forEach((seat, i) => {
    const at = PERP_SEAT_ARENA_ENTRIES_OFFSET + i * PERP_SEAT_ENTRY_SIZE;
    data.set(key(seat.authority), at);
    view.setBigUint64(at + 32, BigInt.asUintN(64, seat.quantityQuote), true);
    view.setBigUint64(at + 40, seat.longLots, true);
    view.setBigUint64(at + 48, seat.shortLots, true);
    view.setBigUint64(at + 80, seat.entryNotional, true);
    if (layout === 'current') {
      view.setUint32(at + 76, seat.fundingCarry ?? 0, true);
      view.setBigInt64(at + 104, seat.fundingSnapshot ?? 0n, true);
      view.setBigUint64(at + 120, seat.cross ? 3n : 1n, true); /* flags */
    } else {
      view.setBigUint64(at + 120, 1n, true); /* non_nullable_reserved */
    }
  });
  return data;
}

/* The fields every version's seat has (the domain model's core). */
const core = (seat: PerpSeatEntry) => {
  const { fundingSnapshot: _snapshot, fundingCarry: _carry, ...rest } = seat;
  return rest;
};

function abiAccount(yaml: string | Uint8Array): Uint8Array {
  const contents = typeof yaml === 'string' ? new TextEncoder().encode(yaml) : yaml;
  const data = new Uint8Array(45 + contents.length);
  const view = new DataView(data.buffer);
  data.set(key(90), 0); /* abi meta account */
  view.setBigUint64(32, 0n, true); /* revision */
  data[40] = 1; /* finalized */
  view.setUint32(41, contents.length, true);
  data.set(contents, 45);
  return data;
}

describe('perp ABI version registry', () => {
  it('registers 0.2.0 to 0.5.0, oldest first, 0.5.0 latest', () => {
    expect(perpAbiVersions().map((version) => version.id)).toEqual(['perp-abi@0.2.0', 'perp-abi@0.3.0', 'perp-abi@0.4.0', 'perp-abi@0.5.0']);
    expect(PERP_ABI_LATEST).toBe(PERP_ABI_V0_5);
    expect(getPerpAbiVersion('0.3.0')).toBe(PERP_ABI_V0_3);
    expect(getPerpAbiVersion('perp-abi@0.2.0')).toBe(PERP_ABI_V0_2);
    expect(() => getPerpAbiVersion('0.9.0')).toThrow('unknown perp ABI version 0.9.0');
  });

  it('exposes feature flags per version', () => {
    const flags = (version: PerpAbiVersion) => version.features;
    expect(flags(PERP_ABI_V0_2)).toEqual({
      oracleMargin: true, liquidation: true, funding: false, settleFunding: false, crossMargin: false, sharedVaults: false, crossUpnlHaircut: false,
      lossWaterfall: false, tradingFees: false,
    });
    expect(flags(PERP_ABI_V0_3)).toMatchObject({ funding: true, settleFunding: true, crossMargin: false, sharedVaults: false, lossWaterfall: false, tradingFees: false });
    expect(flags(PERP_ABI_V0_4)).toMatchObject({ crossMargin: true, sharedVaults: true, crossUpnlHaircut: true, lossWaterfall: false, tradingFees: false });
    expect(() => assertPerpSupports(PERP_ABI_V0_4, 'tradingFees', 'a builder code')).toThrow('a builder code needs tradingFees, which perp ABI 0.4.0');
    expect(Object.values(flags(PERP_ABI_V0_5)).every(Boolean)).toBe(true);
    expect(() => assertPerpSupports(PERP_ABI_V0_4, 'lossWaterfall', 'resolve')).toThrow('resolve needs lossWaterfall, which perp ABI 0.4.0');
    expect(() => assertPerpSupports(PERP_ABI_V0_2, 'crossMargin', 'link')).toThrow('link needs crossMargin, which perp ABI 0.2.0');
    expect(() => assertPerpSupports(PERP_ABI_V0_4, 'crossMargin')).not.toThrow();
  });

  it('takes instruction and event tags from each version\'s generated types', () => {
    expect(PERP_ABI_V0_2.instructions.has(PERP_INSTRUCTION_LIQUIDATE)).toBe(true);
    expect(PERP_ABI_V0_2.instructions.has(PERP_INSTRUCTION_FUNDING_UPDATE)).toBe(false);
    expect(PERP_ABI_V0_3.instructions.has(PERP_INSTRUCTION_SETTLE_FUNDING)).toBe(true);
    expect(PERP_ABI_V0_3.instructions.has(PERP_INSTRUCTION_MARGIN_RECORD)).toBe(false);
    expect(PERP_ABI_V0_4.instructions.has(PERP_INSTRUCTION_MARKET_SET_CROSS)).toBe(true);
    expect([PERP_ABI_V0_2, PERP_ABI_V0_3, PERP_ABI_V0_4, PERP_ABI_V0_5].map((version) => version.instructions.size)).toEqual([15, 18, 25, 32]);
    const feeTags = [PERP_INSTRUCTION_MARKET_SET_FEES, PERP_INSTRUCTION_FEE_CLAIM, PERP_INSTRUCTION_SEAT_SET_FEE_RECEIVER, PERP_INSTRUCTION_SEAT_SET_BUILDER_APPROVAL];
    expect(feeTags).toEqual([0x1c, 0x1d, 0x1f, 0x20]);
    expect(feeTags.some((tag) => PERP_ABI_V0_4.instructions.has(tag) || PERP_ABI_V0_3.instructions.has(tag))).toBe(false);
    expect(feeTags.every((tag) => PERP_ABI_V0_5.instructions.has(tag))).toBe(true);
    expect(PERP_ABI_V0_4.events.has(PERP_EVENT_FEE)).toBe(false);
    expect(PERP_ABI_V0_5.events.has(PERP_EVENT_FEE)).toBe(true);
    expect(PERP_ABI_V0_4.instructions.has(PERP_INSTRUCTION_INSURANCE_DEPOSIT)).toBe(false);
    expect(PERP_ABI_V0_5.instructions.has(PERP_INSTRUCTION_INSURANCE_DEPOSIT)).toBe(true);
    expect(PERP_ABI_V0_4.events.has(PERP_EVENT_LOSS) || PERP_ABI_V0_4.events.has(PERP_EVENT_INSURANCE)).toBe(false);
    expect(PERP_ABI_V0_5.events.has(PERP_EVENT_LOSS) && PERP_ABI_V0_5.events.has(PERP_EVENT_INSURANCE)).toBe(true);
    expect(PERP_ABI_V0_2.events.has(PERP_EVENT_LIQUIDATION) && !PERP_ABI_V0_2.events.has(PERP_EVENT_FUNDING_ROUND)).toBe(true);
    expect(PERP_ABI_V0_3.events.has(PERP_EVENT_FUNDING_ROUND) && !PERP_ABI_V0_3.events.has(PERP_EVENT_MARGIN)).toBe(true);
    expect(PERP_ABI_V0_4.events.has(PERP_EVENT_MARGIN)).toBe(true);
  });

  it('describes layouts that agree with the SDK constants', () => {
    expect(PERP_CURRENT_LAYOUT).toEqual({
      marketHeaderSize: PERP_MARKET_ACCOUNT_SIZE,
      seatArenaReservedSize: PERP_SEAT_MANAGER_RESERVED_SIZE,
      seatArenaHeaderSize: PERP_SEAT_ARENA_HEADER_SIZE,
      seatArenaEntriesOffset: PERP_SEAT_ARENA_ENTRIES_OFFSET,
      seatEntrySize: PERP_SEAT_ENTRY_SIZE,
      orderArenaEntriesOffset: PERP_ORDER_ARENA_ENTRIES_OFFSET,
      orderEntrySize: PERP_ORDER_ENTRY_SIZE,
      cbookHeaderSize: PERP_CBOOK_HEADER_SIZE,
      cbookLevelSize: PERP_CBOOK_LEVEL_SIZE,
      exchangeMetaSize: PERP_EXCHANGE_META_ACCOUNT_SIZE,
      marginAccountSize: PERP_MARGIN_ACCOUNT_SIZE,
    });
    expect(PERP_ABI_V0_2.layout).toMatchObject({ marketHeaderSize: 320, seatEntrySize: 128, seatArenaEntriesOffset: 640, marginAccountSize: null });
    expect(PERP_ABI_V0_4.layout).toEqual({ ...PERP_CURRENT_LAYOUT, marketHeaderSize: 448 });
    expect(PERP_ABI_V0_5.layout).toBe(PERP_CURRENT_LAYOUT);
    expect(PERP_ABI_V0_3.layout.marginAccountSize).toBeNull();
  });

  it('refuses a mismatched id and a hash registered twice', () => {
    expect(() => registerPerpAbiVersion({ ...PERP_ABI_V0_4, id: 'perp-abi@9.9.9' })).toThrow('does not match');
    expect(() => registerPerpProgramHash(PERP_ABI_V0_2.programHashes[0]!, 'perp-abi@0.4.0')).toThrow('already registered');
    expect(() => registerPerpProgramHash('xyz', 'perp-abi@0.4.0')).toThrow('64 hex digits');
  });
});

describe('perp ABI version detection', () => {
  it('reads package, package-version and abi-version from the ABI yaml', () => {
    expect(parsePerpAbiYamlHeader(read('thru-perps/abi/tn_perp_program.abi.yaml'))).toEqual({ package: 'thru.program.perp', packageVersion: '0.5.0', abiVersion: 1 });
    expect(perpAbiVersionForPackageVersion('0.5.0')).toBe(PERP_ABI_V0_5);
    const v02 = readFileSync(fileURLToPath(new URL('./v0_2/tn_perp_program.abi.yaml', import.meta.url)));
    expect(parsePerpAbiYamlHeader(v02).packageVersion).toBe('0.2.0');
    expect(perpAbiVersionForPackageVersion('0.4.0')).toBe(PERP_ABI_V0_4);
  });

  it('hashes the Betanet 0.2.0 binary to its registered version', async () => {
    const code = read('thru-perps/tests/test_txn_perp_program/fixtures/tn_perp_program_v0.bin');
    const hash = await perpProgramCodeHash(code);
    expect(hash).toBe(createHash('sha256').update(code).digest('hex'));
    expect(hash).toBe('691a5046ffebb17a512da0d0d5ef132a88cd95eda80065d65ace9a6078534db9');
    expect(perpAbiVersionForProgramHash(hash)).toBe(PERP_ABI_V0_2);
    expect(await detectPerpAbiVersion({ programCode: code })).toMatchObject({ version: PERP_ABI_V0_2, source: 'program-hash', abiAccountStale: false });
  });

  it('prefers the program hash and flags an ABI account the upgrade left behind', async () => {
    /* Betanet after 2026-10-15: 0.4.0 code, the 0.2.0 ABI account. */
    const detection = await detectPerpAbiVersion({
      programHash: 'B1DC5AEE0B30CB837BFA704E4D1F7BEDF4BBD11956ADCCD8BAC850BB3869D467',
      abiAccountData: abiAccount('abi:\n  package: thru.program.perp\n  abi-version: 1\n  package-version: "0.2.0"\ntypes: []\n'),
    });
    expect(detection).toMatchObject({ version: PERP_ABI_V0_4, source: 'program-hash', abiPackageVersion: '0.2.0', abiAccountStale: true });
  });

  it('falls back to the ABI account, then to an explicit fallback', async () => {
    const unknown = 'ab'.repeat(32);
    const yaml = 'abi:\n  package: thru.program.perp\n  name: "Perp Program"\n  abi-version: 1\n  package-version: "0.3.0"\n';
    expect(await detectPerpAbiVersion({ programHash: unknown, abiYaml: yaml })).toMatchObject({ version: PERP_ABI_V0_3, source: 'abi-account' });
    await expect(detectPerpAbiVersion({ programHash: unknown })).rejects.toThrow('is not registered');
    expect(await detectPerpAbiVersion({ programHash: unknown, fallback: '0.4.0' })).toMatchObject({ version: PERP_ABI_V0_4, source: 'fallback' });
    await expect(detectPerpAbiVersion({ abiYaml: 'abi:\n  package: thru.program.clob\n  package-version: "0.4.0"\n' })).rejects.toThrow('not thru.program.perp');
  });

  it('reads the program account, and the ABI account only for an unknown hash', async () => {
    const code = read('thru-perps/tests/test_txn_perp_program/fixtures/tn_perp_program_v0.bin');
    const reads: string[] = [];
    const accounts = new Map<string, Uint8Array>([[address(1), code]]);
    const thru = {
      accounts: {
        async get(addr: string) {
          reads.push(addr);
          const data = accounts.get(addr);
          if (!data) throw new Error('account not found');
          return { data: { data } } as never;
        },
      },
    };
    expect((await fetchPerpAbiVersion(thru, { programAddress: address(1) })).version).toBe(PERP_ABI_V0_2);
    expect(reads).toEqual([address(1)]);

    accounts.set(address(2), new Uint8Array([1, 2, 3]));
    accounts.set(address(3), abiAccount('abi:\n  package: thru.program.perp\n  package-version: "0.4.0"\n'));
    reads.length = 0;
    const detection = await fetchPerpAbiVersion(thru, { programAddress: address(2), abiAccountAddress: address(3) });
    expect(detection).toMatchObject({ version: PERP_ABI_V0_4, source: 'abi-account' });
    expect(reads).toEqual([address(2), address(3)]);
    expect((await fetchPerpAbiVersion(thru, { programAddress: address(2), abiAccountAddress: address(4), assumeLatest: true })).source).toBe('fallback');
  });
});

describe('per-version decoders into one domain model', () => {
  it('decodes a 0.2.0 arena and the same state in the current layout to the same market and seats', () => {
    const old = PERP_ABI_V0_2.decode.seatArena(seatArena('0.2'));
    const now = PERP_ABI_V0_4.decode.seatArena(seatArena('current'));
    const { funding, crossUpnlHaircutBps, ...nowMarket } = now.market;
    expect(old.market).toEqual(nowMarket);
    expect(old.market.funding).toBeUndefined();
    expect(funding?.premiumMultiplier).toBe(0);
    expect(crossUpnlHaircutBps).toBe(0);
    expect(old.seats.map(core)).toEqual(now.seats.map(core));
    expect(old.seats[0]).toMatchObject({ seatIndex: 1, seatAuthority: address(20), cross: false, quantityQuote: 50_000_000n });
    expect(old.seats[0]!.fundingSnapshot).toBeUndefined();
    expect(old.header).toEqual(now.header);
    /* The margin math runs on either. */
    expect(perpEquity(old.market, old.seats[0]!, 9n)).toBe(perpEquity(now.market, now.seats[0]!, 9n));
  });

  it('reads an upgraded-in-place 0.2.0 arena under 0.4.0 with funding off and no cross seats', () => {
    const upgraded = PERP_ABI_V0_4.decode.seatArena(seatArena('0.2'));
    expect(upgraded.market.funding).toMatchObject({ premiumMultiplier: 0, index: 0n });
    expect(upgraded.seats.every((seat) => seat.cross === false && seat.fundingSnapshot === 0n)).toBe(true);
  });

  it('decodes cross seats and haircuts under 0.4.0 only', () => {
    const crossSeats = [{ ...SEATS[0]!, cross: true, quantityQuote: -2_000n }, SEATS[1]!];
    const arena = seatArena('current', { funding: true, haircut: 2_500, seats: crossSeats });
    const now = PERP_ABI_V0_4.decode.seatArena(arena);
    expect(now.market.crossUpnlHaircutBps).toBe(2_500);
    expect(now.market.funding).toMatchObject({ index: 1_250_000n, rate: 12n, premiumMultiplier: 100 });
    expect(now.seats[0]).toMatchObject({ cross: true, quantityQuote: -2_000n });
    expect(() => PERP_ABI_V0_3.decode.seatArena(arena)).toThrow('a cross seat cannot exist under perp ABI 0.3.0');

    const funded = seatArena('current', { funding: true, haircut: 0 });
    const v03 = PERP_ABI_V0_3.decode.seatArena(funded);
    expect('crossUpnlHaircutBps' in v03.market).toBe(false);
    expect(v03.market.funding?.rate).toBe(12n);
    expect(v03.seats.map(core)).toEqual(PERP_ABI_V0_4.decode.seatArena(funded).seats.map(core));
    /* An account's totals run on decoded seats of any version. */
    const totals = perpCrossTotals(now.seats.map((seat) => ({ market: now.market, seat, mark: 8_400n })));
    expect(totals.collateral).toBe(-2_000n + 9_000_000n);
  });

  it('decodes one seat entry on its own, per version', () => {
    const old = seatArena('0.2');
    const entry = old.subarray(PERP_SEAT_ARENA_ENTRIES_OFFSET, PERP_SEAT_ARENA_ENTRIES_OFFSET + PERP_SEAT_ENTRY_SIZE);
    expect(PERP_ABI_V0_2.decode.seatEntry(entry, 1)).toEqual(PERP_ABI_V0_2.decode.seatArena(old).seats[0]);
    expect(PERP_ABI_V0_2.decode.seatEntry(new Uint8Array(PERP_SEAT_ENTRY_SIZE), 2)).toBeNull();
    const now = seatArena('current');
    expect(PERP_ABI_V0_4.decode.seatEntry(now.subarray(PERP_SEAT_ARENA_ENTRIES_OFFSET + PERP_SEAT_ENTRY_SIZE), 2)).toEqual(
      PERP_ABI_V0_4.decode.seatArena(now).seats[1],
    );
  });

  it('reads the 320 byte market header alone under 0.2.0', () => {
    const header = seatArena('0.2').subarray(0, 320);
    expect(PERP_ABI_V0_2.decode.market(header)).toMatchObject({ lotSize: 1n, tickSize: 1_000n, initialMarginBps: 500 });
    expect(() => PERP_ABI_V0_4.decode.market(header)).toThrow('at least 448 bytes under perp ABI 0.4.0');
  });

  it('reads the 448 byte market header alone before 0.5.0; 0.5.0 needs 512', () => {
    const arena = seatArena('current', { funding: true, haircut: 0 });
    const header = arena.subarray(0, PERP_ABI_V0_4.layout.marketHeaderSize);
    for (const version of [PERP_ABI_V0_3, PERP_ABI_V0_4]) {
      expect(version.layout.marketHeaderSize).toBe(448);
      expect(version.decode.market(header)).toEqual(version.decode.seatArena(arena).market);
      expect(() => version.decode.market(header.subarray(0, 447))).toThrow('at least 448 bytes');
    }
    expect(() => PERP_ABI_V0_5.decode.market(header)).toThrow('at least 512 bytes');
  });

  it('reads the loss waterfall state under 0.5.0 only; 0.4.0 markets read it as off', () => {
    const arena = seatArena('current', { funding: true, haircut: 0 });
    const view = new DataView(arena.buffer, arena.byteOffset, arena.byteLength);
    view.setUint16(4, 300, true);              /* socialize_cap_bps */
    view.setBigUint64(416, 5_000n, true);      /* insurance_balance */
    view.setBigUint64(448, 1_000_000n, true);  /* loss_offset_long */
    const now = PERP_ABI_V0_5.decode.seatArena(arena);
    expect(now.market.risk).toMatchObject({ socializeCapBps: 300, insuranceBalance: 5_000n, lossOffsetLong: 1_000_000n, lossOffsetShort: 0n });
    expect('risk' in PERP_ABI_V0_4.decode.seatArena(arena).market).toBe(false);
    expect('risk' in PERP_ABI_V0_4.decode.market(arena)).toBe(false);
    /* Under 0.4.0 bytes 448.. were reserved and zero: an upgraded market
       reads as the same market with nothing held and nothing charged. */
    const upgraded = seatArena('current', { funding: true, haircut: 0 });
    expect(PERP_ABI_V0_5.decode.seatArena(upgraded).market.risk).toMatchObject({ insuranceBalance: 0n, lossOffsetLong: 0n, lossOffsetShort: 0n });
    expect(PERP_ABI_V0_5.decode.seatArena(upgraded).seats.map(core)).toEqual(PERP_ABI_V0_4.decode.seatArena(upgraded).seats.map(core));
  });

  it('reads the fee state under 0.5.0 only; 0.4.0 drops it', () => {
    /* A fee seat and a seat approving it (flags bits 2, 8-21 and 22-41). */
    const arena = seatArena('current', { funding: true, haircut: 0 });
    const view = new DataView(arena.buffer, arena.byteOffset, arena.byteLength);
    view.setUint32(296, 300, true);                     /* taker_fee_ppm */
    view.setUint32(304, 50, true);                      /* builder_fee_cap_ppm */
    view.setUint32(488, 600, true);                     /* pending_taker_fee_ppm */
    view.setBigUint64(496, 3_600_000_000_000n, true);   /* pending_activation_ns */
    const flags = (seat: number) => PERP_SEAT_ARENA_ENTRIES_OFFSET + (seat - 1) * PERP_SEAT_ENTRY_SIZE + 120;
    view.setBigUint64(flags(1), 1n | 4n, true);
    view.setBigUint64(flags(2), 1n | (40n << 8n) | (1n << 22n), true);
    const now = PERP_ABI_V0_5.decode.seatArena(arena);
    expect(now.market.fees).toEqual({
      takerFeePpm: 300, makerRebatePpm: 0, builderFeeCapPpm: 50, feeInsuranceSharePpm: 0, liqInsuranceSharePpm: 0,
      pendingTakerFeePpm: 600, pendingBuilderFeeCapPpm: 0, pendingActivationNs: 3_600_000_000_000n,
    });
    expect(now.seats[0]).toMatchObject({ feeReceiver: true });
    expect(now.seats[0]!.builderApproval).toBeUndefined();
    expect(now.seats[1]).toMatchObject({ builderApproval: { builderSeatIndex: 1, maxFeePpm: 40 } });
    expect('feeReceiver' in now.seats[1]!).toBe(false);
    const entry = (seat: number) => arena.subarray(flags(seat) - 120, flags(seat) + 8);
    expect(PERP_ABI_V0_5.decode.seatEntry(entry(2), 2)).toEqual(now.seats[1]);

    const before = PERP_ABI_V0_4.decode.seatArena(arena);
    expect('fees' in before.market || 'fees' in PERP_ABI_V0_4.decode.market(arena)).toBe(false);
    expect(before.seats.some((seat) => 'feeReceiver' in seat || 'builderApproval' in seat)).toBe(false);
    expect(before.slots[1]!.entry).toBe(before.seats[1]);
    expect(PERP_ABI_V0_4.decode.seatEntry(entry(2), 2)).toEqual(before.seats[1]);
    expect(PERP_ABI_V0_3.decode.seatArena(arena).seats.some((seat) => 'builderApproval' in seat)).toBe(false);

    /* An order entry's builder code: u32 seat index at 32, u16 ppm at 36. */
    const orders = new Uint8Array(PERP_ORDER_ARENA_ENTRIES_OFFSET + PERP_ORDER_ENTRY_SIZE);
    const ov = new DataView(orders.buffer);
    ov.setUint32(8 + 52, 2, true);                                    /* next_entry_idx */
    ov.setBigUint64(PERP_ORDER_ARENA_ENTRIES_OFFSET + 16, 3n, true);  /* qty_in_lots */
    ov.setUint32(PERP_ORDER_ARENA_ENTRIES_OFFSET + 32, 1, true);      /* builder seat */
    ov.setUint16(PERP_ORDER_ARENA_ENTRIES_OFFSET + 36, 25, true);     /* builder ppm */
    ov.setBigInt64(PERP_ORDER_ARENA_ENTRIES_OFFSET + 56, 9_000n, true);
    expect(PERP_ABI_V0_5.decode.orderArena(orders).orders[0]!.builder).toEqual({ builderSeatIndex: 1, feePpm: 25 });
    const old = PERP_ABI_V0_4.decode.orderArena(orders);
    expect('builder' in old.orders[0]!).toBe(false);
    expect(old.slots[0]!.entry).toBe(old.orders[0]);
    expect(old.orders[0]).toMatchObject({ quantityInLots: 3n, expirationTime: 9_000n });
  });

  it('refuses margin accounts and later events on versions without them', () => {
    expect(() => PERP_ABI_V0_2.decode.marginAccount(new Uint8Array(PERP_MARGIN_ACCOUNT_SIZE))).toThrow('0.2.0 has no margin accounts');
    expect(() => PERP_ABI_V0_3.decode.marginAccount(new Uint8Array(PERP_MARGIN_ACCOUNT_SIZE))).toThrow('0.3.0 has no margin accounts');

    const liquidation = new Uint8Array(8 + 96 + 8 + 48 + 8);
    new DataView(liquidation.buffer).setBigUint64(0, BigInt(PERP_EVENT_LIQUIDATION), true);
    liquidation.set(key(50), 8);
    for (const version of [PERP_ABI_V0_2, PERP_ABI_V0_3, PERP_ABI_V0_4]) {
      expect(version.decode.event(liquidation)).toMatchObject({ variant: 'liquidation', market: address(50), targetSide: 'long' });
    }
    const funding = new Uint8Array(8 + 32 + 8 + 8 + 4 + 4 + 8 + 16 + 8);
    new DataView(funding.buffer).setBigUint64(0, BigInt(PERP_EVENT_FUNDING_ROUND), true);
    expect(() => PERP_ABI_V0_2.decode.event(funding)).toThrow('not in ABI 0.2.0');
    expect(PERP_ABI_V0_3.decode.event(funding).variant).toBe('funding_round');
    const margin = new Uint8Array(8 + 152);
    new DataView(margin.buffer).setBigUint64(0, BigInt(PERP_EVENT_MARGIN), true);
    expect(() => PERP_ABI_V0_3.decode.event(margin)).toThrow('0.3.0 has no margin event');
    expect(PERP_ABI_V0_4.decode.event(margin).variant).toBe('margin');
    /* LOSS: type, market, nine u64 (deficit .. insurance_after), epoch,
       side, cause, 2 reserved. */
    const loss = new Uint8Array(8 + 32 + 10 * 8 + 4 + 1 + 1 + 2);
    const lv = new DataView(loss.buffer);
    lv.setBigUint64(0, BigInt(PERP_EVENT_LOSS), true);
    loss.set(key(51), 8);
    lv.setBigUint64(40, 1_000n, true);  /* deficit */
    lv.setBigUint64(56, 600n, true);    /* ins_cover */
    lv.setBigUint64(64, 400n, true);    /* soc_cover */
    lv.setUint8(124, 3);                /* side: both */
    lv.setUint8(125, 1);                /* cause: write-off */
    expect(() => PERP_ABI_V0_4.decode.event(loss)).toThrow('0.4.0 has no loss event');
    expect(PERP_ABI_V0_5.decode.event(loss)).toMatchObject({
      variant: 'loss', market: address(51), deficit: 1_000n, insuranceCover: 600n, socializedCover: 400n, chargedSide: 'both', cause: 'write_off',
    });
    const insurance = new Uint8Array(8 + 32 + 8 + 8 + 4 + 1 + 3);
    new DataView(insurance.buffer).setBigUint64(0, BigInt(PERP_EVENT_INSURANCE), true);
    expect(() => PERP_ABI_V0_4.decode.event(insurance)).toThrow('0.4.0 has no insurance event');
    expect(PERP_ABI_V0_5.decode.event(insurance)).toMatchObject({ variant: 'insurance', kind: 'deposit' });
    /* FEE: type, market, seat, builder seat, kind, fill count, 2 reserved,
       three u32 rates, eleven u64 amounts and two u64[2] fill maps. */
    const fee = new Uint8Array(8 + 176);
    new DataView(fee.buffer).setBigUint64(0, BigInt(PERP_EVENT_FEE), true);
    expect(() => PERP_ABI_V0_4.decode.event(fee)).toThrow('0.4.0 has no fee event');
    expect(() => PERP_ABI_V0_3.decode.event(fee)).toThrow('has no fee event');
    expect(PERP_ABI_V0_5.decode.event(fee)).toMatchObject({ variant: 'fee', kind: 'trade' });
  });
});
