/**
 * Unit tests for streams/define.ts
 */

import { describe, it, expect, vi } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { defineEventStream } from "./define";
import { t } from "../schema/builder";

// Mock Filter type (simplified for testing)
type MockFilter = { expression: string };

describe("defineEventStream", () => {
  // Basic schema for testing
  const testSchema = {
    id: t.text().primaryKey(),
    slot: t.bigint().notNull().index(),
    data: t.text(),
  };

  // Mock parse function
  const mockParse = (event: any) => ({
    id: event.id,
    slot: event.slot,
    data: event.data ?? null,
  });

  // Mock filter
  const mockFilter: MockFilter = { expression: "true" };

  describe("basic stream creation", () => {
    it("creates stream with correct name", () => {
      const stream = defineEventStream({
        name: "transfers",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(stream.name).toBe("transfers");
    });

    it("creates stream with provided description", () => {
      const stream = defineEventStream({
        name: "transfers",
        description: "Transfer events from the token program",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(stream.description).toBe("Transfer events from the token program");
    });

    it("generates default description from name", () => {
      const stream = defineEventStream({
        name: "transfers",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(stream.description).toBe("Transfers events");
    });

    it("handles hyphenated names for description", () => {
      const stream = defineEventStream({
        name: "token-transfers",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      // pascalCase capitalizes each word
      expect(stream.description).toBe("TokenTransfers events");
    });
  });

  describe("table creation", () => {
    it("creates table with _events suffix", () => {
      const stream = defineEventStream({
        name: "transfers",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(getTableName(stream.table)).toBe("transfer_events");
    });

    it("removes trailing 's' from name before suffix", () => {
      const stream = defineEventStream({
        name: "deposits",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(getTableName(stream.table)).toBe("deposit_events");
    });

    it("creates table with correct columns", () => {
      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      const columns = getTableColumns(stream.table);
      expect(Object.keys(columns)).toEqual(["id", "slot", "data"]);
    });

    it("exposes column accessors via c property", () => {
      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(stream.c.id).toBeDefined();
      expect(stream.c.slot).toBeDefined();
      expect(stream.c.data).toBeDefined();
    });
  });

  describe("filter handling", () => {
    it("returns direct filter from getFilter()", () => {
      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(stream.getFilter()).toBe(mockFilter);
    });

    it("calls filterFactory lazily and caches result", () => {
      const factory = vi.fn(() => mockFilter as any);

      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filterFactory: factory,
        parse: mockParse,
      });

      // Factory not called yet
      expect(factory).not.toHaveBeenCalled();

      // First call
      const filter1 = stream.getFilter();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(filter1).toBe(mockFilter);

      // Second call uses cached value
      const filter2 = stream.getFilter();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(filter2).toBe(mockFilter);
    });

    it("throws if neither filter nor filterFactory provided", () => {
      expect(() =>
        defineEventStream({
          name: "test",
          schema: testSchema,
          parse: mockParse,
        } as any)
      ).toThrow('Stream "test" must provide either filter or filterFactory');
    });
  });

  describe("parse function", () => {
    it("exposes parse function", () => {
      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      const result = stream.parse({
        id: "event-123",
        slot: 1000n,
        data: "test data",
      });

      expect(result).toEqual({
        id: "event-123",
        slot: 1000n,
        data: "test data",
      });
    });

    it("parse can return null to skip events", () => {
      const selectiveParse = (event: any) => {
        if (event.skip) return null;
        return { id: event.id, slot: event.slot, data: null };
      };

      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: selectiveParse,
      });

      expect(stream.parse({ id: "1", slot: 1n, skip: true })).toBeNull();
      expect(stream.parse({ id: "2", slot: 2n })).not.toBeNull();
    });
  });

  describe("optional configurations", () => {
    it("preserves api configuration", () => {
      const apiConfig = { filters: ["source", "dest"] };

      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
        api: apiConfig,
      });

      expect(stream.api).toEqual(apiConfig);
    });

    it("preserves filterBatch hook", () => {
      const filterBatch = vi.fn(async (events) => events);

      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
        filterBatch,
      });

      expect(stream.filterBatch).toBe(filterBatch);
    });

    it("preserves onCommit hook", () => {
      const onCommit = vi.fn(async () => {});

      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
        onCommit,
      });

      expect(stream.onCommit).toBe(onCommit);
    });
  });

  describe("schema preservation", () => {
    it("exposes original schema definition", () => {
      const stream = defineEventStream({
        name: "test",
        schema: testSchema,
        filter: mockFilter as any,
        parse: mockParse,
      });

      expect(stream.schema).toBe(testSchema);
    });
  });

  describe("realistic usage", () => {
    it("creates a complete transfer stream", () => {
      const transferSchema = {
        id: t.text().primaryKey(),
        slot: t.bigint().notNull().index(),
        source: t.text().notNull().index(),
        dest: t.text().notNull().index(),
        amount: t.bigint().notNull(),
        memo: t.text(),
        createdAt: t.timestamp().notNull().defaultNow(),
      };

      const stream = defineEventStream({
        name: "transfers",
        description: "Token transfer events",
        schema: transferSchema,
        filter: mockFilter as any,
        parse: (event: any) => ({
          id: event.eventId,
          slot: event.slot,
          source: event.source,
          dest: event.dest,
          amount: event.amount,
          memo: event.memo ?? null,
          createdAt: new Date(),
        }),
        api: {
          filters: ["source", "dest"],
        },
      });

      expect(stream.name).toBe("transfers");
      expect(stream.description).toBe("Token transfer events");
      expect(getTableName(stream.table)).toBe("transfer_events");

      const columns = getTableColumns(stream.table);
      expect(Object.keys(columns)).toHaveLength(7);
    });
  });
});
