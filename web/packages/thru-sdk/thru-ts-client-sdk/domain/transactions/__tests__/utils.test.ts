import { describe, expect, it } from "vitest";
import { generateTestPubkey } from "../../../__tests__/helpers/test-utils";
import { Pubkey } from "../../primitives";
import { createInstructionContext, normalizeAccountList, parseInstructionData } from "../utils";

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

  describe("createInstructionContext", () => {
    it("should return correct indices for feePayer and program", () => {
      const feePayer = Pubkey.from(generateTestPubkey(0x01));
      const program = Pubkey.from(generateTestPubkey(0x02));

      const context = createInstructionContext(feePayer, program, [], []);

      expect(context.getAccountIndex(feePayer)).toBe(0);
      expect(context.getAccountIndex(program)).toBe(1);
    });

    it("should return correct indices for readWrite accounts", () => {
      const feePayer = Pubkey.from(generateTestPubkey(0x01));
      const program = Pubkey.from(generateTestPubkey(0x02));
      const rwAccount1 = generateTestPubkey(0x03);
      const rwAccount2 = generateTestPubkey(0x04);

      const context = createInstructionContext(feePayer, program, [rwAccount1, rwAccount2], []);

      // Indices: 0=feePayer, 1=program, 2=rwAccount1, 3=rwAccount2
      expect(context.getAccountIndex(feePayer)).toBe(0);
      expect(context.getAccountIndex(program)).toBe(1);
      expect(context.getAccountIndex(rwAccount1)).toBe(2);
      expect(context.getAccountIndex(rwAccount2)).toBe(3);
    });

    it("should return correct indices for readOnly accounts after readWrite", () => {
      const feePayer = Pubkey.from(generateTestPubkey(0x01));
      const program = Pubkey.from(generateTestPubkey(0x02));
      const rwAccount = generateTestPubkey(0x03);
      const roAccount = generateTestPubkey(0x04);

      const context = createInstructionContext(feePayer, program, [rwAccount], [roAccount]);

      // Indices: 0=feePayer, 1=program, 2=rwAccount, 3=roAccount
      expect(context.getAccountIndex(rwAccount)).toBe(2);
      expect(context.getAccountIndex(roAccount)).toBe(3);
    });

    it("should expose all accounts in correct order", () => {
      const feePayer = Pubkey.from(generateTestPubkey(0x01));
      const program = Pubkey.from(generateTestPubkey(0x02));
      const rwAccount = generateTestPubkey(0x03);
      const roAccount = generateTestPubkey(0x04);

      const context = createInstructionContext(feePayer, program, [rwAccount], [roAccount]);

      expect(context.accounts).toHaveLength(4);
      expect(context.accounts[0].toBytes()).toEqual(feePayer.toBytes());
      expect(context.accounts[1].toBytes()).toEqual(program.toBytes());
      expect(context.accounts[2].toBytes()).toEqual(rwAccount);
      expect(context.accounts[3].toBytes()).toEqual(roAccount);
    });

    it("should throw for unknown account", () => {
      const feePayer = Pubkey.from(generateTestPubkey(0x01));
      const program = Pubkey.from(generateTestPubkey(0x02));
      const unknownAccount = generateTestPubkey(0x99);

      const context = createInstructionContext(feePayer, program, [], []);

      expect(() => context.getAccountIndex(unknownAccount)).toThrow("not found in transaction accounts");
    });

    it("should accept various PubkeyInput formats", () => {
      const feePayerBytes = generateTestPubkey(0x01);
      const feePayer = Pubkey.from(feePayerBytes);
      const program = Pubkey.from(generateTestPubkey(0x02));

      const context = createInstructionContext(feePayer, program, [], []);

      // Should accept Uint8Array
      expect(context.getAccountIndex(feePayerBytes)).toBe(0);
      // Should accept Pubkey
      expect(context.getAccountIndex(feePayer)).toBe(0);
    });
  });
});

