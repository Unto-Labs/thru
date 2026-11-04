import { createBoundThruClient, Thru } from "./core/bound-client";
import { createThruClientContext, ThruClientConfig } from "./core/client";

// ============================================================================
// Type Exports
// ============================================================================
export type { Thru } from "./core/bound-client";
export type { ThruClientConfig } from "./core/client";
export type { ThruApiKeyEnv } from "./core/api-key";

// ============================================================================
// Value Exports (functions)
// ============================================================================
export {
    THRU_API_KEY_ENV_VARS,
    THRU_API_KEY_PATTERN,
    assertValidThruApiKey,
    isValidThruApiKey,
    resolveThruApiKey,
    thruApiKeyHeader,
} from "./core/api-key";

export function createThruClient(config: ThruClientConfig = {}): Thru {
    const ctx = createThruClientContext(config);
    return createBoundThruClient(ctx);
}