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

/* ----- TYPE DEFINITION FOR DestroyArgs ----- */

const __tn_ir_DestroyArgs = {
  typeName: "DestroyArgs",
  root: { op: "const", value: 4n }
} as const;

export class DestroyArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): DestroyArgs {
    if (!buffer || buffer.length === undefined) throw new Error("DestroyArgs.__tnCreateView requires a Uint8Array");
    return new DestroyArgs(new Uint8Array(buffer));
  }

  static builder(): DestroyArgsBuilder {
    return new DestroyArgsBuilder();
  }

  static fromBuilder(builder: DestroyArgsBuilder): DestroyArgs | null {
    const buffer = builder.build();
    return DestroyArgs.from_array(buffer);
  }

  get_buffer_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_buffer_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get buffer_account_idx(): number {
    return this.get_buffer_account_idx();
  }

  set buffer_account_idx(value: number) {
    this.set_buffer_account_idx(value);
  }

  get_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_DestroyArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_DestroyArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for DestroyArgs');
    }
    return __tnBigIntToNumber(irResult, 'DestroyArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 4) return { ok: false, code: "tn.buffer_too_small", consumed: 4 };
    return { ok: true, consumed: 4 };
  }

  static new(buffer_account_idx: number, meta_account_idx: number): DestroyArgs {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, buffer_account_idx, true); /* buffer_account_idx (little-endian) */
    view.setUint16(2, meta_account_idx, true); /* meta_account_idx (little-endian) */

    return new DestroyArgs(buffer);
  }

  static from_array(buffer: Uint8Array): DestroyArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new DestroyArgs(buffer);
  }

}

export class DestroyArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(4);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_buffer_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("DestroyArgs", DestroyArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("DestroyArgs", DestroyArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): DestroyArgs {
    const view = DestroyArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build DestroyArgs");
    return view;
  }
}

