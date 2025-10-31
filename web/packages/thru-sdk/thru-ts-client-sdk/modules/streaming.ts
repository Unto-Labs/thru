import { create } from "@bufbuild/protobuf";

import { BytesLike } from "@thru/helpers";
import type { ThruClientContext } from "../core/client";
import type { TrackTransactionResponse } from "../proto/thru/services/v1/streaming_service_pb";
import { TrackTransactionRequestSchema } from "../proto/thru/services/v1/streaming_service_pb";
import { toSignature as toSignatureMessage } from "./helpers";

export interface TrackTransactionOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}

export function trackTransaction(
    ctx: ThruClientContext,
    signature: BytesLike,
    options: TrackTransactionOptions = {},
): AsyncIterable<TrackTransactionResponse> {
    const timeoutMs = options.timeoutMs;
    const request = create(TrackTransactionRequestSchema, {
        signature: toSignatureMessage(signature),
        timeout:
            timeoutMs != null
                ? {
                    seconds: BigInt(Math.floor(timeoutMs / 1000)),
                    nanos: (timeoutMs % 1000) * 1_000_000,
                }
                : undefined,
    });

    return ctx.streaming.trackTransaction(request, {
        signal: options.signal,
    });
}
