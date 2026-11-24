/**
 * Checks of the IndexedDB credential store (plan B6). The cases that need a
 * real IndexedDB run in Chromium (`scripts/run-browser-vectors.mjs`); under
 * vitest in Node, which has none, the cases of an unavailable IndexedDB run.
 * Like the other checks they use no Node API.
 */
import { newCheck, sharedSlice, type CaseResult, type Check } from './driver-support';
import { named } from './usb-support';
import type * as WebUsbApi from '../webusb';

type WebUsb = typeof WebUsbApi;
type Ctx = { webusb: WebUsb; t: Check };
type Case = { name: string; needsIndexedDb: boolean; run: (ctx: Ctx) => Promise<void> };

const cases: Case[] = [];
const add = (name: string, needsIndexedDb: boolean, run: (ctx: Ctx) => Promise<void>): void =>
  void cases.push({ name, needsIndexedDb, run });

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const record = (device: number, credential = 10, fill = 0xc0 + device) => ({
  trezorStaticPubkey: new Uint8Array(32).fill(device),
  hostStaticPrivkey: new Uint8Array(32).fill(0x55),
  credential: new Uint8Array(credential).fill(fill),
});
const summary = (records: Array<{ trezorStaticPubkey: Uint8Array; credential: Uint8Array }>): string =>
  records
    .map((r) => `${r.trezorStaticPubkey[0]}:${r.credential.length}:${r.credential[0]}`)
    .sort()
    .join(',');
let counter = 0;
const databaseName = (): string => `thru-trezor-test-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2)}`;
const messageOf = (error: unknown): string => (error as Error | undefined)?.message ?? String(error);

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

add('an unavailable IndexedDB fails every operation with a clear error and falls back to nothing', false, async ({ webusb, t }) => {
  const broken = { open: () => { throw named('SecurityError', 'The operation is insecure.'); } } as unknown as IDBFactory;
  const stores = [new webusb.IndexedDbCredentialStore({ indexedDB: broken, databaseName: 'x' })];
  if (typeof indexedDB === 'undefined') stores.push(new webusb.IndexedDbCredentialStore());
  const storage = typeof window === 'undefined' ? undefined : window.localStorage;
  const before = storage?.length ?? 0;
  for (const store of stores) {
    for (const [label, run] of [
      ['load', () => store.load()],
      ['store', () => store.store(record(1))],
      ['forget', () => store.forget()],
    ] as const) {
      const error = await t.rejects(label, run());
      t.ok(`${label}: an IndexedDbCredentialError`, error instanceof webusb.IndexedDbCredentialError, String(error));
      t.ok(`${label}: names the database`, /IndexedDB/.test(messageOf(error)), messageOf(error));
      t.ok(`${label}: carries no byte of the record`, !messageOf(error).includes(hex(record(1).hostStaticPrivkey)) && !messageOf(error).includes(hex(record(1).credential)));
    }
  }
  if (typeof indexedDB === 'undefined') {
    const noFactory = await t.rejects('no factory at all', new webusb.IndexedDbCredentialStore({ indexedDB: undefined }).load());
    t.ok('says it is not available and that there is no fallback', /not available/.test(messageOf(noFactory)) && /no other storage fallback/.test(messageOf(noFactory)), messageOf(noFactory));
  }
  t.eq('localStorage was not used', before, storage?.length ?? 0);
});

add('stores, loads, replaces a device, keeps the others, forgets one or all', true, async ({ webusb, t }) => {
  const name = databaseName();
  try {
    const store = new webusb.IndexedDbCredentialStore({ databaseName: name });
    t.eq('empty at first', [], await store.load());
    await store.store(record(1));
    await store.store(record(2));
    await store.store({ ...record(1), credential: new Uint8Array(5).fill(9) });
    t.eq('the replaced device has the new credential, the other is kept', '1:5:9,2:10:194', summary(await store.load()));
    const loaded = await store.load();
    loaded[0].credential.fill(0);
    t.eq('what load returns is a copy', '1:5:9,2:10:194', summary(await store.load()));
    const given = record(3);
    await store.store(given);
    given.credential.fill(0);
    t.eq('what store keeps is a copy', 0xc3, (await store.load()).find((r) => r.trezorStaticPubkey[0] === 3)?.credential[0]);
    await store.forget(new Uint8Array(32).fill(2));
    t.eq('forget one device', '1:5:9,3:10:195', summary(await store.load()));
    await store.forget(new Uint8Array(32).fill(77));
    t.eq('forgetting an unknown device changes nothing', '1:5:9,3:10:195', summary(await store.load()));
    await store.forget();
    t.eq('forget all', [], await store.load());
  } finally {
    await deleteDatabase(name);
  }
});

