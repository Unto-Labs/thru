/* Auto-generated TypeScript code */
/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */

import { Hash, Pubkey } from "../../common/primitives/types";

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

__tnRegisterFootprint("Hash", (params) => Hash.__tnInvokeFootprint(params));
__tnRegisterValidate("Hash", (buffer, params) => Hash.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("Hash", (buffer) => { const result = Hash.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

__tnRegisterFootprint("Pubkey", (params) => Pubkey.__tnInvokeFootprint(params));
__tnRegisterValidate("Pubkey", (buffer, params) => Pubkey.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("Pubkey", (buffer) => { const result = Pubkey.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateRequestArgs ----- */

const __tn_ir_CreateRequestArgs = {
  typeName: "CreateRequestArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "request_data.request_data_sz" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateRequestArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateRequestArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateRequestArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateRequestArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateRequestArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateRequestArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateRequestArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateRequestArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateRequestArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateRequestArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateRequestArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateRequestArgs.Params {
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
    throw new Error("CreateRequestArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateRequestArgs::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("CreateRequestArgs: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateRequestArgsBuilder {
    return new CreateRequestArgsBuilder();
  }

  static fromBuilder(builder: CreateRequestArgsBuilder): CreateRequestArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateRequestArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "request_data", method: "request_data", sizeField: "request_data_sz", paramKey: "request_data_sz", elementSize: 1 },
    { field: "proof", method: "proof", sizeField: "proof_sz", paramKey: "proof_sz", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_multisig_account_idx: number | null = null;
    let __tnFieldValue_request_account_idx: number | null = null;
    let __tnFieldValue_proposer_account_idx: number | null = null;
    let __tnFieldValue_request_kind: number | null = null;
    let __tnFieldValue_reserved0: number | null = null;
    let __tnFieldValue_request_data_sz: bigint | null = null;
    let __tnFieldValue_proof_sz: bigint | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_multisig_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_multisig_account_idx = __tnRead_multisig_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_request_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_request_account_idx = __tnRead_request_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_proposer_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_proposer_account_idx = __tnRead_proposer_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_request_kind = view.getUint8(__tnCursorMutable);
    __tnFieldValue_request_kind = __tnRead_request_kind;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_reserved0 = view.getUint8(__tnCursorMutable);
    __tnFieldValue_reserved0 = __tnRead_reserved0;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_request_data_sz = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_request_data_sz = __tnRead_request_data_sz;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_proof_sz = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_proof_sz = __tnRead_proof_sz;
    __tnCursorMutable += 8;
    if (__tnFieldValue_request_data_sz === null) return null;
    const __tnArrayCount_request_data = __tnU64(__tnToBigInt(__tnFieldValue_request_data_sz as number | bigint));
    if (__tnArrayCount_request_data === null) return null;
    const __tnArrayBytesBig_request_data = __tnArrayCount_request_data * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_request_data > BigInt(__tnLength)) return null;
    const __tnArrayBytes_request_data = Number(__tnArrayBytesBig_request_data);
    if (__tnCursorMutable + __tnArrayBytes_request_data > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_request_data;
    if (__tnFieldValue_proof_sz === null) return null;
    const __tnArrayCount_proof = __tnU64(__tnToBigInt(__tnFieldValue_proof_sz as number | bigint));
    if (__tnArrayCount_proof === null) return null;
    const __tnArrayBytesBig_proof = __tnArrayCount_proof * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_proof > BigInt(__tnLength)) return null;
    const __tnArrayBytes_proof = Number(__tnArrayBytesBig_proof);
    offsets["proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateRequestArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 56) {
      return null;
    }
    const __tnParam_proof_proof_sz = __tnToBigInt(view.getBigUint64(48, true));
    if (buffer.length < 48) {
      return null;
    }
    const __tnParam_request_data_request_data_sz = __tnToBigInt(view.getBigUint64(40, true));
    const __tnExtractedParams = CreateRequestArgs.Params.fromValues({
      proof_proof_sz: __tnParam_proof_proof_sz,
      request_data_request_data_sz: __tnParam_request_data_request_data_sz,
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
      throw new Error("CreateRequestArgs: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = CreateRequestArgs.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("CreateRequestArgs: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_multisig_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_multisig_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get multisig_account_idx(): number {
    return this.get_multisig_account_idx();
  }

  set multisig_account_idx(value: number) {
    this.set_multisig_account_idx(value);
  }

  get_request_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_request_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get request_account_idx(): number {
    return this.get_request_account_idx();
  }

  set request_account_idx(value: number) {
    this.set_request_account_idx(value);
  }

  get_proposer_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_proposer_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get proposer_account_idx(): number {
    return this.get_proposer_account_idx();
  }

  set proposer_account_idx(value: number) {
    this.set_proposer_account_idx(value);
  }

  get_request_kind(): number {
    const offset = 6;
    return this.view.getUint8(offset);
  }

  set_request_kind(value: number): void {
    const offset = 6;
    this.view.setUint8(offset, value);
  }

  get request_kind(): number {
    return this.get_request_kind();
  }

  set request_kind(value: number) {
    this.set_request_kind(value);
  }

  get_reserved0(): number {
    const offset = 7;
    return this.view.getUint8(offset);
  }

  set_reserved0(value: number): void {
    const offset = 7;
    this.view.setUint8(offset, value);
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_seed(): number[] {
    const offset = 8;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_seed(value: number[]): void {
    const offset = 8;
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

  get_request_data_sz(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_request_data_sz(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get request_data_sz(): bigint {
    return this.get_request_data_sz();
  }

  set request_data_sz(value: bigint) {
    this.set_request_data_sz(value);
  }

  get_proof_sz(): bigint {
    const offset = 48;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_proof_sz(value: bigint): void {
    const offset = 48;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get proof_sz(): bigint {
    return this.get_proof_sz();
  }

  set proof_sz(value: bigint) {
    this.set_proof_sz(value);
  }

  get_request_data_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("request_data_sz"));
  }

  get_request_data_at(index: number): number {
    const offset = 56;
    return this.view.getUint8(offset + index * 1);
  }

  get_request_data(): number[] {
    const len = this.get_request_data_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_request_data_at(i));
    }
    return result;
  }

  set_request_data_at(index: number, value: number): void {
    const offset = 56;
    this.view.setUint8((offset + index * 1), value);
  }

  set_request_data(value: number[]): void {
    const len = Math.min(this.get_request_data_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_request_data_at(i, value[i]);
    }
  }

  get request_data(): number[] {
    return this.get_request_data();
  }

  set request_data(value: number[]) {
    this.set_request_data(value);
  }

  get_proof_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("proof_sz"));
  }

  get_proof_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("proof");
    return this.view.getUint8(offset + index * 1);
  }

  get_proof(): number[] {
    const len = this.get_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_at(i));
    }
    return result;
  }

  set_proof_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("proof");
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof(value: number[]): void {
    const len = Math.min(this.get_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_at(i, value[i]);
    }
  }

  get proof(): number[] {
    return this.get_proof();
  }

  set proof(value: number[]) {
    this.set_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateRequestArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateRequestArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_sz: number | bigint, request_data_request_data_sz: number | bigint): bigint {
    const params = CreateRequestArgs.Params.fromValues({
      proof_proof_sz: proof_proof_sz,
      request_data_request_data_sz: request_data_request_data_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateRequestArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_sz"] = params.proof_proof_sz;
    record["request_data.request_data_sz"] = params.request_data_request_data_sz;
    return record;
  }

  static footprintIrFromParams(params: CreateRequestArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateRequestArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateRequestArgs');
    return __tnBigIntToNumber(irResult, 'CreateRequestArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_sz: number | bigint, request_data_request_data_sz: number | bigint }): number {
    const params = CreateRequestArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateRequestArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateRequestArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateRequestArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateRequestArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateRequestArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateRequestArgs.Params }): CreateRequestArgs | null {
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
    const state = new CreateRequestArgs(buffer, cached);
    return state;
  }


}

export namespace CreateRequestArgs {
  export type Params = {
    /** ABI path: proof.proof_sz */
    readonly proof_proof_sz: bigint;
    /** ABI path: request_data.request_data_sz */
    readonly request_data_request_data_sz: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_proof_sz: "proof.proof_sz",
    request_data_request_data_sz: "request_data.request_data_sz",
  } as const);

  export const Params = {
    fromValues(input: { proof_proof_sz: number | bigint, request_data_request_data_sz: number | bigint }): Params {
      return {
        proof_proof_sz: __tnToBigInt(input.proof_proof_sz),
        request_data_request_data_sz: __tnToBigInt(input.request_data_request_data_sz),
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

  export function params(input: { proof_proof_sz: number | bigint, request_data_request_data_sz: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateRequestArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateRequestArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateRequestArgs.Params | null = null;
  private __tnFam_request_data: Uint8Array | null = null;
  private __tnFam_request_dataCount: number | null = null;
  private __tnFamWriter_request_data?: __TnFamWriterResult<CreateRequestArgsBuilder>;
  private __tnFam_proof: Uint8Array | null = null;
  private __tnFam_proofCount: number | null = null;
  private __tnFamWriter_proof?: __TnFamWriterResult<CreateRequestArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(56);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_multisig_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_request_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proposer_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_request_kind(value: number): this {
    this.view.setUint8(6, value);
    this.__tnInvalidate();
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint8(7, value);
    this.__tnInvalidate();
    return this;
  }

  set_seed(values: number[]): this {
    if (values.length !== 32) throw new Error("seed expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 8 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_request_data_sz(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(48, cast, true);
    this.__tnInvalidate();
    return this;
  }

  request_data(): __TnFamWriterResult<CreateRequestArgsBuilder> {
    if (!this.__tnFamWriter_request_data) {
      this.__tnFamWriter_request_data = __tnCreateFamWriter(this, "request_data", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_request_data = bytes;
        this.__tnFam_request_dataCount = elementCount;
        this.set_request_data_sz(__tnToBigInt(elementCount));
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_request_data!;
  }

  proof(): __TnFamWriterResult<CreateRequestArgsBuilder> {
    if (!this.__tnFamWriter_proof) {
      this.__tnFamWriter_proof = __tnCreateFamWriter(this, "proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof = bytes;
        this.__tnFam_proofCount = elementCount;
        this.set_proof_sz(__tnToBigInt(elementCount));
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof!;
  }

  private __tnSyncLengths(): void {
    if (this.__tnFam_request_dataCount !== null) this.set_request_data_sz(__tnToBigInt(this.__tnFam_request_dataCount));
    if (this.__tnFam_proofCount !== null) this.set_proof_sz(__tnToBigInt(this.__tnFam_proofCount));
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = CreateRequestArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = CreateRequestArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateRequestArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateRequestArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateRequestArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateRequestArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateRequestArgs {
    return this.finish();
  }

  dynamicParams(): CreateRequestArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateRequestArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateRequestArgs.Params.fromValues({
      proof_proof_sz: (() => { if (this.__tnFam_proofCount === null) throw new Error("CreateRequestArgsBuilder: field 'proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_proofCount); })(),
      request_data_request_data_sz: (() => { if (this.__tnFam_request_dataCount === null) throw new Error("CreateRequestArgsBuilder: field 'request_data' must be written before computing params"); return __tnToBigInt(this.__tnFam_request_dataCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_request_data_bytes = this.__tnFam_request_data;
    if (!__tnLocal_request_data_bytes) throw new Error("CreateRequestArgsBuilder: field 'request_data' must be written before build");
    target.set(__tnLocal_request_data_bytes, cursor);
    cursor += __tnLocal_request_data_bytes.length;
    const __tnLocal_proof_bytes = this.__tnFam_proof;
    if (!__tnLocal_proof_bytes) throw new Error("CreateRequestArgsBuilder: field 'proof' must be written before build");
    target.set(__tnLocal_proof_bytes, cursor);
    cursor += __tnLocal_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateRequestArgs.Params): void {
    const result = CreateRequestArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateRequestArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateRequestArgs", (params) => CreateRequestArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateRequestArgs", (buffer, params) => CreateRequestArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateRequestArgs", (buffer) => { const result = CreateRequestArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR DeleteMultisigRequest ----- */

const __tn_ir_DeleteMultisigRequest = {
  typeName: "DeleteMultisigRequest",
  root: { op: "const", value: 0n }
} as const;

export class DeleteMultisigRequest {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): DeleteMultisigRequest {
    if (!buffer || buffer.length === undefined) throw new Error("DeleteMultisigRequest.__tnCreateView requires a Uint8Array");
    return new DeleteMultisigRequest(new Uint8Array(buffer));
  }

  static builder(): DeleteMultisigRequestBuilder {
    return new DeleteMultisigRequestBuilder();
  }

  static fromBuilder(builder: DeleteMultisigRequestBuilder): DeleteMultisigRequest | null {
    const buffer = builder.build();
    return DeleteMultisigRequest.from_array(buffer);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_DeleteMultisigRequest.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_DeleteMultisigRequest, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for DeleteMultisigRequest');
    }
    return __tnBigIntToNumber(irResult, 'DeleteMultisigRequest::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 0) return { ok: false, code: "tn.buffer_too_small", consumed: 0 };
    return { ok: true, consumed: 0 };
  }

  static new(): DeleteMultisigRequest {
    const buffer = new Uint8Array(0);
    const view = new DataView(buffer.buffer);

    let offset = 0;

    return new DeleteMultisigRequest(buffer);
  }

  static from_array(buffer: Uint8Array): DeleteMultisigRequest | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new DeleteMultisigRequest(buffer);
  }

}

export class DeleteMultisigRequestBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(0);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("DeleteMultisigRequest", DeleteMultisigRequest.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("DeleteMultisigRequest", DeleteMultisigRequest.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): DeleteMultisigRequest {
    const view = DeleteMultisigRequest.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build DeleteMultisigRequest");
    return view;
  }
}

__tnRegisterFootprint("DeleteMultisigRequest", (params) => DeleteMultisigRequest.__tnInvokeFootprint(params));
__tnRegisterValidate("DeleteMultisigRequest", (buffer, params) => DeleteMultisigRequest.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("DeleteMultisigRequest", (buffer) => { const result = DeleteMultisigRequest.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR DeleteRequestArgs ----- */

const __tn_ir_DeleteRequestArgs = {
  typeName: "DeleteRequestArgs",
  root: { op: "const", value: 6n }
} as const;

export class DeleteRequestArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): DeleteRequestArgs {
    if (!buffer || buffer.length === undefined) throw new Error("DeleteRequestArgs.__tnCreateView requires a Uint8Array");
    return new DeleteRequestArgs(new Uint8Array(buffer));
  }

  static builder(): DeleteRequestArgsBuilder {
    return new DeleteRequestArgsBuilder();
  }

  static fromBuilder(builder: DeleteRequestArgsBuilder): DeleteRequestArgs | null {
    const buffer = builder.build();
    return DeleteRequestArgs.from_array(buffer);
  }

  get_multisig_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_multisig_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get multisig_account_idx(): number {
    return this.get_multisig_account_idx();
  }

  set multisig_account_idx(value: number) {
    this.set_multisig_account_idx(value);
  }

  get_request_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_request_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get request_account_idx(): number {
    return this.get_request_account_idx();
  }

  set request_account_idx(value: number) {
    this.set_request_account_idx(value);
  }

  get_requester_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_requester_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get requester_account_idx(): number {
    return this.get_requester_account_idx();
  }

  set requester_account_idx(value: number) {
    this.set_requester_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_DeleteRequestArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_DeleteRequestArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for DeleteRequestArgs');
    }
    return __tnBigIntToNumber(irResult, 'DeleteRequestArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(multisig_account_idx: number, request_account_idx: number, requester_account_idx: number): DeleteRequestArgs {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, multisig_account_idx, true); /* multisig_account_idx (little-endian) */
    view.setUint16(2, request_account_idx, true); /* request_account_idx (little-endian) */
    view.setUint16(4, requester_account_idx, true); /* requester_account_idx (little-endian) */

    return new DeleteRequestArgs(buffer);
  }

  static from_array(buffer: Uint8Array): DeleteRequestArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new DeleteRequestArgs(buffer);
  }

}

export class DeleteRequestArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_multisig_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_request_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_requester_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("DeleteRequestArgs", DeleteRequestArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("DeleteRequestArgs", DeleteRequestArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): DeleteRequestArgs {
    const view = DeleteRequestArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build DeleteRequestArgs");
    return view;
  }
}

__tnRegisterFootprint("DeleteRequestArgs", (params) => DeleteRequestArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("DeleteRequestArgs", (buffer, params) => DeleteRequestArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("DeleteRequestArgs", (buffer) => { const result = DeleteRequestArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExecuteRequestArgs ----- */

const __tn_ir_ExecuteRequestArgs = {
  typeName: "ExecuteRequestArgs",
  root: { op: "const", value: 4n }
} as const;

export class ExecuteRequestArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExecuteRequestArgs {
    if (!buffer || buffer.length === undefined) throw new Error("ExecuteRequestArgs.__tnCreateView requires a Uint8Array");
    return new ExecuteRequestArgs(new Uint8Array(buffer));
  }

  static builder(): ExecuteRequestArgsBuilder {
    return new ExecuteRequestArgsBuilder();
  }

  static fromBuilder(builder: ExecuteRequestArgsBuilder): ExecuteRequestArgs | null {
    const buffer = builder.build();
    return ExecuteRequestArgs.from_array(buffer);
  }

  get_multisig_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_multisig_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get multisig_account_idx(): number {
    return this.get_multisig_account_idx();
  }

  set multisig_account_idx(value: number) {
    this.set_multisig_account_idx(value);
  }

  get_request_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_request_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get request_account_idx(): number {
    return this.get_request_account_idx();
  }

  set request_account_idx(value: number) {
    this.set_request_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ExecuteRequestArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExecuteRequestArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExecuteRequestArgs');
    }
    return __tnBigIntToNumber(irResult, 'ExecuteRequestArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 4) return { ok: false, code: "tn.buffer_too_small", consumed: 4 };
    return { ok: true, consumed: 4 };
  }

  static new(multisig_account_idx: number, request_account_idx: number): ExecuteRequestArgs {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, multisig_account_idx, true); /* multisig_account_idx (little-endian) */
    view.setUint16(2, request_account_idx, true); /* request_account_idx (little-endian) */

    return new ExecuteRequestArgs(buffer);
  }

  static from_array(buffer: Uint8Array): ExecuteRequestArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExecuteRequestArgs(buffer);
  }

}

export class ExecuteRequestArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(4);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_multisig_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_request_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("ExecuteRequestArgs", ExecuteRequestArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("ExecuteRequestArgs", ExecuteRequestArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ExecuteRequestArgs {
    const view = ExecuteRequestArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExecuteRequestArgs");
    return view;
  }
}

__tnRegisterFootprint("ExecuteRequestArgs", (params) => ExecuteRequestArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("ExecuteRequestArgs", (buffer, params) => ExecuteRequestArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExecuteRequestArgs", (buffer) => { const result = ExecuteRequestArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MultisigError ----- */

const __tn_ir_MultisigError = {
  typeName: "MultisigError",
  root: { op: "const", value: 8n }
} as const;

export class MultisigError_error_invalid_instruction_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_invalid_instruction_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_invalid_instruction_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_invalid_instruction_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_invalid_account_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_invalid_account_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_invalid_account_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_invalid_account_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_invalid_state_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_invalid_state_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_invalid_state_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_invalid_state_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_unauthorized_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_unauthorized_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_unauthorized_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_unauthorized_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_account_create_failed_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_account_create_failed_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_account_create_failed_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_account_create_failed_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_account_resize_failed_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_account_resize_failed_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_account_resize_failed_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_account_resize_failed_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_account_write_failed_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_account_write_failed_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_account_write_failed_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_account_write_failed_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_invalid_member_count_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_invalid_member_count_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_invalid_member_count_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_invalid_member_count_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_invalid_threshold_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_invalid_threshold_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_invalid_threshold_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_invalid_threshold_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_duplicate_member_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_duplicate_member_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_duplicate_member_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_duplicate_member_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_not_a_member_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_not_a_member_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_not_a_member_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_not_a_member_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_duplicate_approval_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_duplicate_approval_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_duplicate_approval_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_duplicate_approval_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_request_stale_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_request_stale_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_request_stale_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_request_stale_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_request_not_open_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_request_not_open_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_request_not_open_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_request_not_open_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_request_not_approved_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_request_not_approved_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_request_not_approved_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_request_not_approved_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_invalid_request_kind_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_invalid_request_kind_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_invalid_request_kind_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_invalid_request_kind_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_invalid_request_data_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_invalid_request_data_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_invalid_request_data_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_invalid_request_data_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_request_too_large_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_request_too_large_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_request_too_large_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_request_too_large_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_cpi_failed_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_cpi_failed_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_cpi_failed_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_cpi_failed_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_request_not_deletable_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_request_not_deletable_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_request_not_deletable_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_request_not_deletable_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_outstanding_requests_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_outstanding_requests_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_outstanding_requests_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_outstanding_requests_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_too_many_requests_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_too_many_requests_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_too_many_requests_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_too_many_requests_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_request_mismatch_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_request_mismatch_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError_error_request_mismatch_Inner.__tnCreateView requires a Uint8Array");
    return new MultisigError_error_request_mismatch_Inner(new Uint8Array(buffer));
  }

}

export class MultisigError_error_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): MultisigError_error_Inner {
    return new MultisigError_error_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError_error_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["code"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "invalid_instruction", tag: 1, payloadSize: 0 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "invalid_account", tag: 2, payloadSize: 0 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "invalid_state", tag: 3, payloadSize: 0 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "unauthorized", tag: 4, payloadSize: 0 };
      if (__tnTagEquals(tag, 5)) descriptor = { name: "account_create_failed", tag: 5, payloadSize: 0 };
      if (__tnTagEquals(tag, 6)) descriptor = { name: "account_resize_failed", tag: 6, payloadSize: 0 };
      if (__tnTagEquals(tag, 7)) descriptor = { name: "account_write_failed", tag: 7, payloadSize: 0 };
      if (__tnTagEquals(tag, 8)) descriptor = { name: "invalid_member_count", tag: 8, payloadSize: 0 };
      if (__tnTagEquals(tag, 9)) descriptor = { name: "invalid_threshold", tag: 9, payloadSize: 0 };
      if (__tnTagEquals(tag, 10)) descriptor = { name: "duplicate_member", tag: 10, payloadSize: 0 };
      if (__tnTagEquals(tag, 11)) descriptor = { name: "not_a_member", tag: 11, payloadSize: 0 };
      if (__tnTagEquals(tag, 12)) descriptor = { name: "duplicate_approval", tag: 12, payloadSize: 0 };
      if (__tnTagEquals(tag, 13)) descriptor = { name: "request_stale", tag: 13, payloadSize: 0 };
      if (__tnTagEquals(tag, 14)) descriptor = { name: "request_not_open", tag: 14, payloadSize: 0 };
      if (__tnTagEquals(tag, 15)) descriptor = { name: "request_not_approved", tag: 15, payloadSize: 0 };
      if (__tnTagEquals(tag, 16)) descriptor = { name: "invalid_request_kind", tag: 16, payloadSize: 0 };
      if (__tnTagEquals(tag, 17)) descriptor = { name: "invalid_request_data", tag: 17, payloadSize: 0 };
      if (__tnTagEquals(tag, 18)) descriptor = { name: "request_too_large", tag: 18, payloadSize: 0 };
      if (__tnTagEquals(tag, 19)) descriptor = { name: "cpi_failed", tag: 19, payloadSize: 0 };
      if (__tnTagEquals(tag, 20)) descriptor = { name: "request_not_deletable", tag: 20, payloadSize: 0 };
      if (__tnTagEquals(tag, 21)) descriptor = { name: "outstanding_requests", tag: 21, payloadSize: 0 };
      if (__tnTagEquals(tag, 22)) descriptor = { name: "too_many_requests", tag: 22, payloadSize: 0 };
      if (__tnTagEquals(tag, 23)) descriptor = { name: "request_mismatch", tag: 23, payloadSize: 0 };
    }
    return new MultisigError_error_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInvalidInstruction(): MultisigError_error_invalid_instruction_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return MultisigError_error_invalid_instruction_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidAccount(): MultisigError_error_invalid_account_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return MultisigError_error_invalid_account_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidState(): MultisigError_error_invalid_state_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return MultisigError_error_invalid_state_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUnauthorized(): MultisigError_error_unauthorized_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return MultisigError_error_unauthorized_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccountCreateFailed(): MultisigError_error_account_create_failed_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 5)) return null;
    return MultisigError_error_account_create_failed_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccountResizeFailed(): MultisigError_error_account_resize_failed_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 6)) return null;
    return MultisigError_error_account_resize_failed_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccountWriteFailed(): MultisigError_error_account_write_failed_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 7)) return null;
    return MultisigError_error_account_write_failed_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidMemberCount(): MultisigError_error_invalid_member_count_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 8)) return null;
    return MultisigError_error_invalid_member_count_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidThreshold(): MultisigError_error_invalid_threshold_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 9)) return null;
    return MultisigError_error_invalid_threshold_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asDuplicateMember(): MultisigError_error_duplicate_member_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 10)) return null;
    return MultisigError_error_duplicate_member_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asNotAMember(): MultisigError_error_not_a_member_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 11)) return null;
    return MultisigError_error_not_a_member_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asDuplicateApproval(): MultisigError_error_duplicate_approval_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 12)) return null;
    return MultisigError_error_duplicate_approval_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRequestStale(): MultisigError_error_request_stale_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 13)) return null;
    return MultisigError_error_request_stale_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRequestNotOpen(): MultisigError_error_request_not_open_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 14)) return null;
    return MultisigError_error_request_not_open_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRequestNotApproved(): MultisigError_error_request_not_approved_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 15)) return null;
    return MultisigError_error_request_not_approved_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidRequestKind(): MultisigError_error_invalid_request_kind_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 16)) return null;
    return MultisigError_error_invalid_request_kind_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidRequestData(): MultisigError_error_invalid_request_data_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 17)) return null;
    return MultisigError_error_invalid_request_data_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRequestTooLarge(): MultisigError_error_request_too_large_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 18)) return null;
    return MultisigError_error_request_too_large_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCpiFailed(): MultisigError_error_cpi_failed_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 19)) return null;
    return MultisigError_error_cpi_failed_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRequestNotDeletable(): MultisigError_error_request_not_deletable_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 20)) return null;
    return MultisigError_error_request_not_deletable_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOutstandingRequests(): MultisigError_error_outstanding_requests_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 21)) return null;
    return MultisigError_error_outstanding_requests_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTooManyRequests(): MultisigError_error_too_many_requests_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 22)) return null;
    return MultisigError_error_too_many_requests_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRequestMismatch(): MultisigError_error_request_mismatch_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 23)) return null;
    return MultisigError_error_request_mismatch_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class MultisigError {
  private view: DataView;
  private static readonly __tnFieldOffset_error = 8;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigError {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigError.__tnCreateView requires a Uint8Array");
    return new MultisigError(new Uint8Array(buffer));
  }

  static builder(): MultisigErrorBuilder {
    return new MultisigErrorBuilder();
  }

  static fromBuilder(builder: MultisigErrorBuilder): MultisigError | null {
    const buffer = builder.build();
    return MultisigError.from_array(buffer);
  }

  static readonly errorVariantDescriptors = Object.freeze([
    {
      name: "invalid_instruction",
      tag: 1,
      payloadSize: 0,
      payloadType: "MultisigError::error::invalid_instruction",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_account",
      tag: 2,
      payloadSize: 0,
      payloadType: "MultisigError::error::invalid_account",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_state",
      tag: 3,
      payloadSize: 0,
      payloadType: "MultisigError::error::invalid_state",
      createPayloadBuilder: () => null,
    },
    {
      name: "unauthorized",
      tag: 4,
      payloadSize: 0,
      payloadType: "MultisigError::error::unauthorized",
      createPayloadBuilder: () => null,
    },
    {
      name: "account_create_failed",
      tag: 5,
      payloadSize: 0,
      payloadType: "MultisigError::error::account_create_failed",
      createPayloadBuilder: () => null,
    },
    {
      name: "account_resize_failed",
      tag: 6,
      payloadSize: 0,
      payloadType: "MultisigError::error::account_resize_failed",
      createPayloadBuilder: () => null,
    },
    {
      name: "account_write_failed",
      tag: 7,
      payloadSize: 0,
      payloadType: "MultisigError::error::account_write_failed",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_member_count",
      tag: 8,
      payloadSize: 0,
      payloadType: "MultisigError::error::invalid_member_count",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_threshold",
      tag: 9,
      payloadSize: 0,
      payloadType: "MultisigError::error::invalid_threshold",
      createPayloadBuilder: () => null,
    },
    {
      name: "duplicate_member",
      tag: 10,
      payloadSize: 0,
      payloadType: "MultisigError::error::duplicate_member",
      createPayloadBuilder: () => null,
    },
    {
      name: "not_a_member",
      tag: 11,
      payloadSize: 0,
      payloadType: "MultisigError::error::not_a_member",
      createPayloadBuilder: () => null,
    },
    {
      name: "duplicate_approval",
      tag: 12,
      payloadSize: 0,
      payloadType: "MultisigError::error::duplicate_approval",
      createPayloadBuilder: () => null,
    },
    {
      name: "request_stale",
      tag: 13,
      payloadSize: 0,
      payloadType: "MultisigError::error::request_stale",
      createPayloadBuilder: () => null,
    },
    {
      name: "request_not_open",
      tag: 14,
      payloadSize: 0,
      payloadType: "MultisigError::error::request_not_open",
      createPayloadBuilder: () => null,
    },
    {
      name: "request_not_approved",
      tag: 15,
      payloadSize: 0,
      payloadType: "MultisigError::error::request_not_approved",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_request_kind",
      tag: 16,
      payloadSize: 0,
      payloadType: "MultisigError::error::invalid_request_kind",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_request_data",
      tag: 17,
      payloadSize: 0,
      payloadType: "MultisigError::error::invalid_request_data",
      createPayloadBuilder: () => null,
    },
    {
      name: "request_too_large",
      tag: 18,
      payloadSize: 0,
      payloadType: "MultisigError::error::request_too_large",
      createPayloadBuilder: () => null,
    },
    {
      name: "cpi_failed",
      tag: 19,
      payloadSize: 0,
      payloadType: "MultisigError::error::cpi_failed",
      createPayloadBuilder: () => null,
    },
    {
      name: "request_not_deletable",
      tag: 20,
      payloadSize: 0,
      payloadType: "MultisigError::error::request_not_deletable",
      createPayloadBuilder: () => null,
    },
    {
      name: "outstanding_requests",
      tag: 21,
      payloadSize: 0,
      payloadType: "MultisigError::error::outstanding_requests",
      createPayloadBuilder: () => null,
    },
    {
      name: "too_many_requests",
      tag: 22,
      payloadSize: 0,
      payloadType: "MultisigError::error::too_many_requests",
      createPayloadBuilder: () => null,
    },
    {
      name: "request_mismatch",
      tag: 23,
      payloadSize: 0,
      payloadType: "MultisigError::error::request_mismatch",
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

  errorVariant(): typeof MultisigError.errorVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_code();
    return MultisigError.errorVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  error(): MultisigError_error_Inner {
    const descriptor = this.errorVariant();
    if (!descriptor) throw new Error("MultisigError: unknown error variant");
    const offset = MultisigError.__tnFieldOffset_error;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("MultisigError: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return MultisigError_error_Inner.__tnCreate(slice, descriptor, undefined);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MultisigError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MultisigError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MultisigError');
    }
    return __tnBigIntToNumber(irResult, 'MultisigError::footprint');
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
  case 3n: t3 = 0; break;
  case 4n: t3 = 0; break;
  case 5n: t3 = 0; break;
  case 6n: t3 = 0; break;
  case 7n: t3 = 0; break;
  case 8n: t3 = 0; break;
  case 9n: t3 = 0; break;
  case 10n: t3 = 0; break;
  case 11n: t3 = 0; break;
  case 12n: t3 = 0; break;
  case 13n: t3 = 0; break;
  case 14n: t3 = 0; break;
  case 15n: t3 = 0; break;
  case 16n: t3 = 0; break;
  case 17n: t3 = 0; break;
  case 18n: t3 = 0; break;
  case 19n: t3 = 0; break;
  case 20n: t3 = 0; break;
  case 21n: t3 = 0; break;
  case 22n: t3 = 0; break;
  case 23n: t3 = 0; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array): MultisigError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MultisigError(buffer);
  }

}

export class MultisigErrorBuilder {
  private tag: number | null = null;
  private payload: Uint8Array | null = null;

  constructor() {}

  select_invalid_instruction(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_instruction expects 0 bytes");
    this.tag = 1;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_account(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_account expects 0 bytes");
    this.tag = 2;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_state(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_state expects 0 bytes");
    this.tag = 3;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_unauthorized(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_unauthorized expects 0 bytes");
    this.tag = 4;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account_create_failed(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account_create_failed expects 0 bytes");
    this.tag = 5;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account_resize_failed(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account_resize_failed expects 0 bytes");
    this.tag = 6;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account_write_failed(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account_write_failed expects 0 bytes");
    this.tag = 7;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_member_count(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_member_count expects 0 bytes");
    this.tag = 8;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_threshold(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_threshold expects 0 bytes");
    this.tag = 9;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_duplicate_member(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_duplicate_member expects 0 bytes");
    this.tag = 10;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_not_a_member(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_not_a_member expects 0 bytes");
    this.tag = 11;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_duplicate_approval(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_duplicate_approval expects 0 bytes");
    this.tag = 12;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_request_stale(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_request_stale expects 0 bytes");
    this.tag = 13;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_request_not_open(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_request_not_open expects 0 bytes");
    this.tag = 14;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_request_not_approved(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_request_not_approved expects 0 bytes");
    this.tag = 15;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_request_kind(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_request_kind expects 0 bytes");
    this.tag = 16;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_request_data(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_request_data expects 0 bytes");
    this.tag = 17;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_request_too_large(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_request_too_large expects 0 bytes");
    this.tag = 18;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_cpi_failed(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_cpi_failed expects 0 bytes");
    this.tag = 19;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_request_not_deletable(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_request_not_deletable expects 0 bytes");
    this.tag = 20;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_outstanding_requests(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_outstanding_requests expects 0 bytes");
    this.tag = 21;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_too_many_requests(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_too_many_requests expects 0 bytes");
    this.tag = 22;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_request_mismatch(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_request_mismatch expects 0 bytes");
    this.tag = 23;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  build(): Uint8Array {
    if (this.tag === null || !this.payload) throw new Error("MultisigError builder missing variant");
    const buffer = new Uint8Array(1 + this.payload.length);
    buffer[0] = this.tag;
    buffer.set(this.payload, 1);
    __tnBuilderValidateOrThrow("MultisigError", MultisigError.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const bytes = this.build();
    if (target.length - offset < bytes.length) throw new Error("target buffer too small");
    target.set(bytes, offset);
    return target;
  }

  finish(): MultisigError {
    const view = MultisigError.from_array(this.build());
    if (!view) throw new Error("failed to build MultisigError");
    return view;
  }
}

__tnRegisterFootprint("MultisigError", (params) => MultisigError.__tnInvokeFootprint(params));
__tnRegisterValidate("MultisigError", (buffer, params) => MultisigError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MultisigError", (buffer) => { const result = MultisigError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpdateMembershipRequest ----- */

const __tn_ir_UpdateMembershipRequest = {
  typeName: "UpdateMembershipRequest",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "new_members.new_member_cnt" }, right: { op: "const", value: 32n } } } } }
} as const;

export class UpdateMembershipRequest {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: UpdateMembershipRequest.Params;

  private constructor(private buffer: Uint8Array, params?: UpdateMembershipRequest.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = UpdateMembershipRequest.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("UpdateMembershipRequest: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: UpdateMembershipRequest.Params, fieldContext?: Record<string, number | bigint> }): UpdateMembershipRequest {
    if (!buffer || buffer.length === undefined) throw new Error("UpdateMembershipRequest.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = UpdateMembershipRequest.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("UpdateMembershipRequest.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new UpdateMembershipRequest(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): UpdateMembershipRequest.Params {
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
    throw new Error("UpdateMembershipRequest: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "UpdateMembershipRequest::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("UpdateMembershipRequest: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: UpdateMembershipRequest.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 2) {
      return null;
    }
    const __tnParam_new_members_new_member_cnt = __tnToBigInt(view.getUint16(0, true));
    const __tnExtractedParams = UpdateMembershipRequest.Params.fromValues({
      new_members_new_member_cnt: __tnParam_new_members_new_member_cnt,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_new_member_cnt(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_new_member_cnt(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get new_member_cnt(): number {
    return this.get_new_member_cnt();
  }

  set new_member_cnt(value: number) {
    this.set_new_member_cnt(value);
  }

  get_reserved0(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_new_members_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("new_member_cnt"));
  }

  get_new_members_at(index: number): Pubkey {
    const offset = 4;
    const slice = this.buffer.subarray((offset + index * 32), (offset + (index + 1) * 32));
    return Pubkey.from_array(slice)!;
  }

  get_new_members(): Pubkey[] {
    const len = this.get_new_members_length();
    const result: Pubkey[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_new_members_at(i));
    }
    return result;
  }

  set_new_members_at(index: number, value: Pubkey): void {
    const offset = 4;
    const slice = this.buffer.subarray(offset + index * 32, offset + (index + 1) * 32);
    slice.set(value['buffer']);
  }

  set_new_members(value: Pubkey[]): void {
    const len = Math.min(this.get_new_members_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_new_members_at(i, value[i]);
    }
  }

  get new_members(): Pubkey[] {
    return this.get_new_members();
  }

  set new_members(value: Pubkey[]) {
    this.set_new_members(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UpdateMembershipRequest.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UpdateMembershipRequest, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(new_members_new_member_cnt: number | bigint): bigint {
    const params = UpdateMembershipRequest.Params.fromValues({
      new_members_new_member_cnt: new_members_new_member_cnt,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: UpdateMembershipRequest.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["new_members.new_member_cnt"] = params.new_members_new_member_cnt;
    return record;
  }

  static footprintIrFromParams(params: UpdateMembershipRequest.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: UpdateMembershipRequest.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UpdateMembershipRequest');
    return __tnBigIntToNumber(irResult, 'UpdateMembershipRequest::footprintFromParams');
  }

  static footprintFromValues(input: { new_members_new_member_cnt: number | bigint }): number {
    const params = UpdateMembershipRequest.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: UpdateMembershipRequest.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: UpdateMembershipRequest.Params }): { ok: boolean; code?: string; consumed?: number; params?: UpdateMembershipRequest.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'UpdateMembershipRequest::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'UpdateMembershipRequest::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: UpdateMembershipRequest.Params }): UpdateMembershipRequest | null {
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
    const state = new UpdateMembershipRequest(buffer, cached);
    return state;
  }


}

export namespace UpdateMembershipRequest {
  export type Params = {
    /** ABI path: new_members.new_member_cnt */
    readonly new_members_new_member_cnt: bigint;
  };

  export const ParamKeys = Object.freeze({
    new_members_new_member_cnt: "new_members.new_member_cnt",
  } as const);

  export const Params = {
    fromValues(input: { new_members_new_member_cnt: number | bigint }): Params {
      return {
        new_members_new_member_cnt: __tnToBigInt(input.new_members_new_member_cnt),
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

  export function params(input: { new_members_new_member_cnt: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("UpdateMembershipRequest", (params) => UpdateMembershipRequest.__tnInvokeFootprint(params));
__tnRegisterValidate("UpdateMembershipRequest", (buffer, params) => UpdateMembershipRequest.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UpdateMembershipRequest", (buffer) => { const result = UpdateMembershipRequest.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpdateThresholdRequest ----- */

const __tn_ir_UpdateThresholdRequest = {
  typeName: "UpdateThresholdRequest",
  root: { op: "const", value: 4n }
} as const;

export class UpdateThresholdRequest {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UpdateThresholdRequest {
    if (!buffer || buffer.length === undefined) throw new Error("UpdateThresholdRequest.__tnCreateView requires a Uint8Array");
    return new UpdateThresholdRequest(new Uint8Array(buffer));
  }

  static builder(): UpdateThresholdRequestBuilder {
    return new UpdateThresholdRequestBuilder();
  }

  static fromBuilder(builder: UpdateThresholdRequestBuilder): UpdateThresholdRequest | null {
    const buffer = builder.build();
    return UpdateThresholdRequest.from_array(buffer);
  }

  get_new_threshold_m(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_new_threshold_m(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get new_threshold_m(): number {
    return this.get_new_threshold_m();
  }

  set new_threshold_m(value: number) {
    this.set_new_threshold_m(value);
  }

  get_reserved0(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UpdateThresholdRequest.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UpdateThresholdRequest, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UpdateThresholdRequest');
    }
    return __tnBigIntToNumber(irResult, 'UpdateThresholdRequest::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 4) return { ok: false, code: "tn.buffer_too_small", consumed: 4 };
    return { ok: true, consumed: 4 };
  }

  static new(new_threshold_m: number, reserved0: number): UpdateThresholdRequest {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, new_threshold_m, true); /* new_threshold_m (little-endian) */
    view.setUint16(2, reserved0, true); /* reserved0 (little-endian) */

    return new UpdateThresholdRequest(buffer);
  }

  static from_array(buffer: Uint8Array): UpdateThresholdRequest | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UpdateThresholdRequest(buffer);
  }

}

export class UpdateThresholdRequestBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(4);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_new_threshold_m(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("UpdateThresholdRequest", UpdateThresholdRequest.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("UpdateThresholdRequest", UpdateThresholdRequest.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): UpdateThresholdRequest {
    const view = UpdateThresholdRequest.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build UpdateThresholdRequest");
    return view;
  }
}

__tnRegisterFootprint("UpdateThresholdRequest", (params) => UpdateThresholdRequest.__tnInvokeFootprint(params));
__tnRegisterValidate("UpdateThresholdRequest", (buffer, params) => UpdateThresholdRequest.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UpdateThresholdRequest", (buffer) => { const result = UpdateThresholdRequest.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ApproveRequestArgs ----- */

const __tn_ir_ApproveRequestArgs = {
  typeName: "ApproveRequestArgs",
  root: { op: "const", value: 46n }
} as const;

export class ApproveRequestArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ApproveRequestArgs {
    if (!buffer || buffer.length === undefined) throw new Error("ApproveRequestArgs.__tnCreateView requires a Uint8Array");
    return new ApproveRequestArgs(new Uint8Array(buffer));
  }

  static builder(): ApproveRequestArgsBuilder {
    return new ApproveRequestArgsBuilder();
  }

  static fromBuilder(builder: ApproveRequestArgsBuilder): ApproveRequestArgs | null {
    const buffer = builder.build();
    return ApproveRequestArgs.from_array(buffer);
  }

  get_multisig_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_multisig_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get multisig_account_idx(): number {
    return this.get_multisig_account_idx();
  }

  set multisig_account_idx(value: number) {
    this.set_multisig_account_idx(value);
  }

  get_request_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_request_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get request_account_idx(): number {
    return this.get_request_account_idx();
  }

  set request_account_idx(value: number) {
    this.set_request_account_idx(value);
  }

  get_approver_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_approver_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get approver_account_idx(): number {
    return this.get_approver_account_idx();
  }

  set approver_account_idx(value: number) {
    this.set_approver_account_idx(value);
  }

  get_expected_request_id(): bigint {
    const offset = 6;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_expected_request_id(value: bigint): void {
    const offset = 6;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get expected_request_id(): bigint {
    return this.get_expected_request_id();
  }

  set expected_request_id(value: bigint) {
    this.set_expected_request_id(value);
  }

  get_expected_request_hash(): Hash {
    const offset = 14;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Hash.from_array(slice)!;
  }

  set_expected_request_hash(value: Hash): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 14;
    this.buffer.set(sourceBytes, offset);
  }

  get expected_request_hash(): Hash {
    return this.get_expected_request_hash();
  }

  set expected_request_hash(value: Hash) {
    this.set_expected_request_hash(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ApproveRequestArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ApproveRequestArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ApproveRequestArgs');
    }
    return __tnBigIntToNumber(irResult, 'ApproveRequestArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 46) return { ok: false, code: "tn.buffer_too_small", consumed: 46 };
    return { ok: true, consumed: 46 };
  }

  static from_array(buffer: Uint8Array): ApproveRequestArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ApproveRequestArgs(buffer);
  }

}

export class ApproveRequestArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(46);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_multisig_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_request_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_approver_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_expected_request_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
    return this;
  }

  set_expected_request_hash(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("expected_request_hash expects 32 bytes");
    this.buffer.set(value, 14);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("ApproveRequestArgs", ApproveRequestArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("ApproveRequestArgs", ApproveRequestArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ApproveRequestArgs {
    const view = ApproveRequestArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ApproveRequestArgs");
    return view;
  }
}

__tnRegisterFootprint("ApproveRequestArgs", (params) => ApproveRequestArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("ApproveRequestArgs", (buffer, params) => ApproveRequestArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ApproveRequestArgs", (buffer) => { const result = ApproveRequestArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateMultisigArgs ----- */

const __tn_ir_CreateMultisigArgs = {
  typeName: "CreateMultisigArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "members.member_cnt" }, right: { op: "const", value: 32n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateMultisigArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateMultisigArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateMultisigArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateMultisigArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateMultisigArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateMultisigArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateMultisigArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateMultisigArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateMultisigArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateMultisigArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateMultisigArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateMultisigArgs.Params {
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
    throw new Error("CreateMultisigArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateMultisigArgs::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("CreateMultisigArgs: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_sz", paramKey: "proof_sz", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_multisig_account_idx: number | null = null;
    let __tnFieldValue_creator_account_idx: number | null = null;
    let __tnFieldValue_member_cnt: number | null = null;
    let __tnFieldValue_threshold_m: number | null = null;
    let __tnFieldValue_proof_sz: bigint | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_multisig_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_multisig_account_idx = __tnRead_multisig_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_creator_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_creator_account_idx = __tnRead_creator_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_member_cnt = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_member_cnt = __tnRead_member_cnt;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_threshold_m = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_threshold_m = __tnRead_threshold_m;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_proof_sz = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_proof_sz = __tnRead_proof_sz;
    __tnCursorMutable += 8;
    if (__tnFieldValue_member_cnt === null) return null;
    const __tnArrayCount_members = __tnU64(__tnToBigInt(__tnFieldValue_member_cnt as number | bigint));
    if (__tnArrayCount_members === null) return null;
    const __tnArrayBytesBig_members = __tnArrayCount_members * BigInt(32);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_members > BigInt(__tnLength)) return null;
    const __tnArrayBytes_members = Number(__tnArrayBytesBig_members);
    if (__tnCursorMutable + __tnArrayBytes_members > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_members;
    if (__tnFieldValue_proof_sz === null) return null;
    const __tnArrayCount_proof = __tnU64(__tnToBigInt(__tnFieldValue_proof_sz as number | bigint));
    if (__tnArrayCount_proof === null) return null;
    const __tnArrayBytesBig_proof = __tnArrayCount_proof * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_proof > BigInt(__tnLength)) return null;
    const __tnArrayBytes_proof = Number(__tnArrayBytesBig_proof);
    offsets["proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateMultisigArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 6) {
      return null;
    }
    const __tnParam_members_member_cnt = __tnToBigInt(view.getUint16(4, true));
    if (buffer.length < 48) {
      return null;
    }
    const __tnParam_proof_proof_sz = __tnToBigInt(view.getBigUint64(40, true));
    const __tnExtractedParams = CreateMultisigArgs.Params.fromValues({
      members_member_cnt: __tnParam_members_member_cnt,
      proof_proof_sz: __tnParam_proof_proof_sz,
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
      throw new Error("CreateMultisigArgs: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = CreateMultisigArgs.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("CreateMultisigArgs: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_multisig_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_multisig_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get multisig_account_idx(): number {
    return this.get_multisig_account_idx();
  }

  set multisig_account_idx(value: number) {
    this.set_multisig_account_idx(value);
  }

  get_creator_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_creator_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get creator_account_idx(): number {
    return this.get_creator_account_idx();
  }

  set creator_account_idx(value: number) {
    this.set_creator_account_idx(value);
  }

  get_member_cnt(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_member_cnt(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get member_cnt(): number {
    return this.get_member_cnt();
  }

  set member_cnt(value: number) {
    this.set_member_cnt(value);
  }

  get_threshold_m(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_threshold_m(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get threshold_m(): number {
    return this.get_threshold_m();
  }

  set threshold_m(value: number) {
    this.set_threshold_m(value);
  }

  get_seed(): number[] {
    const offset = 8;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_seed(value: number[]): void {
    const offset = 8;
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

  get_proof_sz(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_proof_sz(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get proof_sz(): bigint {
    return this.get_proof_sz();
  }

  set proof_sz(value: bigint) {
    this.set_proof_sz(value);
  }

  get_members_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("member_cnt"));
  }

  get_members_at(index: number): Pubkey {
    const offset = 48;
    const slice = this.buffer.subarray((offset + index * 32), (offset + (index + 1) * 32));
    return Pubkey.from_array(slice)!;
  }

  get_members(): Pubkey[] {
    const len = this.get_members_length();
    const result: Pubkey[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_members_at(i));
    }
    return result;
  }

  set_members_at(index: number, value: Pubkey): void {
    const offset = 48;
    const slice = this.buffer.subarray(offset + index * 32, offset + (index + 1) * 32);
    slice.set(value['buffer']);
  }

  set_members(value: Pubkey[]): void {
    const len = Math.min(this.get_members_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_members_at(i, value[i]);
    }
  }

  get members(): Pubkey[] {
    return this.get_members();
  }

  set members(value: Pubkey[]) {
    this.set_members(value);
  }

  get_proof_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("proof_sz"));
  }

  get_proof_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("proof");
    return this.view.getUint8(offset + index * 1);
  }

  get_proof(): number[] {
    const len = this.get_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_at(i));
    }
    return result;
  }

  set_proof_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("proof");
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof(value: number[]): void {
    const len = Math.min(this.get_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_at(i, value[i]);
    }
  }

  get proof(): number[] {
    return this.get_proof();
  }

  set proof(value: number[]) {
    this.set_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateMultisigArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateMultisigArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(members_member_cnt: number | bigint, proof_proof_sz: number | bigint): bigint {
    const params = CreateMultisigArgs.Params.fromValues({
      members_member_cnt: members_member_cnt,
      proof_proof_sz: proof_proof_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateMultisigArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["members.member_cnt"] = params.members_member_cnt;
    record["proof.proof_sz"] = params.proof_proof_sz;
    return record;
  }

  static footprintIrFromParams(params: CreateMultisigArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateMultisigArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateMultisigArgs');
    return __tnBigIntToNumber(irResult, 'CreateMultisigArgs::footprintFromParams');
  }

  static footprintFromValues(input: { members_member_cnt: number | bigint, proof_proof_sz: number | bigint }): number {
    const params = CreateMultisigArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateMultisigArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateMultisigArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateMultisigArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMultisigArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMultisigArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateMultisigArgs.Params }): CreateMultisigArgs | null {
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
    const state = new CreateMultisigArgs(buffer, cached);
    return state;
  }


}

export namespace CreateMultisigArgs {
  export type Params = {
    /** ABI path: members.member_cnt */
    readonly members_member_cnt: bigint;
    /** ABI path: proof.proof_sz */
    readonly proof_proof_sz: bigint;
  };

  export const ParamKeys = Object.freeze({
    members_member_cnt: "members.member_cnt",
    proof_proof_sz: "proof.proof_sz",
  } as const);

  export const Params = {
    fromValues(input: { members_member_cnt: number | bigint, proof_proof_sz: number | bigint }): Params {
      return {
        members_member_cnt: __tnToBigInt(input.members_member_cnt),
        proof_proof_sz: __tnToBigInt(input.proof_proof_sz),
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

  export function params(input: { members_member_cnt: number | bigint, proof_proof_sz: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("CreateMultisigArgs", (params) => CreateMultisigArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateMultisigArgs", (buffer, params) => CreateMultisigArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateMultisigArgs", (buffer) => { const result = CreateMultisigArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR InvokeRequest ----- */

const __tn_ir_InvokeRequest = {
  typeName: "InvokeRequest",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 2, node: { op: "mul", left: { op: "field", param: "ref_account_idxs.ref_account_cnt" }, right: { op: "const", value: 2n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "ref_account_pubkeys.ref_account_cnt" }, right: { op: "const", value: 32n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "instr_data.instr_data_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class InvokeRequest {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: InvokeRequest.Params;

  private constructor(private buffer: Uint8Array, params?: InvokeRequest.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = InvokeRequest.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("InvokeRequest: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: InvokeRequest.Params, fieldContext?: Record<string, number | bigint> }): InvokeRequest {
    if (!buffer || buffer.length === undefined) throw new Error("InvokeRequest.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = InvokeRequest.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("InvokeRequest.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new InvokeRequest(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): InvokeRequest.Params {
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
    throw new Error("InvokeRequest: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "InvokeRequest::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("InvokeRequest: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "ref_account_idxs", method: "ref_account_idxs", sizeField: "ref_account_cnt", paramKey: "ref_account_cnt", elementSize: 2 },
    { field: "instr_data", method: "instr_data", sizeField: "instr_data_sz", paramKey: "instr_data_sz", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_target_program_idx: number | null = null;
    let __tnFieldValue_ref_account_cnt: number | null = null;
    let __tnFieldValue_instr_data_sz: bigint | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_target_program_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_target_program_idx = __tnRead_target_program_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_ref_account_cnt = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_ref_account_cnt = __tnRead_ref_account_cnt;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_instr_data_sz = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_instr_data_sz = __tnRead_instr_data_sz;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnFieldValue_ref_account_cnt === null) return null;
    const __tnArrayCount_ref_account_idxs = __tnU64(__tnToBigInt(__tnFieldValue_ref_account_cnt as number | bigint));
    if (__tnArrayCount_ref_account_idxs === null) return null;
    const __tnArrayBytesBig_ref_account_idxs = __tnArrayCount_ref_account_idxs * BigInt(2);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_ref_account_idxs > BigInt(__tnLength)) return null;
    const __tnArrayBytes_ref_account_idxs = Number(__tnArrayBytesBig_ref_account_idxs);
    if (__tnCursorMutable + __tnArrayBytes_ref_account_idxs > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_ref_account_idxs;
    if (__tnFieldValue_ref_account_cnt === null) return null;
    const __tnArrayCount_ref_account_pubkeys = __tnU64(__tnToBigInt(__tnFieldValue_ref_account_cnt as number | bigint));
    if (__tnArrayCount_ref_account_pubkeys === null) return null;
    const __tnArrayBytesBig_ref_account_pubkeys = __tnArrayCount_ref_account_pubkeys * BigInt(32);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_ref_account_pubkeys > BigInt(__tnLength)) return null;
    const __tnArrayBytes_ref_account_pubkeys = Number(__tnArrayBytesBig_ref_account_pubkeys);
    offsets["ref_account_pubkeys"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_ref_account_pubkeys > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_ref_account_pubkeys;
    if (__tnFieldValue_instr_data_sz === null) return null;
    const __tnArrayCount_instr_data = __tnU64(__tnToBigInt(__tnFieldValue_instr_data_sz as number | bigint));
    if (__tnArrayCount_instr_data === null) return null;
    const __tnArrayBytesBig_instr_data = __tnArrayCount_instr_data * BigInt(1);
    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_instr_data > BigInt(__tnLength)) return null;
    const __tnArrayBytes_instr_data = Number(__tnArrayBytesBig_instr_data);
    offsets["instr_data"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_instr_data > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_instr_data;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: InvokeRequest.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 12) {
      return null;
    }
    const __tnParam_instr_data_instr_data_sz = __tnToBigInt(view.getBigUint64(4, true));
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_ref_account_idxs_ref_account_cnt = __tnToBigInt(view.getUint16(2, true));
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_ref_account_pubkeys_ref_account_cnt = __tnToBigInt(view.getUint16(2, true));
    const __tnExtractedParams = InvokeRequest.Params.fromValues({
      instr_data_instr_data_sz: __tnParam_instr_data_instr_data_sz,
      ref_account_idxs_ref_account_cnt: __tnParam_ref_account_idxs_ref_account_cnt,
      ref_account_pubkeys_ref_account_cnt: __tnParam_ref_account_pubkeys_ref_account_cnt,
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
      throw new Error("InvokeRequest: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = InvokeRequest.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("InvokeRequest: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_target_program_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_target_program_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get target_program_idx(): number {
    return this.get_target_program_idx();
  }

  set target_program_idx(value: number) {
    this.set_target_program_idx(value);
  }

  get_ref_account_cnt(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_ref_account_cnt(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get ref_account_cnt(): number {
    return this.get_ref_account_cnt();
  }

  set ref_account_cnt(value: number) {
    this.set_ref_account_cnt(value);
  }

  get_instr_data_sz(): bigint {
    const offset = 4;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_instr_data_sz(value: bigint): void {
    const offset = 4;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get instr_data_sz(): bigint {
    return this.get_instr_data_sz();
  }

  set instr_data_sz(value: bigint) {
    this.set_instr_data_sz(value);
  }

  get_target_program_pubkey(): Pubkey {
    const offset = 12;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_target_program_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 12;
    this.buffer.set(sourceBytes, offset);
  }

  get target_program_pubkey(): Pubkey {
    return this.get_target_program_pubkey();
  }

  set target_program_pubkey(value: Pubkey) {
    this.set_target_program_pubkey(value);
  }

  get_ref_account_idxs_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("ref_account_cnt"));
  }

  get_ref_account_idxs_at(index: number): number {
    const offset = 44;
    return this.view.getUint16(offset + index * 2, true);
  }

  get_ref_account_idxs(): number[] {
    const len = this.get_ref_account_idxs_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_ref_account_idxs_at(i));
    }
    return result;
  }

  set_ref_account_idxs_at(index: number, value: number): void {
    const offset = 44;
    this.view.setUint16((offset + index * 2), value, true);
  }

  set_ref_account_idxs(value: number[]): void {
    const len = Math.min(this.get_ref_account_idxs_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_ref_account_idxs_at(i, value[i]);
    }
  }

  get ref_account_idxs(): number[] {
    return this.get_ref_account_idxs();
  }

  set ref_account_idxs(value: number[]) {
    this.set_ref_account_idxs(value);
  }

  get_ref_account_pubkeys_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("ref_account_cnt"));
  }

  get_ref_account_pubkeys_at(index: number): Pubkey {
    const offset = this.__tnGetDynamicOffset("ref_account_pubkeys");
    const slice = this.buffer.subarray((offset + index * 32), (offset + (index + 1) * 32));
    return Pubkey.from_array(slice)!;
  }

  get_ref_account_pubkeys(): Pubkey[] {
    const len = this.get_ref_account_pubkeys_length();
    const result: Pubkey[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_ref_account_pubkeys_at(i));
    }
    return result;
  }

  set_ref_account_pubkeys_at(index: number, value: Pubkey): void {
    const offset = this.__tnGetDynamicOffset("ref_account_pubkeys");
    const slice = this.buffer.subarray(offset + index * 32, offset + (index + 1) * 32);
    slice.set(value['buffer']);
  }

  set_ref_account_pubkeys(value: Pubkey[]): void {
    const len = Math.min(this.get_ref_account_pubkeys_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_ref_account_pubkeys_at(i, value[i]);
    }
  }

  get ref_account_pubkeys(): Pubkey[] {
    return this.get_ref_account_pubkeys();
  }

  set ref_account_pubkeys(value: Pubkey[]) {
    this.set_ref_account_pubkeys(value);
  }

  get_instr_data_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("instr_data_sz"));
  }

  get_instr_data_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("instr_data");
    return this.view.getUint8(offset + index * 1);
  }

  get_instr_data(): number[] {
    const len = this.get_instr_data_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_instr_data_at(i));
    }
    return result;
  }

  set_instr_data_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("instr_data");
    this.view.setUint8((offset + index * 1), value);
  }

  set_instr_data(value: number[]): void {
    const len = Math.min(this.get_instr_data_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_instr_data_at(i, value[i]);
    }
  }

  get instr_data(): number[] {
    return this.get_instr_data();
  }

  set instr_data(value: number[]) {
    this.set_instr_data(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InvokeRequest.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InvokeRequest, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(instr_data_instr_data_sz: number | bigint, ref_account_idxs_ref_account_cnt: number | bigint, ref_account_pubkeys_ref_account_cnt: number | bigint): bigint {
    const params = InvokeRequest.Params.fromValues({
      instr_data_instr_data_sz: instr_data_instr_data_sz,
      ref_account_idxs_ref_account_cnt: ref_account_idxs_ref_account_cnt,
      ref_account_pubkeys_ref_account_cnt: ref_account_pubkeys_ref_account_cnt,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: InvokeRequest.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["instr_data.instr_data_sz"] = params.instr_data_instr_data_sz;
    record["ref_account_idxs.ref_account_cnt"] = params.ref_account_idxs_ref_account_cnt;
    record["ref_account_pubkeys.ref_account_cnt"] = params.ref_account_pubkeys_ref_account_cnt;
    return record;
  }

  static footprintIrFromParams(params: InvokeRequest.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: InvokeRequest.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InvokeRequest');
    return __tnBigIntToNumber(irResult, 'InvokeRequest::footprintFromParams');
  }

  static footprintFromValues(input: { instr_data_instr_data_sz: number | bigint, ref_account_idxs_ref_account_cnt: number | bigint, ref_account_pubkeys_ref_account_cnt: number | bigint }): number {
    const params = InvokeRequest.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: InvokeRequest.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: InvokeRequest.Params }): { ok: boolean; code?: string; consumed?: number; params?: InvokeRequest.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InvokeRequest::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InvokeRequest::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: InvokeRequest.Params }): InvokeRequest | null {
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
    const state = new InvokeRequest(buffer, cached);
    return state;
  }


}

export namespace InvokeRequest {
  export type Params = {
    /** ABI path: instr_data.instr_data_sz */
    readonly instr_data_instr_data_sz: bigint;
    /** ABI path: ref_account_idxs.ref_account_cnt */
    readonly ref_account_idxs_ref_account_cnt: bigint;
    /** ABI path: ref_account_pubkeys.ref_account_cnt */
    readonly ref_account_pubkeys_ref_account_cnt: bigint;
  };

  export const ParamKeys = Object.freeze({
    instr_data_instr_data_sz: "instr_data.instr_data_sz",
    ref_account_idxs_ref_account_cnt: "ref_account_idxs.ref_account_cnt",
    ref_account_pubkeys_ref_account_cnt: "ref_account_pubkeys.ref_account_cnt",
  } as const);

  export const Params = {
    fromValues(input: { instr_data_instr_data_sz: number | bigint, ref_account_idxs_ref_account_cnt: number | bigint, ref_account_pubkeys_ref_account_cnt: number | bigint }): Params {
      return {
        instr_data_instr_data_sz: __tnToBigInt(input.instr_data_instr_data_sz),
        ref_account_idxs_ref_account_cnt: __tnToBigInt(input.ref_account_idxs_ref_account_cnt),
        ref_account_pubkeys_ref_account_cnt: __tnToBigInt(input.ref_account_pubkeys_ref_account_cnt),
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

  export function params(input: { instr_data_instr_data_sz: number | bigint, ref_account_idxs_ref_account_cnt: number | bigint, ref_account_pubkeys_ref_account_cnt: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("InvokeRequest", (params) => InvokeRequest.__tnInvokeFootprint(params));
__tnRegisterValidate("InvokeRequest", (buffer, params) => InvokeRequest.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InvokeRequest", (buffer) => { const result = InvokeRequest.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MultisigAccount ----- */

const __tn_ir_MultisigAccount = {
  typeName: "MultisigAccount",
  root: { op: "const", value: 1047n }
} as const;

export class MultisigAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigAccount {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigAccount.__tnCreateView requires a Uint8Array");
    return new MultisigAccount(new Uint8Array(buffer));
  }

  static builder(): MultisigAccountBuilder {
    return new MultisigAccountBuilder();
  }

  static fromBuilder(builder: MultisigAccountBuilder): MultisigAccount | null {
    const buffer = builder.build();
    return MultisigAccount.from_array(buffer);
  }

  get_flags(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_flags(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get flags(): number {
    return this.get_flags();
  }

  set flags(value: number) {
    this.set_flags(value);
  }

  get_member_cnt(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_member_cnt(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get member_cnt(): number {
    return this.get_member_cnt();
  }

  set member_cnt(value: number) {
    this.set_member_cnt(value);
  }

  get_threshold_m(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_threshold_m(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get threshold_m(): number {
    return this.get_threshold_m();
  }

  set threshold_m(value: number) {
    this.set_threshold_m(value);
  }

  get_live_request_cnt(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_live_request_cnt(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get live_request_cnt(): number {
    return this.get_live_request_cnt();
  }

  set live_request_cnt(value: number) {
    this.set_live_request_cnt(value);
  }

  get_config_epoch(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_config_epoch(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get config_epoch(): bigint {
    return this.get_config_epoch();
  }

  set config_epoch(value: bigint) {
    this.set_config_epoch(value);
  }

  get_next_request_id(): bigint {
    const offset = 15;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_next_request_id(value: bigint): void {
    const offset = 15;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get next_request_id(): bigint {
    return this.get_next_request_id();
  }

  set next_request_id(value: bigint) {
    this.set_next_request_id(value);
  }

  get_members(): Pubkey[] {
    const offset = 23;
    const result: Pubkey[] = [];
    for (let i = 0; i < 32; i++) {
      const slice = this.buffer.subarray((offset + i * 32), (offset + (i + 1) * 32));
      result.push(Pubkey.from_array(slice)!);
    }
    return result;
  }

  set_members(value: Pubkey[]): void {
    const offset = 23;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      const slice = this.buffer.subarray(offset + i * 32, offset + (i + 1) * 32);
      slice.set(value[i]['buffer']);
    }
  }

  get members(): Pubkey[] {
    return this.get_members();
  }

  set members(value: Pubkey[]) {
    this.set_members(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MultisigAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MultisigAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MultisigAccount');
    }
    return __tnBigIntToNumber(irResult, 'MultisigAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 1047) return { ok: false, code: "tn.buffer_too_small", consumed: 1047 };
    return { ok: true, consumed: 1047 };
  }

  static from_array(buffer: Uint8Array): MultisigAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MultisigAccount(buffer);
  }

}

export class MultisigAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(1047);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_flags(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_member_cnt(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_threshold_m(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_live_request_cnt(value: number): this {
    this.view.setUint16(5, value, true);
    return this;
  }

  set_config_epoch(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    return this;
  }

  set_next_request_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(15, cast, true);
    return this;
  }

  set_members(values: Pubkey[]): this {
    if (values.length !== 32) throw new Error("members expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const slice = this.buffer.subarray(23 + i * 32, 23 + (i + 1) * 32);
      const source = values[i] as unknown as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
      const raw = source.buffer ? new Uint8Array(source.buffer, source.byteOffset ?? 0, 32) : (values[i] as unknown as Uint8Array);
      slice.set(raw);
    }
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("MultisigAccount", MultisigAccount.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("MultisigAccount", MultisigAccount.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): MultisigAccount {
    const view = MultisigAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MultisigAccount");
    return view;
  }
}

__tnRegisterFootprint("MultisigAccount", (params) => MultisigAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("MultisigAccount", (buffer, params) => MultisigAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MultisigAccount", (buffer) => { const result = MultisigAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MultisigInstruction ----- */

const __tn_ir_MultisigInstruction = {
  typeName: "MultisigInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 4n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class MultisigInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): MultisigInstruction_payload_Inner {
    return new MultisigInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigInstruction_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["tag"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 0)) descriptor = { name: "create_multisig", tag: 0, payloadSize: null };
      if (__tnTagEquals(tag, 1)) descriptor = { name: "create_request", tag: 1, payloadSize: null };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "approve_request", tag: 2, payloadSize: 46 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "execute_request", tag: 3, payloadSize: 4 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "delete_request", tag: 4, payloadSize: 6 };
    }
    return new MultisigInstruction_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreateMultisig(): CreateMultisigArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 0)) return null;
    return CreateMultisigArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateRequest(): CreateRequestArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return CreateRequestArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asApproveRequest(): ApproveRequestArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return ApproveRequestArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asExecuteRequest(): ExecuteRequestArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return ExecuteRequestArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asDeleteRequest(): DeleteRequestArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return DeleteRequestArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class MultisigInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 4;
  private __tnParams: MultisigInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: MultisigInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = MultisigInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("MultisigInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: MultisigInstruction.Params, fieldContext?: Record<string, number | bigint> }): MultisigInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = MultisigInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("MultisigInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new MultisigInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): MultisigInstruction.Params {
    return this.__tnParams;
  }

  static builder(): MultisigInstructionBuilder {
    return new MultisigInstructionBuilder();
  }

  static fromBuilder(builder: MultisigInstructionBuilder): MultisigInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return MultisigInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create_multisig",
      tag: 0,
      payloadSize: null,
      payloadType: "MultisigInstruction::payload::create_multisig",
      createPayloadBuilder: () => null,
    },
    {
      name: "create_request",
      tag: 1,
      payloadSize: null,
      payloadType: "MultisigInstruction::payload::create_request",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateRequestArgs),
    },
    {
      name: "approve_request",
      tag: 2,
      payloadSize: 46,
      payloadType: "MultisigInstruction::payload::approve_request",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ApproveRequestArgs),
    },
    {
      name: "execute_request",
      tag: 3,
      payloadSize: 4,
      payloadType: "MultisigInstruction::payload::execute_request",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExecuteRequestArgs),
    },
    {
      name: "delete_request",
      tag: 4,
      payloadSize: 6,
      payloadType: "MultisigInstruction::payload::delete_request",
      createPayloadBuilder: () => __tnMaybeCallBuilder(DeleteRequestArgs),
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_payload_payload_size: bigint | null = null;
    let __tnFieldValue_tag: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_tag = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_tag = __tnRead_tag;
    __tnCursorMutable += 4;
    const __tnEnumTagValue_payload = __tnFieldValue_tag;
    if (__tnEnumTagValue_payload === null) return null;
    let __tnEnumSize_payload = 0;
    switch (__tnToBigInt(__tnEnumTagValue_payload)) {
      case 0n: break;
      case 1n: break;
      case 2n: break;
      case 3n: break;
      case 4n: break;
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: MultisigInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_payload_tag = __tnToBigInt(view.getUint32(0, true));
    const __tnLayout = MultisigInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = MultisigInstruction.Params.fromValues({
      payload_payload_size: __tnParamSeq_payload_payload_size as bigint,
      payload_tag: __tnParam_payload_tag,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_tag(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_tag(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get tag(): number {
    return this.get_tag();
  }

  set tag(value: number) {
    this.set_tag(value);
  }

  payloadVariant(): typeof MultisigInstruction.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_tag();
    return MultisigInstruction.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): MultisigInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("MultisigInstruction: unknown payload variant");
    const offset = MultisigInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("MultisigInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return MultisigInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MultisigInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MultisigInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_payload_size: number | bigint, payload_tag: number | bigint): bigint {
    const params = MultisigInstruction.Params.fromValues({
      payload_payload_size: payload_payload_size,
      payload_tag: payload_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: MultisigInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.payload_size"] = params.payload_payload_size;
    record["payload.tag"] = params.payload_tag;
    return record;
  }

  static footprintIrFromParams(params: MultisigInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: MultisigInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MultisigInstruction');
    return __tnBigIntToNumber(irResult, 'MultisigInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): number {
    const params = MultisigInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: MultisigInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: MultisigInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: MultisigInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MultisigInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MultisigInstruction::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 4 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
let t3: number | null = null;
switch ((x2) as bigint | null) {
  case 0n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s4 = c;
if (c + 2 > b.length) return null; const x5 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x6 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x7 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x8 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const av9 = v; const ao10 = c;
if (c + 32 > b.length) return null; c += 32;
if (c + 8 > b.length) return null; const x11 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const n12 = x7; if (n12 === null || n12 < 0n) return null;
if (BigInt(c) + n12 * 32n > BigInt(b.length)) return null; c += Number(n12 * 32n);
const n13 = x11; if (n13 === null || n13 < 0n) return null;
if (BigInt(c) + n13 * 1n > BigInt(b.length)) return null; c += Number(n13 * 1n);
void s4;
return c; })(b.subarray(c)); break;
  case 1n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s14 = c;
if (c + 2 > b.length) return null; const x15 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x16 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x17 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 1 > b.length) return null; const x18 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
if (c + 1 > b.length) return null; const x19 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
const av20 = v; const ao21 = c;
if (c + 32 > b.length) return null; c += 32;
if (c + 8 > b.length) return null; const x22 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
if (c + 8 > b.length) return null; const x23 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const n24 = x22; if (n24 === null || n24 < 0n) return null;
if (BigInt(c) + n24 * 1n > BigInt(b.length)) return null; c += Number(n24 * 1n);
const n25 = x23; if (n25 === null || n25 < 0n) return null;
if (BigInt(c) + n25 * 1n > BigInt(b.length)) return null; c += Number(n25 * 1n);
void s14;
return c; })(b.subarray(c)); break;
  case 2n: t3 = 46; break;
  case 3n: t3 = 4; break;
  case 4n: t3 = 6; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: MultisigInstruction.Params }): MultisigInstruction | null {
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
    const state = new MultisigInstruction(buffer, cached);
    return state;
  }


}

export namespace MultisigInstruction {
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

export class MultisigInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof MultisigInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: MultisigInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: MultisigInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<MultisigInstructionBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(4);
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

  payload(): __TnVariantSelectorResult<MultisigInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, MultisigInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("MultisigInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("MultisigInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = MultisigInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("MultisigInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("MultisigInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = MultisigInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("MultisigInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): MultisigInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = MultisigInstruction.from_array(buffer, { params });
    if (!view) throw new Error("MultisigInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): MultisigInstruction {
    return this.finish();
  }

  dynamicParams(): MultisigInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): MultisigInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = MultisigInstruction.Params.fromValues({
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("MultisigInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
      payload_tag: (() => { if (this.__tnField_tag === null) throw new Error("MultisigInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_tag === null) throw new Error("MultisigInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("MultisigInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint32(0, this.__tnField_tag, true);
    target.set(this.__tnPayload_payload.bytes, 4);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: MultisigInstruction.Params): void {
    const result = MultisigInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ MultisigInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("MultisigInstruction", (params) => MultisigInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MultisigInstruction", (buffer, params) => MultisigInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MultisigInstruction", (buffer) => { const result = MultisigInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MultisigRequest ----- */

const __tn_ir_MultisigRequest = {
  typeName: "MultisigRequest",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "request_data.request_data_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class MultisigRequest {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: MultisigRequest.Params;

  private constructor(private buffer: Uint8Array, params?: MultisigRequest.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = MultisigRequest.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("MultisigRequest: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: MultisigRequest.Params, fieldContext?: Record<string, number | bigint> }): MultisigRequest {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigRequest.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = MultisigRequest.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("MultisigRequest.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new MultisigRequest(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): MultisigRequest.Params {
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
    throw new Error("MultisigRequest: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "MultisigRequest::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("MultisigRequest: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): MultisigRequestBuilder {
    return new MultisigRequestBuilder();
  }

  static fromBuilder(builder: MultisigRequestBuilder): MultisigRequest | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return MultisigRequest.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "request_data", method: "request_data", sizeField: "request_data_sz", paramKey: "request_data_sz", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: MultisigRequest.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 39) {
      return null;
    }
    const __tnParam_request_data_request_data_sz = __tnToBigInt(view.getBigUint64(31, true));
    const __tnExtractedParams = MultisigRequest.Params.fromValues({
      request_data_request_data_sz: __tnParam_request_data_request_data_sz,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_kind(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_kind(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get kind(): number {
    return this.get_kind();
  }

  set kind(value: number) {
    this.set_kind(value);
  }

  get_status(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_status(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get status(): number {
    return this.get_status();
  }

  set status(value: number) {
    this.set_status(value);
  }

  get_reserved0(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_reserved0(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_member_cnt_snapshot(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_member_cnt_snapshot(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get member_cnt_snapshot(): number {
    return this.get_member_cnt_snapshot();
  }

  set member_cnt_snapshot(value: number) {
    this.set_member_cnt_snapshot(value);
  }

  get_required_approvals(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_required_approvals(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get required_approvals(): number {
    return this.get_required_approvals();
  }

  set required_approvals(value: number) {
    this.set_required_approvals(value);
  }

  get_request_id(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_request_id(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get request_id(): bigint {
    return this.get_request_id();
  }

  set request_id(value: bigint) {
    this.set_request_id(value);
  }

  get_config_epoch_snapshot(): bigint {
    const offset = 15;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_config_epoch_snapshot(value: bigint): void {
    const offset = 15;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get config_epoch_snapshot(): bigint {
    return this.get_config_epoch_snapshot();
  }

  set config_epoch_snapshot(value: bigint) {
    this.set_config_epoch_snapshot(value);
  }

  get_approval_bitmap(): bigint {
    const offset = 23;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_approval_bitmap(value: bigint): void {
    const offset = 23;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get approval_bitmap(): bigint {
    return this.get_approval_bitmap();
  }

  set approval_bitmap(value: bigint) {
    this.set_approval_bitmap(value);
  }

  get_request_data_sz(): bigint {
    const offset = 31;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_request_data_sz(value: bigint): void {
    const offset = 31;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get request_data_sz(): bigint {
    return this.get_request_data_sz();
  }

  set request_data_sz(value: bigint) {
    this.set_request_data_sz(value);
  }

  get_multisig_pubkey(): Pubkey {
    const offset = 39;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_multisig_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 39;
    this.buffer.set(sourceBytes, offset);
  }

  get multisig_pubkey(): Pubkey {
    return this.get_multisig_pubkey();
  }

  set multisig_pubkey(value: Pubkey) {
    this.set_multisig_pubkey(value);
  }

  get_proposer_pubkey(): Pubkey {
    const offset = 71;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_proposer_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 71;
    this.buffer.set(sourceBytes, offset);
  }

  get proposer_pubkey(): Pubkey {
    return this.get_proposer_pubkey();
  }

  set proposer_pubkey(value: Pubkey) {
    this.set_proposer_pubkey(value);
  }

  get_request_data_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("request_data_sz"));
  }

  get_request_data_at(index: number): number {
    const offset = 103;
    return this.view.getUint8(offset + index * 1);
  }

  get_request_data(): number[] {
    const len = this.get_request_data_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_request_data_at(i));
    }
    return result;
  }

  set_request_data_at(index: number, value: number): void {
    const offset = 103;
    this.view.setUint8((offset + index * 1), value);
  }

  set_request_data(value: number[]): void {
    const len = Math.min(this.get_request_data_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_request_data_at(i, value[i]);
    }
  }

  get request_data(): number[] {
    return this.get_request_data();
  }

  set request_data(value: number[]) {
    this.set_request_data(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MultisigRequest.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MultisigRequest, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(request_data_request_data_sz: number | bigint): bigint {
    const params = MultisigRequest.Params.fromValues({
      request_data_request_data_sz: request_data_request_data_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: MultisigRequest.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["request_data.request_data_sz"] = params.request_data_request_data_sz;
    return record;
  }

  static footprintIrFromParams(params: MultisigRequest.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: MultisigRequest.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MultisigRequest');
    return __tnBigIntToNumber(irResult, 'MultisigRequest::footprintFromParams');
  }

  static footprintFromValues(input: { request_data_request_data_sz: number | bigint }): number {
    const params = MultisigRequest.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: MultisigRequest.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: MultisigRequest.Params }): { ok: boolean; code?: string; consumed?: number; params?: MultisigRequest.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MultisigRequest::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MultisigRequest::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: MultisigRequest.Params }): MultisigRequest | null {
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
    const state = new MultisigRequest(buffer, cached);
    return state;
  }


}

export namespace MultisigRequest {
  export type Params = {
    /** ABI path: request_data.request_data_sz */
    readonly request_data_request_data_sz: bigint;
  };

  export const ParamKeys = Object.freeze({
    request_data_request_data_sz: "request_data.request_data_sz",
  } as const);

  export const Params = {
    fromValues(input: { request_data_request_data_sz: number | bigint }): Params {
      return {
        request_data_request_data_sz: __tnToBigInt(input.request_data_request_data_sz),
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

  export function params(input: { request_data_request_data_sz: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class MultisigRequestBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: MultisigRequest.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: MultisigRequest.Params | null = null;
  private __tnFam_request_data: Uint8Array | null = null;
  private __tnFam_request_dataCount: number | null = null;
  private __tnFamWriter_request_data?: __TnFamWriterResult<MultisigRequestBuilder>;

  constructor() {
    this.buffer = new Uint8Array(103);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_kind(value: number): this {
    this.view.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  set_status(value: number): this {
    this.view.setUint8(1, value);
    this.__tnInvalidate();
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint8(2, value);
    this.__tnInvalidate();
    return this;
  }

  set_member_cnt_snapshot(value: number): this {
    this.view.setUint16(3, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_required_approvals(value: number): this {
    this.view.setUint16(5, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_request_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_config_epoch_snapshot(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(15, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_approval_bitmap(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(23, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_request_data_sz(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(31, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_multisig_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("multisig_pubkey expects 32 bytes");
    this.buffer.set(value, 39);
    this.__tnInvalidate();
    return this;
  }

  set_proposer_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("proposer_pubkey expects 32 bytes");
    this.buffer.set(value, 71);
    this.__tnInvalidate();
    return this;
  }

  request_data(): __TnFamWriterResult<MultisigRequestBuilder> {
    if (!this.__tnFamWriter_request_data) {
      this.__tnFamWriter_request_data = __tnCreateFamWriter(this, "request_data", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_request_data = bytes;
        this.__tnFam_request_dataCount = elementCount;
        this.set_request_data_sz(__tnToBigInt(elementCount));
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_request_data!;
  }

  private __tnSyncLengths(): void {
    if (this.__tnFam_request_dataCount !== null) this.set_request_data_sz(__tnToBigInt(this.__tnFam_request_dataCount));
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = MultisigRequest.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = MultisigRequest.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("MultisigRequestBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): MultisigRequest {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = MultisigRequest.from_array(buffer, { params });
    if (!view) throw new Error("MultisigRequestBuilder: failed to finalize view");
    return view;
  }

  finishView(): MultisigRequest {
    return this.finish();
  }

  dynamicParams(): MultisigRequest.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): MultisigRequest.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = MultisigRequest.Params.fromValues({
      request_data_request_data_sz: (() => { if (this.__tnFam_request_dataCount === null) throw new Error("MultisigRequestBuilder: field 'request_data' must be written before computing params"); return __tnToBigInt(this.__tnFam_request_dataCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_request_data_bytes = this.__tnFam_request_data;
    if (!__tnLocal_request_data_bytes) throw new Error("MultisigRequestBuilder: field 'request_data' must be written before build");
    target.set(__tnLocal_request_data_bytes, cursor);
    cursor += __tnLocal_request_data_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: MultisigRequest.Params): void {
    const result = MultisigRequest.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ MultisigRequest }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("MultisigRequest", (params) => MultisigRequest.__tnInvokeFootprint(params));
__tnRegisterValidate("MultisigRequest", (buffer, params) => MultisigRequest.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MultisigRequest", (buffer) => { const result = MultisigRequest.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MultisigProgramAccount ----- */

const __tn_ir_MultisigProgramAccount = {
  typeName: "MultisigProgramAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class MultisigProgramAccount_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): MultisigProgramAccount_payload_Inner {
    return new MultisigProgramAccount_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MultisigProgramAccount_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["account_type"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "multisig_v1", tag: 1, payloadSize: 1047 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "request_v1", tag: 2, payloadSize: null };
    }
    return new MultisigProgramAccount_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asMultisigV1(): MultisigAccount | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return MultisigAccount.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRequestV1(): MultisigRequest | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return MultisigRequest.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class MultisigProgramAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: MultisigProgramAccount.Params;

  private constructor(private buffer: Uint8Array, params?: MultisigProgramAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = MultisigProgramAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("MultisigProgramAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: MultisigProgramAccount.Params, fieldContext?: Record<string, number | bigint> }): MultisigProgramAccount {
    if (!buffer || buffer.length === undefined) throw new Error("MultisigProgramAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = MultisigProgramAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("MultisigProgramAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new MultisigProgramAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): MultisigProgramAccount.Params {
    return this.__tnParams;
  }

  static builder(): MultisigProgramAccountBuilder {
    return new MultisigProgramAccountBuilder();
  }

  static fromBuilder(builder: MultisigProgramAccountBuilder): MultisigProgramAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return MultisigProgramAccount.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "multisig_v1",
      tag: 1,
      payloadSize: 1047,
      payloadType: "MultisigProgramAccount::payload::multisig_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MultisigAccount),
    },
    {
      name: "request_v1",
      tag: 2,
      payloadSize: null,
      payloadType: "MultisigProgramAccount::payload::request_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MultisigRequest),
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: MultisigProgramAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_account_type = __tnToBigInt(view.getUint8(0));
    const __tnLayout = MultisigProgramAccount.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = MultisigProgramAccount.Params.fromValues({
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

  payloadVariant(): typeof MultisigProgramAccount.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_account_type();
    return MultisigProgramAccount.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): MultisigProgramAccount_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("MultisigProgramAccount: unknown payload variant");
    const offset = MultisigProgramAccount.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("MultisigProgramAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return MultisigProgramAccount_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MultisigProgramAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MultisigProgramAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_account_type: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = MultisigProgramAccount.Params.fromValues({
      payload_account_type: payload_account_type,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: MultisigProgramAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.account_type"] = params.payload_account_type;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: MultisigProgramAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: MultisigProgramAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MultisigProgramAccount');
    return __tnBigIntToNumber(irResult, 'MultisigProgramAccount::footprintFromParams');
  }

  static footprintFromValues(input: { payload_account_type: number | bigint, payload_payload_size: number | bigint }): number {
    const params = MultisigProgramAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: MultisigProgramAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: MultisigProgramAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: MultisigProgramAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MultisigProgramAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MultisigProgramAccount::validate') : undefined;
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
  case 1n: t3 = 1047; break;
  case 2n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s4 = c;
if (c + 1 > b.length) return null; const x5 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
if (c + 1 > b.length) return null; const x6 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
if (c + 1 > b.length) return null; const x7 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
if (c + 2 > b.length) return null; const x8 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x9 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 8 > b.length) return null; const x10 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
if (c + 8 > b.length) return null; const x11 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
if (c + 8 > b.length) return null; const x12 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
if (c + 8 > b.length) return null; const x13 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s14 = c;
const av15 = v; const ao16 = c;
if (c + 32 > b.length) return null; c += 32;
void s14;
const s17 = c;
const av18 = v; const ao19 = c;
if (c + 32 > b.length) return null; c += 32;
void s17;
const n20 = x13; if (n20 === null || n20 < 0n) return null;
if (BigInt(c) + n20 * 1n > BigInt(b.length)) return null; c += Number(n20 * 1n);
void s4;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: MultisigProgramAccount.Params }): MultisigProgramAccount | null {
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
    const state = new MultisigProgramAccount(buffer, cached);
    return state;
  }


}

export namespace MultisigProgramAccount {
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

export class MultisigProgramAccountBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_account_type: number | null = null;
  private __tnPayload_payload: { descriptor: typeof MultisigProgramAccount.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: MultisigProgramAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: MultisigProgramAccount.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<MultisigProgramAccountBuilder>;

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

  payload(): __TnVariantSelectorResult<MultisigProgramAccountBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, MultisigProgramAccount.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_account_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("MultisigProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("MultisigProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = MultisigProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("MultisigProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("MultisigProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = MultisigProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("MultisigProgramAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): MultisigProgramAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = MultisigProgramAccount.from_array(buffer, { params });
    if (!view) throw new Error("MultisigProgramAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): MultisigProgramAccount {
    return this.finish();
  }

  dynamicParams(): MultisigProgramAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): MultisigProgramAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = MultisigProgramAccount.Params.fromValues({
      payload_account_type: (() => { if (this.__tnField_account_type === null) throw new Error("MultisigProgramAccountBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_account_type); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("MultisigProgramAccountBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_account_type === null) throw new Error("MultisigProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("MultisigProgramAccountBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_account_type);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: MultisigProgramAccount.Params): void {
    const result = MultisigProgramAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ MultisigProgramAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("MultisigProgramAccount", (params) => MultisigProgramAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("MultisigProgramAccount", (buffer, params) => MultisigProgramAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MultisigProgramAccount", (buffer) => { const result = MultisigProgramAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
