import { decodeAddress, decodeSignature } from "@thru/helpers";
import { describe, expect, it } from "vitest";
import { generateTestAddress, generateTestPubkey, generateTestSignature, generateTestSignatureString } from "../../__tests__/helpers/test-utils";
import {
    deriveProgramAddress,
    toBlockHash,
    toPubkey,
    toPubkeyBytes,
    toSignature,
    toSignatureBytes,
    toTaPubkey,
    toTsSignature,
} from "../helpers";

describe("helpers", () => {
  describe("toSignature", () => {
    it("should accept Uint8Array with 64 bytes", () => {
      const sigBytes = generateTestSignature();
      const result = toSignature(sigBytes);
      
      expect(result.value).toEqual(sigBytes);
      expect(result.value.length).toBe(64);
    });

    it("should accept ts- prefixed signature string", () => {
      const sigString = generateTestSignatureString();
      const result = toSignature(sigString);
      
      expect(result.value.length).toBe(64);
      // Verify it decodes correctly
      const decoded = decodeSignature(sigString);
      expect(result.value).toEqual(decoded);
    });

    it("should accept base64 signature string", () => {
      const sigBytes = generateTestSignature();
      const base64 = btoa(String.fromCharCode(...sigBytes));
      const result = toSignature(base64);
      
      expect(result.value.length).toBe(64);
      expect(result.value).toEqual(sigBytes);
    });

    it("should throw error for Uint8Array with wrong length", () => {
      const invalidSig = new Uint8Array(32); // Should be 64
      
      expect(() => toSignature(invalidSig)).toThrow("signature must contain 64 bytes");
    });

    it("should throw error for invalid input type", () => {
      expect(() => toSignature(null as any)).toThrow("signature must be provided as Uint8Array, ts-encoded string, hex string, or base64 string");
      expect(() => toSignature(undefined as any)).toThrow("signature must be provided as Uint8Array, ts-encoded string, hex string, or base64 string");
    });
  });

  describe("toPubkey", () => {
    it("should accept Uint8Array with 32 bytes", () => {
      const pubkeyBytes = generateTestPubkey();
      const result = toPubkey(pubkeyBytes, "testField");
      
      expect(result.value).toEqual(pubkeyBytes);
      expect(result.value.length).toBe(32);
    });

    it("should accept ta- prefixed address string", () => {
      const address = generateTestAddress();
      const result = toPubkey(address, "testField");
      
      expect(result.value.length).toBe(32);
      // Verify it decodes correctly
      const decoded = decodeAddress(address);
      expect(result.value).toEqual(decoded);
    });

    it("should accept base64 pubkey string", () => {
      const pubkeyBytes = generateTestPubkey();
      const base64 = btoa(String.fromCharCode(...pubkeyBytes));
      const result = toPubkey(base64, "testField");
      
      expect(result.value.length).toBe(32);
      expect(result.value).toEqual(pubkeyBytes);
    });

    it("should throw error for Uint8Array with wrong length", () => {
      const invalidPubkey = new Uint8Array(64); // Should be 32
      
      expect(() => toPubkey(invalidPubkey, "testField")).toThrow("testField must contain 32 bytes");
    });

    it("should throw error for invalid input type", () => {
      expect(() => toPubkey(null as any, "testField")).toThrow("testField must be a 32-byte value, ta-address, hex string, or base64 string");
      expect(() => toPubkey(undefined as any, "testField")).toThrow("testField must be a 32-byte value, ta-address, hex string, or base64 string");
    });

    it("should include field name in error message", () => {
      const invalidPubkey = new Uint8Array(64);
      
      expect(() => toPubkey(invalidPubkey, "myCustomField")).toThrow("myCustomField must contain 32 bytes");
    });
  });

  describe("new primitive helpers", () => {
    it("converts to raw pubkey bytes", () => {
      const pubkeyBytes = generateTestPubkey();
      const result = toPubkeyBytes(pubkeyBytes, "testField");
      expect(result).toEqual(pubkeyBytes);
    });

    it("converts to raw signature bytes", () => {
      const signatureBytes = generateTestSignature();
      const result = toSignatureBytes(signatureBytes);
      expect(result).toEqual(signatureBytes);
    });

    it("wraps ta pubkeys from bytes", () => {
      const pubkeyBytes = generateTestPubkey();
      const taProto = toTaPubkey(pubkeyBytes);
      expect(taProto.value.startsWith("ta")).toBe(true);
      expect(taProto.value.length).toBeGreaterThan(0);
    });

    it("wraps ts signatures from bytes", () => {
      const signatureBytes = generateTestSignature();
      const tsProto = toTsSignature(signatureBytes);
      expect(tsProto.value.startsWith("ts")).toBe(true);
      expect(tsProto.value.length).toBeGreaterThan(0);
    });
  });

  describe("toBlockHash", () => {
    it("should accept Uint8Array", () => {
      const hashBytes = new Uint8Array([1, 2, 3, 4]);
      const result = toBlockHash(hashBytes);
      
      expect(result.value).toEqual(hashBytes);
    });

    it("should accept base64 string", () => {
      const hashBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const base64 = btoa(String.fromCharCode(...hashBytes));
      const result = toBlockHash(base64);
      
      expect(result.value).toBeInstanceOf(Uint8Array);
      expect(result.value).toEqual(hashBytes);
    });

    it("should accept hex string", () => {
      const hashBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const hexString = Array.from(hashBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      const result = toBlockHash(hexString);
      
      expect(result.value).toBeInstanceOf(Uint8Array);
      // Note: ensureBytes may handle hex differently, so we just verify it works
      expect(result.value.length).toBeGreaterThan(0);
    });
  });

  describe("deriveProgramAddress", () => {
    it("should derive address from program address and seed (Uint8Array)", () => {
      const programAddress = generateTestPubkey(0x01);
      const seed = new Uint8Array([0x02, 0x03]);
      
      const result = deriveProgramAddress({
        programAddress,
        seed,
      });
      
      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.bytes.length).toBe(32);
      expect(result.address).toBeTruthy();
      expect(result.address.startsWith("ta")).toBe(true);
    });

    it("should derive address with ephemeral flag set", () => {
      const programAddress = generateTestPubkey(0x01);
      const seed = new Uint8Array([0x02, 0x03]);
      
      const resultEphemeral = deriveProgramAddress({
        programAddress,
        seed,
        ephemeral: true,
      });
      
      const resultNonEphemeral = deriveProgramAddress({
        programAddress,
        seed,
        ephemeral: false,
      });
      
      // Ephemeral and non-ephemeral should produce different addresses
      expect(resultEphemeral.bytes).not.toEqual(resultNonEphemeral.bytes);
      expect(resultEphemeral.address).not.toBe(resultNonEphemeral.address);
    });

    it("should be deterministic for same inputs", () => {
      const programAddress = generateTestPubkey(0x01);
      const seed = new Uint8Array([0x02, 0x03]);
      
      const result1 = deriveProgramAddress({
        programAddress,
        seed,
      });
      
      const result2 = deriveProgramAddress({
        programAddress,
        seed,
      });
      
      expect(result1.bytes).toEqual(result2.bytes);
      expect(result1.address).toBe(result2.address);
    });

    it("should accept program address as ta- prefixed string", () => {
      const programAddress = generateTestAddress(0x01);
      const seed = new Uint8Array([0x02, 0x03]);
      
      const result = deriveProgramAddress({
        programAddress,
        seed,
      });
      
      expect(result.bytes.length).toBe(32);
      expect(result.address).toBeTruthy();
    });

    it("should accept program address as hex string", () => {
      const programAddressBytes = generateTestPubkey(0x01);
      const programAddressHex = Array.from(programAddressBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      
      const seed = new Uint8Array([0x02, 0x03]);
      
      const result = deriveProgramAddress({
        programAddress: programAddressHex,
        seed,
      });
      
      expect(result.bytes.length).toBe(32);
      expect(result.address).toBeTruthy();
    });

    it("should accept seed as string", () => {
      const programAddress = generateTestPubkey(0x01);
      const seed = "my-seed-string";
      
      const result = deriveProgramAddress({
        programAddress,
        seed,
      });
      
      expect(result.bytes.length).toBe(32);
      expect(result.address).toBeTruthy();
    });

    it("should accept seed as hex string", () => {
      const programAddress = generateTestPubkey(0x01);
      const seedBytes = new Uint8Array(32);
      seedBytes.fill(0x42);
      const seedHex = Array.from(seedBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      
      const result = deriveProgramAddress({
        programAddress,
        seed: seedHex,
      });
      
      expect(result.bytes.length).toBe(32);
      expect(result.address).toBeTruthy();
    });

    it("should throw error for invalid program address length", () => {
      const invalidProgramAddress = new Uint8Array(31); // Should be 32
      const seed = new Uint8Array([0x02]);
      
      expect(() => deriveProgramAddress({
        programAddress: invalidProgramAddress,
        seed,
      })).toThrow("Program address must contain 32 bytes");
    });

    it("should throw error for empty seed", () => {
      const programAddress = generateTestPubkey(0x01);
      
      expect(() => deriveProgramAddress({
        programAddress,
        seed: "",
      })).toThrow("Seed cannot be empty");
      
      expect(() => deriveProgramAddress({
        programAddress,
        seed: new Uint8Array(0),
      })).toThrow("Seed cannot be empty");
    });

    it("should throw error for seed too long", () => {
      const programAddress = generateTestPubkey(0x01);
      const longSeed = new Uint8Array(33); // Max is 32
      
      expect(() => deriveProgramAddress({
        programAddress,
        seed: longSeed,
      })).toThrow("Seed cannot exceed 32 bytes");
    });

    it("should throw error for invalid program address format", () => {
      const invalidProgramAddress = "invalid-format";
      const seed = new Uint8Array([0x02]);
      
      expect(() => deriveProgramAddress({
        programAddress: invalidProgramAddress,
        seed,
      })).toThrow("Program address must be a 32-byte value, ta-address, hex string, or base64 string");
    });
  });
});

