/**
 * Pairing credentials kept in IndexedDB, for browsers (plan B6). One record
 * per device, keyed by the device's static public key; the records are the
 * three byte strings of {@link CredentialRecord}.
 *
 * - The store is read before the handshake (`load`); a record is replaced by
 *   one `put` in one transaction, so a reader sees the old record or the new
 *   one, never half of either, and a crash leaves one of them.
 * - `forget` deletes one device's record, or all of them.
 * - The records hold host private keys. They are never logged and an error
 *   never carries a byte of one: the messages name the database and the
 *   operation only. They are per origin: any script of the page's origin can
 *   read them (plan J5).
 * - Where IndexedDB is unavailable (a private mode that disables it, a
 *   sandboxed frame, a policy) every operation fails with a clear error. There
 *   is no fallback to `localStorage` or to memory: a credential kept
 *   somewhere weaker, or silently not kept, would be worse than an error.
 * - A record that is not three byte strings of the right sizes is an error
 *   that names the database, and is never overwritten by a read.
 */
import { toHex } from './bytes';
import { checkRecord, copyRecord, markOwnStoreError, type CredentialRecord, type CredentialStore } from './credentials';

/** Default database name. */
export const CREDENTIAL_DATABASE = 'thru-trezor';
const STORE_NAME = 'credentials';
const DATABASE_VERSION = 1;

/** Failures of the IndexedDB store; the client wraps them as `TrezorCredentialsError`. */
export class IndexedDbCredentialError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'IndexedDbCredentialError';
    markOwnStoreError(this);
    if (options?.cause !== undefined) {
      // ES2022 `Error.cause`, set by hand because the build targets ES2020.
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, writable: true });
    }
  }
}

export type IndexedDbCredentialStoreOptions = {
  /** Database name. Default {@link CREDENTIAL_DATABASE}. */
  databaseName?: string;
  /** The factory to use. Default: the page's `indexedDB`. */
  indexedDB?: IDBFactory;
};

export class IndexedDbCredentialStore implements CredentialStore {
  readonly databaseName: string;
  private readonly factory?: IDBFactory;
  private database?: Promise<IDBDatabase>;

  constructor(options: IndexedDbCredentialStoreOptions = {}) {
    this.databaseName = options.databaseName ?? CREDENTIAL_DATABASE;
    this.factory = options.indexedDB;
  }

  async load(): Promise<CredentialRecord[]> {
    const values = (await this.transact('readonly', (store) => store.getAll())) as unknown[];
    return values.map((value) => this.parse(value));
  }

  async store(record: CredentialRecord): Promise<void> {
    checkRecord(record);
    // Copied and keyed now, before the first await: the database is opened and
    // written later, and the caller may have changed what it holds by then.
    const copy = copyRecord(record);
    const id = toHex(copy.trezorStaticPubkey);
    await this.transact('readwrite', (store) => store.put(copy, id));
  }

  async forget(trezorStaticPubkey?: Uint8Array): Promise<void> {
    // The device is named now, not when the transaction starts.
    const id = trezorStaticPubkey === undefined ? undefined : toHex(trezorStaticPubkey);
    await this.transact('readwrite', (store) => (id === undefined ? store.clear() : store.delete(id)));
  }

  private fail(what: string, cause?: unknown): IndexedDbCredentialError {
    // The name of the failure (`QuotaExceededError`, `InvalidStateError`, ...) and nothing of the data.
    const name = (cause as { name?: unknown } | null | undefined)?.name;
    const reason = typeof name === 'string' ? `: ${name}` : '';
    return new IndexedDbCredentialError(`IndexedDB database "${this.databaseName}" ${what}${reason}`, { cause });
  }

  /** Opens the database once; a failure is not remembered, so a later call tries again. */
  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
      if (!factory) {
        reject(
          new IndexedDbCredentialError(
            'IndexedDB is not available in this page, so pairing credentials cannot be kept (there is no other storage fallback): allow site data for this origin, or use a normal window',
          ),
        );
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.databaseName, DATABASE_VERSION);
      } catch (error) {
        reject(this.fail('cannot be opened', error));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another page upgrading the database, or the browser closing it: let go and reopen next time.
        const forgetHandle = (): void => {
          if (this.database === opening) this.database = undefined;
        };
        db.onversionchange = () => {
          db.close();
          forgetHandle();
        };
        db.onclose = forgetHandle;
        resolve(db);
      };
      request.onerror = () => reject(this.fail('cannot be opened', request.error));
      request.onblocked = () => reject(this.fail('is blocked by another page that holds an older version'));
    });
    this.database = opening;
    opening.catch(() => {
      if (this.database === opening) this.database = undefined;
    });
    return opening;
  }

  /** Runs `work` in one transaction and resolves with its request's result once the transaction has committed. */
  private async transact(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    const db = await this.open();
    return new Promise<unknown>((resolve, reject) => {
      let transaction: IDBTransaction;
      let request: IDBRequest;
      try {
        transaction = db.transaction(STORE_NAME, mode);
        request = work(transaction.objectStore(STORE_NAME));
      } catch (error) {
        this.database = undefined;
        reject(this.fail('cannot be used', error));
        return;
      }
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(this.fail(mode === 'readonly' ? 'cannot be read' : 'cannot be written', transaction.error));
      transaction.onabort = () => reject(this.fail('transaction was aborted', transaction.error));
    });
  }

  private parse(value: unknown): CredentialRecord {
    const entry = value as Partial<Record<keyof CredentialRecord, unknown>> | null;
    const bytes = (field: unknown): Uint8Array | undefined => (field instanceof Uint8Array ? field : undefined);
    const trezorStaticPubkey = bytes(entry?.trezorStaticPubkey);
    const hostStaticPrivkey = bytes(entry?.hostStaticPrivkey);
    const credential = bytes(entry?.credential);
    if (!trezorStaticPubkey || !hostStaticPrivkey || !credential) {
      throw this.fail('holds a record that is not a credential; delete the database or forget it');
    }
    const record = copyRecord({ trezorStaticPubkey, hostStaticPrivkey, credential });
    try {
      checkRecord(record);
    } catch {
      throw this.fail('holds a record with a field of the wrong size; delete the database or forget it');
    }
    return record;
  }
}