__tnRegisterFootprint("DestroyArgs", (params) => DestroyArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("DestroyArgs", (buffer, params) => DestroyArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("DestroyArgs", (buffer) => { const result = DestroyArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UploaderError ----- */

const __tn_ir_UploaderError = {
  typeName: "UploaderError",
  root: { op: "const", value: 8n }
} as const;

export class UploaderError_error_not_authorized_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_not_authorized_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_not_authorized_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_not_authorized_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_invalid_args_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_invalid_args_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_invalid_args_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_invalid_args_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_meta_account_missing_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_meta_account_missing_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_meta_account_missing_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_meta_account_missing_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_buffer_account_missing_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_buffer_account_missing_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_buffer_account_missing_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_buffer_account_missing_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_account_not_open_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_account_not_open_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_account_not_open_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_account_not_open_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_hash_mismatch_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_hash_mismatch_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_hash_mismatch_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_hash_mismatch_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_write_overflow_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_write_overflow_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_write_overflow_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_write_overflow_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_write_out_of_bounds_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_write_out_of_bounds_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_write_out_of_bounds_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_write_out_of_bounds_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_invalid_account_index_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_invalid_account_index_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_invalid_account_index_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_invalid_account_index_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_invalid_meta_size_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_invalid_meta_size_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_invalid_meta_size_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_invalid_meta_size_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_account_relationship_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_account_relationship_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_account_relationship_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_account_relationship_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_invalid_instruction_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_invalid_instruction_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError_error_invalid_instruction_Inner.__tnCreateView requires a Uint8Array");
    return new UploaderError_error_invalid_instruction_Inner(new Uint8Array(buffer));
  }

}

export class UploaderError_error_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): UploaderError_error_Inner {
    return new UploaderError_error_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError_error_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["code"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "not_authorized", tag: 1, payloadSize: 0 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "invalid_args", tag: 2, payloadSize: 0 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "meta_account_missing", tag: 3, payloadSize: 0 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "buffer_account_missing", tag: 4, payloadSize: 0 };
      if (__tnTagEquals(tag, 5)) descriptor = { name: "account_not_open", tag: 5, payloadSize: 0 };
      if (__tnTagEquals(tag, 6)) descriptor = { name: "hash_mismatch", tag: 6, payloadSize: 0 };
      if (__tnTagEquals(tag, 7)) descriptor = { name: "write_overflow", tag: 7, payloadSize: 0 };
      if (__tnTagEquals(tag, 8)) descriptor = { name: "write_out_of_bounds", tag: 8, payloadSize: 0 };
      if (__tnTagEquals(tag, 9)) descriptor = { name: "invalid_account_index", tag: 9, payloadSize: 0 };
      if (__tnTagEquals(tag, 10)) descriptor = { name: "invalid_meta_size", tag: 10, payloadSize: 0 };
      if (__tnTagEquals(tag, 11)) descriptor = { name: "account_relationship", tag: 11, payloadSize: 0 };
      if (__tnTagEquals(tag, 12)) descriptor = { name: "invalid_instruction", tag: 12, payloadSize: 0 };
    }
    return new UploaderError_error_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asNotAuthorized(): UploaderError_error_not_authorized_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return UploaderError_error_not_authorized_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidArgs(): UploaderError_error_invalid_args_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return UploaderError_error_invalid_args_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMetaAccountMissing(): UploaderError_error_meta_account_missing_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return UploaderError_error_meta_account_missing_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBufferAccountMissing(): UploaderError_error_buffer_account_missing_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return UploaderError_error_buffer_account_missing_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccountNotOpen(): UploaderError_error_account_not_open_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 5)) return null;
    return UploaderError_error_account_not_open_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asHashMismatch(): UploaderError_error_hash_mismatch_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 6)) return null;
    return UploaderError_error_hash_mismatch_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asWriteOverflow(): UploaderError_error_write_overflow_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 7)) return null;
    return UploaderError_error_write_overflow_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asWriteOutOfBounds(): UploaderError_error_write_out_of_bounds_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 8)) return null;
    return UploaderError_error_write_out_of_bounds_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidAccountIndex(): UploaderError_error_invalid_account_index_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 9)) return null;
    return UploaderError_error_invalid_account_index_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidMetaSize(): UploaderError_error_invalid_meta_size_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 10)) return null;
    return UploaderError_error_invalid_meta_size_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccountRelationship(): UploaderError_error_account_relationship_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 11)) return null;
    return UploaderError_error_account_relationship_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidInstruction(): UploaderError_error_invalid_instruction_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 12)) return null;
    return UploaderError_error_invalid_instruction_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class UploaderError {
  private view: DataView;
  private static readonly __tnFieldOffset_error = 8;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderError {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderError.__tnCreateView requires a Uint8Array");
    return new UploaderError(new Uint8Array(buffer));
  }

  static builder(): UploaderErrorBuilder {
    return new UploaderErrorBuilder();
  }

  static fromBuilder(builder: UploaderErrorBuilder): UploaderError | null {
    const buffer = builder.build();
    return UploaderError.from_array(buffer);
  }

  static readonly errorVariantDescriptors = Object.freeze([
    {
      name: "not_authorized",
      tag: 1,
      payloadSize: 0,
      payloadType: "UploaderError::error::not_authorized",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_args",
      tag: 2,
      payloadSize: 0,
      payloadType: "UploaderError::error::invalid_args",
      createPayloadBuilder: () => null,
    },
    {
      name: "meta_account_missing",
      tag: 3,
      payloadSize: 0,
      payloadType: "UploaderError::error::meta_account_missing",
      createPayloadBuilder: () => null,
    },
    {
      name: "buffer_account_missing",
      tag: 4,
      payloadSize: 0,
      payloadType: "UploaderError::error::buffer_account_missing",
      createPayloadBuilder: () => null,
    },
    {
      name: "account_not_open",
      tag: 5,
      payloadSize: 0,
      payloadType: "UploaderError::error::account_not_open",
      createPayloadBuilder: () => null,
    },
    {
      name: "hash_mismatch",
      tag: 6,
      payloadSize: 0,
      payloadType: "UploaderError::error::hash_mismatch",
      createPayloadBuilder: () => null,
    },
    {
      name: "write_overflow",
      tag: 7,
      payloadSize: 0,
      payloadType: "UploaderError::error::write_overflow",
      createPayloadBuilder: () => null,
    },
    {
      name: "write_out_of_bounds",
      tag: 8,
      payloadSize: 0,
      payloadType: "UploaderError::error::write_out_of_bounds",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_account_index",
      tag: 9,
      payloadSize: 0,
      payloadType: "UploaderError::error::invalid_account_index",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_meta_size",
      tag: 10,
      payloadSize: 0,
      payloadType: "UploaderError::error::invalid_meta_size",
      createPayloadBuilder: () => null,
    },
    {
      name: "account_relationship",
      tag: 11,
      payloadSize: 0,
      payloadType: "UploaderError::error::account_relationship",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_instruction",
      tag: 12,
      payloadSize: 0,
      payloadType: "UploaderError::error::invalid_instruction",
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

  errorVariant(): typeof UploaderError.errorVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_code();
    return UploaderError.errorVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  error(): UploaderError_error_Inner {
    const descriptor = this.errorVariant();
    if (!descriptor) throw new Error("UploaderError: unknown error variant");
    const offset = UploaderError.__tnFieldOffset_error;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("UploaderError: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return UploaderError_error_Inner.__tnCreate(slice, descriptor, undefined);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UploaderError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UploaderError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UploaderError');
    }
    return __tnBigIntToNumber(irResult, 'UploaderError::footprint');
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
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array): UploaderError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UploaderError(buffer);
  }

}

export class UploaderErrorBuilder {
  private tag: bigint | null = null;
  private payload: Uint8Array | null = null;

  constructor() {}

  select_not_authorized(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_not_authorized expects 0 bytes");
    this.tag = 1n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_args(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_args expects 0 bytes");
    this.tag = 2n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_meta_account_missing(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_meta_account_missing expects 0 bytes");
    this.tag = 3n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_buffer_account_missing(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_buffer_account_missing expects 0 bytes");
    this.tag = 4n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account_not_open(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account_not_open expects 0 bytes");
    this.tag = 5n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_hash_mismatch(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_hash_mismatch expects 0 bytes");
    this.tag = 6n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_write_overflow(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_write_overflow expects 0 bytes");
    this.tag = 7n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_write_out_of_bounds(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_write_out_of_bounds expects 0 bytes");
    this.tag = 8n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_account_index(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_account_index expects 0 bytes");
    this.tag = 9n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_meta_size(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_meta_size expects 0 bytes");
    this.tag = 10n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account_relationship(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account_relationship expects 0 bytes");
    this.tag = 11n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_instruction(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_instruction expects 0 bytes");
    this.tag = 12n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  build(): Uint8Array {
    if (this.tag === null || !this.payload) throw new Error("UploaderError builder missing variant");
    const buffer = new Uint8Array(8 + this.payload.length);
    new DataView(buffer.buffer).setBigUint64(0, this.tag, true);
    buffer.set(this.payload, 8);
    __tnBuilderValidateOrThrow("UploaderError", UploaderError.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const bytes = this.build();
    if (target.length - offset < bytes.length) throw new Error("target buffer too small");
    target.set(bytes, offset);
    return target;
  }

  finish(): UploaderError {
    const view = UploaderError.from_array(this.build());
    if (!view) throw new Error("failed to build UploaderError");
    return view;
  }
}

__tnRegisterFootprint("UploaderError", (params) => UploaderError.__tnInvokeFootprint(params));
__tnRegisterValidate("UploaderError", (buffer, params) => UploaderError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UploaderError", (buffer) => { const result = UploaderError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UploaderProgramMeta ----- */

const __tn_ir_UploaderProgramMeta = {
  typeName: "UploaderProgramMeta",
  root: { op: "const", value: 65n }
} as const;

export class UploaderProgramMeta {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderProgramMeta {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderProgramMeta.__tnCreateView requires a Uint8Array");
    return new UploaderProgramMeta(new Uint8Array(buffer));
  }

  static builder(): UploaderProgramMetaBuilder {
    return new UploaderProgramMetaBuilder();
  }

  static fromBuilder(builder: UploaderProgramMetaBuilder): UploaderProgramMeta | null {
    const buffer = builder.build();
    return UploaderProgramMeta.from_array(buffer);
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

  get_expected_account_hash(): Hash {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Hash.from_array(slice)!;
  }

  set_expected_account_hash(value: Hash): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get expected_account_hash(): Hash {
    return this.get_expected_account_hash();
  }

  set expected_account_hash(value: Hash) {
    this.set_expected_account_hash(value);
  }

  get_state(): number {
    const offset = 64;
    return this.view.getUint8(offset);
  }

  set_state(value: number): void {
    const offset = 64;
    this.view.setUint8(offset, value);
  }

  get state(): number {
    return this.get_state();
  }

  set state(value: number) {
    this.set_state(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UploaderProgramMeta.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UploaderProgramMeta, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UploaderProgramMeta');
    }
    return __tnBigIntToNumber(irResult, 'UploaderProgramMeta::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 65) return { ok: false, code: "tn.buffer_too_small", consumed: 65 };
    return { ok: true, consumed: 65 };
  }

  static from_array(buffer: Uint8Array): UploaderProgramMeta | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UploaderProgramMeta(buffer);
  }

}

export class UploaderProgramMetaBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(65);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_expected_account_hash(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("expected_account_hash expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_state(value: number): this {
    this.view.setUint8(64, value);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("UploaderProgramMeta", UploaderProgramMeta.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("UploaderProgramMeta", UploaderProgramMeta.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): UploaderProgramMeta {
    const view = UploaderProgramMeta.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build UploaderProgramMeta");
    return view;
  }
}

__tnRegisterFootprint("UploaderProgramMeta", (params) => UploaderProgramMeta.__tnInvokeFootprint(params));
__tnRegisterValidate("UploaderProgramMeta", (buffer, params) => UploaderProgramMeta.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UploaderProgramMeta", (buffer) => { const result = UploaderProgramMeta.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR WriteArgs ----- */

const __tn_ir_WriteArgs = {
  typeName: "WriteArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "data.data_len" }, right: { op: "const", value: 1n } } } } }
} as const;

export class WriteArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: WriteArgs.Params;

  private constructor(private buffer: Uint8Array, params?: WriteArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = WriteArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("WriteArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: WriteArgs.Params, fieldContext?: Record<string, number | bigint> }): WriteArgs {
    if (!buffer || buffer.length === undefined) throw new Error("WriteArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = WriteArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("WriteArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new WriteArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): WriteArgs.Params {
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
    throw new Error("WriteArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "WriteArgs::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("WriteArgs: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): WriteArgsBuilder {
    return new WriteArgsBuilder();
  }

  static fromBuilder(builder: WriteArgsBuilder): WriteArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return WriteArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "data", method: "data", sizeField: "data_len", paramKey: "data_len", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: WriteArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 8) {
      return null;
    }
    const __tnParam_data_data_len = __tnToBigInt(view.getUint32(4, true));
    const __tnExtractedParams = WriteArgs.Params.fromValues({
      data_data_len: __tnParam_data_data_len,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_buffer_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_buffer_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get buffer_account_idx(): number {
    return this.get_buffer_account_idx();
  }

  set buffer_account_idx(value: number) {
    this.set_buffer_account_idx(value);
  }

  get_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_data_len(): number {
    const offset = 4;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_data_len(value: number): void {
    const offset = 4;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get data_len(): number {
    return this.get_data_len();
  }

  set data_len(value: number) {
    this.set_data_len(value);
  }

  get_data_offset(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_data_offset(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get data_offset(): number {
    return this.get_data_offset();
  }

  set data_offset(value: number) {
    this.set_data_offset(value);
  }

  get_data_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("data_len"));
  }

  get_data_at(index: number): number {
    const offset = 12;
    return this.view.getUint8(offset + index * 1);
  }

  get_data(): number[] {
    const len = this.get_data_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_data_at(i));
    }
    return result;
  }

  set_data_at(index: number, value: number): void {
    const offset = 12;
    this.view.setUint8((offset + index * 1), value);
  }

  set_data(value: number[]): void {
    const len = Math.min(this.get_data_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_data_at(i, value[i]);
    }
  }

  get data(): number[] {
    return this.get_data();
  }

  set data(value: number[]) {
    this.set_data(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_WriteArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_WriteArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(data_data_len: number | bigint): bigint {
    const params = WriteArgs.Params.fromValues({
      data_data_len: data_data_len,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: WriteArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["data.data_len"] = params.data_data_len;
    return record;
  }

  static footprintIrFromParams(params: WriteArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: WriteArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for WriteArgs');
    return __tnBigIntToNumber(irResult, 'WriteArgs::footprintFromParams');
  }

  static footprintFromValues(input: { data_data_len: number | bigint }): number {
    const params = WriteArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: WriteArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: WriteArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: WriteArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'WriteArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'WriteArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: WriteArgs.Params }): WriteArgs | null {
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
    const state = new WriteArgs(buffer, cached);
    return state;
  }


}

export namespace WriteArgs {
  export type Params = {
    /** ABI path: data.data_len */
    readonly data_data_len: bigint;
  };

  export const ParamKeys = Object.freeze({
    data_data_len: "data.data_len",
  } as const);

  export const Params = {
    fromValues(input: { data_data_len: number | bigint }): Params {
      return {
        data_data_len: __tnToBigInt(input.data_data_len),
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

  export function params(input: { data_data_len: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class WriteArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: WriteArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: WriteArgs.Params | null = null;
  private __tnFam_data: Uint8Array | null = null;
  private __tnFam_dataCount: number | null = null;
  private __tnFamWriter_data?: __TnFamWriterResult<WriteArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(12);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_buffer_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_data_len(value: number): this {
    this.view.setUint32(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_data_offset(value: number): this {
    this.view.setUint32(8, value, true);
    this.__tnInvalidate();
    return this;
  }

  data(): __TnFamWriterResult<WriteArgsBuilder> {
    if (!this.__tnFamWriter_data) {
      this.__tnFamWriter_data = __tnCreateFamWriter(this, "data", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        if (elementCount > 4294967295) throw new Error("WriteArgsBuilder: data has more than 4294967295 elements");
        this.__tnFam_data = bytes;
        this.__tnFam_dataCount = elementCount;
        this.set_data_len(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_data!;
  }

  private __tnSyncLengths(): void {
    if (this.__tnFam_dataCount !== null) this.set_data_len(this.__tnFam_dataCount);
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = WriteArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = WriteArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("WriteArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): WriteArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = WriteArgs.from_array(buffer, { params });
    if (!view) throw new Error("WriteArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): WriteArgs {
    return this.finish();
  }

  dynamicParams(): WriteArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): WriteArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = WriteArgs.Params.fromValues({
      data_data_len: (() => { if (this.__tnFam_dataCount === null) throw new Error("WriteArgsBuilder: field 'data' must be written before computing params"); return __tnToBigInt(this.__tnFam_dataCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_data_bytes = this.__tnFam_data;
    if (!__tnLocal_data_bytes) throw new Error("WriteArgsBuilder: field 'data' must be written before build");
    target.set(__tnLocal_data_bytes, cursor);
    cursor += __tnLocal_data_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: WriteArgs.Params): void {
    const result = WriteArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ WriteArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("WriteArgs", (params) => WriteArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("WriteArgs", (buffer, params) => WriteArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("WriteArgs", (buffer) => { const result = WriteArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateArgs ----- */

const __tn_ir_CreateArgs = {
  typeName: "CreateArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "seed.seed_len" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateArgs.Params {
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
    throw new Error("CreateArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateArgs::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("CreateArgs: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateArgsBuilder {
    return new CreateArgsBuilder();
  }

  static fromBuilder(builder: CreateArgsBuilder): CreateArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "seed", method: "seed", sizeField: "seed_len", paramKey: "seed_len", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 46) {
      return null;
    }
    const __tnParam_seed_seed_len = __tnToBigInt(view.getUint32(42, true));
    const __tnExtractedParams = CreateArgs.Params.fromValues({
      seed_seed_len: __tnParam_seed_seed_len,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_buffer_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_buffer_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get buffer_account_idx(): number {
    return this.get_buffer_account_idx();
  }

  set buffer_account_idx(value: number) {
    this.set_buffer_account_idx(value);
  }

  get_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_buffer_account_sz(): number {
    const offset = 6;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_buffer_account_sz(value: number): void {
    const offset = 6;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get buffer_account_sz(): number {
    return this.get_buffer_account_sz();
  }

  set buffer_account_sz(value: number) {
    this.set_buffer_account_sz(value);
  }

  get_expected_account_hash(): Hash {
    const offset = 10;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Hash.from_array(slice)!;
  }

  set_expected_account_hash(value: Hash): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 10;
    this.buffer.set(sourceBytes, offset);
  }

  get expected_account_hash(): Hash {
    return this.get_expected_account_hash();
  }

  set expected_account_hash(value: Hash) {
    this.set_expected_account_hash(value);
  }

  get_seed_len(): number {
    const offset = 42;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seed_len(value: number): void {
    const offset = 42;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seed_len(): number {
    return this.get_seed_len();
  }

  set seed_len(value: number) {
    this.set_seed_len(value);
  }

  get_seed_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("seed_len"));
  }

  get_seed_at(index: number): number {
    const offset = 46;
    return this.view.getUint8(offset + index * 1);
  }

  get_seed(): number[] {
    const len = this.get_seed_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_seed_at(i));
    }
    return result;
  }

  set_seed_at(index: number, value: number): void {
    const offset = 46;
    this.view.setUint8((offset + index * 1), value);
  }

  set_seed(value: number[]): void {
    const len = Math.min(this.get_seed_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_seed_at(i, value[i]);
    }
  }

  get seed(): number[] {
    return this.get_seed();
  }

  set seed(value: number[]) {
    this.set_seed(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(seed_seed_len: number | bigint): bigint {
    const params = CreateArgs.Params.fromValues({
      seed_seed_len: seed_seed_len,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["seed.seed_len"] = params.seed_seed_len;
    return record;
  }

  static footprintIrFromParams(params: CreateArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateArgs');
    return __tnBigIntToNumber(irResult, 'CreateArgs::footprintFromParams');
  }

  static footprintFromValues(input: { seed_seed_len: number | bigint }): number {
    const params = CreateArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateArgs.Params }): CreateArgs | null {
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
    const state = new CreateArgs(buffer, cached);
    return state;
  }


}

export namespace CreateArgs {
  export type Params = {
    /** ABI path: seed.seed_len */
    readonly seed_seed_len: bigint;
  };

  export const ParamKeys = Object.freeze({
    seed_seed_len: "seed.seed_len",
  } as const);

  export const Params = {
    fromValues(input: { seed_seed_len: number | bigint }): Params {
      return {
        seed_seed_len: __tnToBigInt(input.seed_seed_len),
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

  export function params(input: { seed_seed_len: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateArgs.Params | null = null;
  private __tnFam_seed: Uint8Array | null = null;
  private __tnFam_seedCount: number | null = null;
  private __tnFamWriter_seed?: __TnFamWriterResult<CreateArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(46);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_buffer_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_buffer_account_sz(value: number): this {
    this.view.setUint32(6, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_expected_account_hash(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("expected_account_hash expects 32 bytes");
    this.buffer.set(value, 10);
    this.__tnInvalidate();
    return this;
  }

  set_seed_len(value: number): this {
    this.view.setUint32(42, value, true);
    this.__tnInvalidate();
    return this;
  }

  seed(): __TnFamWriterResult<CreateArgsBuilder> {
    if (!this.__tnFamWriter_seed) {
      this.__tnFamWriter_seed = __tnCreateFamWriter(this, "seed", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        if (elementCount > 4294967295) throw new Error("CreateArgsBuilder: seed has more than 4294967295 elements");
        this.__tnFam_seed = bytes;
        this.__tnFam_seedCount = elementCount;
        this.set_seed_len(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_seed!;
  }

  private __tnSyncLengths(): void {
    if (this.__tnFam_seedCount !== null) this.set_seed_len(this.__tnFam_seedCount);
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = CreateArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = CreateArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateArgs {
    return this.finish();
  }

  dynamicParams(): CreateArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateArgs.Params.fromValues({
      seed_seed_len: (() => { if (this.__tnFam_seedCount === null) throw new Error("CreateArgsBuilder: field 'seed' must be written before computing params"); return __tnToBigInt(this.__tnFam_seedCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_seed_bytes = this.__tnFam_seed;
    if (!__tnLocal_seed_bytes) throw new Error("CreateArgsBuilder: field 'seed' must be written before build");
    target.set(__tnLocal_seed_bytes, cursor);
    cursor += __tnLocal_seed_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateArgs.Params): void {
    const result = CreateArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateArgs", (params) => CreateArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateArgs", (buffer, params) => CreateArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateArgs", (buffer) => { const result = CreateArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FinalizeArgs ----- */

const __tn_ir_FinalizeArgs = {
  typeName: "FinalizeArgs",
  root: { op: "const", value: 36n }
} as const;

export class FinalizeArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FinalizeArgs {
    if (!buffer || buffer.length === undefined) throw new Error("FinalizeArgs.__tnCreateView requires a Uint8Array");
    return new FinalizeArgs(new Uint8Array(buffer));
  }

  static builder(): FinalizeArgsBuilder {
    return new FinalizeArgsBuilder();
  }

  static fromBuilder(builder: FinalizeArgsBuilder): FinalizeArgs | null {
    const buffer = builder.build();
    return FinalizeArgs.from_array(buffer);
  }

  get_buffer_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_buffer_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get buffer_account_idx(): number {
    return this.get_buffer_account_idx();
  }

  set buffer_account_idx(value: number) {
    this.set_buffer_account_idx(value);
  }

  get_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_expected_account_hash(): Hash {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Hash.from_array(slice)!;
  }

  set_expected_account_hash(value: Hash): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
    this.buffer.set(sourceBytes, offset);
  }

  get expected_account_hash(): Hash {
    return this.get_expected_account_hash();
  }

  set expected_account_hash(value: Hash) {
    this.set_expected_account_hash(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FinalizeArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FinalizeArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FinalizeArgs');
    }
    return __tnBigIntToNumber(irResult, 'FinalizeArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 36) return { ok: false, code: "tn.buffer_too_small", consumed: 36 };
    return { ok: true, consumed: 36 };
  }

  static from_array(buffer: Uint8Array): FinalizeArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FinalizeArgs(buffer);
  }

}

export class FinalizeArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(36);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_buffer_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_expected_account_hash(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("expected_account_hash expects 32 bytes");
    this.buffer.set(value, 4);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("FinalizeArgs", FinalizeArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("FinalizeArgs", FinalizeArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FinalizeArgs {
    const view = FinalizeArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FinalizeArgs");
    return view;
  }
}

__tnRegisterFootprint("FinalizeArgs", (params) => FinalizeArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("FinalizeArgs", (buffer, params) => FinalizeArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FinalizeArgs", (buffer) => { const result = FinalizeArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UploaderInstruction ----- */

const __tn_ir_UploaderInstruction = {
  typeName: "UploaderInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 4n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class UploaderInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): UploaderInstruction_payload_Inner {
    return new UploaderInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderInstruction_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["tag"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 0)) descriptor = { name: "create", tag: 0, payloadSize: null };
      if (__tnTagEquals(tag, 1)) descriptor = { name: "write", tag: 1, payloadSize: null };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "destroy", tag: 2, payloadSize: 4 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "finalize", tag: 3, payloadSize: 36 };
    }
    return new UploaderInstruction_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreate(): CreateArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 0)) return null;
    return CreateArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asWrite(): WriteArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return WriteArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asDestroy(): DestroyArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return DestroyArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFinalize(): FinalizeArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return FinalizeArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class UploaderInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 4;
  private __tnParams: UploaderInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: UploaderInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = UploaderInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("UploaderInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: UploaderInstruction.Params, fieldContext?: Record<string, number | bigint> }): UploaderInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = UploaderInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("UploaderInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new UploaderInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): UploaderInstruction.Params {
    return this.__tnParams;
  }

  static builder(): UploaderInstructionBuilder {
    return new UploaderInstructionBuilder();
  }

  static fromBuilder(builder: UploaderInstructionBuilder): UploaderInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return UploaderInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create",
      tag: 0,
      payloadSize: null,
      payloadType: "UploaderInstruction::payload::create",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateArgs),
    },
    {
      name: "write",
      tag: 1,
      payloadSize: null,
      payloadType: "UploaderInstruction::payload::write",
      createPayloadBuilder: () => __tnMaybeCallBuilder(WriteArgs),
    },
    {
      name: "destroy",
      tag: 2,
      payloadSize: 4,
      payloadType: "UploaderInstruction::payload::destroy",
      createPayloadBuilder: () => __tnMaybeCallBuilder(DestroyArgs),
    },
    {
      name: "finalize",
      tag: 3,
      payloadSize: 36,
      payloadType: "UploaderInstruction::payload::finalize",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FinalizeArgs),
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: UploaderInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_payload_tag = __tnToBigInt(view.getUint32(0, true));
    const __tnLayout = UploaderInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = UploaderInstruction.Params.fromValues({
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

  payloadVariant(): typeof UploaderInstruction.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_tag();
    return UploaderInstruction.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): UploaderInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("UploaderInstruction: unknown payload variant");
    const offset = UploaderInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("UploaderInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return UploaderInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UploaderInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UploaderInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_payload_size: number | bigint, payload_tag: number | bigint): bigint {
    const params = UploaderInstruction.Params.fromValues({
      payload_payload_size: payload_payload_size,
      payload_tag: payload_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: UploaderInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.payload_size"] = params.payload_payload_size;
    record["payload.tag"] = params.payload_tag;
    return record;
  }

  static footprintIrFromParams(params: UploaderInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: UploaderInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UploaderInstruction');
    return __tnBigIntToNumber(irResult, 'UploaderInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): number {
    const params = UploaderInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: UploaderInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: UploaderInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: UploaderInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'UploaderInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'UploaderInstruction::validate') : undefined;
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
if (c + 4 > b.length) return null; const x8 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
const s9 = c;
const av10 = v; const ao11 = c;
if (c + 32 > b.length) return null; c += 32;
void s9;
if (c + 4 > b.length) return null; const x12 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
const n13 = x12; if (n13 === null || n13 < 0n) return null;
if (BigInt(c) + n13 * 1n > BigInt(b.length)) return null; c += Number(n13 * 1n);
void s4;
return c; })(b.subarray(c)); break;
  case 1n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s14 = c;
if (c + 2 > b.length) return null; const x15 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x16 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 4 > b.length) return null; const x17 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x18 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
const n19 = x17; if (n19 === null || n19 < 0n) return null;
if (BigInt(c) + n19 * 1n > BigInt(b.length)) return null; c += Number(n19 * 1n);
void s14;
return c; })(b.subarray(c)); break;
  case 2n: t3 = 4; break;
  case 3n: t3 = 36; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: UploaderInstruction.Params }): UploaderInstruction | null {
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
    const state = new UploaderInstruction(buffer, cached);
    return state;
  }


}

export namespace UploaderInstruction {
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

export class UploaderInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof UploaderInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: UploaderInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: UploaderInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<UploaderInstructionBuilder>;

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

  payload(): __TnVariantSelectorResult<UploaderInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, UploaderInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("UploaderInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("UploaderInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = UploaderInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("UploaderInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("UploaderInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = UploaderInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("UploaderInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): UploaderInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = UploaderInstruction.from_array(buffer, { params });
    if (!view) throw new Error("UploaderInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): UploaderInstruction {
    return this.finish();
  }

  dynamicParams(): UploaderInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): UploaderInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = UploaderInstruction.Params.fromValues({
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("UploaderInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
      payload_tag: (() => { if (this.__tnField_tag === null) throw new Error("UploaderInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_tag === null) throw new Error("UploaderInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("UploaderInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint32(0, this.__tnField_tag, true);
    target.set(this.__tnPayload_payload.bytes, 4);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: UploaderInstruction.Params): void {
    const result = UploaderInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ UploaderInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("UploaderInstruction", (params) => UploaderInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("UploaderInstruction", (buffer, params) => UploaderInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UploaderInstruction", (buffer) => { const result = UploaderInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UploaderProgramAccount ----- */

const __tn_ir_UploaderProgramAccount = {
  typeName: "UploaderProgramAccount",
  root: { op: "const", value: 66n }
} as const;

export class UploaderProgramAccount_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): UploaderProgramAccount_payload_Inner {
    return new UploaderProgramAccount_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderProgramAccount_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["account_type"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "meta_v1", tag: 1, payloadSize: 65 };
    }
    return new UploaderProgramAccount_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asMetaV1(): UploaderProgramMeta | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return UploaderProgramMeta.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class UploaderProgramAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UploaderProgramAccount {
    if (!buffer || buffer.length === undefined) throw new Error("UploaderProgramAccount.__tnCreateView requires a Uint8Array");
    return new UploaderProgramAccount(new Uint8Array(buffer));
  }

  static builder(): UploaderProgramAccountBuilder {
    return new UploaderProgramAccountBuilder();
  }

  static fromBuilder(builder: UploaderProgramAccountBuilder): UploaderProgramAccount | null {
    const buffer = builder.build();
    return UploaderProgramAccount.from_array(buffer);
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "meta_v1",
      tag: 1,
      payloadSize: 65,
      payloadType: "UploaderProgramAccount::payload::meta_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UploaderProgramMeta),
    },
  ] as const);

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

  payloadVariant(): typeof UploaderProgramAccount.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_account_type();
    return UploaderProgramAccount.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): UploaderProgramAccount_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("UploaderProgramAccount: unknown payload variant");
    const offset = UploaderProgramAccount.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("UploaderProgramAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return UploaderProgramAccount_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UploaderProgramAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UploaderProgramAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UploaderProgramAccount');
    }
    return __tnBigIntToNumber(irResult, 'UploaderProgramAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 66) return { ok: false, code: "tn.buffer_too_small", consumed: 66 };
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed: 66 };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 1 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
let t3: number | null = null;
switch ((x2) as bigint | null) {
  case 1n: t3 = 65; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array): UploaderProgramAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UploaderProgramAccount(buffer);
  }

}

export class UploaderProgramAccountBuilder {
  private tag: number | null = null;
  private payload: Uint8Array | null = null;

  constructor() {}

  select_meta_v1(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 65) throw new Error("select_meta_v1 expects 65 bytes");
    this.tag = 1;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  build(): Uint8Array {
    if (this.tag === null || !this.payload) throw new Error("UploaderProgramAccount builder missing variant");
    const buffer = new Uint8Array(1 + this.payload.length);
    new DataView(buffer.buffer).setUint8(0, this.tag);
    buffer.set(this.payload, 1);
    __tnBuilderValidateOrThrow("UploaderProgramAccount", UploaderProgramAccount.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const bytes = this.build();
    if (target.length - offset < bytes.length) throw new Error("target buffer too small");
    target.set(bytes, offset);
    return target;
  }

  finish(): UploaderProgramAccount {
    const view = UploaderProgramAccount.from_array(this.build());
    if (!view) throw new Error("failed to build UploaderProgramAccount");
    return view;
  }
}

__tnRegisterFootprint("UploaderProgramAccount", (params) => UploaderProgramAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("UploaderProgramAccount", (buffer, params) => UploaderProgramAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UploaderProgramAccount", (buffer) => { const result = UploaderProgramAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
