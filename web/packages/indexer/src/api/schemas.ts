/**
 * Schema generation utilities.
 *
 * Generates Zod schemas and serializers from Drizzle tables.
 */

import { z } from "@hono/zod-openapi";
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { getTableColumns } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";

// ============================================================
// Types
// ============================================================

export interface GeneratedSchemas {
  /** Row schema (database types) */
  row: z.ZodTypeAny;
  /** Insert schema (validation for inserts) */
  insert: z.ZodTypeAny;
  /** API output schema (serialized for JSON) */
  api: z.ZodTypeAny;
  /** Serialize a database row for API output */
  serialize: (row: Record<string, unknown>) => Record<string, unknown>;
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
// Schema Generation
// ============================================================

/**
 * Generate Zod schemas from a Drizzle table.
 *
 * Handles bigint → string and Date → ISO string serialization
 * for JSON-safe API responses.
 *
 * @param table - Drizzle table
 * @param name - Schema name for OpenAPI
 * @param suffix - Suffix for OpenAPI schema name (e.g., "Event", "Account")
 * @returns Generated schemas and serializer
 */
export function generateSchemas(
  table: PgTableWithColumns<any>,
  name: string,
  suffix: string = ""
): GeneratedSchemas {
  const rowSchema = createSelectSchema(table);
  const insertSchema = createInsertSchema(table);

  // Build API schema with serialization transforms
  const apiFields: Record<string, z.ZodTypeAny> = {};
  const columns = getTableColumns(table);

  for (const [colName, col] of Object.entries(columns)) {
    const dataType = (col as any).dataType;
    const notNull = (col as any).notNull;

    let fieldSchema: z.ZodTypeAny;
    switch (dataType) {
      case "bigint":
        // Serialize bigint as string for JSON safety
        fieldSchema = z.string().openapi({ description: `${colName} (bigint)` });
        break;
      case "date":
        // Serialize Date as ISO string
        fieldSchema = z.string().openapi({ description: `${colName} (ISO timestamp)` });
        break;
      case "string":
        fieldSchema = z.string();
        break;
      case "number":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      default:
        fieldSchema = z.any();
    }

    if (!notNull) {
      fieldSchema = fieldSchema.nullable();
    }

    apiFields[colName] = fieldSchema;
  }

  const schemaName = suffix ? `${pascalCase(name)}${suffix}` : pascalCase(name);
  const apiSchema = z.object(apiFields).openapi(schemaName);

  // Build serializer function
  const serialize = (row: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "bigint") {
        result[key] = value.toString();
      } else if (value instanceof Date) {
        result[key] = value.toISOString();
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  return {
    row: rowSchema as unknown as z.ZodTypeAny,
    insert: insertSchema as unknown as z.ZodTypeAny,
    api: apiSchema as z.ZodTypeAny,
    serialize,
  };
}
