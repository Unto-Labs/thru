/* Auto-generated TypeScript code */
/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */

import { Pubkey } from "../../common/primitives/types";

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

__tnRegisterFootprint("Pubkey", (params) => Pubkey.__tnInvokeFootprint(params));
__tnRegisterValidate("Pubkey", (buffer, params) => Pubkey.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("Pubkey", (buffer) => { const result = Pubkey.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CoreManagerError ----- */

const __tn_ir_CoreManagerError = {
  typeName: "CoreManagerError",
  root: { op: "const", value: 8n }
} as const;

export class CoreManagerError_error_instruction_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_instruction_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_instruction_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_instruction_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_binding_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_binding_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_binding_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_binding_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_config_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_config_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_config_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_config_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_admin_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_admin_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_admin_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_admin_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_authorization_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_authorization_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_authorization_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_authorization_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_account_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_account_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_account_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_account_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_state_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_state_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_state_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_state_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_protected_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_protected_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_protected_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_protected_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_image_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_image_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_image_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_image_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_proof_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_proof_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_proof_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_proof_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_namespace_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_namespace_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError_error_namespace_Inner.__tnCreateView requires a Uint8Array");
    return new CoreManagerError_error_namespace_Inner(new Uint8Array(buffer));
  }

}

export class CoreManagerError_error_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): CoreManagerError_error_Inner {
    return new CoreManagerError_error_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError_error_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["code"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 4097)) descriptor = { name: "instruction", tag: 4097, payloadSize: 0 };
      if (__tnTagEquals(tag, 4098)) descriptor = { name: "binding", tag: 4098, payloadSize: 0 };
      if (__tnTagEquals(tag, 4099)) descriptor = { name: "config", tag: 4099, payloadSize: 0 };
      if (__tnTagEquals(tag, 4100)) descriptor = { name: "admin", tag: 4100, payloadSize: 0 };
      if (__tnTagEquals(tag, 4101)) descriptor = { name: "authorization", tag: 4101, payloadSize: 0 };
      if (__tnTagEquals(tag, 4102)) descriptor = { name: "account", tag: 4102, payloadSize: 0 };
      if (__tnTagEquals(tag, 4103)) descriptor = { name: "state", tag: 4103, payloadSize: 0 };
      if (__tnTagEquals(tag, 4104)) descriptor = { name: "protected", tag: 4104, payloadSize: 0 };
      if (__tnTagEquals(tag, 4105)) descriptor = { name: "image", tag: 4105, payloadSize: 0 };
      if (__tnTagEquals(tag, 4106)) descriptor = { name: "proof", tag: 4106, payloadSize: 0 };
      if (__tnTagEquals(tag, 4107)) descriptor = { name: "namespace", tag: 4107, payloadSize: 0 };
    }
    return new CoreManagerError_error_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInstruction(): CoreManagerError_error_instruction_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4097)) return null;
    return CoreManagerError_error_instruction_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBinding(): CoreManagerError_error_binding_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4098)) return null;
    return CoreManagerError_error_binding_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asConfig(): CoreManagerError_error_config_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4099)) return null;
    return CoreManagerError_error_config_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAdmin(): CoreManagerError_error_admin_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4100)) return null;
    return CoreManagerError_error_admin_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAuthorization(): CoreManagerError_error_authorization_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4101)) return null;
    return CoreManagerError_error_authorization_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccount(): CoreManagerError_error_account_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4102)) return null;
    return CoreManagerError_error_account_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asState(): CoreManagerError_error_state_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4103)) return null;
    return CoreManagerError_error_state_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asProtected(): CoreManagerError_error_protected_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4104)) return null;
    return CoreManagerError_error_protected_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asImage(): CoreManagerError_error_image_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4105)) return null;
    return CoreManagerError_error_image_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asProof(): CoreManagerError_error_proof_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4106)) return null;
    return CoreManagerError_error_proof_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asNamespace(): CoreManagerError_error_namespace_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4107)) return null;
    return CoreManagerError_error_namespace_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class CoreManagerError {
  private view: DataView;
  private static readonly __tnFieldOffset_error = 8;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerError {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerError.__tnCreateView requires a Uint8Array");
    return new CoreManagerError(new Uint8Array(buffer));
  }

  static builder(): CoreManagerErrorBuilder {
    return new CoreManagerErrorBuilder();
  }

  static fromBuilder(builder: CoreManagerErrorBuilder): CoreManagerError | null {
    const buffer = builder.build();
    return CoreManagerError.from_array(buffer);
  }

  static readonly errorVariantDescriptors = Object.freeze([
    {
      name: "instruction",
      tag: 4097,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::instruction",
      createPayloadBuilder: () => null,
    },
    {
      name: "binding",
      tag: 4098,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::binding",
      createPayloadBuilder: () => null,
    },
    {
      name: "config",
      tag: 4099,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::config",
      createPayloadBuilder: () => null,
    },
    {
      name: "admin",
      tag: 4100,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::admin",
      createPayloadBuilder: () => null,
    },
    {
      name: "authorization",
      tag: 4101,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::authorization",
      createPayloadBuilder: () => null,
    },
    {
      name: "account",
      tag: 4102,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::account",
      createPayloadBuilder: () => null,
    },
    {
      name: "state",
      tag: 4103,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::state",
      createPayloadBuilder: () => null,
    },
    {
      name: "protected",
      tag: 4104,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::protected",
      createPayloadBuilder: () => null,
    },
    {
      name: "image",
      tag: 4105,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::image",
      createPayloadBuilder: () => null,
    },
    {
      name: "proof",
      tag: 4106,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::proof",
      createPayloadBuilder: () => null,
    },
    {
      name: "namespace",
      tag: 4107,
      payloadSize: 0,
      payloadType: "CoreManagerError::error::namespace",
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

  errorVariant(): typeof CoreManagerError.errorVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_code();
    return CoreManagerError.errorVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  error(): CoreManagerError_error_Inner {
    const descriptor = this.errorVariant();
    if (!descriptor) throw new Error("CoreManagerError: unknown error variant");
    const offset = CoreManagerError.__tnFieldOffset_error;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("CoreManagerError: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return CoreManagerError_error_Inner.__tnCreate(slice, descriptor, undefined);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CoreManagerError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CoreManagerError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CoreManagerError');
    }
    return __tnBigIntToNumber(irResult, 'CoreManagerError::footprint');
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
  case 4097n: t3 = 0; break;
  case 4098n: t3 = 0; break;
  case 4099n: t3 = 0; break;
  case 4100n: t3 = 0; break;
  case 4101n: t3 = 0; break;
  case 4102n: t3 = 0; break;
  case 4103n: t3 = 0; break;
  case 4104n: t3 = 0; break;
  case 4105n: t3 = 0; break;
  case 4106n: t3 = 0; break;
  case 4107n: t3 = 0; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array): CoreManagerError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CoreManagerError(buffer);
  }

}

export class CoreManagerErrorBuilder {
  private tag: bigint | null = null;
  private payload: Uint8Array | null = null;

  constructor() {}

  select_instruction(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_instruction expects 0 bytes");
    this.tag = 4097n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_binding(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_binding expects 0 bytes");
    this.tag = 4098n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_config(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_config expects 0 bytes");
    this.tag = 4099n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_admin(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_admin expects 0 bytes");
    this.tag = 4100n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_authorization(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_authorization expects 0 bytes");
    this.tag = 4101n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account expects 0 bytes");
    this.tag = 4102n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_state(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_state expects 0 bytes");
    this.tag = 4103n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_protected(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_protected expects 0 bytes");
    this.tag = 4104n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_image(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_image expects 0 bytes");
    this.tag = 4105n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_proof(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_proof expects 0 bytes");
    this.tag = 4106n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_namespace(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_namespace expects 0 bytes");
    this.tag = 4107n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  build(): Uint8Array {
    if (this.tag === null || !this.payload) throw new Error("CoreManagerError builder missing variant");
    const buffer = new Uint8Array(8 + this.payload.length);
    new DataView(buffer.buffer).setBigUint64(0, this.tag, true);
    buffer.set(this.payload, 8);
    __tnBuilderValidateOrThrow("CoreManagerError", CoreManagerError.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const bytes = this.build();
    if (target.length - offset < bytes.length) throw new Error("target buffer too small");
    target.set(bytes, offset);
    return target;
  }

  finish(): CoreManagerError {
    const view = CoreManagerError.from_array(this.build());
    if (!view) throw new Error("failed to build CoreManagerError");
    return view;
  }
}

__tnRegisterFootprint("CoreManagerError", (params) => CoreManagerError.__tnInvokeFootprint(params));
__tnRegisterValidate("CoreManagerError", (buffer, params) => CoreManagerError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CoreManagerError", (buffer) => { const result = CoreManagerError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ProofSlot ----- */

const __tn_ir_ProofSlot = {
  typeName: "ProofSlot",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 3n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "metadata_proof.metadata_proof_size" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "program_proof.program_proof_size" }, right: { op: "const", value: 1n } } } } }
} as const;

export class ProofSlot {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: ProofSlot.Params;

  private constructor(private buffer: Uint8Array, params?: ProofSlot.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = ProofSlot.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("ProofSlot: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: ProofSlot.Params, fieldContext?: Record<string, number | bigint> }): ProofSlot {
    if (!buffer || buffer.length === undefined) throw new Error("ProofSlot.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = ProofSlot.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("ProofSlot.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new ProofSlot(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): ProofSlot.Params {
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
    throw new Error("ProofSlot: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "ProofSlot::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("ProofSlot: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): ProofSlotBuilder {
    return new ProofSlotBuilder();
  }

  static fromBuilder(builder: ProofSlotBuilder): ProofSlot | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return ProofSlot.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "metadata_proof", method: "metadata_proof", sizeField: "metadata_proof_size", paramKey: "metadata_proof_size", elementSize: 1 },
    { field: "program_proof", method: "program_proof", sizeField: "program_proof_size", paramKey: "program_proof_size", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_metadata_proof_size: number | null = null;
    let __tnFieldValue_program_proof_size: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 3 > __tnLength) return null;
    __tnCursorMutable += 3;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_metadata_proof_size = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_metadata_proof_size = __tnRead_metadata_proof_size;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_program_proof_size = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_program_proof_size = __tnRead_program_proof_size;
    __tnCursorMutable += 4;
    if (__tnFieldValue_metadata_proof_size === null) return null;
    const __tnArrayCount_metadata_proof = __tnU64(__tnToBigInt(__tnFieldValue_metadata_proof_size as number | bigint));
    if (__tnArrayCount_metadata_proof === null) return null;
    const __tnArrayBytesBig_metadata_proof = __tnArrayCount_metadata_proof * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_metadata_proof > BigInt(__tnLength)) return null;
    const __tnArrayBytes_metadata_proof = Number(__tnArrayBytesBig_metadata_proof);
    if (__tnCursorMutable + __tnArrayBytes_metadata_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_metadata_proof;
    if (__tnFieldValue_program_proof_size === null) return null;
    const __tnArrayCount_program_proof = __tnU64(__tnToBigInt(__tnFieldValue_program_proof_size as number | bigint));
    if (__tnArrayCount_program_proof === null) return null;
    const __tnArrayBytesBig_program_proof = __tnArrayCount_program_proof * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_program_proof > BigInt(__tnLength)) return null;
    const __tnArrayBytes_program_proof = Number(__tnArrayBytesBig_program_proof);
    offsets["program_proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_program_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_program_proof;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: ProofSlot.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 7) {
      return null;
    }
    const __tnParam_metadata_proof_metadata_proof_size = __tnToBigInt(view.getUint32(3, true));
    if (buffer.length < 11) {
      return null;
    }
    const __tnParam_program_proof_program_proof_size = __tnToBigInt(view.getUint32(7, true));
    const __tnExtractedParams = ProofSlot.Params.fromValues({
      metadata_proof_metadata_proof_size: __tnParam_metadata_proof_metadata_proof_size,
      program_proof_program_proof_size: __tnParam_program_proof_program_proof_size,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  /* Dynamic offsets are derived once per view; mutating length fields later does not invalidate this cache. */
  private __tnDynamicOffsetCache: Record<string, number> | null = null;
  private __tnGetDynamicOffset(field: string): number {
    if (!this.__tnDynamicOffsetCache) {
      this.__tnDynamicOffsetCache = this.__tnComputeDynamicOffsets();
    }
    const offset = this.__tnDynamicOffsetCache[field];
    if (offset === undefined) {
      throw new Error("ProofSlot: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = ProofSlot.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("ProofSlot: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_reserved(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved(value: number[]): void {
    const offset = 0;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved(): number[] {
    return this.get_reserved();
  }

  set reserved(value: number[]) {
    this.set_reserved(value);
  }

  get_metadata_proof_size(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_metadata_proof_size(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get metadata_proof_size(): number {
    return this.get_metadata_proof_size();
  }

  set metadata_proof_size(value: number) {
    this.set_metadata_proof_size(value);
  }

  get_program_proof_size(): number {
    const offset = 7;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_program_proof_size(value: number): void {
    const offset = 7;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get program_proof_size(): number {
    return this.get_program_proof_size();
  }

  set program_proof_size(value: number) {
    this.set_program_proof_size(value);
  }

  get_metadata_proof_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("metadata_proof_size"));
  }

  get_metadata_proof_at(index: number): number {
    const offset = 11;
    return this.view.getUint8(offset + index * 1);
  }

  get_metadata_proof(): number[] {
    const len = this.get_metadata_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_metadata_proof_at(i));
    }
    return result;
  }

  set_metadata_proof_at(index: number, value: number): void {
    const offset = 11;
    this.view.setUint8((offset + index * 1), value);
  }

  set_metadata_proof(value: number[]): void {
    const len = Math.min(this.get_metadata_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_metadata_proof_at(i, value[i]);
    }
  }

  get metadata_proof(): number[] {
    return this.get_metadata_proof();
  }

  set metadata_proof(value: number[]) {
    this.set_metadata_proof(value);
  }

  get_program_proof_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("program_proof_size"));
  }

  get_program_proof_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("program_proof");
    return this.view.getUint8(offset + index * 1);
  }

  get_program_proof(): number[] {
    const len = this.get_program_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_program_proof_at(i));
    }
    return result;
  }

  set_program_proof_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("program_proof");
    this.view.setUint8((offset + index * 1), value);
  }

  set_program_proof(value: number[]): void {
    const len = Math.min(this.get_program_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_program_proof_at(i, value[i]);
    }
  }

  get program_proof(): number[] {
    return this.get_program_proof();
  }

  set program_proof(value: number[]) {
    this.set_program_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ProofSlot.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ProofSlot, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint): bigint {
    const params = ProofSlot.Params.fromValues({
      metadata_proof_metadata_proof_size: metadata_proof_metadata_proof_size,
      program_proof_program_proof_size: program_proof_program_proof_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: ProofSlot.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["metadata_proof.metadata_proof_size"] = params.metadata_proof_metadata_proof_size;
    record["program_proof.program_proof_size"] = params.program_proof_program_proof_size;
    return record;
  }

  static footprintIrFromParams(params: ProofSlot.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: ProofSlot.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ProofSlot');
    return __tnBigIntToNumber(irResult, 'ProofSlot::footprintFromParams');
  }

  static footprintFromValues(input: { metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint }): number {
    const params = ProofSlot.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: ProofSlot.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: ProofSlot.Params }): { ok: boolean; code?: string; consumed?: number; params?: ProofSlot.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ProofSlot::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ProofSlot::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: ProofSlot.Params }): ProofSlot | null {
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
    const state = new ProofSlot(buffer, cached);
    return state;
  }


}

export namespace ProofSlot {
  export type Params = {
    /** ABI path: metadata_proof.metadata_proof_size */
    readonly metadata_proof_metadata_proof_size: bigint;
    /** ABI path: program_proof.program_proof_size */
    readonly program_proof_program_proof_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    metadata_proof_metadata_proof_size: "metadata_proof.metadata_proof_size",
    program_proof_program_proof_size: "program_proof.program_proof_size",
  } as const);

  export const Params = {
    fromValues(input: { metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint }): Params {
      return {
        metadata_proof_metadata_proof_size: __tnToBigInt(input.metadata_proof_metadata_proof_size),
        program_proof_program_proof_size: __tnToBigInt(input.program_proof_program_proof_size),
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

  export function params(input: { metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class ProofSlotBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: ProofSlot.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: ProofSlot.Params | null = null;
  private __tnFam_metadata_proof: Uint8Array | null = null;
  private __tnFam_metadata_proofCount: number | null = null;
  private __tnFamWriter_metadata_proof?: __TnFamWriterResult<ProofSlotBuilder>;
  private __tnFam_program_proof: Uint8Array | null = null;
  private __tnFam_program_proofCount: number | null = null;
  private __tnFamWriter_program_proof?: __TnFamWriterResult<ProofSlotBuilder>;

  constructor() {
    this.buffer = new Uint8Array(11);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_reserved(values: number[]): this {
    if (values.length !== 3) throw new Error("reserved expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_metadata_proof_size(value: number): this {
    this.view.setUint32(3, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_program_proof_size(value: number): this {
    this.view.setUint32(7, value, true);
    this.__tnInvalidate();
    return this;
  }

  metadata_proof(): __TnFamWriterResult<ProofSlotBuilder> {
    if (!this.__tnFamWriter_metadata_proof) {
      this.__tnFamWriter_metadata_proof = __tnCreateFamWriter(this, "metadata_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        if (elementCount > 4294967295) throw new Error("ProofSlotBuilder: metadata_proof has more than 4294967295 elements");
        this.__tnFam_metadata_proof = bytes;
        this.__tnFam_metadata_proofCount = elementCount;
        this.set_metadata_proof_size(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_metadata_proof!;
  }

  program_proof(): __TnFamWriterResult<ProofSlotBuilder> {
    if (!this.__tnFamWriter_program_proof) {
      this.__tnFamWriter_program_proof = __tnCreateFamWriter(this, "program_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        if (elementCount > 4294967295) throw new Error("ProofSlotBuilder: program_proof has more than 4294967295 elements");
        this.__tnFam_program_proof = bytes;
        this.__tnFam_program_proofCount = elementCount;
        this.set_program_proof_size(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_program_proof!;
  }

  private __tnSyncLengths(): void {
    if (this.__tnFam_metadata_proofCount !== null) this.set_metadata_proof_size(this.__tnFam_metadata_proofCount);
    if (this.__tnFam_program_proofCount !== null) this.set_program_proof_size(this.__tnFam_program_proofCount);
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = ProofSlot.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = ProofSlot.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("ProofSlotBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): ProofSlot {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = ProofSlot.from_array(buffer, { params });
    if (!view) throw new Error("ProofSlotBuilder: failed to finalize view");
    return view;
  }

  finishView(): ProofSlot {
    return this.finish();
  }

  dynamicParams(): ProofSlot.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): ProofSlot.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = ProofSlot.Params.fromValues({
      metadata_proof_metadata_proof_size: (() => { if (this.__tnFam_metadata_proofCount === null) throw new Error("ProofSlotBuilder: field 'metadata_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_metadata_proofCount); })(),
      program_proof_program_proof_size: (() => { if (this.__tnFam_program_proofCount === null) throw new Error("ProofSlotBuilder: field 'program_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_program_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_metadata_proof_bytes = this.__tnFam_metadata_proof;
    if (!__tnLocal_metadata_proof_bytes) throw new Error("ProofSlotBuilder: field 'metadata_proof' must be written before build");
    target.set(__tnLocal_metadata_proof_bytes, cursor);
    cursor += __tnLocal_metadata_proof_bytes.length;
    const __tnLocal_program_proof_bytes = this.__tnFam_program_proof;
    if (!__tnLocal_program_proof_bytes) throw new Error("ProofSlotBuilder: field 'program_proof' must be written before build");
    target.set(__tnLocal_program_proof_bytes, cursor);
    cursor += __tnLocal_program_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: ProofSlot.Params): void {
    const result = ProofSlot.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ ProofSlot }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("ProofSlot", (params) => ProofSlot.__tnInvokeFootprint(params));
__tnRegisterValidate("ProofSlot", (buffer, params) => ProofSlot.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ProofSlot", (buffer) => { const result = ProofSlot.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR BoundAccount ----- */

const __tn_ir_BoundAccount = {
  typeName: "BoundAccount",
  root: { op: "const", value: 34n }
} as const;

export class BoundAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): BoundAccount {
    if (!buffer || buffer.length === undefined) throw new Error("BoundAccount.__tnCreateView requires a Uint8Array");
    return new BoundAccount(new Uint8Array(buffer));
  }

  static builder(): BoundAccountBuilder {
    return new BoundAccountBuilder();
  }

  static fromBuilder(builder: BoundAccountBuilder): BoundAccount | null {
    const buffer = builder.build();
    return BoundAccount.from_array(buffer);
  }

  get_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get index(): number {
    return this.get_index();
  }

  set index(value: number) {
    this.set_index(value);
  }

  get_address(): Pubkey {
    const offset = 2;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_address(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 2;
    this.buffer.set(sourceBytes, offset);
  }

  get address(): Pubkey {
    return this.get_address();
  }

  set address(value: Pubkey) {
    this.set_address(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_BoundAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_BoundAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for BoundAccount');
    }
    return __tnBigIntToNumber(irResult, 'BoundAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 34) return { ok: false, code: "tn.buffer_too_small", consumed: 34 };
    return { ok: true, consumed: 34 };
  }

  static from_array(buffer: Uint8Array): BoundAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new BoundAccount(buffer);
  }

}

export class BoundAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(34);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_address(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("address expects 32 bytes");
    this.buffer.set(value, 2);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("BoundAccount", BoundAccount.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("BoundAccount", BoundAccount.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): BoundAccount {
    const view = BoundAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BoundAccount");
    return view;
  }
}

__tnRegisterFootprint("BoundAccount", (params) => BoundAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("BoundAccount", (buffer, params) => BoundAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("BoundAccount", (buffer) => { const result = BoundAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CoreConfig ----- */

const __tn_ir_CoreConfig = {
  typeName: "CoreConfig",
  root: { op: "const", value: 71n }
} as const;

export class CoreConfig {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreConfig {
    if (!buffer || buffer.length === undefined) throw new Error("CoreConfig.__tnCreateView requires a Uint8Array");
    return new CoreConfig(new Uint8Array(buffer));
  }

  static builder(): CoreConfigBuilder {
    return new CoreConfigBuilder();
  }

  static fromBuilder(builder: CoreConfigBuilder): CoreConfig | null {
    const buffer = builder.build();
    return CoreConfig.from_array(buffer);
  }

  get_admin_kind(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_admin_kind(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get admin_kind(): number {
    return this.get_admin_kind();
  }

  set admin_kind(value: number) {
    this.set_admin_kind(value);
  }

  get_pending_admin_kind(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_pending_admin_kind(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get pending_admin_kind(): number {
    return this.get_pending_admin_kind();
  }

  set pending_admin_kind(value: number) {
    this.set_pending_admin_kind(value);
  }

  get_pending_present(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_pending_present(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get pending_present(): number {
    return this.get_pending_present();
  }

  set pending_present(value: number) {
    this.set_pending_present(value);
  }

  get_reserved(): number[] {
    const offset = 3;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved(value: number[]): void {
    const offset = 3;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved(): number[] {
    return this.get_reserved();
  }

  set reserved(value: number[]) {
    this.set_reserved(value);
  }

  get_admin(): Pubkey {
    const offset = 7;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 7;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): Pubkey {
    return this.get_admin();
  }

  set admin(value: Pubkey) {
    this.set_admin(value);
  }

  get_pending_admin(): Pubkey {
    const offset = 39;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_pending_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 39;
    this.buffer.set(sourceBytes, offset);
  }

  get pending_admin(): Pubkey {
    return this.get_pending_admin();
  }

  set pending_admin(value: Pubkey) {
    this.set_pending_admin(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CoreConfig.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CoreConfig, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CoreConfig');
    }
    return __tnBigIntToNumber(irResult, 'CoreConfig::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 71) return { ok: false, code: "tn.buffer_too_small", consumed: 71 };
    return { ok: true, consumed: 71 };
  }

  static from_array(buffer: Uint8Array): CoreConfig | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CoreConfig(buffer);
  }

}

export class CoreConfigBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(71);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_admin_kind(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_pending_admin_kind(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_pending_present(value: number): this {
    this.view.setUint8(2, value);
    return this;
  }

  set_reserved(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 3 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("admin expects 32 bytes");
    this.buffer.set(value, 7);
    return this;
  }

  set_pending_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("pending_admin expects 32 bytes");
    this.buffer.set(value, 39);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CoreConfig", CoreConfig.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CoreConfig", CoreConfig.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CoreConfig {
    const view = CoreConfig.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CoreConfig");
    return view;
  }
}

__tnRegisterFootprint("CoreConfig", (params) => CoreConfig.__tnInvokeFootprint(params));
__tnRegisterValidate("CoreConfig", (buffer, params) => CoreConfig.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CoreConfig", (buffer) => { const result = CoreConfig.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ImageCommitment ----- */

const __tn_ir_ImageCommitment = {
  typeName: "ImageCommitment",
  root: { op: "const", value: 74n }
} as const;

export class ImageCommitment {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ImageCommitment {
    if (!buffer || buffer.length === undefined) throw new Error("ImageCommitment.__tnCreateView requires a Uint8Array");
    return new ImageCommitment(new Uint8Array(buffer));
  }

  static builder(): ImageCommitmentBuilder {
    return new ImageCommitmentBuilder();
  }

  static fromBuilder(builder: ImageCommitmentBuilder): ImageCommitment | null {
    const buffer = builder.build();
    return ImageCommitment.from_array(buffer);
  }

  get_source(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_source(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get source(): BoundAccount {
    return this.get_source();
  }

  set source(value: BoundAccount) {
    this.set_source(value);
  }

  get_offset(): number {
    const offset = 34;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_offset(value: number): void {
    const offset = 34;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get offset(): number {
    return this.get_offset();
  }

  set offset(value: number) {
    this.set_offset(value);
  }

  get_length(): number {
    const offset = 38;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_length(value: number): void {
    const offset = 38;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get length(): number {
    return this.get_length();
  }

  set length(value: number) {
    this.set_length(value);
  }

  get_sha256(): number[] {
    const offset = 42;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_sha256(value: number[]): void {
    const offset = 42;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get sha256(): number[] {
    return this.get_sha256();
  }

  set sha256(value: number[]) {
    this.set_sha256(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ImageCommitment.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ImageCommitment, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ImageCommitment');
    }
    return __tnBigIntToNumber(irResult, 'ImageCommitment::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 74) return { ok: false, code: "tn.buffer_too_small", consumed: 74 };
    return { ok: true, consumed: 74 };
  }

  static from_array(buffer: Uint8Array): ImageCommitment | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ImageCommitment(buffer);
  }

}

export class ImageCommitmentBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(74);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_source(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("source expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_offset(value: number): this {
    this.view.setUint32(34, value, true);
    return this;
  }

  set_length(value: number): this {
    this.view.setUint32(38, value, true);
    return this;
  }

  set_sha256(values: number[]): this {
    if (values.length !== 32) throw new Error("sha256 expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 42 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("ImageCommitment", ImageCommitment.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("ImageCommitment", ImageCommitment.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ImageCommitment {
    const view = ImageCommitment.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ImageCommitment");
    return view;
  }
}

__tnRegisterFootprint("ImageCommitment", (params) => ImageCommitment.__tnInvokeFootprint(params));
__tnRegisterValidate("ImageCommitment", (buffer, params) => ImageCommitment.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ImageCommitment", (buffer) => { const result = ImageCommitment.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ManagedProgramMetadata ----- */

const __tn_ir_ManagedProgramMetadata = {
  typeName: "ManagedProgramMetadata",
  root: { op: "const", value: 73n }
} as const;

export class ManagedProgramMetadata {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ManagedProgramMetadata {
    if (!buffer || buffer.length === undefined) throw new Error("ManagedProgramMetadata.__tnCreateView requires a Uint8Array");
    return new ManagedProgramMetadata(new Uint8Array(buffer));
  }

  static builder(): ManagedProgramMetadataBuilder {
    return new ManagedProgramMetadataBuilder();
  }

  static fromBuilder(builder: ManagedProgramMetadataBuilder): ManagedProgramMetadata | null {
    const buffer = builder.build();
    return ManagedProgramMetadata.from_array(buffer);
  }

  get_authority(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Pubkey {
    return this.get_authority();
  }

  set authority(value: Pubkey) {
    this.set_authority(value);
  }

  get_authority_candidate(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority_candidate(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get authority_candidate(): Pubkey {
    return this.get_authority_candidate();
  }

  set authority_candidate(value: Pubkey) {
    this.set_authority_candidate(value);
  }

  get_version(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_version(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get version(): bigint {
    return this.get_version();
  }

  set version(value: bigint) {
    this.set_version(value);
  }

  get_state(): number {
    const offset = 72;
    return this.view.getUint8(offset);
  }

  set_state(value: number): void {
    const offset = 72;
    this.view.setUint8(offset, value);
  }

  get state(): number {
    return this.get_state();
  }

  set state(value: number) {
    this.set_state(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ManagedProgramMetadata.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ManagedProgramMetadata, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ManagedProgramMetadata');
    }
    return __tnBigIntToNumber(irResult, 'ManagedProgramMetadata::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 73) return { ok: false, code: "tn.buffer_too_small", consumed: 73 };
    return { ok: true, consumed: 73 };
  }

  static from_array(buffer: Uint8Array): ManagedProgramMetadata | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ManagedProgramMetadata(buffer);
  }

}

export class ManagedProgramMetadataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(73);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_authority_candidate(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority_candidate expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_version(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_state(value: number): this {
    this.view.setUint8(72, value);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("ManagedProgramMetadata", ManagedProgramMetadata.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("ManagedProgramMetadata", ManagedProgramMetadata.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ManagedProgramMetadata {
    const view = ManagedProgramMetadata.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ManagedProgramMetadata");
    return view;
  }
}

__tnRegisterFootprint("ManagedProgramMetadata", (params) => ManagedProgramMetadata.__tnInvokeFootprint(params));
__tnRegisterValidate("ManagedProgramMetadata", (buffer, params) => ManagedProgramMetadata.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ManagedProgramMetadata", (buffer) => { const result = ManagedProgramMetadata.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PairArgs ----- */

const __tn_ir_PairArgs = {
  typeName: "PairArgs",
  root: { op: "const", value: 136n }
} as const;

export class PairArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): PairArgs {
    if (!buffer || buffer.length === undefined) throw new Error("PairArgs.__tnCreateView requires a Uint8Array");
    return new PairArgs(new Uint8Array(buffer));
  }

  static builder(): PairArgsBuilder {
    return new PairArgsBuilder();
  }

  static fromBuilder(builder: PairArgsBuilder): PairArgs | null {
    const buffer = builder.build();
    return PairArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_metadata(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_metadata(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get metadata(): BoundAccount {
    return this.get_metadata();
  }

  set metadata(value: BoundAccount) {
    this.set_metadata(value);
  }

  get_program(): BoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get program(): BoundAccount {
    return this.get_program();
  }

  set program(value: BoundAccount) {
    this.set_program(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PairArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PairArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PairArgs');
    }
    return __tnBigIntToNumber(irResult, 'PairArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 136) return { ok: false, code: "tn.buffer_too_small", consumed: 136 };
    return { ok: true, consumed: 136 };
  }

  static from_array(buffer: Uint8Array): PairArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new PairArgs(buffer);
  }

}

export class PairArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(136);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("metadata expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("program expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("PairArgs", PairArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("PairArgs", PairArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): PairArgs {
    const view = PairArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build PairArgs");
    return view;
  }
}

__tnRegisterFootprint("PairArgs", (params) => PairArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("PairArgs", (buffer, params) => PairArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PairArgs", (buffer) => { const result = PairArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ProposeAdminArgs ----- */

const __tn_ir_ProposeAdminArgs = {
  typeName: "ProposeAdminArgs",
  root: { op: "const", value: 171n }
} as const;

export class ProposeAdminArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ProposeAdminArgs {
    if (!buffer || buffer.length === undefined) throw new Error("ProposeAdminArgs.__tnCreateView requires a Uint8Array");
    return new ProposeAdminArgs(new Uint8Array(buffer));
  }

  static builder(): ProposeAdminArgsBuilder {
    return new ProposeAdminArgsBuilder();
  }

  static fromBuilder(builder: ProposeAdminArgsBuilder): ProposeAdminArgs | null {
    const buffer = builder.build();
    return ProposeAdminArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_candidate(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_candidate(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get candidate(): BoundAccount {
    return this.get_candidate();
  }

  set candidate(value: BoundAccount) {
    this.set_candidate(value);
  }

  get_candidate_kind(): number {
    const offset = 102;
    return this.view.getUint8(offset);
  }

  set_candidate_kind(value: number): void {
    const offset = 102;
    this.view.setUint8(offset, value);
  }

  get candidate_kind(): number {
    return this.get_candidate_kind();
  }

  set candidate_kind(value: number) {
    this.set_candidate_kind(value);
  }

  get_peer_program(): BoundAccount {
    const offset = 103;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_peer_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 103;
    this.buffer.set(sourceBytes, offset);
  }

  get peer_program(): BoundAccount {
    return this.get_peer_program();
  }

  set peer_program(value: BoundAccount) {
    this.set_peer_program(value);
  }

  get_peer_config(): BoundAccount {
    const offset = 137;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_peer_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 137;
    this.buffer.set(sourceBytes, offset);
  }

  get peer_config(): BoundAccount {
    return this.get_peer_config();
  }

  set peer_config(value: BoundAccount) {
    this.set_peer_config(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ProposeAdminArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ProposeAdminArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ProposeAdminArgs');
    }
    return __tnBigIntToNumber(irResult, 'ProposeAdminArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 171) return { ok: false, code: "tn.buffer_too_small", consumed: 171 };
    return { ok: true, consumed: 171 };
  }

  static from_array(buffer: Uint8Array): ProposeAdminArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ProposeAdminArgs(buffer);
  }

}

export class ProposeAdminArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(171);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_candidate(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("candidate expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_candidate_kind(value: number): this {
    this.view.setUint8(102, value);
    return this;
  }

  set_peer_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("peer_program expects 34 bytes");
    this.buffer.set(value, 103);
    return this;
  }

  set_peer_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("peer_config expects 34 bytes");
    this.buffer.set(value, 137);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("ProposeAdminArgs", ProposeAdminArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("ProposeAdminArgs", ProposeAdminArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ProposeAdminArgs {
    const view = ProposeAdminArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ProposeAdminArgs");
    return view;
  }
}

__tnRegisterFootprint("ProposeAdminArgs", (params) => ProposeAdminArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("ProposeAdminArgs", (buffer, params) => ProposeAdminArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ProposeAdminArgs", (buffer) => { const result = ProposeAdminArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetApplicationAuthorityArgs ----- */

const __tn_ir_SetApplicationAuthorityArgs = {
  typeName: "SetApplicationAuthorityArgs",
  root: { op: "const", value: 168n }
} as const;

export class SetApplicationAuthorityArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SetApplicationAuthorityArgs {
    if (!buffer || buffer.length === undefined) throw new Error("SetApplicationAuthorityArgs.__tnCreateView requires a Uint8Array");
    return new SetApplicationAuthorityArgs(new Uint8Array(buffer));
  }

  static builder(): SetApplicationAuthorityArgsBuilder {
    return new SetApplicationAuthorityArgsBuilder();
  }

  static fromBuilder(builder: SetApplicationAuthorityArgsBuilder): SetApplicationAuthorityArgs | null {
    const buffer = builder.build();
    return SetApplicationAuthorityArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_metadata(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_metadata(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get metadata(): BoundAccount {
    return this.get_metadata();
  }

  set metadata(value: BoundAccount) {
    this.set_metadata(value);
  }

  get_program(): BoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get program(): BoundAccount {
    return this.get_program();
  }

  set program(value: BoundAccount) {
    this.set_program(value);
  }

  get_application_authority(): Pubkey {
    const offset = 136;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_application_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 136;
    this.buffer.set(sourceBytes, offset);
  }

  get application_authority(): Pubkey {
    return this.get_application_authority();
  }

  set application_authority(value: Pubkey) {
    this.set_application_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SetApplicationAuthorityArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SetApplicationAuthorityArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SetApplicationAuthorityArgs');
    }
    return __tnBigIntToNumber(irResult, 'SetApplicationAuthorityArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 168) return { ok: false, code: "tn.buffer_too_small", consumed: 168 };
    return { ok: true, consumed: 168 };
  }

  static from_array(buffer: Uint8Array): SetApplicationAuthorityArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SetApplicationAuthorityArgs(buffer);
  }

}

export class SetApplicationAuthorityArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(168);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("metadata expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("program expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  set_application_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("application_authority expects 32 bytes");
    this.buffer.set(value, 136);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("SetApplicationAuthorityArgs", SetApplicationAuthorityArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("SetApplicationAuthorityArgs", SetApplicationAuthorityArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): SetApplicationAuthorityArgs {
    const view = SetApplicationAuthorityArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetApplicationAuthorityArgs");
    return view;
  }
}

__tnRegisterFootprint("SetApplicationAuthorityArgs", (params) => SetApplicationAuthorityArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetApplicationAuthorityArgs", (buffer, params) => SetApplicationAuthorityArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetApplicationAuthorityArgs", (buffer) => { const result = SetApplicationAuthorityArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetPauseArgs ----- */

const __tn_ir_SetPauseArgs = {
  typeName: "SetPauseArgs",
  root: { op: "const", value: 137n }
} as const;

export class SetPauseArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SetPauseArgs {
    if (!buffer || buffer.length === undefined) throw new Error("SetPauseArgs.__tnCreateView requires a Uint8Array");
    return new SetPauseArgs(new Uint8Array(buffer));
  }

  static builder(): SetPauseArgsBuilder {
    return new SetPauseArgsBuilder();
  }

  static fromBuilder(builder: SetPauseArgsBuilder): SetPauseArgs | null {
    const buffer = builder.build();
    return SetPauseArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_metadata(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_metadata(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get metadata(): BoundAccount {
    return this.get_metadata();
  }

  set metadata(value: BoundAccount) {
    this.set_metadata(value);
  }

  get_program(): BoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get program(): BoundAccount {
    return this.get_program();
  }

  set program(value: BoundAccount) {
    this.set_program(value);
  }

  get_paused(): number {
    const offset = 136;
    return this.view.getUint8(offset);
  }

  set_paused(value: number): void {
    const offset = 136;
    this.view.setUint8(offset, value);
  }

  get paused(): number {
    return this.get_paused();
  }

  set paused(value: number) {
    this.set_paused(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SetPauseArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SetPauseArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SetPauseArgs');
    }
    return __tnBigIntToNumber(irResult, 'SetPauseArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 137) return { ok: false, code: "tn.buffer_too_small", consumed: 137 };
    return { ok: true, consumed: 137 };
  }

  static from_array(buffer: Uint8Array): SetPauseArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SetPauseArgs(buffer);
  }

}

export class SetPauseArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(137);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("metadata expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("program expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  set_paused(value: number): this {
    this.view.setUint8(136, value);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("SetPauseArgs", SetPauseArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("SetPauseArgs", SetPauseArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): SetPauseArgs {
    const view = SetPauseArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetPauseArgs");
    return view;
  }
}

__tnRegisterFootprint("SetPauseArgs", (params) => SetPauseArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetPauseArgs", (buffer, params) => SetPauseArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetPauseArgs", (buffer) => { const result = SetPauseArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetPinArgs ----- */

const __tn_ir_SetPinArgs = {
  typeName: "SetPinArgs",
  root: { op: "const", value: 103n }
} as const;

export class SetPinArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SetPinArgs {
    if (!buffer || buffer.length === undefined) throw new Error("SetPinArgs.__tnCreateView requires a Uint8Array");
    return new SetPinArgs(new Uint8Array(buffer));
  }

  static builder(): SetPinArgsBuilder {
    return new SetPinArgsBuilder();
  }

  static fromBuilder(builder: SetPinArgsBuilder): SetPinArgs | null {
    const buffer = builder.build();
    return SetPinArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_target(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_target(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get target(): BoundAccount {
    return this.get_target();
  }

  set target(value: BoundAccount) {
    this.set_target(value);
  }

  get_pin(): number {
    const offset = 102;
    return this.view.getUint8(offset);
  }

  set_pin(value: number): void {
    const offset = 102;
    this.view.setUint8(offset, value);
  }

  get pin(): number {
    return this.get_pin();
  }

  set pin(value: number) {
    this.set_pin(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SetPinArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SetPinArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SetPinArgs');
    }
    return __tnBigIntToNumber(irResult, 'SetPinArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 103) return { ok: false, code: "tn.buffer_too_small", consumed: 103 };
    return { ok: true, consumed: 103 };
  }

  static from_array(buffer: Uint8Array): SetPinArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SetPinArgs(buffer);
  }

}

export class SetPinArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(103);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_target(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("target expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_pin(value: number): this {
    this.view.setUint8(102, value);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("SetPinArgs", SetPinArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("SetPinArgs", SetPinArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): SetPinArgs {
    const view = SetPinArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetPinArgs");
    return view;
  }
}

__tnRegisterFootprint("SetPinArgs", (params) => SetPinArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetPinArgs", (buffer, params) => SetPinArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetPinArgs", (buffer) => { const result = SetPinArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpgradeArgs ----- */

const __tn_ir_UpgradeArgs = {
  typeName: "UpgradeArgs",
  root: { op: "const", value: 210n }
} as const;

export class UpgradeArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UpgradeArgs {
    if (!buffer || buffer.length === undefined) throw new Error("UpgradeArgs.__tnCreateView requires a Uint8Array");
    return new UpgradeArgs(new Uint8Array(buffer));
  }

  static builder(): UpgradeArgsBuilder {
    return new UpgradeArgsBuilder();
  }

  static fromBuilder(builder: UpgradeArgsBuilder): UpgradeArgs | null {
    const buffer = builder.build();
    return UpgradeArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_metadata(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_metadata(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get metadata(): BoundAccount {
    return this.get_metadata();
  }

  set metadata(value: BoundAccount) {
    this.set_metadata(value);
  }

  get_program(): BoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get program(): BoundAccount {
    return this.get_program();
  }

  set program(value: BoundAccount) {
    this.set_program(value);
  }

  get_image(): ImageCommitment {
    const offset = 136;
    const slice = this.buffer.subarray(offset, offset + 74);
    return ImageCommitment.from_array(slice)!;
  }

  set_image(value: ImageCommitment): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 136;
    this.buffer.set(sourceBytes, offset);
  }

  get image(): ImageCommitment {
    return this.get_image();
  }

  set image(value: ImageCommitment) {
    this.set_image(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UpgradeArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UpgradeArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UpgradeArgs');
    }
    return __tnBigIntToNumber(irResult, 'UpgradeArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 210) return { ok: false, code: "tn.buffer_too_small", consumed: 210 };
    return { ok: true, consumed: 210 };
  }

  static from_array(buffer: Uint8Array): UpgradeArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UpgradeArgs(buffer);
  }

}

export class UpgradeArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(210);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("metadata expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("program expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  set_image(value: Uint8Array): this {
    if (value.length !== 74) throw new Error("image expects 74 bytes");
    this.buffer.set(value, 136);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("UpgradeArgs", UpgradeArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("UpgradeArgs", UpgradeArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): UpgradeArgs {
    const view = UpgradeArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build UpgradeArgs");
    return view;
  }
}

__tnRegisterFootprint("UpgradeArgs", (params) => UpgradeArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("UpgradeArgs", (buffer, params) => UpgradeArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UpgradeArgs", (buffer) => { const result = UpgradeArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpgradePeerArgs ----- */

const __tn_ir_UpgradePeerArgs = {
  typeName: "UpgradePeerArgs",
  root: { op: "const", value: 176n }
} as const;

export class UpgradePeerArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UpgradePeerArgs {
    if (!buffer || buffer.length === undefined) throw new Error("UpgradePeerArgs.__tnCreateView requires a Uint8Array");
    return new UpgradePeerArgs(new Uint8Array(buffer));
  }

  static builder(): UpgradePeerArgsBuilder {
    return new UpgradePeerArgsBuilder();
  }

  static fromBuilder(builder: UpgradePeerArgsBuilder): UpgradePeerArgs | null {
    const buffer = builder.build();
    return UpgradePeerArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_peer(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_peer(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get peer(): BoundAccount {
    return this.get_peer();
  }

  set peer(value: BoundAccount) {
    this.set_peer(value);
  }

  get_image(): ImageCommitment {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 74);
    return ImageCommitment.from_array(slice)!;
  }

  set_image(value: ImageCommitment): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get image(): ImageCommitment {
    return this.get_image();
  }

  set image(value: ImageCommitment) {
    this.set_image(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UpgradePeerArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UpgradePeerArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UpgradePeerArgs');
    }
    return __tnBigIntToNumber(irResult, 'UpgradePeerArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 176) return { ok: false, code: "tn.buffer_too_small", consumed: 176 };
    return { ok: true, consumed: 176 };
  }

  static from_array(buffer: Uint8Array): UpgradePeerArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UpgradePeerArgs(buffer);
  }

}

export class UpgradePeerArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(176);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_peer(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("peer expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_image(value: Uint8Array): this {
    if (value.length !== 74) throw new Error("image expects 74 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("UpgradePeerArgs", UpgradePeerArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("UpgradePeerArgs", UpgradePeerArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): UpgradePeerArgs {
    const view = UpgradePeerArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build UpgradePeerArgs");
    return view;
  }
}

__tnRegisterFootprint("UpgradePeerArgs", (params) => UpgradePeerArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("UpgradePeerArgs", (buffer, params) => UpgradePeerArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UpgradePeerArgs", (buffer) => { const result = UpgradePeerArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR WriteProofSlotArgs ----- */

const __tn_ir_WriteProofSlotArgs = {
  typeName: "WriteProofSlotArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 34n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "metadata_proof.metadata_proof_size" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "program_proof.program_proof_size" }, right: { op: "const", value: 1n } } } } }
} as const;

export class WriteProofSlotArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: WriteProofSlotArgs.Params;

  private constructor(private buffer: Uint8Array, params?: WriteProofSlotArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = WriteProofSlotArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("WriteProofSlotArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: WriteProofSlotArgs.Params, fieldContext?: Record<string, number | bigint> }): WriteProofSlotArgs {
    if (!buffer || buffer.length === undefined) throw new Error("WriteProofSlotArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = WriteProofSlotArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("WriteProofSlotArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new WriteProofSlotArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): WriteProofSlotArgs.Params {
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
    throw new Error("WriteProofSlotArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "WriteProofSlotArgs::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("WriteProofSlotArgs: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): WriteProofSlotArgsBuilder {
    return new WriteProofSlotArgsBuilder();
  }

  static fromBuilder(builder: WriteProofSlotArgsBuilder): WriteProofSlotArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return WriteProofSlotArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "metadata_proof", method: "metadata_proof", sizeField: "metadata_proof_size", paramKey: "metadata_proof_size", elementSize: 1 },
    { field: "program_proof", method: "program_proof", sizeField: "program_proof_size", paramKey: "program_proof_size", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_metadata_proof_size: number | null = null;
    let __tnFieldValue_program_proof_size: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 34 > __tnLength) return null;
    __tnCursorMutable += 34;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_metadata_proof_size = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_metadata_proof_size = __tnRead_metadata_proof_size;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_program_proof_size = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_program_proof_size = __tnRead_program_proof_size;
    __tnCursorMutable += 4;
    if (__tnFieldValue_metadata_proof_size === null) return null;
    const __tnArrayCount_metadata_proof = __tnU64(__tnToBigInt(__tnFieldValue_metadata_proof_size as number | bigint));
    if (__tnArrayCount_metadata_proof === null) return null;
    const __tnArrayBytesBig_metadata_proof = __tnArrayCount_metadata_proof * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_metadata_proof > BigInt(__tnLength)) return null;
    const __tnArrayBytes_metadata_proof = Number(__tnArrayBytesBig_metadata_proof);
    if (__tnCursorMutable + __tnArrayBytes_metadata_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_metadata_proof;
    if (__tnFieldValue_program_proof_size === null) return null;
    const __tnArrayCount_program_proof = __tnU64(__tnToBigInt(__tnFieldValue_program_proof_size as number | bigint));
    if (__tnArrayCount_program_proof === null) return null;
    const __tnArrayBytesBig_program_proof = __tnArrayCount_program_proof * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_program_proof > BigInt(__tnLength)) return null;
    const __tnArrayBytes_program_proof = Number(__tnArrayBytesBig_program_proof);
    offsets["program_proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_program_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_program_proof;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: WriteProofSlotArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 70) {
      return null;
    }
    const __tnParam_metadata_proof_metadata_proof_size = __tnToBigInt(view.getUint32(66, true));
    if (buffer.length < 74) {
      return null;
    }
    const __tnParam_program_proof_program_proof_size = __tnToBigInt(view.getUint32(70, true));
    const __tnExtractedParams = WriteProofSlotArgs.Params.fromValues({
      metadata_proof_metadata_proof_size: __tnParam_metadata_proof_metadata_proof_size,
      program_proof_program_proof_size: __tnParam_program_proof_program_proof_size,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  /* Dynamic offsets are derived once per view; mutating length fields later does not invalidate this cache. */
  private __tnDynamicOffsetCache: Record<string, number> | null = null;
  private __tnGetDynamicOffset(field: string): number {
    if (!this.__tnDynamicOffsetCache) {
      this.__tnDynamicOffsetCache = this.__tnComputeDynamicOffsets();
    }
    const offset = this.__tnDynamicOffsetCache[field];
    if (offset === undefined) {
      throw new Error("WriteProofSlotArgs: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = WriteProofSlotArgs.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("WriteProofSlotArgs: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_slot(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_slot(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get slot(): BoundAccount {
    return this.get_slot();
  }

  set slot(value: BoundAccount) {
    this.set_slot(value);
  }

  get_seed(): number[] {
    const offset = 34;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_seed(value: number[]): void {
    const offset = 34;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get seed(): number[] {
    return this.get_seed();
  }

  set seed(value: number[]) {
    this.set_seed(value);
  }

  get_metadata_proof_size(): number {
    const offset = 66;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_metadata_proof_size(value: number): void {
    const offset = 66;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get metadata_proof_size(): number {
    return this.get_metadata_proof_size();
  }

  set metadata_proof_size(value: number) {
    this.set_metadata_proof_size(value);
  }

  get_program_proof_size(): number {
    const offset = 70;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_program_proof_size(value: number): void {
    const offset = 70;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get program_proof_size(): number {
    return this.get_program_proof_size();
  }

  set program_proof_size(value: number) {
    this.set_program_proof_size(value);
  }

  get_metadata_proof_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("metadata_proof_size"));
  }

  get_metadata_proof_at(index: number): number {
    const offset = 74;
    return this.view.getUint8(offset + index * 1);
  }

  get_metadata_proof(): number[] {
    const len = this.get_metadata_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_metadata_proof_at(i));
    }
    return result;
  }

  set_metadata_proof_at(index: number, value: number): void {
    const offset = 74;
    this.view.setUint8((offset + index * 1), value);
  }

  set_metadata_proof(value: number[]): void {
    const len = Math.min(this.get_metadata_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_metadata_proof_at(i, value[i]);
    }
  }

  get metadata_proof(): number[] {
    return this.get_metadata_proof();
  }

  set metadata_proof(value: number[]) {
    this.set_metadata_proof(value);
  }

  get_program_proof_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("program_proof_size"));
  }

  get_program_proof_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("program_proof");
    return this.view.getUint8(offset + index * 1);
  }

  get_program_proof(): number[] {
    const len = this.get_program_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_program_proof_at(i));
    }
    return result;
  }

  set_program_proof_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("program_proof");
    this.view.setUint8((offset + index * 1), value);
  }

  set_program_proof(value: number[]): void {
    const len = Math.min(this.get_program_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_program_proof_at(i, value[i]);
    }
  }

  get program_proof(): number[] {
    return this.get_program_proof();
  }

  set program_proof(value: number[]) {
    this.set_program_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_WriteProofSlotArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_WriteProofSlotArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint): bigint {
    const params = WriteProofSlotArgs.Params.fromValues({
      metadata_proof_metadata_proof_size: metadata_proof_metadata_proof_size,
      program_proof_program_proof_size: program_proof_program_proof_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: WriteProofSlotArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["metadata_proof.metadata_proof_size"] = params.metadata_proof_metadata_proof_size;
    record["program_proof.program_proof_size"] = params.program_proof_program_proof_size;
    return record;
  }

  static footprintIrFromParams(params: WriteProofSlotArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: WriteProofSlotArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for WriteProofSlotArgs');
    return __tnBigIntToNumber(irResult, 'WriteProofSlotArgs::footprintFromParams');
  }

  static footprintFromValues(input: { metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint }): number {
    const params = WriteProofSlotArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: WriteProofSlotArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: WriteProofSlotArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: WriteProofSlotArgs.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'WriteProofSlotArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'WriteProofSlotArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: WriteProofSlotArgs.Params }): WriteProofSlotArgs | null {
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
    const state = new WriteProofSlotArgs(buffer, cached);
    return state;
  }


}

export namespace WriteProofSlotArgs {
  export type Params = {
    /** ABI path: metadata_proof.metadata_proof_size */
    readonly metadata_proof_metadata_proof_size: bigint;
    /** ABI path: program_proof.program_proof_size */
    readonly program_proof_program_proof_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    metadata_proof_metadata_proof_size: "metadata_proof.metadata_proof_size",
    program_proof_program_proof_size: "program_proof.program_proof_size",
  } as const);

  export const Params = {
    fromValues(input: { metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint }): Params {
      return {
        metadata_proof_metadata_proof_size: __tnToBigInt(input.metadata_proof_metadata_proof_size),
        program_proof_program_proof_size: __tnToBigInt(input.program_proof_program_proof_size),
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

  export function params(input: { metadata_proof_metadata_proof_size: number | bigint, program_proof_program_proof_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class WriteProofSlotArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: WriteProofSlotArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: WriteProofSlotArgs.Params | null = null;
  private __tnFam_metadata_proof: Uint8Array | null = null;
  private __tnFam_metadata_proofCount: number | null = null;
  private __tnFamWriter_metadata_proof?: __TnFamWriterResult<WriteProofSlotArgsBuilder>;
  private __tnFam_program_proof: Uint8Array | null = null;
  private __tnFam_program_proofCount: number | null = null;
  private __tnFamWriter_program_proof?: __TnFamWriterResult<WriteProofSlotArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(74);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_slot(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("slot expects 34 bytes");
    this.buffer.set(value, 0);
    this.__tnInvalidate();
    return this;
  }

  set_seed(values: number[]): this {
    if (values.length !== 32) throw new Error("seed expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 34 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_metadata_proof_size(value: number): this {
    this.view.setUint32(66, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_program_proof_size(value: number): this {
    this.view.setUint32(70, value, true);
    this.__tnInvalidate();
    return this;
  }

  metadata_proof(): __TnFamWriterResult<WriteProofSlotArgsBuilder> {
    if (!this.__tnFamWriter_metadata_proof) {
      this.__tnFamWriter_metadata_proof = __tnCreateFamWriter(this, "metadata_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        if (elementCount > 4294967295) throw new Error("WriteProofSlotArgsBuilder: metadata_proof has more than 4294967295 elements");
        this.__tnFam_metadata_proof = bytes;
        this.__tnFam_metadata_proofCount = elementCount;
        this.set_metadata_proof_size(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_metadata_proof!;
  }

  program_proof(): __TnFamWriterResult<WriteProofSlotArgsBuilder> {
    if (!this.__tnFamWriter_program_proof) {
      this.__tnFamWriter_program_proof = __tnCreateFamWriter(this, "program_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        if (elementCount > 4294967295) throw new Error("WriteProofSlotArgsBuilder: program_proof has more than 4294967295 elements");
        this.__tnFam_program_proof = bytes;
        this.__tnFam_program_proofCount = elementCount;
        this.set_program_proof_size(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_program_proof!;
  }

  private __tnSyncLengths(): void {
    if (this.__tnFam_metadata_proofCount !== null) this.set_metadata_proof_size(this.__tnFam_metadata_proofCount);
    if (this.__tnFam_program_proofCount !== null) this.set_program_proof_size(this.__tnFam_program_proofCount);
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = WriteProofSlotArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = WriteProofSlotArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("WriteProofSlotArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): WriteProofSlotArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = WriteProofSlotArgs.from_array(buffer, { params });
    if (!view) throw new Error("WriteProofSlotArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): WriteProofSlotArgs {
    return this.finish();
  }

  dynamicParams(): WriteProofSlotArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): WriteProofSlotArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = WriteProofSlotArgs.Params.fromValues({
      metadata_proof_metadata_proof_size: (() => { if (this.__tnFam_metadata_proofCount === null) throw new Error("WriteProofSlotArgsBuilder: field 'metadata_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_metadata_proofCount); })(),
      program_proof_program_proof_size: (() => { if (this.__tnFam_program_proofCount === null) throw new Error("WriteProofSlotArgsBuilder: field 'program_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_program_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_metadata_proof_bytes = this.__tnFam_metadata_proof;
    if (!__tnLocal_metadata_proof_bytes) throw new Error("WriteProofSlotArgsBuilder: field 'metadata_proof' must be written before build");
    target.set(__tnLocal_metadata_proof_bytes, cursor);
    cursor += __tnLocal_metadata_proof_bytes.length;
    const __tnLocal_program_proof_bytes = this.__tnFam_program_proof;
    if (!__tnLocal_program_proof_bytes) throw new Error("WriteProofSlotArgsBuilder: field 'program_proof' must be written before build");
    target.set(__tnLocal_program_proof_bytes, cursor);
    cursor += __tnLocal_program_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: WriteProofSlotArgs.Params): void {
    const result = WriteProofSlotArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ WriteProofSlotArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("WriteProofSlotArgs", (params) => WriteProofSlotArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("WriteProofSlotArgs", (buffer, params) => WriteProofSlotArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("WriteProofSlotArgs", (buffer) => { const result = WriteProofSlotArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AcceptAdminArgs ----- */

const __tn_ir_AcceptAdminArgs = {
  typeName: "AcceptAdminArgs",
  root: { op: "const", value: 136n }
} as const;

export class AcceptAdminArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AcceptAdminArgs {
    if (!buffer || buffer.length === undefined) throw new Error("AcceptAdminArgs.__tnCreateView requires a Uint8Array");
    return new AcceptAdminArgs(new Uint8Array(buffer));
  }

  static builder(): AcceptAdminArgsBuilder {
    return new AcceptAdminArgsBuilder();
  }

  static fromBuilder(builder: AcceptAdminArgsBuilder): AcceptAdminArgs | null {
    const buffer = builder.build();
    return AcceptAdminArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_peer_program(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_peer_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get peer_program(): BoundAccount {
    return this.get_peer_program();
  }

  set peer_program(value: BoundAccount) {
    this.set_peer_program(value);
  }

  get_peer_config(): BoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_peer_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get peer_config(): BoundAccount {
    return this.get_peer_config();
  }

  set peer_config(value: BoundAccount) {
    this.set_peer_config(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AcceptAdminArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AcceptAdminArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AcceptAdminArgs');
    }
    return __tnBigIntToNumber(irResult, 'AcceptAdminArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 136) return { ok: false, code: "tn.buffer_too_small", consumed: 136 };
    return { ok: true, consumed: 136 };
  }

  static from_array(buffer: Uint8Array): AcceptAdminArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AcceptAdminArgs(buffer);
  }

}

export class AcceptAdminArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(136);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_peer_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("peer_program expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_peer_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("peer_config expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("AcceptAdminArgs", AcceptAdminArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("AcceptAdminArgs", AcceptAdminArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): AcceptAdminArgs {
    const view = AcceptAdminArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AcceptAdminArgs");
    return view;
  }
}

__tnRegisterFootprint("AcceptAdminArgs", (params) => AcceptAdminArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("AcceptAdminArgs", (buffer, params) => AcceptAdminArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AcceptAdminArgs", (buffer) => { const result = AcceptAdminArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CoreManagerAccount ----- */

const __tn_ir_CoreManagerAccount = {
  typeName: "CoreManagerAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class CoreManagerAccount_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): CoreManagerAccount_payload_Inner {
    return new CoreManagerAccount_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreManagerAccount_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["account_type"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "program_meta_v1", tag: 1, payloadSize: 73 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "config_v1", tag: 2, payloadSize: 71 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "proof_slot_v1", tag: 3, payloadSize: null };
    }
    return new CoreManagerAccount_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asProgramMetaV1(): ManagedProgramMetadata | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return ManagedProgramMetadata.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asConfigV1(): CoreConfig | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return CoreConfig.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asProofSlotV1(): ProofSlot | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return ProofSlot.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class CoreManagerAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: CoreManagerAccount.Params;

  private constructor(private buffer: Uint8Array, params?: CoreManagerAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CoreManagerAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CoreManagerAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CoreManagerAccount.Params, fieldContext?: Record<string, number | bigint> }): CoreManagerAccount {
    if (!buffer || buffer.length === undefined) throw new Error("CoreManagerAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CoreManagerAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CoreManagerAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CoreManagerAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): CoreManagerAccount.Params {
    return this.__tnParams;
  }

  static builder(): CoreManagerAccountBuilder {
    return new CoreManagerAccountBuilder();
  }

  static fromBuilder(builder: CoreManagerAccountBuilder): CoreManagerAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CoreManagerAccount.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "program_meta_v1",
      tag: 1,
      payloadSize: 73,
      payloadType: "CoreManagerAccount::payload::program_meta_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ManagedProgramMetadata),
    },
    {
      name: "config_v1",
      tag: 2,
      payloadSize: 71,
      payloadType: "CoreManagerAccount::payload::config_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CoreConfig),
    },
    {
      name: "proof_slot_v1",
      tag: 3,
      payloadSize: null,
      payloadType: "CoreManagerAccount::payload::proof_slot_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ProofSlot),
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_payload_payload_size: bigint | null = null;
    let __tnFieldValue_account_type: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_account_type = view.getUint8(__tnCursorMutable);
    __tnFieldValue_account_type = __tnRead_account_type;
    __tnCursorMutable += 1;
    const __tnEnumTagValue_payload = __tnFieldValue_account_type;
    if (__tnEnumTagValue_payload === null) return null;
    let __tnEnumSize_payload = 0;
    switch (__tnToBigInt(__tnEnumTagValue_payload)) {
      case 1n: break;
      case 2n: break;
      case 3n: break;
      default: return null;
    }
    if (__tnCursorMutable > __tnLength) return null;
    __tnEnumSize_payload = __tnLength - __tnCursorMutable;
    __tnCursorMutable = __tnLength;
    __tnParamSeq_payload_payload_size = __tnToBigInt(__tnEnumSize_payload);
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_payload_payload_size === null) return null;
    params["payload_payload_size"] = __tnParamSeq_payload_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CoreManagerAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_account_type = __tnToBigInt(view.getUint8(0));
    const __tnLayout = CoreManagerAccount.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = CoreManagerAccount.Params.fromValues({
      payload_account_type: __tnParam_payload_account_type,
      payload_payload_size: __tnParamSeq_payload_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_account_type(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_account_type(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get account_type(): number {
    return this.get_account_type();
  }

  set account_type(value: number) {
    this.set_account_type(value);
  }

  payloadVariant(): typeof CoreManagerAccount.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_account_type();
    return CoreManagerAccount.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): CoreManagerAccount_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("CoreManagerAccount: unknown payload variant");
    const offset = CoreManagerAccount.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("CoreManagerAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return CoreManagerAccount_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CoreManagerAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CoreManagerAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_account_type: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = CoreManagerAccount.Params.fromValues({
      payload_account_type: payload_account_type,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CoreManagerAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.account_type"] = params.payload_account_type;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: CoreManagerAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CoreManagerAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CoreManagerAccount');
    return __tnBigIntToNumber(irResult, 'CoreManagerAccount::footprintFromParams');
  }

  static footprintFromValues(input: { payload_account_type: number | bigint, payload_payload_size: number | bigint }): number {
    const params = CoreManagerAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CoreManagerAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CoreManagerAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: CoreManagerAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CoreManagerAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CoreManagerAccount::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 1 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
let t3: number | null = null;
switch ((x2) as bigint | null) {
  case 1n: t3 = 73; break;
  case 2n: t3 = 71; break;
  case 3n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s4 = c;
const av5 = v; const ao6 = c;
if (c + 3 > b.length) return null; c += 3;
if (c + 4 > b.length) return null; const x7 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x8 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
const n9 = x7; if (n9 === null || n9 < 0n) return null;
if (BigInt(c) + n9 * 1n > BigInt(b.length)) return null; c += Number(n9 * 1n);
const n10 = x8; if (n10 === null || n10 < 0n) return null;
if (BigInt(c) + n10 * 1n > BigInt(b.length)) return null; c += Number(n10 * 1n);
void s4;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CoreManagerAccount.Params }): CoreManagerAccount | null {
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
    const state = new CoreManagerAccount(buffer, cached);
    return state;
  }


}

export namespace CoreManagerAccount {
  export type Params = {
    /** ABI path: payload.account_type */
    readonly payload_account_type: bigint;
    /** ABI path: payload.payload_size */
    readonly payload_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    payload_account_type: "payload.account_type",
    payload_payload_size: "payload.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { payload_account_type: number | bigint, payload_payload_size: number | bigint }): Params {
      return {
        payload_account_type: __tnToBigInt(input.payload_account_type),
        payload_payload_size: __tnToBigInt(input.payload_payload_size),
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

  export function params(input: { payload_account_type: number | bigint, payload_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CoreManagerAccountBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_account_type: number | null = null;
  private __tnPayload_payload: { descriptor: typeof CoreManagerAccount.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: CoreManagerAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CoreManagerAccount.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<CoreManagerAccountBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(1);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_account_type(value: number): void {
    this.__tnField_account_type = value;
    this.__tnInvalidate();
  }

  set_account_type(value: number): this {
    this.__tnAssign_account_type(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<CoreManagerAccountBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, CoreManagerAccount.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_account_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("CoreManagerAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("CoreManagerAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = CoreManagerAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("CoreManagerAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("CoreManagerAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = CoreManagerAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("CoreManagerAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CoreManagerAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CoreManagerAccount.from_array(buffer, { params });
    if (!view) throw new Error("CoreManagerAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): CoreManagerAccount {
    return this.finish();
  }

  dynamicParams(): CoreManagerAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CoreManagerAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CoreManagerAccount.Params.fromValues({
      payload_account_type: (() => { if (this.__tnField_account_type === null) throw new Error("CoreManagerAccountBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_account_type); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("CoreManagerAccountBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_account_type === null) throw new Error("CoreManagerAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("CoreManagerAccountBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_account_type);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CoreManagerAccount.Params): void {
    const result = CoreManagerAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CoreManagerAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CoreManagerAccount", (params) => CoreManagerAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("CoreManagerAccount", (buffer, params) => CoreManagerAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CoreManagerAccount", (buffer) => { const result = CoreManagerAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateEphemeralArgs ----- */

const __tn_ir_CreateEphemeralArgs = {
  typeName: "CreateEphemeralArgs",
  root: { op: "const", value: 275n }
} as const;

export class CreateEphemeralArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreateEphemeralArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateEphemeralArgs.__tnCreateView requires a Uint8Array");
    return new CreateEphemeralArgs(new Uint8Array(buffer));
  }

  static builder(): CreateEphemeralArgsBuilder {
    return new CreateEphemeralArgsBuilder();
  }

  static fromBuilder(builder: CreateEphemeralArgsBuilder): CreateEphemeralArgs | null {
    const buffer = builder.build();
    return CreateEphemeralArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_metadata(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_metadata(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get metadata(): BoundAccount {
    return this.get_metadata();
  }

  set metadata(value: BoundAccount) {
    this.set_metadata(value);
  }

  get_program(): BoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get program(): BoundAccount {
    return this.get_program();
  }

  set program(value: BoundAccount) {
    this.set_program(value);
  }

  get_seed(): number[] {
    const offset = 136;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_seed(value: number[]): void {
    const offset = 136;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get seed(): number[] {
    return this.get_seed();
  }

  set seed(value: number[]) {
    this.set_seed(value);
  }

  get_image(): ImageCommitment {
    const offset = 168;
    const slice = this.buffer.subarray(offset, offset + 74);
    return ImageCommitment.from_array(slice)!;
  }

  set_image(value: ImageCommitment): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 168;
    this.buffer.set(sourceBytes, offset);
  }

  get image(): ImageCommitment {
    return this.get_image();
  }

  set image(value: ImageCommitment) {
    this.set_image(value);
  }

  get_application_authority(): Pubkey {
    const offset = 242;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_application_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 242;
    this.buffer.set(sourceBytes, offset);
  }

  get application_authority(): Pubkey {
    return this.get_application_authority();
  }

  set application_authority(value: Pubkey) {
    this.set_application_authority(value);
  }

  get_pin(): number {
    const offset = 274;
    return this.view.getUint8(offset);
  }

  set_pin(value: number): void {
    const offset = 274;
    this.view.setUint8(offset, value);
  }

  get pin(): number {
    return this.get_pin();
  }

  set pin(value: number) {
    this.set_pin(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateEphemeralArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateEphemeralArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateEphemeralArgs');
    }
    return __tnBigIntToNumber(irResult, 'CreateEphemeralArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 275) return { ok: false, code: "tn.buffer_too_small", consumed: 275 };
    return { ok: true, consumed: 275 };
  }

  static from_array(buffer: Uint8Array): CreateEphemeralArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreateEphemeralArgs(buffer);
  }

}

export class CreateEphemeralArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(275);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("metadata expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("program expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  set_seed(values: number[]): this {
    if (values.length !== 32) throw new Error("seed expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 136 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_image(value: Uint8Array): this {
    if (value.length !== 74) throw new Error("image expects 74 bytes");
    this.buffer.set(value, 168);
    return this;
  }

  set_application_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("application_authority expects 32 bytes");
    this.buffer.set(value, 242);
    return this;
  }

  set_pin(value: number): this {
    this.view.setUint8(274, value);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CreateEphemeralArgs", CreateEphemeralArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CreateEphemeralArgs", CreateEphemeralArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CreateEphemeralArgs {
    const view = CreateEphemeralArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreateEphemeralArgs");
    return view;
  }
}

__tnRegisterFootprint("CreateEphemeralArgs", (params) => CreateEphemeralArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateEphemeralArgs", (buffer, params) => CreateEphemeralArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateEphemeralArgs", (buffer) => { const result = CreateEphemeralArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreatePermanentArgs ----- */

const __tn_ir_CreatePermanentArgs = {
  typeName: "CreatePermanentArgs",
  root: { op: "const", value: 341n }
} as const;

export class CreatePermanentArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreatePermanentArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreatePermanentArgs.__tnCreateView requires a Uint8Array");
    return new CreatePermanentArgs(new Uint8Array(buffer));
  }

  static builder(): CreatePermanentArgsBuilder {
    return new CreatePermanentArgsBuilder();
  }

  static fromBuilder(builder: CreatePermanentArgsBuilder): CreatePermanentArgs | null {
    const buffer = builder.build();
    return CreatePermanentArgs.from_array(buffer);
  }

  get_config(): BoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_config(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): BoundAccount {
    return this.get_config();
  }

  set config(value: BoundAccount) {
    this.set_config(value);
  }

  get_admin(): BoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_admin(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): BoundAccount {
    return this.get_admin();
  }

  set admin(value: BoundAccount) {
    this.set_admin(value);
  }

  get_metadata(): BoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_metadata(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get metadata(): BoundAccount {
    return this.get_metadata();
  }

  set metadata(value: BoundAccount) {
    this.set_metadata(value);
  }

  get_program(): BoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_program(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get program(): BoundAccount {
    return this.get_program();
  }

  set program(value: BoundAccount) {
    this.set_program(value);
  }

  get_seed(): number[] {
    const offset = 136;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_seed(value: number[]): void {
    const offset = 136;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get seed(): number[] {
    return this.get_seed();
  }

  set seed(value: number[]) {
    this.set_seed(value);
  }

  get_image(): ImageCommitment {
    const offset = 168;
    const slice = this.buffer.subarray(offset, offset + 74);
    return ImageCommitment.from_array(slice)!;
  }

  set_image(value: ImageCommitment): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 168;
    this.buffer.set(sourceBytes, offset);
  }

  get image(): ImageCommitment {
    return this.get_image();
  }

  set image(value: ImageCommitment) {
    this.set_image(value);
  }

  get_application_authority(): Pubkey {
    const offset = 242;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_application_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 242;
    this.buffer.set(sourceBytes, offset);
  }

  get application_authority(): Pubkey {
    return this.get_application_authority();
  }

  set application_authority(value: Pubkey) {
    this.set_application_authority(value);
  }

  get_pin(): number {
    const offset = 274;
    return this.view.getUint8(offset);
  }

  set_pin(value: number): void {
    const offset = 274;
    this.view.setUint8(offset, value);
  }

  get pin(): number {
    return this.get_pin();
  }

  set pin(value: number) {
    this.set_pin(value);
  }

  get_slot(): BoundAccount {
    const offset = 275;
    const slice = this.buffer.subarray(offset, offset + 34);
    return BoundAccount.from_array(slice)!;
  }

  set_slot(value: BoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 275;
    this.buffer.set(sourceBytes, offset);
  }

  get slot(): BoundAccount {
    return this.get_slot();
  }

  set slot(value: BoundAccount) {
    this.set_slot(value);
  }

  get_slot_seed(): number[] {
    const offset = 309;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_slot_seed(value: number[]): void {
    const offset = 309;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get slot_seed(): number[] {
    return this.get_slot_seed();
  }

  set slot_seed(value: number[]) {
    this.set_slot_seed(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreatePermanentArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreatePermanentArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreatePermanentArgs');
    }
    return __tnBigIntToNumber(irResult, 'CreatePermanentArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 341) return { ok: false, code: "tn.buffer_too_small", consumed: 341 };
    return { ok: true, consumed: 341 };
  }

  static from_array(buffer: Uint8Array): CreatePermanentArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreatePermanentArgs(buffer);
  }

}

export class CreatePermanentArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(341);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("config expects 34 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("admin expects 34 bytes");
    this.buffer.set(value, 34);
    return this;
  }

  set_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("metadata expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_program(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("program expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  set_seed(values: number[]): this {
    if (values.length !== 32) throw new Error("seed expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 136 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_image(value: Uint8Array): this {
    if (value.length !== 74) throw new Error("image expects 74 bytes");
    this.buffer.set(value, 168);
    return this;
  }

  set_application_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("application_authority expects 32 bytes");
    this.buffer.set(value, 242);
    return this;
  }

  set_pin(value: number): this {
    this.view.setUint8(274, value);
    return this;
  }

  set_slot(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("slot expects 34 bytes");
    this.buffer.set(value, 275);
    return this;
  }

  set_slot_seed(values: number[]): this {
    if (values.length !== 32) throw new Error("slot_seed expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 309 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CreatePermanentArgs", CreatePermanentArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CreatePermanentArgs", CreatePermanentArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CreatePermanentArgs {
    const view = CreatePermanentArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreatePermanentArgs");
    return view;
  }
}

__tnRegisterFootprint("CreatePermanentArgs", (params) => CreatePermanentArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreatePermanentArgs", (buffer, params) => CreatePermanentArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreatePermanentArgs", (buffer) => { const result = CreatePermanentArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CoreInstruction ----- */

const __tn_ir_CoreInstruction = {
  typeName: "CoreInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class CoreInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): CoreInstruction_payload_Inner {
    return new CoreInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CoreInstruction_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["tag"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 0)) descriptor = { name: "create_permanent", tag: 0, payloadSize: 341 };
      if (__tnTagEquals(tag, 1)) descriptor = { name: "create_ephemeral", tag: 1, payloadSize: 275 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "upgrade", tag: 2, payloadSize: 210 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "set_pause", tag: 3, payloadSize: 137 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "destroy", tag: 4, payloadSize: 136 };
      if (__tnTagEquals(tag, 5)) descriptor = { name: "finalize", tag: 5, payloadSize: 136 };
      if (__tnTagEquals(tag, 6)) descriptor = { name: "set_application_authority", tag: 6, payloadSize: 168 };
      if (__tnTagEquals(tag, 7)) descriptor = { name: "set_pin", tag: 7, payloadSize: 103 };
      if (__tnTagEquals(tag, 8)) descriptor = { name: "propose_admin", tag: 8, payloadSize: 171 };
      if (__tnTagEquals(tag, 9)) descriptor = { name: "accept_admin", tag: 9, payloadSize: 136 };
      if (__tnTagEquals(tag, 10)) descriptor = { name: "write_proof_slot", tag: 10, payloadSize: null };
      if (__tnTagEquals(tag, 11)) descriptor = { name: "upgrade_peer", tag: 11, payloadSize: 176 };
    }
    return new CoreInstruction_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreatePermanent(): CreatePermanentArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 0)) return null;
    return CreatePermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateEphemeral(): CreateEphemeralArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return CreateEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgrade(): UpgradeArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return UpgradeArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetPause(): SetPauseArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return SetPauseArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asDestroy(): PairArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return PairArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFinalize(): PairArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 5)) return null;
    return PairArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetApplicationAuthority(): SetApplicationAuthorityArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 6)) return null;
    return SetApplicationAuthorityArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetPin(): SetPinArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 7)) return null;
    return SetPinArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asProposeAdmin(): ProposeAdminArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 8)) return null;
    return ProposeAdminArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAcceptAdmin(): AcceptAdminArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 9)) return null;
    return AcceptAdminArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asWriteProofSlot(): WriteProofSlotArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 10)) return null;
    return WriteProofSlotArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgradePeer(): UpgradePeerArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 11)) return null;
    return UpgradePeerArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class CoreInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: CoreInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: CoreInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CoreInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CoreInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CoreInstruction.Params, fieldContext?: Record<string, number | bigint> }): CoreInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("CoreInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CoreInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CoreInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CoreInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): CoreInstruction.Params {
    return this.__tnParams;
  }

  static builder(): CoreInstructionBuilder {
    return new CoreInstructionBuilder();
  }

  static fromBuilder(builder: CoreInstructionBuilder): CoreInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CoreInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create_permanent",
      tag: 0,
      payloadSize: 341,
      payloadType: "CoreInstruction::payload::create_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreatePermanentArgs),
    },
    {
      name: "create_ephemeral",
      tag: 1,
      payloadSize: 275,
      payloadType: "CoreInstruction::payload::create_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateEphemeralArgs),
    },
    {
      name: "upgrade",
      tag: 2,
      payloadSize: 210,
      payloadType: "CoreInstruction::payload::upgrade",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UpgradeArgs),
    },
    {
      name: "set_pause",
      tag: 3,
      payloadSize: 137,
      payloadType: "CoreInstruction::payload::set_pause",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetPauseArgs),
    },
    {
      name: "destroy",
      tag: 4,
      payloadSize: 136,
      payloadType: "CoreInstruction::payload::destroy",
      createPayloadBuilder: () => __tnMaybeCallBuilder(PairArgs),
    },
    {
      name: "finalize",
      tag: 5,
      payloadSize: 136,
      payloadType: "CoreInstruction::payload::finalize",
      createPayloadBuilder: () => __tnMaybeCallBuilder(PairArgs),
    },
    {
      name: "set_application_authority",
      tag: 6,
      payloadSize: 168,
      payloadType: "CoreInstruction::payload::set_application_authority",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetApplicationAuthorityArgs),
    },
    {
      name: "set_pin",
      tag: 7,
      payloadSize: 103,
      payloadType: "CoreInstruction::payload::set_pin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetPinArgs),
    },
    {
      name: "propose_admin",
      tag: 8,
      payloadSize: 171,
      payloadType: "CoreInstruction::payload::propose_admin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ProposeAdminArgs),
    },
    {
      name: "accept_admin",
      tag: 9,
      payloadSize: 136,
      payloadType: "CoreInstruction::payload::accept_admin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AcceptAdminArgs),
    },
    {
      name: "write_proof_slot",
      tag: 10,
      payloadSize: null,
      payloadType: "CoreInstruction::payload::write_proof_slot",
      createPayloadBuilder: () => __tnMaybeCallBuilder(WriteProofSlotArgs),
    },
    {
      name: "upgrade_peer",
      tag: 11,
      payloadSize: 176,
      payloadType: "CoreInstruction::payload::upgrade_peer",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UpgradePeerArgs),
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_payload_payload_size: bigint | null = null;
    let __tnFieldValue_tag: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_tag = view.getUint8(__tnCursorMutable);
    __tnFieldValue_tag = __tnRead_tag;
    __tnCursorMutable += 1;
    const __tnEnumTagValue_payload = __tnFieldValue_tag;
    if (__tnEnumTagValue_payload === null) return null;
    let __tnEnumSize_payload = 0;
    switch (__tnToBigInt(__tnEnumTagValue_payload)) {
      case 0n: break;
      case 1n: break;
      case 2n: break;
      case 3n: break;
      case 4n: break;
      case 5n: break;
      case 6n: break;
      case 7n: break;
      case 8n: break;
      case 9n: break;
      case 10n: break;
      case 11n: break;
      default: return null;
    }
    if (__tnCursorMutable > __tnLength) return null;
    __tnEnumSize_payload = __tnLength - __tnCursorMutable;
    __tnCursorMutable = __tnLength;
    __tnParamSeq_payload_payload_size = __tnToBigInt(__tnEnumSize_payload);
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_payload_payload_size === null) return null;
    params["payload_payload_size"] = __tnParamSeq_payload_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CoreInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_tag = __tnToBigInt(view.getUint8(0));
    const __tnLayout = CoreInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = CoreInstruction.Params.fromValues({
      payload_payload_size: __tnParamSeq_payload_payload_size as bigint,
      payload_tag: __tnParam_payload_tag,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_tag(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_tag(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get tag(): number {
    return this.get_tag();
  }

  set tag(value: number) {
    this.set_tag(value);
  }

  payloadVariant(): typeof CoreInstruction.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_tag();
    return CoreInstruction.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): CoreInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("CoreInstruction: unknown payload variant");
    const offset = CoreInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("CoreInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return CoreInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CoreInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CoreInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_payload_size: number | bigint, payload_tag: number | bigint): bigint {
    const params = CoreInstruction.Params.fromValues({
      payload_payload_size: payload_payload_size,
      payload_tag: payload_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CoreInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.payload_size"] = params.payload_payload_size;
    record["payload.tag"] = params.payload_tag;
    return record;
  }

  static footprintIrFromParams(params: CoreInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CoreInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CoreInstruction');
    return __tnBigIntToNumber(irResult, 'CoreInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): number {
    const params = CoreInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CoreInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CoreInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: CoreInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CoreInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CoreInstruction::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 1 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
let t3: number | null = null;
switch ((x2) as bigint | null) {
  case 0n: t3 = 341; break;
  case 1n: t3 = 275; break;
  case 2n: t3 = 210; break;
  case 3n: t3 = 137; break;
  case 4n: t3 = 136; break;
  case 5n: t3 = 136; break;
  case 6n: t3 = 168; break;
  case 7n: t3 = 103; break;
  case 8n: t3 = 171; break;
  case 9n: t3 = 136; break;
  case 10n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s4 = c;
const s5 = c;
if (c + 2 > b.length) return null; const x6 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s7 = c;
const av8 = v; const ao9 = c;
if (c + 32 > b.length) return null; c += 32;
void s7;
void s5;
const av10 = v; const ao11 = c;
if (c + 32 > b.length) return null; c += 32;
if (c + 4 > b.length) return null; const x12 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x13 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
const n14 = x12; if (n14 === null || n14 < 0n) return null;
if (BigInt(c) + n14 * 1n > BigInt(b.length)) return null; c += Number(n14 * 1n);
const n15 = x13; if (n15 === null || n15 < 0n) return null;
if (BigInt(c) + n15 * 1n > BigInt(b.length)) return null; c += Number(n15 * 1n);
void s4;
return c; })(b.subarray(c)); break;
  case 11n: t3 = 176; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CoreInstruction.Params }): CoreInstruction | null {
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
    const state = new CoreInstruction(buffer, cached);
    return state;
  }


}

export namespace CoreInstruction {
  export type Params = {
    /** ABI path: payload.payload_size */
    readonly payload_payload_size: bigint;
    /** ABI path: payload.tag */
    readonly payload_tag: bigint;
  };

  export const ParamKeys = Object.freeze({
    payload_payload_size: "payload.payload_size",
    payload_tag: "payload.tag",
  } as const);

  export const Params = {
    fromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): Params {
      return {
        payload_payload_size: __tnToBigInt(input.payload_payload_size),
        payload_tag: __tnToBigInt(input.payload_tag),
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

  export function params(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CoreInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof CoreInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: CoreInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CoreInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<CoreInstructionBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(1);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_tag(value: number): void {
    this.__tnField_tag = value;
    this.__tnInvalidate();
  }

  set_tag(value: number): this {
    this.__tnAssign_tag(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<CoreInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, CoreInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("CoreInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("CoreInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = CoreInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("CoreInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("CoreInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = CoreInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("CoreInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CoreInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CoreInstruction.from_array(buffer, { params });
    if (!view) throw new Error("CoreInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): CoreInstruction {
    return this.finish();
  }

  dynamicParams(): CoreInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CoreInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CoreInstruction.Params.fromValues({
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("CoreInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
      payload_tag: (() => { if (this.__tnField_tag === null) throw new Error("CoreInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_tag === null) throw new Error("CoreInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("CoreInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_tag);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CoreInstruction.Params): void {
    const result = CoreInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CoreInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CoreInstruction", (params) => CoreInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("CoreInstruction", (buffer, params) => CoreInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CoreInstruction", (buffer) => { const result = CoreInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
