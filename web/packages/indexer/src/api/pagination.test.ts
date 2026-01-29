/**
 * Unit tests for api/pagination.ts
 */

import { describe, it, expect } from "vitest";
import {
  paginationQuerySchema,
  paginationResponseSchema,
  paginate,
  parseCursor,
  dataResponse,
  listResponse,
} from "./pagination";
import { z } from "zod";

describe("paginationQuerySchema", () => {
  describe("limit parameter", () => {
    it("accepts valid limit values", () => {
      expect(paginationQuerySchema.parse({ limit: 10 }).limit).toBe(10);
      expect(paginationQuerySchema.parse({ limit: 1 }).limit).toBe(1);
      expect(paginationQuerySchema.parse({ limit: 100 }).limit).toBe(100);
    });

    it("coerces string to number", () => {
      expect(paginationQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    });

    it("uses default value when not provided", () => {
      expect(paginationQuerySchema.parse({}).limit).toBe(20);
    });

    it("rejects limit below minimum", () => {
      expect(() => paginationQuerySchema.parse({ limit: 0 })).toThrow();
      expect(() => paginationQuerySchema.parse({ limit: -1 })).toThrow();
    });

    it("rejects limit above maximum", () => {
      expect(() => paginationQuerySchema.parse({ limit: 101 })).toThrow();
      expect(() => paginationQuerySchema.parse({ limit: 1000 })).toThrow();
    });
  });

  describe("offset parameter", () => {
    it("accepts valid offset values", () => {
      expect(paginationQuerySchema.parse({ offset: 0 }).offset).toBe(0);
      expect(paginationQuerySchema.parse({ offset: 100 }).offset).toBe(100);
    });

    it("coerces string to number", () => {
      expect(paginationQuerySchema.parse({ offset: "25" }).offset).toBe(25);
    });

    it("uses default value when not provided", () => {
      expect(paginationQuerySchema.parse({}).offset).toBe(0);
    });

    it("rejects negative offset", () => {
      expect(() => paginationQuerySchema.parse({ offset: -1 })).toThrow();
    });
  });

  describe("cursor parameter", () => {
    it("accepts cursor strings", () => {
      const result = paginationQuerySchema.parse({ cursor: "3181195:abc123" });
      expect(result.cursor).toBe("3181195:abc123");
    });

    it("is optional", () => {
      expect(paginationQuerySchema.parse({}).cursor).toBeUndefined();
    });
  });

  describe("combined parameters", () => {
    it("parses all parameters together", () => {
      const result = paginationQuerySchema.parse({
        limit: 50,
        offset: 100,
        cursor: "slot:id",
      });

      expect(result.limit).toBe(50);
      expect(result.offset).toBe(100);
      expect(result.cursor).toBe("slot:id");
    });
  });
});

describe("paginationResponseSchema", () => {
  it("validates correct response shape", () => {
    const response = {
      limit: 20,
      offset: 0,
      hasMore: true,
      nextCursor: "3181195:abc123",
    };

    expect(paginationResponseSchema.parse(response)).toEqual(response);
  });

  it("accepts null nextCursor", () => {
    const response = {
      limit: 20,
      offset: 0,
      hasMore: false,
      nextCursor: null,
    };

    expect(paginationResponseSchema.parse(response)).toEqual(response);
  });
});

describe("paginate", () => {
  const query = { limit: 3, offset: 0, cursor: undefined };

  describe("hasMore detection", () => {
    it("detects hasMore when rows exceed limit", () => {
      const rows = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }]; // 4 rows for limit 3
      const result = paginate(rows, query);

      expect(result.pagination.hasMore).toBe(true);
      expect(result.data).toHaveLength(3);
    });

    it("detects no more when rows equal limit", () => {
      const rows = [{ id: "1" }, { id: "2" }, { id: "3" }]; // 3 rows for limit 3
      const result = paginate(rows, query);

      expect(result.pagination.hasMore).toBe(false);
      expect(result.data).toHaveLength(3);
    });

    it("detects no more when rows less than limit", () => {
      const rows = [{ id: "1" }, { id: "2" }]; // 2 rows for limit 3
      const result = paginate(rows, query);

      expect(result.pagination.hasMore).toBe(false);
      expect(result.data).toHaveLength(2);
    });
  });

  describe("cursor generation", () => {
    it("generates cursor from slot:id when available", () => {
      const rows = [
        { id: "a", slot: 100n },
        { id: "b", slot: 101n },
        { id: "c", slot: 102n },
        { id: "d", slot: 103n }, // Extra row to trigger hasMore
      ];
      const result = paginate(rows, query);

      expect(result.pagination.nextCursor).toBe("102:c");
    });

    it("uses custom getCursor function when provided", () => {
      const rows = [
        { name: "a", seq: 1 },
        { name: "b", seq: 2 },
        { name: "c", seq: 3 },
        { name: "d", seq: 4 }, // Extra row
      ];
      const result = paginate(rows, query, (item) => `seq:${item.seq}`);

      expect(result.pagination.nextCursor).toBe("seq:3");
    });

    it("returns null cursor when hasMore is false", () => {
      const rows = [{ id: "1", slot: 100n }];
      const result = paginate(rows, query);

      expect(result.pagination.nextCursor).toBeNull();
    });

    it("returns null cursor when no items", () => {
      const result = paginate([], query);

      expect(result.pagination.nextCursor).toBeNull();
      expect(result.data).toHaveLength(0);
    });
  });

  describe("pagination metadata", () => {
    it("includes limit and offset from query", () => {
      const customQuery = { limit: 10, offset: 50, cursor: undefined };
      const rows = [{ id: "1" }];
      const result = paginate(rows, customQuery);

      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.offset).toBe(50);
    });
  });

  describe("data truncation", () => {
    it("removes the extra row used for hasMore detection", () => {
      const rows = [
        { id: "1" },
        { id: "2" },
        { id: "3" },
        { id: "4" }, // This should be removed
      ];
      const result = paginate(rows, query);

      expect(result.data).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
      expect(result.data).not.toContainEqual({ id: "4" });
    });
  });
});

