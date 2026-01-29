/**
 * Unit tests for accounts/define.ts
 */

import { describe, it, expect, vi } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { defineAccountStream } from "./define";
import { t } from "../schema/builder";

describe("defineAccountStream", () => {
  // Basic schema for testing
  const testSchema = {
    address: t.text().primaryKey(),
    slot: t.bigint().notNull(),
    data: t.text(),
  };

  // Mock parse function
  const mockParse = (account: any) => ({
    address: account.address,
    slot: account.slot,
    data: account.data ?? null,
  });

  // Mock owner program (32 bytes)
  const mockOwnerProgram = new Uint8Array(32).fill(1);

  describe("basic stream creation", () => {
    it("creates stream with correct name", () => {
      const stream = defineAccountStream({
        name: "token-accounts",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(stream.name).toBe("token-accounts");
    });

    it("creates stream with provided description", () => {
      const stream = defineAccountStream({
        name: "token-accounts",
        description: "Token account state from the token program",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(stream.description).toBe(
        "Token account state from the token program"
      );
    });

    it("generates default description from name", () => {
      const stream = defineAccountStream({
        name: "token-accounts",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      // pascalCase capitalizes each word
      expect(stream.description).toBe("TokenAccounts accounts");
    });

    it("handles underscored names for description", () => {
      const stream = defineAccountStream({
        name: "user_profiles",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      // pascalCase capitalizes each word
      expect(stream.description).toBe("UserProfiles accounts");
    });
  });

  describe("table creation", () => {
    it("converts hyphens to underscores in table name", () => {
      const stream = defineAccountStream({
        name: "token-accounts",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(getTableName(stream.table)).toBe("token_accounts");
    });

    it("preserves underscores in table name", () => {
      const stream = defineAccountStream({
        name: "token_accounts",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(getTableName(stream.table)).toBe("token_accounts");
    });

    it("creates table with correct columns", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      const columns = getTableColumns(stream.table);
      expect(Object.keys(columns)).toEqual(["address", "slot", "data"]);
    });

    it("exposes column accessors via c property", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(stream.c.address).toBeDefined();
      expect(stream.c.slot).toBeDefined();
      expect(stream.c.data).toBeDefined();
    });
  });

  describe("owner program handling", () => {
    it("returns direct ownerProgram from getOwnerProgram()", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(stream.getOwnerProgram()).toBe(mockOwnerProgram);
    });

    it("calls ownerProgramFactory lazily and caches result", () => {
      const factory = vi.fn(() => mockOwnerProgram);

      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgramFactory: factory,
        parse: mockParse,
      });

      // Factory not called yet
      expect(factory).not.toHaveBeenCalled();

      // First call
      const program1 = stream.getOwnerProgram();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(program1).toBe(mockOwnerProgram);

      // Second call uses cached value
      const program2 = stream.getOwnerProgram();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(program2).toBe(mockOwnerProgram);
    });

    it("throws if neither ownerProgram nor ownerProgramFactory provided", () => {
      expect(() =>
        defineAccountStream({
          name: "test",
          schema: testSchema,
          parse: mockParse,
        } as any)
      ).toThrow(
        'Stream "test" must provide either ownerProgram or ownerProgramFactory'
      );
    });
  });

  describe("size constraints", () => {
    it("preserves expectedSize", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        expectedSize: 73,
        parse: mockParse,
      });

      expect(stream.expectedSize).toBe(73);
    });

    it("preserves dataSizes array", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        dataSizes: [73, 165],
        parse: mockParse,
      });

      expect(stream.dataSizes).toEqual([73, 165]);
    });

    it("allows both expectedSize and dataSizes", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        expectedSize: 73,
        dataSizes: [165, 200],
        parse: mockParse,
      });

      expect(stream.expectedSize).toBe(73);
      expect(stream.dataSizes).toEqual([165, 200]);
    });

    it("allows omitting size constraints", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(stream.expectedSize).toBeUndefined();
      expect(stream.dataSizes).toBeUndefined();
    });
  });

  describe("parse function", () => {
    it("exposes parse function", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      const result = stream.parse({
        address: "abc123",
        slot: 1000n,
        data: "test data",
      });

      expect(result).toEqual({
        address: "abc123",
        slot: 1000n,
        data: "test data",
      });
    });

    it("parse can return null to skip accounts", () => {
      const selectiveParse = (account: any) => {
        if (account.skip) return null;
        return { address: account.address, slot: account.slot, data: null };
      };

      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: selectiveParse,
      });

      expect(stream.parse({ address: "1", slot: 1n, skip: true })).toBeNull();
      expect(stream.parse({ address: "2", slot: 2n })).not.toBeNull();
    });
  });

  describe("optional configurations", () => {
    it("preserves api configuration", () => {
      const apiConfig = { filters: ["mint", "owner"], idField: "address" };

      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
        api: apiConfig,
      });

      expect(stream.api).toEqual(apiConfig);
    });

    it("api configuration is optional", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(stream.api).toBeUndefined();
    });
  });

  describe("schema preservation", () => {
    it("exposes original schema definition", () => {
      const stream = defineAccountStream({
        name: "test",
        schema: testSchema,
        ownerProgram: mockOwnerProgram,
        parse: mockParse,
      });

      expect(stream.schema).toBe(testSchema);
    });
  });

  describe("realistic usage", () => {
    it("creates a complete token account stream", () => {
      const tokenAccountSchema = {
        address: t.text().primaryKey(),
        mint: t.text().notNull().index(),
        owner: t.text().notNull().index(),
        amount: t.bigint().notNull(),
        isFrozen: t.boolean().notNull(),
        slot: t.bigint().notNull(),
        seq: t.bigint().notNull(),
        updatedAt: t.timestamp().notNull().defaultNow(),
      };

      const tokenProgramId = new Uint8Array(32);
      tokenProgramId[0] = 6; // Token program identifier

      const stream = defineAccountStream({
        name: "token-accounts",
        description: "SPL Token account state",
        schema: tokenAccountSchema,
        ownerProgram: tokenProgramId,
        expectedSize: 73,
        parse: (account: any) => ({
          address: account.address,
          mint: account.mint,
          owner: account.owner,
          amount: account.amount,
          isFrozen: account.isFrozen,
          slot: account.slot,
          seq: account.seq,
          updatedAt: new Date(),
        }),
        api: {
          filters: ["mint", "owner"],
          idField: "address",
        },
      });

      expect(stream.name).toBe("token-accounts");
      expect(stream.description).toBe("SPL Token account state");
      expect(getTableName(stream.table)).toBe("token_accounts");
      expect(stream.expectedSize).toBe(73);

      const columns = getTableColumns(stream.table);
      expect(Object.keys(columns)).toHaveLength(8);
    });
  });
});
