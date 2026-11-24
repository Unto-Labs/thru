/**
 * Credentials kept in one JSON file, for Node. The format is the Rust host's
 * (`rpc/thru-trezor/src/credentials.rs`), so a file written by one host is read
 * by the other:
 *
 *     { "version": 1, "credentials": [ { "trezor_static_pubkey": "<hex>",
 *       "host_static_privkey": "<hex>", "credential": "<hex>" } ] }
 *
 * A missing file means no credentials. A file that cannot be read or parsed is
 * an error naming the path and is never overwritten: the person decides
 * whether to delete it. The file holds host private keys, so it is written
 * with mode 0600 and its directory created with mode 0700. Each write goes to
 * a temporary file in the same directory and is renamed over the old one, so a
 * crash leaves either the old or the new file.
 */
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { copyBytes, fromHex, toHex } from './bytes';
import { checkRecord, copyRecord, markOwnStoreError, sameDevice, type CredentialRecord, type CredentialStore } from './credentials';

const FILE_VERSION = 1;

/** Failures of the credential file; the client wraps them as `TrezorCredentialsError`. */
export class CredentialFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CredentialFileError';
    markOwnStoreError(this);
    if (options?.cause !== undefined) {
      // ES2022 `Error.cause`, set by hand because the build targets ES2020.
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, writable: true });
    }
  }
}

let counter = 0;

export class FileCredentialStore implements CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  load(): Promise<CredentialRecord[]> {
    return this.serial(() => this.read());
  }

  store(record: CredentialRecord): Promise<void> {
    checkRecord(record);
    // The record is copied now: the write runs when the queue reaches it, and
    // by then the caller may have changed what it holds.
    const copy = copyRecord(record);
    return this.serial(async () => {
      const records = await this.read();
      await this.write([...records.filter((r) => !sameDevice(r, copy.trezorStaticPubkey)), copy]);
    });
  }

  forget(trezorStaticPubkey?: Uint8Array): Promise<void> {
    const device = trezorStaticPubkey === undefined ? undefined : copyBytes(trezorStaticPubkey);
    return this.serial(async () => {
      const records = await this.read();
      if (records.length === 0) return;
      await this.write(device ? records.filter((r) => !sameDevice(r, device)) : []);
    });
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private fail(what: string, cause?: unknown): CredentialFileError {
    return new CredentialFileError(`${this.path}: ${what}`, { cause });
  }

  private async read(): Promise<CredentialRecord[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw this.fail(`cannot be read: ${(error as Error).message}`, error);
    }
    // Nothing of the file's text goes into an error or its cause: the file
    // holds private keys, and a parser's message quotes what it choked on.
    let file: { version?: unknown; credentials?: unknown };
    try {
      file = JSON.parse(text) as { version?: unknown; credentials?: unknown };
    } catch {
      throw this.fail('is not valid JSON; fix or delete it');
    }
    if (file === null || typeof file !== 'object') throw this.fail('is not a credential file (not a JSON object); fix or delete it');
    if (file.version !== FILE_VERSION) {
      const shown = typeof file.version === 'number' && Number.isSafeInteger(file.version) ? `version ${file.version}` : 'no readable version';
      throw this.fail(`has format ${shown}, this program reads version ${FILE_VERSION}`);
    }
    if (!Array.isArray(file.credentials)) throw this.fail('is not a credential file (credentials is missing); fix or delete it');
    return (file.credentials as unknown[]).map((entry, index) => this.record(entry, index));
  }

  /** One entry of the file; an error names the entry and the field, never the value. */
  private record(entry: unknown, index: number): CredentialRecord {
    if (entry === null || typeof entry !== 'object') {
      throw this.fail(`is not a credential file (entry ${index} is not an object); fix or delete it`);
    }
    const fields = entry as Record<string, unknown>;
    const bytes = (field: string): Uint8Array => {
      const value = fields[field];
      if (typeof value !== 'string') {
        throw this.fail(`is not a credential file (entry ${index}: ${field} is missing or not text); fix or delete it`);
      }
      try {
        return fromHex(value);
      } catch (error) {
        const why = (error as Error).message.replace(/^invalid hex string: /, '');
        throw this.fail(`is not a credential file (entry ${index}: ${field} is not hex: ${why}); fix or delete it`);
      }
    };
    const record = {
      trezorStaticPubkey: bytes('trezor_static_pubkey'),
      hostStaticPrivkey: bytes('host_static_privkey'),
      credential: bytes('credential'),
    };
    try {
      checkRecord(record);
    } catch (error) {
      throw this.fail(`is not a credential file (entry ${index}: ${(error as Error).message}); fix or delete it`);
    }
    return record;
  }

  private async write(records: CredentialRecord[]): Promise<void> {
    const text = JSON.stringify(
      {
        version: FILE_VERSION,
        credentials: records.map((r) => ({
          trezor_static_pubkey: toHex(r.trezorStaticPubkey),
          host_static_privkey: toHex(r.hostStaticPrivkey),
          credential: toHex(r.credential),
        })),
      },
      null,
      2,
    );
    const directory = dirname(this.path);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw this.fail(`directory cannot be created: ${(error as Error).message}`, error);
    }
    const temporary = join(directory, `.${basename(this.path)}.${process.pid}.${counter++}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.chmod(0o600);
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw this.fail(`cannot be written: ${(error as Error).message}`, error);
    }
    try {
      const dir = await open(directory, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch {
      // Flushing the directory entry is best effort where the platform allows it.
    }
  }
}
