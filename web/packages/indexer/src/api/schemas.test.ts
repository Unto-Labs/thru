/**
 * Unit tests for api/schemas.ts
 */

import { describe, it, expect } from "vitest";
import { generateSchemas } from "./schemas";
import { buildDrizzleTable } from "../schema/table";
import { t } from "../schema/builder";

describe("generateSchemas", () => {
  // Helper to create a table from schema
  const createTable = (name: string, schema: Record<string, any>) =>
    buildDrizzleTable(name, schema);

  describe("schema generation", () => {
    it("generates row, insert, and api schemas", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        name: t.text().notNull(),
      });

      const schemas = generateSchemas(table, "test");

      expect(schemas.row).toBeDefined();
      expect(schemas.insert).toBeDefined();
      expect(schemas.api).toBeDefined();
      expect(schemas.serialize).toBeDefined();
    });

    it("generates OpenAPI name with PascalCase", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
      });

      const schemas = generateSchemas(table, "my-stream", "Event");

      // The API schema should be named "MystreamEvent" for OpenAPI
      // We can't easily test the OpenAPI name directly, but we can test that it validates
      expect(schemas.api).toBeDefined();
    });

    it("handles name with suffix", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
      });

      const withSuffix = generateSchemas(table, "transfer", "Event");
      const withoutSuffix = generateSchemas(table, "transfer");

      // Both should work
      expect(withSuffix.api).toBeDefined();
      expect(withoutSuffix.api).toBeDefined();
    });
  });

  describe("serializer function", () => {
    it("converts bigint to string", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        amount: t.bigint().notNull(),
        slot: t.bigint().notNull(),
      });

      const { serialize } = generateSchemas(table, "test");

      const row = {
        id: "test-123",
        amount: 1000000000000n,
        slot: 12345678n,
      };

      const result = serialize(row);

      expect(result.id).toBe("test-123");
      expect(result.amount).toBe("1000000000000");
      expect(result.slot).toBe("12345678");
    });

    it("converts Date to ISO string", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        created: t.timestamp().notNull(),
        updated: t.timestamp(),
      });

      const { serialize } = generateSchemas(table, "test");

      const now = new Date("2024-01-15T12:00:00.000Z");
      const row = {
        id: "test-123",
        created: now,
        updated: null,
      };

      const result = serialize(row);

      expect(result.id).toBe("test-123");
      expect(result.created).toBe("2024-01-15T12:00:00.000Z");
      expect(result.updated).toBeNull();
    });

    it("preserves other types unchanged", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        count: t.integer(),
        active: t.boolean(),
        name: t.text(),
      });

      const { serialize } = generateSchemas(table, "test");

      const row = {
        id: "test-123",
        count: 42,
        active: true,
        name: "Test Name",
      };

      const result = serialize(row);

      expect(result).toEqual(row);
    });

    it("handles null values", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        amount: t.bigint(),
        name: t.text(),
      });

      const { serialize } = generateSchemas(table, "test");

      const row = {
        id: "test-123",
        amount: null,
        name: null,
      };

      const result = serialize(row);

      expect(result.id).toBe("test-123");
      expect(result.amount).toBeNull();
      expect(result.name).toBeNull();
    });

    it("handles zero bigint", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        amount: t.bigint().notNull(),
      });

      const { serialize } = generateSchemas(table, "test");

      const row = { id: "test", amount: 0n };
      const result = serialize(row);

      expect(result.amount).toBe("0");
    });

    it("handles negative bigint", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        balance: t.bigint().notNull(),
      });

      const { serialize } = generateSchemas(table, "test");

      const row = { id: "test", balance: -1000n };
      const result = serialize(row);

      expect(result.balance).toBe("-1000");
    });

    it("handles very large bigint", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        amount: t.bigint().notNull(),
      });

      const { serialize } = generateSchemas(table, "test");

      // Larger than Number.MAX_SAFE_INTEGER
      const largeValue = 9007199254740993n;
      const row = { id: "test", amount: largeValue };
      const result = serialize(row);

      expect(result.amount).toBe("9007199254740993");
    });
  });

  describe("API schema validation", () => {
    it("validates serialized bigint as string", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        amount: t.bigint().notNull(),
      });

      const { api, serialize } = generateSchemas(table, "test");

      const row = { id: "test", amount: 1000n };
      const serialized = serialize(row);

      expect(api.safeParse(serialized).success).toBe(true);
    });

    it("validates serialized timestamp as string", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        created: t.timestamp().notNull(),
      });

      const { api, serialize } = generateSchemas(table, "test");

      const row = { id: "test", created: new Date() };
      const serialized = serialize(row);

      expect(api.safeParse(serialized).success).toBe(true);
    });

    it("handles nullable fields in API schema", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        name: t.text(), // nullable
        amount: t.bigint(), // nullable
      });

      const { api, serialize } = generateSchemas(table, "test");

      const row = { id: "test", name: null, amount: null };
      const serialized = serialize(row);

      expect(api.safeParse(serialized).success).toBe(true);
    });
  });

  describe("full schema example", () => {
    it("handles a complete event row", () => {
      const table = createTable("transfer_events", {
        id: t.text().primaryKey(),
        slot: t.bigint().notNull(),
        source: t.text().notNull(),
        dest: t.text().notNull(),
        amount: t.bigint().notNull(),
        memo: t.text(),
        createdAt: t.timestamp().notNull(),
      });

      const { serialize, api } = generateSchemas(table, "transfers", "Event");

      const row = {
        id: "tx-12345",
        slot: 3181195n,
        source: "sender-address",
        dest: "receiver-address",
        amount: 5000000000n,
        memo: null,
        createdAt: new Date("2024-01-15T12:00:00Z"),
      };

      const serialized = serialize(row);

      expect(serialized).toEqual({
        id: "tx-12345",
        slot: "3181195",
        source: "sender-address",
        dest: "receiver-address",
        amount: "5000000000",
        memo: null,
        createdAt: "2024-01-15T12:00:00.000Z",
      });

      expect(api.safeParse(serialized).success).toBe(true);
    });
  });

  describe("column type detection", () => {
    it("handles all supported column types", () => {
      const table = createTable("test", {
        id: t.text().primaryKey(),
        name: t.text().notNull(),
        slot: t.bigint().notNull(),
        count: t.integer().notNull(),
        active: t.boolean().notNull(),
        created: t.timestamp().notNull(),
      });

      const { serialize, api } = generateSchemas(table, "test");

      const row = {
        id: "test-123",
        name: "Test",
        slot: 100n,
        count: 42,
        active: true,
        created: new Date("2024-01-01T00:00:00Z"),
      };

      const serialized = serialize(row);

      expect(serialized).toEqual({
        id: "test-123",
        name: "Test",
        slot: "100",
        count: 42,
        active: true,
        created: "2024-01-01T00:00:00.000Z",
      });

      expect(api.safeParse(serialized).success).toBe(true);
    });
  });
});
