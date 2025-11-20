import YAML from "yaml";
import { AbiParseError, AbiValidationError } from "./errors";

export type PrimitiveName = "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f16" | "f32" | "f64";
const PRIMITIVE_NAMES: readonly PrimitiveName[] = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f16", "f32", "f64"];

export interface ContainerAttributes {
  packed: boolean;
  aligned: number;
  comment?: string;
}

export interface AbiMetadata {
  package: string;
  abiVersion: number;
  packageVersion?: string;
  description?: string;
}

export interface AbiDocument {
  metadata: AbiMetadata;
  types: TypeDefinition[];
}

export interface TypeDefinition {
  name: string;
  kind: TypeKind;
}

export type TypeKind =
  | PrimitiveType
  | StructType
  | ArrayType
  | EnumType
  | UnionType
  | SizeDiscriminatedUnionType
  | TypeRefType;

export interface PrimitiveType {
  kind: "primitive";
  primitive: PrimitiveName;
}

export interface StructField {
  name: string;
  type: TypeKind;
}

export interface StructType {
  kind: "struct";
  attributes: ContainerAttributes;
  fields: StructField[];
}

export interface ArrayType {
  kind: "array";
  attributes: ContainerAttributes;
  elementType: TypeKind;
  size: Expression;
}

export interface EnumVariant {
  name: string;
  tagValue: number;
  type: TypeKind;
}

export interface EnumType {
  kind: "enum";
  attributes: ContainerAttributes;
  tagExpression: Expression;
  variants: EnumVariant[];
}

export interface UnionVariant {
  name: string;
  type: TypeKind;
}

export interface UnionType {
  kind: "union";
  attributes: ContainerAttributes;
  variants: UnionVariant[];
}

export interface SizeDiscriminatedVariant {
  name: string;
  expectedSize: number;
  type: TypeKind;
}

export interface SizeDiscriminatedUnionType {
  kind: "size-discriminated-union";
  attributes: ContainerAttributes;
  variants: SizeDiscriminatedVariant[];
}

export interface TypeRefType {
  kind: "type-ref";
  name: string;
}

export type Expression = LiteralExpression | FieldRefExpression | BinaryExpression | UnaryExpression | SizeOfExpression | AlignOfExpression;

export interface LiteralExpression {
  type: "literal";
  literalType: PrimitiveName;
  value: bigint;
}

export interface FieldRefExpression {
  type: "field-ref";
  path: string[];
}

export type BinaryOperator = "add" | "sub" | "mul" | "div" | "mod" | "bit-and" | "bit-or" | "bit-xor" | "left-shift" | "right-shift";

export interface BinaryExpression {
  type: "binary";
  op: BinaryOperator;
  left: Expression;
  right: Expression;
}

export type UnaryOperator = "bit-not";

export interface UnaryExpression {
  type: "unary";
  op: UnaryOperator;
  operand: Expression;
}

export interface SizeOfExpression {
  type: "sizeof";
  typeName: string;
}

export interface AlignOfExpression {
  type: "alignof";
  typeName: string;
}

