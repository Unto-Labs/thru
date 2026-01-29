/**
 * Pagination utilities for API routes.
 */

import { z } from "@hono/zod-openapi";

// ============================================================
// Schemas
// ============================================================

/**
 * Query parameters for paginated list endpoints.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({
    description: "Number of results to return (1-100)",
    example: 20,
  }),
  offset: z.coerce.number().int().min(0).default(0).openapi({
    description: "Number of results to skip",
    example: 0,
  }),
  cursor: z.string().optional().openapi({
    description: "Cursor for pagination (format: slot:id)",
    example: "3181195:abc123",
  }),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Pagination metadata in responses.
 */
export const paginationResponseSchema = z.object({
  limit: z.number().openapi({ example: 20 }),
  offset: z.number().openapi({ example: 0 }),
  hasMore: z.boolean().openapi({ example: true }),
  nextCursor: z.string().nullable().openapi({ example: "3181195:abc123" }),
});

export type PaginationResponse = z.infer<typeof paginationResponseSchema>;

// ============================================================
// Response Wrappers
// ============================================================

/**
 * Wrap a schema in a data response.
 */
export function dataResponse<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: schema });
}

/**
 * Wrap a schema in a list response with pagination.
 */
export function listResponse<T extends z.ZodTypeAny>(schema: T) {
  return z.object({
    data: z.array(schema),
    pagination: paginationResponseSchema,
  });
}

/**
 * Standard error response schema.
 */
export const errorSchema = z
  .object({
    error: z.string().openapi({ example: "Not found" }),
    code: z.string().optional().openapi({ example: "NOT_FOUND" }),
  })
  .openapi("Error");

export type ErrorResponse = z.infer<typeof errorSchema>;

// ============================================================
// Pagination Helpers
// ============================================================

export interface PaginationResult<T> {
  data: T[];
  pagination: PaginationResponse;
}

/**
 * Process raw results into paginated response.
 * Expects `limit + 1` rows to determine hasMore.
 *
 * @param rows - Query results (should have limit + 1 rows)
 * @param query - The pagination query parameters
 * @param getCursor - Optional function to get cursor from last item
 * @returns Paginated result with data and pagination metadata
 */
export function paginate<T>(
  rows: T[],
  query: PaginationQuery,
  getCursor?: (item: T) => string | null
): PaginationResult<T> {
  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, -1) : rows;
  const lastItem = data[data.length - 1];

  let nextCursor: string | null = null;
  if (hasMore && lastItem) {
    if (getCursor) {
      nextCursor = getCursor(lastItem);
    } else {
      // Default: try to build cursor from slot:id if available
      const item = lastItem as Record<string, unknown>;
      if (item.slot !== undefined && item.id !== undefined) {
        nextCursor = `${item.slot}:${item.id}`;
      }
    }
  }

  return {
    data,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextCursor,
    },
  };
}

/**
 * Parse a cursor string into slot and id components.
 *
 * @param cursor - Cursor string in format "slot:id"
 * @returns Parsed cursor or null if invalid
 */
export function parseCursor(
  cursor: string
): { slot: bigint; id: string } | null {
  const colonIndex = cursor.indexOf(":");
  if (colonIndex === -1) return null;

  try {
    const slot = BigInt(cursor.slice(0, colonIndex));
    const id = cursor.slice(colonIndex + 1);
    return { slot, id };
  } catch {
    return null;
  }
}
