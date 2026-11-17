import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { QueryService, StreamingService } from "@thru/sdk/proto";
import { describe, expect, it, vi } from "vitest";

import { createThruClient } from "../../client";
import {
    THRU_DEFAULT_GET_KEY_URL,
    ThruRateLimitError,
    isThruRateLimitError,
    toThruRateLimitError,
} from "../rate-limit";

const UNKEYED_MESSAGE =
    'rate limit for requests without an API key exceeded (10 weighted requests/s per IP). Get a free key with higher limits at https://dev.thru.org/keys?ref=edge-429 and send it as "Authorization: Bearer thru_...". Docs: https://thru.org/docs/api-ref/rate-limits/';
const KEYED_MESSAGE = "rate limit exceeded";

describe("toThruRateLimitError", () => {
    it("converts the unkeyed edge denial", () => {
        const cause = new ConnectError(UNKEYED_MESSAGE, Code.ResourceExhausted, { "retry-after": "1" });
        const err = toThruRateLimitError(cause);
        expect(err).toBeInstanceOf(ThruRateLimitError);
        expect(err).toBeInstanceOf(Error);
        // A ConnectError subclass: existing `instanceof ConnectError` checks keep matching.
        expect(err).toBeInstanceOf(ConnectError);
        expect(cause).not.toBeInstanceOf(ThruRateLimitError);
        expect(err?.rawMessage).toBe(UNKEYED_MESSAGE);
        expect(err?.message).toBe(`[resource_exhausted] ${UNKEYED_MESSAGE}`);
        expect(err?.code).toBe(Code.ResourceExhausted);
        expect(err?.keyed).toBe(false);
        expect(err?.getKeyUrl).toBe("https://dev.thru.org/keys?ref=edge-429");
        expect(err?.retryAfterSeconds).toBe(1);
        expect(err?.cause).toBe(cause);
        expect(isThruRateLimitError(err)).toBe(true);
    });

    it("converts the keyed denial and falls back to the SDK key URL", () => {
        const err = toThruRateLimitError(new ConnectError(KEYED_MESSAGE, Code.ResourceExhausted));
        expect(err?.keyed).toBe(true);
        expect(err?.rawMessage).toBe(KEYED_MESSAGE);
        expect(err?.getKeyUrl).toBe(THRU_DEFAULT_GET_KEY_URL);
        expect(err?.getKeyUrl).toBe("https://dev.thru.org/keys?ref=sdk");
        expect(err?.retryAfterSeconds).toBeUndefined();
    });

    it("takes the first dev.thru.org/keys URL and drops trailing punctuation", () => {
        const err = toThruRateLimitError(
            new ConnectError(
                "rate limit exceeded, see https://thru.org/docs and https://dev.thru.org/keys. Or https://dev.thru.org/keys?ref=other",
                Code.ResourceExhausted,
            ),
        );
        expect(err?.getKeyUrl).toBe("https://dev.thru.org/keys");
    });

    it("reads an HTTP-date retry-after", () => {
        const at = new Date(Date.now() + 5_000).toUTCString();
        const err = toThruRateLimitError(
            new ConnectError(KEYED_MESSAGE, Code.ResourceExhausted, { "retry-after": at }),
        );
        expect(err?.retryAfterSeconds).toBeGreaterThanOrEqual(3);
        expect(err?.retryAfterSeconds).toBeLessThanOrEqual(5);
    });

    it("ignores an unparseable retry-after", () => {
        const err = toThruRateLimitError(
            new ConnectError(KEYED_MESSAGE, Code.ResourceExhausted, { "retry-after": "soon" }),
        );
        expect(err?.retryAfterSeconds).toBeUndefined();
    });

    it("leaves other RESOURCE_EXHAUSTED errors alone", () => {
        expect(toThruRateLimitError(new ConnectError("stream byte budget exceeded", Code.ResourceExhausted))).toBeUndefined();
        expect(toThruRateLimitError(new ConnectError("Rate limit exceeded", Code.ResourceExhausted))).toBeUndefined();
    });

    it("leaves a rate-limit message with another code alone", () => {
        expect(toThruRateLimitError(new ConnectError(KEYED_MESSAGE, Code.Unavailable))).toBeUndefined();
    });

    it("leaves non-ConnectError values alone", () => {
        expect(toThruRateLimitError(new Error(KEYED_MESSAGE))).toBeUndefined();
        expect(toThruRateLimitError(KEYED_MESSAGE)).toBeUndefined();
        expect(toThruRateLimitError(undefined)).toBeUndefined();
        expect(isThruRateLimitError(new ConnectError(KEYED_MESSAGE, Code.ResourceExhausted))).toBe(false);
    });

    it("returns an existing ThruRateLimitError as is", () => {
        const err = new ThruRateLimitError(new ConnectError(KEYED_MESSAGE, Code.ResourceExhausted));
        expect(toThruRateLimitError(err)).toBe(err);
    });
});

