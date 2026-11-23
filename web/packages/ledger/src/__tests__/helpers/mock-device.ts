/**
 * A simulated Thru device app implementing `specs/ledger/app-thru-apdu.md`
 * (framing, path policy, session state machine §10, SIGN_TXN streaming with
 * the envelope parser, two-pass SIGN_MESSAGE, SIGN_EOA_AUTH), plus a DMK
 * `Transport` that routes APDUs to it. Keys come from the HD corpus
 * (`abandon … about`), so signatures match the signing corpus bit for bit.
 *
 * It is a test double, not a reference implementation: it buffers the body
 * and message instead of streaming them into Ed25519.
 */
import {
  DeviceModelId,
  type ApduResponse,
  type Transport,
  type TransportConnectedDevice,
  type TransportDiscoveredDevice,
  type TransportFactory,
} from '@ledgerhq/device-management-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { signWithDomain, SignatureDomain } from '@thru/sdk';
import { Right } from 'purify-ts';
import { of, type Observable } from 'rxjs';

import { bytesEqual, concatBytes, fromHex, toHex } from '../../protocol/bytes';
import { Ins, MSG_DISPLAY_MAX, MSG_MAX, THRU_CLA } from '../../protocol/constants';
import { messageDisplayMode } from '../../protocol/display';
import { decodeLedgerPath } from '../../protocol/path';
import { StatusWord } from '../../protocol/status-words';
import { decodeClearTransfer } from '../../protocol/transfer';
import { TxnStreamParser } from '../../protocol/txn-parser';
import { KEY0, loadHdVectors } from './fixtures';

export type ReviewKind = 'address' | 'txn' | 'message' | 'eoa';

const KEYS: ReadonlyMap<string, { seed: Uint8Array; pubkey: Uint8Array }> = new Map(
  loadHdVectors()
    .derivations.filter((d) => d.mnemonic === KEY0.mnemonic && d.passphrase === '')
    .map((d) => [d.path, { seed: fromHex(d.private_seed_hex), pubkey: fromHex(d.pubkey_hex) }] as const),
);

type Session =
  | { kind: 'idle' }
  | {
      kind: 'txn';
      path: string;
      expectedP1: number;
      parser: TxnStreamParser;
      body: Uint8Array[];
      /** Chunk-0 token hint without its kind byte, or `null`. */
      hint: Uint8Array | null;
    }
  | {
      kind: 'msg';
      pass: 1 | 2;
      path: string;
      msgLen: number;
      expectedP1: number;
      pass1: Uint8Array[];
      count: number;
      pass2: Uint8Array[];
    };

class Reply {
  constructor(
    readonly sw: number,
    readonly data: Uint8Array = new Uint8Array(0),
  ) {}
}

const ok = (data?: Uint8Array): Reply => new Reply(StatusWord.OK, data);
const err = (sw: number): Reply => new Reply(sw);

/** §7.2.1 token hint after the chunk-0 path: kind 0x01, then four 32-byte fields. */
const HINT_LEN = 129;
/** Token program (Appendix B.5). */
const TOKEN_PROGRAM = fromHex('4ce28437b4c4d87446ceacfb1232e26dcea2782c2e5f2b390616f6f92abc659f');

/**
 * §7.6/§7.7: does `hint` (the 128 bytes after the kind) prove the body's token
 * accounts and, for a TransferChecked the device recognizes, name its mint?
 */
