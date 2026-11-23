/**
 * End-to-end through the real DMK (sessions, intent queue, open-app flow,
 * device actions) against a simulated Thru app on a mock transport:
 * chunk sequencing, the two-pass message flow, every status word → typed
 * error, host-side pre-checks, cancellation, and corpus signatures.
 */
import {
  DeviceActionStatus,
  type DeviceManagementKit,
  DeviceManagementKitBuilder,
} from '@ledgerhq/device-management-kit';
import {
  SignatureDomain,
  signWithDomain,
  TransactionSigningScheme,
  verifyWithDomain,
  type BuildTransactionOptions,
} from '@thru/sdk';
import { firstValueFrom, toArray } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BlindSigningDisabledError,
  CancelledError,
  DeviceBusyError,
  EoaAccountMismatchError,
  FeePayerMismatchError,
  InvalidRequestError,
  InvalidSignatureError,
  KeyMismatchError,
  LockedError,
  MalformedTransactionError,
  ThruLedgerError,
  UnsupportedAppVersionError,
  UnsupportedSigningSchemeError,
  UserRejectedError,
  WrongAppError,
} from '../errors';
import {
  buildAndSignWithLedger,
  connectLedger,
  createLedgerEoa,
  DefaultSignerThru,
  DEFAULT_BUSY_RETRY,
  isDeviceBusy,
  EOA_CREATE_RESOURCES,
  EOA_TRANSFER_RESOURCES,
  ledgerBodySigner,
  mergeHeader,
  privateKeyBodySigner,
  runDeviceAction,
  sendWithLedger,
  SignerThruBuilder,
  ThruLedgerSigner,
  type LedgerThruClient,
  type ThruDeviceActionReturn,
  type SignProgress,
} from '../index';
import {
  encodeTokenHint,
  fromHex,
  Ins,
  parseTransactionBody,
  serializeApdu,
  signMessageApdus,
  signTxnApdus,
  toHex,
  TOKEN_PROGRAM,
  tokenAccountAddress,
  type TokenHint,
} from '../protocol';
import { eoaVectors, messageVectors, swNumber, txnVectors } from './helpers/corpus';
import { EOA_PROGRAM, KEY0, PUBKEY0, PUBKEY1, SECRET1, buildBody, key } from './helpers/fixtures';
import { MOCK_TRANSPORT_ID, MockThruDevice, mockTransportFactory, type MockThruDeviceOptions } from './helpers/mock-device';
import { REVIEW_CASES, reviewCaseHint } from './helpers/device-review';
import { SW_TABLE } from './helpers/sw-table';

const PATH0 = "m/44'/8478'/0'/0'";
const PATH1 = "m/44'/8478'/1'/0'";
const txns = txnVectors();
const msgs = messageVectors();
const eoas = eoaVectors();

let open: DeviceManagementKit[] = [];

afterEach(() => {
  for (const dmk of open) dmk.close();
  open = [];
});

async function setup(
  options: MockThruDeviceOptions & {
    scheme?: TransactionSigningScheme;
    skipOpenApp?: boolean;
    busyRetry?: { budgetMs: number; initialDelayMs: number; maxDelayMs: number };
  } = {},
): Promise<{ device: MockThruDevice; signer: ThruLedgerSigner; dmk: DeviceManagementKit }> {
  const device = new MockThruDevice(options);
  const dmk = new DeviceManagementKitBuilder().addTransport(mockTransportFactory(device)).build();
  open.push(dmk);
  const sessionId = await connectLedger(dmk, { transport: MOCK_TRANSPORT_ID, timeoutMs: 2000 });
  const signer = new ThruLedgerSigner({
    dmk,
    sessionId,
    transactionSigningScheme: options.scheme ?? TransactionSigningScheme.Rfc8032,
    skipOpenApp: options.skipOpenApp,
    busyRetry: options.busyRetry,
  });
  return { device, signer, dmk };
}

const hexUp = (b: Uint8Array): string => toHex(b).toUpperCase();
const sentIns = (device: MockThruDevice, ins: number): string[] =>
  device.thruApdus().filter((a) => parseInt(a.slice(2, 4), 16) === ins);

describe('getAddress / getAppConfig', () => {
  it('reads the pubkey silently and with display', async () => {
    const { device, signer } = await setup();
    const silent = await signer.getAddress(PATH0);
    expect(toHex(silent.publicKey)).toBe(toHex(PUBKEY0));
    expect(silent.address).toBe(KEY0.address);
    const interactions: string[] = [];
    const shown = await signer.getAddress(PATH1, { display: true, onInteraction: (i) => interactions.push(i) });
    expect(toHex(shown.publicKey)).toBe(toHex(PUBKEY1));
    expect(interactions).toContain('verify-address');
    expect(sentIns(device, Ins.GET_PUBKEY)).toEqual([
      'E006000011048000002C8000211E8000000080000000',
      'E006010011048000002C8000211E8000000180000000',
    ]);
  });

  it('maps an address rejection to UserRejected', async () => {
    const { device, signer } = await setup();
    device.approve = () => false;
    await expect(signer.getAddress(PATH0, { display: true })).rejects.toBeInstanceOf(UserRejectedError);
  });

  it('accepts account 2^31-1 and depth 3', async () => {
    const { signer } = await setup();
    await expect(signer.getAddress("m/44'/8478'/2147483647'/0'")).resolves.toBeDefined();
    await expect(signer.getAddress("m/44'/8478'/0'")).resolves.toBeDefined();
  });

  it('returns the app config', async () => {
    const { signer } = await setup({ blindSigning: false, version: [1, 2, 3] });
    expect(await signer.getAppConfig()).toEqual({
      blindSigningEnabled: false,
      flags: 0,
      version: { major: 1, minor: 2, patch: 3 },
      apduProtocolVersion: 1,
    });
  });
});

