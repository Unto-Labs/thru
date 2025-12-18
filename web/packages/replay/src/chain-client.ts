import type { PartialMessage } from "@bufbuild/protobuf";
import {
  type CallOptions,
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { QueryService } from "./proto/thru/services/v1/query_service_connect";
import {
  GetHeightRequest,
  type GetHeightResponse,
  ListBlocksRequest,
  type ListBlocksResponse,
  ListEventsRequest,
  type ListEventsResponse,
  ListTransactionsRequest,
  type ListTransactionsResponse,
} from "./proto/thru/services/v1/query_service_pb";
import { StreamingService } from "./proto/thru/services/v1/streaming_service_connect";
import {
  StreamBlocksRequest,
  type StreamBlocksResponse,
  StreamEventsRequest,
  type StreamEventsResponse,
  StreamTransactionsRequest,
  type StreamTransactionsResponse,
} from "./proto/thru/services/v1/streaming_service_pb";

export interface ChainClientOptions {
  baseUrl?: string;
  apiKey?: string;
  userAgent?: string;
  httpVersion?: "1.1" | "2";
  transport?: Transport;
  interceptors?: Interceptor[];
  callOptions?: CallOptions;
  useBinaryFormat?: boolean;
}

export interface BlockSource {
  listBlocks(request: PartialMessage<ListBlocksRequest>): Promise<ListBlocksResponse>;
  streamBlocks(request: PartialMessage<StreamBlocksRequest>): AsyncIterable<StreamBlocksResponse>;
}

export interface TransactionSource {
  listTransactions(
    request: PartialMessage<ListTransactionsRequest>,
  ): Promise<ListTransactionsResponse>;
  streamTransactions(
    request: PartialMessage<StreamTransactionsRequest>,
  ): AsyncIterable<StreamTransactionsResponse>;
}

export interface EventSource {
  listEvents(request: PartialMessage<ListEventsRequest>): Promise<ListEventsResponse>;
  streamEvents(
    request: PartialMessage<StreamEventsRequest>,
  ): AsyncIterable<StreamEventsResponse>;
}

export type ReplayDataSource = BlockSource & TransactionSource & EventSource;

export class ChainClient implements ReplayDataSource {
  private readonly query: ReturnType<typeof createClient<typeof QueryService>>;
  private readonly streaming: ReturnType<typeof createClient<typeof StreamingService>>;
  private readonly callOptions?: CallOptions;

  constructor(private readonly options: ChainClientOptions) {
    const transport = options.transport ?? this.createTransport();
    this.query = createClient(QueryService, transport);
    this.streaming = createClient(StreamingService, transport);
    this.callOptions = options.callOptions;
  }

  listBlocks(request: PartialMessage<ListBlocksRequest>): Promise<ListBlocksResponse> {
    return this.query.listBlocks(new ListBlocksRequest(request), this.callOptions);
  }

  streamBlocks(
    request: PartialMessage<StreamBlocksRequest>,
  ): AsyncIterable<StreamBlocksResponse> {
    return this.streaming.streamBlocks(new StreamBlocksRequest(request), this.callOptions);
  }

  listTransactions(
    request: PartialMessage<ListTransactionsRequest>,
  ): Promise<ListTransactionsResponse> {
    return this.query.listTransactions(new ListTransactionsRequest(request), this.callOptions);
  }

  streamTransactions(
    request: PartialMessage<StreamTransactionsRequest>,
  ): AsyncIterable<StreamTransactionsResponse> {
    return this.streaming.streamTransactions(new StreamTransactionsRequest(request), this.callOptions);
  }

  listEvents(request: PartialMessage<ListEventsRequest>): Promise<ListEventsResponse> {
    return this.query.listEvents(new ListEventsRequest(request), this.callOptions);
  }

  streamEvents(
    request: PartialMessage<StreamEventsRequest>,
  ): AsyncIterable<StreamEventsResponse> {
    return this.streaming.streamEvents(new StreamEventsRequest(request), this.callOptions);
  }

  private createTransport(): Transport {
    if (!this.options.baseUrl) {
      throw new Error("ChainClient requires baseUrl when no transport is provided");
    }

    const headerInterceptor = this.createHeaderInterceptor();
    const userInterceptors = this.options.interceptors ?? [];
    const mergedInterceptors = [
      ...userInterceptors,
      ...(headerInterceptor ? [headerInterceptor] : []),
    ];

    return createGrpcTransport({
      baseUrl: this.options.baseUrl,
      httpVersion: this.options.httpVersion ?? "2",
      useBinaryFormat: this.options.useBinaryFormat ?? true,
      interceptors: mergedInterceptors.length ? mergedInterceptors : undefined,
    });
  }

  private createHeaderInterceptor(): Interceptor | null {
    const headers: Record<string, string> = {};
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    if (this.options.userAgent) headers["User-Agent"] = this.options.userAgent;
    if (!Object.keys(headers).length) return null;
    return (next) => async (req) => {
      for (const [key, value] of Object.entries(headers)) req.header.set(key, value);
      return next(req);
    };
  }

  getHeight(): Promise<GetHeightResponse> {
    return this.query.getHeight(new GetHeightRequest(), this.callOptions);
  }
}
