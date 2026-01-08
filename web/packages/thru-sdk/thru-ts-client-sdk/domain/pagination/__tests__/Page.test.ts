import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { PageRequestSchema, PageResponseSchema } from "@thru/proto";
import { PageRequest, PageResponse } from "../";

describe("Pagination domain models", () => {
    describe("PageRequest", () => {
        it("converts to and from proto", () => {
            const proto = create(PageRequestSchema, {
                pageSize: 50,
                pageToken: "token",
                orderBy: "slot desc",
            });

            const request = PageRequest.fromProto(proto);
            expect(request).toBeInstanceOf(PageRequest);
            expect(request?.pageSize).toBe(50);
            expect(request?.pageToken).toBe("token");
            expect(request?.orderBy).toBe("slot desc");

            const roundtrip = request?.toProto();
            expect(roundtrip).toEqual(proto);
        });

        it("validates page size", () => {
            expect(() => new PageRequest({ pageSize: -1 })).toThrow("PageRequest.pageSize must be a non-negative integer");
            expect(() => new PageRequest({ pageSize: 10.5 })).toThrow("PageRequest.pageSize must be a non-negative integer");
        });

        it("supports immutable updates", () => {
            const request = new PageRequest({ pageSize: 10 });
            const updated = request.withParams({ pageToken: "next" });

            expect(request.pageToken).toBeUndefined();
            expect(updated.pageSize).toBe(10);
            expect(updated.pageToken).toBe("next");
        });
    });

    describe("PageResponse", () => {
        it("converts to and from proto", () => {
            const proto = create(PageResponseSchema, {
                nextPageToken: "next-token",
                totalSize: 123n,
            });

            const response = PageResponse.fromProto(proto);
            expect(response).toBeInstanceOf(PageResponse);
            expect(response?.nextPageToken).toBe("next-token");
            expect(response?.totalSize).toBe(123n);
            expect(response?.hasNextPage()).toBe(true);

            const roundtrip = response?.toProto();
            expect(roundtrip).toEqual(proto);
        });

        it("handles missing proto response", () => {
            expect(PageResponse.fromProto(undefined)).toBeUndefined();
        });
    });
});



