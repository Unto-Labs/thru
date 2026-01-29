/**
 * Route generation for event and account streams.
 *
 * Auto-generates list and get routes with filtering and pagination.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { DatabaseClient } from "../schema/types";
import type { EventStream } from "../streams/types";
import type { AccountStream } from "../accounts/types";
import {
  paginationQuerySchema,
  dataResponse,
  listResponse,
  errorSchema,
  paginate,
  parseCursor,
  type PaginationQuery,
} from "./pagination";
import { generateSchemas, type GeneratedSchemas } from "./schemas";

// ============================================================
// Types
// ============================================================

export interface MountRoutesOptions {
  /** Database client */
  db: DatabaseClient;
  /** Event streams to create routes for */
  eventStreams?: EventStream[];
  /** Account streams to create routes for */
  accountStreams?: AccountStream[];
  /** Path prefix (default: "/api/v1") */
  pathPrefix?: string;
}

// ============================================================
// Utilities
// ============================================================

function pascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

// ============================================================
// Route Builders
// ============================================================

interface BuildRoutesConfig {
  db: DatabaseClient;
  name: string;
  table: PgTableWithColumns<any>;
  schemas: GeneratedSchemas;
  filters: string[];
  idField: string;
  resourceType: "event" | "account";
  includeSlotFilters: boolean;
  sortField: string;
  secondarySortField?: string;
}

function buildRoutes(config: BuildRoutesConfig): OpenAPIHono {
  const {
    db,
    name,
    table,
    schemas,
    filters,
    idField,
    resourceType,
    includeSlotFilters,
    sortField,
    secondarySortField,
  } = config;

  const router = new OpenAPIHono();
  const tag = pascalCase(name);

  // Build filter query params schema
  const filterFields: Record<string, z.ZodTypeAny> = {};
  for (const field of filters) {
    filterFields[field] = z.string().optional().openapi({
      description: `Filter by ${field}`,
    });
  }

  // Add slot range filters for event streams
  if (includeSlotFilters) {
    filterFields.fromSlot = z.string().optional().openapi({
      description: "Minimum slot number",
    });
    filterFields.toSlot = z.string().optional().openapi({
      description: "Maximum slot number",
    });
  }

  const listQuerySchema = paginationQuerySchema.extend(filterFields);

  // GET / - List route
  const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: [tag],
    summary: `List ${name} ${resourceType}s`,
    description: `Returns a paginated list of ${name} ${resourceType}s with optional filtering.`,
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: `List of ${name} ${resourceType}s`,
        content: { "application/json": { schema: listResponse(schemas.api) } },
      },
    },
  });

  router.openapi(listRoute, async (c) => {
    const query = c.req.valid("query") as PaginationQuery &
      Record<string, string | undefined>;
    const conditions: SQL[] = [];

    // Apply custom filters
    for (const field of filters) {
      const value = query[field];
      if (value !== undefined && value !== "") {
        conditions.push(eq((table as any)[field], value));
      }
    }

    // Apply slot range filters
    if (includeSlotFilters) {
      if (query.fromSlot) {
        conditions.push(gte((table as any).slot, BigInt(query.fromSlot)));
      }
      if (query.toSlot) {
        conditions.push(lte((table as any).slot, BigInt(query.toSlot)));
      }
    }

    // Apply cursor (for event streams with slot + id)
    if (query.cursor && secondarySortField) {
      const parsed = parseCursor(query.cursor);
      if (parsed) {
        conditions.push(
          sql`(${(table as any).slot} < ${parsed.slot} OR (${(table as any).slot} = ${parsed.slot} AND ${(table as any)[secondarySortField]} < ${parsed.id}))`
        );
      }
    }

    // Build order by clause
    const orderBy = secondarySortField
      ? [desc((table as any)[sortField]), desc((table as any)[secondarySortField])]
      : [desc((table as any)[sortField])];

    const rows = await db
      .select()
      .from(table)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(query.limit + 1)
      .offset(query.cursor ? 0 : query.offset);

    const result = paginate(rows, query);

    return c.json({
      data: result.data.map((row) =>
        schemas.serialize(row as Record<string, unknown>)
      ),
      pagination: result.pagination,
    });
  });

  // GET /:id - Get by ID route
  const getRoute = createRoute({
    method: "get",
    path: `/{${idField}}`,
    tags: [tag],
    summary: `Get ${name} ${resourceType} by ${idField}`,
    description: `Returns a single ${name} ${resourceType} by its ${idField}.`,
    request: {
      params: z.object({
        [idField]: z
          .string()
          .openapi({ description: `${pascalCase(resourceType)} ${idField}` }),
      }),
    },
    responses: {
      200: {
        description: `${pascalCase(name)} ${resourceType} found`,
        content: { "application/json": { schema: dataResponse(schemas.api) } },
      },
      404: {
        description: `${pascalCase(resourceType)} not found`,
        content: { "application/json": { schema: errorSchema } },
      },
    },
  });

  // @ts-expect-error - OpenAPI handler with multiple response types
  router.openapi(getRoute, async (c) => {
    const id = c.req.param(idField);

    const [row] = await db
      .select()
      .from(table)
      .where(eq((table as any)[idField], id))
      .limit(1);

    if (!row) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({
      data: schemas.serialize(row as Record<string, unknown>),
    });
  });

  return router;
}

