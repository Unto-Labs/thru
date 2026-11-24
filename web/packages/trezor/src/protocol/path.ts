/**
 * Derivation-path policy of the Thru app (`trezor/app-thru/src/path.rs`; the
 * Rust host's `rpc/thru-trezor/src/path.rs`), the Ledger app's, so a key has
 * the same path on both:
 *
 *   depth 4: m/44'/8478'/{account}'/0'   (the default)
 *   depth 3: m/44'/8478'/{account}'
 *
 * Every component is hardened, and `0 <= account <= 2^31 - 1`. The helpers
 * here apply that policy exactly, so a path the app would refuse is refused
 * before the device is used.
 *
 * Textual forms: `m/44'/8478'/0'/0'` (display; also without `m/`, and `h` or
 * `H` for `'`) and the key-source URI `trezor://44'/8478'/0'/0'`.
 */
import { TrezorPathError } from '../errors';

/** The bit that marks a hardened component. */
export const HARDENED = 0x80000000;
/** BIP-44 purpose. */
export const THRU_PURPOSE = 44;
/** Thru's SLIP-44 coin type. */
export const THRU_COIN_TYPE = 8478;
/** Largest account index (`2^31 - 1`). */
export const MAX_ACCOUNT_INDEX = 0x7fffffff;
/** URI scheme of a Trezor key source. */
export const TREZOR_URI_SCHEME = 'trezor://';

export type TrezorPathDepth = 3 | 4;

/** A derivation path that satisfies the policy. */
export type TrezorPath = {
  /** Hardened u32 components, as sent to the device (`address_n`). */
  readonly components: readonly number[];
  readonly depth: TrezorPathDepth;
  /** Account index, `0..2^31-1`. */
  readonly account: number;
  /** Display form, for example `m/44'/8478'/0'/0'`. */
  readonly path: string;
  /** Key-source form, for example `trezor://44'/8478'/0'/0'`. */
  readonly uri: string;
};

/** Anything the public API accepts as a path. */
export type TrezorPathInput = string | readonly number[] | TrezorPath;

const isU32 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

function componentText(component: number): string {
  return (component & HARDENED) !== 0 ? `${(component & MAX_ACCOUNT_INDEX) >>> 0}'` : `${component}`;
}

/** Display form of `components`: `m/` then each value, followed by `'` when hardened. */
export function formatTrezorPath(components: readonly number[]): string {
  return ['m', ...components.map(componentText)].join('/');
}

/** URI form of `components`: `trezor://44'/8478'/0'/0'`. */
export function formatTrezorUri(components: readonly number[]): string {
  return TREZOR_URI_SCHEME + components.map(componentText).join('/');
}

/**
 * Checks `components` against the policy and throws {@link TrezorPathError}
 * for the first rule they break, in the Rust host's order.
 */
export function checkTrezorPathComponents(components: readonly number[]): void {
  if (!components.every(isU32)) {
    throw new TrezorPathError('syntax', 'every derivation path component must be a u32');
  }
  if (components.length !== 3 && components.length !== 4) {
    throw new TrezorPathError('depth', `derivation path depth must be 3 or 4, got ${components.length}`);
  }
  const unhardened = components.findIndex((c) => (c & HARDENED) === 0);
  if (unhardened !== -1) {
    throw new TrezorPathError(
      'not_hardened',
      `every derivation path component must be hardened (component ${unhardened} is not)`,
    );
  }
  if (components[0] !== ((HARDENED | THRU_PURPOSE) >>> 0)) {
    throw new TrezorPathError(
      'purpose',
      `derivation path purpose must be ${THRU_PURPOSE}', got ${componentText(components[0])}`,
    );
  }
  if (components[1] !== ((HARDENED | THRU_COIN_TYPE) >>> 0)) {
    throw new TrezorPathError(
      'coin_type',
      `derivation path coin type must be ${THRU_COIN_TYPE}', got ${componentText(components[1])}`,
    );
  }
  if (components.length === 4 && components[3] !== HARDENED) {
    throw new TrezorPathError('change', `derivation path change must be 0', got ${componentText(components[3])}`);
  }
}

