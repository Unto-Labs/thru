import { CallOptions, Interceptor, Transport, createClient } from "@connectrpc/connect";
import { GrpcWebTransportOptions, createGrpcWebTransport } from "@connectrpc/connect-web";

import { DEFAULT_HOST } from "../defaults";
import { thruApiKeyHeader } from "./api-key";
import {
    resolveTransactionSigningScheme,
    TransactionSigningScheme,
} from "../domain/transactions/transaction-signing-scheme";
import { CommandService, QueryService, StreamingService } from "@thru/sdk/proto";

type PartialTransportOptions = Partial<GrpcWebTransportOptions>;

export interface ThruClientConfig {
    baseUrl?: string;
    transport?: Transport;
    transportOptions?: PartialTransportOptions;
    interceptors?: Interceptor[];
    callOptions?: CallOptions;
    /**
     * Thru developer API key (`thru_` + 32 alphanumerics). When set, every RPC
     * carries `Authorization: Bearer <apiKey>` via the default call options,
     * which also applies when a custom `transport` is supplied. Leave unset for
     * unkeyed requests.
     */
    apiKey?: string;
    transactionSigningScheme?: TransactionSigningScheme;
}

type QueryClient = ReturnType<typeof createClient<typeof QueryService>>;
type CommandClient = ReturnType<typeof createClient<typeof CommandService>>;
type StreamingClient = ReturnType<typeof createClient<typeof StreamingService>>;

export interface ThruClientContext {
    baseUrl: string;
    transport: Transport;
    query: QueryClient;
    command: CommandClient;
    streaming: StreamingClient;
    callOptions?: CallOptions;
    transactionSigningScheme: TransactionSigningScheme;
}

export function createThruClientContext(config: ThruClientConfig = {}): ThruClientContext {
    const transportOptions = config.transportOptions ?? {};
    const { baseUrl: optionsBaseUrl, interceptors: optionInterceptors, ...restTransportOptions } = transportOptions;
    const baseUrl = config.baseUrl ?? optionsBaseUrl ?? DEFAULT_HOST;
    const mergedInterceptors = [
        ...(optionInterceptors ?? []),
        ...(config.interceptors ?? []),
    ];
    const transport =
        config.transport ??
        createGrpcWebTransport({
        baseUrl,
            ...(restTransportOptions as Omit<GrpcWebTransportOptions, "baseUrl">),
            interceptors: mergedInterceptors.length > 0 ? mergedInterceptors : undefined,
    });

    return {
        baseUrl,
        transport,
        query: createClient(QueryService, transport),
        command: createClient(CommandService, transport),
        streaming: createClient(StreamingService, transport),
        callOptions: withApiKey(config.callOptions, config.apiKey),
        transactionSigningScheme: resolveTransactionSigningScheme(
            config.transactionSigningScheme,
        ),
    };
}

function withApiKey(callOptions: CallOptions | undefined, apiKey: string | undefined): CallOptions | undefined {
    // Treat unset and blank the same way so `apiKey: process.env.THRU_API_KEY`
    // is safe to write before any key exists.
    const trimmed = apiKey?.trim();
    if (!trimmed) {
        return callOptions;
    }
    // The apiKey header goes first so an explicit Authorization in
    // callOptions.headers replaces it rather than the other way round.
    const authHeader = thruApiKeyHeader(trimmed);
    return {
        ...callOptions,
        headers: mergeHeaders([authHeader], callOptions?.headers),
    };
}

export function withCallOptions(ctx: ThruClientContext, overrides?: CallOptions): CallOptions | undefined {
    return mergeCallOptions(ctx.callOptions, overrides);
}

function mergeCallOptions(defaults?: CallOptions, overrides?: CallOptions): CallOptions | undefined {
    if (!defaults) {
        return overrides;
    }
    if (!overrides) {
        return defaults;
    }
    return {
        ...defaults,
        ...overrides,
        headers: mergeHeaders(defaults.headers, overrides.headers),
        contextValues: overrides.contextValues ?? defaults.contextValues,
        onHeader: overrides.onHeader ?? defaults.onHeader,
        onTrailer: overrides.onTrailer ?? defaults.onTrailer,
    };
}

/* Later entries replace earlier ones with the same (case-insensitive) header
   name. connect's Headers constructor joins duplicate names with ", ", so
   appending would turn an apiKey default plus a per-call Authorization into
   "Bearer a, Bearer b". */
function mergeHeaders(a?: HeadersInit, b?: HeadersInit): HeadersInit | undefined {
    const entries = new Map<string, [string, string]>();
    const put = (key: string, value: string) => {
        const name = key.toLowerCase();
        entries.delete(name);
        entries.set(name, [key, value]);
    };
    const add = (init?: HeadersInit) => {
        if (!init) {
            return;
        }
        if (init instanceof Headers) {
            init.forEach((value, key) => {
                put(key, value);
            });
            return;
        }
        if (Array.isArray(init)) {
            for (const [key, value] of init) {
                put(key, value);
            }
            return;
        }
        for (const [key, value] of Object.entries(init)) {
            if (value !== undefined) {
                put(key, String(value));
            }
        }
    };
    add(a);
    add(b);
    if (entries.size === 0) {
        return undefined;
    }
    return [...entries.values()];
}
