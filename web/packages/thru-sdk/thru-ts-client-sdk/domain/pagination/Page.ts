import { create } from "@bufbuild/protobuf";

import {
    PageRequest as ProtoPageRequest,
    PageRequestSchema,
    PageResponse as ProtoPageResponse,
    PageResponseSchema,
} from "../../proto/thru/common/v1/pagination_pb";

export interface PageRequestParams {
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
}

export class PageRequest {
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly orderBy?: string;

    constructor(params: PageRequestParams = {}) {
        if (params.pageSize !== undefined) {
            if (!Number.isInteger(params.pageSize) || params.pageSize < 0) {
                throw new Error("PageRequest.pageSize must be a non-negative integer");
            }
        }

        this.pageSize = params.pageSize;
        this.pageToken = params.pageToken;
        this.orderBy = params.orderBy;
    }

    static fromProto(proto?: ProtoPageRequest): PageRequest | undefined {
        if (!proto) {
            return undefined;
        }
        return new PageRequest({
            pageSize: proto.pageSize,
            pageToken: proto.pageToken,
            orderBy: proto.orderBy,
        });
    }

    toProto(): ProtoPageRequest {
        return create(PageRequestSchema, {
            pageSize: this.pageSize,
            pageToken: this.pageToken,
            orderBy: this.orderBy,
        });
    }

    withParams(params: PageRequestParams): PageRequest {
        return new PageRequest({
            pageSize: params.pageSize ?? this.pageSize,
            pageToken: params.pageToken ?? this.pageToken,
            orderBy: params.orderBy ?? this.orderBy,
        });
    }
}

export interface PageResponseParams {
    nextPageToken?: string;
    totalSize?: bigint;
}

export class PageResponse {
    readonly nextPageToken?: string;
    readonly totalSize?: bigint;

    constructor(params: PageResponseParams = {}) {
        this.nextPageToken = params.nextPageToken;
        this.totalSize = params.totalSize;
    }

    static fromProto(proto?: ProtoPageResponse): PageResponse | undefined {
        if (!proto) {
            return undefined;
        }
        return new PageResponse({
            nextPageToken: proto.nextPageToken,
            totalSize: proto.totalSize,
        });
    }

    toProto(): ProtoPageResponse {
        return create(PageResponseSchema, {
            nextPageToken: this.nextPageToken,
            totalSize: this.totalSize,
        });
    }

    hasNextPage(): boolean {
        return !!this.nextPageToken;
    }
}