/** True iff `components` satisfy the policy. Never throws. */
export function isTrezorPathComponents(components: readonly number[]): boolean {
  try {
    checkTrezorPathComponents(components);
    return true;
  } catch {
    return false;
  }
}

function syntaxError(text: string): TrezorPathError {
  return new TrezorPathError(
    'syntax',
    `invalid derivation path '${text}': expected e.g. m/${THRU_PURPOSE}'/${THRU_COIN_TYPE}'/0'/0'`,
  );
}

/**
 * Parses `m/44'/8478'/0'/0'` or `44'/8478'/0'/0'` into raw components
 * (`h` or `H` also mark hardening). A component that is not hardened parses and
 * is then refused by the policy, so the error names the real problem.
 */
function parseComponents(text: string): number[] {
  let body = text.trim();
  if (body.startsWith('m/')) body = body.slice(2);
  if (body === '' || body === 'm') {
    throw new TrezorPathError('depth', 'derivation path depth must be 3 or 4, got 0');
  }
  return body.split('/').map((part) => {
    const hardened = /['hH]$/.test(part);
    const digits = hardened ? part.slice(0, -1) : part;
    if (!/^[0-9]+$/.test(digits)) throw syntaxError(text);
    const value = Number(digits);
    if (!Number.isSafeInteger(value) || value > MAX_ACCOUNT_INDEX) throw syntaxError(text);
    return hardened ? (value | HARDENED) >>> 0 : value;
  });
}

function build(components: readonly number[]): TrezorPath {
  checkTrezorPathComponents(components);
  const copy = [...components];
  return Object.freeze({
    components: Object.freeze(copy),
    depth: copy.length as TrezorPathDepth,
    account: (copy[2] & MAX_ACCOUNT_INDEX) >>> 0,
    path: formatTrezorPath(copy),
    uri: formatTrezorUri(copy),
  });
}

/** Whether `value` starts with the `trezor://` scheme (case-insensitive, leading whitespace ignored). */
export function isTrezorUri(value: string): boolean {
  return value.trimStart().slice(0, TREZOR_URI_SCHEME.length).toLowerCase() === TREZOR_URI_SCHEME;
}

/** Parses `trezor://44'/8478'/0'/0'` (the scheme is case-insensitive; an optional `m/` after it is accepted). */
export function parseTrezorUri(uri: string): TrezorPath {
  const trimmed = uri.trim();
  if (!isTrezorUri(trimmed)) {
    throw new TrezorPathError(
      'not_trezor_uri',
      `'${trimmed}' is not a Trezor key source (expected ${TREZOR_URI_SCHEME}${THRU_PURPOSE}'/${THRU_COIN_TYPE}'/<account>'/0')`,
    );
  }
  return build(parseComponents(trimmed.slice(TREZOR_URI_SCHEME.length)));
}

/**
 * Strictly parses and validates a path (a string, raw components, or a path
 * already parsed). Throws {@link TrezorPathError} for anything the app would
 * refuse.
 */
export function parseTrezorPath(input: TrezorPathInput): TrezorPath {
  if (typeof input === 'string') return build(parseComponents(input));
  if (Array.isArray(input)) return build(input as readonly number[]);
  return build((input as TrezorPath).components);
}

/** True iff the app would accept `input`. Never throws. */
export function isTrezorPath(input: unknown): input is TrezorPathInput {
  if (typeof input !== 'string' && !Array.isArray(input)) {
    if (typeof input !== 'object' || input === null || !('components' in input)) return false;
  }
  try {
    parseTrezorPath(input as TrezorPathInput);
    return true;
  } catch {
    return false;
  }
}

/** The path of an account index: depth 4 (`m/44'/8478'/a'/0'`, the default) or depth 3. */
export function trezorPathForAccount(account: number, depth: TrezorPathDepth = 4): TrezorPath {
  if (!Number.isInteger(account) || account < 0 || account > MAX_ACCOUNT_INDEX) {
    throw new TrezorPathError('syntax', `account index must be an integer in [0, 2^31-1], got ${account}`);
  }
  const components = [(HARDENED | THRU_PURPOSE) >>> 0, (HARDENED | THRU_COIN_TYPE) >>> 0, (HARDENED | account) >>> 0];
  if (depth === 4) components.push(HARDENED);
  return build(components);
}
