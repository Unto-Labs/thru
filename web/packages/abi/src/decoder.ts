import type {
    ArrayType,
    EnumType,
    Expression,
    PrimitiveName,
    SizeDiscriminatedUnionType,
    StructType,
    TypeKind,
    UnionType,
} from "./abiSchema";
import { parseAbiDocument, TypeRefType } from "./abiSchema";
import type {
    DecodedArrayValue,
    DecodedEnumValue,
    DecodedField,
    DecodedPrimitiveValue,
    DecodedSizeDiscriminatedUnionValue,
    DecodedStructValue,
    DecodedUnionValue,
    DecodedValue,
} from "./decodedValue";
import { AbiDecodeError } from "./errors";
import { addFieldToScope, createScope, evaluateExpression, FieldScope } from "./expression";
import { buildTypeRegistry, TypeRegistry } from "./typeRegistry";
import { alignUp, bytesToHex } from "./utils/bytes";

interface DecodeState {
  registry: TypeRegistry;
  data: Uint8Array;
  view: DataView;
  offset: number;
  scope?: FieldScope;
}

interface PreviewResult {
  value?: DecodedValue;
  size?: number;
  error?: AbiDecodeError;
}

export function decodeData(yamlText: string, typeName: string, data: Uint8Array): DecodedValue {
  if (!(data instanceof Uint8Array)) {
    throw new AbiDecodeError("decodeData expects account data as a Uint8Array");
  }
  const trimmedTypeName = typeName?.trim();
  if (!trimmedTypeName) {
    throw new AbiDecodeError("decodeData requires a non-empty typeName argument");
  }

  const abiDocument = parseAbiDocument(yamlText);
  const registry = buildTypeRegistry(abiDocument);
  return decodeWithRegistry(registry, trimmedTypeName, data);
}

function decodeWithRegistry(registry: TypeRegistry, typeName: string, data: Uint8Array): DecodedValue {
  const type = registry.get(typeName);
  const state: DecodeState = {
    registry,
    data,
    view: new DataView(data.buffer, data.byteOffset, data.byteLength),
    offset: 0,
    scope: undefined,
  };

  const value = decodeKind(type.kind, state, typeName, type.name, state.view.byteLength);

  if (state.offset !== data.byteLength) {
    throw new AbiDecodeError("Decoded data did not consume the full buffer", {
      expectedLength: data.byteLength,
      consumedLength: state.offset,
      remainingBytes: data.byteLength - state.offset,
    });
  }

  return value;
}

function decodeKind(kind: TypeKind, state: DecodeState, context: string, typeName?: string, byteBudget?: number): DecodedValue {
  switch (kind.kind) {
    case "primitive":
      return decodePrimitive(kind.primitive, state, context, typeName);
    case "struct":
      return decodeStruct(kind, state, context, typeName, byteBudget);
    case "array":
      return decodeArray(kind, state, context, typeName);
    case "enum":
      return decodeEnum(kind, state, context, typeName);
    case "union":
      return decodeUnion(kind, state, context, typeName);
    case "size-discriminated-union":
      return decodeSizeDiscriminatedUnion(kind, state, context, typeName, byteBudget);
    case "type-ref":
      return decodeTypeReference(kind, state, context, byteBudget);
    default:
      kind satisfies never;
      throw new AbiDecodeError(`Type '${context}' uses unsupported kind '${(kind as TypeKind).kind}'`);
  }
}

function decodeTypeReference(typeRef: TypeRefType, state: DecodeState, context: string, byteBudget?: number): DecodedValue {
  const referenced = state.registry.get(typeRef.name);
  return decodeKind(referenced.kind, state, context, typeRef.name, byteBudget);
}

