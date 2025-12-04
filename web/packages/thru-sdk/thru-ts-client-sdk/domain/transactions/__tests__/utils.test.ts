import { describe, expect, it } from "vitest";
import { generateTestPubkey } from "../../../__tests__/helpers/test-utils";
import { normalizeAccountList, parseInstructionData } from "../utils";

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

      expect(() => normalizeAccountList([invalidAccount])).toThrow("Must contain 32 bytes");
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

