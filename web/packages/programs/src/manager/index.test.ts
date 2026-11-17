import { describe, expect, it } from 'vitest';
import {
  MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1,
  MANAGER_META_SIZE,
  MANAGER_PROGRAM_ADDRESS,
  MANAGER_STATE_OPEN,
  buildManagerInstructionBytes,
  decodeManagerError,
  deriveManagedProgramAddresses,
  parseManagerProgramMeta,
  validateManagerProgramImage,
} from './index';
import { StateProof } from './abi/thru/blockchain/state_proof/types';

function creationProof(siblingCount = 0): Uint8Array {
  const proof = new Uint8Array(40 + 64 + siblingCount * 32);
  new DataView(proof.buffer).setBigUint64(0, 2n << 62n, true);
  for (let index = 0; index < siblingCount; index++) {
    proof[8 + Math.floor(index / 8)] |= 1 << (index % 8);
  }
  const validation = StateProof.validate(proof);
  expect(validation.ok).toBe(true);
  expect(validation.consumed).toBe(proof.length);
  return proof;
}

describe('manager SDK', () => {
  it('exports the canonical manager ID and Rust-compatible derivation vectors', () => {
    expect(MANAGER_PROGRAM_ADDRESS).toBe(
      'taMGRmPoSTkUtF6UlmCIq58K8OYsnXshOMPdobxxHytqmu'
    );
    expect(deriveManagedProgramAddresses('nft')).toMatchObject({
      programMetaAccountAddress:
        'taJM9c0C5t2kaaNv_PyeVn6khHuwc-zeN39MUTW_yghOBU',
      programAccountAddress:
        'tak_0Jtlh0y2hPHscfXkS1eXuEpPUB35xh5KqT5A2fR2ZE',
    });
  });

  const digest = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);

  it('encodes ephemeral create exactly', () => {
    const encoded = buildManagerInstructionBytes({
      kind: 'createEphemeral',
      metaAccountIdx: 1,
      programAccountIdx: 2,
      sourceBufferAccountIdx: 3,
      sourceOffset: 4,
      sourceSize: 5,
      sourceSha256: digest,
      authorityAccountIdx: 6,
      seed: Uint8Array.of(7, 8, 9),
    });
    expect(Array.from(encoded)).toEqual([
      1,
      1, 0,
      2, 0,
      3, 0,
      4, 0, 0, 0,
      5, 0, 0, 0,
      ...digest,
      6, 0,
      3, 0, 0, 0,
      7, 8, 9,
    ]);
  });

  it('supports independently sized permanent-create proofs', () => {
    const metaProof = creationProof();
    const programProof = creationProof(1);
    const encoded = buildManagerInstructionBytes({
      kind: 'createPermanent',
      metaAccountIdx: 1,
      programAccountIdx: 2,
      sourceBufferAccountIdx: 3,
      sourceSize: 10,
      sourceSha256: digest,
      authorityAccountIdx: 4,
      seed: 'x',
      metaStateProof: metaProof,
      programStateProof: programProof,
    });
    expect(encoded[0]).toBe(0);
    expect(encoded.length).toBe(1 + 52 + 1 + metaProof.length + programProof.length);
    expect(Array.from(encoded.slice(15, 47))).toEqual(Array.from(digest));
  });

  it('commits the upgrade to the source digest', () => {
    const encoded = buildManagerInstructionBytes({
      kind: 'upgrade',
      metaAccountIdx: 1,
      programAccountIdx: 2,
      sourceBufferAccountIdx: 3,
      sourceSize: 10,
      sourceSha256: digest,
    });
    expect(encoded.length).toBe(47);
    expect(encoded[0]).toBe(2);
    expect(Array.from(encoded.slice(15, 47))).toEqual(Array.from(digest));
    expect(() =>
      buildManagerInstructionBytes({
        kind: 'upgrade',
        metaAccountIdx: 1,
        programAccountIdx: 2,
        sourceBufferAccountIdx: 3,
        sourceSize: 10,
        sourceSha256: new Uint8Array(31),
      })
    ).toThrow();
  });

  it('parses metadata and rejects unknown states', () => {
    const data = new Uint8Array(MANAGER_META_SIZE);
    data[0] = MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1;
    data.fill(1, 1, 33);
    data.fill(2, 33, 65);
    new DataView(data.buffer).setBigUint64(65, 9n, true);
    data[73] = MANAGER_STATE_OPEN;
    expect(parseManagerProgramMeta(data)).toMatchObject({
      version: 9n,
      state: MANAGER_STATE_OPEN,
    });
    data[73] = 9;
    expect(() => parseManagerProgramMeta(data)).toThrow('invalid state');
    data[73] = MANAGER_STATE_OPEN;
    data[0] = 2;
    expect(() => parseManagerProgramMeta(data)).toThrow('not a manager program metadata account');
    data[0] = MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1;
    expect(() => parseManagerProgramMeta(data.subarray(0, 73))).toThrow(
      'not a manager program metadata account'
    );
  });

  it('validates managed program images', () => {
    const valid = new Uint8Array(20);
    valid[0] = 1;
    expect(() => validateManagerProgramImage(valid)).not.toThrow();
    valid[19] = 1;
    expect(() => validateManagerProgramImage(valid)).toThrow('zero trailer');
  });

  it('decodes composite manager errors', () => {
    expect(decodeManagerError(0x0306)).toMatchObject({
      type: 'AUTHORIZATION_ERROR',
      object: 'AUTHORITY_ACCOUNT',
    });
  });
});