function decodePrimitive(primitive: PrimitiveName, state: DecodeState, context: string, typeName?: string): DecodedPrimitiveValue {
  const info = primitiveInfo[primitive];
  if (!info) {
    throw new AbiDecodeError(`Primitive type '${primitive}' is not supported yet`, { context });
  }
  if (info.byteLength > 0) {
    ensureAvailable(state, info.byteLength, context);
  }
  const start = state.offset;
  const value = info.read(state.view, state.offset);
  state.offset += info.byteLength;
  const rawHex = sliceHex(state.data, start, state.offset);
  return {
    kind: "primitive",
    primitiveType: primitive,
    value,
    byteOffset: start,
    byteLength: info.byteLength,
    rawHex,
    typeName,
  };
}

function decodeStruct(struct: StructType, state: DecodeState, context: string, typeName?: string, byteBudget?: number): DecodedStructValue {
  const start = state.offset;
  const previousScope = state.scope;
  const scope = createScope(previousScope);
  state.scope = scope;

  const trailingSizes = computeTrailingConstantSizes(struct, state.registry);
  const fields: Record<string, DecodedValue> = {};
  const fieldOrder: DecodedField[] = [];

  try {
    struct.fields.forEach((field, index) => {
      const fieldContext = `${context}.${field.name}`;
      
      // Apply padding if struct is not packed
      if (!struct.attributes.packed) {
        const alignment = getTypeAlignment(field.type, state.registry);
        state.offset = alignUp(state.offset, alignment);
      }

      const tailSize = trailingSizes[index];
      const bytesConsumed = state.offset - start;
      const availableBytes =
        byteBudget !== undefined ? Math.max(byteBudget - bytesConsumed, 0) : state.view.byteLength - state.offset;
      const fieldBudget = tailSize !== null ? Math.max(availableBytes - tailSize, 0) : undefined;
      const value = decodeKind(field.type, state, fieldContext, undefined, fieldBudget);
      fields[field.name] = value;
      fieldOrder.push({ name: field.name, value });
      addFieldToScope(scope, field.name, value);
    });
  } finally {
    state.scope = previousScope;
  }

  const end = state.offset;

  return {
    kind: "struct",
    typeName,
    fields,
    fieldOrder,
    byteOffset: start,
    byteLength: end - start,
    rawHex: sliceHex(state.data, start, end),
  };
}

function decodeArray(array: ArrayType, state: DecodeState, context: string, typeName?: string): DecodedArrayValue {
  const lengthBigInt = evaluateExpression(array.size, state.scope, `${context}[size]`, state.registry);
  const length = bigintToLength(lengthBigInt, context);
  const elements: DecodedValue[] = [];
  const start = state.offset;

  for (let i = 0; i < length; i++) {
    const elementContext = `${context}[${i}]`;
    elements.push(decodeKind(array.elementType, state, elementContext));
  }

  const end = state.offset;

  return {
    kind: "array",
    typeName,
    length,
    elements,
    byteOffset: start,
    byteLength: end - start,
    rawHex: sliceHex(state.data, start, end),
  };
}

function decodeEnum(enumType: EnumType, state: DecodeState, context: string, typeName?: string): DecodedEnumValue {
  const tagBigInt = evaluateExpression(enumType.tagExpression, state.scope, `${context}[tag]`, state.registry);
  const tagValue = bigintToNumber(tagBigInt, context);
  const variant = enumType.variants.find((entry) => entry.tagValue === tagValue);
  if (!variant) {
    throw new AbiDecodeError(`Enum '${context}' has no variant with tag ${tagValue}`, {
      availableVariants: enumType.variants.map((entry) => entry.tagValue),
    });
  }

  const start = state.offset;
  const value = decodeKind(variant.type, state, `${context}.${variant.name}`);
  const end = state.offset;

  return {
    kind: "enum",
    typeName,
    tagValue,
    variantName: variant.name,
    value,
    byteOffset: start,
    byteLength: end - start,
    rawHex: sliceHex(state.data, start, end),
  };
}

