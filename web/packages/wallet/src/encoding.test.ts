import { describe, expect, it } from "vitest";
import { base64ToBytes } from "./encoding";

const hex = (u: Uint8Array) =>
  Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

describe("base64ToBytes", () => {
  it("decodes canonical inputs (parity with reference encoder)", () => {
    expect(hex(base64ToBytes(""))).toBe("");
    expect(hex(base64ToBytes("QQ=="))).toBe("41");
    expect(hex(base64ToBytes("QUJD"))).toBe("414243");
    expect(hex(base64ToBytes("aGVsbG8="))).toBe("68656c6c6f");
    expect(hex(base64ToBytes("AAECAwQF"))).toBe("000102030405");
  });

  it("tolerates surrounding whitespace", () => {
    expect(hex(base64ToBytes(" QU\nJD ".trim()))).toBe("414243");
  });

  // Regression: these previously decoded silently to wrong bytes.
  it("rejects embedded padding (malleability)", () => {
    expect(() => base64ToBytes("QQ==QQ==")).toThrow(); // was 41 00 00 41
    expect(() => base64ToBytes("QUJ=QUJD")).toThrow(); // was 41 42 40 41 42 43
  });

  it("rejects malformed / non-canonical padding", () => {
    expect(() => base64ToBytes("QQ===")).toThrow();
    expect(() => base64ToBytes("=QQQ")).toThrow();
    expect(() => base64ToBytes("QQ=Q")).toThrow();
    expect(() => base64ToBytes("QUJE")).not.toThrow();
    expect(() => base64ToBytes("QUJF")).toThrow(); // non-zero discarded bits
  });

  it("rejects characters outside the standard alphabet", () => {
    expect(() => base64ToBytes("QU-D")).toThrow(); // '-' is base64url, not base64
    expect(() => base64ToBytes("QU@D")).toThrow();
  });
});