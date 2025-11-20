import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
    AbiDecodeError,
    AbiValidationError,
    DecodedArrayValue,
    DecodedPrimitiveValue,
    DecodedStructValue,
    DecodedValue,
    decodeData,
} from "./index";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const complianceRoot = path.join(repoRoot, "abi/abi_gen/tests/compliance_tests");

const abiDefinitions = (relativePath: string) => fs.readFileSync(path.join(complianceRoot, "abi_definitions", relativePath), "utf8");
const testCasePath = (relativePath: string) => path.join(complianceRoot, "test_cases", relativePath);

const loadBinaryFromTestCase = (relativePath: string): Uint8Array => {
  const raw = fs.readFileSync(testCasePath(relativePath), "utf8");
  const parsed = YAML.parse(raw);
  const hex = parsed?.["test-case"]?.["binary-hex"];
  if (typeof hex !== "string") {
    throw new Error(`Test case '${relativePath}' is missing binary-hex data`);
  }
  return hexToBytes(hex);
};

describe("decodeData happy path", () => {
  it("decodes primitives with accurate numeric types", () => {
    const abiText = abiDefinitions("primitives.abi.yaml");
    const binary = loadBinaryFromTestCase("primitives/common_values.yaml");

    const result = decodeData(abiText, "AllPrimitives", binary) as DecodedStructValue;

    const fields = result.fields;
    expect(asPrimitive(fields.u8_val).value).toBe(42);
    expect(asPrimitive(fields.u16_val).value).toBe(1000);
    expect(asPrimitive(fields.u32_val).value).toBe(0x12345678);
    expect(asPrimitive(fields.u64_val).value).toBe(0x123456789abcdef0n);
    expect(asPrimitive(fields.i8_val).value).toBe(-42);
    expect(asPrimitive(fields.i16_val).value).toBe(-1234);
    expect(asPrimitive(fields.i32_val).value).toBe(-123456);
    expect(asPrimitive(fields.i64_val).value).toBe(-123_456_789n);
    expect(asPrimitive(fields.f32_val).value).toBeCloseTo(3.14159, 5);
    expect(asPrimitive(fields.f64_val).value).toBeCloseTo(2.718281828459045, 12);
  });

  it("handles interleaved variable-length arrays", () => {
    const abiText = abiDefinitions("array_structs.abi.yaml");
    const binary = loadBinaryFromTestCase("array_structs/dual_arrays.yaml");

    const result = decodeData(abiText, "DualArrays", binary) as DecodedStructValue;
    const arr1 = result.fields.arr1 as DecodedArrayValue;
    const arr2 = result.fields.arr2 as DecodedArrayValue;

    expect(arr1.length).toBe(3);
    expect(arr1.elements.map((el) => asPrimitive(el).value)).toEqual([0x11, 0x22, 0x33]);

    expect(arr2.length).toBe(2);
    expect(arr2.elements.map((el) => asPrimitive(el).value)).toEqual([0x4444, 0x5555]);
  });

  it("evaluates array size expressions using field references", () => {
    const abiText = abiDefinitions("array_structs.abi.yaml");
    const binary = loadBinaryFromTestCase("array_structs/matrix.yaml");

    const result = decodeData(abiText, "Matrix", binary) as DecodedStructValue;

    const rows = Number(asPrimitive(result.fields.rows).value);
    const cols = Number(asPrimitive(result.fields.cols).value);
    const dataField = result.fields.data as DecodedArrayValue;

    expect(dataField.length).toBe(rows * cols + 1);
    expect(dataField.elements.map((el) => asPrimitive(el).value)).toEqual([1, 2, 3, 4, 5, 6, 255]);
  });

  it("selects size-discriminated union variants based on runtime size", () => {
    const abiText = sizeDiscriminatedUnionAbi;
    const shortData = hexToBytes("04 00 00 00");
    const longData = hexToBytes("01 00 00 00 02 00 00 00");

    const short = decodeData(abiText, "Payload", shortData);
    expect(short.kind).toBe("size-discriminated-union");
    if (short.kind === "size-discriminated-union") {
      expect(short.variantName).toBe("Short");
      const value = short.value as DecodedStructValue;
      expect(asPrimitive(value.fields.value).value).toBe(4);
    }

    const long = decodeData(abiText, "Payload", longData);
    expect(long.kind).toBe("size-discriminated-union");
    if (long.kind === "size-discriminated-union") {
      expect(long.variantName).toBe("Long");
      const value = long.value as DecodedStructValue;
      expect(asPrimitive(value.fields.head).value).toBe(1);
      expect(asPrimitive(value.fields.tail).value).toBe(2);
    }
  });
});

describe("decodeData error cases", () => {
  it("throws when buffer is too short", () => {
    const abiText = abiDefinitions("primitives.abi.yaml");
    const binary = loadBinaryFromTestCase("primitives/common_values.yaml").slice(0, 10);
    expect(() => decodeData(abiText, "AllPrimitives", binary)).toThrowError(AbiDecodeError);
  });

  it("rejects references to unknown types", () => {
    const abiText = `
abi:
  package: "test"
  abi-version: 1
types:
  - name: "HasRef"
    kind:
      struct:
        packed: true
        fields:
          - name: "missing"
            field-type:
              type-ref:
                name: "Nope"
`;
    expect(() => decodeData(abiText, "HasRef", new Uint8Array()))
      .toThrowError(AbiValidationError);
  });

  it("detects simple reference cycles", () => {
    const abiText = `
abi:
  package: "test"
  abi-version: 1
types:
  - name: "Loop"
    kind:
      struct:
        packed: true
        fields:
          - name: "next"
            field-type:
              type-ref:
                name: "Loop"
`;
    expect(() => decodeData(abiText, "Loop", new Uint8Array()))
      .toThrowError(AbiValidationError);
  });

  it("reports unsupported expression operators", () => {
    const abiText = `
abi:
  package: "test"
  abi-version: 1
types:
  - name: "BadArray"
    kind:
      struct:
        packed: true
        fields:
          - name: "length"
            field-type:
              primitive: u32
          - name: "data"
            field-type:
              array:
                size:
                  pow:
                    left:
                      field-ref:
                        path: ["length"]
                    right:
                      literal:
                        u32: 2
                element-type:
                  primitive: u8
`;
    expect(() => decodeData(abiText, "BadArray", new Uint8Array()))
      .toThrowError(AbiValidationError);
  });

  it("errors when no size-discriminated union variant matches", () => {
    const data = hexToBytes("01 02 03");
    expect(() => decodeData(sizeDiscriminatedUnionAbi, "Payload", data))
      .toThrowError(AbiDecodeError);
  });

  it("throws when requested type is absent", () => {
    const abiText = abiDefinitions("primitives.abi.yaml");
    expect(() => decodeData(abiText, "MissingType", new Uint8Array()))
      .toThrowError(AbiValidationError);
  });
});

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/[^a-fA-F0-9]/g, "");
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex string must contain an even number of characters");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function asPrimitive(value: DecodedValue): DecodedPrimitiveValue {
  if (value.kind !== "primitive") {
    throw new Error(`Expected primitive value, received ${value.kind}`);
  }
  return value;
}

const sizeDiscriminatedUnionAbi = `
abi:
  package: "test.union"
  abi-version: 1
types:
  - name: "Payload"
    kind:
      size-discriminated-union:
        packed: true
        variants:
          - name: "Short"
            expected-size: 4
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "value"
                    field-type:
                      primitive: u32
          - name: "Long"
            expected-size: 8
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "head"
                    field-type:
                      primitive: u32
                  - name: "tail"
                    field-type:
                      primitive: u32
`;

