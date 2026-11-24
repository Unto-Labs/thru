/**
 * Checks of the signer layer (plan B4, B5, B8): the path policy against the
 * shared derivation vectors and the app's own accepted and refused paths, the
 * typed errors and the CLI's codes, the preview of the device's review tied to
 * the app's fixture and texts (the two parity tests of the CLI's
 * `trezor_preview.rs`), the app's requests and the signer on a fake app that
 * signs with a real Ed25519 key, and the adapter into the SDK's flow.
 *
 * Like `driver-checks.ts` the module takes the package's built API as an
 * argument and uses no Node API: the same code runs under vitest in Node and,
 * bundled, in a page in Chromium. The app's files and the shared vectors come
 * in as data ({@link SigningData}); they are read from `trezor/app-thru/` and
 * `contrib/test/vectors/signing/`, never copied.
 */
import { thruAddress } from '@thru/ledger/protocol';
import { eoa, Pubkey } from '@thru/sdk';

import {
  eoaAuthMessage,
  FakeApp,
  type EoaVector,
  type FakeKey,
  type FixtureCase,
  type MessageVector,
  type SigningData,
} from './signer-support';
import { bufferOf, newCheck, type Check, type CaseResult } from './driver-support';
import type { Api } from './vector-checks';
import type { PreviewField, PreviewItem, PreviewStep, TrezorReview } from '../index';

export type SignerCtx = { api: Api; d: SigningData; t: Check };
type SignerCase = { group: string; name: string; run: (ctx: SignerCtx) => Promise<void> };

const cases: SignerCase[] = [];
const add = (group: string, name: string, run: (ctx: SignerCtx) => Promise<void>): void =>
  void cases.push({ group, name, run });

const H = 0x80000000;
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

// ---- helpers over the data ----

/** The key of the wallet of the fixtures (`abandon ... about`, no passphrase) at `path`, from the shared HD vectors. */
function keyAt(d: SigningData, path: string): FakeKey & { address: string } {
  const found = d.hd.derivations.find(
    (x) => x.name.startsWith('bip39-abandon-about/no-passphrase/') && x.path === path,
  );
  if (!found) throw new Error(`no HD vector for ${path}`);
  const fromHex = (hex: string): Uint8Array => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    return out;
  };
  return { seed: fromHex(found.private_seed_hex), publicKey: fromHex(found.pubkey_hex), address: found.address };
}

/** A fake app that has the wallet's key at each path. */
function fakeOf(ctx: SignerCtx): FakeApp {
  const { api, d } = ctx;
  return new FakeApp(api, (components) => keyAt(d, api.formatTrezorPath(components)));
}

function signerOf(ctx: SignerCtx, fake: FakeApp, ...scheme: [] | [unknown]) {
  const { api } = ctx;
  return new api.ThruTrezorSigner({
    app: api.ThruApp.attach(fake as never, 7),
    transactionSigningScheme: (scheme.length === 0 ? 'rfc8032' : scheme[0]) as never,
    close: () => fake.close(),
  });
}

const codeOf = (error: unknown): string => (error as { code?: string } | undefined)?.code ?? String(error);
const reasonOf = (error: unknown): string | undefined => (error as { reason?: string } | undefined)?.reason;

/** `promise` must reject with this class, code, and (when given) reason. */
async function refused(
  ctx: SignerCtx,
  label: string,
  promise: Promise<unknown>,
  want: { code: string; reason?: string; cls?: string },
): Promise<unknown> {
  const { api, t } = ctx;
  const error = await t.rejects(label, promise);
  t.eq(`${label}: the code`, want.code, codeOf(error));
  if (want.reason !== undefined) t.eq(`${label}: the reason`, want.reason, reasonOf(error));
  if (want.cls !== undefined) {
    const ctor = (api as unknown as Record<string, new (...args: never[]) => unknown>)[want.cls];
    t.ok(`${label}: a ${want.cls}`, error instanceof ctor, String(error));
  }
  return error;
}

// ===================================================================
// path
// ===================================================================

