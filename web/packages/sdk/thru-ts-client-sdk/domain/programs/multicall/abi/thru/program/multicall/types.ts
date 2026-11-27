/* Auto-generated TypeScript code */
/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */

import { InstructionData } from "../../common/primitives/types";

type __TnIrNode =
  | { readonly op: "zero" }
  | { readonly op: "const"; readonly value: bigint }
  | { readonly op: "field"; readonly param: string }
  | {
      readonly op: "add";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op: "sub";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op: "mul";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op:
        | "div"
        | "mod"
        | "bitAnd"
        | "bitOr"
        | "bitXor"
        | "leftShift"
        | "rightShift";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op: "align";
      readonly alignment: number;
      readonly node: __TnIrNode;
    }
  | {
      readonly op: "switch";
      readonly tag: string;
      readonly cases: readonly { readonly value: number | bigint; readonly node: __TnIrNode }[];
      readonly default?: __TnIrNode;
    }
  | {
      readonly op: "call";
      readonly typeName: string;
      readonly args: readonly { readonly name: string; readonly source: string }[];
    }
  | {
      readonly op: "sumOverArray";
      readonly count: __TnIrNode;
      readonly elementTypeName: string;
      readonly fieldName: string;
      readonly payloadParam?: string;
    };

type __TnIrContext = {
  params: Record<string, bigint>;
  buffer?: Uint8Array;
  typeName?: string;
};

type __TnValidateResult = {
  ok: boolean;
  code?: string;
  consumed?: bigint;
  params?: Record<string, bigint>;
};
type __TnEvalResult =
  | { ok: true; value: bigint }
  | { ok: false; code: string };
type __TnBuilderLike = { build(): Uint8Array };
type __TnStructFieldInput =
  | Uint8Array
  | __TnBuilderLike
  | { buffer?: Uint8Array }
  | { asUint8Array?: () => Uint8Array }
  | { bytes?: () => Uint8Array };
type __TnVariantDescriptor = {
  readonly name: string;
  /* A bigint for tags past 2^53 - 1, which a number cannot hold exactly. */
  readonly tag: number | bigint;
  readonly payloadSize: number | null;
  readonly payloadType?: string;
  readonly createPayloadBuilder?: () => unknown | null;
};
type __TnVariantSelectorResult<Parent> = {
  select(
    name: string
  ): { writePayload(payload: Uint8Array | __TnBuilderLike): { finish(): Parent } };
  finish(): Parent;
};
type __TnFamWriterResult<Parent> = {
  write(payload: Uint8Array | __TnBuilderLike): { finish(): Parent };
  finish(): Parent;
};
type __TnConsole = { warn?: (...args: unknown[]) => void };

const __tnWarnings = new Set<string>();
const __tnHasNativeBigInt = typeof BigInt === "function";
const __tnHasBigIntDataView =
  typeof DataView !== "undefined" &&
  typeof DataView.prototype.getBigInt64 === "function" &&
  typeof DataView.prototype.getBigUint64 === "function" &&
  typeof DataView.prototype.setBigInt64 === "function" &&
  typeof DataView.prototype.setBigUint64 === "function";
const __tnConsole: __TnConsole | undefined =
  typeof globalThis !== "undefined"
    ? (globalThis as { console?: __TnConsole }).console
    : undefined;

function __tnLogWarn(message: string): void {
  if (__tnConsole && typeof __tnConsole.warn === "function") {
    __tnConsole.warn(message);
  }
}

function __tnWarnOnce(message: string): void {
  if (!__tnWarnings.has(message)) {
    __tnWarnings.add(message);
    __tnLogWarn(message);
  }
}

