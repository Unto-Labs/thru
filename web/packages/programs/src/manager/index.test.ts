import { describe, expect, it } from 'vitest';
import {
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
      'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE'
    );
    expect(deriveManagedProgramAddresses('nft')).toMatchObject({
      programMetaAccountAddress:
        'ta00Efqv-BVcX3MsYbqO9JN2arQVJEMg3xqQF2iy0H1TGV',
      programAccountAddress:
        'taAFaJ4ctkbuhYBl2FX6tmXGJZQgShIXt6TPrMw4-GOsv4',
    });
  });

  it('encodes ephemeral create exactly', () => {
    const encoded = buildManagerInstructionBytes({
      kind: 'createEphemeral',
      metaAccountIdx: 1,
      programAccountIdx: 2,
      sourceBufferAccountIdx: 3,
      sourceOffset: 4,
      sourceSize: 5,
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
      authorityAccountIdx: 4,
      seed: 'x',
      metaStateProof: metaProof,
      programStateProof: programProof,
    });
    expect(encoded[0]).toBe(0);
    expect(encoded.length).toBe(1 + 20 + 1 + metaProof.length + programProof.length);
  });

  it('parses metadata and rejects unknown states', () => {
    const data = new Uint8Array(73);
    data.fill(1, 0, 32);
    data.fill(2, 32, 64);
    new DataView(data.buffer).setBigUint64(64, 9n, true);
    data[72] = MANAGER_STATE_OPEN;
    expect(parseManagerProgramMeta(data)).toMatchObject({
      version: 9n,
      state: MANAGER_STATE_OPEN,
    });
    data[72] = 9;
    expect(() => parseManagerProgramMeta(data)).toThrow('invalid state');
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
