/**
 * SIGN_TXN token hint (`specs/ledger/app-thru-apdu.md` §7.2.1): encoding,
 * token-account derivation, and the host copy of the device's hint rule.
 */
import { describe, expect, it } from 'vitest';

import { InvalidRequestError, MalformedTransactionError } from '../errors';
import {
  decodeClearTransfer,
  DEFAULT_TOKEN_ACCOUNT_SEED,
  encodeTokenHint,
  fromHex,
  signTxnApdus,
  thruAddress,
  toHex,
  TOKEN_HINT_KIND,
  TOKEN_HINT_SZ,
  TOKEN_PROGRAM,
  tokenAccountAddress,
  verifyTokenHint,
  type TokenHint,
} from '../protocol';
import { buildBody, PUBKEY0 } from './helpers/fixtures';

const PATH0 = "m/44'/8478'/0'/0'";

/*
 * Shared with the device app's functional tests (`thru_txn.py`: `TOKEN_MINT`,
 * `RECIPIENT`, `token_account`). The device accepted these accounts for this
 * hint on all five models, so these vectors tie this port to the device.
 */
const MINT = fromHex('266ca05e1a300a2be3d69bf25c25f8632808e7b4299279535da4d0f877fd5d30');
const RECIPIENT_OWNER = fromHex('546fdb52f2026f707260cf7c9c8ffdacd4c3c05624487893f6426168b5a1eb63');
const SOURCE_ACCOUNT = fromHex('1469debe9dfacd29cd2fd736b672d2b9c3178959d393f9fc21d2dd217cf9f4b1');
const RECIPIENT_ACCOUNT = fromHex('b1ccbc6a010085ee3e98b08940c20b9bc0708fa63061cdd0a4c46355e4feb8ab');
const OTHER_SEED = new Uint8Array(32).fill(0x44);
const SOURCE_ACCOUNT_OTHER_SEED = fromHex('b29c3c668c4a337e874905feb655652cb0c2da5ee93aafb7c7907dc0a6d5992d');

const HINT: TokenHint = { mint: MINT, recipientOwner: RECIPIENT_OWNER };

function transferInstr(source: number, recipient: number, amount: bigint): Uint8Array {
  const out = new Uint8Array(13);
  const v = new DataView(out.buffer);
  out[0] = 2;
  v.setUint16(1, source, true);
  v.setUint16(3, recipient, true);
  v.setBigUint64(5, amount, true);
  return out;
}

/** A token Transfer between two token accounts, rw keys sorted as the envelope requires. */
function tokenTransferBody(source: Uint8Array, recipient: Uint8Array, amount = 250_000n): Uint8Array {
  const rw = [source, recipient].sort((a, b) => (toHex(a) < toHex(b) ? -1 : 1));
  const index = (k: Uint8Array): number => 2 + rw.indexOf(k);
  return buildBody({ program: TOKEN_PROGRAM, rw, instr: transferInstr(index(source), index(recipient), amount) });
}

const HINTED_BODY = tokenTransferBody(SOURCE_ACCOUNT, RECIPIENT_ACCOUNT);

/** The TransferChecked of HINTED_BODY (0.25 USDC) whose read-only mint is `mint`. */
function checkedTransferBody(mint: Uint8Array): Uint8Array {
  const plain = decodeClearTransfer(HINTED_BODY)!;
  const rw = [plain.source, plain.recipient].sort((a, b) => (toHex(a) < toHex(b) ? -1 : 1));
  const instr = new Uint8Array(25);
  const v = new DataView(instr.buffer);
  instr[0] = 8;
  v.setUint16(1, 2 + rw.findIndex((k) => toHex(k) === toHex(SOURCE_ACCOUNT)), true);
  v.setUint16(3, 2 + rw.findIndex((k) => toHex(k) === toHex(RECIPIENT_ACCOUNT)), true);
  v.setUint16(5, 4, true);
  v.setBigUint64(7, 250_000n, true);
  instr.set([6, 4, 0x55, 0x53, 0x44, 0x43], 15);
  return buildBody({ program: TOKEN_PROGRAM, rw, ro: [mint], instr });
}

