import { describe, expect, it } from "vitest";
import {
  bytesEqual,
  bytesToHex,
  compareBytes,
  readU32le,
  sha256,
  uniqueAccounts,
} from "./bytes";

describe("shared byte helpers", () => {
  it("compares equal empty and non-empty arrays", () => {
    expect(bytesEqual(new Uint8Array(), new Uint8Array())).toBe(true);
    expect(bytesEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(
      true,
    );
  });

  it("rejects same-length and different-length mismatches", () => {
    expect(bytesEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 9, 3))).toBe(
      false,
    );
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
  });

  it("encodes lowercase hexadecimal", () => {
    expect(bytesToHex(Uint8Array.of(0, 1, 15, 16, 255))).toBe("00010f10ff");
  });

  it("reads little-endian u32 values at nonzero offsets", () => {
    const bytes = Uint8Array.of(9, 8, 0x78, 0x56, 0x34, 0x12, 7);
    expect(readU32le(bytes, 2)).toBe(0x12345678);
  });

  it("hashes a known SHA-256 vector", async () => {
    const digest = await sha256(new TextEncoder().encode("abc"));
    expect(bytesToHex(digest)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares bytes lexicographically", () => {
    expect(compareBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBeLessThan(
      0,
    );
    expect(
      compareBytes(Uint8Array.of(2), Uint8Array.of(1, 255)),
    ).toBeGreaterThan(0);
    expect(compareBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBeLessThan(0);
  });

  it("keeps the first occurrence of each unique account", () => {
    const first = Uint8Array.of(1);
    const duplicate = Uint8Array.of(1);
    const second = Uint8Array.of(2);
    expect(uniqueAccounts([first, duplicate, second])).toEqual([first, second]);
  });
});
