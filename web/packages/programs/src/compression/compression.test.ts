import { describe, expect, it } from "vitest";
import { Pubkey } from "@thru/sdk";
import { buildCompressInstruction, buildDecompressInstruction, buildCompressFromPointerInstruction,
  buildDecompressFromPointerInstruction, validateCompressionProof } from "./index";

function proof(type: number, siblings = 0) {
  const bytes = new Uint8Array(40 + (type === 1 ? 32 : type === 2 ? 64 : 0) + 32 * siblings);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, (BigInt(type) << 62n) | 123n, true);
  bytes[8] = (1 << siblings) - 1;
  return bytes;
}
function address(id: number) { const bytes = new Uint8Array(32); bytes[31] = id; return Pubkey.from(bytes).toThruFmt(); }

describe("compression wire ABI", () => {
  it.each([0, 1, 2])("encodes inline compression with proof type %s", type => {
    const p = proof(type, 3);
    const bytes = buildCompressInstruction(0x1234, p);
    expect(Array.from(bytes.slice(0, 6))).toEqual([1, 0, 0, 0, 0x34, 0x12]);
    expect(bytes.slice(6)).toEqual(p);
  });
  it("encodes full runtime metadata, a u64 data length, data, then the membership proof", () => {
    const meta = new Uint8Array(64); new DataView(meta.buffer).setUint32(4, 3, true);
    meta[0] = 0x77; meta[1] = 0xaa;
    const data = new Uint8Array([4, 5, 6]); const p = proof(0, 1);
    const bytes = buildDecompressInstruction(2, meta, data, p);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(2);
    expect(view.getUint16(4, true)).toBe(2);
    expect(view.getBigUint64(6, true)).toBe(3n);
    expect(bytes.slice(14, 78)).toEqual(meta);
    expect(bytes.slice(78, 81)).toEqual(data);
    expect(bytes.slice(81)).toEqual(p);
  });
  it("encodes the C program's two pointer variants without narrowing u64 addresses", () => {
    const ptr = 0xffff000012345678n;
    const compress = buildCompressFromPointerInstruction(3, ptr, 72n);
    expect(compress.length).toBe(22);
    expect(new DataView(compress.buffer).getBigUint64(6, true)).toBe(ptr);
    const decompress = buildDecompressFromPointerInstruction({ accountIndex: 2, dataSize: 16_777_216n,
      metaAddress: ptr, dataAddress: ptr + 1n, proofAddress: ptr + 2n, proofSize: 104n });
    expect(decompress.length).toBe(46);
    expect(new DataView(decompress.buffer).getUint32(0, true)).toBe(4);
    expect(new DataView(decompress.buffer).getBigUint64(30, true)).toBe(ptr + 2n);
  });
  it("rejects unknown, truncated and trailing proof bytes and invalid metadata", () => {
    for (const value of [proof(3), proof(1).slice(0, -1), new Uint8Array(41), proof(0, 2).slice(0, -32)])
      expect(() => validateCompressionProof(value), `invalid proof of length ${value.length}`).toThrow();
    expect(() => buildCompressInstruction(65536, proof(0))).toThrow();
    expect(() => buildDecompressInstruction(2, new Uint8Array(64), new Uint8Array(1), proof(0))).toThrow();
  });
});
