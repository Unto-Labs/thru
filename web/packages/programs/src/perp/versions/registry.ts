import { PerpEvent as PerpEventView, PerpInstruction as PerpInstructionView } from '../abi/thru/program/perp/types';
import { PERP_CURRENT_LAYOUT, PERP_PRE_WATERFALL_MARKET_HEADER_SIZE, currentPerpDecoder, withoutCrossMargin, withoutLossWaterfall } from './current';
import type { PerpAbiVersion, PerpAbiVersionId, PerpFeature, PerpFeatureFlags } from './model';
import { PERP_V0_2_LAYOUT, perpV02Decoder } from './v0_2/decoder';
import { PerpEvent as PerpEventV02, PerpInstruction as PerpInstructionV02 } from './v0_2/abi/thru/program/perp/types';

/* The perp program's ABI versions, oldest first.  Each is a first class
   version: its own feature flags, layouts, instruction and event sets and
   decoders into the shared domain model.  VERSIONS.md (next to this file)
   says how to add one. */

/* Instruction and event tags come from each version's generated types
   (the variants of PerpInstruction and PerpEvent in its ABI yaml), never
   from a hand list.  0.3.0 has no generated module of its own: its ABI is
   0.4.0's without the cross margin variants. */
const tagsOf = (variants: ReadonlyArray<{ name: string; tag: number }>, except: readonly string[] = []) =>
  new Set(variants.filter((variant) => !except.includes(variant.name)).map((variant) => variant.tag));
const CROSS_INSTRUCTION_NAMES = [
  'margin_account_create',
  'margin_record',
  'margin_link',
  'margin_unlink',
  'margin_transfer',
  'market_set_vault',
  'market_set_cross',
];

/* 0.5.0 adds the loss waterfall and trading fees; the versions before it
   have neither. */
const WATERFALL_INSTRUCTION_NAMES = [
  'insurance_deposit',
  'resolve_bad_debt',
  'market_set_risk_params',
  'market_set_fees',
  'fee_claim',
  'seat_set_fee_receiver',
  'seat_set_builder_approval',
];
const WATERFALL_EVENT_NAMES = ['loss', 'insurance', 'fee'];

/* The layout the versions before 0.5.0 read through: the current one with
   the market header they knew (448 bytes; 0.5.0 grew it into reserved
   bytes they held at zero). */
const PRE_WATERFALL_LAYOUT = Object.freeze({ ...PERP_CURRENT_LAYOUT, marketHeaderSize: PERP_PRE_WATERFALL_MARKET_HEADER_SIZE });

const NO_FEATURES: PerpFeatureFlags = {
  oracleMargin: false,
  liquidation: false,
  funding: false,
  settleFunding: false,
  crossMargin: false,
  sharedVaults: false,
  crossUpnlHaircut: false,
  lossWaterfall: false,
  tradingFees: false,
};

export const PERP_ABI_V0_2: PerpAbiVersion = Object.freeze({
  id: 'perp-abi@0.2.0',
  abiPackageVersion: '0.2.0',
  abiFormatVersion: 1,
  label: 'oracle mark, initial / maintenance margin, liquidation',
  programHashes: Object.freeze([
    /* main-thru 37f19f816: Betanet until the 2026-10-15 upgrade
       (thru-perps/tests/test_txn_perp_program/fixtures/tn_perp_program_v0.bin). */
    '691a5046ffebb17a512da0d0d5ef132a88cd95eda80065d65ace9a6078534db9',
    /* The Alphanet perps-demo deployment of 2026-09-22 (MIGRATION.md). */
    'aa1ca5cc0a873b4a9e1a241c85003c5041552c20bc708b12319cb38e637caa5f',
  ]),
  features: Object.freeze({ ...NO_FEATURES, oracleMargin: true, liquidation: true }),
  layout: PERP_V0_2_LAYOUT,
  instructions: tagsOf(PerpInstructionV02.payloadVariantDescriptors),
  events: tagsOf(PerpEventV02.payloadVariantDescriptors),
  decode: perpV02Decoder,
});

export const PERP_ABI_V0_3: PerpAbiVersion = Object.freeze({
  id: 'perp-abi@0.3.0',
  abiPackageVersion: '0.3.0',
  abiFormatVersion: 1,
  label: 'hourly funding on Lighter\'s model',
  /* Never deployed on a public network; recognized by its ABI account. */
  programHashes: Object.freeze([]),
  features: Object.freeze({ ...NO_FEATURES, oracleMargin: true, liquidation: true, funding: true, settleFunding: true }),
  layout: Object.freeze({ ...PRE_WATERFALL_LAYOUT, marginAccountSize: null }),
  instructions: tagsOf(PerpInstructionView.payloadVariantDescriptors, [...CROSS_INSTRUCTION_NAMES, ...WATERFALL_INSTRUCTION_NAMES]),
  events: tagsOf(PerpEventView.payloadVariantDescriptors, ['margin', ...WATERFALL_EVENT_NAMES]),
  decode: withoutCrossMargin(withoutLossWaterfall(currentPerpDecoder, '0.3.0'), '0.3.0'),
});