function hintProvesTokenAccounts(body: Uint8Array, hint: Uint8Array): boolean {
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const rw = v.getUint16(2, true);
  const ro = v.getUint16(4, true);
  const instrSz = v.getUint16(6, true);
  if (!bytesEqual(body.subarray(80, 112), TOKEN_PROGRAM)) return false;
  const at = 112 + 32 * (rw + ro);
  if (instrSz === 25 && body[at] === 8) {
    const checked = decodeClearTransfer(body)?.checked ?? null;
    if (checked === null || !bytesEqual(checked.mint, hint.subarray(0, 32))) return false;
  } else if (instrSz !== 13 || body[at] !== 2) {
    return false;
  }
  const account = (index: number): Uint8Array | null => {
    const slot = index - 2;
    return slot >= 0 && slot < rw && slot < 32 ? body.subarray(112 + 32 * slot, 144 + 32 * slot) : null;
  };
  const source = account(v.getUint16(at + 1, true));
  const recipient = account(v.getUint16(at + 3, true));
  if (source === null || recipient === null) return false;
  const mint = hint.subarray(0, 32);
  const derive = (owner: Uint8Array, seed: Uint8Array): Uint8Array =>
    sha256(concatBytes(TOKEN_PROGRAM, new Uint8Array([0]), sha256(concatBytes(owner, mint, seed))));
  return (
    bytesEqual(source, derive(body.subarray(48, 80), hint.subarray(96, 128))) &&
    bytesEqual(recipient, derive(hint.subarray(32, 64), hint.subarray(64, 96)))
  );
}

export interface MockThruDeviceOptions {
  appName?: string;
  blindSigning?: boolean;
  locked?: boolean;
  version?: [number, number, number];
  apduProtocolVersion?: number;
}

export class MockThruDevice {
  appName: string;
  blindSigning: boolean;
  locked: boolean;
  version: [number, number, number];
  apduProtocolVersion: number;
  /** Decide the user's answer on each review. Default: approve. */
  approve: (kind: ReviewKind) => boolean | Promise<boolean> = () => true;
  /**
   * Return a status word to force for this APDU (after the app sees it, so
   * the session is cleared as for any error), or `undefined` to process it.
   */
  inject: (apdu: Uint8Array) => number | undefined = () => undefined;
  /**
   * Answer this many upcoming APDUs with `0x6901`, as the Ledger Rust SDK
   * does while its status page is shown: the app never sees them, so the
   * session is untouched.
   */
  busyApdus = 0;
  /**
   * Replace the signature the device returns (a faulty or hostile device or
   * transport). The host must verify it before use (§11.2).
   */
  tamperSignature: (sig: Uint8Array, kind: 'txn' | 'msg' | 'eoa') => Uint8Array = (sig) => sig;
  /** APDUs answered `0x6901` so far. */
  busyAnswered = 0;
  /** Every APDU received, in order. */
  readonly received: Uint8Array[] = [];
  /** Every Thru (CLA E0) APDU and its status word. */
  readonly exchanges: { apdu: string; sw: number }[] = [];
  #session: Session = { kind: 'idle' };

  constructor(options: MockThruDeviceOptions = {}) {
    this.appName = options.appName ?? 'Thru';
    this.blindSigning = options.blindSigning ?? true;
    this.locked = options.locked ?? false;
    this.version = options.version ?? [1, 0, 0];
    this.apduProtocolVersion = options.apduProtocolVersion ?? 1;
  }

  get sessionKind(): Session['kind'] {
    return this.#session.kind;
  }

  /** Thru APDUs (CLA E0, INS 03..09) only, as uppercase hex. */
  thruApdus(): string[] {
    return this.exchanges.map((e) => e.apdu);
  }

  async exchange(apdu: Uint8Array): Promise<Reply> {
    this.received.push(apdu);
    if (this.busyApdus > 0) {
      this.busyApdus -= 1;
      this.busyAnswered += 1;
      return err(StatusWord.SDK_CMD_NOT_ACCEPTED);
    }
    const reply = await this.#dispatch(apdu);
    if (reply.sw !== StatusWord.OK) this.#session = { kind: 'idle' };
    if (apdu[0] === THRU_CLA && apdu[1] >= Ins.GET_VERSION && apdu[1] <= Ins.SIGN_EOA_AUTH) {
      this.exchanges.push({ apdu: toHex(apdu).toUpperCase(), sw: reply.sw });
    }
    return reply;
  }

  async #dispatch(apdu: Uint8Array): Promise<Reply> {
    if (this.locked) return err(StatusWord.OS_DEVICE_LOCKED);
    if (apdu.length < 5) return err(StatusWord.WRONG_DATA_LENGTH);
    const [cla, ins, p1, p2, lc] = apdu;
    const data = apdu.subarray(5);

