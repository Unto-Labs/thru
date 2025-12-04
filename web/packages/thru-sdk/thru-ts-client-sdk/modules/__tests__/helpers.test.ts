import { describe, expect, it } from "vitest";
import { generateTestAddress, generateTestPubkey } from "../../__tests__/helpers/test-utils";
import { deriveProgramAddress, toBlockHash } from "../helpers";

describe("helpers", () => {
  describe("toBlockHash", () => {
    it("accepts Uint8Array input", () => {
      const hashBytes = new Uint8Array([1, 2, 3, 4]);
      const result = toBlockHash(hashBytes);

      expect(result.value).toEqual(hashBytes);
    });

    it("accepts base64 strings", () => {
      const hashBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const base64 = btoa(String.fromCharCode(...hashBytes));
      const result = toBlockHash(base64);

      expect(result.value).toBeInstanceOf(Uint8Array);
      expect(result.value).toEqual(hashBytes);
    });

    it("accepts hex strings", () => {
      const hashBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const hexString = Array.from(hashBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const result = toBlockHash(hexString);

      expect(result.value).toBeInstanceOf(Uint8Array);
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
      
      expect(() =>
        deriveProgramAddress({
          programAddress: invalidProgramAddress,
          seed,
        }),
      ).toThrow("Must contain 32 bytes");
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

    it("throws for invalid program string format", () => {
      const seed = new Uint8Array([0x02]);

      expect(() =>
        deriveProgramAddress({
          programAddress: "invalid-format",
          seed,
        }),
      ).toThrow("Must be provided as hex string or ta-address");
    });
  });
});

