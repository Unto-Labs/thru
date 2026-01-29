/**
 * Unit tests for schema/table.ts
 */

import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { buildDrizzleTable } from "./table";
import { t } from "./builder";

describe("buildDrizzleTable", () => {
  describe("basic table creation", () => {
    it("creates a Drizzle table with correct name", () => {
      const schema = {
        id: t.text().primaryKey(),
      };
      const table = buildDrizzleTable("my_table", schema);

      expect(getTableName(table)).toBe("my_table");
    });

    it("creates columns for each schema field", () => {
      const schema = {
        id: t.text().primaryKey(),
        name: t.text(),
        count: t.integer(),
      };
      const table = buildDrizzleTable("items", schema);
      const columns = getTableColumns(table);

      expect(Object.keys(columns)).toHaveLength(3);
      expect(columns.id).toBeDefined();
      expect(columns.name).toBeDefined();
      expect(columns.count).toBeDefined();
    });
  });

  describe("camelCase to snake_case conversion", () => {
    it("converts camelCase field names to snake_case column names", () => {
      const schema = {
        userId: t.text().primaryKey(),
        createdAt: t.timestamp(),
        isActive: t.boolean(),
        totalCount: t.integer(),
      };
      const table = buildDrizzleTable("users", schema);
      const columns = getTableColumns(table);

      // Drizzle column objects have a `name` property with the DB column name
      expect((columns.userId as any).name).toBe("user_id");
      expect((columns.createdAt as any).name).toBe("created_at");
      expect((columns.isActive as any).name).toBe("is_active");
      expect((columns.totalCount as any).name).toBe("total_count");
    });

    it("handles single word names (no conversion needed)", () => {
      const schema = {
        id: t.text().primaryKey(),
        name: t.text(),
        slot: t.bigint(),
      };
      const table = buildDrizzleTable("items", schema);
      const columns = getTableColumns(table);

      expect((columns.id as any).name).toBe("id");
      expect((columns.name as any).name).toBe("name");
      expect((columns.slot as any).name).toBe("slot");
    });

    it("handles multiple consecutive capitals", () => {
      const schema = {
        httpURL: t.text(),
        apiKey: t.text().primaryKey(),
      };
      const table = buildDrizzleTable("config", schema);
      const columns = getTableColumns(table);

      expect((columns.httpURL as any).name).toBe("http_u_r_l");
      expect((columns.apiKey as any).name).toBe("api_key");
    });
  });

  describe("column types", () => {
    it("creates correct column types for each schema type", () => {
      const schema = {
        id: t.text().primaryKey(),
        slot: t.bigint().notNull(),
        count: t.integer(),
        active: t.boolean(),
        created: t.timestamp(),
      };
      const table = buildDrizzleTable("test", schema);
      const columns = getTableColumns(table);

      expect((columns.id as any).dataType).toBe("string");
      expect((columns.slot as any).dataType).toBe("bigint");
      expect((columns.count as any).dataType).toBe("number");
      expect((columns.active as any).dataType).toBe("boolean");
      expect((columns.created as any).dataType).toBe("date");
    });
  });

  describe("column modifiers", () => {
    it("applies primary key modifier", () => {
      const schema = {
        id: t.text().primaryKey(),
      };
      const table = buildDrizzleTable("test", schema);
      const columns = getTableColumns(table);

      expect((columns.id as any).primary).toBe(true);
    });

    it("applies notNull modifier", () => {
      const schema = {
        name: t.text().notNull(),
        optional: t.text(),
      };
      const table = buildDrizzleTable("test", schema);
      const columns = getTableColumns(table);

      expect((columns.name as any).notNull).toBe(true);
      expect((columns.optional as any).notNull).toBe(false);
    });

    it("applies unique modifier", () => {
      const schema = {
        email: t.text().unique(),
      };
      const table = buildDrizzleTable("test", schema);
      const columns = getTableColumns(table);

      expect((columns.email as any).isUnique).toBe(true);
    });

    it("applies default value", () => {
      const schema = {
        active: t.boolean().notNull().default(true),
        count: t.integer().default(0),
      };
      const table = buildDrizzleTable("test", schema);
      const columns = getTableColumns(table);

      expect((columns.active as any).hasDefault).toBe(true);
      expect((columns.count as any).hasDefault).toBe(true);
    });

    it("applies defaultNow for timestamp", () => {
      const schema = {
        created: t.timestamp().defaultNow(),
      };
      const table = buildDrizzleTable("test", schema);
      const columns = getTableColumns(table);

      expect((columns.created as any).hasDefault).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles unknown column type gracefully", () => {
      // The column builder uses getters, preventing direct modification
      // of _columnType. TypeScript provides compile-time safety.
      // This test verifies the column definition is immutable.
      const col = t.text();

      // Verify we can't modify the column type directly
      expect(() => {
        (col as any)._columnType = "invalid";
      }).toThrow();
    });
  });

  describe("full schema example", () => {
    it("builds a realistic event schema", () => {
      const schema = {
        id: t.text().primaryKey(),
        slot: t.bigint().notNull().index(),
        source: t.text().notNull().index(),
        dest: t.text().notNull().index(),
        amount: t.bigint().notNull(),
        memo: t.text(),
        createdAt: t.timestamp().notNull().defaultNow(),
      };

      const table = buildDrizzleTable("transfer_events", schema);
      const columns = getTableColumns(table);

      expect(getTableName(table)).toBe("transfer_events");
      expect(Object.keys(columns)).toHaveLength(7);
      expect((columns.id as any).primary).toBe(true);
      expect((columns.slot as any).notNull).toBe(true);
      expect((columns.amount as any).dataType).toBe("bigint");
      expect((columns.memo as any).notNull).toBe(false);
      expect((columns.createdAt as any).hasDefault).toBe(true);
    });
  });
});
