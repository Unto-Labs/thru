import { beforeAll, describe, expect, it } from "vitest";
import {
  buildLayoutIr,
  ensureWasmLoaded,
  formatReflection,
  reflect,
  reflectAccount,
  reflectEvent,
  reflectInstruction,
} from "../../src";

const minimalAbi = `
abi:
  package: "test"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test ABI"
  options:
    program-metadata:
      root-types:
        instruction-root: "TestInstruction"
        account-root: "TestAccount"
        errors: "TestError"
        events: "TestEvent"
types:
  - name: "TestInstruction"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
  - name: "TestAccount"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
  - name: "TestError"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
  - name: "TestEvent"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
`;

const testBytes = new Uint8Array([0x42, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const testHex = "4200000000000000";

beforeAll(async () => {
  await ensureWasmLoaded();
});

describe("WASM bridge exports", () => {
  it("ensureWasmLoaded resolves without error", async () => {
    await expect(ensureWasmLoaded()).resolves.toBeUndefined();
  });

  it("reflect returns an object from binary input", async () => {
    const result = await reflect(minimalAbi, "TestInstruction", {
      type: "binary",
      value: testBytes,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("reflect returns an object from hex input", async () => {
    const result = await reflect(minimalAbi, "TestInstruction", {
      type: "hex",
      value: testHex,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("reflectInstruction returns an object", async () => {
    const result = await reflectInstruction(minimalAbi, {
      type: "binary",
      value: testBytes,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("reflectAccount returns an object", async () => {
    const result = await reflectAccount(minimalAbi, {
      type: "binary",
      value: testBytes,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("reflectEvent returns an object", async () => {
    const result = await reflectEvent(minimalAbi, {
      type: "binary",
      value: testBytes,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("buildLayoutIr returns layout metadata", async () => {
    const layout = await buildLayoutIr(minimalAbi);
    expect(layout).toBeDefined();
    expect(typeof layout).toBe("object");
  });

  it("formatReflection transforms reflection output", async () => {
    const raw = await reflect(minimalAbi, "TestInstruction", {
      type: "binary",
      value: testBytes,
    });
    const formatted = formatReflection(raw);
    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe("object");
    expect(formatted).toHaveProperty("typeName");
    expect(formatted).toHaveProperty("value");
  });
});