export const PERP_ABI_V0_4: PerpAbiVersion = Object.freeze({
  id: 'perp-abi@0.4.0',
  abiPackageVersion: '0.4.0',
  abiFormatVersion: 1,
  label: 'cross margin accounts over markets sharing a quote vault',
  programHashes: Object.freeze([
    /* tm/perps-cross-margin (#4917): Betanet since the 2026-10-15 upgrade. */
    'b1dc5aee0b30cb837bfa704e4d1f7bedf4bbd11956adccd8bac850bb3869d467',
    /* tm/perps-all (#5022): cross margin, funding crank, order state units, order fast path. */
    '26e4738865a00a3b330e5273dc35436513ce9bc098369b4eb1b26a1d2786fa1f',
    /* The safety fixes (#5070): Betanet since the 2026-10-19 upgrade
       (thru-perps/tests/test_txn_perp_program/fixtures/tn_perp_program_v3.bin). */
    '1df993f3db590823fbb3299f239a1d738dbb3d5c0759b1afe6f3ba935054f6e5',
  ]),
  features: Object.freeze({
    oracleMargin: true,
    liquidation: true,
    funding: true,
    settleFunding: true,
    crossMargin: true,
    sharedVaults: true,
    crossUpnlHaircut: true,
    lossWaterfall: false,
    tradingFees: false,
  }),
  layout: PRE_WATERFALL_LAYOUT,
  instructions: tagsOf(PerpInstructionView.payloadVariantDescriptors, WATERFALL_INSTRUCTION_NAMES),
  events: tagsOf(PerpEventView.payloadVariantDescriptors, WATERFALL_EVENT_NAMES),
  decode: withoutLossWaterfall(currentPerpDecoder, '0.4.0'),
});

export const PERP_ABI_V0_5: PerpAbiVersion = Object.freeze({
  id: 'perp-abi@0.5.0',
  abiPackageVersion: '0.5.0',
  abiFormatVersion: 1,
  label: 'loss waterfall (insurance fund, capped loss charges, bad debt freeze), trading fees and builder codes',
  /* Builds are added as they deploy (VERSIONS.md step 5); until then a
     deployment is recognized by its ABI account. */
  programHashes: Object.freeze([]),
  features: Object.freeze({
    oracleMargin: true,
    liquidation: true,
    funding: true,
    settleFunding: true,
    crossMargin: true,
    sharedVaults: true,
    crossUpnlHaircut: true,
    lossWaterfall: true,
    tradingFees: true,
  }),
  layout: PERP_CURRENT_LAYOUT,
  instructions: tagsOf(PerpInstructionView.payloadVariantDescriptors),
  events: tagsOf(PerpEventView.payloadVariantDescriptors),
  decode: currentPerpDecoder,
});

const versions = new Map<PerpAbiVersionId, PerpAbiVersion>();
const byHash = new Map<string, PerpAbiVersionId>();

/** Adds a version (or replaces one with the same id) and its program hashes. */
export function registerPerpAbiVersion(version: PerpAbiVersion): void {
  if (version.id !== `perp-abi@${version.abiPackageVersion}`) {
    throw new Error(`perp ABI version id ${version.id} does not match package-version ${version.abiPackageVersion}`);
  }
  versions.set(version.id, version);
  for (const hash of version.programHashes) registerPerpProgramHash(hash, version.id);
}

/** Maps a program code hash (sha256 hex of the program account data) to a
    registered version: for a build the SDK does not know yet (a local
    deployment, a release built after this SDK). */
export function registerPerpProgramHash(programHash: string, id: PerpAbiVersionId): void {
  const hash = normalizeHash(programHash);
  if (!versions.has(id)) throw new Error(`unknown perp ABI version ${id}`);
  const known = byHash.get(hash);
  if (known && known !== id) throw new Error(`program hash ${hash} is already registered as ${known}`);
  byHash.set(hash, id);
}

for (const version of [PERP_ABI_V0_2, PERP_ABI_V0_3, PERP_ABI_V0_4, PERP_ABI_V0_5]) registerPerpAbiVersion(version);

/** The newest registered version: what the SDK's generated types encode. */
export const PERP_ABI_LATEST: PerpAbiVersion = PERP_ABI_V0_5;

/** Every registered version, oldest first (by package-version). */
export function perpAbiVersions(): PerpAbiVersion[] {
  return [...versions.values()].sort((a, b) => compareSemver(a.abiPackageVersion, b.abiPackageVersion));
}

export function getPerpAbiVersion(id: PerpAbiVersionId | string): PerpAbiVersion {
  const version = versions.get(id as PerpAbiVersionId) ?? versions.get(`perp-abi@${id}`);
  if (!version) throw new Error(`unknown perp ABI version ${id} (known: ${[...versions.keys()].join(', ')})`);
  return version;
}

/** The version a program code hash implements, or null when unknown. */
export function perpAbiVersionForProgramHash(programHash: string): PerpAbiVersion | null {
  const id = byHash.get(normalizeHash(programHash));
  return id ? versions.get(id) ?? null : null;
}

/** The version of an ABI package-version ("0.4.0"), or null when unknown. */
export function perpAbiVersionForPackageVersion(packageVersion: string): PerpAbiVersion | null {
  return versions.get(`perp-abi@${packageVersion.trim()}`) ?? null;
}

export function perpSupports(version: PerpAbiVersion, feature: PerpFeature): boolean {
  return version.features[feature];
}

/** Throws a clear error when the version lacks `feature` (the transaction
    would fail on chain with an unknown instruction). */
export function assertPerpSupports(version: PerpAbiVersion, feature: PerpFeature, action: string = feature): void {
  if (!version.features[feature]) {
    throw new Error(`${action} needs ${feature}, which perp ABI ${version.abiPackageVersion} (${version.label}) does not have`);
  }
}

function normalizeHash(hash: string): string {
  const normalized = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`program hash must be 64 hex digits, got ${hash}`);
  return normalized;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
