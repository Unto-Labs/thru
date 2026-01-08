import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { createMockContext } from "../../__tests__/helpers/test-utils";
import { ChainEvent } from "../../domain/events";
import { CurrentVersionSchema, VersionContextSchema } from "@thru/proto";
import { EventSchema } from "@thru/proto";
import { getEvent } from "../events";

describe("events", () => {
  describe("getEvent", () => {
    it("should return event with valid eventId", async () => {
      const ctx = createMockContext();
      const mockEvent = create(EventSchema, {
        eventId: "test-event-id",
        slot: 1000n,
      });
      
      vi.spyOn(ctx.query, "getEvent").mockResolvedValue(mockEvent);
      
      const result = await getEvent(ctx, "test-event-id");
      
      expect(result).toBeInstanceOf(ChainEvent);
      expect(result.id).toBe("test-event-id");
      expect(ctx.query.getEvent).toHaveBeenCalledTimes(1);
    });

    it("should include eventId in request", async () => {
      const ctx = createMockContext();
      const mockEvent = create(EventSchema, { eventId: "test-event-id" });
      vi.spyOn(ctx.query, "getEvent").mockResolvedValue(mockEvent);
      
      await getEvent(ctx, "test-event-id");
      
      const callArgs = (ctx.query.getEvent as any).mock.calls[0][0];
      expect(callArgs.eventId).toBe("test-event-id");
    });

    it("should include version context when provided", async () => {
      const ctx = createMockContext();
      const mockEvent = create(EventSchema, { eventId: "test-event-id" });
      vi.spyOn(ctx.query, "getEvent").mockResolvedValue(mockEvent);
      
      const versionContext = create(VersionContextSchema, {
        version: {
          case: "current",
          value: create(CurrentVersionSchema, {}),
        },
      });
      
      await getEvent(ctx, "test-event-id", { versionContext });
      
      const callArgs = (ctx.query.getEvent as any).mock.calls[0][0];
      expect(callArgs.versionContext).toBeDefined();
      expect(callArgs.versionContext.version?.case).toBe("current");
    });

    it("should throw error for empty eventId", () => {
      const ctx = createMockContext();
      
      expect(() => getEvent(ctx, "")).toThrow("eventId is required");
    });

    it("should use default version context when not provided", async () => {
      const ctx = createMockContext();
      const mockEvent = create(EventSchema, { eventId: "test-event-id" });
      vi.spyOn(ctx.query, "getEvent").mockResolvedValue(mockEvent);
      
      await getEvent(ctx, "test-event-id");
      
      const callArgs = (ctx.query.getEvent as any).mock.calls[0][0];
      expect(callArgs.versionContext).toBeDefined();
      expect(callArgs.versionContext.version?.case).toBe("current");
    });
  });
});

