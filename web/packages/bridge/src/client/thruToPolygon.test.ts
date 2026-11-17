import { describe, expect, it, vi } from 'vitest';

/* The decoders do not use program resources; stub the import so the test
   does not need a built @thru/programs. */
vi.mock('@thru/programs/resources', () => ({ programResources: () => ({}) }));

import {
  BRIDGE_ACCOUNT_SIZE,
  BRIDGE_MINT_METADATA_SIZE,
  THRU_TOKEN_ACCOUNT_SIZE,
  parseThruBridgeFeeCollector,
  parseThruBridgeMintMetadata,
  parseThruTokenAccount,
} from './thruToPolygon';

function writeU64LE(out: Uint8Array, offset: number, value: bigint) {
  new DataView(out.buffer, out.byteOffset).setBigUint64(offset, value, true);
}

describe('bridge mint metadata decoding', () => {
  function metadata(accountType: number) {
    const data = new Uint8Array(BRIDGE_MINT_METADATA_SIZE);
    data[0] = accountType;
    data[1] = 137; /* origin_chain_id = 137 */
    data.fill(0xab, 3);
    return data;
  }

  it('reads the origin after the discriminator', () => {
    const parsed = parseThruBridgeMintMetadata(metadata(3));
    expect(parsed.originChainId).toBe(137);
    expect(parsed.originTokenBytes).toEqual(new Uint8Array(32).fill(0xab));
  });

  it('rejects other discriminators and sizes', () => {
    expect(() => parseThruBridgeMintMetadata(metadata(0))).toThrow();
    expect(() => parseThruBridgeMintMetadata(metadata(2))).toThrow();
    expect(() => parseThruBridgeMintMetadata(metadata(3).slice(1))).toThrow();
    expect(() => parseThruBridgeMintMetadata(undefined)).toThrow();
  });
});

describe('bridge account fee collector decoding', () => {
  /* sizeof(tn_bridge_account_t); fee_collector sits after fee bps */
  const feeCollectorOffset = 1 + 55 + 256 * 90 + 4;

  function bridgeAccount(accountType: number, collector: number) {
    const data = new Uint8Array(BRIDGE_ACCOUNT_SIZE);
    data[0] = accountType;
    data.fill(collector, feeCollectorOffset, feeCollectorOffset + 32);
    return data;
  }

  it('matches the C layout size', () => {
    expect(BRIDGE_ACCOUNT_SIZE).toBe(23196);
  });

  it('reads the fee collector', () => {
    expect(parseThruBridgeFeeCollector(bridgeAccount(2, 7))).toEqual(new Uint8Array(32).fill(7));
  });

  it('rejects other discriminators, sizes and an unset collector', () => {
    expect(() => parseThruBridgeFeeCollector(bridgeAccount(3, 7))).toThrow();
    expect(() => parseThruBridgeFeeCollector(bridgeAccount(2, 7).slice(0, BRIDGE_ACCOUNT_SIZE - 64))).toThrow();
    expect(() => parseThruBridgeFeeCollector(bridgeAccount(2, 0))).toThrow(/not configured/);
  });
});

describe('token account decoding', () => {
  function tokenAccount(accountType: number) {
    const data = new Uint8Array(THRU_TOKEN_ACCOUNT_SIZE);
    data[0] = accountType;
    data.fill(1, 1, 33);
    data.fill(2, 33, 65);
    writeU64LE(data, 65, 1234n);
    return data;
  }

  it('reads mint, owner and amount after the discriminator', () => {
    const parsed = parseThruTokenAccount(tokenAccount(2));
    expect(parsed.mintBytes).toEqual(new Uint8Array(32).fill(1));
    expect(parsed.ownerBytes).toEqual(new Uint8Array(32).fill(2));
    expect(parsed.amount).toBe(1234n);
  });

  it('rejects a mint account and other sizes', () => {
    expect(() => parseThruTokenAccount(tokenAccount(1))).toThrow();
    expect(() => parseThruTokenAccount(tokenAccount(2).slice(1))).toThrow();
  });
});