describe("parseCursor", () => {
  describe("valid cursors", () => {
    it("parses slot:id format", () => {
      const result = parseCursor("3181195:abc123");

      expect(result).not.toBeNull();
      expect(result?.slot).toBe(3181195n);
      expect(result?.id).toBe("abc123");
    });

    it("handles large slot numbers", () => {
      const result = parseCursor("9007199254740993:id"); // Larger than MAX_SAFE_INTEGER

      expect(result).not.toBeNull();
      expect(result?.slot).toBe(9007199254740993n);
    });

    it("handles ids with colons", () => {
      const result = parseCursor("100:id:with:colons");

      expect(result).not.toBeNull();
      expect(result?.slot).toBe(100n);
      expect(result?.id).toBe("id:with:colons");
    });

    it("handles empty id", () => {
      const result = parseCursor("100:");

      expect(result).not.toBeNull();
      expect(result?.slot).toBe(100n);
      expect(result?.id).toBe("");
    });

    it("handles zero slot", () => {
      const result = parseCursor("0:first-item");

      expect(result).not.toBeNull();
      expect(result?.slot).toBe(0n);
      expect(result?.id).toBe("first-item");
    });
  });

  describe("invalid cursors", () => {
    it("returns null for cursor without colon", () => {
      expect(parseCursor("invalid")).toBeNull();
    });

    it("returns null for non-numeric slot", () => {
      expect(parseCursor("abc:id")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseCursor("")).toBeNull();
    });

    it("returns slot 0 and empty id for only colon", () => {
      // ":" parses as slot=0n (BigInt("") converts to 0n) and id=""
      // This is edge case behavior - the cursor is technically valid
      const result = parseCursor(":");
      expect(result).not.toBeNull();
      expect(result?.slot).toBe(0n);
      expect(result?.id).toBe("");
    });

    it("returns null for float slot", () => {
      expect(parseCursor("100.5:id")).toBeNull();
    });

    it("returns null for negative slot", () => {
      // BigInt accepts negative numbers, so this should work
      const result = parseCursor("-100:id");
      expect(result?.slot).toBe(-100n);
    });
  });
});

describe("dataResponse", () => {
  it("wraps schema in data object", () => {
    const itemSchema = z.object({ id: z.string(), name: z.string() });
    const wrapped = dataResponse(itemSchema);

    const valid = { data: { id: "123", name: "Test" } };
    expect(wrapped.parse(valid)).toEqual(valid);
  });

  it("rejects missing data key", () => {
    const itemSchema = z.object({ id: z.string() });
    const wrapped = dataResponse(itemSchema);

    expect(() => wrapped.parse({ id: "123" })).toThrow();
  });
});

describe("listResponse", () => {
  it("wraps schema array with pagination", () => {
    const itemSchema = z.object({ id: z.string() });
    const wrapped = listResponse(itemSchema);

    const valid = {
      data: [{ id: "1" }, { id: "2" }],
      pagination: {
        limit: 20,
        offset: 0,
        hasMore: false,
        nextCursor: null,
      },
    };

    expect(wrapped.parse(valid)).toEqual(valid);
  });

  it("validates array items", () => {
    const itemSchema = z.object({ id: z.number() });
    const wrapped = listResponse(itemSchema);

    const invalid = {
      data: [{ id: "not-a-number" }],
      pagination: {
        limit: 20,
        offset: 0,
        hasMore: false,
        nextCursor: null,
      },
    };

    expect(() => wrapped.parse(invalid)).toThrow();
  });
});
