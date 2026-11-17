import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeAddress } from '@thru/sdk/helpers';
import { createValidateChallenge } from './challenge';
import { parseCredentialLookupWallet, parseWalletAuthorities, parseWalletNonce } from './accounts';
import {
  LONG_LIVED_AUTHORITY_EXPIRY_SECONDS,
  WALLET_ACCOUNT_TYPE_CREDENTIAL_LOOKUP_V1,
  WALLET_ACCOUNT_TYPE_WALLET_V1,
} from './constants';
import { encodeAddAuthorityInstruction } from './instructions/add-authority';
import {
  buildAuthorityRecord,
  createAuthorityRecord,
  createSessionAuthorityRecord,
} from './instructions/create';
import { encodeRemoveAuthorityInstruction } from './instructions/remove-authority';
import { encodeValidateInstruction } from './instructions/validate';
import {
  buildMulticallInstruction,
} from '../multicall';
import {
  InstructionData,
  InstructionDataBuilder,
} from './abi/thru/common/primitives/types';

function bytes(value: number, len: number): Uint8Array {
  return new Uint8Array(len).fill(value);
}

function u16le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function buildInstructionDataFixture(
  programIdx: number,
  instructionData: Uint8Array
): Uint8Array {
  const builder = new InstructionDataBuilder();
  builder.set_program_idx(programIdx);
  builder.data().write(instructionData).finish();
  return builder.build();
}

