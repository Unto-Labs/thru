/** Explicit budgets for repository-owned operations; generic SDK defaults stay zero. */
export interface TransactionResources {
  computeUnits: number;
  stateUnits: number;
  memoryUnits: number;
}

export const ACCOUNT_CREATION_RESOURCES: Readonly<TransactionResources> = {
  computeUnits: 10_000,
  stateUnits: 1,
  memoryUnits: 10_000,
};

/** General compute/memory budget. Account growth needs an explicit state budget.
 * Explicit zero overrides are preserved for operations that do not grow state.
 */
export function programResources(
  overrides: Partial<TransactionResources> = {},
): TransactionResources {
  return {
    computeUnits: overrides.computeUnits ?? 300_000_000,
    stateUnits: overrides.stateUnits ?? 0,
    memoryUnits: overrides.memoryUnits ?? 10_000,
  };
}
