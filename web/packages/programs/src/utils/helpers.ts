import { Pubkey, deriveAddress, type Account } from '@thru/sdk';
import { encodeAddress } from '@thru/sdk/helpers';

export const PUBKEY_LENGTH = 32;
export const HASH_LENGTH = 32;

const TEXT_ENCODER = new TextEncoder();

export type ProgramSeed = string | Uint8Array;

export interface AccountLookupContext {
  getAccountIndex: (pubkey: Uint8Array) => number;
}

export type InstructionData = (
  context: AccountLookupContext
) => Promise<Uint8Array>;

export function systemProgramPubkey(lastByte: number): Uint8Array {
  assertInteger(lastByte, 0, 0xff, 'lastByte');
  const bytes = new Uint8Array(PUBKEY_LENGTH);
  bytes[PUBKEY_LENGTH - 1] = lastByte;
  return bytes;
}

export function normalizeSeed(seed: ProgramSeed): Uint8Array {
  const bytes =
    typeof seed === 'string' ? TEXT_ENCODER.encode(seed) : new Uint8Array(seed);
  if (bytes.length === 0 || bytes.length > PUBKEY_LENGTH) {
    throw new Error(`seed must be 1-${PUBKEY_LENGTH} bytes, got ${bytes.length}`);
  }
  return bytes;
}

export function padSeed(seed: ProgramSeed): Uint8Array {
  const normalized = normalizeSeed(seed);
  const padded = new Uint8Array(PUBKEY_LENGTH);
  padded.set(normalized);
  return padded;
}

export function exactBytes(
  value: Uint8Array,
  length: number,
  label: string
): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`${label} must be ${length} bytes`);
  }
  return new Uint8Array(value);
}

export function pubkeyBytes(
  value: string | Uint8Array,
  label = 'public key'
): Uint8Array {
  try {
    return Pubkey.from(value).toBytes();
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

export function pubkeyAddress(value: Uint8Array): string {
  return encodeAddress(exactBytes(value, PUBKEY_LENGTH, 'public key'));
}

export function accountData(
  account: Account | Uint8Array,
  label: string
): Uint8Array {
  if (account instanceof Uint8Array) return account;
  const data = account.data?.data;
  if (!data) throw new Error(`${label} data is missing`);
  return data;
}

export function accountIndex(
  context: AccountLookupContext,
  account: Uint8Array,
  label: string
): number {
  const index = context.getAccountIndex(exactBytes(account, PUBKEY_LENGTH, label));
  assertU16(index, `${label} index`);
  return index;
}

export function assertU16(value: number, label: string): void {
  assertInteger(value, 0, 0xffff, label);
}

export function assertU32(value: number, label: string): void {
  assertInteger(value, 0, 0xffffffff, label);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function hashBytes(...parts: Uint8Array[]): Uint8Array {
  return deriveAddress([concatBytes(...parts)]).bytes;
}

function assertInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}