const decodeApduPath = (hex: string): number[] => {
  const bytes = new Uint8Array(hex.length / 2).map((_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
  const view = new DataView(bytes.buffer);
  const out: number[] = [];
  for (let i = 0; i < bytes[0]; i++) out.push(view.getUint32(1 + 4 * i, false));
  return out;
};

add('path', 'every derivation of the shared vectors parses to the device encoding, in every textual form', async ({ api, d, t }) => {
  t.eq('the vectors have 64 derivations', 64, d.hd.derivations.length);
  for (const v of d.hd.derivations) {
    const p = api.parseTrezorPath(v.path);
    t.eq(`${v.name}: components`, decodeApduPath(v.path_apdu_hex), [...p.components]);
    t.eq(`${v.name}: depth`, v.depth, p.depth);
    t.eq(`${v.name}: account`, v.account, p.account);
    t.eq(`${v.name}: display form`, v.path, p.path);
    t.eq(`${v.name}: URI form`, `trezor://${v.path.slice(2)}`, p.uri);
    t.eq(`${v.name}: from the components`, v.path, api.parseTrezorPath(p.components).path);
    t.eq(`${v.name}: from the URI`, v.path, api.parseTrezorUri(p.uri).path);
    t.eq(`${v.name}: from a path already parsed`, v.path, api.parseTrezorPath(p).path);
    t.eq(`${v.name}: without m/`, v.path, api.parseTrezorPath(v.path.slice(2)).path);
    t.ok(`${v.name}: is a path`, api.isTrezorPath(v.path));
  }
});

const REASON_OF_VECTOR: [string, string][] = [
  ['depth must be 3 or 4', 'depth'],
  ['every component must be hardened', 'not_hardened'],
  ["purpose must be 44'", 'purpose'],
  ["coin type must be 8478'", 'coin_type'],
  ["change must be 0'", 'change'],
];

add('path', 'every path the shared vectors refuse is refused with a typed error naming the rule', async ({ api, d, t }) => {
  t.eq('the vectors list 20 refused paths', 20, d.hd.path_policy.length);
  for (const v of d.hd.path_policy) {
    t.eq(`${v.name}: the vector refuses`, 'reject', v.expect);
    const want = REASON_OF_VECTOR.find(([text]) => v.reason.includes(text))?.[1];
    t.ok(`${v.name}: a rule of the policy`, want !== undefined, v.reason);
    for (const [form, input] of [
      ['text', v.path],
      ['components', v.components],
    ] as const) {
      let error: unknown;
      try {
        api.parseTrezorPath(input);
      } catch (e) {
        error = e;
      }
      t.ok(`${v.name} (${form}): a TrezorPathError`, error instanceof api.TrezorPathError, String(error));
      t.eq(`${v.name} (${form}): the code is the CLI's invalid_request`, 'invalid_request', codeOf(error));
      t.eq(`${v.name} (${form}): the rule`, want, (error as { pathReason?: string })?.pathReason);
    }
    t.ok(`${v.name}: is not a path`, !api.isTrezorPath(v.path) && !api.isTrezorPath(v.components));
    t.ok(`${v.name}: the components are not accepted`, !api.isTrezorPathComponents(v.components));
  }
});

add('path', "the app's own accepted and refused paths (trezor/app-thru/src/path.rs)", async ({ api, t }) => {
  const u = (x: number): number => x >>> 0;
  const accepted: [number[], number, boolean][] = [
    [[u(44 | H), u(8478 | H), u(H)], 0, false],
    [[u(44 | H), u(8478 | H), u(7 | H), u(H)], 7, true],
    [[u(44 | H), u(8478 | H), 0xffffffff, u(H)], 0x7fffffff, true],
  ];
  for (const [components, account, hasChange] of accepted) {
    const p = api.parseTrezorPath(components);
    t.eq(`${components.join(',')}: account`, account, p.account);
    t.eq(`${components.join(',')}: four components`, hasChange, p.depth === 4);
  }
  const refusedPaths: number[][] = [
    [],
    [44 | H],
    [44 | H, 8478 | H],
    [44 | H, 8478 | H, 0],
    [44 | H, 8478 | H, 0, H],
    [44 | H, 8478 | H, H, 0],
    [44 | H, 8478 | H, H, 1 | H],
    [44 | H, 8478 | H, H, H, H],
    [44, 8478 | H, H, H],
    [44 | H, 8478, H, H],
    [43 | H, 8478 | H, H, H],
    [44 | H, 501 | H, H, H],
    [44 | H, 1 | H, H, H],
  ].map((c) => c.map((x) => x >>> 0));
  for (const components of refusedPaths) {
    t.ok(`[${components.join(',')}] is refused`, !api.isTrezorPathComponents(components));
  }
  // What is not a u32 is not a component.
  for (const bad of [-1, 2 ** 32, 1.5, Number.NaN]) {
    t.ok(`component ${bad} is refused`, !api.isTrezorPathComponents([(44 | H) >>> 0, (8478 | H) >>> 0, bad, H >>> 0]));
  }
});

add('path', 'the textual forms and the key-source URI, as the Rust host reads them', async ({ api, t }) => {
  const p = api.parseTrezorPath("m/44'/8478'/0'/0'");
  t.eq('canonical components', [0x8000002c, 0x8000211e, 0x80000000, 0x80000000], [...p.components]);
  t.eq('display form', "m/44'/8478'/0'/0'", p.path);
  t.eq('URI form', "trezor://44'/8478'/0'/0'", p.uri);
  t.eq('the maximum account', "m/44'/8478'/2147483647'/0'", api.trezorPathForAccount(0x7fffffff).path);
  t.eq('depth 3 by account', "m/44'/8478'/5'", api.trezorPathForAccount(5, 3).path);
  t.eq('depth 3 parses to the same', [...api.trezorPathForAccount(5, 3).components], [...api.parseTrezorPath("m/44'/8478'/5'").components]);
  for (const bad of [0x80000000, -1, 1.5]) {
    await refused({ api, d: {} as SigningData, t }, `account ${bad}`, Promise.resolve().then(() => api.trezorPathForAccount(bad)), {
      code: 'invalid_request',
    });
  }
  for (const ok of [
    "trezor://44'/8478'/0'/0'",
    "TREZOR://44'/8478'/0'/0'",
    "  trezor://m/44'/8478'/0'/0'",
    'trezor://44h/8478h/0h/0h',
    "trezor://44H/8478H/0H/0H",
  ]) {
    t.eq(`${ok}`, "m/44'/8478'/0'/0'", api.parseTrezorUri(ok).path);
    t.ok(`${ok} is a Trezor URI`, api.isTrezorUri(ok));
  }
  t.eq('with h and without m/', "m/44'/8478'/3'", api.parseTrezorPath('44h/8478h/3h').path);
  t.eq('surrounding space', "m/44'/8478'/3'", api.parseTrezorPath("  m/44'/8478'/3'  ").path);
  for (const bad of ["44'/8478'/0'/0'", "ledger://44'/8478'/0'/0'"]) {
    let error: unknown;
    try {
      api.parseTrezorUri(bad);
    } catch (e) {
      error = e;
    }
    t.eq(`${bad}: not a Trezor URI`, 'not_trezor_uri', (error as { pathReason?: string })?.pathReason);
  }
  t.ok('"trezor" alone is no URI', !api.isTrezorUri('trezor'));
  t.ok('a ledger URI is no Trezor URI', !api.isTrezorUri("ledger://44'/8478'/0'/0'"));

  const rules: [string, string][] = [
    ["m/44'/8478'/0'/1'", 'change'],
    ["m/44'/8478'/0'/0", 'not_hardened'],
    ["m/44'/8478'/0/0'", 'not_hardened'],
    ["m/44'/501'/0'/0'", 'coin_type'],
    ["m/44'/9999'/0'/0'", 'coin_type'],
    ["m/43'/8478'/0'/0'", 'purpose'],
    ["m/44'/8478'", 'depth'],
    ["m/44'/8478'/0'/0'/0'", 'depth'],
    ['m', 'depth'],
    ['', 'depth'],
    ["m/44'/x'/0'", 'syntax'],
    ["m/44'/8478'/2147483648'/0'", 'syntax'],
    ["m/44'//0'", 'syntax'],
    ["m/44'/8478'/-1'/0'", 'syntax'],
    ["m/44'/8478'/1.5'/0'", 'syntax'],
    ["m/44'/8478'/99999999999999999999'/0'", 'syntax'],
  ];
  for (const [text, rule] of rules) {
    let error: unknown;
    try {
      api.parseTrezorPath(text);
    } catch (e) {
      error = e;
    }
    t.eq(`${JSON.stringify(text)} is refused as ${rule}`, rule, (error as { pathReason?: string })?.pathReason);
  }
  t.eq('the same policy as the Ledger app: depth 4 and 3, not change 1', [true, true, false], [
    api.isTrezorPath("m/44'/8478'/7'/0'"),
    api.isTrezorPath("m/44'/8478'/7'"),
    api.isTrezorPath("m/44'/8478'/7'/1'"),
  ]);
});

// ===================================================================
// errors
// ===================================================================

add('errors', "every error has the code the CLI reports (trezor_error_code of rpc/cli/crates/thru-core/src/signing.rs)", async ({ api, t }) => {
  const table: [string, unknown, string][] = [
    ['cancelled on the device', new api.TrezorCancelledError(), 'user_rejected'],
    ['no device', new api.TrezorTransportError('none', { kind: 'not_found' }), 'not_found'],
    ['two devices', new api.TrezorTransportError('two', { kind: 'ambiguous' }), 'ambiguous_device'],
    ['a transfer failed', new api.TrezorTransportError('x', { kind: 'io' }), 'transport'],
    ['a transport error without a kind', new api.TrezorTransportError('x'), 'transport'],
    ['timed out', new api.TrezorTimeoutError('the button', 'answer'), 'timeout'],
    ['busy', new api.TrezorTimeoutError('the device', 'busy'), 'timeout'],
    ['locked', new api.TrezorDeviceLockedError(), 'locked'],
    ['protocol', new api.TrezorProtocolError('p'), 'protocol_error'],
    ['unexpected', new api.TrezorUnexpectedError('u'), 'protocol_error'],
    ['the app misbehaved', new api.TrezorAppError('a'), 'protocol_error'],
    ['a signature that does not verify', new api.TrezorInvalidSignatureError(), 'protocol_error'],
    ['a failure', new api.TrezorFailureError(3, 'bad data'), 'device_error'],
    ['pairing', new api.TrezorPairingError('wrong_code', 'wrong code'), 'pairing_failed'],
    ['credentials', new api.TrezorCredentialsError('c'), 'credentials'],
    ['the app image', new api.TrezorAppImageError('i'), 'app_image'],
    ['the key', new api.TrezorKeyMismatchError('taA', 'taB'), 'key_mismatch'],
    ['the app refused', new api.TrezorAppRefusedError('unsupported_transaction'), 'app_refused'],
    ['an invalid request', new api.TrezorInvalidRequestError('too long'), 'invalid_request'],
    ['a refused path', new api.TrezorPathError('depth', 'depth'), 'invalid_request'],
    ['the passphrase', new api.TrezorPassphraseOnDeviceOnlyError(), 'passphrase_on_device_only'],
    ['the signing scheme', new api.TrezorUnsupportedSigningSchemeError('legacy'), 'unsupported_signing_scheme'],
    ['an abort', new api.TrezorAbortedError(), 'aborted'],
    ['a closed connection', new api.TrezorClosedError(), 'closed'],
  ];
  for (const [what, error, code] of table) {
    t.ok(`${what}: a TrezorError`, error instanceof api.TrezorError);
    t.eq(`${what}: code`, code, api.trezorErrorCode(error as never));
    t.eq(`${what}: no outcome is unknown by default`, false, (error as { outcomeUnknown: boolean }).outcomeUnknown);
  }
  const key = new api.TrezorKeyMismatchError('taA', 'taB');
  t.eq('a key mismatch names both keys', ['taA', 'taB'], [key.expected, key.got]);
  t.ok('and says so', /taB.*taA/.test(key.message), key.message);
  const unknown = new api.TrezorTimeoutError('an answer', 'answer', { outcomeUnknown: true });
  t.eq('the outcome-unknown flag can be set', true, unknown.outcomeUnknown);
  t.eq('the error text says what was awaited', true, /an answer/.test(unknown.message));
  const refusal = new api.TrezorAppRefusedError('message_not_text');
  t.eq('the app refusal keeps its reason', 'message_not_text', refusal.reason);
  t.ok('and names it', refusal.message.includes('message_not_text'));
});

add('errors', "only a DataError failure with a lower-case token is the app's refusal", async ({ api, t }) => {
  const refusal = api.intoAppRefusal(api.errorFromFailure(3, 'message_not_text'));
  t.ok('a token is a refusal', refusal instanceof api.TrezorAppRefusedError);
  t.eq('with its reason', 'message_not_text', reasonOf(refusal));
  for (const [code, text] of [
    [3, 'Unexpected message'],
    [3, ''],
    [9, 'token_hint_mismatch'],
    [99, 'unsupported_transaction'],
  ] as const) {
    const error = api.intoAppRefusal(api.errorFromFailure(code, text));
    t.ok(`(${code}, ${JSON.stringify(text)}) stays a failure`, error instanceof api.TrezorFailureError);
    t.eq(`(${code}, ${JSON.stringify(text)}) has the CLI code device_error`, 'device_error', api.trezorErrorCode(error as never));
  }
  t.ok('a cancellation stays one', api.intoAppRefusal(api.errorFromFailure(4, 'x')) instanceof api.TrezorCancelledError);
  t.ok('another error is returned as it is', api.intoAppRefusal(new api.TrezorDeviceLockedError()) instanceof api.TrezorDeviceLockedError);
});

add('errors', 'each reason the app can refuse with has its own sentence', async ({ api, t }) => {
  const reasons: [string, string][] = [
    ['message_not_text', 'can show it as text'],
    ['token_hint_length', 'not 129 bytes long'],
    ['token_hint_kind', 'not a token transfer hint'],
    ['token_hint_mismatch', 'do not derive the token accounts'],
    ['unsupported_transaction', 'does not sign this transaction'],
    ['fee_payer_mismatch', 'not the key of this Trezor'],
    ['some_new_reason', 'refused the request: some_new_reason'],
  ];
  for (const [reason, phrase] of reasons) {
    const sentence = api.trezorRefusalSentence(reason);
    t.ok(`${reason}: says "${phrase}"`, sentence.includes(phrase), sentence);
    // A known reason is explained, not echoed.
    if (reason !== 'some_new_reason') t.ok(`${reason}: is not echoed`, !sentence.includes(reason), sentence);
  }
  const text = api.trezorRefusalSentence('message_not_text');
  for (const part of ['1 to 512 bytes of printable ASCII', 'at most 16 lines', 'a local or a Ledger key']) {
    t.ok(`the text sentence has "${part}"`, text.includes(part), text);
  }
  t.ok('the text rule is the one the sentence quotes', text.includes(api.TREZOR_TEXT_RULE));
});

// ===================================================================
// preview
// ===================================================================

const NOT_IN_A_REVIEW = ['thru__signed', 'thru__message_signed', 'thru__authorization_signed'];

add('preview', "every text of a review is the app's, under the key the app gives it, and every text of the app is used (texts_are_the_apps)", async ({ api, d, t }) => {
  const app = d.en.translations;
  const ours = api.TEXTS;
  t.ok('the app has texts', Object.keys(app).length > 30, String(Object.keys(app).length));
  for (const [key, text] of Object.entries(ours)) {
    t.ok(`${key}: the app has this text`, key in app, 'missing');
    t.eq(`${key}: the same text`, app[key], text);
  }
  const mine = new Set(Object.values(ours));
  for (const [key, text] of Object.entries(app)) {
    if (NOT_IN_A_REVIEW.includes(key)) continue;
    t.ok(`the app's ${key} = ${JSON.stringify(text)} is used by the preview`, mine.has(text));
  }
  t.eq('the closing texts are the only ones left out', NOT_IN_A_REVIEW.sort(), Object.keys(app).filter((k) => !(k in ours)).sort());
});

type Shown = Record<string, string | boolean | null | undefined>;
const REVIEW_KEYS = [
  'account', 'account_name', 'amount', 'amount_unit', 'authority_index', 'fee', 'from', 'high_fee', 'kind', 'mint',
  'network', 'nonce', 'owners', 'path', 'recipient', 'ticker', 'tx_hash', 'valid_slots',
];

const fieldsOf = (items: PreviewItem[]): PreviewField[] => items.filter((i): i is PreviewField => i.type === 'field');
/** The labelled fields as an ordered list of pairs: order and repeated labels are kept. */
const pairsOf = (fields: PreviewField[]): [string, string][] => fields.map((f) => [f.label, f.value]);
const fieldPairs = (items: PreviewItem[]): [string, string][] => pairsOf(fieldsOf(items));

function stepNamed(review: TrezorReview, name: string): PreviewStep {
  const step = review.steps.find((s) => s.name === name);
  if (!step) throw new Error(`no step ${name}`);
  return step;
}

const menuPairs = (step: PreviewStep, name: string): [string, string][] => {
  const menu = step.menus.find((m) => m.name === name);
  if (!menu) throw new Error(`no menu ${name} on ${step.name}`);
  return pairsOf(menu.fields);
};

/**
 * Each value of the fixture's `review` is on the step and under the label the app uses, in the order the app
 * draws them, and nothing else is on the step. Fields are compared as ordered lists of label and value, so a
 * changed order or a repeated label is seen.
 */
function assertMatchesReview(t: Check, name: string, review: TrezorReview, shown: Shown, texts: Record<string, string>): void {
  for (const key of Object.keys(shown)) {
    t.ok(`${name}: the fixture's review key ${key} is one this check compares`, REVIEW_KEYS.includes(key));
  }
  const text = (key: string): string => String(shown[key]);
  const kind = text('kind');
  t.eq(`${name}: kind`, kind, review.kind);

  const accountMenuOf = (step: PreviewStep): void => {
    const want: [string, string][] = [];
    if (typeof shown.account_name === 'string') want.push(['Account', shown.account_name]);
    want.push(['Derivation path', text('path')]);
    t.eq(`${name}: Account menu, in order`, want, menuPairs(step, 'Account'));
  };
  const detailsOf = (step: PreviewStep, withNonce: boolean): void => {
    const want: [string, string][] = [];
    if (withNonce) want.push(['Nonce', text('nonce')]);
    want.push(['Valid slots', text('valid_slots')], ['Transaction hash', text('tx_hash')]);
    t.eq(`${name}: Details menu, in order`, want, menuPairs(step, 'Details'));
  };
  const feeOf = (step: PreviewStep): void => {
    const fee = fieldsOf(step.items).filter((f) => f.label === 'Fee');
    t.eq(`${name}: one fee`, 1, fee.length);
    t.eq(`${name}: the fee`, text('fee'), fee[0]?.value);
    t.eq(`${name}: the fee is drawn in THRU`, 'THRU', fee[0]?.unit);
  };

  if (kind === 'create_account') {
    t.eq(`${name}: one step`, 1, review.steps.length);
    const s = review.steps[0];
    t.eq(`${name}: the step`, 'create_account', s.name);
    t.eq(
      `${name}: its fields, in order`,
      [['Account', text('account')], ['Network', text('network')], ['Fee', text('fee')]],
      fieldPairs(s.items),
    );
    feeOf(s);
    t.eq(`${name}: two menus`, 2, s.menus.length);
    accountMenuOf(s);
    detailsOf(s, false);
    return;
  }

  const prefix = kind;
  const highFee = shown.high_fee === true;
  const wantNames = [prefix, ...(highFee ? [`${prefix}/high_fee`] : []), `${prefix}/summary`];
  t.eq(`${name}: the steps`, wantNames, review.steps.map((s) => s.name));
  const first = review.steps[0];
  accountMenuOf(first);
  t.eq(`${name}: one menu on the first step`, 1, first.menus.length);
  const summary = stepNamed(review, `${prefix}/summary`);
  feeOf(summary);
  detailsOf(summary, true);
  if (highFee) {
    const s = stepNamed(review, `${prefix}/high_fee`);
    t.eq(`${name}: the warning`, [{ type: 'warning', text: texts.thru__high_fee }], s.items);
    t.eq(`${name}: no menu on the warning`, 0, s.menus.length);
  }
  const network: [string, string] = ['Network', text('network')];
  const fee: [string, string] = ['Fee', text('fee')];

  if (kind === 'transfer') {
    t.eq(`${name}: title`, 'Send', first.title);
    t.eq(`${name}: parties, in order`, [['From', text('account')], ['Recipient', text('recipient')], network], fieldPairs(first.items));
    t.eq(`${name}: sums, in order`, [['Amount', text('amount')], fee], fieldPairs(summary.items));
    t.eq(`${name}: the amount is drawn in THRU`, 'THRU', fieldsOf(summary.items).find((f) => f.label === 'Amount')?.unit);
    return;
  }

  if (kind === 'wallet_transfer') {
    t.eq(`${name}: title`, 'Send from wallet', first.title);
    const want: [string, string][] = [['Fee payer', text('account')]];
    for (const [key, label] of [['from', 'From'], ['recipient', 'Recipient']] as const) {
      if (typeof shown[key] === 'string') want.push([label, shown[key] as string]);
    }
    if (shown.authority_index !== null && shown.authority_index !== undefined) want.push(['Authority index', String(shown.authority_index)]);
    want.push(network);
    t.eq(`${name}: parties, in order`, want, fieldPairs(first.items));
    t.eq(`${name}: sums, in order`, [['Amount', String(shown.amount)], fee], fieldPairs(summary.items));
    return;
  }

  t.eq(`${name}: a token transfer`, 'token_transfer', kind);
  t.eq(`${name}: title`, 'Send token', first.title);
  const owners = shown.owners === true;
  const want: [string, string][] = [];
  if (!owners) want.push(['Fee payer', text('account')]);
  want.push(['From', text('from')], ['Recipient', text('recipient')]);
  const warnings = first.items.filter((i) => i.type === 'warning');
  if (typeof shown.mint === 'string') {
    want.push(['Token mint', shown.mint]);
    t.eq(`${name}: no warning when the mint is known`, 0, warnings.length);
  } else {
    t.eq(`${name}: the warning when it is not`, [{ type: 'warning', text: texts.thru__token_unknown }], warnings);
  }
  want.push(['Address type', owners ? 'Token account owners' : 'Token accounts'], network);
  t.eq(`${name}: parties, in order`, want, fieldPairs(first.items));
  // The signing account is on the first screen under the label the app gives it (decision T5).
  t.eq(`${name}: the signing account`, text('account'), fieldPairs(first.items).find(([label]) => label === (owners ? 'From' : 'Fee payer'))?.[1]);
  const wantSums: [string, string][] = [];
  if (shown.amount_unit === 'whole') {
    wantSums.push(['Amount', text('amount')]);
    if (text('ticker') !== '') wantSums.push(['Ticker', text('ticker')]);
  } else {
    wantSums.push(['Amount (base units)', text('amount')]);
  }
  wantSums.push(fee);
  t.eq(`${name}: sums, in order`, wantSums, fieldPairs(summary.items));
}

const unhex = (hex: string): Uint8Array => new Uint8Array(hex.length / 2).map((_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));

add('preview', 'every case of the fixture gives the fixture\'s review, or none when the app refuses it (every_fixture_case_gives_the_fixture_review)', async ({ api, d, t }) => {
  const all = d.fixture.cases;
  t.ok('the fixture did not shrink', all.length >= 50, String(all.length));
  let signed = 0;
  let refusedCount = 0;
  let hinted = 0;
  for (const c of all) {
    const path = api.parseTrezorPath(c.path);
    const key = keyAt(d, c.path);
    const body = unhex(c.body_hex);
    const hint = c.token_hint_hex === undefined ? undefined : unhex(c.token_hint_hex);
    if (hint) hinted++;
    const review = api.transactionReview(body, key.publicKey, path, hint);
    if (c.outcome === 'signed') {
      signed++;
      t.ok(`${c.name}: a review for a signed case`, review !== null);
      t.eq(`${c.name}: the key at the path is the review's account`, c.review?.account, key.address);
      t.eq(`${c.name}: its address`, key.address, thruAddress(key.publicKey));
      if (review) assertMatchesReview(t, c.name, review, c.review as Shown, d.en.translations);
    } else {
      refusedCount++;
      t.eq(`${c.name}: no preview for a refused case (${c.outcome})`, null, review);
    }
  }
  t.eq('signed cases', all.filter((c) => c.outcome === 'signed').length, signed);
  t.eq('refused cases', all.filter((c) => c.outcome !== 'signed').length, refusedCount);
  t.ok('at least 25 of each', signed >= 25 && refusedCount >= 25, `${signed} signed, ${refusedCount} refused`);
  t.ok('cases with a token hint', hinted >= 10, String(hinted));
  // Every kind of review the fixture holds.
  const kinds = new Set(all.filter((c) => c.outcome === 'signed').map((c) => String(c.review?.kind)));
  t.eq('the kinds', ['create_account', 'token_transfer', 'transfer', 'wallet_transfer'], [...kinds].sort());
});

add('preview', 'a review is a JSON value of the CLI\'s shape (json_of_every_kind of trezor_preview.rs)', async ({ api, d, t }) => {
  const field = (label: string, value: string, unit: string | null = null) => ({ type: 'field', label, value, unit });
  const account = (name: string | null, path: string) => ({
    name: 'Account',
    fields: [...(name ? [field('Account', name)] : []), field('Derivation path', path)],
  });
  const roundTrip = (review: unknown): unknown => JSON.parse(JSON.stringify(review));

  // A transfer with a high fee, from the fixture: three steps. The expected value is the Rust test's, with the fixture's values.
  const high = d.fixture.cases.find((c) => c.outcome === 'signed' && c.review?.kind === 'transfer' && c.review.high_fee === true);
  t.ok('the fixture has a transfer with a high fee', high !== undefined);
  if (high) {
    const shown = high.review as Record<string, string>;
    const key = keyAt(d, high.path);
    const review = api.transactionReview(unhex(high.body_hex), key.publicKey, high.path);
    t.eq(
      'transfer with a high fee',
      {
        kind: 'transfer',
        steps: [
          {
            name: 'transfer',
            title: 'Send',
            items: [field('From', shown.account), field('Recipient', shown.recipient), field('Network', shown.network)],
            menus: [account(shown.account_name, shown.path)],
          },
          {
            name: 'transfer/high_fee',
            title: 'High fee',
            items: [{ type: 'warning', text: 'The fee is above 0.1 THRU.' }],
            menus: [],
          },
          {
            name: 'transfer/summary',
            title: 'Summary',
            items: [field('Amount', shown.amount, 'THRU'), field('Fee', shown.fee, 'THRU')],
            menus: [
              {
                name: 'Details',
                fields: [field('Nonce', shown.nonce), field('Valid slots', shown.valid_slots), field('Transaction hash', shown.tx_hash)],
              },
            ],
          },
        ],
      },
      roundTrip(review),
    );
  }
  const create = d.fixture.cases.find((c) => c.outcome === 'signed' && c.review?.kind === 'create_account');
  t.ok('the fixture has an account creation', create !== undefined);
  if (create) {
    const shown = create.review as Record<string, string>;
    const key = keyAt(d, create.path);
    t.eq(
      'account creation',
      {
        kind: 'create_account',
        steps: [
          {
            name: 'create_account',
            title: 'Create account',
            items: [field('Account', shown.account), field('Network', shown.network), field('Fee', shown.fee, 'THRU')],
            menus: [
              account(shown.account_name, shown.path),
              { name: 'Details', fields: [field('Valid slots', shown.valid_slots), field('Transaction hash', shown.tx_hash)] },
            ],
          },
        ],
      },
      roundTrip(api.transactionReview(unhex(create.body_hex), key.publicKey, create.path)),
    );
  }
  // The token transfer without a hint, plain form: the warning item.
  const plain = d.fixture.cases.find(
    (c) => c.outcome === 'signed' && c.review?.kind === 'token_transfer' && c.token_hint_hex === undefined && c.review.mint === null,
  );
  t.ok('the fixture has a token transfer that names no mint', plain !== undefined);
  if (plain) {
    const key = keyAt(d, plain.path);
    const review = roundTrip(api.transactionReview(unhex(plain.body_hex), key.publicKey, plain.path)) as { steps: { items: unknown[] }[] };
    const items = review.steps[0].items as { type: string }[];
    t.eq('the items of its first step, in order', ['field', 'field', 'field', 'field', 'warning', 'field'], items.map((i) => i.type));
    t.eq('the warning', { type: 'warning', text: 'The transaction does not identify the token.' }, items[4]);
  }

  // A message and an authorization, as the Rust test writes them: the signer is the key [0x22; 32].
  const signer = new Uint8Array(32).fill(0x22);
  const path0 = "m/44'/8478'/0'/0'";
  const review = api.messageReview(utf8('hi\n\nyou'), signer, path0);
  const sha = await crypto.subtle.digest('SHA-256', utf8('hi\n\nyou').slice().buffer);
  t.eq(
    'message',
    {
      kind: 'message',
      steps: [
        {
          name: 'message',
          title: 'Sign message',
          items: [
            field('Signer', thruAddress(signer)),
            field('Line 1', 'hi'),
            field('Line 2 (empty)', ''),
            field('Line 3', 'you'),
          ],
          menus: [
            account('Thru #1', path0),
            { name: 'Details', fields: [field('Message hash', api.toHex(new Uint8Array(sha))), field('Length', '7 bytes')] },
          ],
        },
      ],
    },
    roundTrip(review),
  );
  const feePayer = new Uint8Array(32).fill(0x33);
  t.eq(
    'EOA authorization (delete)',
    {
      kind: 'eoa_auth',
      steps: [
        {
          name: 'eoa_auth',
          title: 'Authorize account deletion',
          items: [
            {
              type: 'note',
              text: 'The fee payer can delete this account, or clear its data, while its balance and nonce are zero.',
            },
            { type: 'note', text: 'This authorization does not expire and can be used again.' },
            field('Account', thruAddress(signer)),
            field('Fee payer', thruAddress(feePayer)),
            field('Network', 'alphanet'),
          ],
          menus: [account('Thru #1', path0)],
        },
      ],
    },
    roundTrip(api.eoaAuthReview('delete', 1, feePayer, signer, signer, path0)),
  );
  const created = api.eoaAuthReview('create', 2, feePayer, signer, signer, path0);
  t.eq('creation: title', 'Authorize account creation', created?.steps[0].title);
  t.eq('creation: note', { type: 'note', text: 'The fee payer can create this account.' }, created?.steps[0].items[0]);
  t.eq('creation: network', field('Network', 'betanet'), created?.steps[0].items[4]);
  t.eq('the app\'s number of a kind works too', JSON.stringify(created), JSON.stringify(api.eoaAuthReview(0, 2, feePayer, signer, signer, path0)));
  t.eq('an unknown chain has its own label', 'chain id 77', (api.eoaAuthReview('create', 77, feePayer, signer, signer, path0)?.steps[0].items[4] as PreviewField).value);
});

add('preview', 'a text message: one field per line, the hash and the length of the exact bytes; anything else gets no preview', async ({ api, d, t }) => {
  const signer = new Uint8Array(32).fill(0x22);
  const path0 = "m/44'/8478'/0'/0'";
  const linesOf = (r: TrezorReview | null): [string, string][] =>
    fieldsOf(r?.steps[0].items ?? []).map((f) => [f.label, f.value]);
  const one = api.messageReview(utf8('Hello, Thru!'), signer, path0);
  t.eq('a one-line message', [['Signer', thruAddress(signer)], ['Message', 'Hello, Thru!']], linesOf(one));
  t.eq('its step', ['message', 'Sign message'], [one?.steps[0].name, one?.steps[0].title]);
  t.eq('its details, in order: the hash, then the length', ['Message hash', 'Length'], menuPairs(one!.steps[0], 'Details').map(([label]) => label));
  t.eq('its length', ['Length', '12 bytes'], menuPairs(one!.steps[0], 'Details')[1]);
  t.eq('its account menu, in order: the name, then the path', [['Account', 'Thru #1'], ['Derivation path', path0]], menuPairs(one!.steps[0], 'Account'));

  const multi = api.messageReview(utf8('line one\n\nthird line\n'), signer, path0);
  t.eq(
    'empty lines are fields with an empty value and (empty) in the label',
    [['Line 1', 'line one'], ['Line 2 (empty)', ''], ['Line 3', 'third line'], ['Line 4 (empty)', '']],
    linesOf(multi).slice(1),
  );
  t.eq('its length', ['Length', '21 bytes'], menuPairs(multi!.steps[0], 'Details')[1]);

  t.eq('the longest message', [['Signer', thruAddress(signer)], ['Message', 'a'.repeat(512)]], linesOf(api.messageReview(new Uint8Array(512).fill(97), signer, path0)));
  const lines = linesOf(api.messageReview(new Uint8Array(15).fill(10), signer, path0));
  t.eq('sixteen empty lines', [17, 'Line 1 (empty)', 'Line 16 (empty)'], [lines.length, lines[1][0], lines[16][0]]);
  // The three-component path has no account name.
  const three = api.messageReview(utf8('x'), signer, "m/44'/8478'/4'");
  t.eq('depth 3: the path only', [['Derivation path', "m/44'/8478'/4'"]], menuPairs(three!.steps[0], 'Account'));

  for (const [what, message] of [
    ['empty', new Uint8Array(0)],
    ['513 bytes', new Uint8Array(513).fill(97)],
    ['not ASCII', utf8('hé')],
    ['a tab', utf8('a\tb')],
    ['two spaces', utf8('a  b')],
    ['a trailing space', utf8('trailing ')],
  ] as const) {
    t.eq(`${what}: no preview`, null, api.messageReview(message, signer, path0));
    t.ok(`${what}: not a text message`, !api.isTrezorTextMessage(message));
  }

  // Against the shared message vectors: the app shows exactly the messages the corpus calls `text`.
  let texts = 0;
  for (const v of d.messages) {
    if (v.category === 'reject') continue;
    const message = unhex(v.message_hex);
    const text = api.isTrezorTextMessage(message);
    t.eq(`${v.name}: text exactly when the corpus says text`, v.display === 'text', text);
    const review = api.messageReview(message, unhex(v.signer_pubkey_hex), v.signer_path);
    t.eq(`${v.name}: a preview exactly for text`, text, review !== null);
    if (review) {
      texts++;
      t.eq(`${v.name}: the hash, then the length`, [['Message hash', v.message_sha256_hex], ['Length', `${v.message_len} bytes`]], menuPairs(review.steps[0], 'Details'));
    }
  }
  t.ok('some vectors are text', texts >= 5, String(texts));
});

add('preview', 'an authorization the app refuses gets no preview; the corpus agrees', async ({ api, d, t }) => {
  const account = new Uint8Array(32).fill(0x22);
  const payer = new Uint8Array(32).fill(0x33);
  const path0 = "m/44'/8478'/0'/0'";
  t.eq('chain id zero', null, api.eoaAuthReview('create', 0, payer, account, account, path0));
  t.eq('an account that is not the key at the path', null, api.eoaAuthReview('create', 1, payer, new Uint8Array(32).fill(0x44), account, path0));
  t.ok('the fee payer may be the account itself', api.eoaAuthReview('create', 1, account, account, account, path0) !== null);
  let shown = 0;
  for (const v of d.eoa) {
    const review = api.eoaAuthReview(v.kind, v.chain_id, unhex(v.fee_payer_hex), unhex(v.account_hex), unhex(v.signer_pubkey_hex), v.signer_path);
    t.eq(`${v.name}: a preview exactly for what the device signs`, v.category === 'valid', review !== null);
    if (review) shown++;
  }
  t.eq('valid vectors', d.eoa.filter((v) => v.category === 'valid').length, shown);
  // The path policy is a precondition, not a refusal of the app.
  await refused({ api, d, t }, 'a path outside the policy', Promise.resolve().then(() => api.eoaAuthReview('create', 1, payer, account, account, "m/44'/501'/0'/0'")), {
    code: 'invalid_request',
    cls: 'TrezorPathError',
  });
});

add('preview', 'shape rules the fixture does not spell out, on the fixture\'s own bodies', async ({ api, d, t }) => {
  const find = (name: string): FixtureCase => {
    const c = d.fixture.cases.find((x) => x.name === name);
    if (!c) throw new Error(`no case ${name}`);
    return c;
  };
  const transfer = find('transfer');
  const key = keyAt(d, transfer.path);
  const body = unhex(transfer.body_hex);
  t.ok('the transfer has a review', api.transactionReview(body, key.publicKey, transfer.path) !== null);
  // Another key than the fee payer.
  t.eq('another key than the fee payer', null, api.transactionReview(body, keyAt(d, "m/44'/8478'/1'/0'").publicKey, transfer.path));
  // A body that is not a transaction, and a truncated one.
  t.eq('ten zero bytes', null, api.transactionReview(new Uint8Array(10), key.publicKey, transfer.path));
  t.eq('a body one byte short', null, api.transactionReview(body.slice(0, -1), key.publicKey, transfer.path));
  t.eq('a body with a byte too many', null, api.transactionReview(new Uint8Array([...body, 0]), key.publicKey, transfer.path));
  // A hint with a native transfer, whatever the hint.
  const tokenCase = d.fixture.cases.find((c) => c.outcome === 'signed' && c.token_hint_hex !== undefined);
  const hint = unhex((tokenCase as FixtureCase).token_hint_hex as string);
  t.eq('a hint with a native transfer', null, api.transactionReview(body, key.publicKey, transfer.path, hint));
  // The hint may be given as a TokenHint object too: the same review as its 129 bytes.
  const tokenBody = unhex((tokenCase as FixtureCase).body_hex);
  const slice = (i: number): Uint8Array => hint.slice(1 + 32 * i, 33 + 32 * i);
  const asObject = { mint: slice(0), recipientOwner: slice(1), recipientSeed: slice(2), sourceSeed: slice(3) };
  t.eq(
    'a hint as an object gives the review of its bytes',
    JSON.stringify(api.transactionReview(tokenBody, key.publicKey, (tokenCase as FixtureCase).path, hint)),
    JSON.stringify(api.transactionReview(tokenBody, key.publicKey, (tokenCase as FixtureCase).path, asObject)),
  );
  // A hint of the wrong length or kind is refused by the app, so there is no review.
  for (const [what, bad] of [
    ['128 bytes', hint.slice(0, 128)],
    ['130 bytes', new Uint8Array([...hint, 0])],
    ['empty', new Uint8Array(0)],
    ['kind 2', new Uint8Array([2, ...hint.slice(1)])],
  ] as const) {
    t.eq(`a hint of ${what}`, null, api.transactionReview(tokenBody, key.publicKey, (tokenCase as FixtureCase).path, bad));
  }
  // The inputs are not changed by the preview.
  const copy = body.slice();
  api.transactionReview(body, key.publicKey, transfer.path);
  t.eq('the body is untouched', api.toHex(copy), api.toHex(body));
  // A path outside the policy is a programming error, not a refusal.
  await refused({ api, d, t }, 'a path outside the policy', Promise.resolve().then(() => api.transactionReview(body, key.publicKey, "m/44'/1'/0'/0'")), {
    code: 'invalid_request',
    cls: 'TrezorPathError',
  });
});

// ===================================================================
// the app's requests, on a fake app
// ===================================================================

const SYNTHETIC_BODY = (key: FakeKey, length: number): Uint8Array => {
  // A header-sized body with the key as fee payer (offset 48): the fake app does not review.
  const body = new Uint8Array(length).map((_, i) => (i * 31 + 7) & 0xff);
  body.set(key.publicKey, 48);
  return body;
};

add('app', 'every request of the app: GetPublicKey with and without display, SignTx with the body in order and in full, SignMessage, SignEoaAuth', async (ctx) => {
  const { api, d, t } = ctx;
  const fake = fakeOf(ctx);
  const app = api.ThruApp.attach(fake as never, 7);
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);

  const shown = await app.getPublicKey(path, { showOnDevice: true });
  const silent = await app.getPublicKey(api.parseTrezorPath(path).components);
  t.eq('the key', api.toHex(key.publicKey), api.toHex(shown.publicKey));
  t.eq('the address', key.address, shown.address);
  t.eq('the same key without a screen', api.toHex(key.publicKey), api.toHex(silent.publicKey));
  t.eq('show_display on, then off', [true, false], fake.of(0).map((c) => c.request.show_display));
  t.eq('the path as sent', [...api.parseTrezorPath(path).components], fake.of(0)[0].request.address_n);

  // A body of three pieces (2048, 2048, 904): in order and in full.
  const body = SYNTHETIC_BODY(key, 5000);
  const signature = await app.signTransaction(path, body);
  t.eq('a signature of 64 bytes', 64, signature.length);
  t.eq('SignTx names the size', 5000, fake.of(2)[0].request.body_size);
  t.eq('and sends no hint', undefined, fake.of(2)[0].request.token_hint);
  t.eq('three pieces', [2048, 2048, 904], fake.of(4).map((c) => (c.request.data as Uint8Array).length));
  const sent = new Uint8Array(5000);
  let at = 0;
  for (const c of fake.of(4)) {
    sent.set(c.request.data as Uint8Array, at);
    at += (c.request.data as Uint8Array).length;
  }
  t.eq('the pieces are the body', api.toHex(body), api.toHex(sent));
  t.eq('the app signed the body', api.toHex(body), api.toHex(fake.lastMessage as Uint8Array));

  // With a hint of 129 bytes: sent as it is.
  const hint = new Uint8Array(129).map((_, i) => (i === 0 ? 1 : i));
  await app.signTransaction(path, SYNTHETIC_BODY(key, 200), { tokenHint: hint });
  t.eq('the hint is sent as it is', api.toHex(hint), api.toHex(fake.of(2)[1].request.token_hint as Uint8Array));

  // A message.
  const message = utf8('Hello, Thru!');
  const messageSignature = await app.signMessage(path, message);
  t.eq('a message signature of 64 bytes', 64, messageSignature.length);
  t.eq('the message as sent', api.toHex(message), api.toHex(fake.of(6)[0].request.message as Uint8Array));

  // An authorization, by name and by the app's number.
  const feePayer = new Uint8Array(32).fill(0x33);
  const created = await app.signEoaAuth(path, 'create', 1, feePayer, key.publicKey);
  const deleted = await app.signEoaAuth(path, 1, 1, feePayer, key.publicKey);
  t.eq('64 bytes each', [64, 64], [created.length, deleted.length]);
  t.eq(
    'kind, chain id and keys as sent',
    [0, 1, api.toHex(feePayer), api.toHex(key.publicKey)],
    [
      fake.of(8)[0].request.kind,
      fake.of(8)[0].request.chain_id,
      api.toHex(fake.of(8)[0].request.fee_payer as Uint8Array),
      api.toHex(fake.of(8)[0].request.account as Uint8Array),
    ],
  );
  t.eq('the kind by number', 1, fake.of(8)[1].request.kind);
  t.ok('the two kinds sign different messages', api.toHex(created) !== api.toHex(deleted));
});

add('app', 'what the host knows is refused before any request, with the Rust host\'s codes', async (ctx) => {
  const { api, d, t } = ctx;
  const fake = fakeOf(ctx);
  const app = api.ThruApp.attach(fake as never, 7);
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const body = SYNTHETIC_BODY(key, 200);
  const bad = async (label: string, run: () => Promise<unknown>, want: { code: string; reason?: string }): Promise<void> => {
    await refused(ctx, label, Promise.resolve().then(run), want);
    t.eq(`${label}: nothing was sent`, 0, fake.calls.length);
  };
  for (const length of [0, 1, 128, 130, 258]) {
    if (length === 129) continue;
    await bad(`a hint of ${length} bytes`, () => app.signTransaction(path, body, { tokenHint: new Uint8Array(length) }), {
      code: 'invalid_request',
      reason: 'token_hint_length',
    });
  }
  await bad('an empty message', () => app.signMessage(path, new Uint8Array(0)), { code: 'invalid_request' });
  await bad('a message of 513 bytes', () => app.signMessage(path, new Uint8Array(513).fill(97)), { code: 'invalid_request' });
  await bad('a message that is not text', () => app.signMessage(path, utf8('a\tb')), { code: 'invalid_request', reason: 'message_not_text' });
  await bad('a message with two spaces', () => app.signMessage(path, utf8('a  b')), { code: 'invalid_request', reason: 'message_not_text' });
  for (const chain of [0, -1, 65536, 1.5, Number.NaN]) {
    await bad(`chain id ${chain}`, () => app.signEoaAuth(path, 'create', chain, new Uint8Array(32), key.publicKey), { code: 'invalid_request' });
  }
  await bad('a fee payer of 31 bytes', () => app.signEoaAuth(path, 'create', 1, new Uint8Array(31), key.publicKey), { code: 'invalid_request' });
  await bad('an account of 33 bytes', () => app.signEoaAuth(path, 'create', 1, new Uint8Array(32), new Uint8Array(33)), { code: 'invalid_request' });
  await bad('an unknown kind', () => app.signEoaAuth(path, 2 as never, 1, new Uint8Array(32), key.publicKey), { code: 'invalid_request' });
  for (const wrong of [[], [44 | H], [(44 | H) >>> 0, (8478 | H) >>> 0, 0, 0]]) {
    await bad(`the path [${wrong}]`, () => app.getPublicKey(wrong.map((x) => x >>> 0)), { code: 'invalid_request' });
    await bad(`the path [${wrong}] for a transaction`, () => app.signTransaction(wrong.map((x) => x >>> 0), body), { code: 'invalid_request' });
  }
  // The longest message is not refused.
  await app.signMessage(path, new Uint8Array(512).fill(97));
  t.eq('512 bytes of text go to the app', 1, fake.of(6).length);
});

add('app', "the app's own refusal is a typed error that keeps its reason; other failures keep their kind", async (ctx) => {
  const { api, d, t } = ctx;
  const fake = fakeOf(ctx);
  const app = api.ThruApp.attach(fake as never, 7);
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  for (const reason of ['unsupported_transaction', 'token_hint_mismatch', 'fee_payer_mismatch', 'token_hint_kind']) {
    fake.refuse = reason;
    const error = await refused(ctx, reason, app.signTransaction(path, SYNTHETIC_BODY(key, 200)), {
      code: 'app_refused',
      reason,
      cls: 'TrezorAppRefusedError',
    });
    t.eq(`${reason}: the CLI's code`, 'app_refused', api.trezorErrorCode(error as never));
    t.eq(`${reason}: the connection is still open`, false, fake.closed);
  }
  fake.refuse = 'chunk_size_mismatch';
  await refused(ctx, 'a message the app refuses for its own reason', app.signMessage(path, utf8('hello')), { code: 'app_refused', reason: 'chunk_size_mismatch' });
  fake.refuse = undefined;
  // A request on a connection that was closed.
  await fake.close();
  await refused(ctx, 'a closed connection', app.getPublicKey(path), { code: 'closed' });
});

add('app', 'the app copies its inputs before the first asynchronous step too', async (ctx) => {
  const { api, d, t } = ctx;
  const fake = fakeOf(ctx);
  const app = api.ThruApp.attach(fake as never, 7);
  const path = [...api.parseTrezorPath("m/44'/8478'/0'/0'").components];
  const key = keyAt(d, "m/44'/8478'/0'/0'");
  const body = SYNTHETIC_BODY(key, 5000);
  const original = body.slice();
  const hint = new Uint8Array(129).map((_, i) => (i === 0 ? 1 : i));
  const originalHint = hint.slice();
  const pending = app.signTransaction(path, body, { tokenHint: hint });
  body.fill(0xee);
  hint.fill(0xee);
  path[2] = 0;
  await pending;
  t.eq('the body signed', api.toHex(original), api.toHex(fake.lastMessage as Uint8Array));
  t.eq('the hint sent', api.toHex(originalHint), api.toHex(fake.of(2)[0].request.token_hint as Uint8Array));
  t.eq('the path sent', [...api.parseTrezorPath("m/44'/8478'/0'/0'").components], fake.of(2)[0].request.address_n);
  const message = utf8('copy me');
  const pendingMessage = app.signMessage("m/44'/8478'/0'/0'", message);
  message.fill(0x7a);
  await pendingMessage;
  t.eq('the message signed', api.toHex(utf8('copy me')), api.toHex(fake.of(6)[0].request.message as Uint8Array));
  const feePayer = new Uint8Array(32).fill(0x33);
  const account = key.publicKey.slice();
  const pendingEoa = app.signEoaAuth("m/44'/8478'/0'/0'", 'delete', 1, feePayer, account);
  feePayer.fill(1);
  account.fill(2);
  await pendingEoa;
  t.eq('the keys of the authorization', [api.toHex(new Uint8Array(32).fill(0x33)), api.toHex(key.publicKey)], [
    api.toHex(fake.of(8)[0].request.fee_payer as Uint8Array),
    api.toHex(fake.of(8)[0].request.account as Uint8Array),
  ]);
});

add('app', 'an abort between two pieces of a body closes the connection and sends nothing more', async (ctx) => {
  const { api, d, t } = ctx;
  const fake = fakeOf(ctx);
  const app = api.ThruApp.attach(fake as never, 7);
  const key = keyAt(d, "m/44'/8478'/0'/0'");
  const controller = new AbortController();
  fake.onRequest = (call) => {
    if (call.id === 4) controller.abort();
  };
  const error = await refused(ctx, 'abort after the first piece', app.signTransaction("m/44'/8478'/0'/0'", SYNTHETIC_BODY(key, 5000), { signal: controller.signal }), {
    code: 'aborted',
  });
  t.eq('the error does not claim the device may have signed', false, (error as { outcomeUnknown: boolean }).outcomeUnknown);
  t.eq('one piece was sent', 1, fake.of(4).length);
  t.eq('the connection was closed, once', 1, fake.closeCalls);
  t.eq('nothing was signed', undefined, fake.lastMessage);
});

// ===================================================================
// the signer
// ===================================================================

add('signer', 'getAddress: the key and address of the shared vectors, the path parsed, the screen only when asked', async (ctx) => {
  const { api, d, t } = ctx;
  const fake = fakeOf(ctx);
  const signer = signerOf(ctx, fake);
  let checked = 0;
  for (const v of d.hd.derivations.filter((x) => x.name.startsWith('bip39-abandon-about/no-passphrase/'))) {
    const out = await signer.getAddress(v.path, { display: checked % 2 === 0 });
    t.eq(`${v.path}: key`, v.pubkey_hex, api.toHex(out.publicKey));
    t.eq(`${v.path}: address`, v.address, out.address);
    t.eq(`${v.path}: path`, v.path, out.path.path);
    checked++;
  }
  t.eq('eight vectors', 8, checked);
  t.eq('the screen was asked for on every other call', [true, false, true, false, true, false, true, false], fake.of(0).map((c) => c.request.show_display));
  // The scheme does not matter for an address.
  const legacy = signerOf(ctx, fakeOf(ctx), 'legacy');
  t.eq('works on a legacy network', keyAt(d, "m/44'/8478'/0'/0'").address, (await legacy.getAddress("m/44'/8478'/0'/0'")).address);
  const unset = signerOf(ctx, fakeOf(ctx), undefined);
  t.eq('works without a scheme', keyAt(d, "m/44'/8478'/0'/0'").address, (await unset.getAddress("m/44'/8478'/0'/0'")).address);
});

add('signer', "signTransactionBody signs every signed case of the fixture with the fixture's signature, verifies it and attaches it", async (ctx) => {
  const { api, d, t } = ctx;
  let count = 0;
  for (const c of d.fixture.cases.filter((x) => x.outcome === 'signed')) {
    const fake = fakeOf(ctx);
    const signer = signerOf(ctx, fake);
    const body = unhex(c.body_hex);
    const hint = c.token_hint_hex === undefined ? undefined : unhex(c.token_hint_hex);
    const out = await signer.signTransactionBody(c.path, body, { tokenHint: hint });
    t.eq(`${c.name}: the signature of the fixture`, c.signature_hex, api.toHex(out.signature));
    t.eq(`${c.name}: body then signature`, c.body_hex + (c.signature_hex as string), api.toHex(out.signedTransaction));
    t.eq(`${c.name}: the device's key`, api.toHex(keyAt(d, c.path).publicKey), api.toHex(out.publicKey));
    t.eq(`${c.name}: the hash the device shows`, (c.review as Shown).tx_hash, out.bodyHash);
    t.eq(`${c.name}: the app signed the body`, c.body_hex, api.toHex(fake.lastMessage as Uint8Array));
    t.eq(
      `${c.name}: the hint, as sent`,
      hint === undefined ? undefined : api.toHex(hint),
      fake.of(2)[0].request.token_hint === undefined ? undefined : api.toHex(fake.of(2)[0].request.token_hint as Uint8Array),
    );
    count++;
  }
  t.eq('every signed case', d.fixture.cases.filter((x) => x.outcome === 'signed').length, count);
});

add('signer', 'the app\'s bytes of a token hint: an object and its 129 bytes are the same request', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.outcome === 'signed' && x.token_hint_hex !== undefined) as FixtureCase;
  const hint = unhex(c.token_hint_hex as string);
  const slice = (i: number): Uint8Array => hint.slice(1 + 32 * i, 33 + 32 * i);
  const fake = fakeOf(ctx);
  const signer = signerOf(ctx, fake);
  await signer.signTransactionBody(c.path, unhex(c.body_hex), {
    tokenHint: { mint: slice(0), recipientOwner: slice(1), recipientSeed: slice(2), sourceSeed: slice(3) },
  });
  t.eq('the encoding of the object is the hint of the fixture', api.toHex(hint), api.toHex(fake.of(2)[0].request.token_hint as Uint8Array));
});

