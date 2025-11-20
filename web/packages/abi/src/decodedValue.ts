import type { PrimitiveName } from "./abiSchema";

type DecodedValueKind = "primitive" | "struct" | "array" | "enum" | "union" | "size-discriminated-union" | "opaque";

interface BaseDecodedValue {
  kind: DecodedValueKind;
  typeName?: string;
  byteOffset: number;
  byteLength: number;
  rawHex: string;
}

export interface DecodedPrimitiveValue extends BaseDecodedValue {
  kind: "primitive";
  primitiveType: PrimitiveName;
  value: number | bigint;
}

export interface DecodedField {
  name: string;
  value: DecodedValue;
}

export interface DecodedStructValue extends BaseDecodedValue {
  kind: "struct";
  fields: Record<string, DecodedValue>;
  fieldOrder: DecodedField[];
}

export interface DecodedArrayValue extends BaseDecodedValue {
  kind: "array";
  length: number;
  elements: DecodedValue[];
}

export interface DecodedEnumValue extends BaseDecodedValue {
  kind: "enum";
  tagValue: number;
  variantName: string;
  value: DecodedValue | null;
}

export interface DecodedUnionValue extends BaseDecodedValue {
  kind: "union";
  variants: DecodedField[];
  note?: string;
}

export interface DecodedSizeDiscriminatedUnionValue extends BaseDecodedValue {
  kind: "size-discriminated-union";
  variantName: string;
  expectedSize: number;
  value: DecodedValue;
}

export interface DecodedOpaqueValue extends BaseDecodedValue {
  kind: "opaque";
  description: string;
}

export type DecodedValue =
  | DecodedPrimitiveValue
  | DecodedStructValue
  | DecodedArrayValue
  | DecodedEnumValue
  | DecodedUnionValue
  | DecodedSizeDiscriminatedUnionValue
  | DecodedOpaqueValue;

