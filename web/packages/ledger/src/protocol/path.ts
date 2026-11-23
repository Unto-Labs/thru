/**
 * Derivation-path policy and encoding (`specs/ledger/app-thru-apdu.md` §4).
 *
 * The device accepts exactly two forms, all components hardened:
 *
 *   depth 4: m/44'/{THRU_COIN_TYPE}'/{a}'/0'   (canonical)
 *   depth 3: m/44'/{THRU_COIN_TYPE}'/{a}'
 *
 * with `0 <= a <= 2^31 - 1`. The helpers here implement that policy exactly
 * so hosts reject a bad path before contacting the device.
 */
import { PathRejectedError } from '../errors';
import { HARDENED, THRU_COIN_TYPE, THRU_PURPOSE } from './constants';

/** Largest account index (`2^31 - 1`). */
export const MAX_ACCOUNT_INDEX = 0x7fffffff;

export type LedgerPathDepth = 3 | 4;

/** A derivation path that satisfies the device policy. */
export interface LedgerPath {
  /** Hardened u32 components, as sent to the device. */
  readonly components: readonly number[];
  readonly depth: LedgerPathDepth;
  /** Account index, `0..2^31-1`. */
  readonly account: number;
  /** Canonical display string (§4.4), for example `m/44'/8478'/0'/0'`. */
  readonly path: string;
}

/** Anything the public API accepts as a path. */
export type LedgerPathInput = string | readonly number[] | LedgerPath;

/**
 * Check hardened u32 components against the device policy (§4.2).
 * Returns `null` when accepted, otherwise the reason.
 */
export function checkLedgerPathComponents(components: readonly number[]): string | null {
  for (const c of components) {
    if (!Number.isInteger(c) || c < 0 || c > 0xffffffff) {
      return 'every component must be a u32';
    }
  }
  if (components.length !== 3 && components.length !== 4) {
    return 'depth must be 3 or 4';
  }
  for (const c of components) {
    if ((c & HARDENED) === 0) return 'every component must be hardened';
  }
  if (components[0] !== (HARDENED | THRU_PURPOSE) >>> 0) {
    return `purpose must be ${THRU_PURPOSE}'`;
  }
  if (components[1] !== (HARDENED | THRU_COIN_TYPE) >>> 0) {
    return `coin type must be ${THRU_COIN_TYPE}'`;
  }
  if (components.length === 4 && components[3] !== HARDENED) {
    return "change must be 0'";
  }
  return null;
}

/** Render components per §4.4: `m/` then each unhardened value followed by `'`. */
export function formatLedgerPath(components: readonly number[]): string {
  const parts = components.map((c) =>
    (c & HARDENED) !== 0 ? `${(c & 0x7fffffff) >>> 0}'` : `${c >>> 0}`,
  );
  return ['m', ...parts].join('/');
}

const COMPONENT_RE = /^(0|[1-9][0-9]*)(')?$/;

/**
 * Parse a path string into raw u32 components without applying the policy.
 * Accepts `m/44'/8478'/0'/0'` and the `m/`-less form `44'/8478'/0'/0'`.
 * Only `'` marks hardening; decimal values must be canonical (no leading
 * zeros) and `<= 2^31 - 1`.
 */
function parseComponents(input: string): number[] {
  const trimmed = input.trim();
  const body = trimmed === 'm' ? '' : trimmed.startsWith('m/') ? trimmed.slice(2) : trimmed;
  if (body === '') return [];
  return body.split('/').map((part) => {
    const match = COMPONENT_RE.exec(part);
    if (match === null) {
      throw new PathRejectedError(`malformed component "${part}"`, { path: input });
    }
    const value = Number(match[1]);
    if (!Number.isSafeInteger(value) || value > MAX_ACCOUNT_INDEX) {
      throw new PathRejectedError(`component "${part}" exceeds 2^31-1`, { path: input });
    }
    return match[2] === undefined ? value : (value | HARDENED) >>> 0;
  });
}

function toComponents(input: LedgerPathInput): number[] {
  if (typeof input === 'string') return parseComponents(input);
  if (Array.isArray(input)) return [...(input as readonly number[])];
  return [...(input as LedgerPath).components];
}

/**
 * Strictly parse and validate a Ledger path. Throws {@link PathRejectedError}
 * for anything the device would reject.
 */
export function parseLedgerPath(input: LedgerPathInput): LedgerPath {
  const components = toComponents(input);
  const reason = checkLedgerPathComponents(components);
  if (reason !== null) {
    throw new PathRejectedError(reason, {
      path: typeof input === 'string' ? input : formatLedgerPath(components),
    });
  }
  return Object.freeze({
    components: Object.freeze([...components]),
    depth: components.length as LedgerPathDepth,
    account: (components[2] & 0x7fffffff) >>> 0,
    path: formatLedgerPath(components),
  });
}

/** True iff the device would accept `input` (§4.2). Never throws. */
export function isLedgerPath(input: unknown): input is LedgerPathInput {
  if (typeof input !== 'string' && !Array.isArray(input)) {
    if (typeof input !== 'object' || input === null || !('components' in input)) return false;
  }
  try {
    parseLedgerPath(input as LedgerPathInput);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the Ledger path for an account index.
 * Depth 4 (`m/44'/C'/a'/0'`) is canonical and matches `ThruHDWallet.getAccount`.
 */
export function ledgerPathForAccount(account: number, depth: LedgerPathDepth = 4): LedgerPath {
  if (!Number.isInteger(account) || account < 0 || account > MAX_ACCOUNT_INDEX) {
    throw new PathRejectedError(`account index must be an integer in [0, 2^31-1], got ${account}`);
  }
  const components = [
    (HARDENED | THRU_PURPOSE) >>> 0,
    (HARDENED | THRU_COIN_TYPE) >>> 0,
    (HARDENED | account) >>> 0,
  ];
  if (depth === 4) components.push(HARDENED);
  return parseLedgerPath(components);
}

/** Encode a validated path: `u8 depth ‖ depth × u32 big-endian` (§4.1). */
export function encodeLedgerPath(input: LedgerPathInput): Uint8Array {
  const { components } = parseLedgerPath(input);
  const out = new Uint8Array(1 + 4 * components.length);
  const view = new DataView(out.buffer);
  out[0] = components.length;
  components.forEach((c, i) => view.setUint32(1 + 4 * i, c, false));
  return out;
}

export type DecodedPath =
  | { ok: true; path: LedgerPath; size: number }
  | { ok: false; error: 'length' | 'policy'; reason: string };

/**
 * Decode a path from the front of `data` as the device does (§4.2): a buffer
 * too short for its declared depth is a length error (`0x6700`); a fully
 * present path that breaks the policy is a policy error (`0x6820`).
 */
export function decodeLedgerPath(data: Uint8Array): DecodedPath {
  if (data.length < 1) return { ok: false, error: 'length', reason: 'missing depth byte' };
  const depth = data[0];
  const size = 1 + 4 * depth;
  if (data.length < size) return { ok: false, error: 'length', reason: 'path truncated' };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const components: number[] = [];
  for (let i = 0; i < depth; i++) components.push(view.getUint32(1 + 4 * i, false));
  const reason = checkLedgerPathComponents(components);
  if (reason !== null) return { ok: false, error: 'policy', reason };
  return { ok: true, path: parseLedgerPath(components), size };
}