add('signer', 'what the app refuses in the fixture reaches the caller with the app\'s reason; what the host knows is refused first', async (ctx) => {
  const { api, d, t } = ctx;
  const refusedCases = d.fixture.cases.filter((x) => x.outcome !== 'signed');
  const seen = new Set<string>();
  for (const c of refusedCases) {
    const fake = fakeOf(ctx);
    fake.refuse = c.outcome;
    const signer = signerOf(ctx, fake);
    const hint = c.token_hint_hex === undefined ? undefined : unhex(c.token_hint_hex);
    const call = signer.signTransactionBody(c.path, unhex(c.body_hex), { tokenHint: hint });
    seen.add(c.outcome);
    if (c.outcome === 'fee_payer_mismatch') {
      // The host knows the fee payer is not the device's key: no signing request.
      await refused(ctx, c.name, call, { code: 'key_mismatch', cls: 'TrezorKeyMismatchError' });
      t.eq(`${c.name}: no SignTx`, 0, fake.of(2).length);
    } else if (c.outcome === 'token_hint_length') {
      await refused(ctx, c.name, call, { code: 'invalid_request', reason: 'token_hint_length' });
      t.eq(`${c.name}: no request at all`, 0, fake.calls.length);
    } else {
      const error = await refused(ctx, c.name, call, { code: 'app_refused', reason: c.outcome, cls: 'TrezorAppRefusedError' });
      t.ok(`${c.name}: a sentence for the person`, api.trezorRefusalSentence(reasonOf(error) as string).length > 20);
      // And the preview said so first.
      t.eq(`${c.name}: the preview said the app would refuse`, null, api.transactionReview(unhex(c.body_hex), keyAt(d, c.path).publicKey, c.path, hint));
    }
  }
  t.eq('every kind of refusal of the fixture', ['fee_payer_mismatch', 'token_hint_kind', 'token_hint_length', 'token_hint_mismatch', 'unsupported_transaction'], [...seen].sort());
});