describe('token program and derivation', () => {
  it('uses the device and SDK token program address', () => {
    expect(thruAddress(TOKEN_PROGRAM)).toBe('taTOKEN7TE2HRGzqz7EjLibc6ieCwuXys5Bhb2-Sq8ZZ_1');
  });

  it('derives the token accounts the device accepted', () => {
    expect(toHex(tokenAccountAddress(PUBKEY0, MINT))).toBe(toHex(SOURCE_ACCOUNT));
    expect(toHex(tokenAccountAddress(RECIPIENT_OWNER, MINT, DEFAULT_TOKEN_ACCOUNT_SEED))).toBe(
      toHex(RECIPIENT_ACCOUNT),
    );
    expect(toHex(tokenAccountAddress(PUBKEY0, MINT, OTHER_SEED))).toBe(toHex(SOURCE_ACCOUNT_OTHER_SEED));
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => tokenAccountAddress(PUBKEY0.subarray(1), MINT)).toThrow(InvalidRequestError);
    expect(() => tokenAccountAddress(PUBKEY0, MINT, new Uint8Array(31))).toThrow(InvalidRequestError);
  });
});

describe('encodeTokenHint', () => {
  it('lays out kind, mint, recipient owner, recipient seed and source seed', () => {
    const bytes = encodeTokenHint({ ...HINT, sourceSeed: OTHER_SEED });
    expect(bytes.length).toBe(TOKEN_HINT_SZ);
    expect(bytes[0]).toBe(TOKEN_HINT_KIND);
    expect(toHex(bytes.subarray(1, 33))).toBe(toHex(MINT));
    expect(toHex(bytes.subarray(33, 65))).toBe(toHex(RECIPIENT_OWNER));
    expect(toHex(bytes.subarray(65, 97))).toBe(toHex(DEFAULT_TOKEN_ACCOUNT_SEED));
    expect(toHex(bytes.subarray(97, 129))).toBe(toHex(OTHER_SEED));
  });

  it('rejects fields that are not 32 bytes', () => {
    for (const bad of [
      { ...HINT, mint: MINT.subarray(0, 31) },
      { ...HINT, recipientOwner: new Uint8Array(33) },
      { ...HINT, recipientSeed: new Uint8Array(0) },
      { ...HINT, sourceSeed: new Uint8Array(16) },
    ]) {
      expect(() => encodeTokenHint(bad)).toThrow(InvalidRequestError);
    }
  });

  it('is appended to chunk 0 after the path; body chunks are unchanged', () => {
    const plain = signTxnApdus(PATH0, HINTED_BODY);
    const hinted = signTxnApdus(PATH0, HINTED_BODY, undefined, HINT);
    expect(hinted.length).toBe(plain.length);
    expect(toHex(hinted[0].data)).toBe(toHex(plain[0].data) + toHex(encodeTokenHint(HINT)));
    expect(hinted[0].data.length).toBe(17 + TOKEN_HINT_SZ);
    expect([hinted[0].p1, hinted[0].p2]).toEqual([0, 0x80]);
    for (let i = 1; i < plain.length; i++) expect(hinted[i]).toEqual(plain[i]);
  });
});

