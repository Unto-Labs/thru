import { create } from "@bufbuild/protobuf";
import {
  type CallOptions,
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  QueryService,
  StreamingService,
  type GetHeightRequest,
  GetHeightRequestSchema,
  type GetHeightResponse,
  type ListBlocksRequest,
  ListBlocksRequestSchema,
  type ListBlocksResponse,
  type ListEventsRequest,
  ListEventsRequestSchema,
  type ListEventsResponse,
  type ListTransactionsRequest,
  ListTransactionsRequestSchema,
  type ListTransactionsResponse,
  type StreamBlocksRequest,
  StreamBlocksRequestSchema,
  type StreamBlocksResponse,
  type StreamEventsRequest,
  StreamEventsRequestSchema,
  type StreamEventsResponse,
  type StreamTransactionsRequest,
  StreamTransactionsRequestSchema,
  type StreamTransactionsResponse,
  type StreamAccountUpdatesRequest,
  StreamAccountUpdatesRequestSchema,
  type StreamAccountUpdatesResponse,
} from "@thru/proto";

export interface ChainClientOptions {
  baseUrl?: string;
  apiKey?: string;
  userAgent?: string;
  transport?: Transport;
  interceptors?: Interceptor[];
  callOptions?: CallOptions;
  useBinaryFormat?: boolean;
}

export interface BlockSource {
  listBlocks(request: Partial<ListBlocksRequest>): Promise<ListBlocksResponse>;
  streamBlocks(request: Partial<StreamBlocksRequest>): AsyncIterable<StreamBlocksResponse>;
}

export interface TransactionSource {
  listTransactions(
    request: Partial<ListTransactionsRequest>,
  ): Promise<ListTransactionsResponse>;
  streamTransactions(
    request: Partial<StreamTransactionsRequest>,
  ): AsyncIterable<StreamTransactionsResponse>;
}

export interface EventSource {
  listEvents(request: Partial<ListEventsRequest>): Promise<ListEventsResponse>;
  streamEvents(
    request: Partial<StreamEventsRequest>,
  ): AsyncIterable<StreamEventsResponse>;
}

export interface AccountSource {
  streamAccountUpdates(
    request: Partial<StreamAccountUpdatesRequest>,
  ): AsyncIterable<StreamAccountUpdatesResponse>;
}

export type ReplayDataSource = BlockSource & TransactionSource & EventSource & AccountSource;

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

  listBlocks(request: Partial<ListBlocksRequest>): Promise<ListBlocksResponse> {
    return this.query.listBlocks(create(ListBlocksRequestSchema, request), this.callOptions);
  }

  streamBlocks(
    request: Partial<StreamBlocksRequest>,
  ): AsyncIterable<StreamBlocksResponse> {
    return this.streaming.streamBlocks(create(StreamBlocksRequestSchema, request), this.callOptions);
  }

  listTransactions(
    request: Partial<ListTransactionsRequest>,
  ): Promise<ListTransactionsResponse> {
    return this.query.listTransactions(create(ListTransactionsRequestSchema, request), this.callOptions);
  }

  streamTransactions(
    request: Partial<StreamTransactionsRequest>,
  ): AsyncIterable<StreamTransactionsResponse> {
    return this.streaming.streamTransactions(create(StreamTransactionsRequestSchema, request), this.callOptions);
  }

  listEvents(request: Partial<ListEventsRequest>): Promise<ListEventsResponse> {
    return this.query.listEvents(create(ListEventsRequestSchema, request), this.callOptions);
  }

  streamEvents(
    request: Partial<StreamEventsRequest>,
  ): AsyncIterable<StreamEventsResponse> {
    return this.streaming.streamEvents(create(StreamEventsRequestSchema, request), this.callOptions);
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

  streamAccountUpdates(
    request: Partial<StreamAccountUpdatesRequest>,
  ): AsyncIterable<StreamAccountUpdatesResponse> {
    return this.streaming.streamAccountUpdates(create(StreamAccountUpdatesRequestSchema, request), this.callOptions);
  }

  getHeight(): Promise<GetHeightResponse> {
    return this.query.getHeight(create(GetHeightRequestSchema, {}), this.callOptions);
  }
}