const textVectors = (d: SigningData): MessageVector[] =>
  d.messages.filter((v) => v.category !== 'reject' && v.display === 'text' && v.message_len >= 1 && v.message_len <= 512);

add('signer', 'signMessage: the shared message vectors, each with its signature, in the tn_msg_sign_v1__ domain; the rest is refused before any request', async (ctx) => {
  const { api, d, t } = ctx;
  const good = textVectors(d);
  t.ok('the corpus has text messages', good.length >= 6, String(good.length));
  for (const v of good) {
    const key = { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) };
    const fake = new FakeApp(api, key);
    const signer = signerOf(ctx, fake);
    const out = await signer.signMessage(v.signer_path, unhex(v.message_hex));
    t.eq(`${v.name}: the corpus signature`, v.signature_hex, api.toHex(out.signature));
    t.eq(`${v.name}: the key`, v.signer_pubkey_hex, api.toHex(out.publicKey));
    // The domain: the corpus signs "tn_msg_sign_v1__" || message, and the signer accepted the device's signature as that.
    t.eq(`${v.name}: the signed message of the corpus`, api.toHex(utf8('tn_msg_sign_v1__')) + v.message_hex, v.signing_message_hex);
    t.eq(`${v.name}: the app signed the message`, v.message_hex, api.toHex(fake.lastMessage as Uint8Array));
  }
  for (const v of d.messages.filter((x) => !good.includes(x))) {
    const fake = new FakeApp(api, { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) });
    const message = unhex(v.message_hex);
    await refused(ctx, `${v.name} (${v.message_len} bytes)`, signerOf(ctx, fake).signMessage(v.signer_path, message), {
      code: 'invalid_request',
      ...(v.message_len >= 1 && v.message_len <= 512 ? { reason: 'message_not_text' } : {}),
    });
    t.eq(`${v.name}: nothing was sent`, 0, fake.calls.length);
  }
});

const validEoa = (d: SigningData): EoaVector[] => d.eoa.filter((v) => v.category === 'valid');

add('signer', 'signEoaAuth: the shared authorization vectors, each with its signature and its signing message, in the domain of its kind', async (ctx) => {
  const { api, d, t } = ctx;
  t.eq('the corpus has 8 valid authorizations', 8, validEoa(d).length);
  for (const v of validEoa(d)) {
    const key = { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) };
    const fake = new FakeApp(api, key);
    const signer = signerOf(ctx, fake);
    const feePayer = unhex(v.fee_payer_hex);
    const account = unhex(v.account_hex);
    // The message the app signs is the corpus's, byte for byte, and so is the SDK's builder.
    t.eq(`${v.name}: the message as built by the fake app`, v.auth_message_hex, api.toHex(eoaAuthMessage(v.kind, v.chain_id, feePayer, account)));
    t.eq(
      `${v.name}: the message as built by the SDK`,
      v.auth_message_hex,
      api.toHex((v.kind === 'create' ? eoa.buildEOACreateMessage : eoa.buildEOADeleteMessage)(v.chain_id, feePayer, account)),
    );
    const out = await signer.signEoaAuth(v.signer_path, v.kind, v.chain_id, feePayer, account);
    t.eq(`${v.name}: the corpus signature`, v.signature_hex, api.toHex(out.signature));
    t.eq(`${v.name}: the key`, v.signer_pubkey_hex, api.toHex(out.publicKey));
    t.eq(`${v.name}: what the app signed`, v.auth_message_hex, api.toHex(fake.lastMessage as Uint8Array));
  }
  // A signature in the other kind's domain is not accepted.
  const v = validEoa(d)[0];
  const fake = new FakeApp(api, { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) });
  fake.tamper = { signInDomain: 6 /* EOA_DELETE */ };
  await refused(ctx, 'a create authorization signed in the delete domain', signerOf(ctx, fake).signEoaAuth(v.signer_path, 'create', v.chain_id, unhex(v.fee_payer_hex), unhex(v.account_hex)), {
    code: 'app',
    cls: 'TrezorInvalidSignatureError',
  });
});

add('signer', 'the device-only rejections of the corpus: a zero chain id before any request, another account after the silent key read and before the signing request', async (ctx) => {
  const { api, d, t } = ctx;
  for (const v of d.eoa.filter((x) => x.category !== 'valid')) {
    const key = { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) };
    const fake = new FakeApp(api, key);
    const call = signerOf(ctx, fake).signEoaAuth(v.signer_path, v.kind, v.chain_id, unhex(v.fee_payer_hex), unhex(v.account_hex));
    if (v.reject_reason === 'bad_chain_id') {
      await refused(ctx, v.name, call, { code: 'invalid_request' });
      t.eq(`${v.name}: no request at all`, 0, fake.calls.length);
    } else {
      t.eq(`${v.name}: the corpus names it`, 'account_mismatch', v.reject_reason);
      await refused(ctx, v.name, call, { code: 'invalid_request' });
      t.eq(`${v.name}: only the silent key read was made`, [0], fake.calls.map((c) => c.id));
      t.eq(`${v.name}: and it showed nothing`, [false], fake.of(0).map((c) => c.request.show_display));
    }
  }
});

