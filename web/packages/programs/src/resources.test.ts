import { describe, expect, it } from "vitest";
import { programResources } from "./resources";

describe("explicit operation resource budgets", () => {
  it("requests no state growth unless the operation specifies it", () => {
    expect(programResources().stateUnits).toBe(0);
  });
  it("preserves zero and operation-specific overrides", () => {
    expect(
      programResources({ computeUnits: 0, stateUnits: 0, memoryUnits: 0 }),
    ).toEqual({ computeUnits: 0, stateUnits: 0, memoryUnits: 0 });
    expect(programResources({ stateUnits: 64 })).toEqual({
      computeUnits: 300_000_000,
      stateUnits: 64,
      memoryUnits: 10_000,
    });
  });
});
