import type { Account } from '@thru/sdk';
import { parseABIAccount } from '../../abi-manager/accounts';
import { deriveProgramABIAddresses } from '../../abi-manager/derivation';
import type { PerpAbiVersion, PerpAbiVersionDetection } from './model';
import {
  PERP_ABI_LATEST,
  getPerpAbiVersion,
  perpAbiVersionForPackageVersion,
  perpAbiVersionForProgramHash,
} from './registry';

/* Telling a deployment's ABI version from chain data.

   1. The program code hash (sha256 of the program account's data) is
      authoritative: the registry maps every known build to its version, and
      a deployment can register its own (registerPerpProgramHash).
   2. Otherwise the program's official ABI account (abi-manager, derived from
      the program address) names its yaml's `package: thru.program.perp` and
      `package-version`.  It is only a hint: an upgrade can skip it (Betanet
      kept the 0.2.0 ABI account under 0.4.0 code).
   3. Otherwise `fallback` (a version id), or an error.

   Account data carries no usable version: the exchange meta's version is 1
   in every release, markets and seats have none (an upgrade reads old bytes
   in place), and a margin account's version only exists from 0.4.0 on. */

export const PERP_ABI_PACKAGE = 'thru.program.perp';

export interface PerpAbiYamlInfo {
  package: string | null;
  packageVersion: string | null;
  abiVersion: number | null;
}

/** Reads `package`, `package-version` and `abi-version` from the `abi:`
    header of an ABI yaml (the text the ABI account holds). */
export function parsePerpAbiYamlHeader(yaml: string | Uint8Array): PerpAbiYamlInfo {
  const text = typeof yaml === 'string' ? yaml : new TextDecoder().decode(yaml);
  const header = text.split(/\r?\n(?=\S)/).find((block) => /^abi:\s*$/m.test(block.split(/\r?\n/)[0] ?? '')) ?? '';
  const field = (name: string): string | null => {
    const match = header.match(new RegExp(`^\\s+${name}:\\s*(.+?)\\s*$`, 'm'));
    return match ? match[1]!.replace(/^["']|["']$/g, '') : null;
  };
  const abiVersion = field('abi-version');
  return {
    package: field('package'),
    packageVersion: field('package-version'),
    abiVersion: abiVersion === null || !/^\d+$/.test(abiVersion) ? null : Number(abiVersion),
  };
}

/** sha256 (lowercase hex) of program code as the program account holds it. */
export async function perpProgramCodeHash(code: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', code as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface DetectPerpAbiVersionInput {
  /** sha256 hex of the program code (or give `programCode`). */
  programHash?: string | null;
  programCode?: Uint8Array | null;
  /** The ABI yaml text, or the raw data of the program's ABI account. */
  abiYaml?: string | Uint8Array | null;
  abiAccountData?: Account | Uint8Array | null;
  /** Version id used when neither source identifies one; absent: throw. */
  fallback?: PerpAbiVersion | string;
}

export async function detectPerpAbiVersion(input: DetectPerpAbiVersionInput): Promise<PerpAbiVersionDetection> {
  const programHash = input.programHash
    ? input.programHash.toLowerCase()
    : input.programCode
      ? await perpProgramCodeHash(input.programCode)
      : null;

  let abiPackageVersion: string | null = null;
  let yaml = input.abiYaml ?? null;
  if (!yaml && input.abiAccountData) yaml = parseABIAccount(input.abiAccountData).contents;
  if (yaml) {
    const info = parsePerpAbiYamlHeader(yaml);
    if (info.package !== PERP_ABI_PACKAGE) {
      throw new Error(`ABI account describes package ${info.package ?? '(none)'}, not ${PERP_ABI_PACKAGE}`);
    }
    abiPackageVersion = info.packageVersion;
  }
  const fromAbi = abiPackageVersion ? perpAbiVersionForPackageVersion(abiPackageVersion) : null;
  const fromHash = programHash ? perpAbiVersionForProgramHash(programHash) : null;

  if (fromHash) {
    return {
      version: fromHash,
      source: 'program-hash',
      programHash,
      abiPackageVersion,
      abiAccountStale: abiPackageVersion !== null && abiPackageVersion !== fromHash.abiPackageVersion,
    };
  }
  if (fromAbi) return { version: fromAbi, source: 'abi-account', programHash, abiPackageVersion, abiAccountStale: false };
  if (input.fallback) {
    const version = typeof input.fallback === 'string' ? getPerpAbiVersion(input.fallback) : input.fallback;
    return { version, source: 'fallback', programHash, abiPackageVersion, abiAccountStale: false };
  }
  throw new Error(
    `cannot tell the perp ABI version: program hash ${programHash ?? '(unread)'} is not registered` +
      (abiPackageVersion ? ` and ABI package-version ${abiPackageVersion} is unknown` : ' and there is no ABI account') +
      ' (registerPerpProgramHash, or pass a fallback)',
  );
}

/** What fetchPerpAbiVersion needs of a client: one account read. */
export interface PerpAccountReader {
  accounts: { get(address: string, ...rest: never[]): Promise<Account> };
}

/** Reads the program account (and, when its hash is unknown, the program's
    ABI account) and detects the version.  `fallback` defaults to the
    latest version only when `assumeLatest` is set. */
export async function fetchPerpAbiVersion(
  thru: PerpAccountReader,
  args: { programAddress: string; abiAccountAddress?: string; fallback?: PerpAbiVersion | string; assumeLatest?: boolean },
): Promise<PerpAbiVersionDetection> {
  const program = await thru.accounts.get(args.programAddress);
  const code = program.data?.data ?? new Uint8Array();
  const programHash = await perpProgramCodeHash(code);
  const fallback = args.fallback ?? (args.assumeLatest ? PERP_ABI_LATEST : undefined);
  if (perpAbiVersionForProgramHash(programHash)) return detectPerpAbiVersion({ programHash, fallback });
  const abiAddress = args.abiAccountAddress ?? deriveProgramABIAddresses(args.programAddress).abiAccountAddress;
  let abiAccountData: Uint8Array | null = null;
  try {
    abiAccountData = (await thru.accounts.get(abiAddress)).data?.data ?? null;
  } catch {
    abiAccountData = null;
  }
  return detectPerpAbiVersion({ programHash, abiAccountData, fallback });
}
