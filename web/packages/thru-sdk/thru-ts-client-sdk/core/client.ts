import { createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

import { DEFAULT_HOST } from "../defaults";
import { CommandService } from "../proto/thru/services/v1/command_service_pb";
import { QueryService } from "../proto/thru/services/v1/query_service_pb";
import { StreamingService } from "../proto/thru/services/v1/streaming_service_pb";

export interface ThruClientConfig {
    baseUrl?: string;
}

type QueryClient = ReturnType<typeof createClient<typeof QueryService>>;
type CommandClient = ReturnType<typeof createClient<typeof CommandService>>;
type StreamingClient = ReturnType<typeof createClient<typeof StreamingService>>;

export interface ThruClientContext {
    baseUrl: string;
    transport: ReturnType<typeof createGrpcWebTransport>;
    query: QueryClient;
    command: CommandClient;
    streaming: StreamingClient;
}

export function createThruClientContext(config: ThruClientConfig = {}): ThruClientContext {
    const baseUrl = config.baseUrl ?? DEFAULT_HOST;
    const transport = createGrpcWebTransport({
        baseUrl,
    });

    return {
        baseUrl,
        transport,
        query: createClient(QueryService, transport),
        command: createClient(CommandService, transport),
        streaming: createClient(StreamingService, transport),
    };
}
