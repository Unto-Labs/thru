import { createBoundThruClient, Thru } from "./core/bound-client";
import { createThruClientContext, ThruClientConfig } from "./core/client";

// ============================================================================
// Type Exports
// ============================================================================
export type { Thru } from "./core/bound-client";
export type { ThruClientConfig } from "./core/client";

// ============================================================================
// Value Exports (functions)
// ============================================================================
export function createThruClient(config: ThruClientConfig = {}): Thru {
    const ctx = createThruClientContext(config);
    return createBoundThruClient(ctx);
}