add('the records outlive the object, and a second object sees them', true, async ({ webusb, t }) => {
  const name = databaseName();
  try {
    await new webusb.IndexedDbCredentialStore({ databaseName: name }).store(record(7));
    const other = new webusb.IndexedDbCredentialStore({ databaseName: name });
    t.eq('read by a new object', '7:10:199', summary(await other.load()));
    await other.store(record(8));
    t.eq('and the first one\'s database sees the second\'s write', '7:10:199,8:10:200', summary(await new webusb.IndexedDbCredentialStore({ databaseName: name }).load()));
  } finally {
    await deleteDatabase(name);
  }
});

add('a record is replaced atomically: readers during many writes see one whole record', true, async ({ webusb, t }) => {
  const name = databaseName();
  try {
    const store = new webusb.IndexedDbCredentialStore({ databaseName: name });
    const reader = new webusb.IndexedDbCredentialStore({ databaseName: name });
    await store.store(record(1, 10, 0));
    const writes = Array.from({ length: 30 }, (_, i) => store.store(record(1, 10 + i, i + 1)));
    const reads = Array.from({ length: 30 }, () => reader.load());
    await Promise.all(writes);
    let whole = true;
    let one = true;
    for (const records of await Promise.all(reads)) {
      one &&= records.length === 1;
      // A whole record: its length and every byte belong to one write.
      whole &&= records.every((r) => r.credential.every((b) => b === r.credential[0]) && r.credential.length === 10 + (r.credential[0] === 0 ? 0 : r.credential[0] - 1));
    }
    t.ok('every read had exactly one record', one);
    t.ok('and it was one write\'s, whole', whole);
    t.eq('the last write wins', '1:39:30', summary(await store.load()));
  } finally {
    await deleteDatabase(name);
  }
});

add('a stored record that is not a credential is an error that names the database, and is left alone', true, async ({ webusb, t }) => {
  const name = databaseName();
  try {
    const store = new webusb.IndexedDbCredentialStore({ databaseName: name });
    await store.store(record(1));
    // Another script writes a malformed record into the same database.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('credentials', 'readwrite');
        tx.objectStore('credentials').put({ trezorStaticPubkey: new Uint8Array(5) }, 'bad');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const error = await t.rejects('load', new webusb.IndexedDbCredentialStore({ databaseName: name }).load());
    t.ok('an IndexedDbCredentialError naming the database', error instanceof webusb.IndexedDbCredentialError && messageOf(error).includes(name), messageOf(error));
    // Still there: reading does not repair or delete it, and the good record is stored on.
    const again = await t.rejects('load again', new webusb.IndexedDbCredentialStore({ databaseName: name }).load());
    t.ok('the same error', messageOf(again) === messageOf(error));
    await store.forget(new Uint8Array(32).fill(1));
    await store.store(record(2));
    await t.rejects('the malformed record is still in the database', store.load());
  } finally {
    await deleteDatabase(name);
  }
});

add('a record with a wrong size is refused on store, with no byte of it in the error', true, async ({ webusb, t }) => {
  const name = databaseName();
  try {
    const store = new webusb.IndexedDbCredentialStore({ databaseName: name });
    for (const [label, bad] of [
      ['a short host key', { ...record(1), hostStaticPrivkey: new Uint8Array(31).fill(0x5e) }],
      ['a short device key', { ...record(1), trezorStaticPubkey: new Uint8Array(31) }],
      ['an empty credential', { ...record(1), credential: new Uint8Array(0) }],
    ] as const) {
      const error = await t.rejects(label, store.store(bad));
      t.ok(`${label}: refused`, error !== undefined);
      t.ok(`${label}: no key bytes in the message`, !messageOf(error).includes('5e5e5e'), messageOf(error));
    }
    t.eq('nothing was stored', [], await store.load());
  } finally {
    await deleteDatabase(name);
  }
});