add('signer', 'the key: one the caller did not expect, a device that has another key than the fee payer, an address that is not the key\'s', async (ctx) => {
  const { api, d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const other = keyAt(d, "m/44'/8478'/1'/0'");
  const body = unhex((d.fixture.cases.find((c) => c.name === 'transfer_shared_corpus') as FixtureCase).body_hex);
  const message = utf8('hello');
  // The device has account 0; the caller expected account 1.
  for (const [what, run] of [
    ['getAddress', (s: ReturnType<typeof signerOf>) => s.getAddress(path, { expectedPublicKey: other.publicKey })],
    ['signTransactionBody', (s: ReturnType<typeof signerOf>) => s.signTransactionBody(path, body, { expectedPublicKey: other.publicKey })],
    ['signMessage', (s: ReturnType<typeof signerOf>) => s.signMessage(path, message, { expectedPublicKey: other.publicKey })],
  ] as const) {
    const fake = fakeOf(ctx);
    const error = await refused(ctx, `${what}: another key than expected`, run(signerOf(ctx, fake)), { code: 'key_mismatch', cls: 'TrezorKeyMismatchError' });
    t.eq(`${what}: it names both addresses`, [other.address, keyAt(d, path).address], [(error as { expected: string }).expected, (error as { got: string }).got]);
    t.eq(`${what}: nothing was signed`, 0, fake.calls.filter((c) => c.id !== 0).length);
  }
  // A device with the key of account 1 where the transaction is for account 0.
  const wrongDevice = new FakeApp(api, other);
  await refused(ctx, 'a device that is not the fee payer', signerOf(ctx, wrongDevice).signTransactionBody(path, body), { code: 'key_mismatch' });
  t.eq('no SignTx', 0, wrongDevice.of(2).length);
  // An address that is not the key's.
  const liar = fakeOf(ctx);
  liar.tamper = { wrongAddress: true };
  await refused(ctx, 'a wrong address', signerOf(ctx, liar).getAddress(path), { code: 'app', cls: 'TrezorAppError' });
  await refused(ctx, 'a wrong address on a signing path', signerOf(ctx, liar).signMessage(path, message), { code: 'app' });
  t.eq('nothing was signed', 0, liar.calls.filter((c) => c.id !== 0).length);
  // The device reports another key: the fee payer check catches it before SignTx.
  const impostor = fakeOf(ctx);
  impostor.tamper = { reportKey: other.publicKey };
  await refused(ctx, 'a device that reports the key of another account', signerOf(ctx, impostor).signTransactionBody(path, body), { code: 'key_mismatch' });
  t.eq('no SignTx', 0, impostor.of(2).length);
});

add('signer', 'a signature that does not verify is never returned: a changed bit, the wrong domain, the wrong length', async (ctx) => {
  const { api, d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const body = unhex((d.fixture.cases.find((c) => c.name === 'transfer_shared_corpus') as FixtureCase).body_hex);
  const message = utf8('hello');
  const feePayer = new Uint8Array(32).fill(0x33);
  const requests: [string, (s: ReturnType<typeof signerOf>) => Promise<unknown>][] = [
    ['transaction', (s) => s.signTransactionBody(path, body)],
    ['message', (s) => s.signMessage(path, message)],
    ['EOA authorization', (s) => s.signEoaAuth(path, 'create', 1, feePayer, key.publicKey)],
  ];
  const tampers: [string, Record<string, unknown>][] = [
    ['a changed bit', { flipSignature: true }],
    ['the message domain', { signInDomain: 7 }],
    ['the transaction domain', { signInDomain: 0 }],
    ['the delete domain', { signInDomain: 6 }],
  ];
  for (const [what, run] of requests) {
    for (const [how, tamper] of tampers) {
      // A request signed in its own domain is not a tamper.
      const own = { transaction: 0, message: 7, 'EOA authorization': 5 }[what];
      if (tamper.signInDomain === own) continue;
      const fake = fakeOf(ctx);
      fake.tamper = tamper;
      const error = await refused(ctx, `${what}: ${how}`, run(signerOf(ctx, fake)), { code: 'app', cls: 'TrezorInvalidSignatureError' });
      t.eq(`${what}: ${how}: the CLI's code`, 'protocol_error', api.trezorErrorCode(error as never));
      t.eq(`${what}: ${how}: the device signed and its signature is unusable, so the outcome is unknown`, true, (error as { outcomeUnknown: boolean }).outcomeUnknown);
    }
    const short = fakeOf(ctx);
    short.tamper = { signatureLength: 63 };
    const shortError = await refused(ctx, `${what}: a signature of 63 bytes`, run(signerOf(ctx, short)), { code: 'app', cls: 'TrezorAppError' });
    t.eq(`${what}: a signature of 63 bytes: the outcome is unknown`, true, (shortError as { outcomeUnknown: boolean }).outcomeUnknown);
  }
});

add('signer', 'a signature that does not verify leaves the connection open and usable: the answer was whole and the stream is in step', async (ctx) => {
  const { d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const body = unhex((d.fixture.cases.find((c) => c.name === 'transfer_shared_corpus') as FixtureCase).body_hex);
  const feePayer = new Uint8Array(32).fill(0x33);
  const requests: [string, (s: ReturnType<typeof signerOf>) => Promise<unknown>][] = [
    ['transaction', (s) => s.signTransactionBody(path, body)],
    ['message', (s) => s.signMessage(path, utf8('hello'))],
    ['EOA authorization', (s) => s.signEoaAuth(path, 'create', 1, feePayer, key.publicKey)],
  ];
  for (const [what, run] of requests) {
    const fake = fakeOf(ctx);
    const signer = signerOf(ctx, fake);
    fake.tamper = { flipSignature: true };
    await refused(ctx, `${what}: a signature that does not verify`, run(signer), { code: 'app', cls: 'TrezorInvalidSignatureError' });
    t.eq(`${what}: the connection was not closed`, 0, fake.closeCalls);
    t.ok(`${what}: the app is still loaded`, fake.loadedApp !== undefined && !fake.closed);
    fake.tamper = {};
    const ok = await run(signer);
    t.ok(`${what}: the next request is served`, ok !== undefined);
  }
});

add('signer', 'the network must use RFC 8032: anything else is refused before the device is used, by every signing call', async (ctx) => {
  const { api, d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const body = unhex((d.fixture.cases.find((c) => c.name === 'transfer_shared_corpus') as FixtureCase).body_hex);
  for (const scheme of ['legacy', undefined, 'RFC8032', 'rfc8032 ', 0, null]) {
    const fake = fakeOf(ctx);
    const signer = signerOf(ctx, fake, scheme);
    const label = `scheme ${JSON.stringify(scheme)}`;
    const want = { code: 'unsupported_signing_scheme', cls: 'TrezorUnsupportedSigningSchemeError' };
    await refused(ctx, `${label}: a transaction`, signer.signTransactionBody(path, body), want);
    await refused(ctx, `${label}: a message`, signer.signMessage(path, utf8('hello')), want);
    await refused(ctx, `${label}: an authorization`, signer.signEoaAuth(path, 'create', 1, new Uint8Array(32), key.publicKey), want);
    t.eq(`${label}: the device was not used`, 0, fake.calls.length);
  }
  const named = await t.rejects('the refusal names the scheme', signerOf(ctx, fakeOf(ctx), 'legacy').signMessage(path, utf8('hi')));
  t.eq('scheme on the error', 'legacy', (named as { scheme?: string }).scheme);
  t.ok('and says so', /"legacy"/.test(String((named as Error).message)));
  const none = await t.rejects('no scheme', signerOf(ctx, fakeOf(ctx), undefined).signMessage(path, utf8('hi')));
  t.eq('no scheme on the error', undefined, (none as { scheme?: string }).scheme);
  t.ok('and the text says to pass one', /transactionSigningScheme/.test(String((none as Error).message)));
  // RFC 8032 works.
  const ok = await signerOf(ctx, fakeOf(ctx), 'rfc8032').signMessage(path, utf8('hi'));
  t.eq('RFC 8032 signs', 64, ok.signature.length);
  t.eq('the assertion is also exported', 'unsupported_signing_scheme', codeOf(await t.rejects('assert', Promise.resolve().then(() => api.assertTrezorSigningScheme('legacy')))));
});

add('signer', 'the host refuses before any request what the app would refuse and the host can know', async (ctx) => {
  const { api, d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const body = unhex((d.fixture.cases.find((c) => c.name === 'transfer_shared_corpus') as FixtureCase).body_hex);
  const run = async (label: string, call: (s: ReturnType<typeof signerOf>) => Promise<unknown>, want: { code: string; reason?: string; cls?: string }) => {
    const fake = fakeOf(ctx);
    await refused(ctx, label, call(signerOf(ctx, fake)), want);
    t.eq(`${label}: no request was made`, 0, fake.calls.length);
  };
  await run('a message of 513 bytes', (s) => s.signMessage(path, new Uint8Array(513).fill(97)), { code: 'invalid_request' });
  await run('an empty message', (s) => s.signMessage(path, new Uint8Array(0)), { code: 'invalid_request' });
  await run('a message that is not text', (s) => s.signMessage(path, utf8('héllo')), { code: 'invalid_request', reason: 'message_not_text' });
  await run('a message of binary bytes', (s) => s.signMessage(path, new Uint8Array([0, 1, 2, 3])), { code: 'invalid_request', reason: 'message_not_text' });
  await run('chain id 0', (s) => s.signEoaAuth(path, 'create', 0, new Uint8Array(32), key.publicKey), { code: 'invalid_request' });
  await run('chain id 65536', (s) => s.signEoaAuth(path, 'delete', 65536, new Uint8Array(32), key.publicKey), { code: 'invalid_request' });
  await run('a hint of 128 bytes', (s) => s.signTransactionBody(path, body, { tokenHint: new Uint8Array(128) }), { code: 'invalid_request', reason: 'token_hint_length' });
  await run('a hint of 130 bytes', (s) => s.signTransactionBody(path, body, { tokenHint: new Uint8Array(130) }), { code: 'invalid_request', reason: 'token_hint_length' });
  await run('a body shorter than the header', (s) => s.signTransactionBody(path, new Uint8Array(111)), { code: 'invalid_request' });
  await run('a path outside the policy (transaction)', (s) => s.signTransactionBody("m/44'/501'/0'/0'", body), { code: 'invalid_request', cls: 'TrezorPathError' });
  await run('a path outside the policy (message)', (s) => s.signMessage("m/44'/8478'/0'/1'", utf8('hi')), { code: 'invalid_request', cls: 'TrezorPathError' });
  await run('a path outside the policy (authorization)', (s) => s.signEoaAuth([44, 8478, 0, 0], 'create', 1, new Uint8Array(32), key.publicKey), { code: 'invalid_request', cls: 'TrezorPathError' });
  await run('a path outside the policy (address)', (s) => s.getAddress("m/44'"), { code: 'invalid_request', cls: 'TrezorPathError' });
  await run('an expected key of 31 bytes', (s) => s.signMessage(path, utf8('hi'), { expectedPublicKey: new Uint8Array(31) }), { code: 'invalid_request' });
  await run('a fee payer of 31 bytes', (s) => s.signEoaAuth(path, 'create', 1, new Uint8Array(31), key.publicKey), { code: 'invalid_request' });
  await run('an unknown kind', (s) => s.signEoaAuth(path, 'update' as never, 1, new Uint8Array(32), key.publicKey), { code: 'invalid_request' });
  void api;
});

add('signer', 'inputs the caller changes after the call started do not change what is sent', async (ctx) => {
  const { api, d, t } = ctx;
  const path = [...api.parseTrezorPath("m/44'/8478'/0'/0'").components];
  const key = keyAt(d, "m/44'/8478'/0'/0'");

  // A transaction with its hint, signed for real: the fixture's token case.
  const c = d.fixture.cases.find((x) => x.outcome === 'signed' && x.token_hint_hex !== undefined) as FixtureCase;
  const body = unhex(c.body_hex);
  const hint = unhex(c.token_hint_hex as string);
  const fakeTx = fakeOf(ctx);
  const pendingTx = signerOf(ctx, fakeTx).signTransactionBody(path, body, { tokenHint: hint });
  const expected = { body: c.body_hex, hint: c.token_hint_hex };
  body.fill(0xee);
  hint.fill(0xee);
  path[2] = 0;
  const outTx = await pendingTx;
  t.eq('the transaction signed is the one passed', expected.body, api.toHex(fakeTx.lastMessage as Uint8Array));
  t.eq('the hint sent is the one passed', expected.hint, api.toHex(fakeTx.of(2)[0].request.token_hint as Uint8Array));
  t.eq('the signature is the fixture\'s', c.signature_hex, api.toHex(outTx.signature));
  t.eq('the path sent is the one passed', [...api.parseTrezorPath("m/44'/8478'/0'/0'").components], fakeTx.of(2)[0].request.address_n);

  // A message.
  const message = utf8('hello, thru');
  const fakeMsg = fakeOf(ctx);
  const pendingMsg = signerOf(ctx, fakeMsg).signMessage("m/44'/8478'/0'/0'", message);
  message.fill(0x7a);
  await pendingMsg;
  t.eq('the message sent is the one passed', api.toHex(utf8('hello, thru')), api.toHex(fakeMsg.lastMessage as Uint8Array));

  // An authorization, with its keys.
  const feePayer = new Uint8Array(32).fill(0x33);
  const account = key.publicKey.slice();
  const fakeEoa = fakeOf(ctx);
  const pendingEoa = signerOf(ctx, fakeEoa).signEoaAuth("m/44'/8478'/0'/0'", 'create', 1, feePayer, account);
  feePayer.fill(0x44);
  account.fill(0x55);
  await pendingEoa;
  t.eq('the fee payer sent is the one passed', api.toHex(new Uint8Array(32).fill(0x33)), api.toHex(fakeEoa.of(8)[0].request.fee_payer as Uint8Array));
  t.eq('the account sent is the one passed', api.toHex(key.publicKey), api.toHex(fakeEoa.of(8)[0].request.account as Uint8Array));

  // The key the caller expects.
  const expectedKey = key.publicKey.slice();
  const fakeKey = fakeOf(ctx);
  const pendingKey = signerOf(ctx, fakeKey).getAddress("m/44'/8478'/0'/0'", { expectedPublicKey: expectedKey });
  expectedKey.fill(1);
  t.eq('the expected key was copied', key.address, (await pendingKey).address);

  // The results are copies too: changing a result does not change the device's next answer.
  const results = await signerOf(ctx, fakeOf(ctx)).getAddress("m/44'/8478'/0'/0'");
  results.publicKey.fill(0);
  t.eq('the path of a result is frozen', true, Object.isFrozen(results.path));
});

add('signer', 'abort: before the call, while the device waits, and the connection after it', async (ctx) => {
  const { d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const body = unhex((d.fixture.cases.find((c) => c.name === 'transfer_shared_corpus') as FixtureCase).body_hex);
  // Already aborted: nothing is sent, by any call.
  const done = new AbortController();
  done.abort();
  const calls: [string, (s: ReturnType<typeof signerOf>) => Promise<unknown>][] = [
    ['getAddress', (s) => s.getAddress(path, { signal: done.signal })],
    ['signTransactionBody', (s) => s.signTransactionBody(path, body, { signal: done.signal })],
    ['signMessage', (s) => s.signMessage(path, utf8('hi'), { signal: done.signal })],
    ['signEoaAuth', (s) => s.signEoaAuth(path, 'create', 1, new Uint8Array(32), key.publicKey, { signal: done.signal })],
  ];
  for (const [what, run] of calls) {
    const fake = fakeOf(ctx);
    await refused(ctx, `${what} with an aborted signal`, run(signerOf(ctx, fake)), { code: 'aborted', cls: 'TrezorAbortedError' });
    t.eq(`${what}: no request was made`, 0, fake.calls.length);
  }
  // Aborted while the device shows the review: the outcome is unknown, and the connection is gone.
  const controller = new AbortController();
  const fake = fakeOf(ctx);
  let release!: () => void;
  fake.hold.set(6, new Promise<void>((resolve) => void (release = resolve)));
  const signer = signerOf(ctx, fake);
  const pending = signer.signMessage(path, utf8('hello'), { signal: controller.signal });
  const outcome = pending.then(() => undefined, (e: unknown) => e);
  await new Promise((resolve) => setTimeout(resolve, 20));
  t.eq('the request is waiting at the device', 1, fake.of(6).length);
  controller.abort();
  const error = await outcome;
  t.eq('aborted', 'aborted', codeOf(error));
  t.eq('the device may have signed: the outcome is unknown', true, (error as { outcomeUnknown: boolean }).outcomeUnknown);
  release();
  // The request is never repeated: one request reached the device, and the connection is closed.
  t.eq('one request only', 1, fake.of(6).length);
  await refused(ctx, 'the next call', signer.signMessage(path, utf8('hello')), { code: 'closed' });
  t.eq('and it was not sent', 1, fake.of(6).length);
});

add('signer', 'closing the signer closes the connection once; later calls fail as closed', async (ctx) => {
  const { t } = ctx;
  const fake = fakeOf(ctx);
  const signer = signerOf(ctx, fake);
  await signer.getAddress("m/44'/8478'/0'/0'");
  await signer.close();
  await signer.close();
  t.eq('the connection was closed', true, fake.closed);
  await refused(ctx, 'getAddress after close', signer.getAddress("m/44'/8478'/0'/0'"), { code: 'closed' });
  await refused(ctx, 'a message after close', signer.signMessage("m/44'/8478'/0'/0'", utf8('hi')), { code: 'closed' });
  t.eq('no request after close', 1, fake.calls.length);
});

// ===================================================================
// the adapter
// ===================================================================

type FakeThru = {
  ctx: { transactionSigningScheme: string | undefined };
  transactions: { build(o: unknown): Promise<{ toWireForSigning(): Uint8Array }>; send(tx: Uint8Array): Promise<string> };
  chain: { getChainId(): Promise<number> };
  proofs: { generate(o: unknown): Promise<{ proof: Uint8Array }> };
  built: unknown[];
  sent: Uint8Array[];
  proofsAsked: unknown[];
};

function fakeThru(wire: Uint8Array, ...scheme: [] | [string | undefined]): FakeThru {
  const thru: FakeThru = {
    ctx: { transactionSigningScheme: scheme.length === 0 ? 'rfc8032' : scheme[0] },
    transactions: {
      async build(o) {
        thru.built.push(o);
        return { toWireForSigning: () => wire.slice() };
      },
      async send(tx) {
        thru.sent.push(tx.slice());
        return 'sent-signature';
      },
    },
    chain: { getChainId: async () => 1 },
    proofs: {
      async generate(o) {
        thru.proofsAsked.push(o);
        return { proof: new Uint8Array(40).fill(9) };
      },
    },
    built: [],
    sent: [],
    proofsAsked: [],
  };
  return thru;
}

add('adapter', 'build, review, sign and send: the review comes before the device, the signature is the fixture\'s, and the transaction goes out whole', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const path = c.path;
  const key = keyAt(d, path);
  const body = unhex(c.body_hex);
  const fake = fakeOf(ctx);
  const signer = signerOf(ctx, fake);
  const thru = fakeThru(body);
  const reviews: { review: TrezorReview; requestsSoFar: number }[] = [];
  const result = await api.buildAndSignWithTrezor(thru as never, signer, path, key.publicKey, { program: new Uint8Array(32).fill(1), instructionData: new Uint8Array(0) } as never, {
    onReview: async (review) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      reviews.push({ review, requestsSoFar: fake.calls.length });
    },
  });
  t.eq('the review was shown once, before any request', [0], reviews.map((r) => r.requestsSoFar));
  assertMatchesReview(t, c.name, reviews[0].review, c.review as Shown, d.en.translations);
  t.eq('the signature of the fixture', c.signature_hex, api.toHex(result.signature));
  t.eq('the signed transaction', c.body_hex + (c.signature_hex as string), api.toHex(result.signedTransaction));
  t.eq('the review of the result is the one shown', JSON.stringify(reviews[0].review), JSON.stringify(result.review));
  const built = thru.built[0] as { feePayer: { publicKey: Uint8Array }; header: Record<string, number> };
  t.eq('the transaction was built for the Trezor key as fee payer', api.toHex(key.publicKey), api.toHex(built.feePayer.publicKey));
  // An EOA-program call gets the transfer budget unless it names its own.
  const eoaBuild = await api.buildAndSignWithTrezor(thru as never, signer, path, key.publicKey, { program: eoa.EOA_PROGRAM_ADDRESS, instructionData: new Uint8Array(0) } as never);
  void eoaBuild;
  t.eq('the EOA budget', { computeUnits: 10_000, memoryUnits: 10_000, stateUnits: 0 }, {
    computeUnits: (thru.built[1] as { header: Record<string, number> }).header.computeUnits,
    memoryUnits: (thru.built[1] as { header: Record<string, number> }).header.memoryUnits,
    stateUnits: (thru.built[1] as { header: Record<string, number> }).header.stateUnits,
  });
  const id = await api.sendWithTrezor(thru as never, signer, path, key.publicKey, { program: new Uint8Array(32).fill(1), instructionData: new Uint8Array(0) } as never);
  t.eq('the transaction id', 'sent-signature', id);
  t.eq('the transaction that was sent', c.body_hex + (c.signature_hex as string), api.toHex(thru.sent[0]));
});

add('adapter', 'sendWithTrezor never submits when the original signal aborts after signing, even if options.signal is replaced', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  for (const replaceSignal of [false, true]) {
    const fake = fakeOf(ctx);
    const signer = signerOf(ctx, fake);
    const thru = fakeThru(unhex(c.body_hex));
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const sign = signer.signTransactionBody.bind(signer);
    signer.signTransactionBody = async (...args) => {
      const result = await sign(...args);
      controller.abort();
      if (replaceSignal) options.signal = new AbortController().signal;
      return result;
    };
    await refused(
      ctx,
      `cancelled after signing, signal replaced: ${replaceSignal}`,
      api.sendWithTrezor(thru as never, signer, c.path, key.publicKey, { program: eoa.EOA_PROGRAM_ADDRESS } as never, options),
      { code: 'aborted', cls: 'TrezorAbortedError' },
    );
    t.eq('the device was asked to sign', 1, fake.of(2).length);
    t.eq('nothing was submitted', [], thru.sent);
  }
});

add('adapter', 'a transaction the app will refuse, and a network that is not RFC 8032, end the call before the device', async (ctx) => {
  const { api, d, t } = ctx;
  const refusedCase = d.fixture.cases.find((x) => x.name === 'refuse_transfer_with_second_account') as FixtureCase;
  const key = keyAt(d, refusedCase.path);
  const fake = fakeOf(ctx);
  const signer = signerOf(ctx, fake);
  let reviewed = 0;
  const error = await refused(
    ctx,
    'a shape the app does not sign',
    api.buildAndSignWithTrezor(fakeThru(unhex(refusedCase.body_hex)) as never, signer, refusedCase.path, key.publicKey, { program: new Uint8Array(32).fill(1) } as never, {
      onReview: () => void reviewed++,
    }),
    { code: 'invalid_request', reason: 'unsupported_transaction' },
  );
  t.ok('the text says the app will refuse it', /will refuse/.test(String((error as Error).message)));
  t.eq('the caller was not shown a review', 0, reviewed);
  t.eq('the device was not used', 0, fake.calls.length);

  // A hint that does not prove the accounts is a refusal too.
  const tokenCase = d.fixture.cases.find((x) => x.outcome === 'signed' && x.token_hint_hex !== undefined) as FixtureCase;
  const bad = unhex(tokenCase.token_hint_hex as string);
  bad[40] ^= 1;
  await refused(
    ctx,
    'a hint that does not prove the accounts',
    api.buildAndSignWithTrezor(fakeThru(unhex(tokenCase.body_hex)) as never, signer, tokenCase.path, keyAt(d, tokenCase.path).publicKey, { program: new Uint8Array(32).fill(1) } as never, { tokenHint: bad }),
    { code: 'invalid_request', reason: 'unsupported_transaction' },
  );
  t.eq('the device was not used', 0, fake.calls.length);

  // The caller's own refusal in onReview ends the call.
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  await refused(
    ctx,
    'the person declines the review',
    api.buildAndSignWithTrezor(fakeThru(unhex(c.body_hex)) as never, signer, c.path, keyAt(d, c.path).publicKey, { program: new Uint8Array(32).fill(1) } as never, {
      onReview: () => {
        throw new Error('no');
      },
    }),
    { code: 'aborted' },
  );
  t.eq('the device was not used after a declined review', 0, fake.calls.length);

  for (const scheme of ['legacy', undefined]) {
    const thru = fakeThru(unhex(c.body_hex), scheme);
    await refused(ctx, `scheme ${scheme}`, api.buildAndSignWithTrezor(thru as never, signer, c.path, keyAt(d, c.path).publicKey, { program: new Uint8Array(32).fill(1) } as never), {
      code: 'unsupported_signing_scheme',
    });
    t.eq(`scheme ${scheme}: nothing was built`, 0, thru.built.length);
  }
  t.eq('the device was not used', 0, fake.calls.length);
});

add('adapter', 'trezorBodySigner and privateKeyBodySigner: the SDK\'s TransactionBodySigner', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  const body = unhex(c.body_hex);
  const fake = fakeOf(ctx);
  const bodySigner = api.trezorBodySigner(signerOf(ctx, fake), c.path, key.publicKey);
  t.eq('the key', api.toHex(key.publicKey), api.toHex(bodySigner.publicKey));
  const wire = await bodySigner.signTransactionBody(body);
  t.eq('body then the fixture signature', c.body_hex + (c.signature_hex as string), api.toHex(wire));
  // The signal of the call reaches the device call.
  const aborted = new AbortController();
  aborted.abort();
  await refused(ctx, 'an aborted call', bodySigner.signTransactionBody(body, { signal: aborted.signal }), { code: 'aborted' });
  // A signer for a key the device does not have.
  const other = keyAt(d, "m/44'/8478'/1'/0'");
  const wrong = api.trezorBodySigner(signerOf(ctx, fakeOf(ctx)), c.path, other.publicKey);
  await refused(ctx, 'a signer for the wrong key', wrong.signTransactionBody(body), { code: 'key_mismatch' });
  // A local key, as the fee payer of an account creation.
  const local = api.privateKeyBodySigner(key.seed, key.publicKey);
  t.eq('a local key signs the same body the same way', c.body_hex + (c.signature_hex as string), api.toHex(await local.signTransactionBody(body)));
  // The caller's key is copied.
  const seed = key.seed.slice();
  const copy = api.privateKeyBodySigner(seed, key.publicKey);
  seed.fill(0);
  t.eq('the key was copied', c.body_hex + (c.signature_hex as string), api.toHex(await copy.signTransactionBody(body)));
});

add('adapter', 'createTrezorEoa: the device authorizes its own creation (the corpus signature), a fee payer signs the transaction, the transaction is sent', async (ctx) => {
  const { api, d, t } = ctx;
  const v = d.eoa.find((x) => x.name === 'ledger_eoa_create_chain_1') as EoaVector;
  const trezorKey = { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) };
  const payerKey = keyAt(d, "m/44'/8478'/1'/0'");
  t.eq('the fee payer of the vector is the key of account 1', v.fee_payer_hex, api.toHex(payerKey.publicKey));
  const fake = new FakeApp(api, trezorKey);
  const signer = signerOf(ctx, fake);
  // The transaction the builder returns: a header with the fee payer in place.
  const wire = new Uint8Array(120).map((_, i) => (i * 5) & 0xff);
  wire.set(payerKey.publicKey, 48);
  const thru = fakeThru(wire);
  const feePayer = api.privateKeyBodySigner(payerKey.seed, payerKey.publicKey);
  const result = await api.createTrezorEoa({ thru: thru as never, trezor: signer, path: v.signer_path, feePayer });
  t.eq('the authorization is the corpus signature', v.signature_hex, api.toHex(result.authorization));
  t.eq('the device was asked for its key (to name the account), for it again (before signing), then to sign', [0, 0, 8], fake.calls.map((c) => c.id));
  t.eq('the authorization names chain 1 and the fee payer', [1, v.fee_payer_hex], [fake.of(8)[0].request.chain_id, api.toHex(fake.of(8)[0].request.fee_payer as Uint8Array)]);
  t.eq('the proof was asked for the new account, as a CREATING proof', api.toHex(trezorKey.publicKey), api.toHex((thru.proofsAsked[0] as { address: Uint8Array }).address));
  const built = thru.built[0] as { accounts: { readWrite: Uint8Array[] }; header: Record<string, number>; feePayer: { publicKey: Uint8Array } };
  t.eq('the new account is read-write', [api.toHex(trezorKey.publicKey)], built.accounts.readWrite.map((k) => api.toHex(k)));
  t.eq('the creation budget has a state unit', 1, built.header.stateUnits);
  t.eq('the chain id', 1, built.header.chainId);
  t.eq('the transaction that was sent is body then a signature', wire.length + 64, thru.sent[0].length);
  t.eq('and starts with the body', api.toHex(wire), api.toHex(thru.sent[0].slice(0, wire.length)));
  t.eq('the result carries it', api.toHex(thru.sent[0]), api.toHex(result.signedTransaction));
  t.eq('the result names the new key', api.toHex(trezorKey.publicKey), api.toHex(result.publicKey));
  t.eq('and the id', 'sent-signature', result.transactionSignature);

  // A fee payer that returns another body is not trusted.
  const liar = { publicKey: payerKey.publicKey, signTransactionBody: async (b: Uint8Array) => new Uint8Array([...b.slice().fill(0xff, 0, 1), ...new Uint8Array(64)]) };
  await refused(ctx, 'a fee payer that changes the body', api.createTrezorEoa({ thru: fakeThru(wire) as never, trezor: signerOf(ctx, new FakeApp(api, trezorKey)), path: v.signer_path, feePayer: liar }), { code: 'invalid_request' });
  // A legacy network ends it before the device.
  const legacyFake = new FakeApp(api, trezorKey);
  await refused(ctx, 'a legacy network', api.createTrezorEoa({ thru: fakeThru(wire, 'legacy') as never, trezor: signerOf(ctx, legacyFake), path: v.signer_path, feePayer }), { code: 'unsupported_signing_scheme' });
  t.eq('the device was not used', 0, legacyFake.calls.length);
});

// ===================================================================
// bytes held in Buffers, snapshots, the account a body signer is for
// ===================================================================

/** What a call settled with: its value or its error, so that a failed call is a failed check and not a crashed case. */
const settled = <T>(promise: Promise<T>): Promise<T | { failed: unknown }> => promise.then((v) => v, (failed: unknown) => ({ failed }));

add('app', 'the app copies inputs held in a Buffer, whose slice is a view: what is sent is what the call was given', async (ctx) => {
  const { api, d, t } = ctx;
  const fake = fakeOf(ctx);
  const app = api.ThruApp.attach(fake as never, 7);
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const body = bufferOf(api, SYNTHETIC_BODY(key, 5000));
  const original = new Uint8Array(body);
  const hint = bufferOf(api, new Uint8Array(129).map((_, i) => (i === 0 ? 1 : i)));
  const originalHint = new Uint8Array(hint);
  const pending = settled(app.signTransaction(path, body, { tokenHint: hint }));
  body.fill(0xee);
  hint.fill(0xee);
  await pending;
  t.eq('the body signed', api.toHex(original), api.toHex((fake.lastMessage ?? new Uint8Array(0)) as Uint8Array));
  t.eq('the hint sent', api.toHex(originalHint), api.toHex((fake.of(2)[0]?.request.token_hint as Uint8Array | undefined) ?? new Uint8Array(0)));
  const message = bufferOf(api, utf8('copy me'));
  const pendingMessage = settled(app.signMessage(path, message));
  message.fill(0x7a);
  await pendingMessage;
  t.eq('the message signed', api.toHex(utf8('copy me')), api.toHex((fake.of(6)[0]?.request.message as Uint8Array | undefined) ?? new Uint8Array(0)));
  const feePayer = bufferOf(api, new Uint8Array(32).fill(0x33));
  const account = bufferOf(api, key.publicKey);
  const pendingEoa = settled(app.signEoaAuth(path, 'delete', 1, feePayer, account));
  feePayer.fill(1);
  account.fill(2);
  await pendingEoa;
  t.eq(
    'the keys of the authorization',
    [api.toHex(new Uint8Array(32).fill(0x33)), api.toHex(key.publicKey)],
    [
      api.toHex((fake.of(8)[0]?.request.fee_payer as Uint8Array | undefined) ?? new Uint8Array(0)),
      api.toHex((fake.of(8)[0]?.request.account as Uint8Array | undefined) ?? new Uint8Array(0)),
    ],
  );
});

add('signer', 'every signing call copies inputs held in a Buffer: the request, the check of the key and the verification use the bytes of the call', async (ctx) => {
  const { api, d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const key = keyAt(d, path);
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // A transaction with its hint and the key it must be signed with.
  const c = d.fixture.cases.find((x) => x.outcome === 'signed' && x.token_hint_hex !== undefined) as FixtureCase;
  const body = bufferOf(api, unhex(c.body_hex));
  const hint = bufferOf(api, unhex(c.token_hint_hex as string));
  const expected = bufferOf(api, keyAt(d, c.path).publicKey);
  const fakeTx = fakeOf(ctx);
  const pendingTx = settled(signerOf(ctx, fakeTx).signTransactionBody(c.path, body, { tokenHint: hint, expectedPublicKey: expected }));
  body.fill(0xee);
  hint.fill(0xee);
  expected.fill(0xee);
  const outTx = (await pendingTx) as { signature?: Uint8Array; failed?: unknown };
  t.ok('the transaction was signed', outTx.signature !== undefined, String(outTx.failed));
  t.eq('the transaction signed is the one passed', c.body_hex, api.toHex((fakeTx.lastMessage ?? new Uint8Array(0)) as Uint8Array));
  t.eq('the hint sent is the one passed', c.token_hint_hex, api.toHex((fakeTx.of(2)[0]?.request.token_hint as Uint8Array | undefined) ?? new Uint8Array(0)));
  t.eq('the signature is the fixture\'s', c.signature_hex, outTx.signature ? api.toHex(outTx.signature) : 'none');

  // A message.
  const message = bufferOf(api, utf8('hello, thru'));
  const expectedMessageKey = bufferOf(api, key.publicKey);
  const fakeMsg = fakeOf(ctx);
  const pendingMsg = settled(signerOf(ctx, fakeMsg).signMessage(path, message, { expectedPublicKey: expectedMessageKey }));
  message.fill(0x7a);
  expectedMessageKey.fill(0x7a);
  const outMsg = (await pendingMsg) as { signature?: Uint8Array; failed?: unknown };
  t.ok('the message was signed and verified', outMsg.signature !== undefined, String(outMsg.failed));
  t.eq('the message sent is the one passed', api.toHex(utf8('hello, thru')), api.toHex((fakeMsg.lastMessage ?? new Uint8Array(0)) as Uint8Array));

  // An authorization: the fee payer changes while the first request, the read of the key, waits.
  const feePayer = bufferOf(api, new Uint8Array(32).fill(0x33));
  const account = bufferOf(api, key.publicKey);
  const fakeEoa = fakeOf(ctx);
  let release!: () => void;
  fakeEoa.hold.set(0, new Promise<void>((resolve) => void (release = resolve)));
  const pendingEoa = settled(signerOf(ctx, fakeEoa).signEoaAuth(path, 'create', 1, feePayer, account));
  await wait(10);
  t.eq('the public-key request is waiting', 1, fakeEoa.of(0).length);
  feePayer.fill(0x44);
  account.fill(0x55);
  release();
  const outEoa = (await pendingEoa) as { signature?: Uint8Array; failed?: unknown };
  t.ok('the authorization was signed and verified for the arguments of the call', outEoa.signature !== undefined, String(outEoa.failed));
  t.eq('the fee payer sent is the one passed', api.toHex(new Uint8Array(32).fill(0x33)), api.toHex((fakeEoa.of(8)[0]?.request.fee_payer as Uint8Array | undefined) ?? new Uint8Array(0)));
  t.eq('the account sent is the one passed', api.toHex(key.publicKey), api.toHex((fakeEoa.of(8)[0]?.request.account as Uint8Array | undefined) ?? new Uint8Array(0)));

  // The key the caller expects of an address.
  const expectedKey = bufferOf(api, key.publicKey);
  const pendingKey = settled(signerOf(ctx, fakeOf(ctx)).getAddress(path, { expectedPublicKey: expectedKey }));
  expectedKey.fill(1);
  t.eq('the expected key was copied', key.address, ((await pendingKey) as { address?: string }).address);
});

add('adapter', 'a body signer is made for one key: a path that resolves to another key is found from the public-key answer, before the device is asked to sign', async (ctx) => {
  const { api, d, t } = ctx;
  const account1 = d.fixture.cases.find((x) => x.name === 'transfer_from_account_1') as FixtureCase;
  const keyA = keyAt(d, "m/44'/8478'/0'/0'");
  const keyB = keyAt(d, account1.path);
  t.ok('the two accounts differ', api.toHex(keyA.publicKey) !== api.toHex(keyB.publicKey));
  const body = unhex(account1.body_hex);
  // The signer is for key A, the path is account 1's, the transaction's fee payer is account 1's key.
  const fake = fakeOf(ctx);
  const bodySigner = api.trezorBodySigner(signerOf(ctx, fake), account1.path, keyA.publicKey);
  const error = await refused(ctx, 'a path that resolves to another key', bodySigner.signTransactionBody(body), { code: 'key_mismatch', cls: 'TrezorKeyMismatchError' });
  t.eq('it names both keys', [keyA.address, keyB.address], [(error as { expected: string }).expected, (error as { got: string }).got]);
  t.eq('only the silent read of the key was made: no SignTx', [0], fake.calls.map((x) => x.id));

  // The other entry points find it before the device signs as well.
  const thru = fakeThru(body);
  const buildOptions = { program: new Uint8Array(32).fill(1) } as never;
  const fakeBuild = fakeOf(ctx);
  await refused(ctx, 'buildAndSignWithTrezor', api.buildAndSignWithTrezor(thru as never, signerOf(ctx, fakeBuild), account1.path, keyA.publicKey, buildOptions), { code: 'invalid_request' });
  t.eq('buildAndSignWithTrezor: the device was not used', 0, fakeBuild.calls.length);
  const fakeSend = fakeOf(ctx);
  await refused(ctx, 'sendWithTrezor', api.sendWithTrezor(thru as never, signerOf(ctx, fakeSend), account1.path, keyA.publicKey, buildOptions), { code: 'invalid_request' });
  t.eq('sendWithTrezor: the device was not used', 0, fakeSend.calls.length);
  t.eq('sendWithTrezor: nothing was sent', 0, thru.sent.length);
  const eoaVector = d.eoa.find((x) => x.name === 'ledger_eoa_create_chain_1') as EoaVector;
  const trezorKey = { seed: unhex(eoaVector.signer_seed_hex), publicKey: unhex(eoaVector.signer_pubkey_hex) };
  const fakeEoa = new FakeApp(api, trezorKey);
  const payer = api.privateKeyBodySigner(keyA.seed, keyA.publicKey);
  await refused(
    ctx,
    'createTrezorEoa with a public key the path does not have',
    api.createTrezorEoa({ thru: fakeThru(new Uint8Array(120)) as never, trezor: signerOf(ctx, fakeEoa), path: eoaVector.signer_path, publicKey: keyB.publicKey, feePayer: payer }),
    { code: 'invalid_request' },
  );
  t.eq('createTrezorEoa: only the silent read of the key was made', [0], fakeEoa.calls.map((x) => x.id));
});

add('adapter', 'the options and arguments of an adapter call are read once, at the call: a hint changed while the review is shown changes neither', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.outcome === 'signed' && x.token_hint_hex !== undefined && x.path === "m/44'/8478'/0'/0'") as FixtureCase;
  const key = keyAt(d, c.path);
  const wantReview = JSON.stringify(api.transactionReview(unhex(c.body_hex), key.publicKey, c.path, unhex(c.token_hint_hex as string)));
  t.ok('the hinted review exists', wantReview !== 'null');
  const changes: [string, (o: { tokenHint?: Uint8Array }) => void][] = [
    ['removed', (o) => void delete o.tokenHint],
    ['overwritten in place', (o) => void o.tokenHint?.fill(0xee)],
    ['replaced by another array', (o) => void (o.tokenHint = new Uint8Array(129).fill(1))],
  ];
  for (const [what, change] of changes) {
    const fake = fakeOf(ctx);
    const options: { tokenHint?: Uint8Array; onReview: () => Promise<void> } = {
      tokenHint: bufferOf(api, unhex(c.token_hint_hex as string)),
      onReview: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        change(options);
      },
    };
    const result = (await settled(
      api.buildAndSignWithTrezor(fakeThru(unhex(c.body_hex)) as never, signerOf(ctx, fake), c.path, key.publicKey, { program: new Uint8Array(32).fill(1) } as never, options as never),
    )) as { review?: TrezorReview; signature?: Uint8Array; failed?: unknown };
    t.ok(`${what}: the transaction was signed`, result.signature !== undefined, String(result.failed));
    const sent = fake.of(2)[0]?.request.token_hint as Uint8Array | undefined;
    t.eq(`${what}: the hint sent is the hint of the call`, c.token_hint_hex, sent === undefined ? 'no hint' : api.toHex(sent));
    t.eq(`${what}: the review is the review of the hint of the call`, wantReview, JSON.stringify(result.review ?? null));
  }

  // A body signer keeps what it was made with.
  const fakeSigner = fakeOf(ctx);
  const signerOptions: { tokenHint?: Uint8Array } = { tokenHint: bufferOf(api, unhex(c.token_hint_hex as string)) };
  const bodySigner = api.trezorBodySigner(signerOf(ctx, fakeSigner), c.path, key.publicKey, signerOptions);
  delete signerOptions.tokenHint;
  await settled(bodySigner.signTransactionBody(unhex(c.body_hex)));
  const sentByBodySigner = fakeSigner.of(2)[0]?.request.token_hint as Uint8Array | undefined;
  t.eq('a body signer sends the hint it was made with', c.token_hint_hex, sentByBodySigner === undefined ? 'no hint' : api.toHex(sentByBodySigner));
});