export function parseAbiDocument(yamlText: string): AbiDocument {
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlText, { intAsBigInt: true });
  } catch (error) {
    throw new AbiParseError("Failed to parse ABI YAML", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const root = requireRecord(parsed, "ABI document");
  const abiNode = requireRecord(root.abi, "abi metadata");
  const typesNode = root.types;

  if (!Array.isArray(typesNode)) {
    throw new AbiValidationError("ABI file must contain a 'types' array");
  }

  const metadata = parseMetadata(abiNode);
  const types = typesNode.map((entry, index) => parseTypeDefinition(entry, index));

  ensureTypeNamesUnique(types);

  return { metadata, types };
}

function parseMetadata(node: Record<string, unknown>): AbiMetadata {
  const pkg = requireString(node.package, "abi.package");
  const abiVersionRaw = node["abi-version"];
  if (abiVersionRaw === undefined || abiVersionRaw === null) {
    throw new AbiValidationError("abi.abi-version is required");
  }
  const abiVersion = Number(abiVersionRaw);
  if (!Number.isFinite(abiVersion)) {
    throw new AbiValidationError("abi.abi-version must be a number");
  }

  const imports = node.imports;
  if (imports !== undefined) {
    const importList = Array.isArray(imports) ? imports : [];
    if (importList.length > 0) {
      throw new AbiValidationError("Flattened ABI files cannot contain 'imports'");
    }
  }

  const metadata: AbiMetadata = {
    package: pkg,
    abiVersion,
  };

  if (typeof node["package-version"] === "string") {
    metadata.packageVersion = node["package-version"];
  }
  if (typeof node.description === "string") {
    metadata.description = node.description;
  }

  return metadata;
}

function parseTypeDefinition(entry: unknown, index: number): TypeDefinition {
  const node = requireRecord(entry, `types[${index}]`);
  const name = requireString(node.name, `types[${index}].name`);
  const kindNode = node.kind;
  if (!kindNode || typeof kindNode !== "object") {
    throw new AbiValidationError(`Type '${name}' is missing its 'kind' definition`);
  }
  const kind = parseTypeKind(kindNode as Record<string, unknown>, name);
  return { name, kind };
}

function parseTypeKind(node: Record<string, unknown>, context: string): TypeKind {
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    throw new AbiValidationError(`Type '${context}' kind must be a single-entry object`);
  }

  const key = keys[0];
  const value = node[key];

  switch (key) {
    case "primitive":
      return parsePrimitiveType(value, context);
    case "struct":
      return parseStructType(requireRecord(value, `struct for ${context}`), context);
    case "array":
      return parseArrayType(requireRecord(value, `array for ${context}`), context);
    case "enum":
      return parseEnumType(requireRecord(value, `enum for ${context}`), context);
    case "union":
      return parseUnionType(requireRecord(value, `union for ${context}`), context);
    case "size-discriminated-union":
      return parseSizeDiscriminatedUnionType(requireRecord(value, `size-discriminated-union for ${context}`), context);
    case "type-ref":
      return parseTypeRef(requireRecord(value, `type-ref for ${context}`), context);
    default:
      throw new AbiValidationError(`Type '${context}' uses unsupported kind '${key}'`);
  }
}

function parsePrimitiveType(value: unknown, context: string): PrimitiveType {
  if (typeof value !== "string") {
    throw new AbiValidationError(`Primitive type for '${context}' must be a string`);
  }
  if (!PRIMITIVE_NAMES.includes(value as PrimitiveName)) {
    throw new AbiValidationError(`Type '${context}' references unknown primitive '${value}'`);
  }
  return { kind: "primitive", primitive: value as PrimitiveName };
}

function parseStructType(node: Record<string, unknown>, context: string): StructType {
  const attributes = parseContainerAttributes(node);
  const fieldsNode = node.fields;
  if (!Array.isArray(fieldsNode)) {
    throw new AbiValidationError(`Struct '${context}' must define a 'fields' array`);
  }

  const fields = fieldsNode.map((fieldNode, index) => {
    const field = requireRecord(fieldNode, `field ${index} in struct '${context}'`);
    const name = requireString(field.name, `field ${index} name in struct '${context}'`);
    const fieldTypeNode = field["field-type"];
    if (!fieldTypeNode || typeof fieldTypeNode !== "object") {
      throw new AbiValidationError(`Field '${name}' in struct '${context}' is missing 'field-type'`);
    }
    const type = parseTypeKind(fieldTypeNode as Record<string, unknown>, `${context}.${name}`);
    return { name, type };
  });

  return { kind: "struct", attributes, fields };
}

function parseArrayType(node: Record<string, unknown>, context: string): ArrayType {
  const attributes = parseContainerAttributes(node);
  const elementNode = node["element-type"];
  if (!elementNode || typeof elementNode !== "object") {
    throw new AbiValidationError(`Array '${context}' is missing 'element-type'`);
  }
  const elementType = parseTypeKind(elementNode as Record<string, unknown>, `${context}[]`);
  const sizeNode = node.size;
  if (!sizeNode || typeof sizeNode !== "object") {
    throw new AbiValidationError(`Array '${context}' is missing its 'size' expression`);
  }
  const size = parseExpression(sizeNode as Record<string, unknown>, `array '${context}' size`);
  return { kind: "array", attributes, elementType, size };
}