describe('Wallet Program validate helpers', () => {
  it('creates the validate challenge preimage', async () => {
    const accountAddresses = [
      encodeAddress(bytes(0x01, 32)),
      encodeAddress(bytes(0x02, 32)),
      encodeAddress(bytes(0x03, 32)),
    ];
    const programIdx = 9;
    const instructionData = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const targetInstructionBytes = buildInstructionDataFixture(programIdx, instructionData);
    const text = new TextEncoder();

    const expectedPreimage = concat([
      text.encode('thru.passkey.validate'),
      u64le(9n),
      u16le(4),
      new Uint8Array([2]),
      u16le(accountAddresses.length),
      ...accountAddresses.map((address) => text.encode(address)),
      targetInstructionBytes,
    ]);
    const expected = new Uint8Array(
      createHash('sha256').update(expectedPreimage).digest()
    );

    await expect(
      createValidateChallenge(
        9n,
        accountAddresses,
        4,
        2,
        {
          programIdx,
          instructionData,
        }
      )
    ).resolves.toEqual(expected);
  });

  it('encodes VALIDATE with a well-known InstructionData target', () => {
    const programIdx = 0x0706;
    const instructionData = new Uint8Array([0xaa, 0xbb]);
    const authenticatorData = new Uint8Array([0xcc]);
    const clientDataJSON = new Uint8Array([0xdd, 0xee]);

    const encoded = encodeValidateInstruction({
      walletAccountIdx: 0x1234,
      authIdx: 5,
      targetInstruction: {
        programIdx,
        instructionData,
      },
      signatureR: bytes(0x11, 32),
      signatureS: bytes(0x22, 32),
      authenticatorData,
      clientDataJSON,
    });

    expect(encoded[0]).toBe(0x01);
    expect(encoded.slice(1, 3)).toEqual(u16le(0x1234));
    expect(encoded[3]).toBe(5);
    expect(encoded.slice(4, 36)).toEqual(bytes(0x11, 32));
    expect(encoded.slice(36, 68)).toEqual(bytes(0x22, 32));
    expect(encoded.slice(68, 70)).toEqual(u16le(authenticatorData.length));
    expect(encoded.slice(70, 72)).toEqual(u16le(clientDataJSON.length));
    expect(encoded.slice(72, 73)).toEqual(authenticatorData);
    expect(encoded.slice(73, 75)).toEqual(clientDataJSON);
    const targetInstructionBytes = encoded.slice(75);
    expect(targetInstructionBytes).toEqual(
      buildInstructionDataFixture(programIdx, instructionData)
    );
    const targetInstructionView = InstructionData.from_array(targetInstructionBytes);
    expect(targetInstructionView?.get_program_idx()).toBe(programIdx);
    expect(targetInstructionView?.get_data()).toEqual(Array.from(instructionData));
    expect(encoded.length).toBe(87);
  });

  it('encodes wallet indexes in add/remove authority instructions', () => {
    const add = encodeAddAuthorityInstruction({
      walletAccountIdx: 0x1234,
      authorityRecord: createAuthorityRecord({
        tag: 1,
        pubkeyX: bytes(0x01, 32),
        pubkeyY: bytes(0x02, 32),
      }),
    });
    expect(add[0]).toBe(0x04);
    expect(add.slice(1, 3)).toEqual(u16le(0x1234));
    expect(add[3]).toBe(1);
    expect(add.slice(68, 76)).toEqual(u64le(LONG_LIVED_AUTHORITY_EXPIRY_SECONDS));
    expect(add.length).toBe(76);

    const remove = encodeRemoveAuthorityInstruction({
      walletAccountIdx: 0x1234,
      authIdx: 9,
    });
    expect(remove).toEqual(new Uint8Array([0x05, 0x34, 0x12, 0x09]));
  });

  it('encodes and parses authority records with expiry seconds', () => {
    const passkeyRecord = createAuthorityRecord({
      tag: 1,
      pubkeyX: bytes(0x01, 32),
      pubkeyY: bytes(0x02, 32),
    });
    const sessionRecord = createSessionAuthorityRecord({
      pubkey: bytes(0x03, 32),
      expiresAtBlockTimeSeconds: 1234n,
    });

    const encodedSession = buildAuthorityRecord(sessionRecord);
    expect(encodedSession.length).toBe(73);
    expect(encodedSession[0]).toBe(2);
    expect(encodedSession.slice(1, 33)).toEqual(bytes(0x03, 32));
    expect(encodedSession.slice(33, 65)).toEqual(bytes(0x00, 32));
    expect(encodedSession.slice(65, 73)).toEqual(u64le(1234n));

    const walletData = concat([
      new Uint8Array([WALLET_ACCOUNT_TYPE_WALLET_V1]),
      new Uint8Array([1]),
      u64le(9n),
      buildAuthorityRecord(passkeyRecord),
      encodedSession,
    ]);
    expect(walletData.length).toBe(10 + 2 * 73);
    expect(parseWalletNonce(walletData)).toBe(9n);
    const parsed = parseWalletAuthorities(walletData);
    expect(parsed.nonce).toBe(9n);
    expect(parsed.authorities).toHaveLength(2);
    expect(parsed.authorities[0]?.expiresAtBlockTimeSeconds).toBe(
      LONG_LIVED_AUTHORITY_EXPIRY_SECONDS
    );
    expect(parsed.authorities[1]).toMatchObject({
      idx: 1,
      kind: 'pubkey',
      expiresAtBlockTimeSeconds: 1234n,
    });

    /* Trailing bytes after the last record are accepted, as on chain. */
    expect(parseWalletAuthorities(concat([walletData, new Uint8Array(3)])).nonce).toBe(9n);
    expect(() => parseWalletAuthorities(walletData.subarray(0, walletData.length - 1))).toThrow(
      'not a wallet account'
    );
    const lookupTagged = Uint8Array.from(walletData);
    lookupTagged[0] = WALLET_ACCOUNT_TYPE_CREDENTIAL_LOOKUP_V1;
    expect(() => parseWalletAuthorities(lookupTagged)).toThrow('not a wallet account');
    expect(() => parseWalletNonce(walletData.subarray(1))).toThrow('not a wallet account');
    expect(parseCredentialLookupWallet(walletData)).toBeNull();
  });

  it('parses credential lookups and rejects other account types', () => {
    const lookup = concat([new Uint8Array([WALLET_ACCOUNT_TYPE_CREDENTIAL_LOOKUP_V1]), bytes(0x07, 32)]);
    expect(lookup.length).toBe(33);
    expect(parseCredentialLookupWallet(lookup)).toEqual(bytes(0x07, 32));
    expect(parseCredentialLookupWallet(lookup.subarray(1))).toBeNull();
    expect(parseCredentialLookupWallet(concat([lookup, new Uint8Array(1)]))).toBeNull();
    const walletTagged = Uint8Array.from(lookup);
    walletTagged[0] = WALLET_ACCOUNT_TYPE_WALLET_V1;
    expect(parseCredentialLookupWallet(walletTagged)).toBeNull();
  });

  it('bounds authority record expiry seconds to u64', () => {
    const u64Max = 0xffffffffffffffffn;
    const pubkey = bytes(0x03, 32);

    expect(() =>
      buildAuthorityRecord(
        createSessionAuthorityRecord({
          pubkey,
          expiresAtBlockTimeSeconds: u64Max,
        })
      )
    ).not.toThrow();

    expect(() =>
      buildAuthorityRecord(
        createSessionAuthorityRecord({
          pubkey,
          expiresAtBlockTimeSeconds: u64Max + 1n,
        })
      )
    ).toThrow('expiresAtBlockTimeSeconds must fit in u64');
  });

  it('encodes multicall instructions with distinct child payloads', () => {
    const encoded = buildMulticallInstruction([
      { programIdx: 2, instructionData: new Uint8Array([0xaa]) },
      { programIdx: 5, instructionData: new Uint8Array([0xbb, 0xcc]) },
    ]);

    expect(encoded).toEqual(
      new Uint8Array([
        0x02, 0x00,
        0x02, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xaa,
        0x05, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xbb, 0xcc,
      ])
    );
  });
});