// ============================================================
// Mount Routes
// ============================================================

/**
 * Mount auto-generated routes for event and account streams.
 *
 * @param app - Hono app to mount routes on
 * @param options - Configuration options
 *
 * @example
 * ```ts
 * import { OpenAPIHono } from "@hono/zod-openapi";
 * import { mountStreamRoutes } from "@thru/indexer";
 * import { transfers } from "./streams/transfers";
 * import { tokenAccounts } from "./account-streams/token-accounts";
 *
 * const app = new OpenAPIHono();
 *
 * mountStreamRoutes(app, {
 *   db,
 *   eventStreams: [transfers],
 *   accountStreams: [tokenAccounts],
 * });
 *
 * // Routes generated:
 * // GET /api/v1/transfers
 * // GET /api/v1/transfers/:id
 * // GET /api/v1/token-accounts
 * // GET /api/v1/token-accounts/:address
 * ```
 */
export function mountStreamRoutes(
  app: OpenAPIHono,
  options: MountRoutesOptions
): void {
  const {
    db,
    eventStreams = [],
    accountStreams = [],
    pathPrefix = "/api/v1",
  } = options;

  // Mount event stream routes
  for (const stream of eventStreams) {
    if (stream.api?.enabled === false) continue;

    const schemas = generateSchemas(stream.table, stream.name, "Event");
    const filters = (stream.api?.filters ?? []) as string[];
    const idField = (stream.api?.idField ?? "id") as string;

    const router = buildRoutes({
      db,
      name: stream.name,
      table: stream.table,
      schemas,
      filters,
      idField,
      resourceType: "event",
      includeSlotFilters: true,
      sortField: "slot",
      secondarySortField: "id",
    });

    app.route(`${pathPrefix}/${stream.name}`, router);
  }

  // Mount account stream routes
  for (const stream of accountStreams) {
    if (stream.api?.enabled === false) continue;

    const schemas = generateSchemas(stream.table, stream.name, "Account");
    const filters = (stream.api?.filters ?? []) as string[];
    const idField = (stream.api?.idField ?? "address") as string;

    const router = buildRoutes({
      db,
      name: stream.name,
      table: stream.table,
      schemas,
      filters,
      idField,
      resourceType: "account",
      includeSlotFilters: false,
      sortField: "updatedAt",
      secondarySortField: undefined,
    });

    app.route(`${pathPrefix}/${stream.name}`, router);
  }
}
