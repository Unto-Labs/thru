import { describe, expect, it } from 'vitest';
import {
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
  it('matches official and external derivation vectors', () => {
    const programAddress =
      'taAFaJ4ctkbuhYBl2FX6tmXGJZQgShIXt6TPrMw4-GOsv4';
    expect(deriveOfficialABIAddresses(programAddress)).toMatchObject({
      abiMetaAccountAddress:
        'taTRXKKLkeKvK_XMkdqbMzcqR0cUY20PBwaluN8UKvkkGF',
      abiAccountAddress:
        'takDA1V6UYKs86PsY7tQjlGOeFkQhmaVCehzy1TylM0ufs',
    });
    const seed = hashExternalABISeed('publisher-seed');
    const external = deriveExternalABIAddresses(
      programAddress,
      programAddress,
      seed
    );
    expect(external.abiMetaAccountAddress).not.toBe(
      deriveOfficialABIAddresses(programAddress).abiMetaAccountAddress
    );
    expect(seed).toHaveLength(32);
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
    const abiOfficial = {
      ...commonOfficial,
      abiAccountIdx: 4,
      sourceBufferAccountIdx: 5,
      sourceSize: 6,
    };
    const abiExternal = {
      abiMetaAccountIdx: 1,
      abiAccountIdx: 4,
      sourceBufferAccountIdx: 5,
      sourceSize: 6,
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
  });

  it('parses official and external metadata', () => {
    const official = new Uint8Array(100);
    official[0] = 1;
    official[1] = ABI_META_KIND_OFFICIAL;
    official.fill(3, 4, 36);
    expect(parseABIMetaAccount(official)).toMatchObject({
      kind: 'official',
      version: 1,
    });

    const external = new Uint8Array(100);
    external[0] = 1;
    external[1] = ABI_META_KIND_EXTERNAL;
    external.fill(1, 4, 36);
    external.fill(2, 36, 68);
    external.fill(3, 68, 100);
    expect(parseABIMetaAccount(external)).toMatchObject({
      kind: 'external',
      seed: new Uint8Array(32).fill(3),
    });
  });

  it('parses ABI contents and rejects inconsistent sizes', () => {
    const data = new Uint8Array(48);
    data.fill(4, 0, 32);
    const view = new DataView(data.buffer);
    view.setBigUint64(32, 7n, true);
    data[40] = ABI_STATE_OPEN;
    view.setUint32(41, 3, true);
    data.set([1, 2, 3], 45);
    expect(parseABIAccount(data)).toMatchObject({
      revision: 7n,
      contents: Uint8Array.of(1, 2, 3),
    });
    view.setUint32(41, 4, true);
    expect(() => parseABIAccount(data)).toThrow('content length');
  });

  it('decodes reason and component fields', () => {
    expect(decodeABIManagerError(0x0506)).toMatchObject({
      reason: 'INVALID_AUTHORITY',
      component: 'ABI_META',
    });
  });
});