function decodeUnion(union: UnionType, state: DecodeState, context: string, typeName?: string): DecodedUnionValue {
  const start = state.offset;
  const variantViews: DecodedField[] = [];
  let unionSize = 0;

  for (const variant of union.variants) {
    const preview = previewDecode(variant.type, state, `${context}.${variant.name}`, start);
    if (preview.value) {
      unionSize = Math.max(unionSize, preview.size ?? 0);
      variantViews.push({ name: variant.name, value: preview.value });
    } else if (preview.error) {
      variantViews.push({
        name: variant.name,
        value: createOpaqueValue(preview.error.message, state.data, start, start, variant.name),
      });
    }
  }

  ensureAvailable(state, unionSize, context);
  state.offset = start + unionSize;

  return {
    kind: "union",
    typeName,
    variants: variantViews,
    note: "Union decoding is ambiguous; showing all variant interpretations.",
    byteOffset: start,
    byteLength: unionSize,
    rawHex: sliceHex(state.data, start, start + unionSize),
  };
}

function decodeSizeDiscriminatedUnion(
  union: SizeDiscriminatedUnionType,
  state: DecodeState,
  context: string,
  typeName?: string,
  byteBudget?: number,
): DecodedSizeDiscriminatedUnionValue {
  const start = state.offset;
  const matches: Array<{ variantName: string; value: DecodedValue; size: number; expected: number }> = [];
  const attempts: Record<string, string> = {};

  for (const variant of union.variants) {
    if (byteBudget !== undefined && variant.expectedSize > byteBudget) {
      continue;
    }
    const preview = previewDecode(variant.type, state, `${context}.${variant.name}`, start, variant.expectedSize);
    if (preview.value && preview.size === variant.expectedSize) {
      matches.push({ variantName: variant.name, value: preview.value, size: preview.size ?? 0, expected: variant.expectedSize });
    } else if (preview.error) {
      attempts[variant.name] = preview.error.message;
    }
  }

  if (matches.length === 0) {
    throw new AbiDecodeError(`No size-discriminated union variant in '${context}' matched the provided data`, {
      attempts,
    });
  }
  let winner = matches[0];
  if (matches.length > 1) {
    if (byteBudget !== undefined) {
      const exact = matches.filter((match) => match.expected === byteBudget);
      if (exact.length === 1) {
        winner = exact[0];
      } else {
        throw new AbiDecodeError(`Multiple size-discriminated union variants in '${context}' matched the provided data`, {
          matches: matches.map((match) => match.variantName),
        });
      }
    } else {
      throw new AbiDecodeError(`Multiple size-discriminated union variants in '${context}' matched the provided data`, {
        matches: matches.map((match) => match.variantName),
      });
    }
  }
  ensureAvailable(state, winner.size, context);
  state.offset = start + winner.size;

  return {
    kind: "size-discriminated-union",
    typeName,
    variantName: winner.variantName,
    expectedSize: winner.expected,
    value: winner.value,
    byteOffset: start,
    byteLength: winner.size,
    rawHex: sliceHex(state.data, start, start + winner.size),
  };
}

function previewDecode(kind: TypeKind, state: DecodeState, context: string, start: number, limit?: number): PreviewResult {
  const snapshotOffset = state.offset;
  const snapshotScope = state.scope;
  const snapshotView = state.view;
  const snapshotData = state.data;

  if (limit !== undefined) {
    if (start + limit > snapshotView.byteLength) {
      return { error: new AbiDecodeError(`Variant '${context}' requires ${limit} bytes but only ${snapshotView.byteLength - start} remain`) };
    }
    state.view = new DataView(snapshotView.buffer, snapshotView.byteOffset + start, limit);
    state.data = new Uint8Array(snapshotData.buffer, snapshotData.byteOffset + start, limit);
    state.offset = 0;
  } else {
    state.offset = start;
  }

  try {
    const value = decodeKind(kind, state, context);
    const size = limit !== undefined ? state.offset : state.offset - start;
    return { value, size };
  } catch (error) {
    if (error instanceof AbiDecodeError) {
      return { error };
    }
    return { error: new AbiDecodeError((error as Error).message ?? `Failed to decode variant for ${context}`) };
  } finally {
    state.offset = snapshotOffset;
    state.scope = snapshotScope;
    state.view = snapshotView;
    state.data = snapshotData;
  }
}

