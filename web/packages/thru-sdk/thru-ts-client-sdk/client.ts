import { createBoundThruClient, Thru } from "./core/bound-client";
import { createThruClientContext, ThruClientConfig } from "./core/client";

export type { Thru } from "./core/bound-client";

export function createThruClient(config: ThruClientConfig = {}): Thru {
    const ctx = createThruClientContext(config);
    return createBoundThruClient(ctx);
}