add('adapter', 'the transaction to build is copied at the call: buffers changed while the builder works are not what it reads', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  const body = unhex(c.body_hex);
  const thru = fakeThru(body);
  const read: { program: string; data: string; account: string; payer: string; fee: string }[] = [];
  const hex = (bytes: unknown): string => api.toHex(bytes as Uint8Array);
  thru.transactions.build = async (o) => {
    // The SDK reads the options after it has fetched the header.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const options = o as { program: Uint8Array; instructionData: Uint8Array; accounts: { readWrite: Uint8Array[] }; feePayer: { publicKey: Uint8Array }; header: { fee: bigint } };
    read.push({
      program: hex(options.program),
      data: hex(options.instructionData),
      account: hex(options.accounts.readWrite[0]),
      payer: hex(options.feePayer.publicKey),
      fee: String(options.header.fee),
    });
    return { toWireForSigning: () => body.slice() };
  };
  const program = bufferOf(api, new Uint8Array(32).fill(1));
  const data = bufferOf(api, Uint8Array.of(1, 2, 3));
  const account = bufferOf(api, new Uint8Array(32).fill(4));
  const payer = bufferOf(api, key.publicKey);
  const header = { fee: 7n };
  const pending = settled(
    api.buildAndSignWithTrezor(thru as never, signerOf(ctx, fakeOf(ctx)), c.path, payer, { program, instructionData: data, accounts: { readWrite: [account] }, header } as never),
  );
  program.fill(0xee);
  data.fill(0xee);
  account.fill(0xee);
  payer.fill(0xee);
  header.fee = 99n;
  const result = (await pending) as { signature?: Uint8Array; failed?: unknown };
  t.ok('the transaction was signed', result.signature !== undefined, String(result.failed));
  t.eq(
    'the builder read the arguments of the call',
    [{ program: api.toHex(new Uint8Array(32).fill(1)), data: '010203', account: api.toHex(new Uint8Array(32).fill(4)), payer: api.toHex(key.publicKey), fee: '7' }],
    read,
  );
});