    /* OS GET_APP_AND_VERSION (B0 01): answered by the OS; it still interrupts the app session. */
    if (cla === 0xb0 && ins === 0x01) {
      this.#session = { kind: 'idle' };
      const name = new TextEncoder().encode(this.appName);
      const ver = new TextEncoder().encode(this.version.join('.'));
      return ok(concatBytes(new Uint8Array([1, name.length]), name, new Uint8Array([ver.length]), ver));
    }
    if (this.appName !== 'Thru') return err(StatusWord.OS_APP_NOT_OPEN_6E01);
    if (cla !== THRU_CLA) {
      this.#session = { kind: 'idle' };
      return err(StatusWord.CLA_NOT_SUPPORTED);
    }
    if (data.length !== lc) return err(StatusWord.WRONG_DATA_LENGTH);

    /* A different INS clears the session before processing (§10.2). */
    const sessionIns = this.#session.kind === 'txn' ? Ins.SIGN_TXN : this.#session.kind === 'msg' ? Ins.SIGN_MESSAGE : -1;
    if (sessionIns !== ins) this.#session = { kind: 'idle' };

    const forced = this.inject(apdu);
    if (forced !== undefined) return err(forced);

    switch (ins) {
      case Ins.GET_VERSION:
      case Ins.GET_APP_NAME:
      case Ins.GET_APP_CONFIG:
        if (p1 !== 0 || p2 !== 0) return err(StatusWord.WRONG_P1P2);
        if (data.length !== 0) return err(StatusWord.WRONG_DATA_LENGTH);
        if (ins === Ins.GET_VERSION) return ok(new Uint8Array(this.version));
        if (ins === Ins.GET_APP_NAME) return ok(new TextEncoder().encode('Thru'));
        return ok(new Uint8Array([this.blindSigning ? 1 : 0, ...this.version, this.apduProtocolVersion]));
      case Ins.GET_PUBKEY:
        return this.#getPubkey(p1, p2, data);
      case Ins.SIGN_TXN:
        return this.#signTxn(p1, p2, data);
      case Ins.SIGN_MESSAGE:
        return this.#signMessage(p1, p2, data);
      case Ins.SIGN_EOA_AUTH:
        return this.#signEoa(p1, p2, data);
      default:
        return err(StatusWord.INS_NOT_SUPPORTED);
    }
  }

  /** Validate a path occupying exactly `data` (minus `extra` trailing bytes). */
  #path(data: Uint8Array, extra: number): { reply: Reply } | { path: string; size: number } {
    const decoded = decodeLedgerPath(data);
    if (!decoded.ok) {
      return { reply: err(decoded.error === 'length' ? StatusWord.WRONG_DATA_LENGTH : StatusWord.PATH_REJECTED) };
    }
    if (data.length !== decoded.size + extra) return { reply: err(StatusWord.WRONG_DATA_LENGTH) };
    if (!KEYS.has(decoded.path.path)) return { reply: err(StatusWord.INTERNAL_ERROR) };
    return { path: decoded.path.path, size: decoded.size };
  }

  async #getPubkey(p1: number, p2: number, data: Uint8Array): Promise<Reply> {
    if ((p1 !== 0 && p1 !== 1) || p2 !== 0) return err(StatusWord.WRONG_P1P2);
    const r = this.#path(data, 0);
    if ('reply' in r) return r.reply;
    if (p1 === 1 && !(await this.approve('address'))) return err(StatusWord.USER_DENIED);
    return ok(KEYS.get(r.path)!.pubkey);
  }

  async #signTxn(p1: number, p2: number, data: Uint8Array): Promise<Reply> {
    if (p2 !== 0x80 && p2 !== 0x00) return err(StatusWord.WRONG_P1P2);
    if (p1 === 0) {
      this.#session = { kind: 'idle' };
      if (p2 !== 0x80) return err(StatusWord.WRONG_P1P2);
      /* §7.3: total length (path, or path plus a 129-byte hint), then the
         path policy, then the hint kind. */
      const pathSize = data.length > 0 ? 1 + 4 * data[0] : 0;
      const extra = data.length - pathSize;
      if (data.length === 0 || (extra !== 0 && extra !== HINT_LEN)) return err(StatusWord.WRONG_DATA_LENGTH);
      const r = this.#path(data.subarray(0, pathSize), 0);
      if ('reply' in r) return r.reply;
      if (extra > 0 && data[pathSize] !== 0x01) return err(StatusWord.TXN_HINT_INVALID);
      const hint = extra > 0 ? data.slice(pathSize + 1) : null;
      /* §7.3 step 4: no blind-signing gate before the instruction is known. */
      const parser = new TxnStreamParser({ derivedPubkey: KEYS.get(r.path)!.pubkey });
      this.#session = { kind: 'txn', path: r.path, expectedP1: 1, parser, body: [], hint };
      return ok();
    }
    const s = this.#session;
    if (s.kind !== 'txn' || s.expectedP1 !== p1) return err(StatusWord.CHUNK_OUT_OF_ORDER);
    if (data.length < 1) return err(StatusWord.WRONG_DATA_LENGTH);
    s.body.push(new Uint8Array(data));
    const failure = s.parser.feed(data);
    if (failure !== null) return err(failure.sw);
    if (p2 === 0x80) {
      if (s.parser.done) return err(StatusWord.TXN_INVALID_FORMAT);
      s.expectedP1 = p1 + 1;
      return ok();
    }
    const result = s.parser.finish();
    if (!result.ok) return err(result.sw);
    const body = concatBytes(...s.body);
    if (s.hint !== null && !hintProvesTokenAccounts(body, s.hint)) return err(StatusWord.TOKEN_HINT_MISMATCH);
    /* §7.6: only a transaction without a clear transfer needs the setting. */
    if (!this.blindSigning && decodeClearTransfer(body) === null) return err(StatusWord.BLIND_SIGNING_DISABLED);
    if (!(await this.approve('txn'))) return err(StatusWord.USER_DENIED);
    const key = KEYS.get(s.path)!;
    if (!bytesEqual(sha256(body), result.bodyHash)) return err(StatusWord.INTERNAL_ERROR);
    const sig = await signWithDomain(body, key.seed, key.pubkey, SignatureDomain.TXN);
    this.#session = { kind: 'idle' };
    return ok(this.tamperSignature(sig, 'txn'));
  }

  async #signMessage(p1: number, p2: number, data: Uint8Array): Promise<Reply> {
    if (p2 !== 0x80 && p2 !== 0x00) return err(StatusWord.WRONG_P1P2);
    if (p1 === 0) {
      this.#session = { kind: 'idle' };
      if (p2 !== 0x80) return err(StatusWord.WRONG_P1P2);
      const r = this.#path(data, 4);
      if ('reply' in r) return r.reply;
      const msgLen = new DataView(data.buffer, data.byteOffset + r.size, 4).getUint32(0, false);
      if (msgLen === 0 || msgLen > MSG_MAX) return err(StatusWord.MSG_INVALID_LENGTH);
      if (msgLen > MSG_DISPLAY_MAX && !this.blindSigning) return err(StatusWord.BLIND_SIGNING_DISABLED);
      this.#session = { kind: 'msg', pass: 1, path: r.path, msgLen, expectedP1: 1, pass1: [], pass2: [], count: 0 };
      return ok();
    }
    const s = this.#session;
    if (s.kind !== 'msg' || s.expectedP1 !== p1) return err(StatusWord.CHUNK_OUT_OF_ORDER);
    if (data.length < 1) return err(StatusWord.WRONG_DATA_LENGTH);
    if (s.count + data.length > s.msgLen) return err(StatusWord.LENGTH_MISMATCH);
    (s.pass === 1 ? s.pass1 : s.pass2).push(new Uint8Array(data));
    s.count += data.length;
    if (p2 === 0x80 && s.count === s.msgLen) return err(StatusWord.LENGTH_MISMATCH);
    if (p2 === 0x00 && s.count < s.msgLen) return err(StatusWord.LENGTH_MISMATCH);
    if (p2 === 0x80) {
      s.expectedP1 = p1 + 1;
      return ok();
    }
    const message = concatBytes(...s.pass1);
    if (s.pass === 1) {
      const hashMode = messageDisplayMode(message) === 'hash';
      if (hashMode && !this.blindSigning) return err(StatusWord.BLIND_SIGNING_DISABLED);
      if (!(await this.approve('message'))) return err(StatusWord.USER_DENIED);
      s.pass = 2;
      s.count = 0;
      s.expectedP1 = 1;
      return ok();
    }
    if (!bytesEqual(sha256(concatBytes(...s.pass2)), sha256(message))) return err(StatusWord.MSG_PASS_MISMATCH);
    const key = KEYS.get(s.path)!;
    const sig = await signWithDomain(message, key.seed, key.pubkey, SignatureDomain.MSG);
    this.#session = { kind: 'idle' };
    return ok(this.tamperSignature(sig, 'msg'));
  }

  async #signEoa(p1: number, p2: number, data: Uint8Array): Promise<Reply> {
    if (p1 !== 0 || p2 !== 0) return err(StatusWord.WRONG_P1P2);
    const r = this.#path(data, 67);
    if ('reply' in r) return r.reply;
    const tail = data.subarray(r.size);
    const kind = tail[0];
    const chainId = tail[1] | (tail[2] << 8);
    const account = tail.subarray(35, 67);
    if (kind !== 0 && kind !== 1) return err(StatusWord.EOA_INVALID_KIND);
    if (chainId === 0) return err(StatusWord.CHAIN_ID_ZERO);
    const key = KEYS.get(r.path)!;
    if (!bytesEqual(account, key.pubkey)) return err(StatusWord.EOA_ACCOUNT_MISMATCH);
    if (!(await this.approve('eoa'))) return err(StatusWord.USER_DENIED);
    const domain = kind === 0 ? SignatureDomain.EOA_CREATE : SignatureDomain.EOA_DELETE;
    return ok(this.tamperSignature(await signWithDomain(tail.slice(1, 67), key.seed, key.pubkey, domain), 'eoa'));
  }
}

