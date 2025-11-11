import { decodeAddress } from "@thru/helpers";
import { describe, expect, it } from "vitest";
import { generateTestAddress, generateTestPubkey } from "../../../__tests__/helpers/test-utils";
import {
    normalizeAccountList,
    parseAccountIdentifier,
    parseInstructionData,
    resolveProgramIdentifier,
} from "../utils";

describe("transaction utils", () => {
  describe("normalizeAccountList", () => {
    it("should return empty array for empty input", () => {
      const result = normalizeAccountList([]);
      expect(result).toEqual([]);
    });

    it("should return single account unchanged", () => {
      const account = generateTestPubkey(0x01);
      const result = normalizeAccountList([account]);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(account);
    });

    it("should deduplicate accounts", () => {
      const account1 = generateTestPubkey(0x01);
      const account2 = generateTestPubkey(0x02);
      const account1Duplicate = new Uint8Array(account1);
      
      const result = normalizeAccountList([account1, account2, account1Duplicate]);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(account1);
      expect(result[1]).toEqual(account2);
    });

    it("should sort accounts", () => {
      const account1 = generateTestPubkey(0x02);
      const account2 = generateTestPubkey(0x01);
      const account3 = generateTestPubkey(0x03);
      
      const result = normalizeAccountList([account1, account2, account3]);
      
      expect(result).toHaveLength(3);
      // Should be sorted
      expect(result[0]).toEqual(account2); // 0x01
      expect(result[1]).toEqual(account1); // 0x02
      expect(result[2]).toEqual(account3); // 0x03
    });

    it("should throw error for too many accounts", () => {
      const accounts = Array.from({ length: 1025 }, () => generateTestPubkey());
      
      expect(() => normalizeAccountList(accounts)).toThrow("Too many accounts provided: 1025 (max 1024)");
    });

    it("should throw error for invalid account length", () => {
      const invalidAccount = new Uint8Array(31); // Should be 32
      
      expect(() => normalizeAccountList([invalidAccount])).toThrow("Account addresses must contain 32 bytes");
    });
  });

  describe("resolveProgramIdentifier", () => {
    it("should accept Uint8Array with 32 bytes", () => {
      const program = generateTestPubkey(0x01);
      const result = resolveProgramIdentifier(program);
      
      expect(result).toEqual(program);
      expect(result).not.toBe(program); // Should be a copy
    });

    it("should accept ta- prefixed address string", () => {
      const address = generateTestAddress(0x01);
      const result = resolveProgramIdentifier(address);
      
      expect(result.length).toBe(32);
      const decoded = decodeAddress(address);
      expect(result).toEqual(decoded);
    });

    it("should accept hex string", () => {
      const programBytes = generateTestPubkey(0x01);
      const hexString = Array.from(programBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      
      const result = resolveProgramIdentifier(hexString);
      
      expect(result.length).toBe(32);
      expect(result).toEqual(programBytes);
    });

    it("should throw error for Uint8Array with wrong length", () => {
      const invalidProgram = new Uint8Array(31);
      
      expect(() => resolveProgramIdentifier(invalidProgram)).toThrow("Program public key must contain 32 bytes");
    });

    it("should throw error for invalid string format", () => {
      expect(() => resolveProgramIdentifier("invalid-format")).toThrow("Unsupported program identifier format");
    });

    it("should throw error for hex string with wrong length", () => {
      const shortHex = "0123"; // Too short
      
      expect(() => resolveProgramIdentifier(shortHex)).toThrow("Hex-encoded program key must contain 32 bytes");
    });
  });

  describe("parseAccountIdentifier", () => {
    it("should accept Uint8Array with 32 bytes", () => {
      const account = generateTestPubkey(0x01);
      const result = parseAccountIdentifier(account, "testField");
      
      expect(result).toEqual(account);
      expect(result).not.toBe(account); // Should be a copy
    });

    it("should accept ta- prefixed address string", () => {
      const address = generateTestAddress(0x01);
      const result = parseAccountIdentifier(address, "testField");
      
      expect(result.length).toBe(32);
      const decoded = decodeAddress(address);
      expect(result).toEqual(decoded);
    });

    it("should accept hex string", () => {
      const accountBytes = generateTestPubkey(0x01);
      const hexString = Array.from(accountBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      
      const result = parseAccountIdentifier(hexString, "testField");
      
      expect(result.length).toBe(32);
      expect(result).toEqual(accountBytes);
    });

    it("should throw error for Uint8Array with wrong length", () => {
      const invalidAccount = new Uint8Array(31);
      
      expect(() => parseAccountIdentifier(invalidAccount, "testField")).toThrow("testField must contain 32 bytes");
    });

    it("should throw error for invalid string format", () => {
      expect(() => parseAccountIdentifier("invalid-format", "testField")).toThrow(
        "testField must be a 32-byte value, ta-address, or 64-character hex string"
      );
    });

    it("should include field name in error message", () => {
      const invalidAccount = new Uint8Array(31);
      
      expect(() => parseAccountIdentifier(invalidAccount, "myCustomField")).toThrow("myCustomField must contain 32 bytes");
    });
  });

  describe("parseInstructionData", () => {
    it("should return undefined for undefined input", () => {
      const result = parseInstructionData(undefined);
      expect(result).toBeUndefined();
    });

    it("should accept Uint8Array", () => {
      const data = new Uint8Array([0x01, 0x02, 0x03]);
      const result = parseInstructionData(data);
      
      expect(result).toEqual(data);
      expect(result).not.toBe(data); // Should be a copy
    });

    it("should accept empty Uint8Array", () => {
      const data = new Uint8Array(0);
      const result = parseInstructionData(data);
      
      expect(result).toEqual(data);
    });

    it("should accept hex string", () => {
      const dataBytes = new Uint8Array([0x01, 0x02, 0x03]);
      const hexString = Array.from(dataBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      
      const result = parseInstructionData(hexString);
      
      expect(result).toEqual(dataBytes);
    });

    it("should accept empty hex string", () => {
      const result = parseInstructionData("");
      
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result?.length).toBe(0);
    });

    it("should throw error for invalid string format", () => {
      expect(() => parseInstructionData("not-hex")).toThrow("Instruction data must be provided as hex string or Uint8Array");
    });

    it("should handle large instruction data", () => {
      const largeData = new Uint8Array(1000);
      largeData.fill(0x42);
      const result = parseInstructionData(largeData);
      
      expect(result).toEqual(largeData);
      expect(result?.length).toBe(1000);
    });
  });
});