add('adapter', 'createTrezorEoa reads its arguments once, at the call: keys, header and options changed while the device reviews are not used', async (ctx) => {
  const { api, d, t } = ctx;
  const v = d.eoa.find((x) => x.name === 'ledger_eoa_create_chain_1') as EoaVector;
  const trezorKey = { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) };
  const payerKey = keyAt(d, "m/44'/8478'/1'/0'");
  const fake = new FakeApp(api, trezorKey);
  let release!: () => void;
  fake.hold.set(8, new Promise<void>((resolve) => void (release = resolve)));
  const wire = new Uint8Array(120).map((_, i) => (i * 5) & 0xff);
  wire.set(payerKey.publicKey, 48);
  const thru = fakeThru(wire);
  const local = api.privateKeyBodySigner(payerKey.seed, payerKey.publicKey);
  const payerPublic = bufferOf(api, payerKey.publicKey);
  const feePayer = { publicKey: payerPublic as Uint8Array, signTransactionBody: (b: Uint8Array, o?: { signal?: AbortSignal }) => local.signTransactionBody(b, o) };
  const account = bufferOf(api, trezorKey.publicKey);
  const header = { fee: 5n };
  const pending = settled(
    api.createTrezorEoa({ thru: thru as never, trezor: signerOf(ctx, fake), path: v.signer_path, feePayer, publicKey: account, chainId: 1, header }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  t.eq('the device is reviewing the authorization', 1, fake.of(8).length);
  payerPublic.fill(0xee);
  account.fill(0xee);
  header.fee = 99n;
  release();
  const result = (await pending) as { publicKey?: Uint8Array; failed?: unknown };
  t.ok('the account was created', result.publicKey !== undefined, String(result.failed));
  t.eq('the proof was asked for the account of the call', api.toHex(trezorKey.publicKey), api.toHex((thru.proofsAsked[0] as { address: Uint8Array } | undefined)?.address ?? new Uint8Array(0)));
  const built = thru.built[0] as { accounts: { readWrite: Uint8Array[] }; header: { fee: bigint }; feePayer: { publicKey: Uint8Array } } | undefined;
  t.eq('the new account is the account of the call', [api.toHex(trezorKey.publicKey)], (built?.accounts.readWrite ?? []).map((k) => api.toHex(k)));
  t.eq('the fee payer is the fee payer of the call', api.toHex(payerKey.publicKey), api.toHex(built?.feePayer.publicKey ?? new Uint8Array(0)));
  t.eq('the fee is the fee of the call', 5n, built?.header.fee);
});

add('preview', 'the chain id of an authorization is an integer from 1 to 65535, a kind is one the app knows, and keys are 32 bytes; anything else gets no review', async ({ api, t }) => {
  const account = new Uint8Array(32).fill(0x22);
  const payer = new Uint8Array(32).fill(0x33);
  const path0 = "m/44'/8478'/0'/0'";
  const review = (kind: unknown, chainId: unknown, feePayer: Uint8Array = payer, key: Uint8Array = account, signer: Uint8Array = account): unknown => {
    try {
      return api.eoaAuthReview(kind as never, chainId as never, feePayer, key, signer, path0);
    } catch (error) {
      return `threw ${String(error)}`;
    }
  };
  for (const chainId of [1, 2, 77, 255, 256, 32767, 65534, 65535]) t.ok(`chain id ${chainId}: a review`, review('create', chainId) !== null && typeof review('create', chainId) === 'object');
  for (const chainId of [0, -0, 65536, 65537, -1, 0.5, 1.5, 65535.5, NaN, Infinity, -Infinity, 2 ** 32, 2 ** 32 + 1, 1e21, '1', null, undefined, 1n]) {
    t.eq(`chain id ${String(chainId)}: no review`, null, review('create', chainId));
  }
  for (const kind of ['create', 'delete', 0, 1]) t.ok(`kind ${String(kind)}: a review`, review(kind, 1) !== null);
  for (const kind of ['update', '', 'Create', 2, -1, 0.5, NaN, null, undefined]) t.eq(`kind ${String(kind)}: no review`, null, review(kind, 1));
  t.eq('a fee payer of 31 bytes', null, review('create', 1, new Uint8Array(31)));
  t.eq('a fee payer of 33 bytes', null, review('create', 1, new Uint8Array(33)));
  t.eq('an account of 31 bytes', null, review('create', 1, payer, new Uint8Array(31), new Uint8Array(31)));
  t.eq('a signer of 31 bytes', null, review('create', 1, payer, account, new Uint8Array(31)));
  // The other reviews take no number from the caller, and refuse a key that is not 32 bytes the same way.
  const message = utf8('hello');
  t.eq('a message review for a signer of 31 bytes', null, (() => { try { return api.messageReview(message, new Uint8Array(31), path0); } catch (error) { return `threw ${String(error)}`; } })());
  t.eq('a transaction review for a signer of 31 bytes', null, (() => { try { return api.transactionReview(new Uint8Array(200), new Uint8Array(31), path0); } catch (error) { return `threw ${String(error)}`; } })());
});

add('errors', 'a key mismatch says another passphrase may have been typed on the Trezor when the session is a passphrase wallet\'s, and only then', async (ctx) => {
  const { api, d, t } = ctx;
  const path = "m/44'/8478'/0'/0'";
  const keyA = keyAt(d, path);
  const keyB = keyAt(d, "m/44'/8478'/1'/0'");
  const sentence = '; this key belongs to a passphrase wallet, so another passphrase may have been typed on the Trezor';
  const body = unhex((d.fixture.cases.find((c) => c.name === 'transfer_shared_corpus') as FixtureCase).body_hex);
  for (const passphrase of [false, true]) {
    const label = passphrase ? 'passphrase session' : 'standard session';
    const signerFor = (fake: FakeApp) =>
      new api.ThruTrezorSigner({
        app: api.ThruApp.attach(fake as never, 7),
        transactionSigningScheme: 'rfc8032' as never,
        passphraseOnDevice: passphrase,
        close: () => fake.close(),
      });
    t.eq(`${label}: the signer knows`, passphrase, signerFor(fakeOf(ctx)).passphraseOnDevice);
    const expectedText = (expected: string, got: string): string => `the Trezor's key is ${got}, expected ${expected}${passphrase ? sentence : ''}`;
    const mismatch = async (what: string, run: () => Promise<unknown>, expected: string, got: string): Promise<void> => {
      const error = await refused(ctx, `${label}: ${what}`, run(), { code: 'key_mismatch', cls: 'TrezorKeyMismatchError' });
      t.eq(`${label}: ${what}: the text`, expectedText(expected, got), (error as Error).message);
    };
    await mismatch('getAddress', () => signerFor(fakeOf(ctx)).getAddress(path, { expectedPublicKey: keyB.publicKey }), keyB.address, keyA.address);
    await mismatch('signMessage', () => signerFor(fakeOf(ctx)).signMessage(path, utf8('hi'), { expectedPublicKey: keyB.publicKey }), keyB.address, keyA.address);
    await mismatch('signTransactionBody with an expected key', () => signerFor(fakeOf(ctx)).signTransactionBody(path, body, { expectedPublicKey: keyB.publicKey }), keyB.address, keyA.address);
    // A device that has another key than the transaction's fee payer.
    await mismatch('a device that is not the fee payer', () => signerFor(new FakeApp(api, keyB)).signTransactionBody(path, body), keyA.address, keyB.address);
    // A body signer for another key.
    await mismatch('a body signer', () => api.trezorBodySigner(signerFor(fakeOf(ctx)), path, keyB.publicKey).signTransactionBody(body), keyB.address, keyA.address);
  }
  // The error alone: the sentence is added by the option, the text without it is the one it always was.
  const plain = new api.TrezorKeyMismatchError('taA', 'taB');
  t.eq('the error without the option', "the Trezor's key is taB, expected taA", plain.message);
  t.eq('the error with the option', `the Trezor's key is taB, expected taA${sentence}`, new api.TrezorKeyMismatchError('taA', 'taB', { passphraseWallet: true }).message);
});

// ===================================================================
// the package's own shape
// ===================================================================

add('package', 'the counter of the link has no setter in the public API, and the credential file is not in this entry', async ({ api, t }) => {
  const link = (api as unknown as { Link: { prototype: object } }).Link;
  t.eq('Link has no setSendCounterForTest', false, 'setSendCounterForTest' in link.prototype);
  t.eq('the library has no FileCredentialStore', false, 'FileCredentialStore' in api);
  t.eq('nor a CredentialFileError', false, 'CredentialFileError' in api);
  t.eq('the signer is here', 'function', typeof api.ThruTrezorSigner);
  t.eq('and the preview', 'function', typeof api.transactionReview);
});

// ===================================================================
// second review: keys of the SDK, the chain id, the key of a local signer, what a supplied app returns
// ===================================================================

add('adapter', 'SDK Pubkey objects in the builder options are copied at the call: bytes changed through toBytesUnsafe while the header is fetched are not what the builder reads', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  const body = unhex(c.body_hex);
  const thru = fakeThru(body);
  const read: { program: string; writable: string[]; readOnly: string[] }[] = [];
  const hexOf = (k: unknown): string => api.toHex(k instanceof Uint8Array ? k : (k as { toBytes(): Uint8Array }).toBytes());
  thru.transactions.build = async (o) => {
    // The SDK reads the options after it has fetched the header.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const options = o as { program: unknown; accounts: { readWrite: unknown[]; readOnly: unknown[] } };
    read.push({ program: hexOf(options.program), writable: options.accounts.readWrite.map(hexOf), readOnly: options.accounts.readOnly.map(hexOf) });
    return { toWireForSigning: () => body.slice() };
  };
  const program = Pubkey.from(new Uint8Array(32).fill(1));
  const writable = Pubkey.from(new Uint8Array(32).fill(4));
  const readOnly = Pubkey.from(new Uint8Array(32).fill(5));
  const pending = settled(
    api.buildAndSignWithTrezor(thru as never, signerOf(ctx, fakeOf(ctx)), c.path, key.publicKey, { program, accounts: { readWrite: [writable], readOnly: [readOnly] } } as never),
  );
  // The caller still holds the objects, and their bytes are reachable.
  for (const k of [program, writable, readOnly]) k.toBytesUnsafe().fill(0xee);
  const result = (await pending) as { signature?: Uint8Array; failed?: unknown };
  t.ok('the transaction was signed', result.signature !== undefined, String(result.failed));
  t.eq(
    'the builder read the keys of the call',
    [{ program: api.toHex(new Uint8Array(32).fill(1)), writable: [api.toHex(new Uint8Array(32).fill(4))], readOnly: [api.toHex(new Uint8Array(32).fill(5))] }],
    read,
  );
});