describe('SIGN_TXN', () => {
  const minimal = txns.find((v) => v.name === 'ledger_txn_minimal')!;

  it('signs ledger_txn_minimal with the A.3 exchange and the corpus signature', async () => {
    const { device, signer } = await setup();
    const out = await signer.signTransactionBody(PATH0, fromHex(minimal.body_hex));
    expect(toHex(out.signature)).toBe(minimal.signature_hex);
    expect(toHex(out.signedTransaction)).toBe(minimal.wire_hex);
    expect(out.bodyHash).toBe(minimal.body_sha256_hex);
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([
      'E007008011048000002C8000211E8000000080000000',
      `E007010070${minimal.body_hex.toUpperCase()}`,
    ]);
    /* Host obligations before streaming: config, then the silent pubkey. */
    const order = device.thruApdus().map((a) => a.slice(0, 4));
    expect(order).toEqual(['E005', 'E006', 'E007', 'E007']);
    expect(device.sessionKind).toBe('idle');
  });

  it('reproduces every valid corpus signature through the DMK', async () => {
    const { signer } = await setup();
    for (const v of txns.filter((t) => t.category === 'valid')) {
      const out = await signer.signTransactionBody(v.signer_path, fromHex(v.body_hex));
      expect(toHex(out.signature), v.name).toBe(v.signature_hex);
      expect(toHex(out.signedTransaction), v.name).toBe(v.wire_hex);
    }
  });

  it('streams ledger_txn_max_mtu in 129 ordered chunks with progress', async () => {
    const v = txns.find((t) => t.name === 'ledger_txn_max_mtu')!;
    const body = fromHex(v.body_hex);
    const { device, signer } = await setup();
    const progress: SignProgress[] = [];
    const out = await signer.signTransactionBody(PATH0, body, { onProgress: (p) => progress.push(p) });
    expect(toHex(out.signature)).toBe(v.signature_hex);
    const chunks = sentIns(device, Ins.SIGN_TXN);
    expect(chunks).toEqual(signTxnApdus(PATH0, body).map((a) => hexUp(serializeApdu(a))));
    expect(chunks).toHaveLength(130);
    expect(progress).toHaveLength(129);
    expect(progress[128]).toMatchObject({ phase: 'txn', chunksSent: 129, chunksTotal: 129, bytesSent: body.length });
  });

  it('never interleaves other APDUs inside a stream, even while the user takes time', async () => {
    const { device, signer } = await setup();
    device.approve = () => new Promise((r) => setTimeout(() => r(true), 2500));
    const before = device.received.length;
    await signer.signTransactionBody(PATH0, fromHex(minimal.body_hex));
    const during = device.received.slice(before).map((a) => hexUp(a.subarray(0, 2)));
    const first = during.indexOf('E007');
    const last = during.lastIndexOf('E007');
    expect(during.slice(first, last + 1).every((x) => x === 'E007')).toBe(true);
  }, 15_000);

  it('rejects a fee-payer mismatch host-side, before streaming', async () => {
    const { device, signer } = await setup();
    const err = await signer.signTransactionBody(PATH1, buildBody()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeePayerMismatchError);
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it('rejects every corpus reject vector host-side with the device reason class', async () => {
    const { device, signer } = await setup();
    for (const v of txns.filter((t) => t.category !== 'valid')) {
      const body = fromHex(v.body_hex);
      if (body.length === 0 || body.length > 32704) continue; /* refused before any APDU */
      const err = (await signer.signTransactionBody(v.signer_path, body).catch((e: unknown) => e)) as ThruLedgerError;
      expect(err, v.name).toBeInstanceOf(ThruLedgerError);
      expect(err.code === 'FeePayerMismatch' ? 0x6810 : swForError(err), v.name).toBe(swNumber(v.sw));
    }
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it('refuses a blind-signed transaction early when blind signing is off', async () => {
    const { device, signer } = await setup({ blindSigning: false });
    await expect(signer.signTransactionBody(PATH0, buildBody())).rejects.toBeInstanceOf(BlindSigningDisabledError);
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it('signs every clear transfer with blind signing off, and refuses the blind cases', async () => {
    const { device, signer } = await setup({ blindSigning: false });
    for (const c of REVIEW_CASES) {
      const before = sentIns(device, Ins.SIGN_TXN).length;
      const pending = signer.signTransactionBody(PATH0, fromHex(c.body_hex), { tokenHint: reviewCaseHint(c) });
      if (c.clear) {
        await expect(pending, c.name).resolves.toBeDefined();
        expect(sentIns(device, Ins.SIGN_TXN).length, c.name).toBeGreaterThan(before);
      } else {
        await expect(pending, c.name).rejects.toBeInstanceOf(BlindSigningDisabledError);
        expect(sentIns(device, Ins.SIGN_TXN).length, c.name).toBe(before);
      }
    }
  });

  it('the device re-checks the setting at the last chunk', async () => {
    const { device, signer } = await setup();
    device.inject = (apdu) => {
      /* The setting is turned off on the device after the host read it. */
      if (apdu[1] === Ins.SIGN_TXN && apdu[2] === 0) device.blindSigning = false;
      return undefined;
    };
    await expect(signer.signTransactionBody(PATH0, buildBody())).rejects.toBeInstanceOf(BlindSigningDisabledError);
    expect(device.exchanges[device.exchanges.length - 1].sw).toBe(0x6808);
  });

  it('maps a device rejection to UserRejected and clears the session', async () => {
    const { device, signer } = await setup();
    device.approve = () => false;
    await expect(signer.signTransactionBody(PATH0, buildBody())).rejects.toBeInstanceOf(UserRejectedError);
    expect(device.sessionKind).toBe('idle');
  });

  it('refuses Legacy signing-scheme networks without contacting the device (D11)', async () => {
    const { device, signer } = await setup({ scheme: TransactionSigningScheme.Legacy });
    await expect(signer.signTransactionBody(PATH0, buildBody())).rejects.toBeInstanceOf(UnsupportedSigningSchemeError);
    await expect(signer.signMessage(PATH0, new Uint8Array([1]))).rejects.toBeInstanceOf(UnsupportedSigningSchemeError);
    await expect(signer.signEoaAuth(PATH0, 'create', 1, PUBKEY1, PUBKEY0)).rejects.toBeInstanceOf(
      UnsupportedSigningSchemeError,
    );
    expect(device.thruApdus()).toEqual([]);
  });

  it('cancels through an AbortSignal while waiting for the user', async () => {
    const { device, signer } = await setup();
    let release: (v: boolean) => void = () => undefined;
    device.approve = () => new Promise<boolean>((r) => (release = r));
    const controller = new AbortController();
    const pending = signer.signTransactionBody(PATH0, buildBody(), { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    release(false);
  });
});

describe('SIGN_TXN token hint (§7.2.1)', () => {
  const mint = new Uint8Array(32).fill(0x33);
  const recipientOwner = PUBKEY1;
  const hint: TokenHint = { mint, recipientOwner };

  /** A token Transfer from PUBKEY0's token account to recipientOwner's, both for `mint`. */
  function hintedBody(): Uint8Array {
    const source = tokenAccountAddress(PUBKEY0, mint);
    const recipient = tokenAccountAddress(recipientOwner, mint);
    const rw = [source, recipient].sort((a, b) => (toHex(a) < toHex(b) ? -1 : 1));
    const instr = new Uint8Array(13);
    const v = new DataView(instr.buffer);
    instr[0] = 2;
    v.setUint16(1, 2 + rw.indexOf(source), true);
    v.setUint16(3, 2 + rw.indexOf(recipient), true);
    v.setBigUint64(5, 1_000n, true);
    return buildBody({ program: TOKEN_PROGRAM, rw, instr });
  }

  it('sends the hint after the path; the signature is the same as without it', async () => {
    const { device, signer } = await setup();
    const body = hintedBody();
    const hinted = await signer.signTransactionBody(PATH0, body, { tokenHint: hint });
    const chunks = sentIns(device, Ins.SIGN_TXN);
    expect(chunks).toEqual(signTxnApdus(PATH0, body, undefined, hint).map((a) => hexUp(serializeApdu(a))));
    expect(chunks[0]).toBe(`E007008092048000002C8000211E8000000080000000${hexUp(encodeTokenHint(hint))}`);
    const plain = await signer.signTransactionBody(PATH0, body);
    expect(toHex(hinted.signature)).toBe(toHex(plain.signature));
    expect(toHex(hinted.signedTransaction)).toBe(toHex(plain.signedTransaction));
  });

  it('refuses a hint that does not prove the accounts before contacting the device', async () => {
    const { device, signer } = await setup();
    for (const [body, tokenHint] of [
      [hintedBody(), { ...hint, mint: new Uint8Array(32).fill(0x44) }],
      [hintedBody(), { ...hint, recipientOwner: PUBKEY0 }],
      [buildBody(), hint],
    ] as const) {
      const err = await signer.signTransactionBody(PATH0, body, { tokenHint }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidRequestError);
      expect((err as InvalidRequestError).reason).toBe('token_hint');
    }
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it("maps the device's own mismatch verdict", async () => {
    const { device, signer } = await setup();
    device.inject = (apdu) => (apdu[1] === Ins.SIGN_TXN && apdu[2] === 1 ? 0x6814 : undefined);
    const err = await signer.signTransactionBody(PATH0, hintedBody(), { tokenHint: hint }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect((err as InvalidRequestError).statusWord).toBe(0x6814);
    expect(device.sessionKind).toBe('idle');
  });

  it('the mock device applies the §7.3 and §7.6 hint rules', async () => {
    const device = new MockThruDevice();
    const [chunk0, ...data] = signTxnApdus(PATH0, hintedBody(), undefined, hint).map(serializeApdu);
    const withChunk0 = (bytes: Uint8Array): Uint8Array =>
      new Uint8Array([...chunk0.subarray(0, 4), bytes.length, ...bytes]);
    const path = chunk0.subarray(5, 5 + 17);
    const wrongKind = encodeTokenHint(hint);
    wrongKind[0] = 0x02;
    expect((await device.exchange(withChunk0(new Uint8Array([...path, ...wrongKind])))).sw).toBe(0x6813);
    expect((await device.exchange(withChunk0(new Uint8Array([...path, ...wrongKind.subarray(1)])))).sw).toBe(
      0x6700,
    );
    const wrongMint = encodeTokenHint({ ...hint, mint: new Uint8Array(32).fill(0x44) });
    expect((await device.exchange(withChunk0(new Uint8Array([...path, ...wrongMint])))).sw).toBe(0x9000);
    const last = data[data.length - 1];
    for (const apdu of data.slice(0, -1)) expect((await device.exchange(apdu)).sw).toBe(0x9000);
    expect((await device.exchange(last)).sw).toBe(0x6814);
    expect(device.sessionKind).toBe('idle');
  });

  it('the mock device requires a TransferChecked to name the hint mint', async () => {
    /* Both token accounts are for `mint`, so the hint proves them; only the
       mint the transaction names differs. */
    const checkedBody = (bodyMint: Uint8Array): Uint8Array => {
      const plain = hintedBody();
      const at = 112 + 64;
      const instr = new Uint8Array(25);
      const v = new DataView(instr.buffer);
      instr[0] = 8;
      instr.set(plain.subarray(at + 1, at + 5), 1);
      v.setUint16(5, 4, true);
      v.setBigUint64(7, 1_000n, true);
      instr.set([6, 4, 0x55, 0x53, 0x44, 0x43], 15);
      return buildBody({ program: TOKEN_PROGRAM, rw: [plain.subarray(112, 144), plain.subarray(144, 176)], ro: [bodyMint], instr });
    };
    for (const [bodyMint, sw] of [
      [mint, 0x9000],
      [new Uint8Array(32).fill(0x44), 0x6814],
    ] as const) {
      const device = new MockThruDevice();
      device.blindSigning = false;
      let last = 0;
      for (const apdu of signTxnApdus(PATH0, checkedBody(bodyMint), undefined, hint).map(serializeApdu)) {
        last = (await device.exchange(apdu)).sw;
      }
      expect(last).toBe(sw);
    }
  });
});

/** Inverse of statusWordToError for MalformedTransaction reasons. */
function swForError(err: ThruLedgerError): number | undefined {
  const reasons: Record<string, number> = {
    invalid_format: 0x6801,
    invalid_version: 0x6802,
    invalid_flags: 0x6803,
    chain_id_zero: 0x6804,
    invalid_fee_payer_state_proof_type: 0x6805,
    account_count_limit_exceeded: 0x6806,
    duplicate_account: 0x6807,
    unsorted_readwrite_accounts: 0x6809,
    unsorted_readonly_accounts: 0x680a,
    pad_nonzero: 0x6811,
    rw_cache_exceeded: 0x6812,
  };
  return err instanceof MalformedTransactionError ? reasons[err.reason] : undefined;
}

describe('every status word through the DMK maps to its typed error', () => {
  it.each(SW_TABLE.map(([sw, cls]) => [sw.toString(16), sw, cls] as const))('0x%s', async (_h, sw, cls) => {
    /* No 0x6901 retry here: the injected status word repeats on every attempt. */
    const { device, signer } = await setup({ busyRetry: { budgetMs: 0, initialDelayMs: 0, maxDelayMs: 0 } });
    /* Fail the last SIGN_TXN chunk: exercises the whole stream first. */
    device.inject = (apdu) => (apdu[0] === 0xe0 && apdu[1] === Ins.SIGN_TXN && apdu[2] === 1 ? sw : undefined);
    const err = await signer.signTransactionBody(PATH0, buildBody()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(cls);
    expect((err as ThruLedgerError).statusWord).toBe(sw);
  });

  it('maps a locked device to Locked', async () => {
    const { device, signer } = await setup({ skipOpenApp: true });
    device.locked = true;
    await expect(signer.getAppConfig()).rejects.toBeInstanceOf(LockedError);
  });

  it('maps another open app to WrongApp', async () => {
    const { device, signer } = await setup({ skipOpenApp: true });
    device.appName = 'Bitcoin';
    const err = (await signer.getAddress(PATH0).catch((e: unknown) => e)) as WrongAppError;
    expect(err).toBeInstanceOf(WrongAppError);
    expect(err.reason).toBe('other_app');
    expect(err.openApp).toBe('Bitcoin');
    device.appName = 'BOLOS';
    const dash = (await signer.getAddress(PATH0).catch((e: unknown) => e)) as WrongAppError;
    expect(dash.reason).toBe('not_open');
  });

  it('refuses an unknown APDU protocol version', async () => {
    const { signer } = await setup({ apduProtocolVersion: 2 });
    await expect(signer.signTransactionBody(PATH0, buildBody())).rejects.toBeInstanceOf(UnsupportedAppVersionError);
  });

  it('refuses an unknown APDU protocol version on getAddress too (§6.3)', async () => {
    const { signer } = await setup({ apduProtocolVersion: 2 });
    await expect(signer.getAddress(PATH0, { display: true })).rejects.toBeInstanceOf(UnsupportedAppVersionError);
  });

  it('maps a SIGN_EOA_AUTH 0x6804 to InvalidRequest', async () => {
    const { device, signer } = await setup();
    device.inject = (apdu) => (apdu[1] === Ins.SIGN_EOA_AUTH ? 0x6804 : undefined);
    const err = (await signer.signEoaAuth(PATH0, 'create', 1, PUBKEY1, PUBKEY0).catch((e: unknown) => e)) as ThruLedgerError;
    expect(err.code).toBe('InvalidRequest');
  });
});

describe('0x6901 (SDK status page) retry', () => {
  const fast = { budgetMs: 2000, initialDelayMs: 5, maxDelayMs: 20 };

  it('defaults to a bounded ~5 s budget', () => {
    expect(DEFAULT_BUSY_RETRY.budgetMs).toBe(5000);
    expect(DEFAULT_BUSY_RETRY.maxDelayMs).toBeLessThanOrEqual(1000);
  });

  it('retries a signing operation that starts while the status page is up', async () => {
    const { device, signer } = await setup({ skipOpenApp: true, busyRetry: fast });
    const body = buildBody();
    device.busyApdus = 3;
    const out = await signer.signTransactionBody(PATH0, body);
    expect(out.signature).toHaveLength(64);
    expect(device.busyAnswered).toBe(3);
    /* Exactly one full SIGN_TXN stream reached the app. */
    const chunk0 = sentIns(device, Ins.SIGN_TXN).filter((a) => a.slice(4, 6) === '00');
    expect(chunk0).toHaveLength(1);
  });

  it('retries through the DMK open-app flow too', async () => {
    const { device, signer } = await setup({ busyRetry: fast });
    device.busyApdus = 2;
    const cfg = await signer.getAppConfig();
    expect(cfg.apduProtocolVersion).toBe(1);
    expect(device.busyAnswered).toBe(2);
  });

  it('gives up with DeviceBusyError after the budget', async () => {
    const { device, signer } = await setup({
      skipOpenApp: true,
      busyRetry: { budgetMs: 60, initialDelayMs: 5, maxDelayMs: 10 },
    });
    device.busyApdus = 1_000_000;
    const started = Date.now();
    const err = (await signer.getAppConfig().catch((e: unknown) => e)) as ThruLedgerError;
    expect(err).toBeInstanceOf(DeviceBusyError);
    expect(err.statusWord).toBe(0x6901);
    expect(isDeviceBusy(err)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(device.busyAnswered).toBeGreaterThan(1);
  });

  it('a busy retry signs the message of the original call', async () => {
    const hello = msgs.find((v) => v.name === 'ledger_msg_hello')!;
    const { device, signer } = await setup({ skipOpenApp: true, busyRetry: fast });
    const message = fromHex(hello.message_hex);
    device.busyApdus = 1;
    const pending = signer.signMessage(PATH0, message);
    /* The caller reuses its buffer while the status page is up. */
    message.fill(0x7a);
    const out = await pending;
    expect(device.busyAnswered).toBe(1);
    expect(toHex(out.signature)).toBe(hello.signature_hex);
  });

  it('a busy retry signs the EOA authorization inputs of the original call', async () => {
    const v = eoas.find((e) => e.name === 'ledger_eoa_create_chain_1')!;
    const { device, signer } = await setup({ skipOpenApp: true, busyRetry: fast });
    const feePayer = fromHex(v.fee_payer_hex);
    device.busyApdus = 1;
    const pending = signer.signEoaAuth(PATH0, 'create', 1, feePayer, fromHex(v.account_hex));
    feePayer.fill(0x55);
    const out = await pending;
    expect(device.busyAnswered).toBe(1);
    expect(toHex(out.signature)).toBe(v.signature_hex);
  });

  it('does not retry other status words', async () => {
    const { device, signer } = await setup({ skipOpenApp: true, busyRetry: fast });
    device.approve = () => false;
    await expect(signer.signTransactionBody(PATH0, buildBody())).rejects.toBeInstanceOf(UserRejectedError);
    expect(sentIns(device, Ins.SIGN_TXN).filter((a) => a.slice(4, 6) === '00')).toHaveLength(1);
  });
});

describe('SIGN_MESSAGE (two passes)', () => {
  const hello = msgs.find((v) => v.name === 'ledger_msg_hello')!;

  it('runs the A.5 exchange and returns the corpus signature', async () => {
    const { device, signer } = await setup();
    let approvedAfter = -1;
    device.approve = () => {
      approvedAfter = sentIns(device, Ins.SIGN_MESSAGE).length;
      return true;
    };
    const out = await signer.signMessage(PATH0, fromHex(hello.message_hex));
    expect(toHex(out.signature)).toBe(hello.signature_hex);
    expect(sentIns(device, Ins.SIGN_MESSAGE)).toEqual([
      'E008008015048000002C8000211E800000008000000000000005',
      'E00801000568656C6C6F',
      'E00801000568656C6C6F',
    ]);
    /* Approval happens while processing the last pass-1 chunk (index 1). */
    expect(approvedAfter).toBe(1);
  });

  it('restarts P1 at 1 for pass 2 and reports progress', async () => {
    const msg = new Uint8Array(600).fill(0x61);
    const { device, signer } = await setup();
    const progress: SignProgress[] = [];
    await signer.signMessage(PATH0, msg, { onProgress: (p) => progress.push(p) });
    const plan = signMessageApdus(PATH0, msg);
    expect(sentIns(device, Ins.SIGN_MESSAGE)).toEqual(
      [plan.header, ...plan.pass1, ...plan.pass2].map((a) => hexUp(serializeApdu(a))),
    );
    expect(progress.map((p) => [p.phase, p.chunksSent])).toEqual([
      ['pass1', 1],
      ['pass1', 2],
      ['pass1', 3],
      ['pass2', 4],
      ['pass2', 5],
      ['pass2', 6],
    ]);
  });

  it('reproduces every valid corpus message signature', async () => {
    const { signer } = await setup();
    for (const v of msgs.filter((m) => m.category === 'valid')) {
      const out = await signer.signMessage(v.signer_path, fromHex(v.message_hex));
      expect(toHex(out.signature), v.name).toBe(v.signature_hex);
    }
  });

  it('needs blind signing only in hash mode', async () => {
    const { device, signer } = await setup({ blindSigning: false });
    await expect(signer.signMessage(PATH0, new TextEncoder().encode('plain text'))).resolves.toBeDefined();
    await expect(signer.signMessage(PATH0, new Uint8Array([0, 1, 2]))).rejects.toBeInstanceOf(BlindSigningDisabledError);
    expect(sentIns(device, Ins.SIGN_MESSAGE).length).toBe(3);
  });

  it('rejects the corpus length rejects host-side', async () => {
    const { device, signer } = await setup();
    for (const v of msgs.filter((m) => m.category !== 'valid')) {
      const err = (await signer.signMessage(PATH0, fromHex(v.message_hex)).catch((e: unknown) => e)) as ThruLedgerError;
      expect(err.code, v.name).toBe('InvalidRequest');
    }
    expect(sentIns(device, Ins.SIGN_MESSAGE)).toEqual([]);
  });

  it('binds the signature to a matching expectedPublicKey', async () => {
    const { device, signer } = await setup();
    const out = await signer.signMessage(PATH0, fromHex(hello.message_hex), { expectedPublicKey: PUBKEY0 });
    expect(toHex(out.signature)).toBe(hello.signature_hex);
    expect(sentIns(device, Ins.SIGN_MESSAGE)).toHaveLength(3);
  });

  it('refuses a different device key before any SIGN_MESSAGE APDU', async () => {
    const { device, signer } = await setup();
    await expect(
      signer.signMessage(PATH0, fromHex(hello.message_hex), { expectedPublicKey: PUBKEY1 }),
    ).rejects.toBeInstanceOf(KeyMismatchError);
    await expect(
      signer.signMessage(PATH0, fromHex(hello.message_hex), { expectedPublicKey: PUBKEY0.subarray(0, 31) }),
    ).rejects.toBeInstanceOf(KeyMismatchError);
    expect(sentIns(device, Ins.SIGN_MESSAGE)).toEqual([]);
  });

  it('a busy retry compares against the expectedPublicKey of the original call', async () => {
    const { device, signer } = await setup({ skipOpenApp: true, busyRetry: { budgetMs: 2000, initialDelayMs: 5, maxDelayMs: 20 } });
    const expected = new Uint8Array(PUBKEY0);
    device.busyApdus = 1;
    const pending = signer.signMessage(PATH0, fromHex(hello.message_hex), { expectedPublicKey: expected });
    expected.fill(0x33);
    const out = await pending;
    expect(device.busyAnswered).toBe(1);
    expect(toHex(out.signature)).toBe(hello.signature_hex);
  });

  it('maps a pass-1 rejection to UserRejected', async () => {
    const { device, signer } = await setup();
    device.approve = () => false;
    await expect(signer.signMessage(PATH0, new TextEncoder().encode('no'))).rejects.toBeInstanceOf(UserRejectedError);
  });
});

describe('lower-level API snapshots caller bytes when the action is created', () => {
  /* DMK starts the task after the open-app flow, so a mutation made right
     after the call returns happens before the task body runs. */
  async function lowerLevel(): Promise<{ device: MockThruDevice; low: DefaultSignerThru }> {
    const { device, dmk } = await setup();
    const sessionId = await connectLedger(dmk, { transport: MOCK_TRANSPORT_ID, timeoutMs: 2000 });
    const low = new DefaultSignerThru({ dmk, sessionId, transactionSigningScheme: TransactionSigningScheme.Rfc8032 });
    return { device, low };
  }

  it('signMessage signs the message as it was at the call', async () => {
    const hello = msgs.find((v) => v.name === 'ledger_msg_hello')!;
    const { low } = await lowerLevel();
    const message = fromHex(hello.message_hex);
    const action = low.signMessage(PATH0, message);
    message.fill(0x7a);
    const out = await runDeviceAction(action);
    expect(toHex(out.signature)).toBe(hello.signature_hex);
  });

  it('signMessage compares the expectedPublicKey as it was at the call', async () => {
    const hello = msgs.find((v) => v.name === 'ledger_msg_hello')!;
    const { low } = await lowerLevel();
    const expected = new Uint8Array(PUBKEY0);
    const action = low.signMessage(PATH0, fromHex(hello.message_hex), { expectedPublicKey: expected });
    expected.fill(0x33);
    const out = await runDeviceAction(action);
    expect(toHex(out.signature)).toBe(hello.signature_hex);
  });

  it('signTransaction signs the body as it was at the call', async () => {
    const { low } = await lowerLevel();
    const body = buildBody();
    const original = new Uint8Array(body);
    const action = low.signTransaction(PATH0, body);
    body.fill(0x11);
    const out = await runDeviceAction(action);
    expect(toHex(out.signedTransaction.subarray(0, original.length))).toBe(toHex(original));
  });

  it('signEoaAuth signs the inputs as they were at the call', async () => {
    const v = eoas.find((e) => e.name === 'ledger_eoa_create_chain_1')!;
    const { low } = await lowerLevel();
    const feePayer = fromHex(v.fee_payer_hex);
    const account = fromHex(v.account_hex);
    const action = low.signEoaAuth(PATH0, 'create', 1, feePayer, account);
    feePayer.fill(0x55);
    account.fill(0x66);
    const out = await runDeviceAction(action);
    expect(toHex(out.signature)).toBe(v.signature_hex);
  });
});

describe('SIGN_EOA_AUTH', () => {
  it('runs the A.6 exchange and returns the corpus signature', async () => {
    const v = eoas.find((e) => e.name === 'ledger_eoa_create_chain_1')!;
    const { device, signer } = await setup();
    const out = await signer.signEoaAuth(PATH0, 'create', 1, fromHex(v.fee_payer_hex), fromHex(v.account_hex));
    expect(toHex(out.signature)).toBe(v.signature_hex);
    expect(sentIns(device, Ins.SIGN_EOA_AUTH)).toEqual([
      'E009000054048000002C8000211E800000008000000000' + '0100' + v.fee_payer_hex.toUpperCase() + v.account_hex.toUpperCase(),
    ]);
  });

  it('reproduces every valid corpus EOA signature; refuses device_reject entries', async () => {
    const { signer } = await setup();
    for (const v of eoas) {
      const p = signer.signEoaAuth(v.signer_path, v.kind, v.chain_id, fromHex(v.fee_payer_hex), fromHex(v.account_hex));
      if (v.category === 'valid') {
        expect(toHex((await p).signature), v.name).toBe(v.signature_hex);
      } else {
        const err = (await p.catch((e: unknown) => e)) as ThruLedgerError;
        expect(err, v.name).toBeInstanceOf(ThruLedgerError);
        expect(err.code, v.name).toBe(v.reject_reason === 'account_mismatch' ? 'EoaAccountMismatch' : 'InvalidRequest');
      }
    }
  });

  it('refuses a foreign account host-side', async () => {
    const { device, signer } = await setup();
    await expect(signer.signEoaAuth(PATH0, 'delete', 1, PUBKEY1, PUBKEY1)).rejects.toBeInstanceOf(EoaAccountMismatchError);
    expect(sentIns(device, Ins.SIGN_EOA_AUTH)).toEqual([]);
  });
});

describe('verify before use (§11.2, critic gap U4/T8)', () => {
  const flip = (sig: Uint8Array): Uint8Array => {
    const out = new Uint8Array(sig);
    out[0] ^= 0x01;
    return out;
  };

  it('a corrupted transaction signature is never attached', async () => {
    const { device, signer } = await setup();
    device.tamperSignature = (sig) => flip(sig);
    await expect(signer.signTransactionBody(PATH0, buildBody())).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it('a transaction signature by another key is refused, even if well formed', async () => {
    const { device, signer } = await setup();
    const body = buildBody();
    const other = await signWithDomain(body, SECRET1, PUBKEY1, SignatureDomain.TXN);
    device.tamperSignature = () => other;
    await expect(signer.signTransactionBody(PATH0, body)).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it('the adapter refuses a body whose fee payer is not the Ledger key before streaming', async () => {
    const { device, signer } = await setup();
    /* buildBody() pays with PUBKEY0; PATH1 derives PUBKEY1. */
    await expect(signer.signTransactionBody(PATH1, buildBody())).rejects.toBeInstanceOf(FeePayerMismatchError);
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it('corrupted message and EOA authorization signatures are refused', async () => {
    const { device, signer } = await setup();
    device.tamperSignature = (sig) => flip(sig);
    await expect(signer.signMessage(PATH0, new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );
    await expect(signer.signEoaAuth(PATH0, 'create', 1, PUBKEY1, PUBKEY0)).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );
  });
});

describe('SDK adapter', () => {
  function fakeThru(scheme: TransactionSigningScheme = TransactionSigningScheme.Rfc8032) {
    const sent: Uint8Array[] = [];
    const built: BuildTransactionOptions[] = [];
    const thru: LedgerThruClient = {
      ctx: { transactionSigningScheme: scheme },
      transactions: {
        build: async (o) => {
          built.push(o);
          const feePayer = o.feePayer.publicKey as Uint8Array;
          const rw = (o.accounts?.readWrite ?? []) as Uint8Array[];
          const instr = o.instructionData as Uint8Array | undefined;
          const program = o.program as Uint8Array;
          const h = o.header ?? {};
          return {
            toWireForSigning: () =>
              buildBody({
                feePayer,
                rw,
                instr,
                program,
                cu: h.computeUnits ?? 0,
                su: h.stateUnits ?? 0,
                mu: h.memoryUnits ?? 0,
                fee: h.fee ?? 1n,
                expiryAfter: h.expiryAfter ?? 100,
                chainId: h.chainId ?? 1,
              }),
          };
        },
        send: async (wire) => {
          sent.push(wire);
          return 'ts-fake-signature';
        },
      },
      chain: { getChainId: async () => 1 },
      proofs: { generate: async () => ({ proof: new Uint8Array(40) }) },
    };
    return { thru, sent, built };
  }

  it('sendWithLedger: build → device → verify-and-attach → send', async () => {
    const { signer } = await setup();
    const { thru, sent, built } = fakeThru();
    const reviews: string[] = [];
    const sig = await sendWithLedger(thru, signer, PATH0, PUBKEY0, { program: EOA_PROGRAM, accounts: { readWrite: [key(3)] } }, {
      onReview: (r) => reviews.push(r.transactionHash),
    });
    expect(sig).toBe('ts-fake-signature');
    expect(toHex(built[0].feePayer.publicKey as Uint8Array)).toBe(toHex(PUBKEY0));
    const wire = sent[0];
    const body = wire.subarray(0, wire.length - 64);
    expect(await verifyWithDomain(wire.subarray(wire.length - 64), body, PUBKEY0, SignatureDomain.TXN)).toBe(true);
    expect(reviews).toHaveLength(1);
  });

  it('awaits an async onReview before streaming to the device (A-043)', async () => {
    const { device, signer } = await setup();
    const { thru } = fakeThru();
    let release: () => void = () => undefined;
    let reviewed = false;
    const pending = buildAndSignWithLedger(thru, signer, PATH0, PUBKEY0, { program: EOA_PROGRAM }, {
      onReview: () =>
        new Promise<void>((resolve) => {
          reviewed = true;
          release = resolve;
        }),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(reviewed).toBe(true);
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
    release();
    const out = await pending;
    expect(out.signature).toHaveLength(64);
    expect(sentIns(device, Ins.SIGN_TXN).length).toBeGreaterThan(0);
  });

  it('signs the reviewed snapshot even when the builder reuses its serialized buffer during async review', async () => {
    const { signer } = await setup();
    const { thru } = fakeThru();
    const originalBuild = thru.transactions.build;
    let builderBytes: Uint8Array | undefined;
    const client: LedgerThruClient = {
      ...thru,
      transactions: {
        ...thru.transactions,
        build: async (options) => {
          const tx = await originalBuild(options);
          builderBytes = tx.toWireForSigning();
          return { toWireForSigning: () => builderBytes! };
        },
      },
    };
    // The package targets ES2020, where Promise.withResolvers is unavailable.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let notifyReview!: (hash: string) => void;
    const entered = new Promise<string>((resolve) => { notifyReview = resolve; });
    const pending = buildAndSignWithLedger(client, signer, PATH0, PUBKEY0, { program: EOA_PROGRAM }, {
      onReview: (review) => {
        notifyReview(review.transactionHash);
        return gate;
      },
    });
    const reviewed = await entered;
    const intended = builderBytes!.slice();
    builderBytes!.fill(0);
    release();
    const result = await pending;
    const signedBody = result.signedTransaction.subarray(0, -64);
    expect(toHex(signedBody)).toBe(toHex(intended));
    expect(result.review.transactionHash).toBe(reviewed);
    expect(await verifyWithDomain(result.signature, intended, PUBKEY0, SignatureDomain.TXN)).toBe(true);
  });

  it('rejects a fee-payer signer that changes the body or returns an invalid signature without sending', async () => {
    const { signer } = await setup();
    const { thru, sent } = fakeThru();
    const local = privateKeyBodySigner(SECRET1, PUBKEY1);
    for (const invalid of ['body', 'signature', 'mutated-input'] as const) {
      const feePayer = {
        publicKey: PUBKEY1,
        signTransactionBody: async (body: Uint8Array) => {
          if (invalid === 'mutated-input') body[0] ^= 1;
          const wire = await local.signTransactionBody(body);
          if (invalid !== 'mutated-input') wire[invalid === 'body' ? 0 : wire.length - 1] ^= 1;
          return wire;
        },
      };
      await expect(createLedgerEoa({ thru, ledger: signer, path: PATH0, feePayer })).rejects.toThrow();
      expect(sent).toHaveLength(0);
    }
  });

  it('a rejected onReview aborts with CancelledError and never contacts the device', async () => {
    const { device, signer } = await setup();
    const { thru, sent } = fakeThru();
    const err = await sendWithLedger(thru, signer, PATH0, PUBKEY0, { program: EOA_PROGRAM }, {
      onReview: async () => {
        throw new Error('user declined the preview');
      },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancelledError);
    expect(device.thruApdus()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('EOA-program sends default to the canonical transfer budget; overrides win', async () => {
    const { signer } = await setup();
    const { thru, sent, built } = fakeThru();
    await sendWithLedger(thru, signer, PATH0, PUBKEY0, { program: EOA_PROGRAM, accounts: { readWrite: [key(3)] } });
    expect(built[0].header).toEqual(EOA_TRANSFER_RESOURCES);
    const hdr = parseTransactionBody(sent[0].subarray(0, sent[0].length - 64));
    expect(hdr.ok && [hdr.header.computeUnits, hdr.header.memoryUnits, hdr.header.stateUnits]).toEqual([10_000, 10_000, 0]);

    await sendWithLedger(thru, signer, PATH0, PUBKEY0, {
      program: EOA_PROGRAM,
      header: { computeUnits: 20_000, fee: 5n, expiryAfter: 300, memoryUnits: undefined },
    });
    expect(built[1].header).toEqual({ computeUnits: 20_000, memoryUnits: 10_000, stateUnits: 0, fee: 5n, expiryAfter: 300 });
    const hdr2 = parseTransactionBody(sent[1].subarray(0, sent[1].length - 64));
    expect(hdr2.ok && [hdr2.header.computeUnits, hdr2.header.fee, hdr2.header.expiryAfter]).toEqual([20_000, 5n, 300]);
  });

  it('other programs get exactly the caller header (no EOA defaults)', async () => {
    const { signer } = await setup();
    const { thru, built } = fakeThru();
    const other = key(0x42);
    await sendWithLedger(thru, signer, PATH0, PUBKEY0, { program: other });
    expect(built[0].header).toEqual({});
    await sendWithLedger(thru, signer, PATH0, PUBKEY0, { program: other, header: { computeUnits: 300_000, stateUnits: 2 } });
    expect(built[1].header).toEqual({ computeUnits: 300_000, stateUnits: 2 });
  });

  it('createLedgerEoa defaults to the creation budget and accepts header overrides', async () => {
    const { signer } = await setup();
    const { thru, sent, built } = fakeThru();
    const feePayer = privateKeyBodySigner(SECRET1, PUBKEY1);
    await createLedgerEoa({ thru, ledger: signer, path: PATH0, feePayer });
    expect(built[0].header).toEqual({ ...EOA_CREATE_RESOURCES, chainId: 1 });
    const hdr = parseTransactionBody(sent[0].subarray(0, sent[0].length - 64));
    expect(hdr.ok && [hdr.header.computeUnits, hdr.header.memoryUnits, hdr.header.stateUnits]).toEqual([10_000, 10_000, 1]);

    await createLedgerEoa({
      thru,
      ledger: signer,
      path: PATH0,
      feePayer,
      chainId: 2,
      header: { fee: 0n, expiryAfter: 50, computeUnits: 12_000, chainId: 9 },
    });
    /* chainId always follows the authorization's chain id. */
    expect(built[1].header).toEqual({ computeUnits: 12_000, memoryUnits: 10_000, stateUnits: 1, fee: 0n, expiryAfter: 50, chainId: 2 });
  });

  it('mergeHeader ignores undefined overrides', () => {
    expect(mergeHeader({ computeUnits: 1, stateUnits: 1 }, { computeUnits: undefined, fee: 3n })).toEqual({
      computeUnits: 1,
      stateUnits: 1,
      fee: 3n,
    });
    expect(mergeHeader(undefined, undefined)).toEqual({});
  });

  it('refuses Legacy networks from the client context', async () => {
    const { signer } = await setup();
    const { thru } = fakeThru(TransactionSigningScheme.Legacy);
    await expect(sendWithLedger(thru, signer, PATH0, PUBKEY0, { program: EOA_PROGRAM })).rejects.toBeInstanceOf(
      UnsupportedSigningSchemeError,
    );
  });

  it('ledgerBodySigner checks the expected key', async () => {
    const { signer } = await setup();
    const wrong = ledgerBodySigner(signer, PATH0, PUBKEY1);
    await expect(wrong.signTransactionBody(buildBody())).rejects.toBeInstanceOf(ThruLedgerError);
  });

  it('ledgerBodySigner cancels on the signal passed to the call', async () => {
    const { device, signer } = await setup();
    const bodySigner = ledgerBodySigner(signer, PATH0, PUBKEY0);
    const controller = new AbortController();
    controller.abort();
    await expect(bodySigner.signTransactionBody(buildBody(), { signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it('createLedgerEoa fetches the creation proof after the device authorization', async () => {
    /* The runtime accepts a proof for 128 slots; one fetched before a long
       device review would be stale by the time the transaction lands. */
    const { device, signer } = await setup();
    const { thru, sent } = fakeThru();
    let authorizedFirst: boolean | undefined;
    thru.proofs.generate = async () => {
      authorizedFirst = sentIns(device, Ins.SIGN_EOA_AUTH).length === 1;
      return { proof: new Uint8Array(40) };
    };
    await createLedgerEoa({ thru, ledger: signer, path: PATH0, feePayer: privateKeyBodySigner(SECRET1, PUBKEY1) });
    expect(authorizedFirst).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('createLedgerEoa: cancelling during the review stops before the fee payer signs', async () => {
    const { signer } = await setup();
    const { thru, sent } = fakeThru();
    const controller = new AbortController();
    const local = privateKeyBodySigner(SECRET1, PUBKEY1);
    let feePayerCalls = 0;
    const feePayer = {
      publicKey: PUBKEY1,
      signTransactionBody: (body: Uint8Array) => {
        feePayerCalls += 1;
        return local.signTransactionBody(body);
      },
    };
    const err = await createLedgerEoa({
      thru,
      ledger: signer,
      path: PATH0,
      feePayer,
      options: { signal: controller.signal, onReview: () => controller.abort() },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancelledError);
    expect(feePayerCalls).toBe(0);
    expect(sent).toEqual([]);
  });

  it('createLedgerEoa: cancelling while the fee payer signs does not send; the fee payer gets the signal', async () => {
    const { signer } = await setup();
    const { thru, sent } = fakeThru();
    const controller = new AbortController();
    const local = privateKeyBodySigner(SECRET1, PUBKEY1);
    let seen: AbortSignal | undefined;
    const feePayer = {
      publicKey: PUBKEY1,
      signTransactionBody: async (body: Uint8Array, options?: { signal?: AbortSignal }) => {
        seen = options?.signal;
        const wire = await local.signTransactionBody(body);
        controller.abort();
        return wire;
      },
    };
    const err = await createLedgerEoa({
      thru,
      ledger: signer,
      path: PATH0,
      feePayer,
      options: { signal: controller.signal },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancelledError);
    expect(seen).toBe(controller.signal);
    expect(sent).toEqual([]);
  });

  it('createLedgerEoa: device authorizes, a local fee payer pays', async () => {
    const { device, signer } = await setup();
    const { thru, sent } = fakeThru();
    const result = await createLedgerEoa({
      thru,
      ledger: signer,
      path: PATH0,
      feePayer: privateKeyBodySigner(SECRET1, PUBKEY1),
    });
    expect(toHex(result.publicKey)).toBe(toHex(PUBKEY0));
    expect(sentIns(device, Ins.SIGN_EOA_AUTH)).toHaveLength(1);
    const wire = sent[0];
    const body = wire.subarray(0, wire.length - 64);
    expect(toHex(body.subarray(48, 80))).toBe(toHex(PUBKEY1));
    expect(await verifyWithDomain(wire.subarray(wire.length - 64), body, PUBKEY1, SignatureDomain.TXN)).toBe(true);
    /* CREATE_ACCOUNT: [disc u32][proof_size u64][idx u16][sig 64][proof]. */
    const instr = body.subarray(112 + 32, 112 + 32 + 78 + 40);
    expect(new DataView(instr.buffer, instr.byteOffset).getUint16(12, true)).toBe(2);
    expect(toHex(instr.subarray(14, 78))).toBe(toHex(result.authorization));
    const authM = new Uint8Array(66);
    authM.set([1, 0], 0);
    authM.set(PUBKEY1, 2);
    authM.set(PUBKEY0, 34);
    expect(await verifyWithDomain(result.authorization, authM, PUBKEY0, SignatureDomain.EOA_CREATE)).toBe(true);
  });
});

describe('U4/T8 witness: D11 on a Legacy network when the caller omits the scheme', () => {
  /*
   * app-thru-apdu.md §11.1 step 1 (D11): on a Legacy-scheme network the host
   * must refuse with a clear error and not contact the device. A client
   * created with `createThruClient({ transactionSigningScheme: 'legacy' })`
   * that follows the class doc example (`new ThruLedgerSigner({ dmk,
   * sessionId })`) gives the signer no way to learn the network scheme: it
   * falls back to RFC-8032 and streams SIGN_TXN to the device.
   */
  const networkScheme = TransactionSigningScheme.Legacy; /* thru.ctx.transactionSigningScheme */

  async function connect(): Promise<{ device: MockThruDevice; dmk: DeviceManagementKit; sessionId: string }> {
    const device = new MockThruDevice();
    const dmk = new DeviceManagementKitBuilder().addTransport(mockTransportFactory(device)).build();
    open.push(dmk);
    const sessionId = await connectLedger(dmk, { transport: MOCK_TRANSPORT_ID, timeoutMs: 2000 });
    return { device, dmk, sessionId };
  }

  it('ThruLedgerSigner built per its doc example refuses before any SIGN_TXN APDU', async () => {
    const { device, dmk, sessionId } = await connect();
    expect(networkScheme).toBe(TransactionSigningScheme.Legacy);
    /* The scheme is now a required field (fix for A-021); an untyped caller
       that still omits it must be refused at runtime. */
    // @ts-expect-error transactionSigningScheme is required
    const signer = new ThruLedgerSigner({ dmk, sessionId }); /* ThruLedgerSigner.ts:6 */
    const err = await signer.signTransactionBody(PATH0, buildBody()).catch((e: unknown) => e);
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
    expect(err).toBeInstanceOf(UnsupportedSigningSchemeError);
  });

  it('the exported DMK signer kit refuses before any SIGN_TXN APDU even when the scheme is passed', async () => {
    const { device, dmk, sessionId } = await connect();
    const signer = new ThruLedgerSigner({ dmk, sessionId, transactionSigningScheme: networkScheme });
    const { observable } = signer.dmkSigner.signTransaction(PATH0, buildBody());
    await new Promise<void>((resolve) => {
      observable.subscribe({ complete: () => resolve(), error: () => resolve() });
    });
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it('the DMK signer kit fails every signing action with UnsupportedSigningSchemeError and sends no APDU', async () => {
    const { device, dmk, sessionId } = await connect();
    const before = device.received.length;
    const kit = new SignerThruBuilder({ dmk, sessionId, transactionSigningScheme: networkScheme }).build();
    const errorOf = async (a: ThruDeviceActionReturn<unknown>): Promise<unknown> => {
      const states = await firstValueFrom(a.observable.pipe(toArray()));
      const last = states[states.length - 1];
      return last?.status === DeviceActionStatus.Error ? last.error : undefined;
    };
    expect(await errorOf(kit.signTransaction(PATH0, buildBody()))).toBeInstanceOf(UnsupportedSigningSchemeError);
    expect(await errorOf(kit.signMessage(PATH0, new Uint8Array([0x41])))).toBeInstanceOf(UnsupportedSigningSchemeError);
    expect(await errorOf(kit.signEoaAuth(PATH0, 'create', 1, PUBKEY1, PUBKEY0))).toBeInstanceOf(
      UnsupportedSigningSchemeError,
    );
    expect(device.received.length).toBe(before);
  });

  it('a kit built without a scheme (untyped caller) refuses too', async () => {
    const { device, dmk, sessionId } = await connect();
    // @ts-expect-error transactionSigningScheme is required
    const kit = new DefaultSignerThru({ dmk, sessionId });
    const states = await firstValueFrom(kit.signTransaction(PATH0, buildBody()).observable.pipe(toArray()));
    const last = states[states.length - 1];
    expect(last?.status).toBe(DeviceActionStatus.Error);
    expect(sentIns(device, Ins.SIGN_TXN)).toEqual([]);
  });

  it('getAddress still works without a scheme (it does not sign)', async () => {
    const { dmk, sessionId } = await connect();
    // @ts-expect-error transactionSigningScheme is required
    const signer = new ThruLedgerSigner({ dmk, sessionId });
    expect(toHex((await signer.getAddress(PATH0)).publicKey)).toBe(toHex(PUBKEY0));
  });

  it('the adapter refuses a client with no signing-scheme context', async () => {
    const { device, dmk, sessionId } = await connect();
    const signer = new ThruLedgerSigner({ dmk, sessionId, transactionSigningScheme: TransactionSigningScheme.Rfc8032 });
    const thru = {
      transactions: {
        build: async () => {
          throw new Error('must not build');
        },
        send: async () => '',
      },
      chain: { getChainId: async () => 1 },
      proofs: { generate: async () => ({ proof: new Uint8Array() }) },
    } as unknown as LedgerThruClient;
    await expect(sendWithLedger(thru, signer, PATH0, PUBKEY0, { program: EOA_PROGRAM })).rejects.toBeInstanceOf(
      UnsupportedSigningSchemeError,
    );
    expect(device.thruApdus()).toEqual([]);
  });
});
