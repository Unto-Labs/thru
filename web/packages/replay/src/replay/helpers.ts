import { Filter } from "../proto/thru/common/v1/filters_pb";
import { PageResponse } from "../proto/thru/common/v1/pagination_pb";
import type { Slot } from "../types";

export function combineFilters(base?: Filter, user?: Filter): Filter | undefined {
  if (!base && !user) return undefined;
  if (!base) return user;
  if (!user) return base;
  const expressionParts: string[] = [];
  if (base.expression) expressionParts.push(`(${base.expression})`);
  if (user.expression) expressionParts.push(`(${user.expression})`);
  return new Filter({
    expression: expressionParts.join(" && ") || undefined,
    params: { ...base.params, ...user.params },
  });
}

export function slotLiteralFilter(fieldExpr: string, slot: Slot): Filter {
  return new Filter({
    expression: `${fieldExpr} >= uint(${slot.toString()})`,
  });
}

export function backfillPage<T>(
  items: T[],
  page?: PageResponse,
): { items: T[]; cursor?: string; done: boolean } {
  const cursor = page?.nextPageToken ?? undefined;
  return {
    items,
    cursor,
    done: !cursor,
  };
}

export async function* mapAsyncIterable<S, T>(
  iterable: AsyncIterable<S>,
  selector: (value: S) => T | null | undefined,
): AsyncGenerator<T> {
  for await (const value of iterable) {
    const mapped = selector(value);
    if (mapped !== undefined && mapped !== null) yield mapped;
  }
}
