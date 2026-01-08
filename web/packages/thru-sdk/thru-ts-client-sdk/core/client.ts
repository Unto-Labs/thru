import { CallOptions, Interceptor, Transport, createClient } from "@connectrpc/connect";
import { GrpcWebTransportOptions, createGrpcWebTransport } from "@connectrpc/connect-web";

import { DEFAULT_HOST } from "../defaults";
import { CommandService, QueryService, StreamingService } from "@thru/proto";

type PartialTransportOptions = Partial<GrpcWebTransportOptions>;

export interface ThruClientConfig {
    baseUrl?: string;
    transport?: Transport;
    transportOptions?: PartialTransportOptions;
    interceptors?: Interceptor[];
    callOptions?: CallOptions;
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
        callOptions: config.callOptions,
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

function mergeHeaders(a?: HeadersInit, b?: HeadersInit): HeadersInit | undefined {
    const entries: [string, string][] = [];
    const add = (init?: HeadersInit) => {
        if (!init) {
            return;
        }
        if (init instanceof Headers) {
            init.forEach((value, key) => {
                entries.push([key, value]);
            });
            return;
        }
        if (Array.isArray(init)) {
            for (const [key, value] of init) {
                entries.push([key, value]);
            }
            return;
        }
        for (const [key, value] of Object.entries(init)) {
            if (value !== undefined) {
                entries.push([key, String(value)]);
            }
        }
    };
    add(a);
    add(b);
    if (entries.length === 0) {
        return undefined;
    }
    return entries;
}
