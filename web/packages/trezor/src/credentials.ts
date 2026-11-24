/**
 * Pairing credentials (plan B6): what the host keeps so that it need not pair
 * again. A credential ties one device (its static public key) to one host
 * static private key and the opaque blob the device issued for that key.
 *
 * The record holds a private key. It is never logged, and an error never
 * carries it.
 */
import { copyBytes } from './bytes';
import { TrezorCredentialsError } from './errors';

/** The longest credential from the device that can be sent back in the handshake. */
export const MAX_CREDENTIAL_LEN = 126;

export type CredentialRecord = {
  /** The device's static public key (32 bytes). */
  trezorStaticPubkey: Uint8Array;
  /** The host static private key (32 bytes) the credential was issued for. */
  hostStaticPrivkey: Uint8Array;
  /** The credential blob, sent to the device in the handshake. */
  credential: Uint8Array;
};

/**
 * Where credentials live between connections. The store is read once before
 * the handshake (the credential lookup inside the handshake is synchronous),
 * replaces a record atomically, and can forget.
 */
export interface CredentialStore {
  /** Every credential known, in any order. */
  load(): Promise<CredentialRecord[]>;
  /** Remembers `record`. A record for the same device replaces the earlier one. */
  store(record: CredentialRecord): Promise<void>;
  /** Forgets the record of one device, or all of them when no key is given. */
  forget(trezorStaticPubkey?: Uint8Array): Promise<void>;
}

/**
 * The mark of the errors of this package's own stores (the credential file,
 * IndexedDB and the size check of a record). Their texts are written to be
 * shown (a path, a database name, never a record), so the client keeps them;
 * the error of any other store, whatever its class, is reduced to its class
 * name. It is a registered symbol because each entry of
 * the package carries its own copy of its classes, so `instanceof` does not
 * reach across entries.
 */
const OWN_STORE_ERROR = Symbol.for('@thru/trezor/own-store-error');

/** Marks `error` as one of this package's own store errors. */
export function markOwnStoreError(error: Error): void {
  Object.defineProperty(error, OWN_STORE_ERROR, { value: true });
}

/** Whether `error` is marked by {@link markOwnStoreError}. */
export function isOwnStoreError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[OWN_STORE_ERROR] === true;
}

/** Copies a record into memory of its own (also from a `Buffer`); the store keeps its own bytes. */
export function copyRecord(record: CredentialRecord): CredentialRecord {
  return {
    trezorStaticPubkey: copyBytes(record.trezorStaticPubkey),
    hostStaticPrivkey: copyBytes(record.hostStaticPrivkey),
    credential: copyBytes(record.credential),
  };
}

export function sameDevice(a: CredentialRecord, b: Uint8Array): boolean {
  if (a.trezorStaticPubkey.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a.trezorStaticPubkey[i] !== b[i]) return false;
  return true;
}

/**
 * Checks the sizes of a record: two 32-byte keys and a credential. A
 * credential longer than {@link MAX_CREDENTIAL_LEN} can be kept (a record
 * written by another host may hold one) but is never used in a handshake.
 */
export function checkRecord(record: CredentialRecord): void {
  // Only sizes and kinds are named, never a value; the mark lets the client keep these words.
  const refuse = (message: string): never => {
    const error = new TrezorCredentialsError(message);
    markOwnStoreError(error);
    throw error;
  };
  if (!(record.trezorStaticPubkey instanceof Uint8Array) || record.trezorStaticPubkey.length !== 32) {
    refuse('the device key is not 32 bytes');
  }
  if (!(record.hostStaticPrivkey instanceof Uint8Array) || record.hostStaticPrivkey.length !== 32) {
    refuse('the host key is not 32 bytes');
  }
  if (!(record.credential instanceof Uint8Array) || record.credential.length === 0) {
    refuse('the credential is empty');
  }
}

/** Credentials kept in memory only: they are gone when the object is. */
export class MemoryCredentialStore implements CredentialStore {
  private records: CredentialRecord[] = [];

  async load(): Promise<CredentialRecord[]> {
    return this.records.map(copyRecord);
  }

  async store(record: CredentialRecord): Promise<void> {
    checkRecord(record);
    this.records = [
      ...this.records.filter((r) => !sameDevice(r, record.trezorStaticPubkey)),
      copyRecord(record),
    ];
  }

  async forget(trezorStaticPubkey?: Uint8Array): Promise<void> {
    this.records = trezorStaticPubkey
      ? this.records.filter((r) => !sameDevice(r, trezorStaticPubkey))
      : [];
  }
}
