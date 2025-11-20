import type { BinaryOperator, Expression, UnaryOperator } from "./abiSchema";
import type { DecodedStructValue, DecodedValue } from "./decodedValue";
import { AbiDecodeError } from "./errors";
import type { TypeRegistry } from "./typeRegistry";
import { getConstSize, getTypeAlignment } from "./decoder";

export interface FieldScope {
  fields: Map<string, DecodedValue>;
  parent?: FieldScope;
}

export function evaluateExpression(expression: Expression, scope: FieldScope | undefined, context: string, registry?: TypeRegistry): bigint {
  switch (expression.type) {
    case "literal":
      return expression.value;
    case "field-ref":
      return toBigIntValue(resolveFieldPath(expression.path, scope, context), context);
    case "binary":
      return applyBinaryOperator(
        expression.op,
        evaluateExpression(expression.left, scope, `${context} (left)`, registry),
        evaluateExpression(expression.right, scope, `${context} (right)`, registry),
        context,
      );
    case "unary":
      return applyUnaryOperator(
        expression.op,
        evaluateExpression(expression.operand, scope, `${context} (operand)`, registry),
        context,
      );
    case "sizeof":
      if (!registry) {
        throw new AbiDecodeError(`Cannot evaluate sizeof(${expression.typeName}) without a TypeRegistry`);
      }
      const type = registry.get(expression.typeName);
      // We need access to getConstSize from decoder.ts or similar logic
      // Since getConstSize is currently internal to decoder.ts and not exported/accessible easily without refactoring
      // We will assume getConstSize is made available or we implement a simple lookup if possible.
      // However, decoder.ts imports expression.ts, so we have a circular dependency if we import getConstSize directly from decoder.ts
      // ideally getConstSize should be in a separate file.
      // For now, let's use the imported one if we can move it, or throw/stub it.
      const size = getConstSize(type.kind, registry, new Map(), new Set());
      if (size === null) {
        throw new AbiDecodeError(`sizeof(${expression.typeName}) is not constant`);
      }
      return BigInt(size);
    case "alignof":
      if (!registry) {
        throw new AbiDecodeError(`Cannot evaluate alignof(${expression.typeName}) without a TypeRegistry`);
      }
      const targetType = registry.get(expression.typeName);
      const alignment = Math.max(getTypeAlignment(targetType.kind, registry), 1);
      return BigInt(alignment);
    default:
      expression satisfies never;
      throw new AbiDecodeError(`Unsupported expression encountered while decoding ${context}`);
  }
}

export function resolveFieldPath(path: string[], scope: FieldScope | undefined, context: string): DecodedValue {
  if (path.length === 0) {
    throw new AbiDecodeError(`Invalid field-ref in ${context}: path cannot be empty`);
  }
  if (!scope) {
    throw new AbiDecodeError(`Unable to resolve field '${path.join(".")}' in ${context}`);
  }

  const [head, ...tail] = path;

  if (head === "..") {
    if (!scope.parent) {
      throw new AbiDecodeError(`Field reference in ${context} attempted to access parent scope, but none exists`);
    }
    return resolveFieldPath(tail, scope.parent, context);
  }

  if (scope.fields.has(head)) {
    const value = scope.fields.get(head)!;
    if (tail.length === 0) {
      return value;
    }
    return resolveNestedStructValue(value, tail, context);
  }

  return resolveFieldPath(path, scope.parent, context);
}

function resolveNestedStructValue(value: DecodedValue, path: string[], context: string): DecodedValue {
  if (value.kind !== "struct") {
    throw new AbiDecodeError(
      `Field reference '${path.join(".")}' in ${context} traversed through non-struct value of kind '${value.kind}'`,
    );
  }
  const [head, ...tail] = path;
  const nested = value.fields[head];
  if (!nested) {
    throw new AbiDecodeError(`Struct field '${head}' referenced in ${context} does not exist`);
  }
  if (tail.length === 0) {
    return nested;
  }
  return resolveNestedStructValue(nested, tail, context);
}

function toBigIntValue(value: DecodedValue, context: string): bigint {
  if (value.kind !== "primitive") {
    throw new AbiDecodeError(`Expression in ${context} referenced non-primitive value of kind '${value.kind}'`);
  }
  return typeof value.value === "bigint" ? value.value : BigInt(value.value);
}

function applyBinaryOperator(op: BinaryOperator, left: bigint, right: bigint, context: string): bigint {
  switch (op) {
    case "add":
      return left + right;
    case "sub":
      return left - right;
    case "mul":
      return left * right;
    case "div":
      if (right === 0n) {
        throw new AbiDecodeError(`Division by zero while evaluating expression for ${context}`);
      }
      return left / right;
    case "mod":
      if (right === 0n) {
        throw new AbiDecodeError(`Modulo by zero while evaluating expression for ${context}`);
      }
      return left % right;
    case "bit-and":
      return left & right;
    case "bit-or":
      return left | right;
    case "bit-xor":
      return left ^ right;
    case "left-shift":
      return left << right;
    case "right-shift":
      return left >> right;
    default:
      op satisfies never;
      throw new AbiDecodeError(`Binary operator '${op}' is not supported in ${context}`);
  }
}

function applyUnaryOperator(op: UnaryOperator, operand: bigint, context: string): bigint {
  switch (op) {
    case "bit-not":
      return ~operand;
    default:
      op satisfies never;
      throw new AbiDecodeError(`Unary operator '${op}' is not supported in ${context}`);
  }
}

export function createScope(parent?: FieldScope): FieldScope {
  return { fields: new Map(), parent };
}

export function addFieldToScope(scope: FieldScope | undefined, name: string, value: DecodedValue) {
  if (scope) {
    scope.fields.set(name, value);
  }
}