describe('decodeClearTransfer (token form)', () => {
  it('returns the accounts and amount of the canonical form', () => {
    const t = decodeClearTransfer(HINTED_BODY);
    expect(t?.kind).toBe('token');
    expect(toHex(t!.source)).toBe(toHex(SOURCE_ACCOUNT));
    expect(toHex(t!.recipient)).toBe(toHex(RECIPIENT_ACCOUNT));
    expect(t!.amount).toBe(250_000n);
  });

  it('recognizes nothing else, like the device', () => {
    const rw = [SOURCE_ACCOUNT, RECIPIENT_ACCOUNT].sort((a, b) => (toHex(a) < toHex(b) ? -1 : 1));
    const instr = transferInstr(2, 3, 1n);
    const cases: Record<string, Uint8Array> = {
      other_program: buildBody({ rw, instr }),
      trailing_byte: buildBody({ program: TOKEN_PROGRAM, rw, instr: new Uint8Array([...instr, 0]) }),
      other_tag: buildBody({ program: TOKEN_PROGRAM, rw, instr: new Uint8Array([3, ...instr.subarray(1)]) }),
      fee_payer_index: buildBody({ program: TOKEN_PROGRAM, rw, instr: transferInstr(0, 3, 1n) }),
      readonly_recipient: buildBody({
        program: TOKEN_PROGRAM,
        rw: [rw[0]],
        ro: [rw[1]],
        instr: transferInstr(2, 3, 1n),
      }),
    };
    for (const [name, body] of Object.entries(cases)) expect(decodeClearTransfer(body), name).toBeNull();
  });

  it('resolves only the first 32 read-write accounts', () => {
    const rw = Array.from({ length: 34 }, (_, i) => {
      const k = new Uint8Array(32).fill(0x55);
      k[0] = 0x10 + i;
      return k;
    });
    const at = (recipient: number): Uint8Array =>
      buildBody({ program: TOKEN_PROGRAM, rw, instr: transferInstr(2, recipient, 1n) });
    expect(decodeClearTransfer(at(33))).not.toBeNull();
    expect(decodeClearTransfer(at(34))).toBeNull();
  });
});

describe('verifyTokenHint', () => {
  it('returns what the device shows for a matching hint', () => {
    const id = verifyTokenHint(HINTED_BODY, HINT);
    expect(toHex(id.mint)).toBe(toHex(MINT));
    expect(toHex(id.sourceOwner)).toBe(toHex(PUBKEY0));
    expect(toHex(id.recipientOwner)).toBe(toHex(RECIPIENT_OWNER));
    expect(id.amount).toBe(250_000n);
  });

  it('honours non-default seeds', () => {
    const body = tokenTransferBody(SOURCE_ACCOUNT_OTHER_SEED, RECIPIENT_ACCOUNT);
    expect(() => verifyTokenHint(body, HINT)).toThrow(InvalidRequestError);
    expect(verifyTokenHint(body, { ...HINT, sourceSeed: OTHER_SEED }).amount).toBe(250_000n);
  });

  it('refuses every hint that does not prove both accounts', () => {
    const other = new Uint8Array(32).fill(0x01);
    const cases: Record<string, [Uint8Array, TokenHint]> = {
      wrong_mint: [HINTED_BODY, { ...HINT, mint: other }],
      wrong_recipient_owner: [HINTED_BODY, { ...HINT, recipientOwner: PUBKEY0 }],
      wrong_recipient_seed: [HINTED_BODY, { ...HINT, recipientSeed: other }],
      wrong_source_seed: [HINTED_BODY, { ...HINT, sourceSeed: other }],
      swapped_accounts: [tokenTransferBody(RECIPIENT_ACCOUNT, SOURCE_ACCOUNT), HINT],
      source_not_fee_payer: [
        tokenTransferBody(tokenAccountAddress(other, MINT), RECIPIENT_ACCOUNT),
        HINT,
      ],
      not_a_token_transfer: [buildBody(), HINT],
    };
    for (const [name, [body, hint]] of Object.entries(cases)) {
      let error: unknown;
      try {
        verifyTokenHint(body, hint);
      } catch (e) {
        error = e;
      }
      expect(error, name).toBeInstanceOf(InvalidRequestError);
      expect((error as InvalidRequestError).reason, name).toBe('token_hint');
    }
  });

  it('accepts a TransferChecked only when it names the hint mint', () => {
    expect(toHex(verifyTokenHint(checkedTransferBody(MINT), HINT).mint)).toBe(toHex(MINT));
    /* The same token accounts, but the transaction names another mint. */
    expect(() => verifyTokenHint(checkedTransferBody(new Uint8Array(32).fill(0xee)), HINT)).toThrow(
      /names another mint/,
    );
  });

  it('reports a malformed body as the device would', () => {
    expect(() => verifyTokenHint(HINTED_BODY.subarray(0, 100), HINT)).toThrow(MalformedTransactionError);
  });
});