function parseEnumType(node: Record<string, unknown>, context: string): EnumType {
  const attributes = parseContainerAttributes(node);
  const tagRefNode = node["tag-ref"];
  if (!tagRefNode || typeof tagRefNode !== "object") {
    throw new AbiValidationError(`Enum '${context}' must define 'tag-ref'`);
  }
  const tagExpression = parseExpression(tagRefNode as Record<string, unknown>, `enum '${context}' tag-ref`);

  const variantsNode = node.variants;
  if (!Array.isArray(variantsNode) || variantsNode.length === 0) {
    throw new AbiValidationError(`Enum '${context}' must include at least one variant`);
  }

  const variants = variantsNode.map((variantNode, index) => {
    const variant = requireRecord(variantNode, `variant ${index} in enum '${context}'`);
    const name = requireString(variant.name, `variant ${index} name in enum '${context}'`);
    const tagValueRaw = variant["tag-value"];
    if (tagValueRaw === undefined || tagValueRaw === null) {
      throw new AbiValidationError(`Variant '${name}' in enum '${context}' must define 'tag-value'`);
    }
    const tagValue = Number(tagValueRaw);
    if (!Number.isSafeInteger(tagValue)) {
      throw new AbiValidationError(`Variant '${name}' in enum '${context}' has invalid tag-value`);
    }

    const variantTypeNode = variant["variant-type"];
    if (!variantTypeNode || typeof variantTypeNode !== "object") {
      throw new AbiValidationError(`Variant '${name}' in enum '${context}' is missing 'variant-type'`);
    }
    const type = parseTypeKind(variantTypeNode as Record<string, unknown>, `${context}.${name}`);
    return { name, tagValue, type };
  });

  return { kind: "enum", attributes, tagExpression, variants };
}

function parseUnionType(node: Record<string, unknown>, context: string): UnionType {
  const attributes = parseContainerAttributes(node);
  const variantsNode = node.variants;
  if (!Array.isArray(variantsNode) || variantsNode.length === 0) {
    throw new AbiValidationError(`Union '${context}' must include at least one variant`);
  }

  const variants = variantsNode.map((variantNode, index) => {
    const variant = requireRecord(variantNode, `variant ${index} in union '${context}'`);
    const name = requireString(variant.name, `variant ${index} name in union '${context}'`);
    const variantTypeNode = variant["variant-type"];
    if (!variantTypeNode || typeof variantTypeNode !== "object") {
      throw new AbiValidationError(`Variant '${name}' in union '${context}' is missing 'variant-type'`);
    }
    const type = parseTypeKind(variantTypeNode as Record<string, unknown>, `${context}.${name}`);
    return { name, type };
  });

  return { kind: "union", attributes, variants };
}

function parseSizeDiscriminatedUnionType(node: Record<string, unknown>, context: string): SizeDiscriminatedUnionType {
  const attributes = parseContainerAttributes(node);
  const variantsNode = node.variants;
  if (!Array.isArray(variantsNode) || variantsNode.length === 0) {
    throw new AbiValidationError(`Size-discriminated union '${context}' must include variants`);
  }

  const variants = variantsNode.map((variantNode, index) => {
    const variant = requireRecord(variantNode, `variant ${index} in size-discriminated union '${context}'`);
    const name = requireString(variant.name, `variant ${index} name in size-discriminated union '${context}'`);
    const sizeRaw = variant["expected-size"];
    if (sizeRaw === undefined || sizeRaw === null) {
      throw new AbiValidationError(`Variant '${name}' in '${context}' must define 'expected-size'`);
    }
    const expectedSize = Number(sizeRaw);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
      throw new AbiValidationError(`Variant '${name}' in '${context}' has invalid expected-size`);
    }

    const variantTypeNode = variant["variant-type"];
    if (!variantTypeNode || typeof variantTypeNode !== "object") {
      throw new AbiValidationError(`Variant '${name}' in '${context}' is missing 'variant-type'`);
    }
    const type = parseTypeKind(variantTypeNode as Record<string, unknown>, `${context}.${name}`);
    return { name, expectedSize, type };
  });

  return { kind: "size-discriminated-union", attributes, variants };
}

function parseTypeRef(node: Record<string, unknown>, context: string): TypeRefType {
  const name = requireString(node.name, `type-ref in '${context}'`);
  return { kind: "type-ref", name };
}

function parseContainerAttributes(node: Record<string, unknown>): ContainerAttributes {
  const packed = node.packed === true;
  const alignedRaw = node.aligned;
  const aligned = alignedRaw === undefined ? 0 : Number(alignedRaw);
  if (aligned < 0 || !Number.isFinite(aligned)) {
    throw new AbiValidationError("Container alignment must be a positive number when specified");
  }

  const attrs: ContainerAttributes = { packed, aligned };
  if (typeof node.comment === "string") {
    attrs.comment = node.comment;
  }
  return attrs;
}

