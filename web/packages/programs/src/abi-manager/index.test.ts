import { describe, expect, it } from 'vitest';
import {
  ABI_ACCOUNT_TYPE_CONTENT_V1,
  ABI_ACCOUNT_TYPE_META_V1,
  ABI_META_KIND_EXTERNAL,
  ABI_META_KIND_OFFICIAL,
  ABI_STATE_OPEN,
  buildABIManagerInstructionBytes,
  decodeABIManagerError,
  deriveExternalABIAddresses,
  deriveOfficialABIAddresses,
  hashExternalABISeed,
  parseABIAccount,
  parseABIMetaAccount,
  type ABIManagerInstructionArgs,
} from './index';

function creationProof(): Uint8Array {
  const proof = new Uint8Array(104);
  new DataView(proof.buffer).setBigUint64(0, 2n << 62n, true);
  return proof;
}

describe('ABI-manager SDK', () => {
  it('separates official and external publication namespaces', () => {
    const programAddress =
      'taAFaJ4ctkbuhYBl2FX6tmXGJZQgShIXt6TPrMw4-GOsv4';
    const seed = hashExternalABISeed('publisher-seed');
    const external = deriveExternalABIAddresses(
      programAddress,
      programAddress,
      seed
    );
    expect(external.abiMetaAccountAddress).not.toBe(
      deriveOfficialABIAddresses(programAddress).abiMetaAccountAddress
    );
  });

  it('encodes all fourteen discriminants', () => {
    const proof = creationProof();
    const key = new Uint8Array(32).fill(7);
    const commonOfficial = {
      abiMetaAccountIdx: 1,
      programMetaAccountIdx: 2,
      authorityAccountIdx: 3,
    };
    const commonExternal = {
      abiMetaAccountIdx: 1,
      authorityAccountIdx: 3,
      targetProgram: key,
      seed: key,
    };
    const digest = Uint8Array.from({ length: 32 }, (_, i) => 0xb0 + i);
    const abiOfficial = {
      ...commonOfficial,
      abiAccountIdx: 4,
      sourceBufferAccountIdx: 5,
      sourceSize: 6,
      sourceSha256: digest,
    };
    const abiExternal = {
      abiMetaAccountIdx: 1,
      abiAccountIdx: 4,
      sourceBufferAccountIdx: 5,
      sourceSize: 6,
      sourceSha256: digest,
      authorityAccountIdx: 3,
    };
    const cases: Array<[ABIManagerInstructionArgs, number]> = [
      [{ kind: 'createMetaOfficialPermanent', ...commonOfficial, stateProof: proof }, 0],
      [{ kind: 'createMetaOfficialEphemeral', ...commonOfficial }, 1],
      [{ kind: 'createMetaExternalPermanent', ...commonExternal, stateProof: proof }, 2],
      [{ kind: 'createMetaExternalEphemeral', ...commonExternal }, 3],
      [{ kind: 'createABIOfficialPermanent', ...abiOfficial, stateProof: proof }, 4],
      [{ kind: 'createABIOfficialEphemeral', ...abiOfficial }, 5],
      [{ kind: 'createABIExternalPermanent', ...abiExternal, stateProof: proof }, 6],
      [{ kind: 'createABIExternalEphemeral', ...abiExternal }, 7],
      [{ kind: 'upgradeABIOfficial', ...abiOfficial }, 8],
      [{ kind: 'upgradeABIExternal', ...abiExternal }, 9],
      [{ kind: 'closeABIOfficial', ...commonOfficial, abiAccountIdx: 4 }, 10],
      [{ kind: 'closeABIExternal', abiMetaAccountIdx: 1, abiAccountIdx: 4, authorityAccountIdx: 3 }, 11],
      [{ kind: 'finalizeABIOfficial', ...commonOfficial, abiAccountIdx: 4 }, 12],
      [{ kind: 'finalizeABIExternal', abiMetaAccountIdx: 1, abiAccountIdx: 4, authorityAccountIdx: 3 }, 13],
    ];
    for (const [args, discriminant] of cases) {
      expect(buildABIManagerInstructionBytes(args)[0]).toBe(discriminant);
    }
    /* Official Public-wire content commits to its SHA-256 right after
       srcbuf_size: tag(1) + 3 idx(6) + srcbuf idx(2) + offset(4) + size(4). */
    for (const kind of ['createABIOfficialEphemeral', 'upgradeABIOfficial'] as const) {
      const encoded = buildABIManagerInstructionBytes({ kind, ...abiOfficial });
      expect(encoded.length).toBe(51);
      expect(Array.from(encoded.slice(17, 49))).toEqual(Array.from(digest));
    }
    /* External content commits to its SHA-256 the same way: tag(1) + 2 idx(4)
       + srcbuf idx(2) + offset(4) + size(4), then authority idx(2). */
    for (const kind of ['createABIExternalEphemeral', 'upgradeABIExternal'] as const) {
      const encoded = buildABIManagerInstructionBytes({ kind, ...abiExternal });
      expect(encoded.length).toBe(49);
      expect(Array.from(encoded.slice(15, 47))).toEqual(Array.from(digest));
    }
    expect(() => buildABIManagerInstructionBytes({ kind: 'upgradeABIExternal', ...abiExternal, sourceSha256: new Uint8Array(31) })).toThrow('sourceSha256');
  });

  it('parses official and external metadata', () => {
    const official = new Uint8Array(100);
    official[0] = ABI_ACCOUNT_TYPE_META_V1;
    official[1] = ABI_META_KIND_OFFICIAL;
    official.fill(3, 4, 36);
    expect(parseABIMetaAccount(official)).toMatchObject({
      kind: 'official',
    });

    const external = new Uint8Array(100);
    external[0] = ABI_ACCOUNT_TYPE_META_V1;
    external[1] = ABI_META_KIND_EXTERNAL;
    external.fill(1, 4, 36);
    external.fill(2, 36, 68);
    external.fill(3, 68, 100);
    expect(parseABIMetaAccount(external)).toMatchObject({
      kind: 'external',
      seed: new Uint8Array(32).fill(3),
    });

    external[0] = ABI_ACCOUNT_TYPE_CONTENT_V1;
    expect(() => parseABIMetaAccount(external)).toThrow('not an ABI metadata account');
    expect(() => parseABIMetaAccount(new Uint8Array(100))).toThrow('not an ABI metadata account');
    expect(() => parseABIMetaAccount(official.subarray(0, 99))).toThrow('not an ABI metadata account');
  });

  it('parses ABI contents and rejects inconsistent sizes', () => {
    const data = new Uint8Array(49);
    data[0] = ABI_ACCOUNT_TYPE_CONTENT_V1;
    data.fill(4, 1, 33);
    const view = new DataView(data.buffer);
    view.setBigUint64(33, 7n, true);
    data[41] = ABI_STATE_OPEN;
    view.setUint32(42, 3, true);
    data.set([1, 2, 3], 46);
    expect(parseABIAccount(data)).toMatchObject({
      revision: 7n,
      contents: Uint8Array.of(1, 2, 3),
    });
    data[0] = ABI_ACCOUNT_TYPE_META_V1;
    expect(() => parseABIAccount(data)).toThrow('not an ABI content account');
    data[0] = ABI_ACCOUNT_TYPE_CONTENT_V1;
    view.setUint32(42, 2, true);
    expect(() => parseABIAccount(data)).toThrow('content length');
    view.setUint32(42, 4, true);
    expect(() => parseABIAccount(data)).toThrow();
  });

  it('decodes reason and component fields', () => {
    expect(decodeABIManagerError(0x0506)).toMatchObject({
      reason: 'INVALID_AUTHORITY',
      component: 'ABI_META',
    });
  });
});
