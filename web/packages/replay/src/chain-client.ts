import { create } from "@bufbuild/protobuf";
import {
  type CallOptions,
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import {
  createGrpcTransport,
  Http2SessionManager,
} from "@connectrpc/connect-node";
import {
  QueryService,
  StreamingService,
  type GetChainInfoResponse,
  type GetHeightRequest,
  type GetChainInfoRequest,
  GetChainInfoRequestSchema,
  GetHeightRequestSchema,
  type GetHeightResponse,
  type GetAccountRequest,
  GetAccountRequestSchema,
  type Account,
  type ListAccountsRequest,
  ListAccountsRequestSchema,
  type ListAccountsResponse,
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
} from "@thru/sdk/proto";

export interface ChainClientOptions {
  baseUrl?: string;
  apiKey?: string;
  userAgent?: string;
  transport?: Transport;
  interceptors?: Interceptor[];
  callOptions?: CallOptions;
  useBinaryFormat?: boolean;
}

/**
 * Factory function that creates fresh ChainClient instances.
 * Called on each reconnection to ensure a new gRPC transport.
 */
export type ChainClientFactory = () => ChainClient;

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
  getAccount(request: Partial<GetAccountRequest>): Promise<Account>;
  listAccounts(request: Partial<ListAccountsRequest>): Promise<ListAccountsResponse>;
  streamAccountUpdates(
    request: Partial<StreamAccountUpdatesRequest>,
  ): AsyncIterable<StreamAccountUpdatesResponse>;
}

export type ReplayDataSource = BlockSource & TransactionSource & EventSource & AccountSource;

export class ChainClient implements ReplayDataSource {
  private readonly query: ReturnType<typeof createClient<typeof QueryService>>;
  private readonly streaming: ReturnType<typeof createClient<typeof StreamingService>>;
  private readonly callOptions?: CallOptions;
  /**
   * The HTTP/2 session manager owned by this client. Only set when the client
   * created its own gRPC transport (i.e., `options.transport` was not provided).
   * `close()` uses this to tear down the underlying persistent connection.
   */
  private readonly sessionManager: Http2SessionManager | null;
  private closed = false;

  constructor(private readonly options: ChainClientOptions) {
    if (options.transport) {
      this.sessionManager = null;
      this.query = createClient(QueryService, options.transport);
      this.streaming = createClient(StreamingService, options.transport);
    } else {
      const { transport, sessionManager } = this.createOwnedTransport();
      this.sessionManager = sessionManager;
      this.query = createClient(QueryService, transport);
      this.streaming = createClient(StreamingService, transport);
    }
    this.callOptions = options.callOptions;
  }

  /**
   * Close the underlying HTTP/2 session, if this client owns one. Idempotent.
   *
   * Callers are responsible for ensuring that no in-flight RPCs or streams
   * are still being awaited on this client — pending requests will fail.
   *
   * If the client was constructed with an externally-supplied `transport`,
   * `close()` is a no-op; the caller owns the transport's lifecycle.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.sessionManager?.abort();
  }

  getAccount(request: Partial<GetAccountRequest>): Promise<Account> {
    return this.query.getAccount(create(GetAccountRequestSchema, request), this.callOptions);
  }

  listAccounts(request: Partial<ListAccountsRequest>): Promise<ListAccountsResponse> {
    return this.query.listAccounts(create(ListAccountsRequestSchema, request), this.callOptions);
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

  private createOwnedTransport(): {
    transport: Transport;
    sessionManager: Http2SessionManager;
  } {
    if (!this.options.baseUrl) {
      throw new Error("ChainClient requires baseUrl when no transport is provided");
    }

    const headerInterceptor = this.createHeaderInterceptor();
    const userInterceptors = this.options.interceptors ?? [];
    const mergedInterceptors = [
      ...userInterceptors,
      ...(headerInterceptor ? [headerInterceptor] : []),
    ];

    /* Construct our own session manager so close() can tear the HTTP/2
       session down. Ping / idle options are passed here; once a session
       manager is supplied to createGrpcTransport, those options on the
       transport itself would be ignored. */
    const sessionManager = new Http2SessionManager(this.options.baseUrl, {
      pingIntervalMs: 30_000,
      pingIdleConnection: true,
      pingTimeoutMs: 10_000,
      idleConnectionTimeoutMs: 0,
    });

    const transport = createGrpcTransport({
      baseUrl: this.options.baseUrl,
      useBinaryFormat: this.options.useBinaryFormat ?? true,
      interceptors: mergedInterceptors.length ? mergedInterceptors : undefined,
      sessionManager,
    });

    return { transport, sessionManager };
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

  getChainInfo(
    request: Partial<GetChainInfoRequest> = {},
  ): Promise<GetChainInfoResponse> {
    return this.query.getChainInfo(create(GetChainInfoRequestSchema, request), this.callOptions);
  }
}