/** Another script writes `value` into the credential database. */
function putRaw(name: string, key: string, value: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('credentials', 'readwrite');
      tx.objectStore('credentials').put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** Everything an error shows: its text, its stack, and the same of its cause chain. */
function everythingOf(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e !== undefined && e !== null && depth < 10; depth++) {
    parts.push(String(e), (e as Error).message ?? '', (e as Error).stack ?? '');
    e = (e as { cause?: unknown }).cause;
  }
  return parts.join('\n');
}

add('a record held in buffers that share memory is copied at the call, and a key to forget is read at the call', true, async ({ webusb, t }) => {
  const name = databaseName();
  try {
    const store = new webusb.IndexedDbCredentialStore({ databaseName: name });
    const given = {
      trezorStaticPubkey: sharedSlice(new Uint8Array(32).fill(1)),
      hostStaticPrivkey: sharedSlice(new Uint8Array(32).fill(0x55)),
      credential: sharedSlice(new Uint8Array(10).fill(0xc1)),
    };
    const storing = store.store(given);
    given.trezorStaticPubkey.fill(9);
    given.hostStaticPrivkey.fill(9);
    given.credential.fill(9);
    await storing;
    t.eq('what was stored is what the call was given', '1:10:193', summary(await store.load()));
    t.eq('the host key too', hex(new Uint8Array(32).fill(0x55)), hex((await store.load())[0].hostStaticPrivkey));
    await store.store(record(2));
    const key = sharedSlice(new Uint8Array(32).fill(2));
    const forgetting = store.forget(key);
    key.fill(1);
    await forgetting;
    t.eq('the device named at the call was forgotten, not the one the key came to name', '1:10:193', summary(await store.load()));
  } finally {
    await deleteDatabase(name);
  }
});

add('a stored record that is corrupted gives an error that holds no part of the key: text, stack and cause chain', true, async ({ webusb, t }) => {
  const name = databaseName();
  const secret = '1f2e3d4c5b6a79880a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef';
  const secretBytes = Uint8Array.from(secret.match(/../g) ?? [], (h) => parseInt(h, 16));
  const windows = (text: string): string[] => Array.from({ length: text.length - 7 }, (_, i) => text.slice(i, i + 8));
  try {
    await new webusb.IndexedDbCredentialStore({ databaseName: name }).store(record(1));
    const corrupt: Array<[string, unknown]> = [
      ['a key of 31 bytes', { trezorStaticPubkey: new Uint8Array(32), hostStaticPrivkey: secretBytes.slice(0, 31), credential: new Uint8Array(4).fill(1) }],
      ['a key kept as text', { trezorStaticPubkey: new Uint8Array(32), hostStaticPrivkey: `${secret}x`, credential: new Uint8Array(4).fill(1) }],
      ['a key kept as a plain array', { trezorStaticPubkey: new Uint8Array(32), hostStaticPrivkey: Array.from(secretBytes), credential: new Uint8Array(4).fill(1) }],
    ];
    for (const [what, value] of corrupt) {
      await putRaw(name, 'bad', value);
      const error = await t.rejects(what, new webusb.IndexedDbCredentialStore({ databaseName: name }).load());
      const shown = everythingOf(error);
      t.ok(`${what}: an IndexedDbCredentialError naming the database`, error instanceof webusb.IndexedDbCredentialError && shown.includes(name), shown);
      t.eq(`${what}: no part of the key is in the error`, [], windows(secret).filter((w) => shown.includes(w)));
      t.eq(`${what}: nor of its bytes as numbers`, false, shown.includes(Array.from(secretBytes.slice(0, 8)).join(',')));
    }
  } finally {
    await deleteDatabase(name);
  }
});

export function idbCaseNames(): Array<{ group: string; name: string }> {
  return cases.map(({ name }) => ({ group: 'indexeddb', name }));
}

export async function runIdbCases(webusb: WebUsb): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const available = typeof indexedDB !== 'undefined';
  for (const { name, needsIndexedDb, run } of cases) {
    if (needsIndexedDb && !available) continue;
    const { check, failures, count } = newCheck();
    try {
      await run({ webusb, t: check });
    } catch (error) {
      failures.push({ label: `${name}: the case itself threw`, expected: 'no exception', actual: String((error as Error)?.stack ?? error) });
    }
    results.push({ group: 'indexeddb', name, checks: count(), failures });
  }
  return results;
}