add('adapter', 'createTrezorEoa reads chainId at the call, before the address is fetched', async (ctx) => {
  const { api, d, t } = ctx;
  const v = d.eoa.find((x) => x.name === 'ledger_eoa_create_chain_1') as EoaVector;
  const trezorKey = { seed: unhex(v.signer_seed_hex), publicKey: unhex(v.signer_pubkey_hex) };
  const payerKey = keyAt(d, "m/44'/8478'/1'/0'");
  const fake = new FakeApp(api, trezorKey);
  let release!: () => void;
  fake.hold.set(0, new Promise<void>((resolve) => void (release = resolve)));
  const wire = new Uint8Array(120).map((_, i) => (i * 5) & 0xff);
  wire.set(payerKey.publicKey, 48);
  const thru = fakeThru(wire);
  const feePayer = api.privateKeyBodySigner(payerKey.seed, payerKey.publicKey);
  // No public key is given, so the address is fetched from the device first.
  const args = { thru: thru as never, trezor: signerOf(ctx, fake), path: v.signer_path, feePayer, chainId: 1 };
  const pending = settled(api.createTrezorEoa(args));
  await new Promise((resolve) => setTimeout(resolve, 10));
  t.eq('the address is being fetched', 1, fake.of(0).length);
  args.chainId = 7;
  release();
  const result = (await pending) as { authorization?: Uint8Array; failed?: unknown };
  t.ok('the account was created', result.authorization !== undefined, String(result.failed));
  t.eq('the authorization names the chain of the call', 1, fake.of(8)[0]?.request.chain_id);
  t.eq('so does the transaction', 1, (thru.built[0] as { header?: { chainId?: number } } | undefined)?.header?.chainId);
});

add('adapter', 'the public key of a local key signer is its own: changing the array it returned does not change the key it signs for', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  const signer = api.privateKeyBodySigner(key.seed, key.publicKey);
  signer.publicKey.fill(0);
  t.eq('the key is still the key', api.toHex(key.publicKey), api.toHex(signer.publicKey));
  t.ok('each read is a copy of its own', signer.publicKey !== signer.publicKey);
  t.eq('and it signs as before', c.body_hex + (c.signature_hex as string), api.toHex(await signer.signTransactionBody(unhex(c.body_hex))));
});

add('signer', 'keys and signatures that a supplied app returns are copied: an app that changes its arrays afterwards does not change what the signer returns', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  const body = unhex(c.body_hex);
  const message = utf8('a message to sign');
  const eoaVector = d.eoa.find((x) => x.name === 'ledger_eoa_create_chain_1') as EoaVector;

  // What an honest signer returns, from the same fake.
  const honest = signerOf(ctx, fakeOf(ctx));
  const wantTx = await honest.signTransactionBody(c.path, body);
  const wantMessage = await honest.signMessage(c.path, message);
  const eoaKey = { seed: unhex(eoaVector.signer_seed_hex), publicKey: unhex(eoaVector.signer_pubkey_hex) };
  const wantEoa = await signerOf(ctx, new FakeApp(api, eoaKey)).signEoaAuth(eoaVector.signer_path, 'create', eoaVector.chain_id, unhex(eoaVector.fee_payer_hex), eoaKey.publicKey);

  // An app that keeps what it returned and changes it once the call is over (and a key also while the signature is made).
  const hostile = (fake: FakeApp) => {
    const real = api.ThruApp.attach(fake as never, 7);
    const clobberLater = (...arrays: Uint8Array[]): void => void setTimeout(() => arrays.forEach((a) => a.fill(0xee)), 0);
    let lastKey: Uint8Array | undefined;
    return {
      getPublicKey: async (...args: Parameters<typeof real.getPublicKey>) => {
        const out = await real.getPublicKey(...args);
        lastKey = out.publicKey;
        clobberLater(out.publicKey);
        return out;
      },
      signTransaction: async (...args: Parameters<typeof real.signTransaction>) => {
        lastKey?.fill(0xee);
        const out = await real.signTransaction(...args);
        clobberLater(out);
        return out;
      },
      signMessage: async (...args: Parameters<typeof real.signMessage>) => {
        lastKey?.fill(0xee);
        const out = await real.signMessage(...args);
        clobberLater(out);
        return out;
      },
      signEoaAuth: async (...args: Parameters<typeof real.signEoaAuth>) => {
        lastKey?.fill(0xee);
        const out = await real.signEoaAuth(...args);
        clobberLater(out);
        return out;
      },
    };
  };
  const wait = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 10));
  const make = (fake: FakeApp) => new api.ThruTrezorSigner({ app: hostile(fake) as never, transactionSigningScheme: 'rfc8032' as never });

  const address = (await settled(make(fakeOf(ctx)).getAddress(c.path))) as { publicKey?: Uint8Array; failed?: unknown };
  await wait();
  t.eq('getAddress: the key', api.toHex(key.publicKey), api.toHex(address.publicKey ?? new Uint8Array(0)));

  const tx = (await settled(make(fakeOf(ctx)).signTransactionBody(c.path, body))) as { signature?: Uint8Array; signedTransaction?: Uint8Array; publicKey?: Uint8Array; failed?: unknown };
  await wait();
  t.ok('signTransactionBody: signed', tx.signature !== undefined, String(tx.failed));
  t.eq('signTransactionBody: the signature', api.toHex(wantTx.signature), api.toHex(tx.signature ?? new Uint8Array(0)));
  t.eq('signTransactionBody: the key', api.toHex(key.publicKey), api.toHex(tx.publicKey ?? new Uint8Array(0)));
  t.eq('signTransactionBody: the transaction', api.toHex(wantTx.signedTransaction), api.toHex(tx.signedTransaction ?? new Uint8Array(0)));

  const signedMessage = (await settled(make(fakeOf(ctx)).signMessage(c.path, message))) as { signature?: Uint8Array; publicKey?: Uint8Array; failed?: unknown };
  await wait();
  t.ok('signMessage: signed', signedMessage.signature !== undefined, String(signedMessage.failed));
  t.eq('signMessage: the signature', api.toHex(wantMessage.signature), api.toHex(signedMessage.signature ?? new Uint8Array(0)));
  t.eq('signMessage: the key', api.toHex(key.publicKey), api.toHex(signedMessage.publicKey ?? new Uint8Array(0)));

  const auth = (await settled(make(new FakeApp(api, eoaKey)).signEoaAuth(eoaVector.signer_path, 'create', eoaVector.chain_id, unhex(eoaVector.fee_payer_hex), eoaKey.publicKey))) as { signature?: Uint8Array; publicKey?: Uint8Array; failed?: unknown };
  await wait();
  t.ok('signEoaAuth: signed', auth.signature !== undefined, String(auth.failed));
  t.eq('signEoaAuth: the signature', api.toHex(wantEoa.signature), api.toHex(auth.signature ?? new Uint8Array(0)));
  t.eq('signEoaAuth: the key', api.toHex(eoaKey.publicKey), api.toHex(auth.publicKey ?? new Uint8Array(0)));
});

add('adapter', 'an object with toBytes() is a public key only: instruction data and hint components that are not bytes are not converted, and an account is copied', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  const body = unhex(c.body_hex);
  const holder = (bytes: Uint8Array): { toBytes(): Uint8Array } => ({ toBytes: () => bytes });

  // As instruction data the object reaches the builder as it is (the SDK's own check refuses it), not as the bytes it can produce.
  const thru = fakeThru(body);
  const data = holder(new Uint8Array([1, 2, 3]));
  await settled(
    api.buildAndSignWithTrezor(thru as never, signerOf(ctx, fakeOf(ctx)), c.path, key.publicKey, { program: new Uint8Array(32).fill(1), instructionData: data } as never),
  );
  const built = thru.built[0] as { instructionData?: unknown } | undefined;
  t.ok('the builder was called', built !== undefined);
  t.ok('the instruction data is the object, not bytes made of it', built?.instructionData === data);

  // As an account it is accepted and copied.
  const thruAccount = fakeThru(body);
  const accountBytes = new Uint8Array(32).fill(4);
  await settled(
    api.buildAndSignWithTrezor(thruAccount as never, signerOf(ctx, fakeOf(ctx)), c.path, key.publicKey, { program: new Uint8Array(32).fill(1), accounts: { readWrite: [holder(accountBytes)] } } as never),
  );
  const account = (thruAccount.built[0] as { accounts?: { readWrite?: unknown[] } } | undefined)?.accounts?.readWrite?.[0];
  t.ok('the account is bytes', account instanceof Uint8Array);
  t.eq('with the bytes of the object', api.toHex(accountBytes), account instanceof Uint8Array ? api.toHex(account) : 'none');
  t.ok('in memory of their own', account !== accountBytes);

  // As a hint component it is refused as it was before: the hint wants bytes.
  const tokenCase = d.fixture.cases.find((x) => x.outcome === 'signed' && x.token_hint_hex !== undefined) as FixtureCase;
  const hint = unhex(tokenCase.token_hint_hex as string);
  const part = (i: number): Uint8Array => hint.slice(1 + 32 * i, 33 + 32 * i);
  const tokenKey = keyAt(d, tokenCase.path);
  const buildWith = (tokenHint: unknown): Promise<unknown> =>
    api.buildAndSignWithTrezor(fakeThru(unhex(tokenCase.body_hex)) as never, signerOf(ctx, fakeOf(ctx)), tokenCase.path, tokenKey.publicKey, { program: new Uint8Array(32).fill(1) } as never, { tokenHint } as never);
  const plain = (await settled(buildWith({ mint: part(0), recipientOwner: part(1), recipientSeed: part(2), sourceSeed: part(3) }))) as { failed?: unknown };
  t.ok('a hint of bytes is accepted', plain.failed === undefined, String(plain.failed));
  for (const field of ['mint', 'recipientOwner', 'recipientSeed', 'sourceSeed'] as const) {
    const fields = { mint: part(0), recipientOwner: part(1), recipientSeed: part(2), sourceSeed: part(3) };
    fields[field] = holder(fields[field]) as never;
    await t.rejects(`a hint whose ${field} is an object with toBytes()`, buildWith(fields));
  }
});

add('adapter', 'a signature by another key than the one asked for says the outcome is unknown: the device has signed', async (ctx) => {
  const { api, d, t } = ctx;
  const c = d.fixture.cases.find((x) => x.name === 'transfer_shared_corpus') as FixtureCase;
  const key = keyAt(d, c.path);
  const other = new Uint8Array(32).fill(0x77);
  const trezor = {
    passphraseOnDevice: false,
    signTransactionBody: async () => ({ signature: new Uint8Array(64), signedTransaction: new Uint8Array(0), publicKey: other, bodyHash: '' }),
  };
  const fromBuild = await refused(
    ctx,
    'buildAndSignWithTrezor',
    api.buildAndSignWithTrezor(fakeThru(unhex(c.body_hex)) as never, trezor as never, c.path, key.publicKey, { program: new Uint8Array(32).fill(1) } as never),
    { code: 'key_mismatch' },
  );
  t.eq('buildAndSignWithTrezor: the outcome is unknown', true, (fromBuild as { outcomeUnknown: boolean }).outcomeUnknown);
  const fromSigner = await refused(ctx, 'trezorBodySigner', api.trezorBodySigner(trezor as never, c.path, key.publicKey).signTransactionBody(unhex(c.body_hex)), { code: 'key_mismatch' });
  t.eq('trezorBodySigner: the outcome is unknown', true, (fromSigner as { outcomeUnknown: boolean }).outcomeUnknown);
});

// ---- running ----

export function signerCases(): { group: string; name: string }[] {
  return cases.map(({ group, name }) => ({ group, name }));
}

/** Runs one case; a case that throws is a failed case, not a crashed run. */
export async function runSignerCase(api: Api, data: SigningData, index: number): Promise<CaseResult> {
  const { group, name, run } = cases[index];
  const { check, failures, count } = newCheck();
  try {
    await run({ api, d: data, t: check });
  } catch (error) {
    failures.push({
      label: `${name}: the case itself threw`,
      expected: 'no exception',
      actual: String((error as Error)?.stack ?? error),
    });
  }
  return { group, name, checks: count(), failures };
}

export async function runAllSignerCases(api: Api, data: SigningData): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) results.push(await runSignerCase(api, data, i));
  return results;
}