function rateLimitedTransport(message: string, code: Code = Code.ResourceExhausted) {
    return createRouterTransport(({ service }) => {
        service(QueryService, {
            getHeight() {
                throw new ConnectError(message, code, { "retry-after": "2" });
            },
        });
        service(StreamingService, {
            async *streamHeight() {
                yield { finalized: 7n, locallyExecuted: 8n, clusterExecuted: 9n };
                throw new ConnectError(message, code);
            },
        });
    });
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const value of iterable) {
        out.push(value);
    }
    return out;
}

describe("caller-supplied transport", () => {
    it("rejects a unary call with ThruRateLimitError", async () => {
        const thru = createThruClient({ transport: rateLimitedTransport(UNKEYED_MESSAGE) });
        const err = await thru.blocks.getBlockHeight().catch((e: unknown) => e);
        expect(isThruRateLimitError(err)).toBe(true);
        const rateLimit = err as ThruRateLimitError;
        expect(rateLimit.keyed).toBe(false);
        expect(rateLimit.getKeyUrl).toBe("https://dev.thru.org/keys?ref=edge-429");
        expect(rateLimit.retryAfterSeconds).toBe(2);
        expect(rateLimit.cause).toBeInstanceOf(ConnectError);
        expect(rateLimit.cause.code).toBe(Code.ResourceExhausted);
    });

    it("converts an error raised while iterating a stream", async () => {
        const thru = createThruClient({ transport: rateLimitedTransport(KEYED_MESSAGE) });
        const seen: bigint[] = [];
        const err = await (async () => {
            for await (const { height } of thru.blocks.streamHeight()) {
                seen.push(height.finalized);
            }
        })().catch((e: unknown) => e);
        expect(seen).toEqual([7n]);
        expect(isThruRateLimitError(err)).toBe(true);
        expect((err as ThruRateLimitError).keyed).toBe(true);
    });

    it("passes other errors through unchanged", async () => {
        const thru = createThruClient({ transport: rateLimitedTransport("quota exceeded") });
        const unary = await thru.blocks.getBlockHeight().catch((e: unknown) => e);
        expect(unary).toBeInstanceOf(ConnectError);
        expect(isThruRateLimitError(unary)).toBe(false);
        expect((unary as ConnectError).rawMessage).toBe("quota exceeded");

        const stream = await drain(thru.blocks.streamHeight()).catch((e: unknown) => e);
        expect(stream).toBeInstanceOf(ConnectError);
        expect(isThruRateLimitError(stream)).toBe(false);
    });

    it("passes a rate-limit message with another code through unchanged", async () => {
        const thru = createThruClient({ transport: rateLimitedTransport(KEYED_MESSAGE, Code.Unavailable) });
        const err = await thru.blocks.getBlockHeight().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ConnectError);
        expect((err as ConnectError).code).toBe(Code.Unavailable);
    });

    it("still returns values when nothing fails", async () => {
        const transport = createRouterTransport(({ service }) => {
            service(QueryService, {
                getHeight() {
                    return { finalized: 1n, locallyExecuted: 2n, clusterExecuted: 3n };
                },
            });
        });
        const thru = createThruClient({ transport });
        const height = await thru.blocks.getBlockHeight();
        expect(height.finalized).toBe(1n);
    });
});

describe("SDK-built gRPC-web transport", () => {
    /* The edge answers a denied gRPC-web request with a trailers-only
       response: HTTP 200, grpc-status 8 and the message in the headers. */
    function edgeDenialFetch(message: string) {
        return vi.fn(async () =>
            new Response(null, {
                status: 200,
                headers: {
                    "content-type": "application/grpc-web+proto",
                    "grpc-status": String(Code.ResourceExhausted),
                    "grpc-message": message,
                    "retry-after": "1",
                    "x-ratelimit-limit": "10",
                    "x-ratelimit-remaining": "0",
                },
            }),
        );
    }

    it("rejects a unary call with ThruRateLimitError", async () => {
        const fetch = edgeDenialFetch(UNKEYED_MESSAGE);
        const thru = createThruClient({ baseUrl: "https://rpc.example", transportOptions: { fetch } });
        const err = await thru.blocks.getBlockHeight().catch((e: unknown) => e);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(isThruRateLimitError(err)).toBe(true);
        const rateLimit = err as ThruRateLimitError;
        expect(rateLimit.rawMessage).toBe(UNKEYED_MESSAGE);
        expect(rateLimit.keyed).toBe(false);
        expect(rateLimit.getKeyUrl).toBe("https://dev.thru.org/keys?ref=edge-429");
        expect(rateLimit.retryAfterSeconds).toBe(1);
        expect(rateLimit.cause).toBeInstanceOf(ConnectError);
    });

    it("rejects a streaming call with ThruRateLimitError", async () => {
        const fetch = edgeDenialFetch(KEYED_MESSAGE);
        const thru = createThruClient({ baseUrl: "https://rpc.example", transportOptions: { fetch } });
        const err = await drain(thru.blocks.streamHeight()).catch((e: unknown) => e);
        expect(isThruRateLimitError(err)).toBe(true);
        expect((err as ThruRateLimitError).keyed).toBe(true);
        expect((err as ThruRateLimitError).retryAfterSeconds).toBe(1);
    });
});