function parseExpression(node: Record<string, unknown>, context: string): Expression {
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    throw new AbiValidationError(`Expression for ${context} must contain exactly one operator`);
  }
  const key = keys[0];
  const value = node[key];

  switch (key) {
    case "literal":
      return parseLiteralExpression(requireRecord(value, `literal expression in ${context}`), context);
    case "field-ref":
      return parseFieldRefExpression(requireRecord(value, `field-ref expression in ${context}`), context);
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod":
    case "bit-and":
    case "bit-or":
    case "bit-xor":
    case "left-shift":
    case "right-shift":
      return parseBinaryExpression(key, requireRecord(value, `${key} expression in ${context}`), context);
    case "bit-not":
      return parseUnaryExpression(key, requireRecord(value, `${key} expression in ${context}`), context);
    case "sizeof":
      return parseSizeOfExpression(requireRecord(value, `sizeof expression in ${context}`), context);
    case "alignof":
      return parseAlignOfExpression(requireRecord(value, `alignof expression in ${context}`), context);
    default:
      throw new AbiValidationError(`Expression '${key}' in ${context} is not supported yet`);
  }
}

function parseLiteralExpression(node: Record<string, unknown>, context: string): LiteralExpression {
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    throw new AbiValidationError(`Literal expression for ${context} must specify exactly one primitive type`);
  }
  const literalType = keys[0] as PrimitiveName;
  if (!PRIMITIVE_NAMES.includes(literalType)) {
    throw new AbiValidationError(`Literal in ${context} references unknown primitive '${literalType}'`);
  }
  const rawValue = node[literalType];
  if (typeof rawValue !== "number" && typeof rawValue !== "bigint") {
    throw new AbiValidationError(`Literal in ${context} must be a number`);
  }
  const value = toBigInt(rawValue);
  return { type: "literal", literalType, value };
}

function parseFieldRefExpression(node: Record<string, unknown>, context: string): FieldRefExpression {
  const pathNode = node.path;
  if (!Array.isArray(pathNode) || pathNode.length === 0) {
    throw new AbiValidationError(`field-ref in ${context} must define a non-empty path array`);
  }
  const path = pathNode.map((segment, index) => {
    if (typeof segment !== "string") {
      throw new AbiValidationError(`field-ref segment ${index} in ${context} must be a string`);
    }
    return segment;
  });
  return { type: "field-ref", path };
}

function parseBinaryExpression(op: string, node: Record<string, unknown>, context: string): BinaryExpression {
  const leftNode = node.left;
  const rightNode = node.right;
  if (!leftNode || typeof leftNode !== "object" || !rightNode || typeof rightNode !== "object") {
    throw new AbiValidationError(`Binary expression '${op}' in ${context} must include 'left' and 'right'`);
  }
  const left = parseExpression(leftNode as Record<string, unknown>, `${context} (left operand)`);
  const right = parseExpression(rightNode as Record<string, unknown>, `${context} (right operand)`);
  return { type: "binary", op: op as BinaryOperator, left, right };
}

function parseUnaryExpression(op: string, node: Record<string, unknown>, context: string): UnaryExpression {
  const operandNode = node.operand;
  if (!operandNode || typeof operandNode !== "object") {
    throw new AbiValidationError(`Unary expression '${op}' in ${context} must include 'operand'`);
  }
  const operand = parseExpression(operandNode as Record<string, unknown>, `${context} (operand)`);
  return { type: "unary", op: op as UnaryOperator, operand };
}

function parseSizeOfExpression(node: Record<string, unknown>, context: string): SizeOfExpression {
  const typeName = requireString(node["type-name"], `${context}.type-name`);
  return { type: "sizeof", typeName };
}

function parseAlignOfExpression(node: Record<string, unknown>, context: string): AlignOfExpression {
  const typeName = requireString(node["type-name"], `${context}.type-name`);
  return { type: "alignof", typeName };
}

function ensureTypeNamesUnique(types: TypeDefinition[]) {
  const seen = new Set<string>();
  for (const type of types) {
    if (seen.has(type.name)) {
      throw new AbiValidationError(`Duplicate type definition '${type.name}' found in ABI`);
    }
    seen.add(type.name);
  }
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AbiValidationError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AbiValidationError(`${context} must be a non-empty string`);
  }
  return value;
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new AbiValidationError("Literal values must be integers");
  }
  return BigInt(value);
}

