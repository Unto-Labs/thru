/**
 * Pure encoding/decoding tests against `specs/ledger/app-thru-apdu.md`
 * (worked examples in Appendix A, formats in Appendix B) and the HD corpus.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import {
  SignatureDomain,
  signatureDomainDST,
  eoa,
  EOA_PROGRAM_ID,
  TOKEN_PROGRAM_ADDRESS,
  MULTICALL_PROGRAM_ADDRESS,
  WALLET_PROGRAM_ADDRESS,
  COMPRESSION_PROGRAM_ADDRESS,
} from '@thru/sdk';
import { decodeAddress, encodeAddress } from '@thru/sdk/helpers';
import { describe, expect, it } from 'vitest';

import { InvalidRequestError, PathRejectedError, ProtocolError } from '../errors';
import {
  APDU_MAX_DATA,
  DST_EOA_CREATE,
  DST_EOA_DELETE,
  DST_MSG,
  DST_TXN,
  KNOWN_PROGRAMS,
  StatusWord,
  TXN_BODY_MAX,
  chunkBytes,
  computeBodyHashDisplay,
  computeMessageHashDisplay,
  decodeAppConfigResponse,
  decodeAppNameResponse,
  decodeLedgerPath,
  decodePubkeyResponse,
  decodeSignatureResponse,
  decodeVersionResponse,
  describeEoaAuth,
  describeMessage,
  describeTransaction,
  encodeLedgerPath,
  formatLedgerPath,
  formatAmount,
  formatThruAmount,
  formatTokenAmount,
  fromHex,
  getAppConfigApdu,
  getAppNameApdu,
  getPubkeyApdu,
  getVersionApdu,
  isLedgerPath,
  knownProgramLabel,
  ledgerPathForAccount,
  messageDisplayMode,
  networkLabel,
  parseLedgerPath,
  serializeApdu,
  signEoaAuthApdu,
  signMessageApdus,
  signTxnApdus,
  toHex,
} from '../protocol';
import { asciiBytes as asciiBytesForTest } from '../protocol/bytes';
import { A3_BODY_HEX, KEY0, PUBKEY0, PUBKEY1, buildBody, loadHdVectors } from './helpers/fixtures';

const hex = (b: Uint8Array): string => toHex(b).toUpperCase();
const PATH0 = "m/44'/8478'/0'/0'";
const PATH0_ENC = '048000002C8000211E8000000080000000';

describe('constants', () => {
  it('DSTs match the SDK table (tn_signature_dst_table)', () => {
    const dec = (d: SignatureDomain): string => new TextDecoder().decode(signatureDomainDST(d));
    expect(DST_TXN).toBe(dec(SignatureDomain.TXN));
    expect(DST_MSG).toBe(dec(SignatureDomain.MSG));
    expect(DST_EOA_CREATE).toBe(dec(SignatureDomain.EOA_CREATE));
    expect(DST_EOA_DELETE).toBe(dec(SignatureDomain.EOA_DELETE));
  });

  it('TXN_BODY_MAX is MTU minus the signature', () => {
    expect(TXN_BODY_MAX).toBe(32704);
  });
});

describe('derivation paths (§4)', () => {
  const hd = loadHdVectors();

  it('corpus coin type matches THRU_COIN_TYPE', () => {
    expect(hd.coin_type).toBe(8478);
  });

  it.each(hd.derivations.map((d) => [d.name, d] as const))('encodes %s', (_name, d) => {
    const parsed = parseLedgerPath(d.path);
    expect(parsed.depth).toBe(d.depth);
    expect(parsed.account).toBe(d.account);
    expect(parsed.path).toBe(d.path);
    expect(toHex(encodeLedgerPath(d.path))).toBe(d.path_apdu_hex);
    const decoded = decodeLedgerPath(fromHex(d.path_apdu_hex));
    expect(decoded.ok && decoded.path.path).toBe(d.path);
    expect(isLedgerPath(d.path)).toBe(true);
  });

  it.each(hd.path_policy.map((p) => [p.name, p] as const))('rejects %s', (_name, p) => {
    expect(isLedgerPath(p.path)).toBe(false);
    expect(() => parseLedgerPath(p.path)).toThrow(PathRejectedError);
    expect(() => parseLedgerPath(p.components)).toThrow(PathRejectedError);
    const decoded = decodeLedgerPath(fromHex(p.path_apdu_hex));
    expect(decoded).toMatchObject({ ok: false, error: 'policy' });
  });

  it("rejects change other than 0' at depth 4 (§4.2 rule 5)", () => {
    for (const path of ["m/44'/8478'/0'/1'", "m/44'/8478'/0'/0", "m/44'/8478'/0'/2147483647'"]) {
      expect(isLedgerPath(path)).toBe(false);
    }
  });

  it("accepts account 2^31-1 (component FF FF FF FF)", () => {
    const p = parseLedgerPath("m/44'/8478'/2147483647'/0'");
    expect(p.account).toBe(0x7fffffff);
    expect(hex(encodeLedgerPath(p))).toBe('048000002C8000211EFFFFFFFF80000000');
  });

  it('is strict about syntax', () => {
    for (const bad of [
      "m/44h/8478h/0h/0h",
      "m/44'/8478'/00'/0'",
      "m/44'/8478'/2147483648'/0'",
      "m/44'/8478'/-1'/0'",
      "m//44'/8478'/0'",
      "M/44'/8478'/0'/0'",
      "m/44'/8478'/0''/0'",
      "m/44'/9999'/0'/0'",
      '',
    ]) {
      expect(isLedgerPath(bad), bad).toBe(false);
    }
    expect(isLedgerPath("44'/8478'/0'/0'")).toBe(true);
    expect(isLedgerPath(null)).toBe(false);
    expect(isLedgerPath(42)).toBe(false);
  });

  it('builds paths for an account at depth 3 and 4', () => {
    expect(ledgerPathForAccount(5).path).toBe("m/44'/8478'/5'/0'");
    expect(ledgerPathForAccount(5, 3).path).toBe("m/44'/8478'/5'");
    expect(() => ledgerPathForAccount(2 ** 31)).toThrow(PathRejectedError);
    expect(() => ledgerPathForAccount(-1)).toThrow(PathRejectedError);
    expect(() => ledgerPathForAccount(1.5)).toThrow(PathRejectedError);
  });

  it('formats per §4.4', () => {
    expect(formatLedgerPath([0x8000002c, 0x8000211e, 0x80000000, 0x80000000])).toBe(PATH0);
  });

  it('distinguishes length errors from policy errors when decoding', () => {
    expect(decodeLedgerPath(new Uint8Array(0))).toMatchObject({ ok: false, error: 'length' });
    expect(decodeLedgerPath(fromHex('048000002C8000211E80000000'))).toMatchObject({ ok: false, error: 'length' });
    expect(decodeLedgerPath(fromHex('FF'))).toMatchObject({ ok: false, error: 'length' });
    expect(decodeLedgerPath(fromHex('00'))).toMatchObject({ ok: false, error: 'policy' });
  });
});

describe('A.1 GET_VERSION / GET_APP_NAME / GET_APP_CONFIG', () => {
  it('encodes the requests', () => {
    expect(hex(serializeApdu(getVersionApdu()))).toBe('E003000000');
    expect(hex(serializeApdu(getAppNameApdu()))).toBe('E004000000');
    expect(hex(serializeApdu(getAppConfigApdu()))).toBe('E005000000');
  });

  it('decodes the responses', () => {
    expect(decodeVersionResponse(fromHex('010000'))).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(decodeAppNameResponse(fromHex('54687275'))).toBe('Thru');
    expect(decodeAppConfigResponse(fromHex('0101000001'))).toEqual({
      blindSigningEnabled: true,
      flags: 1,
      version: { major: 1, minor: 0, patch: 0 },
      apduProtocolVersion: 1,
    });
  });

  it('ignores reserved config flag bits', () => {
    expect(decodeAppConfigResponse(fromHex('FE01020301')).blindSigningEnabled).toBe(false);
  });

  it('rejects malformed responses', () => {
    expect(() => decodeVersionResponse(fromHex('0100'))).toThrow(ProtocolError);
    expect(() => decodeAppConfigResponse(fromHex('01010000'))).toThrow(ProtocolError);
    expect(() => decodeAppNameResponse(new Uint8Array(0))).toThrow(ProtocolError);
    expect(() => decodePubkeyResponse(new Uint8Array(31))).toThrow(ProtocolError);
    expect(() => decodeSignatureResponse(new Uint8Array(65))).toThrow(ProtocolError);
  });
});

describe('A.2 GET_PUBKEY', () => {
  it('encodes silent and display requests', () => {
    expect(hex(serializeApdu(getPubkeyApdu(PATH0, false)))).toBe(`E006000011${PATH0_ENC}`);
    expect(hex(serializeApdu(getPubkeyApdu(PATH0, true)))).toBe(`E006010011${PATH0_ENC}`);
  });

  it('decodes the A.2 pubkey and its ta… address', () => {
    const pk = decodePubkeyResponse(fromHex(KEY0.pubkey_hex));
    expect(toHex(pk)).toBe(KEY0.pubkey_hex);
    expect(encodeAddress(pk)).toBe(KEY0.address);
  });

  it('refuses the A.2 negative paths before contacting the device', () => {
    for (const enc of [
      '048000002C800001F58000000080000000',
      '038000002C8000211E00000000',
      '048000002C8000211E8000000080000001',
      '048000002C8000270F8000000080000000',
    ]) {
      expect(decodeLedgerPath(fromHex(enc))).toMatchObject({ ok: false, error: 'policy' });
    }
  });
});

describe('A.3 / A.4 SIGN_TXN', () => {
  const body = buildBody();

  it('builds the A.3 body byte for byte', () => {
    expect(toHex(body)).toBe(A3_BODY_HEX);
    expect(body.length).toBe(112);
  });

  it('encodes chunk 0 (path) and chunk 1 (last, 112 bytes)', () => {
    const apdus = signTxnApdus(PATH0, body).map((a) => hex(serializeApdu(a)));
    expect(apdus).toHaveLength(2);
    expect(apdus[0]).toBe(`E007008011${PATH0_ENC}`);
    expect(apdus[1]).toBe(`E007010070${A3_BODY_HEX.toUpperCase()}`);
  });

  it('chunks a 600-byte body as 255/255/90 (A.4)', () => {
    const big = new Uint8Array(600).map((_, i) => i & 0xff);
    const apdus = signTxnApdus(PATH0, big);
    expect(apdus.map((a) => [a.p1, a.p2, a.data.length])).toEqual([
      [0, 0x80, 17],
      [1, 0x80, 255],
      [2, 0x80, 255],
      [3, 0x00, 90],
    ]);
  });

  it('needs at most 129 data chunks for the largest body', () => {
    const apdus = signTxnApdus(PATH0, new Uint8Array(TXN_BODY_MAX));
    expect(apdus).toHaveLength(130);
    expect(apdus[129].p1).toBe(129);
    expect(apdus[129].p2).toBe(0);
  });

  it('snapshots the body', () => {
    const b = buildBody();
    const apdus = signTxnApdus(PATH0, b);
    b[0] = 0x99;
    expect(apdus[1].data[0]).toBe(1);
  });

  it('rejects empty and oversized bodies host-side', () => {
    expect(() => signTxnApdus(PATH0, new Uint8Array(0))).toThrow(InvalidRequestError);
    expect(() => signTxnApdus(PATH0, new Uint8Array(TXN_BODY_MAX + 1))).toThrow(InvalidRequestError);
    expect(() => signTxnApdus("m/44'/501'/0'/0'", body)).toThrow(PathRejectedError);
  });

  it('M = DST_TXN ‖ SHA-256(body); hash display is lowercase hex', () => {
    expect(computeBodyHashDisplay(body)).toBe(toHex(sha256(body)));
    expect(computeBodyHashDisplay(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renders the A.3 review', () => {
    const review = describeTransaction(body, PUBKEY0);
    expect(review.fields.map((f) => [f.label, f.value])).toEqual([
      ['Network', 'alphanet'],
      ['Fee payer', KEY0.address],
      ['Program', 'EOA / taEOApimkowJve0JG2gZqRXJj84GwzB9QmkNAJUFoxykj2'],
      ['Fee', '0.000001 THRU'],
      ['Nonce', '0'],
      ['Valid slots', '100 to 199'],
      ['Accounts', '0 read-write, 0 read-only'],
      ['Instruction data', '0 bytes'],
      ['Transaction hash', computeBodyHashDisplay(body)],
    ]);
    expect(review.highFee).toBe(false);
  });

  it('flags a high fee and saturates the expiry slot', () => {
    const review = describeTransaction(
      buildBody({ fee: 100_000_001n, startSlot: (1n << 64n) - 5n, expiryAfter: 100 }),
    );
    expect(review.highFee).toBe(true);
    /* Index 4 is the device's High fee field (A-035), so Valid slots is 6. */
    expect(review.fields[6]).toEqual({ label: 'Valid slots', value: '18446744073709551611 to 18446744073709551614' });
  });

  it.each([
    [0n, 0, 'none'],
    [100n, 0, 'none'],
    [100n, 1, '100 to 100'],
    [(1n << 64n) - 1n, 100, 'none'],
  ] as const)('shows the executable window for start %s and duration %s', (startSlot, expiryAfter, value) => {
    const review = describeTransaction(buildBody({ startSlot, expiryAfter }));
    expect(review.fields.find((field) => field.label === 'Valid slots')?.value).toBe(value);
  });

  it('shows no High fee field at exactly the threshold', () => {
    const review = describeTransaction(buildBody({ fee: 1_000_000n }));
    expect(review.highFee).toBe(false);
    expect(review.fields.map((f) => f.label)).not.toContain('High fee');
    expect(review.fields).toHaveLength(9);
  });
});

