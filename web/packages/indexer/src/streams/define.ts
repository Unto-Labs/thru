import type { Filter } from "@thru/replay";
import type { SchemaDefinition } from "../schema/types";
import { buildDrizzleTable } from "../schema/table";
import type { EventStreamDefinition, EventStream } from "./types";

function pascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Define an event stream for indexing blockchain events.
 *
 * @param definition - Stream definition with schema, filter, and parse function
 * @returns A compiled event stream ready for use with the indexer
 */
export function defineEventStream<TSchema extends SchemaDefinition>(
  definition: EventStreamDefinition<TSchema>
): EventStream<TSchema> {
  if (!definition.filter && !definition.filterFactory) {
    throw new Error(`Stream "${definition.name}" must provide either filter or filterFactory`);
  }

  const tableName =
    definition.tableName ?? `${definition.name.replace(/s$/, "")}_events`;

  const table = buildDrizzleTable(
    tableName,
    definition.schema,
    definition.indexes,
    definition.extraConfig
  );

  let cachedFilter: Filter | null = definition.filter ?? null;
  const getFilter = (): Filter => {
    if (!cachedFilter) {
      if (definition.filterFactory) {
        cachedFilter = definition.filterFactory();
      } else {
        throw new Error(`Stream "${definition.name}" has no filter configured`);
      }
    }
    return cachedFilter;
  };

  return {
    name: definition.name,
    description: definition.description ?? `${pascalCase(definition.name)} events`,
    schema: definition.schema,
    table,
    c: table as any,
    getFilter,
    parse: definition.parse,
    api: definition.api,
    filterBatch: definition.filterBatch,
    onCommit: definition.onCommit,
  };
}
