import { Code, ConnectError, type Transport } from "@connectrpc/connect";

/** Where to send a caller for a key when the edge's message names no URL. */
export const THRU_DEFAULT_GET_KEY_URL = "https://dev.thru.org/keys?ref=sdk";

const GET_KEY_URL_PATTERN = /https:\/\/dev\.thru\.org\/keys(?:[/?#]\S*)?/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>"']+$/;
const UNKEYED_MARKER = "without an API key";
const RATE_LIMIT_PREFIX = "rate limit";
const RATE_LIMIT_BRAND = Symbol.for("thru.sdk.ThruRateLimitError");

/**
 * Thrown in place of the plain `ConnectError` when the Thru edge rejects a call
 * with `RESOURCE_EXHAUSTED` because the caller hit a rate limit.
 *
 * Requests without an API key share a low per-IP limit (`keyed === false`).
 * Get a free key with higher limits at `err.getKeyUrl` and pass it as
 * `createThruClient({ apiKey })`:
 *
 * ```ts
 * try {
 *     await thru.blocks.getBlockHeight();
 * } catch (err) {
 *     if (isThruRateLimitError(err) && !err.keyed) {
 *         console.error(`Rate limited. Get a free API key at ${err.getKeyUrl}`);
 *     }
 *     throw err;
 * }
 * ```
 *
 * It is a `ConnectError` subclass (same code, metadata and raw message), so
 * existing `err instanceof ConnectError` checks keep matching. Its `name`
 * stays `"ConnectError"` for that reason: connect's `instanceof` check
 * recognises subclasses by name. The original error is `err.cause`.
 */
export class ThruRateLimitError extends ConnectError {
    /** Page that creates a free API key. */
    readonly getKeyUrl: string;
    /** False when the limit hit is the shared one for requests without an API key. */
    readonly keyed: boolean;
    /** Seconds to wait before retrying, from the `retry-after` header when the transport exposes it. */
    readonly retryAfterSeconds: number | undefined;
    /** Brand for `instanceof`, which ConnectError's own check would answer for any ConnectError. */
    private readonly [RATE_LIMIT_BRAND] = true;

    constructor(cause: ConnectError) {
        super(cause.rawMessage, Code.ResourceExhausted, cause.metadata, undefined, cause);
        Object.assign(this, { details: cause.details });
        this.getKeyUrl = extractGetKeyUrl(cause.rawMessage) ?? THRU_DEFAULT_GET_KEY_URL;
        this.keyed = !cause.rawMessage.includes(UNKEYED_MARKER);
        this.retryAfterSeconds = parseRetryAfter(cause.metadata.get("retry-after"));
    }

    static override [Symbol.hasInstance](v: unknown): boolean {
        return typeof v === "object" && v !== null && (v as { [RATE_LIMIT_BRAND]?: unknown })[RATE_LIMIT_BRAND] === true;
    }
}

/** True when `err` is a {@link ThruRateLimitError}. */
export function isThruRateLimitError(err: unknown): err is ThruRateLimitError {
    return err instanceof ThruRateLimitError;
}

/**
 * Returns a {@link ThruRateLimitError} for a `ConnectError` with code
 * `RESOURCE_EXHAUSTED` whose message starts with `rate limit`, the same error
 * if it already is one, and `undefined` for anything else.
 */
export function toThruRateLimitError(err: unknown): ThruRateLimitError | undefined {
    if (err instanceof ThruRateLimitError) {
        return err;
    }
    if (!(err instanceof ConnectError)) {
        return undefined;
    }
    if (err.code !== Code.ResourceExhausted || !err.rawMessage.startsWith(RATE_LIMIT_PREFIX)) {
        return undefined;
    }
    return new ThruRateLimitError(err);
}

/**
 * Wraps a transport so that unary and streaming calls reject with a
 * {@link ThruRateLimitError} instead of the rate-limit `ConnectError`. Every
 * other error passes through unchanged. Streaming errors raised while
 * iterating the response are converted too.
 */
export function withThruRateLimitErrors(transport: Transport): Transport {
    return {
        async unary(method, signal, timeoutMs, header, input, contextValues) {
            try {
                return await transport.unary(method, signal, timeoutMs, header, input, contextValues);
            } catch (err) {
                throw toThruRateLimitError(err) ?? err;
            }
        },
        async stream(method, signal, timeoutMs, header, input, contextValues) {
            let response;
            try {
                response = await transport.stream(method, signal, timeoutMs, header, input, contextValues);
            } catch (err) {
                throw toThruRateLimitError(err) ?? err;
            }
            return { ...response, message: convertStreamErrors(response.message) };
        },
    };
}

async function* convertStreamErrors<T>(messages: AsyncIterable<T>): AsyncIterable<T> {
    try {
        yield* messages;
    } catch (err) {
        throw toThruRateLimitError(err) ?? err;
    }
}

function extractGetKeyUrl(message: string): string | undefined {
    const match = GET_KEY_URL_PATTERN.exec(message);
    if (!match) {
        return undefined;
    }
    return match[0].replace(TRAILING_PUNCTUATION, "");
}

/* retry-after is either delay-seconds or an HTTP-date (RFC 9110 10.2.3). */
function parseRetryAfter(value: string | null): number | undefined {
    if (value === null) {
        return undefined;
    }
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
    }
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) {
        return undefined;
    }
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