describe('A.5 SIGN_MESSAGE', () => {
  const hello = new TextEncoder().encode('hello');

  it('encodes chunk 0 and both passes', () => {
    const plan = signMessageApdus(PATH0, hello);
    expect(hex(serializeApdu(plan.header))).toBe(`E008008015${PATH0_ENC}00000005`);
    expect(plan.pass1.map((a) => hex(serializeApdu(a)))).toEqual(['E008010005' + '68656C6C6F']);
    expect(plan.pass2.map((a) => hex(serializeApdu(a)))).toEqual(['E008010005' + '68656C6C6F']);
  });

  it('restarts P1 at 1 for pass 2 with identical chunking', () => {
    const msg = new Uint8Array(600).fill(0x41);
    const plan = signMessageApdus(PATH0, msg);
    const shape = (cmds: readonly { p1: number; p2: number; data: Uint8Array }[]) =>
      cmds.map((c) => [c.p1, c.p2, c.data.length]);
    expect(shape(plan.pass1)).toEqual([
      [1, 0x80, 255],
      [2, 0x80, 255],
      [3, 0x00, 90],
    ]);
    expect(shape(plan.pass2)).toEqual(shape(plan.pass1));
    expect(toHex(plan.header.data.subarray(17))).toBe('00000258');
  });

  it('rejects empty and oversized messages', () => {
    expect(() => signMessageApdus(PATH0, new Uint8Array(0))).toThrow(InvalidRequestError);
    expect(() => signMessageApdus(PATH0, new Uint8Array(32769))).toThrow(InvalidRequestError);
    expect(() => signMessageApdus(PATH0, new Uint8Array(32768))).not.toThrow();
  });

  it('chooses text vs hash display mode (§8.7)', () => {
    expect(messageDisplayMode(hello)).toBe('text');
    expect(messageDisplayMode(asciiBytesForTest('a\nb'))).toBe('text');
    expect(messageDisplayMode(asciiBytesForTest('a\tb'))).toBe('hash');
    expect(messageDisplayMode(asciiBytesForTest('a\rb'))).toBe('hash');
    expect(messageDisplayMode(new Uint8Array(512).fill(0x41))).toBe('text');
    expect(messageDisplayMode(new Uint8Array(513).fill(0x41))).toBe('hash');
    expect(messageDisplayMode(new TextEncoder().encode('héllo'))).toBe('hash');
    const review = describeMessage(new Uint8Array([0xff]), PUBKEY0);
    expect(review.requiresBlindSigning).toBe(true);
    expect(review.fields.map((f) => f.label)).toEqual(['Sign message', 'Signer', 'Message hash', 'Length']);
    expect(review.messageHash).toBe(computeMessageHashDisplay(new Uint8Array([0xff])));
  });

  it.each([
    ['', 'hash'],
    [' ', 'hash'],
    [' a', 'hash'],
    ['a ', 'hash'],
    ['a  b', 'hash'],
    ['a \nb', 'hash'],
    ['a\n b', 'hash'],
    ['a b c d e', 'text'],
    ['a b c d e f', 'hash'],
    ['aa b c d e ff', 'hash'],
    ['ab cd e f g h', 'text'],
    ['a b c\n d e f', 'hash'],
    ['a b c\nd e f', 'text'],
    ['\n\n', 'text'],
    ['\n'.repeat(15), 'text'],
    ['\n'.repeat(16), 'hash'],
    ['\x7f', 'hash'],
    ['\0', 'hash'],
  ])('classifies %j as %s', (text, mode) => {
    const message = new TextEncoder().encode(text);
    expect(messageDisplayMode(message)).toBe(mode);
    expect(describeMessage(message, PUBKEY0).requiresBlindSigning).toBe(mode === 'hash');
  });

  it('labels every line including leading, consecutive and trailing LFs', () => {
    expect(describeMessage(asciiBytesForTest('\nhello\n\nworld\n'), PUBKEY0).fields.slice(2)).toEqual([
      { label: 'Line 1 (empty)', value: '' },
      { label: 'Line 2', value: 'hello' },
      { label: 'Line 3 (empty)', value: '' },
      { label: 'Line 4', value: 'world' },
      { label: 'Line 5 (empty)', value: '' },
    ]);
    expect(describeMessage(hello, PUBKEY0).fields[2]).toEqual({ label: 'Message', value: 'hello' });
  });
});

