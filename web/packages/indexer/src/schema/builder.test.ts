/**
 * Unit tests for schema/builder.ts
 */

import { describe, it, expect } from "vitest";
import { t, columnBuilder } from "./builder";

describe("column builder", () => {
  describe("t.text()", () => {
    it("creates a text column with correct type", () => {
      const col = t.text();
      expect(col._columnType).toBe("text");
      expect(col._nullable).toBe(true);
      expect(col._primary).toBe(false);
      expect(col._indexed).toBe(false);
      expect(col._unique).toBe(false);
    });

    it("supports notNull modifier", () => {
      const col = t.text().notNull();
      expect(col._nullable).toBe(false);
    });

    it("supports primaryKey modifier", () => {
      const col = t.text().primaryKey();
      expect(col._primary).toBe(true);
      expect(col._nullable).toBe(false); // primary key implies not null
    });

    it("supports index modifier", () => {
      const col = t.text().index();
      expect(col._indexed).toBe(true);
    });

    it("supports unique modifier", () => {
      const col = t.text().unique();
      expect(col._unique).toBe(true);
    });

    it("supports default modifier", () => {
      const col = t.text().default("hello");
      expect(col._default).toBe("hello");
    });

    it("supports chaining multiple modifiers", () => {
      const col = t.text().notNull().index().unique();
      expect(col._nullable).toBe(false);
      expect(col._indexed).toBe(true);
      expect(col._unique).toBe(true);
    });
  });

  describe("t.bigint()", () => {
    it("creates a bigint column with correct type", () => {
      const col = t.bigint();
      expect(col._columnType).toBe("bigint");
      expect(col._nullable).toBe(true);
    });

    it("supports all modifiers", () => {
      const col = t.bigint().notNull().index();
      expect(col._columnType).toBe("bigint");
      expect(col._nullable).toBe(false);
      expect(col._indexed).toBe(true);
    });

    it("supports default with bigint value", () => {
      const col = t.bigint().default(0n);
      expect(col._default).toBe(0n);
    });
  });

  describe("t.integer()", () => {
    it("creates an integer column with correct type", () => {
      const col = t.integer();
      expect(col._columnType).toBe("integer");
      expect(col._nullable).toBe(true);
    });

    it("supports default with number value", () => {
      const col = t.integer().default(42);
      expect(col._default).toBe(42);
    });
  });

  describe("t.boolean()", () => {
    it("creates a boolean column with correct type", () => {
      const col = t.boolean();
      expect(col._columnType).toBe("boolean");
      expect(col._nullable).toBe(true);
    });

    it("supports default with boolean value", () => {
      const col = t.boolean().notNull().default(true);
      expect(col._default).toBe(true);
      expect(col._nullable).toBe(false);
    });
  });

  describe("t.timestamp()", () => {
    it("creates a timestamp column with correct type", () => {
      const col = t.timestamp();
      expect(col._columnType).toBe("timestamp");
      expect(col._nullable).toBe(true);
    });

    it("supports defaultNow modifier", () => {
      const col = t.timestamp().defaultNow();
      expect(col._defaultNow).toBe(true);
    });

    it("supports notNull with defaultNow", () => {
      const col = t.timestamp().notNull().defaultNow();
      expect(col._nullable).toBe(false);
      expect(col._defaultNow).toBe(true);
    });
  });

  describe("columnBuilder alias", () => {
    it("is the same as t", () => {
      expect(columnBuilder).toBe(t);
    });
  });

  describe("schema definition pattern", () => {
    it("allows building complete schema objects", () => {
      const schema = {
        id: t.text().primaryKey(),
        slot: t.bigint().notNull().index(),
        amount: t.bigint().notNull(),
        active: t.boolean().notNull().default(true),
        name: t.text(),
        createdAt: t.timestamp().notNull().defaultNow(),
      };

      expect(schema.id._primary).toBe(true);
      expect(schema.slot._indexed).toBe(true);
      expect(schema.amount._nullable).toBe(false);
      expect(schema.active._default).toBe(true);
      expect(schema.name._nullable).toBe(true);
      expect(schema.createdAt._defaultNow).toBe(true);
    });
  });
});
