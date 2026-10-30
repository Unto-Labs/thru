import type { SchemaDefinition } from "../schema/types";
import { buildDrizzleTable } from "../schema/table";
import type { AccountStreamDefinition, AccountStream } from "./types";

function pascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Define an account stream for indexing on-chain account state.
 *
 * @param definition - Stream definition with schema, ownerProgram, and parse function
 * @returns A compiled account stream ready for use with the indexer
 */
export function defineAccountStream<TSchema extends SchemaDefinition>(
  definition: AccountStreamDefinition<TSchema>
): AccountStream<TSchema> {
  if (!definition.ownerProgram && !definition.ownerProgramFactory) {
    throw new Error(`Stream "${definition.name}" must provide either ownerProgram or ownerProgramFactory`);
  }

  const tableName = definition.name.replace(/-/g, "_");

  const table = buildDrizzleTable(
    tableName,
    definition.schema,
    definition.indexes,
    definition.extraConfig
  );

  let cachedOwnerProgram: Uint8Array | null = definition.ownerProgram ?? null;
  const getOwnerProgram = (): Uint8Array => {
    if (!cachedOwnerProgram) {
      if (definition.ownerProgramFactory) {
        cachedOwnerProgram = definition.ownerProgramFactory();
      } else {
        throw new Error(`Stream "${definition.name}" has no ownerProgram configured`);
      }
    }
    return cachedOwnerProgram;
  };

  return {
    name: definition.name,
    description: definition.description ?? `${pascalCase(definition.name)} accounts`,
    schema: definition.schema,
    getOwnerProgram,
    expectedSize: definition.expectedSize,
    dataSizes: definition.dataSizes,
    table,
    c: table as any,
    parse: definition.parse,
    api: definition.api,
  };
}