/* ------------------------------------------------------------ transport */

export const MOCK_TRANSPORT_ID = 'THRU_MOCK_TRANSPORT';

const deviceModel = {
  id: DeviceModelId.NANO_SP,
  productName: 'Mock Thru Device',
  usbProductId: 0x50,
  bootloaderUsbProductId: 0x0005,
  usbOnly: true,
  memorySize: 1533 * 1024,
  masks: [0x33100000],
  getBlockSize: () => 32,
};

/** A DMK transport factory that connects to `device`. */
export function mockTransportFactory(device: MockThruDevice): TransportFactory {
  return () => {
    const discovered: TransportDiscoveredDevice = {
      id: 'mock-thru-device',
      deviceModel: deviceModel as unknown as TransportDiscoveredDevice['deviceModel'],
      transport: MOCK_TRANSPORT_ID,
    };
    const transport: Transport = {
      getIdentifier: () => MOCK_TRANSPORT_ID,
      isSupported: () => true,
      startDiscovering: (): Observable<TransportDiscoveredDevice> => of(discovered),
      stopDiscovering: () => undefined,
      listenToAvailableDevices: () => of([discovered]),
      connect: async () => {
        const connected = {
          id: discovered.id,
          deviceModel: discovered.deviceModel,
          type: 'USB',
          transport: MOCK_TRANSPORT_ID,
          sendApdu: async (apdu: Uint8Array) => {
            const reply = await device.exchange(apdu);
            const response: ApduResponse = {
              statusCode: new Uint8Array([reply.sw >> 8, reply.sw & 0xff]),
              data: reply.data,
            };
            return Right(response);
          },
        } as unknown as TransportConnectedDevice;
        return Right(connected);
      },
      disconnect: async () => Right(undefined),
    };
    return transport;
  };
}
