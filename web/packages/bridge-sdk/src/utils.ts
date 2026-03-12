import { hexToBytes } from '@thru/helpers';
import { Pubkey } from '@thru/thru-sdk';
import { THRU_STATE_PROOF_WIRE_TYPES } from './constants';
import type { PolygonSignerConfig } from './types';

const THRU_TXN_SIGNATURE_SIZE = 64;
const THRU_TXN_HEADER_SIZE = 112;
const THRU_PUBKEY_SIZE = 32;
const THRU_TXN_MAX_ACCOUNTS = 1024;
const THRU_ACCOUNT_META_FOOTPRINT = 64;
const THRU_STATE_PROOF_HEADER_SIZE = 40;
const TXN_FLAG_HAS_FEE_PAYER_PROOF = 1 << 0;
const TXN_FLAG_MAY_COMPRESS_ACCOUNT = 1 << 1;
const TXN_SUPPORTED_FLAGS = TXN_FLAG_HAS_FEE_PAYER_PROOF | TXN_FLAG_MAY_COMPRESS_ACCOUNT;

export function isPolygonPrivateKeySignerConfig(
  config: PolygonSignerConfig
): config is { privateKey: string; rpcUrl: string } {
  return 'privateKey' in config;
}

export function validateAddress(address: string, fieldName: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${fieldName} must be 0x + 40 hex chars`);
  }
  return normalizeHex(address);
}

export function validateThruAddress(address: string, fieldName: string): string {
  if (!Pubkey.isThruFmt(address)) {
    throw new Error(`${fieldName} must be a valid Thru address (ta...)`);
  }
  try {
    Pubkey.from(address);
    return address;
  } catch {
    throw new Error(`${fieldName} must be a valid Thru address (ta...)`);
  }
}

export function normalizeHex(value: string): string {
  return value.startsWith('0x') ? value.toLowerCase() : `0x${value.toLowerCase()}`;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function u16LE(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`u16 out of range: ${value}`);
  }
  const out = new Uint8Array(2);
  out[0] = value & 0xff;
  out[1] = (value >> 8) & 0xff;
  return out;
}

export function u32LE(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`u32 out of range: ${value}`);
  }
  const out = new Uint8Array(4);
  out[0] = value & 0xff;
  out[1] = (value >> 8) & 0xff;
  out[2] = (value >> 16) & 0xff;
  out[3] = (value >> 24) & 0xff;
  return out;
}

export function u64LE(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`u64 out of range: ${value.toString()}`);
  }
  const out = new Uint8Array(8);
  let n = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

export function readU16LE(data: Uint8Array, offset: number): number {
  if (data.length < offset + 2) {
    throw new Error('readU16LE out of bounds');
  }
  return data[offset] | (data[offset + 1] << 8);
}

export function readU64LE(data: Uint8Array, offset: number): bigint {
  if (data.length < offset + 8) {
    throw new Error('readU64LE out of bounds');
  }
  let out = 0n;
  for (let i = 0; i < 8; i++) {
    out |= BigInt(data[offset + i]) << BigInt(8 * i);
  }
  return out;
}

export type ThruTxnHeader = {
  version: number;
  flags: number;
  readWriteAccounts: number;
  readOnlyAccounts: number;
  instructionDataSize: number;
  chainId: number;
};

export function readThruTxnHeader(rawTransaction: Uint8Array): ThruTxnHeader {
  if (rawTransaction.length < THRU_TXN_HEADER_SIZE) {
    throw new Error(`raw transaction too short for header: ${rawTransaction.length}`);
  }
  return {
    version: rawTransaction[0],
    flags: rawTransaction[1],
    readWriteAccounts: readU16LE(rawTransaction, 2),
    readOnlyAccounts: readU16LE(rawTransaction, 4),
    instructionDataSize: readU16LE(rawTransaction, 6),
    chainId: readU16LE(rawTransaction, 44),
  };
}

function isLikelyLegacySignaturePrefixedTransaction(rawTransaction: Uint8Array): boolean {
  const legacyExpectedSize = tryReadExpectedThruTxnSize(rawTransaction, THRU_TXN_SIGNATURE_SIZE);
  if (legacyExpectedSize === null) {
    return false;
  }
  const modernExpectedSize = tryReadExpectedThruTxnSize(rawTransaction, 0);
  return modernExpectedSize === null;
}

function tryReadExpectedThruTxnSize(rawTransaction: Uint8Array, headerOffset: number): number | null {
  if (rawTransaction.length < headerOffset + THRU_TXN_HEADER_SIZE + THRU_TXN_SIGNATURE_SIZE) {
    return null;
  }

  const version = rawTransaction[headerOffset + 0];
  const flags = rawTransaction[headerOffset + 1];
  const invalidFlags = flags & ~TXN_SUPPORTED_FLAGS;
  const readWriteAccounts = readU16LE(rawTransaction, headerOffset + 2);
  const readOnlyAccounts = readU16LE(rawTransaction, headerOffset + 4);
  const instructionDataSize = readU16LE(rawTransaction, headerOffset + 6);
  const chainId = readU16LE(rawTransaction, headerOffset + 44);
  const padding0 = rawTransaction[headerOffset + 46];
  const padding1 = rawTransaction[headerOffset + 47];
  const totalAccounts = readWriteAccounts + readOnlyAccounts;

  if (
    version !== 1 ||
    invalidFlags !== 0 ||
    chainId === 0 ||
    totalAccounts > THRU_TXN_MAX_ACCOUNTS ||
    padding0 !== 0 ||
    padding1 !== 0
  ) {
    return null;
  }

  let bodySize = totalAccounts * THRU_PUBKEY_SIZE + instructionDataSize;
  if ((flags & TXN_FLAG_HAS_FEE_PAYER_PROOF) !== 0) {
    const proofOffset = headerOffset + THRU_TXN_HEADER_SIZE + bodySize;
    if (rawTransaction.length < proofOffset + THRU_STATE_PROOF_HEADER_SIZE + THRU_TXN_SIGNATURE_SIZE) {
      return null;
    }
    const typeSlot = readU64LE(rawTransaction, proofOffset);
    const proofType = Number((typeSlot >> 62n) & 0x3n);
    if (proofType > THRU_STATE_PROOF_WIRE_TYPES.creating) {
      return null;
    }
    const pathBitset = rawTransaction.subarray(proofOffset + 8, proofOffset + THRU_STATE_PROOF_HEADER_SIZE);
    const siblingCount = countSetBits(pathBitset);
    const proofBodyCount = proofType + siblingCount;
    bodySize += THRU_STATE_PROOF_HEADER_SIZE + proofBodyCount * THRU_PUBKEY_SIZE;
    if (proofType === THRU_STATE_PROOF_WIRE_TYPES.existing) {
      bodySize += THRU_ACCOUNT_META_FOOTPRINT;
    }
  }

  const expectedSize = THRU_TXN_HEADER_SIZE + bodySize + THRU_TXN_SIGNATURE_SIZE;
  if (headerOffset + expectedSize !== rawTransaction.length) {
    return null;
  }

  return expectedSize;
}

function countSetBits(bytes: Uint8Array): number {
  let count = 0;
  for (const value of bytes) {
    let v = value;
    while (v !== 0) {
      count += v & 1;
      v >>= 1;
    }
  }
  return count;
}

export function normalizeThruTransactionWire(rawTransaction: Uint8Array): {
  normalizedRawTransaction: Uint8Array;
  legacySignaturePrefixed: boolean;
} {
  if (!isLikelyLegacySignaturePrefixedTransaction(rawTransaction)) {
    return { normalizedRawTransaction: rawTransaction, legacySignaturePrefixed: false };
  }

  // Legacy format: [signature (64)][header+body]
  // Current format: [header+body][signature (64)]
  const normalized = concatBytes(rawTransaction.slice(THRU_TXN_SIGNATURE_SIZE), rawTransaction.slice(0, THRU_TXN_SIGNATURE_SIZE));
  return { normalizedRawTransaction: normalized, legacySignaturePrefixed: true };
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function isZeroBytes(bytes: Uint8Array): boolean {
  for (const b of bytes) {
    if (b !== 0) return false;
  }
  return true;
}

export function bytes32ToEvmAddress(bytes32: Uint8Array): string | null {
  if (bytes32.length !== 32) return null;
  for (let i = 0; i < 12; i++) {
    if (bytes32[i] !== 0) return null;
  }
  return normalizeHex(`0x${bytesToHex(bytes32.slice(12))}`);
}

export function evmAddressToBytes32(address: string, fieldName = 'polygonRecipientAddress'): Uint8Array {
  const normalized = validateAddress(address, fieldName);
  const addressBytes = hexToBytes(normalized);
  if (addressBytes.length !== 20) {
    throw new Error(`${fieldName} must be 20 bytes`);
  }
  const out = new Uint8Array(32);
  out.set(addressBytes, 12);
  return out;
}

export function parseHexPayload(payloadHex?: string): Uint8Array {
  if (!payloadHex) return new Uint8Array();
  const normalized = payloadHex.startsWith('0x') ? payloadHex.slice(2) : payloadHex;
  if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('payloadHex must be valid even-length hex');
  }
  return normalized.length === 0 ? new Uint8Array() : hexToBytes(normalized);
}

export function parseThruPrivateKey(privateKeyHex: string, fieldName: string): Uint8Array {
  const bytes = hexToBytes(privateKeyHex.trim());
  if (bytes.length !== 32) {
    throw new Error(`${fieldName} must be 32-byte hex`);
  }
  return bytes;
}

export function isThruAccountNotFoundError(error: unknown): boolean {
  const code = (error as { code?: number }).code;
  if (code === 5) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|missing account/i.test(message);
}
