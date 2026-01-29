/**
 * Runtime validation for parsed data.
 * Generates Zod schemas from column definitions for validation.
 */

import { z } from "zod";
import type { SchemaDefinition, AnyColumnDef } from "./types";

/**
 * Generate a Zod schema from column definitions.
 * Used for runtime validation of parse output.
 */
export function generateZodSchema<TSchema extends SchemaDefinition>(
  schema: TSchema
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, col] of Object.entries(schema)) {
    const colDef = col as AnyColumnDef;
    let zodType: z.ZodTypeAny;

    // Map column type to Zod type
    switch (colDef._columnType) {
      case "text":
        zodType = z.string();
        break;
      case "bigint":
        zodType = z.bigint();
        break;
      case "integer":
        zodType = z.number().int();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "timestamp":
        zodType = z.date();
        break;
      default:
        zodType = z.unknown();
    }

    // Handle nullability
    if (colDef._nullable) {
      zodType = zodType.nullable();
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

/**
 * Validate parsed data against schema.
 * Returns validation result with detailed errors.
 */
export function validateParsedData<TSchema extends SchemaDefinition>(
  schema: TSchema,
  data: unknown,
  streamName: string
): { success: true; data: unknown } | { success: false; error: string } {
  const zodSchema = generateZodSchema(schema);
  const result = zodSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errorMessages = result.error.errors
    .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
    .join("\n");

  return {
    success: false,
    error: `Stream "${streamName}" parse returned invalid data:\n${errorMessages}`,
  };
}