function bigintToLength(length: bigint, context: string): number {
  if (length < 0n) {
    throw new AbiDecodeError(`Array length expression in '${context}' evaluated to a negative value`);
  }
  const number = Number(length);
  if (!Number.isSafeInteger(number)) {
    throw new AbiDecodeError(`Array length expression in '${context}' exceeds JavaScript's safe integer range`);
  }
  return number;
}

function bigintToNumber(value: bigint, context: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new AbiDecodeError(`Expression in '${context}' resulted in a value outside of JS safe integer range`);
  }
  return number;
}

function ensureAvailable(state: DecodeState, size: number, context: string) {
  if (state.offset + size > state.view.byteLength) {
    throw new AbiDecodeError(`Insufficient data while decoding '${context}'`, {
      requested: size,
      remaining: state.view.byteLength - state.offset,
    });
  }
}

function sliceHex(buffer: Uint8Array, start: number, end: number): string {
  return bytesToHex(buffer.subarray(start, end));
}

function createOpaqueValue(description: string, buffer: Uint8Array, start: number, end: number, typeName?: string) {
  return {
    kind: "opaque",
    description,
    byteOffset: start,
    byteLength: end - start,
    rawHex: sliceHex(buffer, start, end),
    typeName,
  } as const;
}

function computeTrailingConstantSizes(struct: StructType, registry: TypeRegistry): Array<number | null> {
  const memo = new Map<string, number | null>();
  const sizes: Array<number | null> = [];
  for (let i = 0; i < struct.fields.length; i++) {
    let total = 0;
    let deterministic = true;
    for (let j = i + 1; j < struct.fields.length; j++) {
      const size = getConstSize(struct.fields[j].type, registry, memo, new Set());
      if (size === null) {
        deterministic = false;
        break;
      }
      total += size;
    }
    sizes.push(deterministic ? total : null);
  }
  return sizes;
}

export function getConstSize(
  kind: TypeKind,
  registry: TypeRegistry,
  memo: Map<string, number | null>,
  stack: Set<string>,
): number | null {
  switch (kind.kind) {
    case "primitive":
      return primitiveInfo[kind.primitive].byteLength;
    case "array": {
      const elementSize = getConstSize(kind.elementType, registry, memo, stack);
      if (elementSize === null) return null;
      const length = evaluateConstExpression(kind.size);
      if (length === null) return null;
      return elementSize * Number(length);
    }
    case "struct": {
      let total = 0;
      for (const field of kind.fields) {
        const size = getConstSize(field.type, registry, memo, stack);
        if (size === null) return null;
        total += size;
      }
      return total;
    }
    case "enum": {
      let variantSize: number | null = null;
      for (const variant of kind.variants) {
        const size = getConstSize(variant.type, registry, memo, stack);
        if (size === null) return null;
        if (variantSize === null) variantSize = size;
        else if (variantSize !== size) return null;
      }
      return variantSize;
    }
    case "union": {
      let maxSize = 0;
      for (const variant of kind.variants) {
        const size = getConstSize(variant.type, registry, memo, stack);
        if (size === null) return null;
        maxSize = Math.max(maxSize, size);
      }
      return maxSize;
    }
    case "size-discriminated-union":
      return null;
    case "type-ref":
      if (memo.has(kind.name)) {
        return memo.get(kind.name) ?? null;
      }
      if (stack.has(kind.name)) {
        return null;
      }
      stack.add(kind.name);
      const resolved = registry.get(kind.name);
      const resolvedSize = getConstSize(resolved.kind, registry, memo, stack);
      stack.delete(kind.name);
      memo.set(kind.name, resolvedSize);
      return resolvedSize;
    default:
      kind satisfies never;
      return null;
  }
}

