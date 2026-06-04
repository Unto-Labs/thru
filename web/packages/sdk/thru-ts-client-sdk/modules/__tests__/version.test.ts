import { describe, expect, it, vi } from "vitest";
import { createMockContext } from "../../__tests__/helpers/test-utils";
import { VersionInfo } from "../../domain/version";
import { getVersion } from "../version";

describe("version", () => {
  describe("getVersion", () => {
    it("should return version response", async () => {
      const ctx = createMockContext();
      const mockResponse = {
        versions: {
          "component1": "1.0.0",
          "component2": "2.1.0",
        },
      };
      vi.spyOn(ctx.query, "getVersion").mockResolvedValue(mockResponse as any);
      
      const result = await getVersion(ctx);
      
      expect(result).toBeInstanceOf(VersionInfo);
      expect(result.components).toEqual({
        "component1": "1.0.0",
        "component2": "2.1.0",
      });
      expect(ctx.query.getVersion).toHaveBeenCalledTimes(1);
    });

    it("should create empty request", async () => {
      const ctx = createMockContext();
      const mockResponse = { versions: {} };
      vi.spyOn(ctx.query, "getVersion").mockResolvedValue(mockResponse as any);
      
      await getVersion(ctx);
      
      const callArgs = (ctx.query.getVersion as any).mock.calls[0][0];
      // Request should be created (empty GetVersionRequest)
      expect(callArgs).toBeDefined();
    });
  });
});

