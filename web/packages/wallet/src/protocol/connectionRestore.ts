import type { AddressType } from "../interfaces";

/**
 * A wallet-issued restore record.
 *
 * The wallet keeps a host's authorization in its own storage, which WebKit
 * holds in memory only for a cross-origin frame: a reload keeps it, quitting
 * the host page (an installed web app, Safari itself) loses it. So the wallet
 * hands the host a record of what it would need to rebuild that authorization
 * and the SDK keeps it in the host's own, persistent storage. On the next
 * launch the SDK sends it back and the wallet, finding its store empty,
 * validates it and rehydrates. It holds nothing secret: the account address
 * and label, which app it was issued to, and when. Signing still needs the
 * passkey.
 *
 * The SDK treats it as opaque: it checks shape and size, never meaning.
 */
export const WALLET_RESTORE_RECORD_VERSION = 1 as const;

/** JSON length cap. A record is ~400 bytes; the host stores it in localStorage. */
export const MAX_WALLET_RESTORE_RECORD_BYTES = 4096;

const MAX_ORIGIN_LENGTH = 512;
const MAX_ADDRESS_LENGTH = 128;
const MAX_LABEL_LENGTH = 64;
const MAX_TIMESTAMP_LENGTH = 40;
const MAX_ADDRESS_TYPE_LENGTH = 32;
const MAX_ACCOUNT_INDEX = 65_535;
const MAX_CHAIN_ID = 65_535;

export interface WalletRestoreRecordAccount {
  /** The wallet's account index (0, 1, ...). */
  index: number;
  /** The account address, as the wallet stores it. */
  publicKey: string;
  label: string;
  path: string;
  /** ISO-8601. */
  createdAt: string;
  addressType?: AddressType;
}

export interface WalletRestoreRecord {
  v: typeof WALLET_RESTORE_RECORD_VERSION;
  chainId: number;
  appId: string;
  origin: string;
  account: WalletRestoreRecordAccount;
  app: {
    /** Unix seconds, when the app was first authorized. */
    connectedAt: number;
  };
  /** ISO-8601, when the wallet issued this record. */
  issuedAt: string;
}

/** A wallet result that may carry a restore record for the host to keep. */
export interface WalletRestoreEnvelope {
  restore?: WalletRestoreRecord;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isBoundedInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * Shape and size only. Whether the record means anything (the origin it names,
 * the chain, the account) is the wallet's decision.
 */
export function isWalletRestoreRecordShape(value: unknown): value is WalletRestoreRecord {
  if (!isPlainObject(value)) return false;
  if (value.v !== WALLET_RESTORE_RECORD_VERSION) return false;
  if (!isBoundedInteger(value.chainId, MAX_CHAIN_ID) || value.chainId < 1) return false;
  if (!isBoundedString(value.appId, MAX_ORIGIN_LENGTH)) return false;
  if (!isBoundedString(value.origin, MAX_ORIGIN_LENGTH)) return false;
  if (!isBoundedString(value.issuedAt, MAX_TIMESTAMP_LENGTH)) return false;

  const account = value.account;
  if (!isPlainObject(account)) return false;
  if (!isBoundedInteger(account.index, MAX_ACCOUNT_INDEX)) return false;
  if (!isBoundedString(account.publicKey, MAX_ADDRESS_LENGTH)) return false;
  if (typeof account.label !== "string" || account.label.length > MAX_LABEL_LENGTH) return false;
  if (typeof account.path !== "string" || account.path.length > MAX_LABEL_LENGTH) return false;
  if (!isBoundedString(account.createdAt, MAX_TIMESTAMP_LENGTH)) return false;
  if (
    account.addressType !== undefined &&
    !isBoundedString(account.addressType, MAX_ADDRESS_TYPE_LENGTH)
  ) {
    return false;
  }

  const app = value.app;
  if (!isPlainObject(app)) return false;
  if (typeof app.connectedAt !== "number" || !Number.isFinite(app.connectedAt)) return false;

  try {
    return JSON.stringify(value).length <= MAX_WALLET_RESTORE_RECORD_BYTES;
  } catch {
    return false;
  }
}