describe('A.6 SIGN_EOA_AUTH', () => {
  it('encodes the request byte for byte (Lc = 0x54)', () => {
    const apdu = signEoaAuthApdu(PATH0, 'create', 1, PUBKEY1, PUBKEY0);
    expect(hex(serializeApdu(apdu))).toBe(
      'E009000054' + PATH0_ENC + '00' + '0100' + toHex(PUBKEY1).toUpperCase() + toHex(PUBKEY0).toUpperCase(),
    );
    expect(apdu.data.length).toBe(84);
    const depth3 = signEoaAuthApdu("m/44'/8478'/0'", 'delete', 2, PUBKEY1, PUBKEY0);
    expect(depth3.data.length).toBe(80);
    expect(depth3.data[13]).toBe(1);
  });

  it('the 82-byte M equals the SDK builder and the A.6 listing', () => {
    const m = eoa.buildEOACreateMessage(1, PUBKEY1, PUBKEY0);
    expect(hex(m)).toBe(
      '746E5F656F615F6372656174655F7631' + '0100' + toHex(PUBKEY1).toUpperCase() + toHex(PUBKEY0).toUpperCase(),
    );
  });

  it('validates arguments host-side', () => {
    expect(() => signEoaAuthApdu(PATH0, 'create', 0, PUBKEY1, PUBKEY0)).toThrow(InvalidRequestError);
    expect(() => signEoaAuthApdu(PATH0, 'create', 65536, PUBKEY1, PUBKEY0)).toThrow(InvalidRequestError);
    expect(() => signEoaAuthApdu(PATH0, 2 as never, 1, PUBKEY1, PUBKEY0)).toThrow(InvalidRequestError);
    expect(() => signEoaAuthApdu(PATH0, 'create', 1, new Uint8Array(31), PUBKEY0)).toThrow(InvalidRequestError);
  });

  it('renders the §9.4 review', () => {
    expect(describeEoaAuth('create', 1, PUBKEY1, PUBKEY0).map((f) => f.value)).toEqual([
      'Authorize account creation',
      'alphanet',
      encodeAddress(PUBKEY0),
      encodeAddress(PUBKEY1),
    ]);
  });
});