/* Builders never return bytes their type's `validate` rejects. */
function __tnBuilderValidateOrThrow(typeName: string, result: { ok: boolean; code?: string }): void {
  if (!result.ok) throw new Error(`${typeName}Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
}

/* Packed params as a measuring walk's context: `T.kind` becomes `kind`. */
function __tnParamsContext(record: Record<string, bigint>, prefix: string): Record<string, bigint> {
  const ctx: Record<string, bigint> = Object.create(null);
  for (const key of Object.keys(record)) {
    ctx[key.startsWith(prefix) ? key.slice(prefix.length) : key] = record[key];
  }
  return ctx;
}

function __tnResolveBuilderInput(
  input: Uint8Array | __TnBuilderLike,
  context: string
): Uint8Array {
  if (input instanceof Uint8Array) {
    return new Uint8Array(input);
  }
  if (input && typeof (input as __TnBuilderLike).build === "function") {
    const built = (input as __TnBuilderLike).build();
    if (!(built instanceof Uint8Array)) {
      throw new Error(`${context}: builder did not return Uint8Array`);
    }
    return new Uint8Array(built);
  }
  throw new Error(`${context}: expected Uint8Array or builder`);
}

function __tnResolveStructFieldInput(
  input: __TnStructFieldInput,
  context: string
): Uint8Array {
  if (
    input instanceof Uint8Array ||
    (input && typeof (input as __TnBuilderLike).build === "function")
  ) {
    return __tnResolveBuilderInput(input as Uint8Array | __TnBuilderLike, context);
  }
  if (input && typeof (input as { asUint8Array?: () => Uint8Array }).asUint8Array === "function") {
    const bytes = (input as { asUint8Array: () => Uint8Array }).asUint8Array();
    return new Uint8Array(bytes);
  }
  if (input && typeof (input as { bytes?: () => Uint8Array }).bytes === "function") {
    const bytes = (input as { bytes: () => Uint8Array }).bytes();
    return new Uint8Array(bytes);
  }
  if (input && (input as { buffer?: unknown }).buffer instanceof Uint8Array) {
    return new Uint8Array((input as { buffer: Uint8Array }).buffer);
  }
  throw new Error(`${context}: expected Uint8Array, builder, or view-like value`);
}

function __tnMaybeCallBuilder(ctor: unknown): unknown | null {
  if (!ctor) {
    return null;
  }
  const builderFn = (ctor as { builder?: () => unknown }).builder;
  return typeof builderFn === "function" ? builderFn() : null;
}

function __tnCreateVariantSelector<Parent, Descriptor extends __TnVariantDescriptor>(
  parent: Parent,
  descriptors: readonly Descriptor[],
  assign: (descriptor: Descriptor, payload: Uint8Array) => void
): __TnVariantSelectorResult<Parent> {
  return {
    select(name: string) {
      const descriptor = descriptors.find((variant) => variant.name === name);
      if (!descriptor) {
        throw new Error(`Unknown variant '${name}'`);
      }
      return {
        writePayload(payload: Uint8Array | __TnBuilderLike) {
          const bytes = __tnResolveBuilderInput(
            payload,
            `variant ${descriptor.name}`
          );
          if (
            descriptor.payloadSize !== null &&
            bytes.length !== descriptor.payloadSize
          ) {
            throw new Error(
              `Payload for ${descriptor.name} must be ${descriptor.payloadSize} bytes`
            );
          }
          assign(descriptor, bytes);
          return {
            finish(): Parent {
              return parent;
            },
          };
        },
      };
    },
    finish(): Parent {
      return parent;
    },
  };
}

function __tnCreateFamWriter<Parent>(
  parent: Parent,
  fieldName: string,
  assign: (bytes: Uint8Array) => void
): __TnFamWriterResult<Parent> {
  let hasWritten = false;
  return {
    write(payload: Uint8Array | __TnBuilderLike) {
      const bytes = __tnResolveBuilderInput(
        payload,
        `flexible array '${fieldName}'`
      );
      const copy = new Uint8Array(bytes);
      assign(copy);
      hasWritten = true;
      return {
        finish(): Parent {
          return parent;
        },
      };
    },
    finish(): Parent {
      if (!hasWritten) {
        throw new Error(
          `flexible array '${fieldName}' requires write() before finish()`
        );
      }
      return parent;
    },
  };
}

const __tnMask32 = __tnHasNativeBigInt
  ? (BigInt(1) << BigInt(32)) - BigInt(1)
  : 0xffffffff;
const __tnSignBit32 = __tnHasNativeBigInt
  ? BigInt(1) << BigInt(31)
  : 0x80000000;

function __tnToBigInt(value: number | bigint): bigint {
  if (__tnHasNativeBigInt) {
    return typeof value === "bigint" ? value : BigInt(value);
  }
  if (typeof value === "bigint") return value;
  if (!Number.isFinite(value)) {
    throw new Error("IR runtime received non-finite numeric input");
  }
  if (!Number.isSafeInteger(value)) {
    __tnWarnOnce(
      `[thru-net] Precision loss while polyfilling BigInt (value=${value})`
    );
  }
  return (value as unknown) as bigint;
}

function __tnBigIntToNumber(value: bigint, context: string): number {
  if (__tnHasNativeBigInt) {
    const converted = Number(value);
    if (!Number.isFinite(converted)) {
      throw new Error(`${context} overflowed Number range`);
    }
    return converted;
  }
  return value as unknown as number;
}

function __tnBigIntEquals(lhs: bigint, rhs: bigint): boolean {
  if (__tnHasNativeBigInt) return lhs === rhs;
  return (lhs as unknown as number) === (rhs as unknown as number);
}

function __tnBigIntGreaterThan(lhs: bigint, rhs: bigint): boolean {
  if (__tnHasNativeBigInt) return lhs > rhs;
  return (lhs as unknown as number) > (rhs as unknown as number);
}

/* Set bits of a u64 (a bigint is read as its low 64 bits; a number as
   its low 32, as before). */
function __tnPopcount(value: number | bigint): number {
  if (typeof value === "bigint") {
    let v = BigInt.asUintN(64, value);
    let count = 0;
    while (v !== BigInt(0)) {
      v &= v - BigInt(1);
      count++;
    }
    return count;
  }
  let v = Number(value) >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function __tnRaiseIrError(code: string, message: string): never {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  throw err;
}

function __tnCheckedAdd(lhs: bigint, rhs: bigint): bigint {
  if (__tnHasNativeBigInt) {
    const result = (lhs as bigint) + (rhs as bigint);
    if (result < BigInt(0) || result > __tnU64(-BigInt(1))) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected an addition outside u64"
      );
    }
    return result;
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const sum = left + right;
  if (sum < 0 || !Number.isFinite(sum)) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime detected invalid addition result"
    );
  }
  if (!Number.isSafeInteger(sum)) {
    __tnWarnOnce("[thru-net] Precision loss while polyfilling BigInt addition");
  }
  return (sum as unknown) as bigint;
}

function __tnCheckedSub(lhs: bigint, rhs: bigint): bigint {
  if (__tnHasNativeBigInt) {
    const result = (lhs as bigint) - (rhs as bigint);
    if (result < BigInt(0)) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected negative size via subtraction"
      );
    }
    return result;
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const diff = left - right;
  if (diff < 0 || !Number.isFinite(diff)) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime detected invalid subtraction result"
    );
  }
  if (!Number.isSafeInteger(diff)) {
    __tnWarnOnce("[thru-net] Precision loss while polyfilling BigInt subtraction");
  }
  return (diff as unknown) as bigint;
}

function __tnCheckedMul(lhs: bigint, rhs: bigint): bigint {
  if (__tnHasNativeBigInt) {
    const result = (lhs as bigint) * (rhs as bigint);
    if (result < BigInt(0) || result > __tnU64(-BigInt(1))) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected a multiplication outside u64"
      );
    }
    return result;
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const product = left * right;
  if (product < 0 || !Number.isFinite(product)) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime detected invalid multiplication result"
    );
  }
  if (!Number.isSafeInteger(product)) {
    __tnWarnOnce(
      "[thru-net] Precision loss while polyfilling BigInt multiplication"
    );
  }
  return (product as unknown) as bigint;
}

function __tnCheckedDiv(lhs: bigint, rhs: bigint): bigint {
  if (__tnBigIntEquals(rhs, __tnToBigInt(0))) {
    __tnRaiseIrError("tn.ir.overflow", "IR runtime division by zero");
  }
  if (__tnHasNativeBigInt) return (lhs as bigint) / (rhs as bigint);
  const quotient = Math.floor((lhs as unknown as number) / (rhs as unknown as number));
  return (quotient as unknown) as bigint;
}

function __tnCheckedMod(lhs: bigint, rhs: bigint): bigint {
  if (__tnBigIntEquals(rhs, __tnToBigInt(0))) {
    __tnRaiseIrError("tn.ir.overflow", "IR runtime modulo by zero");
  }
  if (__tnHasNativeBigInt) return (lhs as bigint) % (rhs as bigint);
  return (((lhs as unknown as number) % (rhs as unknown as number)) as unknown) as bigint;
}

function __tnBitwise(
  lhs: bigint,
  rhs: bigint,
  op: "and" | "or" | "xor"
): bigint {
  if (__tnHasNativeBigInt) {
    if (op === "and") return (lhs as bigint) & (rhs as bigint);
    if (op === "or") return (lhs as bigint) | (rhs as bigint);
    return (lhs as bigint) ^ (rhs as bigint);
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const maxU32 = 0xffffffff;
  if (
    !Number.isInteger(left) ||
    !Number.isInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > maxU32 ||
    right > maxU32
  ) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime bitwise operation requires BigInt for values outside u32 range"
    );
  }
  const result = op === "and" ? left & right : op === "or" ? left | right : left ^ right;
  return ((result >>> 0) as unknown) as bigint;
}

function __tnCheckedShift(
  lhs: bigint,
  rhs: bigint,
  direction: "left" | "right"
): bigint {
  /* As C and Rust: shifting 0, or shifting right by 64 or more, is 0;
     shifting a non-zero value left by 64 or more overflows. */
  if (__tnBigIntEquals(lhs, __tnToBigInt(0))) return lhs;
  if (direction === "right" && __tnBigIntGreaterThan(rhs, __tnToBigInt(63))) {
    return __tnToBigInt(0);
  }
  const amount = __tnBigIntToNumber(rhs, "IR shift amount");
  if (amount < 0 || amount >= 64 || !Number.isInteger(amount)) {
    __tnRaiseIrError("tn.ir.overflow", "IR runtime invalid shift amount");
  }
  if (__tnHasNativeBigInt) {
    const shift = BigInt(amount);
    const shifted = direction === "left" ? (lhs as bigint) << shift : (lhs as bigint) >> shift;
    if (shifted > __tnU64(-BigInt(1))) {
      __tnRaiseIrError("tn.ir.overflow", "IR runtime shift overflows u64");
    }
    return shifted;
  }
  const value = lhs as unknown as number;
  const result = direction === "left" ? value * 2 ** amount : Math.floor(value / 2 ** amount);
  if (!Number.isSafeInteger(result)) {
    __tnWarnOnce("[thru-net] Precision loss while polyfilling BigInt shift");
  }
  return (result as unknown) as bigint;
}

/* 2^64: no u64 value, so no enum tag and no buffer size. */
const __tnMeasureLimit = __tnHasNativeBigInt
  ? BigInt(1) << BigInt(64)
  : ((2 ** 64) as unknown as bigint);

/* Checked u64 arithmetic for size, enum tag and derived-parameter expressions over
   buffer values, as C and Rust evaluate them: operands are read as u64, and a
   result outside u64 (an overflowing add/mul/pow/shift, a negative sub, a
   shift of 64 or more of a non-zero value, a division by zero) is `null`,
   which propagates. No operation builds a value wider than 128 bits. */
function __tnU64(value: bigint): bigint {
  return BigInt.asUintN(64, value);
}

function __tnU64Op(op: string, lhs: bigint | null, rhs: bigint | null): bigint | null {
  if (lhs === null || rhs === null) return null;
  const a = __tnU64(lhs);
  const b = __tnU64(rhs);
  const zero = BigInt(0);
  const one = BigInt(1);
  const max = __tnU64(-one);
  let result: bigint;
  switch (op) {
    case "add": result = a + b; break;
    case "sub": result = a - b; break;
    case "mul": result = a * b; break;
    case "div": if (b === zero) return null; result = a / b; break;
    case "mod": if (b === zero) return null; result = a % b; break;
    case "and": result = a & b; break;
    case "or": result = a | b; break;
    case "xor": result = a ^ b; break;
    case "shl":
      if (a === zero) return zero;
      if (b > BigInt(63)) return null;
      result = a << b;
      break;
    case "shr": result = b > BigInt(63) ? zero : a >> b; break;
    case "pow": {
      if (b === zero) return one;
      if (a === zero || a === one) return a;
      if (b > BigInt(64)) return null;
      result = one;
      for (let i = zero; i < b; i++) {
        result *= a;
        if (result > max) return null;
      }
      break;
    }
    case "eq": return a === b ? one : zero;
    case "ne": return a !== b ? one : zero;
    case "lt": return a < b ? one : zero;
    case "gt": return a > b ? one : zero;
    case "le": return a <= b ? one : zero;
    case "ge": return a >= b ? one : zero;
    case "land": return a !== zero && b !== zero ? one : zero;
    case "lor": return a !== zero || b !== zero ? one : zero;
    case "lxor": return (a !== zero) !== (b !== zero) ? one : zero;
    default: return null;
  }
  return result < zero || result > max ? null : result;
}

function __tnU64Unary(op: string, operand: bigint | null): bigint | null {
  if (operand === null) return null;
  const a = __tnU64(operand);
  const zero = BigInt(0);
  switch (op) {
    case "bitnot": return __tnU64(~a);
    case "neg": return a === zero ? zero : null;
    case "not": return a === zero ? BigInt(1) : zero;
    case "popcount": return BigInt(__tnPopcount(a));
    default: return null;
  }
}

/* A checked count as a number (views read validated bytes: an overflow
   means they changed since). */
function __tnCountNumber(count: bigint | null): number {
  if (count === null) throw new Error("array count overflows u64");
  return __tnBigIntToNumber(count, "array count");
}

/* Whether two enum tags are the same u64 (numbers and bigints compared
   exactly; a null tag equals nothing). */
function __tnTagEquals(lhs: number | bigint | null, rhs: number | bigint): boolean {
  if (lhs === null) return false;
  return __tnToBigInt(lhs) === __tnToBigInt(rhs);
}

/* A checked tag as a number; an overflow (`null`) selects no variant. */
function __tnTagNumber(tag: bigint | null): number {
  return tag === null || tag > BigInt(Number.MAX_SAFE_INTEGER) ? -1 : Number(tag);
}

function __tnAlign(value: bigint, alignment: number): bigint {
  if (alignment <= 1) return value;
  const alignBig = __tnToBigInt(alignment);
  if (__tnHasNativeBigInt) {
    const remainder = value % alignBig;
    if (__tnBigIntEquals(remainder, __tnToBigInt(0))) {
      return value;
    }
    const delta = alignBig - remainder;
    return __tnCheckedAdd(value, delta);
  }
  const current = __tnBigIntToNumber(value, "IR align");
  const alignNum = alignment >>> 0;
  const remainder = current % alignNum;
  const next = remainder === 0 ? current : current + (alignNum - remainder);
  return __tnToBigInt(next);
}

function __tnSplitUint64(value: bigint): { high: number; low: number } {
  if (__tnHasNativeBigInt) {
    const low = Number(value & (__tnMask32 as bigint));
    const high = Number((value >> BigInt(32)) & (__tnMask32 as bigint));
    return { high, low };
  }
  const num = __tnBigIntToNumber(value, "DataView.setBigUint64");
  const low = num >>> 0;
  const high = Math.floor(num / 4294967296) >>> 0;
  return { high, low };
}

function __tnSplitInt64(value: bigint): { high: number; low: number } {
  if (__tnHasNativeBigInt) {
    const low = Number(value & (__tnMask32 as bigint));
    let high = Number((value >> BigInt(32)) & (__tnMask32 as bigint));
    if ((BigInt(high) & (__tnSignBit32 as bigint)) !== BigInt(0)) {
      high -= 0x100000000;
    }
    return { high, low };
  }
  const num = __tnBigIntToNumber(value, "DataView.setBigInt64");
  const low = num >>> 0;
  const high = Math.floor(num / 4294967296);
  return { high, low };
}

function __tnPolyfillReadUint64(
  view: DataView,
  offset: number,
  littleEndian: boolean
): bigint {
  const low = littleEndian
    ? view.getUint32(offset, true)
    : view.getUint32(offset + 4, false);
  const high = littleEndian
    ? view.getUint32(offset + 4, true)
    : view.getUint32(offset, false);
  if (__tnHasNativeBigInt) {
    return (BigInt(high) << BigInt(32)) | BigInt(low);
  }
  const value = high * 4294967296 + low;
  if (!Number.isSafeInteger(value)) {
    __tnWarnOnce(
      "[thru-net] Precision loss while polyfilling DataView.getBigUint64"
    );
  }
  return (value as unknown) as bigint;
}

function __tnPolyfillReadInt64(
  view: DataView,
  offset: number,
  littleEndian: boolean
): bigint {
  const low = littleEndian
    ? view.getUint32(offset, true)
    : view.getUint32(offset + 4, false);
  const high = littleEndian
    ? view.getInt32(offset + 4, true)
    : view.getInt32(offset, false);
  if (__tnHasNativeBigInt) {
    return (BigInt(high) << BigInt(32)) | BigInt(low);
  }
  const value = high * 4294967296 + low;
  if (!Number.isSafeInteger(value)) {
    __tnWarnOnce(
      "[thru-net] Precision loss while polyfilling DataView.getBigInt64"
    );
  }
  return (value as unknown) as bigint;
}

function __tnPolyfillWriteUint64(
  view: DataView,
  offset: number,
  value: bigint,
  littleEndian: boolean
): void {
  const parts = __tnSplitUint64(value);
  if (littleEndian) {
    view.setUint32(offset, parts.low, true);
    view.setUint32(offset + 4, parts.high, true);
  } else {
    view.setUint32(offset, parts.high, false);
    view.setUint32(offset + 4, parts.low, false);
  }
}

function __tnPolyfillWriteInt64(
  view: DataView,
  offset: number,
  value: bigint,
  littleEndian: boolean
): void {
  const parts = __tnSplitInt64(value);
  if (littleEndian) {
    view.setUint32(offset, parts.low >>> 0, true);
    view.setInt32(offset + 4, parts.high | 0, true);
  } else {
    view.setInt32(offset, parts.high | 0, false);
    view.setUint32(offset + 4, parts.low >>> 0, false);
  }
}

if (typeof DataView !== "undefined" && !__tnHasBigIntDataView) {
  const proto = DataView.prototype as unknown as Record<string, unknown>;
  if (typeof proto.getBigUint64 !== "function") {
    (proto as any).getBigUint64 = function (
      offset: number,
      littleEndian?: boolean
    ): bigint {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.getBigUint64; precision may be lost"
      );
      return __tnPolyfillReadUint64(this, offset, !!littleEndian);
    };
  }
  if (typeof proto.getBigInt64 !== "function") {
    (proto as any).getBigInt64 = function (
      offset: number,
      littleEndian?: boolean
    ): bigint {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.getBigInt64; precision may be lost"
      );
      return __tnPolyfillReadInt64(this, offset, !!littleEndian);
    };
  }
  if (typeof proto.setBigUint64 !== "function") {
    (proto as any).setBigUint64 = function (
      offset: number,
      value: bigint,
      littleEndian?: boolean
    ): void {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.setBigUint64; precision may be lost"
      );
      __tnPolyfillWriteUint64(this, offset, value, !!littleEndian);
    };
  }
  if (typeof proto.setBigInt64 !== "function") {
    (proto as any).setBigInt64 = function (
      offset: number,
      value: bigint,
      littleEndian?: boolean
    ): void {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.setBigInt64; precision may be lost"
      );
      __tnPolyfillWriteInt64(this, offset, value, !!littleEndian);
    };
  }
  if (!__tnHasNativeBigInt) {
    __tnWarnOnce(
      "[thru-net] BigInt is unavailable; falling back to lossy 64-bit polyfill"
    );
  }
}

const __tnFootprintRegistry: Record<
  string,
  (params: Record<string, bigint>) => bigint
> = {};
const __tnValidateRegistry: Record<
  string,
  (buffer: Uint8Array, params: Record<string, bigint>) => __TnValidateResult
> = {};
const __tnDynamicValidateRegistry: Record<
  string,
  (buffer: Uint8Array) => __TnValidateResult
> = {};

function __tnRegisterFootprint(
  typeName: string,
  fn: (params: Record<string, bigint>) => bigint
): void {
  __tnFootprintRegistry[typeName] = fn;
}

function __tnRegisterValidate(
  typeName: string,
  fn: (buffer: Uint8Array, params: Record<string, bigint>) => __TnValidateResult
): void {
  __tnValidateRegistry[typeName] = fn;
}

function __tnRegisterDynamicValidate(
  typeName: string,
  fn: (buffer: Uint8Array) => __TnValidateResult
): void {
  __tnDynamicValidateRegistry[typeName] = fn;
}

function __tnInvokeFootprint(
  typeName: string,
  params: Record<string, bigint>
): bigint {
  const fn = __tnFootprintRegistry[typeName];
  if (!fn) throw new Error(`IR runtime missing footprint for ${typeName}`);
  return fn(params);
}

function __tnInvokeValidate(
  typeName: string,
  buffer: Uint8Array,
  params: Record<string, bigint>
): __TnValidateResult {
  const fn = __tnValidateRegistry[typeName];
  if (!fn) throw new Error(`IR runtime missing validate helper for ${typeName}`);
  return fn(buffer, params);
}

function __tnInvokeDynamicValidate(
  typeName: string,
  buffer: Uint8Array
): __TnValidateResult {
  const fn = __tnDynamicValidateRegistry[typeName];
  if (!fn) throw new Error(`IR runtime missing dynamic validate helper for ${typeName}`);
  return fn(buffer);
}

function __tnEvalFootprint(node: __TnIrNode, ctx: __TnIrContext): bigint {
  return __tnEvalIrNode(node, ctx, __tnToBigInt(0));
}

function __tnTryEvalFootprint(
  node: __TnIrNode,
  ctx: __TnIrContext
): __TnEvalResult {
  return __tnTryEvalIr(node, ctx);
}

function __tnTryEvalIr(
  node: __TnIrNode,
  ctx: __TnIrContext
): __TnEvalResult {
  try {
    return { ok: true, value: __tnEvalIrNode(node, ctx, __tnToBigInt(0)) };
  } catch (err) {
    return { ok: false, code: __tnNormalizeIrError(err) };
  }
}

function __tnIsEvalError(result: __TnEvalResult): result is { ok: false; code: string } {
  return result.ok === false;
}

function __tnValidateIrTree(
  ir: { readonly typeName: string; readonly root: __TnIrNode },
  buffer: Uint8Array,
  params: Record<string, bigint>
): __TnValidateResult {
  const evalResult = __tnTryEvalIr(ir.root, {
    params,
    buffer,
    typeName: ir.typeName,
  });
  if (__tnIsEvalError(evalResult)) {
    return { ok: false, code: evalResult.code };
  }
  const required = evalResult.value;
  const available = __tnToBigInt(buffer.length);
  if (__tnBigIntGreaterThan(required, available)) {
    return { ok: false, code: "tn.buffer_too_small", consumed: required };
  }
  return { ok: true, consumed: required };
}

/* A parameter as the u64 C and Rust evaluate: a value read from a signed
   field is its two's complement (i8 -1 is 2^64-1); a derived value past
   u64 (an overflowed computed count or tag) is an overflow. */
function __tnIrU64(value: bigint, name: string): bigint {
  if (!__tnHasNativeBigInt) return value;
  if (value > __tnU64(-BigInt(1))) {
    __tnRaiseIrError("tn.ir.overflow", `IR parameter '${name}' overflows u64`);
  }
  return __tnU64(value);
}

function __tnEvalIrNode(
  node: __TnIrNode,
  ctx: __TnIrContext,
  baseOffset: bigint
): bigint {
  switch (node.op) {
    case "zero":
      return __tnToBigInt(0);
    case "const":
      return node.value;
    case "field": {
      if (node.param === "__buffer_size" && ctx.buffer) {
        return __tnToBigInt(ctx.buffer.length);
      }
      const val = ctx.params[node.param];
      if (val === undefined) {
        const prefix = ctx.typeName ? `${ctx.typeName}: ` : "";
        __tnRaiseIrError(
          "tn.ir.missing_param",
          `${prefix}Missing IR parameter '${node.param}'`
        );
      }
      return __tnIrU64(val, node.param);
    }
    case "add":
      {
        const left = __tnEvalIrNode(node.left, ctx, baseOffset);
        const right = __tnEvalIrNode(
          node.right,
          ctx,
          __tnCheckedAdd(baseOffset, left)
        );
        return __tnCheckedAdd(left, right);
      }
    case "sub":
      return __tnCheckedSub(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
    case "mul": {
      /* `count * element`: no elements select no variant (an unknown tag
         with a zero count is valid), so a zero left side ends here. */
      const left = __tnEvalIrNode(node.left, ctx, baseOffset);
      if (__tnBigIntEquals(left, __tnToBigInt(0))) return left;
      return __tnCheckedMul(left, __tnEvalIrNode(node.right, ctx, baseOffset));
    }
    case "div":
      return __tnCheckedDiv(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
    case "mod":
      return __tnCheckedMod(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
    case "bitAnd":
      return __tnBitwise(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "and"
      );
    case "bitOr":
      return __tnBitwise(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "or"
      );
    case "bitXor":
      return __tnBitwise(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "xor"
      );
    case "leftShift":
      return __tnCheckedShift(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "left"
      );
    case "rightShift":
      return __tnCheckedShift(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "right"
      );
    case "align":
      return __tnAlign(__tnEvalIrNode(node.node, ctx, baseOffset), node.alignment);
    case "switch": {
      const rawTag = ctx.params[node.tag];
      const tagVal = rawTag === undefined ? rawTag : __tnIrU64(rawTag, node.tag);
      if (tagVal === undefined) {
        const prefix = ctx.typeName ? `${ctx.typeName}: ` : "";
        __tnRaiseIrError(
          "tn.ir.missing_param",
          `${prefix}Missing IR switch tag '${node.tag}'`
        );
      }
      /* Case values past 2^53 - 1 are bigints: compare exact u64s. */
      for (const caseNode of node.cases) {
        if (__tnTagEquals(tagVal, caseNode.value)) {
          return __tnEvalIrNode(caseNode.node, ctx, baseOffset);
        }
      }
      if (node.default) return __tnEvalIrNode(node.default, ctx, baseOffset);
      __tnRaiseIrError(
        "tn.ir.invalid_tag",
        `Unhandled IR switch value ${tagVal} for '${node.tag}'`
      );
    }
    case "call": {
      const nestedParams: Record<string, bigint> = Object.create(null);
      for (const arg of node.args) {
        const val = ctx.params[arg.source];
        if (val === undefined) {
          const prefix = ctx.typeName ? `${ctx.typeName}: ` : "";
          __tnRaiseIrError(
            "tn.ir.missing_param",
            `${prefix}Missing IR parameter '${arg.source}' for nested call`
          );
        }
        nestedParams[arg.name] = val;
      }
      if (ctx.buffer) {
        const nestedOffset = __tnBigIntToNumber(baseOffset, "IR nested offset");
        const nestedResult = __tnInvokeValidate(
          node.typeName,
          ctx.buffer.subarray(nestedOffset),
          nestedParams
        );
        if (!nestedResult.ok) {
          const nestedCode =
            nestedResult.code ?? `tn.ir.runtime_error: ${node.typeName}`;
          const prefixed = nestedCode.startsWith("tn.")
            ? nestedCode
            : `tn.ir.runtime_error: ${node.typeName} -> ${nestedCode}`;
          __tnRaiseIrError(
            prefixed,
            `Nested validator ${node.typeName} failed`
          );
        }
        if (nestedResult.consumed !== undefined) {
          return nestedResult.consumed;
        }
      }
      return __tnInvokeFootprint(node.typeName, nestedParams);
    }
    case "sumOverArray": {
      if (!ctx.buffer && node.payloadParam !== undefined) {
        /* Sizing from params: the array's byte total is a parameter. */
        const total = ctx.params[node.payloadParam];
        if (total !== undefined) return total;
      }
      if (!ctx.buffer) {
        __tnRaiseIrError(
          "tn.ir.missing_buffer",
          `Jagged array '${node.fieldName}' requires buffer-backed validation`
        );
      }
      const count = __tnBigIntToNumber(
        __tnEvalIrNode(node.count, ctx, baseOffset),
        `Jagged array '${node.fieldName}' count`
      );
      let cursor = __tnBigIntToNumber(baseOffset, "IR jagged array offset");
      let total = __tnToBigInt(0);
      for (let i = 0; i < count; i++) {
        const result = __tnInvokeDynamicValidate(
          node.elementTypeName,
          ctx.buffer.subarray(cursor)
        );
        if (!result.ok || result.consumed === undefined) {
          const code = result.code ?? "tn.ir.runtime_error";
          __tnRaiseIrError(
            code,
            `Jagged array '${node.fieldName}' element ${i} failed validation`
          );
        }
        cursor += __tnBigIntToNumber(result.consumed, "IR jagged element size");
        total = __tnCheckedAdd(total, result.consumed);
      }
      return total;
    }
    default:
      __tnRaiseIrError(
        "tn.ir.runtime_error",
        `Unsupported IR node ${(node as { op: string }).op}`
      );
  }
}

function __tnNormalizeIrError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const maybeCode = (err as { code?: string }).code;
    if (typeof maybeCode === "string" && maybeCode.length > 0) {
      return maybeCode;
    }
  }
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : typeof err === "string"
      ? err
      : "";
  if (message.includes("Missing IR parameter")) return "tn.ir.missing_param";
  if (message.includes("Unhandled IR switch value")) return "tn.ir.invalid_tag";
  if (
    message.includes("invalid") ||
    message.includes("overflow") ||
    message.includes("negative size")
  ) {
    return "tn.ir.overflow";
  }
  if (message.length > 0) return `tn.ir.runtime_error: ${message}`;
  return "tn.ir.runtime_error";
}

__tnRegisterFootprint("InstructionData", (params) => InstructionData.__tnInvokeFootprint(params));
__tnRegisterValidate("InstructionData", (buffer, params) => InstructionData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InstructionData", (buffer) => { const result = InstructionData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MulticallArgs ----- */

const __tn_ir_MulticallArgs = {
  typeName: "MulticallArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "sumOverArray", count: { op: "field", param: "calls.calls_count" }, elementTypeName: "InstructionData", fieldName: "calls", payloadParam: "calls.payload_size" } } } }
} as const;

export class MulticallArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: MulticallArgs.Params;

  private constructor(private buffer: Uint8Array, params?: MulticallArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = MulticallArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("MulticallArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: MulticallArgs.Params, fieldContext?: Record<string, number | bigint> }): MulticallArgs {
    if (!buffer || buffer.length === undefined) throw new Error("MulticallArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = MulticallArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("MulticallArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new MulticallArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): MulticallArgs.Params {
    return this.__tnParams;
  }

  withFieldContext(context: Record<string, number | bigint>): this {
    this.__tnFieldContext = context;
    return this;
  }

  private __tnResolveFieldRefRaw(path: string): number | bigint {
    const getterName = `get_${path.replace(/[.]/g, '_')}`;
    const getter = (this as any)[getterName];
    if (typeof getter === "function") {
      const value = getter.call(this);
      return value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return contextValue;
    }
    throw new Error("MulticallArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "MulticallArgs::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("MulticallArgs: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): MulticallArgsBuilder {
    return new MulticallArgsBuilder();
  }

  static fromBuilder(builder: MulticallArgsBuilder): MulticallArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return MulticallArgs.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_calls_payload_size: bigint | null = null;
    let __tnFieldValue_calls_count: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_calls_count = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_calls_count = __tnRead_calls_count;
    __tnCursorMutable += 2;
    if (__tnFieldValue_calls_count === null) return null;
    const __tnArrayCount_calls = __tnU64(__tnToBigInt(__tnFieldValue_calls_count as number | bigint));
    if (__tnArrayCount_calls === null) return null;
    let __tnArrayBytes_calls = 0;
    {
      const measure = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 2 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 8 > b.length) return null; const x3 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const n4 = x3; if (n4 === null || n4 < 0n) return null;
if (BigInt(c) + n4 * 1n > BigInt(b.length)) return null; c += Number(n4 * 1n);
void s1;
return c; });
      for (let i = BigInt(0); i < __tnArrayCount_calls; i++) {
        const size = measure(buffer.subarray(__tnCursorMutable + __tnArrayBytes_calls));
        if (size === null) return null;
        if (size === 0) break; /* zero-byte elements: one stands for all */
        __tnArrayBytes_calls += size;
      }
    }
    __tnParamSeq_calls_payload_size = __tnToBigInt(__tnArrayBytes_calls);
    if (__tnCursorMutable + __tnArrayBytes_calls > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_calls;
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_calls_payload_size === null) return null;
    params["calls_payload_size"] = __tnParamSeq_calls_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: MulticallArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 2) {
      return null;
    }
    const __tnParam_calls_calls_count = __tnToBigInt(view.getUint16(0, true));
    const __tnLayout = MulticallArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_calls_payload_size = __tnSeqParams["calls_payload_size"];
    if (__tnParamSeq_calls_payload_size === undefined) return null;
    const __tnExtractedParams = MulticallArgs.Params.fromValues({
      calls_calls_count: __tnParam_calls_calls_count,
      calls_payload_size: __tnParamSeq_calls_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_calls_count(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_calls_count(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get calls_count(): number {
    return this.get_calls_count();
  }

  set calls_count(value: number) {
    this.set_calls_count(value);
  }

  /** Returns the number of elements in the jagged array. */
  get_calls_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("calls_count"));
  }

  /** Returns the element at the given index, or null if out of bounds.
   * Note: This is O(n) as jagged arrays require sequential traversal. */
  get_calls_at(index: number): InstructionData | null {
    const count = this.get_calls_length();
    if (index < 0 || index >= count) {
      return null;
    }
    const offset = 2;
    let cursor = offset;
    for (let i = 0; i < index; i++) {
      const elem = InstructionData.from_array(this.buffer.subarray(cursor));
      if (!elem) {
        throw new Error("MulticallArgs: invalid element at index " + i + " in jagged array 'calls'");
      }
      const validation = InstructionData.validate(this.buffer.subarray(cursor));
      if (!validation.ok || validation.consumed === undefined) {
        throw new Error("MulticallArgs: failed to get footprint for element at index " + i);
      }
      cursor += validation.consumed;
    }
    return InstructionData.from_array(this.buffer.subarray(cursor));
  }

  /** Returns a generator over the jagged array elements.
   * This is more efficient than repeated calls to `get_calls_at()` for sequential access. */
  *callsIter(): Generator<InstructionData, void, unknown> {
    const count = this.get_calls_length();
    const offset = 2;
    let cursor = offset;
    for (let i = 0; i < count; i++) {
      const elem = InstructionData.from_array(this.buffer.subarray(cursor));
      if (!elem) {
        throw new Error("MulticallArgs: invalid element at index " + i + " in jagged array 'calls'");
      }
      yield elem;
      const validation = InstructionData.validate(this.buffer.subarray(cursor));
      if (!validation.ok || validation.consumed === undefined) {
        throw new Error("MulticallArgs: failed to get footprint for element at index " + i);
      }
      cursor += validation.consumed;
    }
  }

  get_calls(): InstructionData[] {
    return Array.from(this.callsIter());
  }

  set_calls(_value: InstructionData[]): void {
    throw new Error("MulticallArgs: jagged array 'calls' cannot be set in-place");
  }

  /** Returns the total byte size of all elements in the jagged array. */
  get_calls_size(): number {
    const count = this.get_calls_length();
    const offset = 2;
    let cursor = offset;
    for (let i = 0; i < count; i++) {
      const elem = InstructionData.from_array(this.buffer.subarray(cursor));
      if (!elem) {
        throw new Error("MulticallArgs: invalid element at index " + i + " in jagged array 'calls'");
      }
      const validation = InstructionData.validate(this.buffer.subarray(cursor));
      if (!validation.ok || validation.consumed === undefined) {
        throw new Error("MulticallArgs: failed to get footprint for element at index " + i);
      }
      cursor += validation.consumed;
    }
    return cursor - offset;
  }

  get calls(): InstructionData[] {
    return this.get_calls();
  }

  set calls(value: InstructionData[]) {
    this.set_calls(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MulticallArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MulticallArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(calls_calls_count: number | bigint, calls_payload_size: number | bigint): bigint {
    const params = MulticallArgs.Params.fromValues({
      calls_calls_count: calls_calls_count,
      calls_payload_size: calls_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: MulticallArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["calls.calls_count"] = params.calls_calls_count;
    record["calls.payload_size"] = params.calls_payload_size;
    return record;
  }

  static footprintIrFromParams(params: MulticallArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: MulticallArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MulticallArgs');
    return __tnBigIntToNumber(irResult, 'MulticallArgs::footprintFromParams');
  }

  static footprintFromValues(input: { calls_calls_count: number | bigint, calls_payload_size: number | bigint }): number {
    const params = MulticallArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: MulticallArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: MulticallArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: MulticallArgs.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    } else {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      const supplied = params as unknown as Record<string, bigint>;
      for (const [key, value] of Object.entries(extracted.params as unknown as Record<string, bigint>)) {
        if (supplied[key] === undefined || __tnToBigInt(supplied[key]) !== __tnToBigInt(value)) return { ok: false, code: "tn.param_mismatch" };
      }
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MulticallArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MulticallArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: MulticallArgs.Params }): MulticallArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const derived = this.__tnExtractParams(view, buffer);
      if (!derived) return null;
      params = derived.params;
    }
    const validation = this.validate(buffer, { params });
    if (!validation.ok) {
      return null;
    }
    const cached = validation.params ?? params;
    const state = new MulticallArgs(buffer, cached);
    return state;
  }


}

export namespace MulticallArgs {
  export type Params = {
    /** ABI path: calls.calls_count */
    readonly calls_calls_count: bigint;
    /** Byte size of jagged array 'calls' (ABI path: calls.payload_size) */
    readonly calls_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    calls_calls_count: "calls.calls_count",
    calls_payload_size: "calls.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { calls_calls_count: number | bigint, calls_payload_size: number | bigint }): Params {
      return {
        calls_calls_count: __tnToBigInt(input.calls_calls_count),
        calls_payload_size: __tnToBigInt(input.calls_payload_size),
      };
    },
    fromBuilder(source: { dynamicParams(): Params } | { params: Params } | Params): Params {
      if ((source as { dynamicParams?: () => Params }).dynamicParams) {
        return (source as { dynamicParams(): Params }).dynamicParams();
      }
      if ((source as { params?: Params }).params) {
        return (source as { params: Params }).params;
      }
      return source as Params;
    }
  };

  export function params(input: { calls_calls_count: number | bigint, calls_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class MulticallArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnJagged_calls: Uint8Array[] | null = null;
  private __tnCachedParams: MulticallArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: MulticallArgs.Params | null = null;

  constructor() {
    this.buffer = new Uint8Array(2);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_calls_count(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_calls(values: readonly (InstructionData | __TnStructFieldInput)[]): this {
    const fragments: Uint8Array[] = [];
    for (let i = 0; i < values.length; i++) {
      const bytes = __tnResolveStructFieldInput(values[i] as __TnStructFieldInput, "MulticallArgsBuilder::calls[" + i + "]");
      const validation = __tnInvokeDynamicValidate("InstructionData", bytes);
      if (!validation.ok || validation.consumed === undefined) throw new Error("MulticallArgsBuilder: field 'calls' element failed validation");
      if (__tnBigIntToNumber(validation.consumed, "MulticallArgsBuilder::calls") !== bytes.length) throw new Error("MulticallArgsBuilder: field 'calls' element validation did not consume the full buffer");
      fragments.push(bytes);
    }
    this.__tnJagged_calls = fragments;
    this.set_calls_count(fragments.length);
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const fragments = this.__tnCollectFragments();
    const size = this.__tnComputeSize(fragments);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer, fragments);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const fragments = this.__tnCollectFragments();
    const size = this.__tnComputeSize(fragments);
    if (target.length - offset < size) throw new Error("MulticallArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice, fragments);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): MulticallArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = MulticallArgs.from_array(buffer, { params });
    if (!view) throw new Error("MulticallArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): MulticallArgs {
    return this.finish();
  }

  dynamicParams(): MulticallArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): MulticallArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = MulticallArgs.Params.fromValues({
      calls_calls_count: (() => { const fragments = this.__tnJagged_calls; if (!fragments) throw new Error("MulticallArgsBuilder: field 'calls' must be written before computing params"); return __tnToBigInt(fragments.length); })(),
      calls_payload_size: (() => { const fragments = this.__tnJagged_calls; if (!fragments) throw new Error("MulticallArgsBuilder: field 'calls' must be written before computing params"); return __tnToBigInt(fragments.reduce((total, fragment) => total + fragment.length, 0)); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnCollectFragments(): Uint8Array[] {
    const fragments = this.__tnJagged_calls;
    if (!fragments) throw new Error("MulticallArgsBuilder: field 'calls' must be written before build");
    return fragments;
  }

  private __tnComputeSize(fragments: readonly Uint8Array[]): number {
    let total = this.buffer.length;
    for (const fragment of fragments) total += fragment.length;
    return total;
  }

  private __tnWriteInto(target: Uint8Array, fragments: readonly Uint8Array[]): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    for (const fragment of fragments) {
      target.set(fragment, cursor);
      cursor += fragment.length;
    }
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: MulticallArgs.Params): void {
    const result = MulticallArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ MulticallArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("MulticallArgs", (params) => MulticallArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("MulticallArgs", (buffer, params) => MulticallArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MulticallArgs", (buffer) => { const result = MulticallArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MulticallError ----- */

const __tn_ir_MulticallError = {
  typeName: "MulticallError",
  root: { op: "const", value: 8n }
} as const;

export class MulticallError_error_invalid_instruction_data_size_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MulticallError_error_invalid_instruction_data_size_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MulticallError_error_invalid_instruction_data_size_Inner.__tnCreateView requires a Uint8Array");
    return new MulticallError_error_invalid_instruction_data_size_Inner(new Uint8Array(buffer));
  }

}

export class MulticallError_error_invoke_failed_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MulticallError_error_invoke_failed_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MulticallError_error_invoke_failed_Inner.__tnCreateView requires a Uint8Array");
    return new MulticallError_error_invoke_failed_Inner(new Uint8Array(buffer));
  }

}

export class MulticallError_error_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): MulticallError_error_Inner {
    return new MulticallError_error_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MulticallError_error_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["code"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "invalid_instruction_data_size", tag: 1, payloadSize: 0 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "invoke_failed", tag: 2, payloadSize: 0 };
    }
    return new MulticallError_error_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInvalidInstructionDataSize(): MulticallError_error_invalid_instruction_data_size_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return MulticallError_error_invalid_instruction_data_size_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvokeFailed(): MulticallError_error_invoke_failed_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return MulticallError_error_invoke_failed_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class MulticallError {
  private view: DataView;
  private static readonly __tnFieldOffset_error = 8;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MulticallError {
    if (!buffer || buffer.length === undefined) throw new Error("MulticallError.__tnCreateView requires a Uint8Array");
    return new MulticallError(new Uint8Array(buffer));
  }

  static builder(): MulticallErrorBuilder {
    return new MulticallErrorBuilder();
  }

  static fromBuilder(builder: MulticallErrorBuilder): MulticallError | null {
    const buffer = builder.build();
    return MulticallError.from_array(buffer);
  }

  static readonly errorVariantDescriptors = Object.freeze([
    {
      name: "invalid_instruction_data_size",
      tag: 1,
      payloadSize: 0,
      payloadType: "MulticallError::error::invalid_instruction_data_size",
      createPayloadBuilder: () => null,
    },
    {
      name: "invoke_failed",
      tag: 2,
      payloadSize: 0,
      payloadType: "MulticallError::error::invoke_failed",
      createPayloadBuilder: () => null,
    },
  ] as const);

  get_code(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_code(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get code(): bigint {
    return this.get_code();
  }

  set code(value: bigint) {
    this.set_code(value);
  }

  errorVariant(): typeof MulticallError.errorVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_code();
    return MulticallError.errorVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  error(): MulticallError_error_Inner {
    const descriptor = this.errorVariant();
    if (!descriptor) throw new Error("MulticallError: unknown error variant");
    const offset = MulticallError.__tnFieldOffset_error;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("MulticallError: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return MulticallError_error_Inner.__tnCreate(slice, descriptor, undefined);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MulticallError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MulticallError, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MulticallError');
    }
    return __tnBigIntToNumber(irResult, 'MulticallError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed: 8 };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 8 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
let t3: number | null = null;
switch ((x2) as bigint | null) {
  case 1n: t3 = 0; break;
  case 2n: t3 = 0; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array): MulticallError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MulticallError(buffer);
  }

}

export class MulticallErrorBuilder {
  private tag: bigint | null = null;
  private payload: Uint8Array | null = null;

  constructor() {}

  select_invalid_instruction_data_size(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_instruction_data_size expects 0 bytes");
    this.tag = 1n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invoke_failed(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invoke_failed expects 0 bytes");
    this.tag = 2n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  build(): Uint8Array {
    if (this.tag === null || !this.payload) throw new Error("MulticallError builder missing variant");
    const buffer = new Uint8Array(8 + this.payload.length);
    new DataView(buffer.buffer).setBigUint64(0, this.tag, true);
    buffer.set(this.payload, 8);
    __tnBuilderValidateOrThrow("MulticallError", MulticallError.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const bytes = this.build();
    if (target.length - offset < bytes.length) throw new Error("target buffer too small");
    target.set(bytes, offset);
    return target;
  }

  finish(): MulticallError {
    const view = MulticallError.from_array(this.build());
    if (!view) throw new Error("failed to build MulticallError");
    return view;
  }
}

__tnRegisterFootprint("MulticallError", (params) => MulticallError.__tnInvokeFootprint(params));
__tnRegisterValidate("MulticallError", (buffer, params) => MulticallError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MulticallError", (buffer) => { const result = MulticallError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
