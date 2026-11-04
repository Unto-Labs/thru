/**
 * Thru developer API keys.
 *
 * Keys are `thru_` followed by 32 characters from `[A-Za-z0-9]` (37 characters
 * total) and are sent as `Authorization: Bearer <key>` on every protocol.
 * A missing key means the request is treated as unkeyed, so nothing in this
 * module touches `process.env` directly: callers pass in whatever environment
 * object their runtime exposes.
 */

export const THRU_API_KEY_PATTERN = /^thru_[A-Za-z0-9]{32}$/;

/** Environment variable names consulted by {@link resolveThruApiKey}, in priority order. */
export const THRU_API_KEY_ENV_VARS = [
    "THRU_API_KEY",
    "NEXT_PUBLIC_THRU_API_KEY",
    "EXPO_PUBLIC_THRU_API_KEY",
] as const;

export type ThruApiKeyEnv = Partial<Record<string, string | undefined>>;

export function isValidThruApiKey(apiKey: unknown): apiKey is string {
    return typeof apiKey === "string" && THRU_API_KEY_PATTERN.test(apiKey);
}

/**
 * Throws if `apiKey` is not a well-formed Thru API key. The error message never
 * echoes the key itself so it is safe to surface in logs.
 */
export function assertValidThruApiKey(apiKey: string): void {
    if (typeof apiKey !== "string" || !THRU_API_KEY_PATTERN.test(apiKey)) {
        const length = typeof apiKey === "string" ? (apiKey as string).length : 0;
        throw new Error(
            "Invalid Thru API key: expected `thru_` followed by 32 alphanumeric characters " +
                `(37 characters total), got ${length} characters`,
        );
    }
}

/**
 * Reads the Thru API key from an environment-like object, checking
 * `THRU_API_KEY`, then `NEXT_PUBLIC_THRU_API_KEY`, then `EXPO_PUBLIC_THRU_API_KEY`.
 * Blank values are treated as unset. Returns `undefined` when no key is set so
 * clients fall back to unkeyed requests.
 *
 * Note for bundlers (Next.js, Expo): `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` values are
 * inlined only when referenced as a static `process.env.NAME` expression, so
 * browser callers should pass an object literal such as
 * `{ NEXT_PUBLIC_THRU_API_KEY: process.env.NEXT_PUBLIC_THRU_API_KEY }`.
 */
export function resolveThruApiKey(env: ThruApiKeyEnv | undefined | null): string | undefined {
    if (!env) {
        return undefined;
    }
    for (const name of THRU_API_KEY_ENV_VARS) {
        const value = env[name];
        if (typeof value !== "string") {
            continue;
        }
        const trimmed = value.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return undefined;
}

/** Builds the `Authorization` header pair for a key, validating it first. */
export function thruApiKeyHeader(apiKey: string): [string, string] {
    assertValidThruApiKey(apiKey);
    return ["Authorization", `Bearer ${apiKey}`];
}