describe('Appendix B formats', () => {
  it.each([
    [0n, '0 THRU'],
    [1n, '0.000000001 THRU'],
    [1000n, '0.000001 THRU'],
    [1000000n, '0.001 THRU'],
    [1500000000n, '1.5 THRU'],
    [18446744073709551615n, '18446744073.709551615 THRU'],
  ])('B.2 formats %s base units', (v, s) => {
    expect(formatThruAmount(v)).toBe(s);
  });

  it.each([
    [250000n, 6, '0.25'],
    [1500000n, 6, '1.5'],
    [7n, 0, '7'],
    [1000n, 3, '1'],
    [1n, 0, '1'],
    [18446744073709551615n, 19, '1.8446744073709551615'],
  ])('B.7 formats %s base units with %s decimals, without the ticker', (v, decimals, s) => {
    expect(formatTokenAmount(v, { decimals })).toBe(s);
  });

  it('formatAmount takes 0 to 19 decimals', () => {
    expect(formatAmount(5n, 19)).toBe('0.0000000000000000005');
    expect(() => formatAmount(5n, 20)).toThrow(RangeError);
    expect(() => formatAmount(-1n, 6)).toThrow(RangeError);
  });

  it('B.3 network labels', () => {
    expect(networkLabel(1)).toBe('alphanet');
    expect(networkLabel(2)).toBe('betanet');
    expect(networkLabel(7)).toBe('chain id 7');
  });

  it('B.5 table is internally consistent and matches the SDK program addresses', () => {
    for (const p of KNOWN_PROGRAMS) {
      expect(encodeAddress(p.bytes)).toBe(p.address);
      expect(knownProgramLabel(p.bytes)).toBe(p.label);
    }
    const sdk: Record<string, string> = {
      EOA: EOA_PROGRAM_ID,
      Token: TOKEN_PROGRAM_ADDRESS,
      Multicall: MULTICALL_PROGRAM_ADDRESS,
      Wallet: WALLET_PROGRAM_ADDRESS,
      Compression: COMPRESSION_PROGRAM_ADDRESS,
    };
    for (const p of KNOWN_PROGRAMS) {
      expect(toHex(decodeAddress(sdk[p.label]))).toBe(toHex(p.bytes));
    }
    expect(knownProgramLabel(PUBKEY0)).toBeNull();
  });

  it('chunkBytes never emits empty chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
    expect(chunkBytes(new Uint8Array(255)).map((c) => c.length)).toEqual([255]);
    expect(chunkBytes(new Uint8Array(256)).map((c) => c.length)).toEqual([255, 1]);
    expect(() => chunkBytes(new Uint8Array(1), APDU_MAX_DATA + 1)).toThrow();
  });

  it('status-word constants match Appendix C', () => {
    expect(StatusWord.BLIND_SIGNING_DISABLED).toBe(0x6808);
    expect(StatusWord.FEE_PAYER_MISMATCH).toBe(0x6810);
    expect(StatusWord.PATH_REJECTED).toBe(0x6820);
    expect(StatusWord.OS_DEVICE_LOCKED).toBe(0x5515);
  });
});