function evaluateConstExpression(expression: Expression): bigint | null {
  switch (expression.type) {
    case "literal":
      return expression.value;
    case "binary": {
      const left = evaluateConstExpression(expression.left);
      const right = evaluateConstExpression(expression.right);
      if (left === null || right === null) return null;
      switch (expression.op) {
        case "add":
          return left + right;
        case "sub":
          return left - right;
        case "mul":
          return left * right;
        case "div":
          if (right === 0n) return null;
          return left / right;
        default:
          return null;
      }
    }
    case "field-ref":
    case "unary":
    case "sizeof":
    case "alignof":
      return null;
    default:
      expression satisfies never;
      return null;
  }
}
type PrimitiveReadFn = (view: DataView, offset: number) => number | bigint;

const primitiveInfo: Record<
  PrimitiveName,
  {
    byteLength: number;
    read: PrimitiveReadFn;
  }
> = {
  u8: { byteLength: 1, read: (view, offset) => view.getUint8(offset) },
  i8: { byteLength: 1, read: (view, offset) => view.getInt8(offset) },
  u16: { byteLength: 2, read: (view, offset) => view.getUint16(offset, true) },
  i16: { byteLength: 2, read: (view, offset) => view.getInt16(offset, true) },
  u32: { byteLength: 4, read: (view, offset) => view.getUint32(offset, true) },
  i32: { byteLength: 4, read: (view, offset) => view.getInt32(offset, true) },
  u64: { byteLength: 8, read: (view, offset) => view.getBigUint64(offset, true) },
  i64: { byteLength: 8, read: (view, offset) => view.getBigInt64(offset, true) },
  f32: { byteLength: 4, read: (view, offset) => view.getFloat32(offset, true) },
  f64: { byteLength: 8, read: (view, offset) => view.getFloat64(offset, true) },
  f16: {
    byteLength: 2,
    read: (view, offset) => {
      // Read as u16, treat as opaque f16 for now (no native JS f16 support yet)
      // Future: convert to f32 using a helper if needed
      return view.getUint16(offset, true);
    },
  },
};

export function getTypeAlignment(kind: TypeKind, registry: TypeRegistry): number {
  switch (kind.kind) {
    case "primitive":
      return primitiveInfo[kind.primitive].byteLength;
    case "struct":
      if (kind.attributes.aligned > 0) return kind.attributes.aligned;
      // Default struct alignment is max of its fields' alignments
      // If packed, alignment is 1 (but we only call this if !packed usually)
      // However, standard C rules say struct alignment is max field alignment
      return kind.fields.reduce((max, field) => Math.max(max, getTypeAlignment(field.type, registry)), 1);
    case "array":
      return getTypeAlignment(kind.elementType, registry);
    case "enum":
      // Alignment of the tag? Or the variants?
      // Enums in ABI usually are just the tag + payload.
      // Alignment is likely determined by the tag type or the union of variants?
      // Rust implementation suggests it aligns based on the tag type first?
      // Actually, for a safe default, we can assume alignment of the largest member or just 1 if packed.
      // Let's check if it has explicit alignment
      if (kind.attributes.aligned > 0) return kind.attributes.aligned;
      return 1; // Fallback
    case "union":
      if (kind.attributes.aligned > 0) return kind.attributes.aligned;
      return kind.variants.reduce((max, variant) => Math.max(max, getTypeAlignment(variant.type, registry)), 1);
    case "size-discriminated-union":
      if (kind.attributes.aligned > 0) return kind.attributes.aligned;
      return kind.variants.reduce((max, variant) => Math.max(max, getTypeAlignment(variant.type, registry)), 1);
    case "type-ref":
      return getTypeAlignment(registry.get(kind.name).kind, registry);
    default:
      return 1;
  }
}

