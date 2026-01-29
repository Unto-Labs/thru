/**
 * Unit tests for schema/validation.ts
 */

import { describe, it, expect } from "vitest";
import { generateZodSchema, validateParsedData } from "./validation";
import { t } from "./builder";

describe("generateZodSchema", () => {
  describe("basic type mapping", () => {
    it("maps text columns to z.string()", () => {
      const schema = {
        name: t.text().notNull(),
      };
      const zodSchema = generateZodSchema(schema);

      expect(zodSchema.safeParse({ name: "hello" }).success).toBe(true);
      expect(zodSchema.safeParse({ name: 123 }).success).toBe(false);
    });

    it("maps bigint columns to z.bigint()", () => {
      const schema = {
        amount: t.bigint().notNull(),
      };
      const zodSchema = generateZodSchema(schema);

      expect(zodSchema.safeParse({ amount: 123n }).success).toBe(true);
      expect(zodSchema.safeParse({ amount: 123 }).success).toBe(false);
      expect(zodSchema.safeParse({ amount: "123" }).success).toBe(false);
    });

    it("maps integer columns to z.number().int()", () => {
      const schema = {
        count: t.integer().notNull(),
      };
      const zodSchema = generateZodSchema(schema);

      expect(zodSchema.safeParse({ count: 42 }).success).toBe(true);
      expect(zodSchema.safeParse({ count: 42.5 }).success).toBe(false);
      expect(zodSchema.safeParse({ count: "42" }).success).toBe(false);
    });

    it("maps boolean columns to z.boolean()", () => {
      const schema = {
        active: t.boolean().notNull(),
      };
      const zodSchema = generateZodSchema(schema);

      expect(zodSchema.safeParse({ active: true }).success).toBe(true);
      expect(zodSchema.safeParse({ active: false }).success).toBe(true);
      expect(zodSchema.safeParse({ active: 1 }).success).toBe(false);
      expect(zodSchema.safeParse({ active: "true" }).success).toBe(false);
    });

    it("maps timestamp columns to z.date()", () => {
      const schema = {
        created: t.timestamp().notNull(),
      };
      const zodSchema = generateZodSchema(schema);
      const now = new Date();

      expect(zodSchema.safeParse({ created: now }).success).toBe(true);
      expect(zodSchema.safeParse({ created: "2024-01-01" }).success).toBe(
        false
      );
      expect(zodSchema.safeParse({ created: 1704067200000 }).success).toBe(
        false
      );
    });
  });

  describe("nullability handling", () => {
    it("allows null for nullable columns", () => {
      const schema = {
        name: t.text(), // nullable by default
      };
      const zodSchema = generateZodSchema(schema);

      expect(zodSchema.safeParse({ name: "hello" }).success).toBe(true);
      expect(zodSchema.safeParse({ name: null }).success).toBe(true);
    });

    it("rejects null for notNull columns", () => {
      const schema = {
        name: t.text().notNull(),
      };
      const zodSchema = generateZodSchema(schema);

      expect(zodSchema.safeParse({ name: "hello" }).success).toBe(true);
      expect(zodSchema.safeParse({ name: null }).success).toBe(false);
    });

    it("handles mixed nullable and non-nullable columns", () => {
      const schema = {
        id: t.text().notNull(),
        description: t.text(), // nullable
      };
      const zodSchema = generateZodSchema(schema);

      expect(
        zodSchema.safeParse({ id: "123", description: "test" }).success
      ).toBe(true);
      expect(
        zodSchema.safeParse({ id: "123", description: null }).success
      ).toBe(true);
      expect(
        zodSchema.safeParse({ id: null, description: "test" }).success
      ).toBe(false);
    });
  });

  describe("complex schemas", () => {
    it("validates a full schema with multiple column types", () => {
      const schema = {
        id: t.text().primaryKey(),
        slot: t.bigint().notNull(),
        amount: t.bigint().notNull(),
        count: t.integer(),
        active: t.boolean().notNull(),
        created: t.timestamp().notNull(),
        memo: t.text(),
      };
      const zodSchema = generateZodSchema(schema);

      const validData = {
        id: "abc123",
        slot: 1000n,
        amount: 5000000n,
        count: null,
        active: true,
        created: new Date(),
        memo: null,
      };

      expect(zodSchema.safeParse(validData).success).toBe(true);

      const invalidData = {
        ...validData,
        slot: 1000, // should be bigint, not number
      };

      expect(zodSchema.safeParse(invalidData).success).toBe(false);
    });
  });
});

describe("validateParsedData", () => {
  const schema = {
    id: t.text().primaryKey(),
    slot: t.bigint().notNull(),
    name: t.text(),
  };

  describe("successful validation", () => {
    it("returns success for valid data", () => {
      const data = {
        id: "test-123",
        slot: 42n,
        name: "Test Name",
      };

      const result = validateParsedData(schema, data, "test-stream");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it("allows null for nullable fields", () => {
      const data = {
        id: "test-123",
        slot: 42n,
        name: null,
      };

      const result = validateParsedData(schema, data, "test-stream");

      expect(result.success).toBe(true);
    });
  });

  describe("failed validation", () => {
    it("returns error for invalid type", () => {
      const data = {
        id: "test-123",
        slot: 42, // number instead of bigint
        name: "Test",
      };

      const result = validateParsedData(schema, data, "test-stream");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Stream "test-stream"');
        expect(result.error).toContain("slot");
      }
    });

    it("returns error for null in notNull field", () => {
      const data = {
        id: null, // primary key, should not be null
        slot: 42n,
        name: "Test",
      };

      const result = validateParsedData(schema, data, "test-stream");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("id");
      }
    });

    it("returns error for missing required fields", () => {
      const data = {
        id: "test-123",
        // slot is missing
        name: "Test",
      };

      const result = validateParsedData(schema, data, "test-stream");

      expect(result.success).toBe(false);
    });

    it("includes stream name in error message", () => {
      const data = {
        id: 123, // wrong type
        slot: 42n,
        name: "Test",
      };

      const result = validateParsedData(schema, data, "my-custom-stream");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('"my-custom-stream"');
      }
    });

    it("includes field path in error message", () => {
      const data = {
        id: "test",
        slot: "not-a-bigint",
        name: "Test",
      };

      const result = validateParsedData(schema, data, "test-stream");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("slot");
      }
    });
  });

  describe("edge cases", () => {
    it("validates empty object against empty schema", () => {
      const emptySchema = {};
      const result = validateParsedData(emptySchema, {}, "empty-stream");

      expect(result.success).toBe(true);
    });

    it("rejects non-object data", () => {
      const result = validateParsedData(schema, "not an object", "test-stream");

      expect(result.success).toBe(false);
    });

    it("rejects array data", () => {
      const result = validateParsedData(schema, [], "test-stream");

      expect(result.success).toBe(false);
    });
  });
});
