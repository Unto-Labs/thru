/* Auto-generated TypeScript code */
/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */

import { StateProof } from "../../blockchain/state_proof/types";
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

__tnRegisterFootprint("StateProof", (params) => StateProof.__tnInvokeFootprint(params));
__tnRegisterValidate("StateProof", (buffer, params) => StateProof.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("StateProof", (buffer) => { const result = StateProof.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiManagerError ----- */

const __tn_ir_AbiManagerError = {
  typeName: "AbiManagerError",
  root: { op: "const", value: 2n }
} as const;

export class AbiManagerError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AbiManagerError {
    if (!buffer || buffer.length === undefined) throw new Error("AbiManagerError.__tnCreateView requires a Uint8Array");
    return new AbiManagerError(new Uint8Array(buffer));
  }

  static builder(): AbiManagerErrorBuilder {
    return new AbiManagerErrorBuilder();
  }

  static fromBuilder(builder: AbiManagerErrorBuilder): AbiManagerError | null {
    const buffer = builder.build();
    return AbiManagerError.from_array(buffer);
  }

  get_code(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_code(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get code(): number {
    return this.get_code();
  }

  set code(value: number) {
    this.set_code(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiManagerError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiManagerError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiManagerError');
    }
    return __tnBigIntToNumber(irResult, 'AbiManagerError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 2) return { ok: false, code: "tn.buffer_too_small", consumed: 2 };
    return { ok: true, consumed: 2 };
  }

  static new(code: number): AbiManagerError {
    const buffer = new Uint8Array(2);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, code, true); /* code (little-endian) */

    return new AbiManagerError(buffer);
  }

  static from_array(buffer: Uint8Array): AbiManagerError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AbiManagerError(buffer);
  }

}

export class AbiManagerErrorBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(2);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_code(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("AbiManagerError", AbiManagerError.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("AbiManagerError", AbiManagerError.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): AbiManagerError {
    const view = AbiManagerError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AbiManagerError");
    return view;
  }
}

__tnRegisterFootprint("AbiManagerError", (params) => AbiManagerError.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiManagerError", (buffer, params) => AbiManagerError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiManagerError", (buffer) => { const result = AbiManagerError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CloseAbiExternalArgs ----- */

const __tn_ir_CloseAbiExternalArgs = {
  typeName: "CloseAbiExternalArgs",
  root: { op: "const", value: 6n }
} as const;

export class CloseAbiExternalArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CloseAbiExternalArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CloseAbiExternalArgs.__tnCreateView requires a Uint8Array");
    return new CloseAbiExternalArgs(new Uint8Array(buffer));
  }

  static builder(): CloseAbiExternalArgsBuilder {
    return new CloseAbiExternalArgsBuilder();
  }

  static fromBuilder(builder: CloseAbiExternalArgsBuilder): CloseAbiExternalArgs | null {
    const buffer = builder.build();
    return CloseAbiExternalArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CloseAbiExternalArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CloseAbiExternalArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CloseAbiExternalArgs');
    }
    return __tnBigIntToNumber(irResult, 'CloseAbiExternalArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(abi_meta_account_idx: number, abi_account_idx: number, authority_account_idx: number): CloseAbiExternalArgs {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(4, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new CloseAbiExternalArgs(buffer);
  }

  static from_array(buffer: Uint8Array): CloseAbiExternalArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CloseAbiExternalArgs(buffer);
  }

}

export class CloseAbiExternalArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CloseAbiExternalArgs", CloseAbiExternalArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CloseAbiExternalArgs", CloseAbiExternalArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CloseAbiExternalArgs {
    const view = CloseAbiExternalArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CloseAbiExternalArgs");
    return view;
  }
}

__tnRegisterFootprint("CloseAbiExternalArgs", (params) => CloseAbiExternalArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CloseAbiExternalArgs", (buffer, params) => CloseAbiExternalArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CloseAbiExternalArgs", (buffer) => { const result = CloseAbiExternalArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CloseAbiOfficialArgs ----- */

const __tn_ir_CloseAbiOfficialArgs = {
  typeName: "CloseAbiOfficialArgs",
  root: { op: "const", value: 8n }
} as const;

export class CloseAbiOfficialArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CloseAbiOfficialArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CloseAbiOfficialArgs.__tnCreateView requires a Uint8Array");
    return new CloseAbiOfficialArgs(new Uint8Array(buffer));
  }

  static builder(): CloseAbiOfficialArgsBuilder {
    return new CloseAbiOfficialArgsBuilder();
  }

  static fromBuilder(builder: CloseAbiOfficialArgsBuilder): CloseAbiOfficialArgs | null {
    const buffer = builder.build();
    return CloseAbiOfficialArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CloseAbiOfficialArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CloseAbiOfficialArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CloseAbiOfficialArgs');
    }
    return __tnBigIntToNumber(irResult, 'CloseAbiOfficialArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(abi_meta_account_idx: number, program_meta_account_idx: number, abi_account_idx: number, authority_account_idx: number): CloseAbiOfficialArgs {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, program_meta_account_idx, true); /* program_meta_account_idx (little-endian) */
    view.setUint16(4, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(6, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new CloseAbiOfficialArgs(buffer);
  }

  static from_array(buffer: Uint8Array): CloseAbiOfficialArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CloseAbiOfficialArgs(buffer);
  }

}

export class CloseAbiOfficialArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CloseAbiOfficialArgs", CloseAbiOfficialArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CloseAbiOfficialArgs", CloseAbiOfficialArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CloseAbiOfficialArgs {
    const view = CloseAbiOfficialArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CloseAbiOfficialArgs");
    return view;
  }
}

__tnRegisterFootprint("CloseAbiOfficialArgs", (params) => CloseAbiOfficialArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CloseAbiOfficialArgs", (buffer, params) => CloseAbiOfficialArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CloseAbiOfficialArgs", (buffer) => { const result = CloseAbiOfficialArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateMetaOfficialEphemeralArgs ----- */

const __tn_ir_CreateMetaOfficialEphemeralArgs = {
  typeName: "CreateMetaOfficialEphemeralArgs",
  root: { op: "const", value: 6n }
} as const;

export class CreateMetaOfficialEphemeralArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreateMetaOfficialEphemeralArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateMetaOfficialEphemeralArgs.__tnCreateView requires a Uint8Array");
    return new CreateMetaOfficialEphemeralArgs(new Uint8Array(buffer));
  }

  static builder(): CreateMetaOfficialEphemeralArgsBuilder {
    return new CreateMetaOfficialEphemeralArgsBuilder();
  }

  static fromBuilder(builder: CreateMetaOfficialEphemeralArgsBuilder): CreateMetaOfficialEphemeralArgs | null {
    const buffer = builder.build();
    return CreateMetaOfficialEphemeralArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateMetaOfficialEphemeralArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateMetaOfficialEphemeralArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateMetaOfficialEphemeralArgs');
    }
    return __tnBigIntToNumber(irResult, 'CreateMetaOfficialEphemeralArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(abi_meta_account_idx: number, program_meta_account_idx: number, authority_account_idx: number): CreateMetaOfficialEphemeralArgs {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, program_meta_account_idx, true); /* program_meta_account_idx (little-endian) */
    view.setUint16(4, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new CreateMetaOfficialEphemeralArgs(buffer);
  }

  static from_array(buffer: Uint8Array): CreateMetaOfficialEphemeralArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreateMetaOfficialEphemeralArgs(buffer);
  }

}

export class CreateMetaOfficialEphemeralArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CreateMetaOfficialEphemeralArgs", CreateMetaOfficialEphemeralArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CreateMetaOfficialEphemeralArgs", CreateMetaOfficialEphemeralArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CreateMetaOfficialEphemeralArgs {
    const view = CreateMetaOfficialEphemeralArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreateMetaOfficialEphemeralArgs");
    return view;
  }
}

__tnRegisterFootprint("CreateMetaOfficialEphemeralArgs", (params) => CreateMetaOfficialEphemeralArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateMetaOfficialEphemeralArgs", (buffer, params) => CreateMetaOfficialEphemeralArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateMetaOfficialEphemeralArgs", (buffer) => { const result = CreateMetaOfficialEphemeralArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FinalizeAbiExternalArgs ----- */

const __tn_ir_FinalizeAbiExternalArgs = {
  typeName: "FinalizeAbiExternalArgs",
  root: { op: "const", value: 6n }
} as const;

export class FinalizeAbiExternalArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FinalizeAbiExternalArgs {
    if (!buffer || buffer.length === undefined) throw new Error("FinalizeAbiExternalArgs.__tnCreateView requires a Uint8Array");
    return new FinalizeAbiExternalArgs(new Uint8Array(buffer));
  }

  static builder(): FinalizeAbiExternalArgsBuilder {
    return new FinalizeAbiExternalArgsBuilder();
  }

  static fromBuilder(builder: FinalizeAbiExternalArgsBuilder): FinalizeAbiExternalArgs | null {
    const buffer = builder.build();
    return FinalizeAbiExternalArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FinalizeAbiExternalArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FinalizeAbiExternalArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FinalizeAbiExternalArgs');
    }
    return __tnBigIntToNumber(irResult, 'FinalizeAbiExternalArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(abi_meta_account_idx: number, abi_account_idx: number, authority_account_idx: number): FinalizeAbiExternalArgs {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(4, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new FinalizeAbiExternalArgs(buffer);
  }

  static from_array(buffer: Uint8Array): FinalizeAbiExternalArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FinalizeAbiExternalArgs(buffer);
  }

}

export class FinalizeAbiExternalArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("FinalizeAbiExternalArgs", FinalizeAbiExternalArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("FinalizeAbiExternalArgs", FinalizeAbiExternalArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FinalizeAbiExternalArgs {
    const view = FinalizeAbiExternalArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FinalizeAbiExternalArgs");
    return view;
  }
}

__tnRegisterFootprint("FinalizeAbiExternalArgs", (params) => FinalizeAbiExternalArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("FinalizeAbiExternalArgs", (buffer, params) => FinalizeAbiExternalArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FinalizeAbiExternalArgs", (buffer) => { const result = FinalizeAbiExternalArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FinalizeAbiOfficialArgs ----- */

const __tn_ir_FinalizeAbiOfficialArgs = {
  typeName: "FinalizeAbiOfficialArgs",
  root: { op: "const", value: 8n }
} as const;

export class FinalizeAbiOfficialArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FinalizeAbiOfficialArgs {
    if (!buffer || buffer.length === undefined) throw new Error("FinalizeAbiOfficialArgs.__tnCreateView requires a Uint8Array");
    return new FinalizeAbiOfficialArgs(new Uint8Array(buffer));
  }

  static builder(): FinalizeAbiOfficialArgsBuilder {
    return new FinalizeAbiOfficialArgsBuilder();
  }

  static fromBuilder(builder: FinalizeAbiOfficialArgsBuilder): FinalizeAbiOfficialArgs | null {
    const buffer = builder.build();
    return FinalizeAbiOfficialArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FinalizeAbiOfficialArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FinalizeAbiOfficialArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FinalizeAbiOfficialArgs');
    }
    return __tnBigIntToNumber(irResult, 'FinalizeAbiOfficialArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(abi_meta_account_idx: number, program_meta_account_idx: number, abi_account_idx: number, authority_account_idx: number): FinalizeAbiOfficialArgs {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, program_meta_account_idx, true); /* program_meta_account_idx (little-endian) */
    view.setUint16(4, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(6, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new FinalizeAbiOfficialArgs(buffer);
  }

  static from_array(buffer: Uint8Array): FinalizeAbiOfficialArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FinalizeAbiOfficialArgs(buffer);
  }

}

export class FinalizeAbiOfficialArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("FinalizeAbiOfficialArgs", FinalizeAbiOfficialArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("FinalizeAbiOfficialArgs", FinalizeAbiOfficialArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FinalizeAbiOfficialArgs {
    const view = FinalizeAbiOfficialArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FinalizeAbiOfficialArgs");
    return view;
  }
}

__tnRegisterFootprint("FinalizeAbiOfficialArgs", (params) => FinalizeAbiOfficialArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("FinalizeAbiOfficialArgs", (buffer, params) => FinalizeAbiOfficialArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FinalizeAbiOfficialArgs", (buffer) => { const result = FinalizeAbiOfficialArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR Seed32 ----- */

const __tn_ir_Seed32 = {
  typeName: "Seed32",
  root: { op: "const", value: 32n }
} as const;

export class Seed32 {
  private view: DataView;
  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  private static readonly __tnElementSize = 1;
  private static readonly __tnElementCount: number | null = 32;

  get length(): number {
    const explicit = Seed32.__tnElementCount;
    if (explicit !== null) {
      return explicit;
    }
    const stride = Seed32.__tnElementSize;
    if (stride > 0) {
      return Math.floor(this.buffer.length / stride);
    }
    return this.buffer.length;
  }

  getElementBytes(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError('Seed32::getElementBytes index must be a non-negative integer');
    }
    const stride = Seed32.__tnElementSize;
    if (stride <= 0) {
      throw new Error('Seed32::getElementBytes requires constant element size');
    }
    const start = index * stride;
    const end = start + stride;
    if (end > this.buffer.length) {
      throw new RangeError('Seed32::getElementBytes out of bounds');
    }
    return this.buffer.subarray(start, end);
  }

  static from_array(buffer: Uint8Array): Seed32 | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const validation = Seed32.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Seed32(buffer);
  }

  asUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_Seed32.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Seed32, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Seed32');
    }
    return __tnBigIntToNumber(irResult, 'Seed32::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 32) return { ok: false, code: "tn.buffer_too_small", consumed: 32 };
    return { ok: true, consumed: 32 };
  }

}

__tnRegisterFootprint("Seed32", (params) => Seed32.__tnInvokeFootprint(params));
__tnRegisterValidate("Seed32", (buffer, params) => Seed32.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("Seed32", (buffer) => { const result = Seed32.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpgradeAbiExternalArgs ----- */

const __tn_ir_UpgradeAbiExternalArgs = {
  typeName: "UpgradeAbiExternalArgs",
  root: { op: "const", value: 48n }
} as const;

export class UpgradeAbiExternalArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UpgradeAbiExternalArgs {
    if (!buffer || buffer.length === undefined) throw new Error("UpgradeAbiExternalArgs.__tnCreateView requires a Uint8Array");
    return new UpgradeAbiExternalArgs(new Uint8Array(buffer));
  }

  static builder(): UpgradeAbiExternalArgsBuilder {
    return new UpgradeAbiExternalArgsBuilder();
  }

  static fromBuilder(builder: UpgradeAbiExternalArgsBuilder): UpgradeAbiExternalArgs | null {
    const buffer = builder.build();
    return UpgradeAbiExternalArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_srcbuf_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_srcbuf_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get srcbuf_account_idx(): number {
    return this.get_srcbuf_account_idx();
  }

  set srcbuf_account_idx(value: number) {
    this.set_srcbuf_account_idx(value);
  }

  get_srcbuf_offset(): number {
    const offset = 6;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_offset(value: number): void {
    const offset = 6;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_offset(): number {
    return this.get_srcbuf_offset();
  }

  set srcbuf_offset(value: number) {
    this.set_srcbuf_offset(value);
  }

  get_srcbuf_size(): number {
    const offset = 10;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_size(value: number): void {
    const offset = 10;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_size(): number {
    return this.get_srcbuf_size();
  }

  set srcbuf_size(value: number) {
    this.set_srcbuf_size(value);
  }

  get_srcbuf_sha256(): Seed32 {
    const offset = 14;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_srcbuf_sha256(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 14;
    this.buffer.set(sourceBytes, offset);
  }

  get srcbuf_sha256(): Seed32 {
    return this.get_srcbuf_sha256();
  }

  set srcbuf_sha256(value: Seed32) {
    this.set_srcbuf_sha256(value);
  }

  get_authority_account_idx(): number {
    const offset = 46;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 46;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UpgradeAbiExternalArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UpgradeAbiExternalArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UpgradeAbiExternalArgs');
    }
    return __tnBigIntToNumber(irResult, 'UpgradeAbiExternalArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 48) return { ok: false, code: "tn.buffer_too_small", consumed: 48 };
    return { ok: true, consumed: 48 };
  }

  static from_array(buffer: Uint8Array): UpgradeAbiExternalArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UpgradeAbiExternalArgs(buffer);
  }

}

export class UpgradeAbiExternalArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(48);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_srcbuf_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_srcbuf_offset(value: number): this {
    this.view.setUint32(6, value, true);
    return this;
  }

  set_srcbuf_size(value: number): this {
    this.view.setUint32(10, value, true);
    return this;
  }

  set_srcbuf_sha256(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("srcbuf_sha256 expects 32 bytes");
    this.buffer.set(value, 14);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(46, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("UpgradeAbiExternalArgs", UpgradeAbiExternalArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("UpgradeAbiExternalArgs", UpgradeAbiExternalArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): UpgradeAbiExternalArgs {
    const view = UpgradeAbiExternalArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build UpgradeAbiExternalArgs");
    return view;
  }
}

__tnRegisterFootprint("UpgradeAbiExternalArgs", (params) => UpgradeAbiExternalArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("UpgradeAbiExternalArgs", (buffer, params) => UpgradeAbiExternalArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UpgradeAbiExternalArgs", (buffer) => { const result = UpgradeAbiExternalArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpgradeAbiOfficialArgs ----- */

const __tn_ir_UpgradeAbiOfficialArgs = {
  typeName: "UpgradeAbiOfficialArgs",
  root: { op: "const", value: 50n }
} as const;

export class UpgradeAbiOfficialArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UpgradeAbiOfficialArgs {
    if (!buffer || buffer.length === undefined) throw new Error("UpgradeAbiOfficialArgs.__tnCreateView requires a Uint8Array");
    return new UpgradeAbiOfficialArgs(new Uint8Array(buffer));
  }

  static builder(): UpgradeAbiOfficialArgsBuilder {
    return new UpgradeAbiOfficialArgsBuilder();
  }

  static fromBuilder(builder: UpgradeAbiOfficialArgsBuilder): UpgradeAbiOfficialArgs | null {
    const buffer = builder.build();
    return UpgradeAbiOfficialArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_srcbuf_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_srcbuf_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get srcbuf_account_idx(): number {
    return this.get_srcbuf_account_idx();
  }

  set srcbuf_account_idx(value: number) {
    this.set_srcbuf_account_idx(value);
  }

  get_srcbuf_offset(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_offset(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_offset(): number {
    return this.get_srcbuf_offset();
  }

  set srcbuf_offset(value: number) {
    this.set_srcbuf_offset(value);
  }

  get_srcbuf_size(): number {
    const offset = 12;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_size(value: number): void {
    const offset = 12;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_size(): number {
    return this.get_srcbuf_size();
  }

  set srcbuf_size(value: number) {
    this.set_srcbuf_size(value);
  }

  get_srcbuf_sha256(): Seed32 {
    const offset = 16;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_srcbuf_sha256(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 16;
    this.buffer.set(sourceBytes, offset);
  }

  get srcbuf_sha256(): Seed32 {
    return this.get_srcbuf_sha256();
  }

  set srcbuf_sha256(value: Seed32) {
    this.set_srcbuf_sha256(value);
  }

  get_authority_account_idx(): number {
    const offset = 48;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 48;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UpgradeAbiOfficialArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UpgradeAbiOfficialArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UpgradeAbiOfficialArgs');
    }
    return __tnBigIntToNumber(irResult, 'UpgradeAbiOfficialArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 50) return { ok: false, code: "tn.buffer_too_small", consumed: 50 };
    return { ok: true, consumed: 50 };
  }

  static from_array(buffer: Uint8Array): UpgradeAbiOfficialArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UpgradeAbiOfficialArgs(buffer);
  }

}

export class UpgradeAbiOfficialArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(50);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_srcbuf_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  set_srcbuf_offset(value: number): this {
    this.view.setUint32(8, value, true);
    return this;
  }

  set_srcbuf_size(value: number): this {
    this.view.setUint32(12, value, true);
    return this;
  }

  set_srcbuf_sha256(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("srcbuf_sha256 expects 32 bytes");
    this.buffer.set(value, 16);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(48, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("UpgradeAbiOfficialArgs", UpgradeAbiOfficialArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("UpgradeAbiOfficialArgs", UpgradeAbiOfficialArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): UpgradeAbiOfficialArgs {
    const view = UpgradeAbiOfficialArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build UpgradeAbiOfficialArgs");
    return view;
  }
}

__tnRegisterFootprint("UpgradeAbiOfficialArgs", (params) => UpgradeAbiOfficialArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("UpgradeAbiOfficialArgs", (buffer, params) => UpgradeAbiOfficialArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UpgradeAbiOfficialArgs", (buffer) => { const result = UpgradeAbiOfficialArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiAccount ----- */

const __tn_ir_AbiAccount = {
  typeName: "AbiAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 32n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "contents.content_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class AbiAccount {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: AbiAccount.Params;

  private constructor(private buffer: Uint8Array, params?: AbiAccount.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = AbiAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("AbiAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: AbiAccount.Params, fieldContext?: Record<string, number | bigint> }): AbiAccount {
    if (!buffer || buffer.length === undefined) throw new Error("AbiAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = AbiAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("AbiAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new AbiAccount(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): AbiAccount.Params {
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
    throw new Error("AbiAccount: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  private __tnResolveFieldRef(path: string): number {
    const value = this.__tnResolveFieldRefRaw(path);
    return typeof value === "bigint" ? __tnBigIntToNumber(value, "AbiAccount::__tnResolveFieldRef") : value;
  }

  private __tnResolveFieldRefU64(path: string): bigint {
    return __tnU64(__tnToBigInt(this.__tnResolveFieldRefRaw(path)));
  }

  private __tnResolveContextU64(path: string): bigint {
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) return __tnU64(__tnToBigInt(this.__tnFieldContext[path]));
    throw new Error("AbiAccount: enclosing field '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): AbiAccountBuilder {
    return new AbiAccountBuilder();
  }

  static fromBuilder(builder: AbiAccountBuilder): AbiAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return AbiAccount.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "contents", method: "contents", sizeField: "content_sz", paramKey: "content_sz", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: AbiAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 45) {
      return null;
    }
    const __tnParam_contents_content_sz = __tnToBigInt(view.getUint32(41, true));
    const __tnExtractedParams = AbiAccount.Params.fromValues({
      contents_content_sz: __tnParam_contents_content_sz,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_abi_meta_acc(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_abi_meta_acc(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get abi_meta_acc(): Pubkey {
    return this.get_abi_meta_acc();
  }

  set abi_meta_acc(value: Pubkey) {
    this.set_abi_meta_acc(value);
  }

  get_revision(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_revision(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get revision(): bigint {
    return this.get_revision();
  }

  set revision(value: bigint) {
    this.set_revision(value);
  }

  get_state(): number {
    const offset = 40;
    return this.view.getUint8(offset);
  }

  set_state(value: number): void {
    const offset = 40;
    this.view.setUint8(offset, value);
  }

  get state(): number {
    return this.get_state();
  }

  set state(value: number) {
    this.set_state(value);
  }

  get_content_sz(): number {
    const offset = 41;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_content_sz(value: number): void {
    const offset = 41;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get content_sz(): number {
    return this.get_content_sz();
  }

  set content_sz(value: number) {
    this.set_content_sz(value);
  }

  get_contents_length(): number {
    return __tnCountNumber(this.__tnResolveFieldRefU64("content_sz"));
  }

  get_contents_at(index: number): number {
    const offset = 45;
    return this.view.getUint8(offset + index * 1);
  }

  get_contents(): number[] {
    const len = this.get_contents_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_contents_at(i));
    }
    return result;
  }

  set_contents_at(index: number, value: number): void {
    const offset = 45;
    this.view.setUint8((offset + index * 1), value);
  }

  set_contents(value: number[]): void {
    const len = Math.min(this.get_contents_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_contents_at(i, value[i]);
    }
  }

  get contents(): number[] {
    return this.get_contents();
  }

  set contents(value: number[]) {
    this.set_contents(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(contents_content_sz: number | bigint): bigint {
    const params = AbiAccount.Params.fromValues({
      contents_content_sz: contents_content_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: AbiAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["contents.content_sz"] = params.contents_content_sz;
    return record;
  }

  static footprintIrFromParams(params: AbiAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: AbiAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiAccount');
    return __tnBigIntToNumber(irResult, 'AbiAccount::footprintFromParams');
  }

  static footprintFromValues(input: { contents_content_sz: number | bigint }): number {
    const params = AbiAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: AbiAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: AbiAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: AbiAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiAccount::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: AbiAccount.Params }): AbiAccount | null {
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
    const state = new AbiAccount(buffer, cached);
    return state;
  }


}

export namespace AbiAccount {
  export type Params = {
    /** ABI path: contents.content_sz */
    readonly contents_content_sz: bigint;
  };

  export const ParamKeys = Object.freeze({
    contents_content_sz: "contents.content_sz",
  } as const);

  export const Params = {
    fromValues(input: { contents_content_sz: number | bigint }): Params {
      return {
        contents_content_sz: __tnToBigInt(input.contents_content_sz),
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

  export function params(input: { contents_content_sz: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class AbiAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: AbiAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: AbiAccount.Params | null = null;
  private __tnFam_contents: Uint8Array | null = null;
  private __tnFam_contentsCount: number | null = null;
  private __tnFamWriter_contents?: __TnFamWriterResult<AbiAccountBuilder>;

  constructor() {
    this.buffer = new Uint8Array(45);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_abi_meta_acc(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("abi_meta_acc expects 32 bytes");
    this.buffer.set(value, 0);
    this.__tnInvalidate();
    return this;
  }

  set_revision(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_state(value: number): this {
    this.view.setUint8(40, value);
    this.__tnInvalidate();
    return this;
  }

  set_content_sz(value: number): this {
    this.view.setUint32(41, value, true);
    this.__tnInvalidate();
    return this;
  }

  contents(): __TnFamWriterResult<AbiAccountBuilder> {
    if (!this.__tnFamWriter_contents) {
      this.__tnFamWriter_contents = __tnCreateFamWriter(this, "contents", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_contents = bytes;
        this.__tnFam_contentsCount = elementCount;
        this.set_content_sz(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_contents!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = AbiAccount.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = AbiAccount.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("AbiAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): AbiAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = AbiAccount.from_array(buffer, { params });
    if (!view) throw new Error("AbiAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): AbiAccount {
    return this.finish();
  }

  dynamicParams(): AbiAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): AbiAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = AbiAccount.Params.fromValues({
      contents_content_sz: (() => { if (this.__tnFam_contentsCount === null) throw new Error("AbiAccountBuilder: field 'contents' must be written before computing params"); return __tnToBigInt(this.__tnFam_contentsCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_contents_bytes = this.__tnFam_contents;
    if (!__tnLocal_contents_bytes) throw new Error("AbiAccountBuilder: field 'contents' must be written before build");
    target.set(__tnLocal_contents_bytes, cursor);
    cursor += __tnLocal_contents_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: AbiAccount.Params): void {
    const result = AbiAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ AbiAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("AbiAccount", (params) => AbiAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiAccount", (buffer, params) => AbiAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiAccount", (buffer) => { const result = AbiAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiBoundAccount ----- */

const __tn_ir_AbiBoundAccount = {
  typeName: "AbiBoundAccount",
  root: { op: "const", value: 34n }
} as const;

export class AbiBoundAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AbiBoundAccount {
    if (!buffer || buffer.length === undefined) throw new Error("AbiBoundAccount.__tnCreateView requires a Uint8Array");
    return new AbiBoundAccount(new Uint8Array(buffer));
  }

  static builder(): AbiBoundAccountBuilder {
    return new AbiBoundAccountBuilder();
  }

  static fromBuilder(builder: AbiBoundAccountBuilder): AbiBoundAccount | null {
    const buffer = builder.build();
    return AbiBoundAccount.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_AbiBoundAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiBoundAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiBoundAccount');
    }
    return __tnBigIntToNumber(irResult, 'AbiBoundAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 34) return { ok: false, code: "tn.buffer_too_small", consumed: 34 };
    return { ok: true, consumed: 34 };
  }

  static from_array(buffer: Uint8Array): AbiBoundAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AbiBoundAccount(buffer);
  }

}

export class AbiBoundAccountBuilder {
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
    __tnBuilderValidateOrThrow("AbiBoundAccount", AbiBoundAccount.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("AbiBoundAccount", AbiBoundAccount.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): AbiBoundAccount {
    const view = AbiBoundAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AbiBoundAccount");
    return view;
  }
}

__tnRegisterFootprint("AbiBoundAccount", (params) => AbiBoundAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiBoundAccount", (buffer, params) => AbiBoundAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiBoundAccount", (buffer) => { const result = AbiBoundAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiMetaBodyExternal ----- */

const __tn_ir_AbiMetaBodyExternal = {
  typeName: "AbiMetaBodyExternal",
  root: { op: "const", value: 96n }
} as const;

export class AbiMetaBodyExternal {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AbiMetaBodyExternal {
    if (!buffer || buffer.length === undefined) throw new Error("AbiMetaBodyExternal.__tnCreateView requires a Uint8Array");
    return new AbiMetaBodyExternal(new Uint8Array(buffer));
  }

  static builder(): AbiMetaBodyExternalBuilder {
    return new AbiMetaBodyExternalBuilder();
  }

  static fromBuilder(builder: AbiMetaBodyExternalBuilder): AbiMetaBodyExternal | null {
    const buffer = builder.build();
    return AbiMetaBodyExternal.from_array(buffer);
  }

  get_publisher(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_publisher(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get publisher(): Pubkey {
    return this.get_publisher();
  }

  set publisher(value: Pubkey) {
    this.set_publisher(value);
  }

  get_target_program(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_target_program(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get target_program(): Pubkey {
    return this.get_target_program();
  }

  set target_program(value: Pubkey) {
    this.set_target_program(value);
  }

  get_seed(): Seed32 {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get seed(): Seed32 {
    return this.get_seed();
  }

  set seed(value: Seed32) {
    this.set_seed(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiMetaBodyExternal.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiMetaBodyExternal, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiMetaBodyExternal');
    }
    return __tnBigIntToNumber(irResult, 'AbiMetaBodyExternal::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): AbiMetaBodyExternal | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AbiMetaBodyExternal(buffer);
  }

}

export class AbiMetaBodyExternalBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(96);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_publisher(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("publisher expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_target_program(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("target_program expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_seed(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seed expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("AbiMetaBodyExternal", AbiMetaBodyExternal.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("AbiMetaBodyExternal", AbiMetaBodyExternal.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): AbiMetaBodyExternal {
    const view = AbiMetaBodyExternal.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AbiMetaBodyExternal");
    return view;
  }
}

__tnRegisterFootprint("AbiMetaBodyExternal", (params) => AbiMetaBodyExternal.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiMetaBodyExternal", (buffer, params) => AbiMetaBodyExternal.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiMetaBodyExternal", (buffer) => { const result = AbiMetaBodyExternal.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiMetaBodyOfficial ----- */

const __tn_ir_AbiMetaBodyOfficial = {
  typeName: "AbiMetaBodyOfficial",
  root: { op: "const", value: 32n }
} as const;

export class AbiMetaBodyOfficial {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AbiMetaBodyOfficial {
    if (!buffer || buffer.length === undefined) throw new Error("AbiMetaBodyOfficial.__tnCreateView requires a Uint8Array");
    return new AbiMetaBodyOfficial(new Uint8Array(buffer));
  }

  static builder(): AbiMetaBodyOfficialBuilder {
    return new AbiMetaBodyOfficialBuilder();
  }

  static fromBuilder(builder: AbiMetaBodyOfficialBuilder): AbiMetaBodyOfficial | null {
    const buffer = builder.build();
    return AbiMetaBodyOfficial.from_array(buffer);
  }

  get_program(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_program(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get program(): Pubkey {
    return this.get_program();
  }

  set program(value: Pubkey) {
    this.set_program(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiMetaBodyOfficial.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiMetaBodyOfficial, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiMetaBodyOfficial');
    }
    return __tnBigIntToNumber(irResult, 'AbiMetaBodyOfficial::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 32) return { ok: false, code: "tn.buffer_too_small", consumed: 32 };
    return { ok: true, consumed: 32 };
  }

  static from_array(buffer: Uint8Array): AbiMetaBodyOfficial | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AbiMetaBodyOfficial(buffer);
  }

}

export class AbiMetaBodyOfficialBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(32);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_program(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("program expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("AbiMetaBodyOfficial", AbiMetaBodyOfficial.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("AbiMetaBodyOfficial", AbiMetaBodyOfficial.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): AbiMetaBodyOfficial {
    const view = AbiMetaBodyOfficial.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AbiMetaBodyOfficial");
    return view;
  }
}

__tnRegisterFootprint("AbiMetaBodyOfficial", (params) => AbiMetaBodyOfficial.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiMetaBodyOfficial", (buffer, params) => AbiMetaBodyOfficial.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiMetaBodyOfficial", (buffer) => { const result = AbiMetaBodyOfficial.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateAbiExternalEphemeralArgs ----- */

const __tn_ir_CreateAbiExternalEphemeralArgs = {
  typeName: "CreateAbiExternalEphemeralArgs",
  root: { op: "const", value: 48n }
} as const;

export class CreateAbiExternalEphemeralArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreateAbiExternalEphemeralArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateAbiExternalEphemeralArgs.__tnCreateView requires a Uint8Array");
    return new CreateAbiExternalEphemeralArgs(new Uint8Array(buffer));
  }

  static builder(): CreateAbiExternalEphemeralArgsBuilder {
    return new CreateAbiExternalEphemeralArgsBuilder();
  }

  static fromBuilder(builder: CreateAbiExternalEphemeralArgsBuilder): CreateAbiExternalEphemeralArgs | null {
    const buffer = builder.build();
    return CreateAbiExternalEphemeralArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_srcbuf_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_srcbuf_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get srcbuf_account_idx(): number {
    return this.get_srcbuf_account_idx();
  }

  set srcbuf_account_idx(value: number) {
    this.set_srcbuf_account_idx(value);
  }

  get_srcbuf_offset(): number {
    const offset = 6;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_offset(value: number): void {
    const offset = 6;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_offset(): number {
    return this.get_srcbuf_offset();
  }

  set srcbuf_offset(value: number) {
    this.set_srcbuf_offset(value);
  }

  get_srcbuf_size(): number {
    const offset = 10;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_size(value: number): void {
    const offset = 10;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_size(): number {
    return this.get_srcbuf_size();
  }

  set srcbuf_size(value: number) {
    this.set_srcbuf_size(value);
  }

  get_srcbuf_sha256(): Seed32 {
    const offset = 14;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_srcbuf_sha256(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 14;
    this.buffer.set(sourceBytes, offset);
  }

  get srcbuf_sha256(): Seed32 {
    return this.get_srcbuf_sha256();
  }

  set srcbuf_sha256(value: Seed32) {
    this.set_srcbuf_sha256(value);
  }

  get_authority_account_idx(): number {
    const offset = 46;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 46;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateAbiExternalEphemeralArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateAbiExternalEphemeralArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateAbiExternalEphemeralArgs');
    }
    return __tnBigIntToNumber(irResult, 'CreateAbiExternalEphemeralArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 48) return { ok: false, code: "tn.buffer_too_small", consumed: 48 };
    return { ok: true, consumed: 48 };
  }

  static from_array(buffer: Uint8Array): CreateAbiExternalEphemeralArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreateAbiExternalEphemeralArgs(buffer);
  }

}

export class CreateAbiExternalEphemeralArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(48);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_srcbuf_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_srcbuf_offset(value: number): this {
    this.view.setUint32(6, value, true);
    return this;
  }

  set_srcbuf_size(value: number): this {
    this.view.setUint32(10, value, true);
    return this;
  }

  set_srcbuf_sha256(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("srcbuf_sha256 expects 32 bytes");
    this.buffer.set(value, 14);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(46, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CreateAbiExternalEphemeralArgs", CreateAbiExternalEphemeralArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CreateAbiExternalEphemeralArgs", CreateAbiExternalEphemeralArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CreateAbiExternalEphemeralArgs {
    const view = CreateAbiExternalEphemeralArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreateAbiExternalEphemeralArgs");
    return view;
  }
}

__tnRegisterFootprint("CreateAbiExternalEphemeralArgs", (params) => CreateAbiExternalEphemeralArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateAbiExternalEphemeralArgs", (buffer, params) => CreateAbiExternalEphemeralArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateAbiExternalEphemeralArgs", (buffer) => { const result = CreateAbiExternalEphemeralArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateAbiOfficialEphemeralArgs ----- */

const __tn_ir_CreateAbiOfficialEphemeralArgs = {
  typeName: "CreateAbiOfficialEphemeralArgs",
  root: { op: "const", value: 50n }
} as const;

export class CreateAbiOfficialEphemeralArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreateAbiOfficialEphemeralArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateAbiOfficialEphemeralArgs.__tnCreateView requires a Uint8Array");
    return new CreateAbiOfficialEphemeralArgs(new Uint8Array(buffer));
  }

  static builder(): CreateAbiOfficialEphemeralArgsBuilder {
    return new CreateAbiOfficialEphemeralArgsBuilder();
  }

  static fromBuilder(builder: CreateAbiOfficialEphemeralArgsBuilder): CreateAbiOfficialEphemeralArgs | null {
    const buffer = builder.build();
    return CreateAbiOfficialEphemeralArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_srcbuf_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_srcbuf_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get srcbuf_account_idx(): number {
    return this.get_srcbuf_account_idx();
  }

  set srcbuf_account_idx(value: number) {
    this.set_srcbuf_account_idx(value);
  }

  get_srcbuf_offset(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_offset(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_offset(): number {
    return this.get_srcbuf_offset();
  }

  set srcbuf_offset(value: number) {
    this.set_srcbuf_offset(value);
  }

  get_srcbuf_size(): number {
    const offset = 12;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_size(value: number): void {
    const offset = 12;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_size(): number {
    return this.get_srcbuf_size();
  }

  set srcbuf_size(value: number) {
    this.set_srcbuf_size(value);
  }

  get_srcbuf_sha256(): Seed32 {
    const offset = 16;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_srcbuf_sha256(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 16;
    this.buffer.set(sourceBytes, offset);
  }

  get srcbuf_sha256(): Seed32 {
    return this.get_srcbuf_sha256();
  }

  set srcbuf_sha256(value: Seed32) {
    this.set_srcbuf_sha256(value);
  }

  get_authority_account_idx(): number {
    const offset = 48;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 48;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateAbiOfficialEphemeralArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateAbiOfficialEphemeralArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateAbiOfficialEphemeralArgs');
    }
    return __tnBigIntToNumber(irResult, 'CreateAbiOfficialEphemeralArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 50) return { ok: false, code: "tn.buffer_too_small", consumed: 50 };
    return { ok: true, consumed: 50 };
  }

  static from_array(buffer: Uint8Array): CreateAbiOfficialEphemeralArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreateAbiOfficialEphemeralArgs(buffer);
  }

}

export class CreateAbiOfficialEphemeralArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(50);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_srcbuf_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  set_srcbuf_offset(value: number): this {
    this.view.setUint32(8, value, true);
    return this;
  }

  set_srcbuf_size(value: number): this {
    this.view.setUint32(12, value, true);
    return this;
  }

  set_srcbuf_sha256(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("srcbuf_sha256 expects 32 bytes");
    this.buffer.set(value, 16);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(48, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CreateAbiOfficialEphemeralArgs", CreateAbiOfficialEphemeralArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CreateAbiOfficialEphemeralArgs", CreateAbiOfficialEphemeralArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CreateAbiOfficialEphemeralArgs {
    const view = CreateAbiOfficialEphemeralArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreateAbiOfficialEphemeralArgs");
    return view;
  }
}

__tnRegisterFootprint("CreateAbiOfficialEphemeralArgs", (params) => CreateAbiOfficialEphemeralArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateAbiOfficialEphemeralArgs", (buffer, params) => CreateAbiOfficialEphemeralArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateAbiOfficialEphemeralArgs", (buffer) => { const result = CreateAbiOfficialEphemeralArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateMetaExternalEphemeralArgs ----- */

const __tn_ir_CreateMetaExternalEphemeralArgs = {
  typeName: "CreateMetaExternalEphemeralArgs",
  root: { op: "const", value: 68n }
} as const;

export class CreateMetaExternalEphemeralArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreateMetaExternalEphemeralArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateMetaExternalEphemeralArgs.__tnCreateView requires a Uint8Array");
    return new CreateMetaExternalEphemeralArgs(new Uint8Array(buffer));
  }

  static builder(): CreateMetaExternalEphemeralArgsBuilder {
    return new CreateMetaExternalEphemeralArgsBuilder();
  }

  static fromBuilder(builder: CreateMetaExternalEphemeralArgsBuilder): CreateMetaExternalEphemeralArgs | null {
    const buffer = builder.build();
    return CreateMetaExternalEphemeralArgs.from_array(buffer);
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_target_program(): Pubkey {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_target_program(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
    this.buffer.set(sourceBytes, offset);
  }

  get target_program(): Pubkey {
    return this.get_target_program();
  }

  set target_program(value: Pubkey) {
    this.set_target_program(value);
  }

  get_seed(): Seed32 {
    const offset = 36;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 36;
    this.buffer.set(sourceBytes, offset);
  }

  get seed(): Seed32 {
    return this.get_seed();
  }

  set seed(value: Seed32) {
    this.set_seed(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateMetaExternalEphemeralArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateMetaExternalEphemeralArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateMetaExternalEphemeralArgs');
    }
    return __tnBigIntToNumber(irResult, 'CreateMetaExternalEphemeralArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 68) return { ok: false, code: "tn.buffer_too_small", consumed: 68 };
    return { ok: true, consumed: 68 };
  }

  static from_array(buffer: Uint8Array): CreateMetaExternalEphemeralArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreateMetaExternalEphemeralArgs(buffer);
  }

}

export class CreateMetaExternalEphemeralArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(68);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_target_program(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("target_program expects 32 bytes");
    this.buffer.set(value, 4);
    return this;
  }

  set_seed(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seed expects 32 bytes");
    this.buffer.set(value, 36);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CreateMetaExternalEphemeralArgs", CreateMetaExternalEphemeralArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CreateMetaExternalEphemeralArgs", CreateMetaExternalEphemeralArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CreateMetaExternalEphemeralArgs {
    const view = CreateMetaExternalEphemeralArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreateMetaExternalEphemeralArgs");
    return view;
  }
}

__tnRegisterFootprint("CreateMetaExternalEphemeralArgs", (params) => CreateMetaExternalEphemeralArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateMetaExternalEphemeralArgs", (buffer, params) => CreateMetaExternalEphemeralArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateMetaExternalEphemeralArgs", (buffer) => { const result = CreateMetaExternalEphemeralArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR GovernedAbiArgs ----- */

const __tn_ir_GovernedAbiArgs = {
  typeName: "GovernedAbiArgs",
  root: { op: "const", value: 278n }
} as const;

export class GovernedAbiArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): GovernedAbiArgs {
    if (!buffer || buffer.length === undefined) throw new Error("GovernedAbiArgs.__tnCreateView requires a Uint8Array");
    return new GovernedAbiArgs(new Uint8Array(buffer));
  }

  static builder(): GovernedAbiArgsBuilder {
    return new GovernedAbiArgsBuilder();
  }

  static fromBuilder(builder: GovernedAbiArgsBuilder): GovernedAbiArgs | null {
    const buffer = builder.build();
    return GovernedAbiArgs.from_array(buffer);
  }

  get_config(): AbiBoundAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 34);
    return AbiBoundAccount.from_array(slice)!;
  }

  set_config(value: AbiBoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): AbiBoundAccount {
    return this.get_config();
  }

  set config(value: AbiBoundAccount) {
    this.set_config(value);
  }

  get_admin(): AbiBoundAccount {
    const offset = 34;
    const slice = this.buffer.subarray(offset, offset + 34);
    return AbiBoundAccount.from_array(slice)!;
  }

  set_admin(value: AbiBoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 34;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): AbiBoundAccount {
    return this.get_admin();
  }

  set admin(value: AbiBoundAccount) {
    this.set_admin(value);
  }

  get_subject(): AbiBoundAccount {
    const offset = 68;
    const slice = this.buffer.subarray(offset, offset + 34);
    return AbiBoundAccount.from_array(slice)!;
  }

  set_subject(value: AbiBoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get subject(): AbiBoundAccount {
    return this.get_subject();
  }

  set subject(value: AbiBoundAccount) {
    this.set_subject(value);
  }

  get_program_metadata(): AbiBoundAccount {
    const offset = 102;
    const slice = this.buffer.subarray(offset, offset + 34);
    return AbiBoundAccount.from_array(slice)!;
  }

  set_program_metadata(value: AbiBoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 102;
    this.buffer.set(sourceBytes, offset);
  }

  get program_metadata(): AbiBoundAccount {
    return this.get_program_metadata();
  }

  set program_metadata(value: AbiBoundAccount) {
    this.set_program_metadata(value);
  }

  get_abi_metadata(): AbiBoundAccount {
    const offset = 136;
    const slice = this.buffer.subarray(offset, offset + 34);
    return AbiBoundAccount.from_array(slice)!;
  }

  set_abi_metadata(value: AbiBoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 136;
    this.buffer.set(sourceBytes, offset);
  }

  get abi_metadata(): AbiBoundAccount {
    return this.get_abi_metadata();
  }

  set abi_metadata(value: AbiBoundAccount) {
    this.set_abi_metadata(value);
  }

  get_abi_content(): AbiBoundAccount {
    const offset = 170;
    const slice = this.buffer.subarray(offset, offset + 34);
    return AbiBoundAccount.from_array(slice)!;
  }

  set_abi_content(value: AbiBoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 170;
    this.buffer.set(sourceBytes, offset);
  }

  get abi_content(): AbiBoundAccount {
    return this.get_abi_content();
  }

  set abi_content(value: AbiBoundAccount) {
    this.set_abi_content(value);
  }

  get_source(): AbiBoundAccount {
    const offset = 204;
    const slice = this.buffer.subarray(offset, offset + 34);
    return AbiBoundAccount.from_array(slice)!;
  }

  set_source(value: AbiBoundAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 204;
    this.buffer.set(sourceBytes, offset);
  }

  get source(): AbiBoundAccount {
    return this.get_source();
  }

  set source(value: AbiBoundAccount) {
    this.set_source(value);
  }

  get_source_offset(): number {
    const offset = 238;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_source_offset(value: number): void {
    const offset = 238;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get source_offset(): number {
    return this.get_source_offset();
  }

  set source_offset(value: number) {
    this.set_source_offset(value);
  }

  get_source_size(): number {
    const offset = 242;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_source_size(value: number): void {
    const offset = 242;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get source_size(): number {
    return this.get_source_size();
  }

  set source_size(value: number) {
    this.set_source_size(value);
  }

  get_content_sha256(): Seed32 {
    const offset = 246;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_content_sha256(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 246;
    this.buffer.set(sourceBytes, offset);
  }

  get content_sha256(): Seed32 {
    return this.get_content_sha256();
  }

  set content_sha256(value: Seed32) {
    this.set_content_sha256(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_GovernedAbiArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_GovernedAbiArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for GovernedAbiArgs');
    }
    return __tnBigIntToNumber(irResult, 'GovernedAbiArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 278) return { ok: false, code: "tn.buffer_too_small", consumed: 278 };
    return { ok: true, consumed: 278 };
  }

  static from_array(buffer: Uint8Array): GovernedAbiArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new GovernedAbiArgs(buffer);
  }

}

export class GovernedAbiArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(278);
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

  set_subject(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("subject expects 34 bytes");
    this.buffer.set(value, 68);
    return this;
  }

  set_program_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("program_metadata expects 34 bytes");
    this.buffer.set(value, 102);
    return this;
  }

  set_abi_metadata(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("abi_metadata expects 34 bytes");
    this.buffer.set(value, 136);
    return this;
  }

  set_abi_content(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("abi_content expects 34 bytes");
    this.buffer.set(value, 170);
    return this;
  }

  set_source(value: Uint8Array): this {
    if (value.length !== 34) throw new Error("source expects 34 bytes");
    this.buffer.set(value, 204);
    return this;
  }

  set_source_offset(value: number): this {
    this.view.setUint32(238, value, true);
    return this;
  }

  set_source_size(value: number): this {
    this.view.setUint32(242, value, true);
    return this;
  }

  set_content_sha256(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("content_sha256 expects 32 bytes");
    this.buffer.set(value, 246);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("GovernedAbiArgs", GovernedAbiArgs.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("GovernedAbiArgs", GovernedAbiArgs.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): GovernedAbiArgs {
    const view = GovernedAbiArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build GovernedAbiArgs");
    return view;
  }
}

__tnRegisterFootprint("GovernedAbiArgs", (params) => GovernedAbiArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("GovernedAbiArgs", (buffer, params) => GovernedAbiArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("GovernedAbiArgs", (buffer) => { const result = GovernedAbiArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiMetaBody ----- */

const __tn_ir_AbiMetaBody = {
  typeName: "AbiMetaBody",
  root: { op: "const", value: 96n }
} as const;

export class AbiMetaBody {
  private view: DataView;

  private constructor(private buffer: Uint8Array, private __tnCtx: Record<string, number | bigint> = {}) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): AbiMetaBody {
    return new AbiMetaBody(buffer, ctx);
  }

  static readonly variantDescriptors = Object.freeze([
    { name: "official", tag: 0, payloadSize: 32, payloadType: "AbiMetaBody::official", createPayloadBuilder: () => null },
    { name: "external", tag: 1, payloadSize: 96, payloadType: "AbiMetaBody::external", createPayloadBuilder: () => null },
  ] as const);

  static variantByName(name: string): __TnVariantDescriptor | null {
    return this.variantDescriptors.find((d) => d.name === name) ?? null;
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  asUint8Array(): Uint8Array {
    return this.bytes();
  }

  get_official(): AbiMetaBodyOfficial | null {
    const bytes = this.buffer;
    return AbiMetaBodyOfficial.from_array(bytes);
  }

  get_external(): AbiMetaBodyExternal | null {
    const bytes = this.buffer;
    return AbiMetaBodyExternal.from_array(bytes);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiMetaBody.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiMetaBody, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiMetaBody');
    }
    return __tnBigIntToNumber(irResult, 'AbiMetaBody::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): AbiMetaBody | null {
    if (buffer.length < 96) {
      return null; /* Buffer too small */
    }
    if (!this.validate(buffer).ok) return null;

    return new AbiMetaBody(buffer);
  }

}

__tnRegisterFootprint("AbiMetaBody", (params) => AbiMetaBody.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiMetaBody", (buffer, params) => AbiMetaBody.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiMetaBody", (buffer) => { const result = AbiMetaBody.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateAbiExternalPermanentArgs ----- */

const __tn_ir_CreateAbiExternalPermanentArgs = {
  typeName: "CreateAbiExternalPermanentArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class CreateAbiExternalPermanentArgs {
  private view: DataView;
  private __tnParams: CreateAbiExternalPermanentArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateAbiExternalPermanentArgs.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateAbiExternalPermanentArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateAbiExternalPermanentArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateAbiExternalPermanentArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateAbiExternalPermanentArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateAbiExternalPermanentArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateAbiExternalPermanentArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateAbiExternalPermanentArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateAbiExternalPermanentArgs(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): CreateAbiExternalPermanentArgs.Params {
    return this.__tnParams;
  }

  static builder(): CreateAbiExternalPermanentArgsBuilder {
    return new CreateAbiExternalPermanentArgsBuilder();
  }

  static fromBuilder(builder: CreateAbiExternalPermanentArgsBuilder): CreateAbiExternalPermanentArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateAbiExternalPermanentArgs.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnFieldValue_abi_meta_account_idx: number | null = null;
    let __tnFieldValue_abi_account_idx: number | null = null;
    let __tnFieldValue_srcbuf_account_idx: number | null = null;
    let __tnFieldValue_srcbuf_offset: number | null = null;
    let __tnFieldValue_srcbuf_size: number | null = null;
    let __tnFieldValue_authority_account_idx: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_abi_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_abi_meta_account_idx = __tnRead_abi_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_abi_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_abi_account_idx = __tnRead_abi_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_srcbuf_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_srcbuf_account_idx = __tnRead_srcbuf_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_srcbuf_offset = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_srcbuf_offset = __tnRead_srcbuf_offset;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_srcbuf_size = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_srcbuf_size = __tnRead_srcbuf_size;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_authority_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_authority_account_idx = __tnRead_authority_account_idx;
    __tnCursorMutable += 2;
    const __tnTyperefResult_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_state_proof.ok || __tnTyperefResult_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_state_proof = __tnTyperefResult_state_proof.params ?? null;
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_state_proof.consumed, "CreateAbiExternalPermanentArgs::state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateAbiExternalPermanentArgs.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = CreateAbiExternalPermanentArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = CreateAbiExternalPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_srcbuf_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_srcbuf_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get srcbuf_account_idx(): number {
    return this.get_srcbuf_account_idx();
  }

  set srcbuf_account_idx(value: number) {
    this.set_srcbuf_account_idx(value);
  }

  get_srcbuf_offset(): number {
    const offset = 6;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_offset(value: number): void {
    const offset = 6;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_offset(): number {
    return this.get_srcbuf_offset();
  }

  set srcbuf_offset(value: number) {
    this.set_srcbuf_offset(value);
  }

  get_srcbuf_size(): number {
    const offset = 10;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_size(value: number): void {
    const offset = 10;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_size(): number {
    return this.get_srcbuf_size();
  }

  set srcbuf_size(value: number) {
    this.set_srcbuf_size(value);
  }

  get_srcbuf_sha256(): Seed32 {
    const offset = 14;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_srcbuf_sha256(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 14;
    this.buffer.set(sourceBytes, offset);
  }

  get srcbuf_sha256(): Seed32 {
    return this.get_srcbuf_sha256();
  }

  set srcbuf_sha256(value: Seed32) {
    this.set_srcbuf_sha256(value);
  }

  get_authority_account_idx(): number {
    const offset = 46;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 46;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_state_proof(): StateProof {
    const offset = 48;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("CreateAbiExternalPermanentArgs: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 48;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateAbiExternalPermanentArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateAbiExternalPermanentArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = CreateAbiExternalPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateAbiExternalPermanentArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: CreateAbiExternalPermanentArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateAbiExternalPermanentArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateAbiExternalPermanentArgs');
    return __tnBigIntToNumber(irResult, 'CreateAbiExternalPermanentArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = CreateAbiExternalPermanentArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateAbiExternalPermanentArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateAbiExternalPermanentArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateAbiExternalPermanentArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiExternalPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiExternalPermanentArgs::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 2 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x3 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x4 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 4 > b.length) return null; const x5 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x6 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 32 > b.length) return null; c += 32;
if (c + 2 > b.length) return null; const x7 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s8 = c;
const s9 = c;
if (c + 8 > b.length) return null; const x10 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s11 = c;
const av12 = v; const ao13 = c;
if (c + 32 > b.length) return null; c += 32;
void s11;
void s9;
let t14: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x10, 62n), 3n)) as bigint | null) {
  case 0n: t14 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s15 = c;
const n16 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 31))))))))); if (n16 === null || n16 < 0n) return null;
if (BigInt(c) + n16 * 32n > BigInt(b.length)) return null; c += Number(n16 * 32n);
void s15;
return c; })(b.subarray(c)); break;
  case 1n: t14 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s17 = c;
const s18 = c;
const av19 = v; const ao20 = c;
if (c + 32 > b.length) return null; c += 32;
void s18;
const n21 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 31))))))))); if (n21 === null || n21 < 0n) return null;
if (BigInt(c) + n21 * 32n > BigInt(b.length)) return null; c += Number(n21 * 32n);
void s17;
return c; })(b.subarray(c)); break;
  case 2n: t14 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s22 = c;
const s23 = c;
const av24 = v; const ao25 = c;
if (c + 32 > b.length) return null; c += 32;
void s23;
const s26 = c;
const av27 = v; const ao28 = c;
if (c + 32 > b.length) return null; c += 32;
void s26;
const n29 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 31))))))))); if (n29 === null || n29 < 0n) return null;
if (BigInt(c) + n29 * 32n > BigInt(b.length)) return null; c += Number(n29 * 32n);
void s22;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t14 === null || c + t14 > b.length) return null; c += t14;
void s8;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateAbiExternalPermanentArgs.Params }): CreateAbiExternalPermanentArgs | null {
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
    const state = new CreateAbiExternalPermanentArgs(buffer, cached);
    return state;
  }


}

export namespace CreateAbiExternalPermanentArgs {
  export type Params = {
    /** ABI path: proof_body.hdr.type_slot */
    readonly proof_body_hdr_type_slot: bigint;
    /** ABI path: proof_body.payload_size */
    readonly proof_body_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_body_hdr_type_slot: "proof_body.hdr.type_slot",
    proof_body_payload_size: "proof_body.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
      return {
        proof_body_hdr_type_slot: __tnToBigInt(input.proof_body_hdr_type_slot),
        proof_body_payload_size: __tnToBigInt(input.proof_body_payload_size),
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

  export function params(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateAbiExternalPermanentArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateAbiExternalPermanentArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateAbiExternalPermanentArgs.Params | null = null;
  private __tnTail_state_proof: Uint8Array | null = null;
  private __tnTailParams_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(48);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_offset(value: number): this {
    this.view.setUint32(6, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_size(value: number): this {
    this.view.setUint32(10, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_sha256(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("srcbuf_sha256 expects 32 bytes");
    this.buffer.set(value, 14);
    this.__tnInvalidate();
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(46, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "CreateAbiExternalPermanentArgsBuilder::state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("CreateAbiExternalPermanentArgsBuilder: field 'state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "CreateAbiExternalPermanentArgsBuilder::state_proof") !== bytes.length) throw new Error("CreateAbiExternalPermanentArgsBuilder: field 'state_proof' validation did not consume the full buffer");
    this.__tnTail_state_proof = bytes;
    this.__tnTailParams_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateAbiExternalPermanentArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateAbiExternalPermanentArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateAbiExternalPermanentArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateAbiExternalPermanentArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateAbiExternalPermanentArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateAbiExternalPermanentArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateAbiExternalPermanentArgs {
    return this.finish();
  }

  dynamicParams(): CreateAbiExternalPermanentArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateAbiExternalPermanentArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateAbiExternalPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("CreateAbiExternalPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("CreateAbiExternalPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_state_proof_bytes = this.__tnTail_state_proof;
    if (!__tnLocal_state_proof_bytes) throw new Error("CreateAbiExternalPermanentArgsBuilder: field 'state_proof' must be written before build");
    target.set(__tnLocal_state_proof_bytes, cursor);
    cursor += __tnLocal_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateAbiExternalPermanentArgs.Params): void {
    const result = CreateAbiExternalPermanentArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateAbiExternalPermanentArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateAbiExternalPermanentArgs", (params) => CreateAbiExternalPermanentArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateAbiExternalPermanentArgs", (buffer, params) => CreateAbiExternalPermanentArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateAbiExternalPermanentArgs", (buffer) => { const result = CreateAbiExternalPermanentArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateAbiOfficialPermanentArgs ----- */

const __tn_ir_CreateAbiOfficialPermanentArgs = {
  typeName: "CreateAbiOfficialPermanentArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class CreateAbiOfficialPermanentArgs {
  private view: DataView;
  private __tnParams: CreateAbiOfficialPermanentArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateAbiOfficialPermanentArgs.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateAbiOfficialPermanentArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateAbiOfficialPermanentArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateAbiOfficialPermanentArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateAbiOfficialPermanentArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateAbiOfficialPermanentArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateAbiOfficialPermanentArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateAbiOfficialPermanentArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateAbiOfficialPermanentArgs(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): CreateAbiOfficialPermanentArgs.Params {
    return this.__tnParams;
  }

  static builder(): CreateAbiOfficialPermanentArgsBuilder {
    return new CreateAbiOfficialPermanentArgsBuilder();
  }

  static fromBuilder(builder: CreateAbiOfficialPermanentArgsBuilder): CreateAbiOfficialPermanentArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateAbiOfficialPermanentArgs.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnFieldValue_abi_meta_account_idx: number | null = null;
    let __tnFieldValue_program_meta_account_idx: number | null = null;
    let __tnFieldValue_abi_account_idx: number | null = null;
    let __tnFieldValue_srcbuf_account_idx: number | null = null;
    let __tnFieldValue_srcbuf_offset: number | null = null;
    let __tnFieldValue_srcbuf_size: number | null = null;
    let __tnFieldValue_authority_account_idx: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_abi_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_abi_meta_account_idx = __tnRead_abi_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_program_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_program_meta_account_idx = __tnRead_program_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_abi_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_abi_account_idx = __tnRead_abi_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_srcbuf_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_srcbuf_account_idx = __tnRead_srcbuf_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_srcbuf_offset = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_srcbuf_offset = __tnRead_srcbuf_offset;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_srcbuf_size = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_srcbuf_size = __tnRead_srcbuf_size;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_authority_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_authority_account_idx = __tnRead_authority_account_idx;
    __tnCursorMutable += 2;
    const __tnTyperefResult_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_state_proof.ok || __tnTyperefResult_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_state_proof = __tnTyperefResult_state_proof.params ?? null;
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_state_proof.consumed, "CreateAbiOfficialPermanentArgs::state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateAbiOfficialPermanentArgs.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = CreateAbiOfficialPermanentArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = CreateAbiOfficialPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
  }

  get_abi_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_account_idx(): number {
    return this.get_abi_account_idx();
  }

  set abi_account_idx(value: number) {
    this.set_abi_account_idx(value);
  }

  get_srcbuf_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_srcbuf_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get srcbuf_account_idx(): number {
    return this.get_srcbuf_account_idx();
  }

  set srcbuf_account_idx(value: number) {
    this.set_srcbuf_account_idx(value);
  }

  get_srcbuf_offset(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_offset(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_offset(): number {
    return this.get_srcbuf_offset();
  }

  set srcbuf_offset(value: number) {
    this.set_srcbuf_offset(value);
  }

  get_srcbuf_size(): number {
    const offset = 12;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_srcbuf_size(value: number): void {
    const offset = 12;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get srcbuf_size(): number {
    return this.get_srcbuf_size();
  }

  set srcbuf_size(value: number) {
    this.set_srcbuf_size(value);
  }

  get_srcbuf_sha256(): Seed32 {
    const offset = 16;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_srcbuf_sha256(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 16;
    this.buffer.set(sourceBytes, offset);
  }

  get srcbuf_sha256(): Seed32 {
    return this.get_srcbuf_sha256();
  }

  set srcbuf_sha256(value: Seed32) {
    this.set_srcbuf_sha256(value);
  }

  get_authority_account_idx(): number {
    const offset = 48;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 48;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_state_proof(): StateProof {
    const offset = 50;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("CreateAbiOfficialPermanentArgs: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 50;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateAbiOfficialPermanentArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateAbiOfficialPermanentArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = CreateAbiOfficialPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateAbiOfficialPermanentArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: CreateAbiOfficialPermanentArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateAbiOfficialPermanentArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateAbiOfficialPermanentArgs');
    return __tnBigIntToNumber(irResult, 'CreateAbiOfficialPermanentArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = CreateAbiOfficialPermanentArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateAbiOfficialPermanentArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateAbiOfficialPermanentArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateAbiOfficialPermanentArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiOfficialPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiOfficialPermanentArgs::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 2 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x3 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x4 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x5 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 4 > b.length) return null; const x6 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x7 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 32 > b.length) return null; c += 32;
if (c + 2 > b.length) return null; const x8 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s9 = c;
const s10 = c;
if (c + 8 > b.length) return null; const x11 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s12 = c;
const av13 = v; const ao14 = c;
if (c + 32 > b.length) return null; c += 32;
void s12;
void s10;
let t15: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x11, 62n), 3n)) as bigint | null) {
  case 0n: t15 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s16 = c;
const n17 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 31))))))))); if (n17 === null || n17 < 0n) return null;
if (BigInt(c) + n17 * 32n > BigInt(b.length)) return null; c += Number(n17 * 32n);
void s16;
return c; })(b.subarray(c)); break;
  case 1n: t15 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s18 = c;
const s19 = c;
const av20 = v; const ao21 = c;
if (c + 32 > b.length) return null; c += 32;
void s19;
const n22 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 31))))))))); if (n22 === null || n22 < 0n) return null;
if (BigInt(c) + n22 * 32n > BigInt(b.length)) return null; c += Number(n22 * 32n);
void s18;
return c; })(b.subarray(c)); break;
  case 2n: t15 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s23 = c;
const s24 = c;
const av25 = v; const ao26 = c;
if (c + 32 > b.length) return null; c += 32;
void s24;
const s27 = c;
const av28 = v; const ao29 = c;
if (c + 32 > b.length) return null; c += 32;
void s27;
const n30 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av13.getUint8(ao14 + 31))))))))); if (n30 === null || n30 < 0n) return null;
if (BigInt(c) + n30 * 32n > BigInt(b.length)) return null; c += Number(n30 * 32n);
void s23;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t15 === null || c + t15 > b.length) return null; c += t15;
void s9;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateAbiOfficialPermanentArgs.Params }): CreateAbiOfficialPermanentArgs | null {
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
    const state = new CreateAbiOfficialPermanentArgs(buffer, cached);
    return state;
  }


}

export namespace CreateAbiOfficialPermanentArgs {
  export type Params = {
    /** ABI path: proof_body.hdr.type_slot */
    readonly proof_body_hdr_type_slot: bigint;
    /** ABI path: proof_body.payload_size */
    readonly proof_body_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_body_hdr_type_slot: "proof_body.hdr.type_slot",
    proof_body_payload_size: "proof_body.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
      return {
        proof_body_hdr_type_slot: __tnToBigInt(input.proof_body_hdr_type_slot),
        proof_body_payload_size: __tnToBigInt(input.proof_body_payload_size),
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

  export function params(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateAbiOfficialPermanentArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateAbiOfficialPermanentArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateAbiOfficialPermanentArgs.Params | null = null;
  private __tnTail_state_proof: Uint8Array | null = null;
  private __tnTailParams_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(50);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_abi_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_offset(value: number): this {
    this.view.setUint32(8, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_size(value: number): this {
    this.view.setUint32(12, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_srcbuf_sha256(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("srcbuf_sha256 expects 32 bytes");
    this.buffer.set(value, 16);
    this.__tnInvalidate();
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(48, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "CreateAbiOfficialPermanentArgsBuilder::state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("CreateAbiOfficialPermanentArgsBuilder: field 'state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "CreateAbiOfficialPermanentArgsBuilder::state_proof") !== bytes.length) throw new Error("CreateAbiOfficialPermanentArgsBuilder: field 'state_proof' validation did not consume the full buffer");
    this.__tnTail_state_proof = bytes;
    this.__tnTailParams_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateAbiOfficialPermanentArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateAbiOfficialPermanentArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateAbiOfficialPermanentArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateAbiOfficialPermanentArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateAbiOfficialPermanentArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateAbiOfficialPermanentArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateAbiOfficialPermanentArgs {
    return this.finish();
  }

  dynamicParams(): CreateAbiOfficialPermanentArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateAbiOfficialPermanentArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateAbiOfficialPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("CreateAbiOfficialPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("CreateAbiOfficialPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_state_proof_bytes = this.__tnTail_state_proof;
    if (!__tnLocal_state_proof_bytes) throw new Error("CreateAbiOfficialPermanentArgsBuilder: field 'state_proof' must be written before build");
    target.set(__tnLocal_state_proof_bytes, cursor);
    cursor += __tnLocal_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateAbiOfficialPermanentArgs.Params): void {
    const result = CreateAbiOfficialPermanentArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateAbiOfficialPermanentArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateAbiOfficialPermanentArgs", (params) => CreateAbiOfficialPermanentArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateAbiOfficialPermanentArgs", (buffer, params) => CreateAbiOfficialPermanentArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateAbiOfficialPermanentArgs", (buffer) => { const result = CreateAbiOfficialPermanentArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateMetaExternalPermanentArgs ----- */

const __tn_ir_CreateMetaExternalPermanentArgs = {
  typeName: "CreateMetaExternalPermanentArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class CreateMetaExternalPermanentArgs {
  private view: DataView;
  private __tnParams: CreateMetaExternalPermanentArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateMetaExternalPermanentArgs.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateMetaExternalPermanentArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateMetaExternalPermanentArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateMetaExternalPermanentArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateMetaExternalPermanentArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateMetaExternalPermanentArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateMetaExternalPermanentArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateMetaExternalPermanentArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateMetaExternalPermanentArgs(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): CreateMetaExternalPermanentArgs.Params {
    return this.__tnParams;
  }

  static builder(): CreateMetaExternalPermanentArgsBuilder {
    return new CreateMetaExternalPermanentArgsBuilder();
  }

  static fromBuilder(builder: CreateMetaExternalPermanentArgsBuilder): CreateMetaExternalPermanentArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateMetaExternalPermanentArgs.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnFieldValue_abi_meta_account_idx: number | null = null;
    let __tnFieldValue_authority_account_idx: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_abi_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_abi_meta_account_idx = __tnRead_abi_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_authority_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_authority_account_idx = __tnRead_authority_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    const __tnTyperefResult_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_state_proof.ok || __tnTyperefResult_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_state_proof = __tnTyperefResult_state_proof.params ?? null;
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_state_proof.consumed, "CreateMetaExternalPermanentArgs::state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateMetaExternalPermanentArgs.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = CreateMetaExternalPermanentArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = CreateMetaExternalPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_target_program(): Pubkey {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_target_program(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
    this.buffer.set(sourceBytes, offset);
  }

  get target_program(): Pubkey {
    return this.get_target_program();
  }

  set target_program(value: Pubkey) {
    this.set_target_program(value);
  }

  get_seed(): Seed32 {
    const offset = 36;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 36;
    this.buffer.set(sourceBytes, offset);
  }

  get seed(): Seed32 {
    return this.get_seed();
  }

  set seed(value: Seed32) {
    this.set_seed(value);
  }

  get_state_proof(): StateProof {
    const offset = 68;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("CreateMetaExternalPermanentArgs: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 68;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateMetaExternalPermanentArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateMetaExternalPermanentArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = CreateMetaExternalPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateMetaExternalPermanentArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: CreateMetaExternalPermanentArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateMetaExternalPermanentArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateMetaExternalPermanentArgs');
    return __tnBigIntToNumber(irResult, 'CreateMetaExternalPermanentArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = CreateMetaExternalPermanentArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateMetaExternalPermanentArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateMetaExternalPermanentArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateMetaExternalPermanentArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaExternalPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaExternalPermanentArgs::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 2 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x3 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s4 = c;
const av5 = v; const ao6 = c;
if (c + 32 > b.length) return null; c += 32;
void s4;
if (c + 32 > b.length) return null; c += 32;
const s7 = c;
const s8 = c;
if (c + 8 > b.length) return null; const x9 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s10 = c;
const av11 = v; const ao12 = c;
if (c + 32 > b.length) return null; c += 32;
void s10;
void s8;
let t13: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x9, 62n), 3n)) as bigint | null) {
  case 0n: t13 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s14 = c;
const n15 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 31))))))))); if (n15 === null || n15 < 0n) return null;
if (BigInt(c) + n15 * 32n > BigInt(b.length)) return null; c += Number(n15 * 32n);
void s14;
return c; })(b.subarray(c)); break;
  case 1n: t13 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s16 = c;
const s17 = c;
const av18 = v; const ao19 = c;
if (c + 32 > b.length) return null; c += 32;
void s17;
const n20 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 31))))))))); if (n20 === null || n20 < 0n) return null;
if (BigInt(c) + n20 * 32n > BigInt(b.length)) return null; c += Number(n20 * 32n);
void s16;
return c; })(b.subarray(c)); break;
  case 2n: t13 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s21 = c;
const s22 = c;
const av23 = v; const ao24 = c;
if (c + 32 > b.length) return null; c += 32;
void s22;
const s25 = c;
const av26 = v; const ao27 = c;
if (c + 32 > b.length) return null; c += 32;
void s25;
const n28 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av11.getUint8(ao12 + 31))))))))); if (n28 === null || n28 < 0n) return null;
if (BigInt(c) + n28 * 32n > BigInt(b.length)) return null; c += Number(n28 * 32n);
void s21;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t13 === null || c + t13 > b.length) return null; c += t13;
void s7;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateMetaExternalPermanentArgs.Params }): CreateMetaExternalPermanentArgs | null {
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
    const state = new CreateMetaExternalPermanentArgs(buffer, cached);
    return state;
  }


}

export namespace CreateMetaExternalPermanentArgs {
  export type Params = {
    /** ABI path: proof_body.hdr.type_slot */
    readonly proof_body_hdr_type_slot: bigint;
    /** ABI path: proof_body.payload_size */
    readonly proof_body_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_body_hdr_type_slot: "proof_body.hdr.type_slot",
    proof_body_payload_size: "proof_body.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
      return {
        proof_body_hdr_type_slot: __tnToBigInt(input.proof_body_hdr_type_slot),
        proof_body_payload_size: __tnToBigInt(input.proof_body_payload_size),
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

  export function params(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateMetaExternalPermanentArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateMetaExternalPermanentArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateMetaExternalPermanentArgs.Params | null = null;
  private __tnTail_state_proof: Uint8Array | null = null;
  private __tnTailParams_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(68);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_target_program(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("target_program expects 32 bytes");
    this.buffer.set(value, 4);
    this.__tnInvalidate();
    return this;
  }

  set_seed(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seed expects 32 bytes");
    this.buffer.set(value, 36);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "CreateMetaExternalPermanentArgsBuilder::state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("CreateMetaExternalPermanentArgsBuilder: field 'state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "CreateMetaExternalPermanentArgsBuilder::state_proof") !== bytes.length) throw new Error("CreateMetaExternalPermanentArgsBuilder: field 'state_proof' validation did not consume the full buffer");
    this.__tnTail_state_proof = bytes;
    this.__tnTailParams_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateMetaExternalPermanentArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateMetaExternalPermanentArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateMetaExternalPermanentArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateMetaExternalPermanentArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateMetaExternalPermanentArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateMetaExternalPermanentArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateMetaExternalPermanentArgs {
    return this.finish();
  }

  dynamicParams(): CreateMetaExternalPermanentArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateMetaExternalPermanentArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateMetaExternalPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("CreateMetaExternalPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("CreateMetaExternalPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_state_proof_bytes = this.__tnTail_state_proof;
    if (!__tnLocal_state_proof_bytes) throw new Error("CreateMetaExternalPermanentArgsBuilder: field 'state_proof' must be written before build");
    target.set(__tnLocal_state_proof_bytes, cursor);
    cursor += __tnLocal_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateMetaExternalPermanentArgs.Params): void {
    const result = CreateMetaExternalPermanentArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateMetaExternalPermanentArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateMetaExternalPermanentArgs", (params) => CreateMetaExternalPermanentArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateMetaExternalPermanentArgs", (buffer, params) => CreateMetaExternalPermanentArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateMetaExternalPermanentArgs", (buffer) => { const result = CreateMetaExternalPermanentArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateMetaOfficialPermanentArgs ----- */

const __tn_ir_CreateMetaOfficialPermanentArgs = {
  typeName: "CreateMetaOfficialPermanentArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class CreateMetaOfficialPermanentArgs {
  private view: DataView;
  private __tnParams: CreateMetaOfficialPermanentArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateMetaOfficialPermanentArgs.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateMetaOfficialPermanentArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateMetaOfficialPermanentArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateMetaOfficialPermanentArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateMetaOfficialPermanentArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateMetaOfficialPermanentArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateMetaOfficialPermanentArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateMetaOfficialPermanentArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateMetaOfficialPermanentArgs(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): CreateMetaOfficialPermanentArgs.Params {
    return this.__tnParams;
  }

  static builder(): CreateMetaOfficialPermanentArgsBuilder {
    return new CreateMetaOfficialPermanentArgsBuilder();
  }

  static fromBuilder(builder: CreateMetaOfficialPermanentArgsBuilder): CreateMetaOfficialPermanentArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateMetaOfficialPermanentArgs.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnFieldValue_abi_meta_account_idx: number | null = null;
    let __tnFieldValue_program_meta_account_idx: number | null = null;
    let __tnFieldValue_authority_account_idx: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_abi_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_abi_meta_account_idx = __tnRead_abi_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_program_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_program_meta_account_idx = __tnRead_program_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_authority_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_authority_account_idx = __tnRead_authority_account_idx;
    __tnCursorMutable += 2;
    const __tnTyperefResult_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_state_proof.ok || __tnTyperefResult_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_state_proof = __tnTyperefResult_state_proof.params ?? null;
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_state_proof.consumed, "CreateMetaOfficialPermanentArgs::state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateMetaOfficialPermanentArgs.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = CreateMetaOfficialPermanentArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = CreateMetaOfficialPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_abi_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_abi_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get abi_meta_account_idx(): number {
    return this.get_abi_meta_account_idx();
  }

  set abi_meta_account_idx(value: number) {
    this.set_abi_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
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

  get_state_proof(): StateProof {
    const offset = 6;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("CreateMetaOfficialPermanentArgs: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 6;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateMetaOfficialPermanentArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateMetaOfficialPermanentArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = CreateMetaOfficialPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateMetaOfficialPermanentArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: CreateMetaOfficialPermanentArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateMetaOfficialPermanentArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateMetaOfficialPermanentArgs');
    return __tnBigIntToNumber(irResult, 'CreateMetaOfficialPermanentArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = CreateMetaOfficialPermanentArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateMetaOfficialPermanentArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateMetaOfficialPermanentArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateMetaOfficialPermanentArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaOfficialPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaOfficialPermanentArgs::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 2 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x3 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x4 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s5 = c;
const s6 = c;
if (c + 8 > b.length) return null; const x7 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s8 = c;
const av9 = v; const ao10 = c;
if (c + 32 > b.length) return null; c += 32;
void s8;
void s6;
let t11: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x7, 62n), 3n)) as bigint | null) {
  case 0n: t11 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s12 = c;
const n13 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 31))))))))); if (n13 === null || n13 < 0n) return null;
if (BigInt(c) + n13 * 32n > BigInt(b.length)) return null; c += Number(n13 * 32n);
void s12;
return c; })(b.subarray(c)); break;
  case 1n: t11 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s14 = c;
const s15 = c;
const av16 = v; const ao17 = c;
if (c + 32 > b.length) return null; c += 32;
void s15;
const n18 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 31))))))))); if (n18 === null || n18 < 0n) return null;
if (BigInt(c) + n18 * 32n > BigInt(b.length)) return null; c += Number(n18 * 32n);
void s14;
return c; })(b.subarray(c)); break;
  case 2n: t11 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s19 = c;
const s20 = c;
const av21 = v; const ao22 = c;
if (c + 32 > b.length) return null; c += 32;
void s20;
const s23 = c;
const av24 = v; const ao25 = c;
if (c + 32 > b.length) return null; c += 32;
void s23;
const n26 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av9.getUint8(ao10 + 31))))))))); if (n26 === null || n26 < 0n) return null;
if (BigInt(c) + n26 * 32n > BigInt(b.length)) return null; c += Number(n26 * 32n);
void s19;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t11 === null || c + t11 > b.length) return null; c += t11;
void s5;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateMetaOfficialPermanentArgs.Params }): CreateMetaOfficialPermanentArgs | null {
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
    const state = new CreateMetaOfficialPermanentArgs(buffer, cached);
    return state;
  }


}

export namespace CreateMetaOfficialPermanentArgs {
  export type Params = {
    /** ABI path: proof_body.hdr.type_slot */
    readonly proof_body_hdr_type_slot: bigint;
    /** ABI path: proof_body.payload_size */
    readonly proof_body_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_body_hdr_type_slot: "proof_body.hdr.type_slot",
    proof_body_payload_size: "proof_body.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
      return {
        proof_body_hdr_type_slot: __tnToBigInt(input.proof_body_hdr_type_slot),
        proof_body_payload_size: __tnToBigInt(input.proof_body_payload_size),
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

  export function params(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateMetaOfficialPermanentArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateMetaOfficialPermanentArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateMetaOfficialPermanentArgs.Params | null = null;
  private __tnTail_state_proof: Uint8Array | null = null;
  private __tnTailParams_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_abi_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "CreateMetaOfficialPermanentArgsBuilder::state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("CreateMetaOfficialPermanentArgsBuilder: field 'state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "CreateMetaOfficialPermanentArgsBuilder::state_proof") !== bytes.length) throw new Error("CreateMetaOfficialPermanentArgsBuilder: field 'state_proof' validation did not consume the full buffer");
    this.__tnTail_state_proof = bytes;
    this.__tnTailParams_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateMetaOfficialPermanentArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateMetaOfficialPermanentArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateMetaOfficialPermanentArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateMetaOfficialPermanentArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateMetaOfficialPermanentArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateMetaOfficialPermanentArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateMetaOfficialPermanentArgs {
    return this.finish();
  }

  dynamicParams(): CreateMetaOfficialPermanentArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateMetaOfficialPermanentArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateMetaOfficialPermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("CreateMetaOfficialPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("CreateMetaOfficialPermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_state_proof_bytes = this.__tnTail_state_proof;
    if (!__tnLocal_state_proof_bytes) throw new Error("CreateMetaOfficialPermanentArgsBuilder: field 'state_proof' must be written before build");
    target.set(__tnLocal_state_proof_bytes, cursor);
    cursor += __tnLocal_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateMetaOfficialPermanentArgs.Params): void {
    const result = CreateMetaOfficialPermanentArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateMetaOfficialPermanentArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateMetaOfficialPermanentArgs", (params) => CreateMetaOfficialPermanentArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateMetaOfficialPermanentArgs", (buffer, params) => CreateMetaOfficialPermanentArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateMetaOfficialPermanentArgs", (buffer) => { const result = CreateMetaOfficialPermanentArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR GovernedAbiCreatePermanentArgs ----- */

const __tn_ir_GovernedAbiCreatePermanentArgs = {
  typeName: "GovernedAbiCreatePermanentArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 278n } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class GovernedAbiCreatePermanentArgs {
  private view: DataView;
  private __tnParams: GovernedAbiCreatePermanentArgs.Params;

  private constructor(private buffer: Uint8Array, params?: GovernedAbiCreatePermanentArgs.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = GovernedAbiCreatePermanentArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("GovernedAbiCreatePermanentArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: GovernedAbiCreatePermanentArgs.Params, fieldContext?: Record<string, number | bigint> }): GovernedAbiCreatePermanentArgs {
    if (!buffer || buffer.length === undefined) throw new Error("GovernedAbiCreatePermanentArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = GovernedAbiCreatePermanentArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("GovernedAbiCreatePermanentArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new GovernedAbiCreatePermanentArgs(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): GovernedAbiCreatePermanentArgs.Params {
    return this.__tnParams;
  }

  static builder(): GovernedAbiCreatePermanentArgsBuilder {
    return new GovernedAbiCreatePermanentArgsBuilder();
  }

  static fromBuilder(builder: GovernedAbiCreatePermanentArgsBuilder): GovernedAbiCreatePermanentArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return GovernedAbiCreatePermanentArgs.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 278 > __tnLength) return null;
    __tnCursorMutable += 278;
    const __tnTyperefResult_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_state_proof.ok || __tnTyperefResult_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_state_proof = __tnTyperefResult_state_proof.params ?? null;
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_state_proof.consumed, "GovernedAbiCreatePermanentArgs::state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: GovernedAbiCreatePermanentArgs.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = GovernedAbiCreatePermanentArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = GovernedAbiCreatePermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_governed(): GovernedAbiArgs {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 278);
    return GovernedAbiArgs.from_array(slice)!;
  }

  set_governed(value: GovernedAbiArgs): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get governed(): GovernedAbiArgs {
    return this.get_governed();
  }

  set governed(value: GovernedAbiArgs) {
    this.set_governed(value);
  }

  get_state_proof(): StateProof {
    const offset = 278;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("GovernedAbiCreatePermanentArgs: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 278;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_GovernedAbiCreatePermanentArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_GovernedAbiCreatePermanentArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = GovernedAbiCreatePermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: GovernedAbiCreatePermanentArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: GovernedAbiCreatePermanentArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: GovernedAbiCreatePermanentArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for GovernedAbiCreatePermanentArgs');
    return __tnBigIntToNumber(irResult, 'GovernedAbiCreatePermanentArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = GovernedAbiCreatePermanentArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: GovernedAbiCreatePermanentArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: GovernedAbiCreatePermanentArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: GovernedAbiCreatePermanentArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'GovernedAbiCreatePermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'GovernedAbiCreatePermanentArgs::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
const s2 = c;
const s3 = c;
if (c + 2 > b.length) return null; const x4 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s5 = c;
const av6 = v; const ao7 = c;
if (c + 32 > b.length) return null; c += 32;
void s5;
void s3;
const s8 = c;
if (c + 2 > b.length) return null; const x9 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s10 = c;
const av11 = v; const ao12 = c;
if (c + 32 > b.length) return null; c += 32;
void s10;
void s8;
const s13 = c;
if (c + 2 > b.length) return null; const x14 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s15 = c;
const av16 = v; const ao17 = c;
if (c + 32 > b.length) return null; c += 32;
void s15;
void s13;
const s18 = c;
if (c + 2 > b.length) return null; const x19 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s20 = c;
const av21 = v; const ao22 = c;
if (c + 32 > b.length) return null; c += 32;
void s20;
void s18;
const s23 = c;
if (c + 2 > b.length) return null; const x24 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s25 = c;
const av26 = v; const ao27 = c;
if (c + 32 > b.length) return null; c += 32;
void s25;
void s23;
const s28 = c;
if (c + 2 > b.length) return null; const x29 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s30 = c;
const av31 = v; const ao32 = c;
if (c + 32 > b.length) return null; c += 32;
void s30;
void s28;
const s33 = c;
if (c + 2 > b.length) return null; const x34 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s35 = c;
const av36 = v; const ao37 = c;
if (c + 32 > b.length) return null; c += 32;
void s35;
void s33;
if (c + 4 > b.length) return null; const x38 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x39 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 32 > b.length) return null; c += 32;
void s2;
const s40 = c;
const s41 = c;
if (c + 8 > b.length) return null; const x42 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s43 = c;
const av44 = v; const ao45 = c;
if (c + 32 > b.length) return null; c += 32;
void s43;
void s41;
let t46: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x42, 62n), 3n)) as bigint | null) {
  case 0n: t46 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s47 = c;
const n48 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 31))))))))); if (n48 === null || n48 < 0n) return null;
if (BigInt(c) + n48 * 32n > BigInt(b.length)) return null; c += Number(n48 * 32n);
void s47;
return c; })(b.subarray(c)); break;
  case 1n: t46 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s49 = c;
const s50 = c;
const av51 = v; const ao52 = c;
if (c + 32 > b.length) return null; c += 32;
void s50;
const n53 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 31))))))))); if (n53 === null || n53 < 0n) return null;
if (BigInt(c) + n53 * 32n > BigInt(b.length)) return null; c += Number(n53 * 32n);
void s49;
return c; })(b.subarray(c)); break;
  case 2n: t46 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s54 = c;
const s55 = c;
const av56 = v; const ao57 = c;
if (c + 32 > b.length) return null; c += 32;
void s55;
const s58 = c;
const av59 = v; const ao60 = c;
if (c + 32 > b.length) return null; c += 32;
void s58;
const n61 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av44.getUint8(ao45 + 31))))))))); if (n61 === null || n61 < 0n) return null;
if (BigInt(c) + n61 * 32n > BigInt(b.length)) return null; c += Number(n61 * 32n);
void s54;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t46 === null || c + t46 > b.length) return null; c += t46;
void s40;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: GovernedAbiCreatePermanentArgs.Params }): GovernedAbiCreatePermanentArgs | null {
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
    const state = new GovernedAbiCreatePermanentArgs(buffer, cached);
    return state;
  }


}

export namespace GovernedAbiCreatePermanentArgs {
  export type Params = {
    /** ABI path: proof_body.hdr.type_slot */
    readonly proof_body_hdr_type_slot: bigint;
    /** ABI path: proof_body.payload_size */
    readonly proof_body_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_body_hdr_type_slot: "proof_body.hdr.type_slot",
    proof_body_payload_size: "proof_body.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
      return {
        proof_body_hdr_type_slot: __tnToBigInt(input.proof_body_hdr_type_slot),
        proof_body_payload_size: __tnToBigInt(input.proof_body_payload_size),
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

  export function params(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class GovernedAbiCreatePermanentArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: GovernedAbiCreatePermanentArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: GovernedAbiCreatePermanentArgs.Params | null = null;
  private __tnTail_state_proof: Uint8Array | null = null;
  private __tnTailParams_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(278);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_governed(value: Uint8Array): this {
    if (value.length !== 278) throw new Error("governed expects 278 bytes");
    this.buffer.set(value, 0);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "GovernedAbiCreatePermanentArgsBuilder::state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("GovernedAbiCreatePermanentArgsBuilder: field 'state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "GovernedAbiCreatePermanentArgsBuilder::state_proof") !== bytes.length) throw new Error("GovernedAbiCreatePermanentArgsBuilder: field 'state_proof' validation did not consume the full buffer");
    this.__tnTail_state_proof = bytes;
    this.__tnTailParams_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = GovernedAbiCreatePermanentArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = GovernedAbiCreatePermanentArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("GovernedAbiCreatePermanentArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): GovernedAbiCreatePermanentArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = GovernedAbiCreatePermanentArgs.from_array(buffer, { params });
    if (!view) throw new Error("GovernedAbiCreatePermanentArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): GovernedAbiCreatePermanentArgs {
    return this.finish();
  }

  dynamicParams(): GovernedAbiCreatePermanentArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): GovernedAbiCreatePermanentArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = GovernedAbiCreatePermanentArgs.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("GovernedAbiCreatePermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("GovernedAbiCreatePermanentArgsBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_state_proof_bytes = this.__tnTail_state_proof;
    if (!__tnLocal_state_proof_bytes) throw new Error("GovernedAbiCreatePermanentArgsBuilder: field 'state_proof' must be written before build");
    target.set(__tnLocal_state_proof_bytes, cursor);
    cursor += __tnLocal_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: GovernedAbiCreatePermanentArgs.Params): void {
    const result = GovernedAbiCreatePermanentArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ GovernedAbiCreatePermanentArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("GovernedAbiCreatePermanentArgs", (params) => GovernedAbiCreatePermanentArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("GovernedAbiCreatePermanentArgs", (buffer, params) => GovernedAbiCreatePermanentArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("GovernedAbiCreatePermanentArgs", (buffer) => { const result = GovernedAbiCreatePermanentArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiManagerInstruction ----- */

const __tn_ir_AbiManagerInstruction = {
  typeName: "AbiManagerInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class AbiManagerInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): AbiManagerInstruction_payload_Inner {
    return new AbiManagerInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AbiManagerInstruction_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["discriminant"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 0)) descriptor = { name: "create_meta_official_permanent", tag: 0, payloadSize: null };
      if (__tnTagEquals(tag, 1)) descriptor = { name: "create_meta_official_ephemeral", tag: 1, payloadSize: 6 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "create_meta_external_permanent", tag: 2, payloadSize: null };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "create_meta_external_ephemeral", tag: 3, payloadSize: 68 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "create_abi_official_permanent", tag: 4, payloadSize: null };
      if (__tnTagEquals(tag, 5)) descriptor = { name: "create_abi_official_ephemeral", tag: 5, payloadSize: 50 };
      if (__tnTagEquals(tag, 6)) descriptor = { name: "create_abi_external_permanent", tag: 6, payloadSize: null };
      if (__tnTagEquals(tag, 7)) descriptor = { name: "create_abi_external_ephemeral", tag: 7, payloadSize: 48 };
      if (__tnTagEquals(tag, 8)) descriptor = { name: "upgrade_abi_official", tag: 8, payloadSize: 50 };
      if (__tnTagEquals(tag, 9)) descriptor = { name: "upgrade_abi_external", tag: 9, payloadSize: 48 };
      if (__tnTagEquals(tag, 10)) descriptor = { name: "close_abi_official", tag: 10, payloadSize: 8 };
      if (__tnTagEquals(tag, 11)) descriptor = { name: "close_abi_external", tag: 11, payloadSize: 6 };
      if (__tnTagEquals(tag, 12)) descriptor = { name: "finalize_abi_official", tag: 12, payloadSize: 8 };
      if (__tnTagEquals(tag, 13)) descriptor = { name: "finalize_abi_external", tag: 13, payloadSize: 6 };
      if (__tnTagEquals(tag, 14)) descriptor = { name: "upgrade_root_official_abi", tag: 14, payloadSize: 278 };
      if (__tnTagEquals(tag, 15)) descriptor = { name: "core_create_meta_permanent", tag: 15, payloadSize: null };
      if (__tnTagEquals(tag, 16)) descriptor = { name: "core_create_meta_ephemeral", tag: 16, payloadSize: 278 };
      if (__tnTagEquals(tag, 17)) descriptor = { name: "core_create_content_permanent", tag: 17, payloadSize: null };
      if (__tnTagEquals(tag, 18)) descriptor = { name: "core_create_content_ephemeral", tag: 18, payloadSize: 278 };
      if (__tnTagEquals(tag, 19)) descriptor = { name: "core_upgrade", tag: 19, payloadSize: 278 };
      if (__tnTagEquals(tag, 20)) descriptor = { name: "core_close", tag: 20, payloadSize: 278 };
      if (__tnTagEquals(tag, 21)) descriptor = { name: "core_finalize", tag: 21, payloadSize: 278 };
    }
    return new AbiManagerInstruction_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreateMetaOfficialPermanent(): CreateMetaOfficialPermanentArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 0)) return null;
    return CreateMetaOfficialPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateMetaOfficialEphemeral(): CreateMetaOfficialEphemeralArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return CreateMetaOfficialEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateMetaExternalPermanent(): CreateMetaExternalPermanentArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return CreateMetaExternalPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateMetaExternalEphemeral(): CreateMetaExternalEphemeralArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return CreateMetaExternalEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiOfficialPermanent(): CreateAbiOfficialPermanentArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return CreateAbiOfficialPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiOfficialEphemeral(): CreateAbiOfficialEphemeralArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 5)) return null;
    return CreateAbiOfficialEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiExternalPermanent(): CreateAbiExternalPermanentArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 6)) return null;
    return CreateAbiExternalPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiExternalEphemeral(): CreateAbiExternalEphemeralArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 7)) return null;
    return CreateAbiExternalEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgradeAbiOfficial(): UpgradeAbiOfficialArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 8)) return null;
    return UpgradeAbiOfficialArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgradeAbiExternal(): UpgradeAbiExternalArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 9)) return null;
    return UpgradeAbiExternalArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAbiOfficial(): CloseAbiOfficialArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 10)) return null;
    return CloseAbiOfficialArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAbiExternal(): CloseAbiExternalArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 11)) return null;
    return CloseAbiExternalArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFinalizeAbiOfficial(): FinalizeAbiOfficialArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 12)) return null;
    return FinalizeAbiOfficialArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFinalizeAbiExternal(): FinalizeAbiExternalArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 13)) return null;
    return FinalizeAbiExternalArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgradeRootOfficialAbi(): GovernedAbiArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 14)) return null;
    return GovernedAbiArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCoreCreateMetaPermanent(): GovernedAbiCreatePermanentArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 15)) return null;
    return GovernedAbiCreatePermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCoreCreateMetaEphemeral(): GovernedAbiArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 16)) return null;
    return GovernedAbiArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCoreCreateContentPermanent(): GovernedAbiCreatePermanentArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 17)) return null;
    return GovernedAbiCreatePermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCoreCreateContentEphemeral(): GovernedAbiArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 18)) return null;
    return GovernedAbiArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCoreUpgrade(): GovernedAbiArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 19)) return null;
    return GovernedAbiArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCoreClose(): GovernedAbiArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 20)) return null;
    return GovernedAbiArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCoreFinalize(): GovernedAbiArgs | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 21)) return null;
    return GovernedAbiArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class AbiManagerInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: AbiManagerInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: AbiManagerInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = AbiManagerInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("AbiManagerInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: AbiManagerInstruction.Params, fieldContext?: Record<string, number | bigint> }): AbiManagerInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("AbiManagerInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = AbiManagerInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("AbiManagerInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new AbiManagerInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): AbiManagerInstruction.Params {
    return this.__tnParams;
  }

  static builder(): AbiManagerInstructionBuilder {
    return new AbiManagerInstructionBuilder();
  }

  static fromBuilder(builder: AbiManagerInstructionBuilder): AbiManagerInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return AbiManagerInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create_meta_official_permanent",
      tag: 0,
      payloadSize: null,
      payloadType: "AbiManagerInstruction::payload::create_meta_official_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateMetaOfficialPermanentArgs),
    },
    {
      name: "create_meta_official_ephemeral",
      tag: 1,
      payloadSize: 6,
      payloadType: "AbiManagerInstruction::payload::create_meta_official_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateMetaOfficialEphemeralArgs),
    },
    {
      name: "create_meta_external_permanent",
      tag: 2,
      payloadSize: null,
      payloadType: "AbiManagerInstruction::payload::create_meta_external_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateMetaExternalPermanentArgs),
    },
    {
      name: "create_meta_external_ephemeral",
      tag: 3,
      payloadSize: 68,
      payloadType: "AbiManagerInstruction::payload::create_meta_external_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateMetaExternalEphemeralArgs),
    },
    {
      name: "create_abi_official_permanent",
      tag: 4,
      payloadSize: null,
      payloadType: "AbiManagerInstruction::payload::create_abi_official_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateAbiOfficialPermanentArgs),
    },
    {
      name: "create_abi_official_ephemeral",
      tag: 5,
      payloadSize: 50,
      payloadType: "AbiManagerInstruction::payload::create_abi_official_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateAbiOfficialEphemeralArgs),
    },
    {
      name: "create_abi_external_permanent",
      tag: 6,
      payloadSize: null,
      payloadType: "AbiManagerInstruction::payload::create_abi_external_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateAbiExternalPermanentArgs),
    },
    {
      name: "create_abi_external_ephemeral",
      tag: 7,
      payloadSize: 48,
      payloadType: "AbiManagerInstruction::payload::create_abi_external_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateAbiExternalEphemeralArgs),
    },
    {
      name: "upgrade_abi_official",
      tag: 8,
      payloadSize: 50,
      payloadType: "AbiManagerInstruction::payload::upgrade_abi_official",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UpgradeAbiOfficialArgs),
    },
    {
      name: "upgrade_abi_external",
      tag: 9,
      payloadSize: 48,
      payloadType: "AbiManagerInstruction::payload::upgrade_abi_external",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UpgradeAbiExternalArgs),
    },
    {
      name: "close_abi_official",
      tag: 10,
      payloadSize: 8,
      payloadType: "AbiManagerInstruction::payload::close_abi_official",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CloseAbiOfficialArgs),
    },
    {
      name: "close_abi_external",
      tag: 11,
      payloadSize: 6,
      payloadType: "AbiManagerInstruction::payload::close_abi_external",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CloseAbiExternalArgs),
    },
    {
      name: "finalize_abi_official",
      tag: 12,
      payloadSize: 8,
      payloadType: "AbiManagerInstruction::payload::finalize_abi_official",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FinalizeAbiOfficialArgs),
    },
    {
      name: "finalize_abi_external",
      tag: 13,
      payloadSize: 6,
      payloadType: "AbiManagerInstruction::payload::finalize_abi_external",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FinalizeAbiExternalArgs),
    },
    {
      name: "upgrade_root_official_abi",
      tag: 14,
      payloadSize: 278,
      payloadType: "AbiManagerInstruction::payload::upgrade_root_official_abi",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiArgs),
    },
    {
      name: "core_create_meta_permanent",
      tag: 15,
      payloadSize: null,
      payloadType: "AbiManagerInstruction::payload::core_create_meta_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiCreatePermanentArgs),
    },
    {
      name: "core_create_meta_ephemeral",
      tag: 16,
      payloadSize: 278,
      payloadType: "AbiManagerInstruction::payload::core_create_meta_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiArgs),
    },
    {
      name: "core_create_content_permanent",
      tag: 17,
      payloadSize: null,
      payloadType: "AbiManagerInstruction::payload::core_create_content_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiCreatePermanentArgs),
    },
    {
      name: "core_create_content_ephemeral",
      tag: 18,
      payloadSize: 278,
      payloadType: "AbiManagerInstruction::payload::core_create_content_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiArgs),
    },
    {
      name: "core_upgrade",
      tag: 19,
      payloadSize: 278,
      payloadType: "AbiManagerInstruction::payload::core_upgrade",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiArgs),
    },
    {
      name: "core_close",
      tag: 20,
      payloadSize: 278,
      payloadType: "AbiManagerInstruction::payload::core_close",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiArgs),
    },
    {
      name: "core_finalize",
      tag: 21,
      payloadSize: 278,
      payloadType: "AbiManagerInstruction::payload::core_finalize",
      createPayloadBuilder: () => __tnMaybeCallBuilder(GovernedAbiArgs),
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_payload_payload_size: bigint | null = null;
    let __tnFieldValue_discriminant: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_discriminant = view.getUint8(__tnCursorMutable);
    __tnFieldValue_discriminant = __tnRead_discriminant;
    __tnCursorMutable += 1;
    const __tnEnumTagValue_payload = __tnFieldValue_discriminant;
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
      case 12n: break;
      case 13n: break;
      case 14n: break;
      case 15n: break;
      case 16n: break;
      case 17n: break;
      case 18n: break;
      case 19n: break;
      case 20n: break;
      case 21n: break;
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: AbiManagerInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_discriminant = __tnToBigInt(view.getUint8(0));
    const __tnLayout = AbiManagerInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = AbiManagerInstruction.Params.fromValues({
      payload_discriminant: __tnParam_payload_discriminant,
      payload_payload_size: __tnParamSeq_payload_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_discriminant(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_discriminant(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get discriminant(): number {
    return this.get_discriminant();
  }

  set discriminant(value: number) {
    this.set_discriminant(value);
  }

  payloadVariant(): typeof AbiManagerInstruction.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_discriminant();
    return AbiManagerInstruction.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): AbiManagerInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("AbiManagerInstruction: unknown payload variant");
    const offset = AbiManagerInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("AbiManagerInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return AbiManagerInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiManagerInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiManagerInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_discriminant: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = AbiManagerInstruction.Params.fromValues({
      payload_discriminant: payload_discriminant,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: AbiManagerInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.discriminant"] = params.payload_discriminant;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: AbiManagerInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: AbiManagerInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiManagerInstruction');
    return __tnBigIntToNumber(irResult, 'AbiManagerInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_discriminant: number | bigint, payload_payload_size: number | bigint }): number {
    const params = AbiManagerInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: AbiManagerInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: AbiManagerInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: AbiManagerInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiManagerInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiManagerInstruction::validate') : undefined;
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
  case 0n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s4 = c;
if (c + 2 > b.length) return null; const x5 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x6 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x7 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s8 = c;
const s9 = c;
if (c + 8 > b.length) return null; const x10 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s11 = c;
const av12 = v; const ao13 = c;
if (c + 32 > b.length) return null; c += 32;
void s11;
void s9;
let t14: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x10, 62n), 3n)) as bigint | null) {
  case 0n: t14 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s15 = c;
const n16 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 31))))))))); if (n16 === null || n16 < 0n) return null;
if (BigInt(c) + n16 * 32n > BigInt(b.length)) return null; c += Number(n16 * 32n);
void s15;
return c; })(b.subarray(c)); break;
  case 1n: t14 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s17 = c;
const s18 = c;
const av19 = v; const ao20 = c;
if (c + 32 > b.length) return null; c += 32;
void s18;
const n21 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 31))))))))); if (n21 === null || n21 < 0n) return null;
if (BigInt(c) + n21 * 32n > BigInt(b.length)) return null; c += Number(n21 * 32n);
void s17;
return c; })(b.subarray(c)); break;
  case 2n: t14 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s22 = c;
const s23 = c;
const av24 = v; const ao25 = c;
if (c + 32 > b.length) return null; c += 32;
void s23;
const s26 = c;
const av27 = v; const ao28 = c;
if (c + 32 > b.length) return null; c += 32;
void s26;
const n29 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av12.getUint8(ao13 + 31))))))))); if (n29 === null || n29 < 0n) return null;
if (BigInt(c) + n29 * 32n > BigInt(b.length)) return null; c += Number(n29 * 32n);
void s22;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t14 === null || c + t14 > b.length) return null; c += t14;
void s8;
void s4;
return c; })(b.subarray(c)); break;
  case 1n: t3 = 6; break;
  case 2n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s30 = c;
if (c + 2 > b.length) return null; const x31 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x32 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s33 = c;
const av34 = v; const ao35 = c;
if (c + 32 > b.length) return null; c += 32;
void s33;
if (c + 32 > b.length) return null; c += 32;
const s36 = c;
const s37 = c;
if (c + 8 > b.length) return null; const x38 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s39 = c;
const av40 = v; const ao41 = c;
if (c + 32 > b.length) return null; c += 32;
void s39;
void s37;
let t42: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x38, 62n), 3n)) as bigint | null) {
  case 0n: t42 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s43 = c;
const n44 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 31))))))))); if (n44 === null || n44 < 0n) return null;
if (BigInt(c) + n44 * 32n > BigInt(b.length)) return null; c += Number(n44 * 32n);
void s43;
return c; })(b.subarray(c)); break;
  case 1n: t42 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s45 = c;
const s46 = c;
const av47 = v; const ao48 = c;
if (c + 32 > b.length) return null; c += 32;
void s46;
const n49 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 31))))))))); if (n49 === null || n49 < 0n) return null;
if (BigInt(c) + n49 * 32n > BigInt(b.length)) return null; c += Number(n49 * 32n);
void s45;
return c; })(b.subarray(c)); break;
  case 2n: t42 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s50 = c;
const s51 = c;
const av52 = v; const ao53 = c;
if (c + 32 > b.length) return null; c += 32;
void s51;
const s54 = c;
const av55 = v; const ao56 = c;
if (c + 32 > b.length) return null; c += 32;
void s54;
const n57 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av40.getUint8(ao41 + 31))))))))); if (n57 === null || n57 < 0n) return null;
if (BigInt(c) + n57 * 32n > BigInt(b.length)) return null; c += Number(n57 * 32n);
void s50;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t42 === null || c + t42 > b.length) return null; c += t42;
void s36;
void s30;
return c; })(b.subarray(c)); break;
  case 3n: t3 = 68; break;
  case 4n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s58 = c;
if (c + 2 > b.length) return null; const x59 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x60 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x61 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x62 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 4 > b.length) return null; const x63 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x64 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 32 > b.length) return null; c += 32;
if (c + 2 > b.length) return null; const x65 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s66 = c;
const s67 = c;
if (c + 8 > b.length) return null; const x68 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s69 = c;
const av70 = v; const ao71 = c;
if (c + 32 > b.length) return null; c += 32;
void s69;
void s67;
let t72: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x68, 62n), 3n)) as bigint | null) {
  case 0n: t72 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s73 = c;
const n74 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 31))))))))); if (n74 === null || n74 < 0n) return null;
if (BigInt(c) + n74 * 32n > BigInt(b.length)) return null; c += Number(n74 * 32n);
void s73;
return c; })(b.subarray(c)); break;
  case 1n: t72 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s75 = c;
const s76 = c;
const av77 = v; const ao78 = c;
if (c + 32 > b.length) return null; c += 32;
void s76;
const n79 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 31))))))))); if (n79 === null || n79 < 0n) return null;
if (BigInt(c) + n79 * 32n > BigInt(b.length)) return null; c += Number(n79 * 32n);
void s75;
return c; })(b.subarray(c)); break;
  case 2n: t72 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s80 = c;
const s81 = c;
const av82 = v; const ao83 = c;
if (c + 32 > b.length) return null; c += 32;
void s81;
const s84 = c;
const av85 = v; const ao86 = c;
if (c + 32 > b.length) return null; c += 32;
void s84;
const n87 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av70.getUint8(ao71 + 31))))))))); if (n87 === null || n87 < 0n) return null;
if (BigInt(c) + n87 * 32n > BigInt(b.length)) return null; c += Number(n87 * 32n);
void s80;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t72 === null || c + t72 > b.length) return null; c += t72;
void s66;
void s58;
return c; })(b.subarray(c)); break;
  case 5n: t3 = 50; break;
  case 6n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s88 = c;
if (c + 2 > b.length) return null; const x89 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x90 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x91 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 4 > b.length) return null; const x92 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x93 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 32 > b.length) return null; c += 32;
if (c + 2 > b.length) return null; const x94 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s95 = c;
const s96 = c;
if (c + 8 > b.length) return null; const x97 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s98 = c;
const av99 = v; const ao100 = c;
if (c + 32 > b.length) return null; c += 32;
void s98;
void s96;
let t101: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x97, 62n), 3n)) as bigint | null) {
  case 0n: t101 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s102 = c;
const n103 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 31))))))))); if (n103 === null || n103 < 0n) return null;
if (BigInt(c) + n103 * 32n > BigInt(b.length)) return null; c += Number(n103 * 32n);
void s102;
return c; })(b.subarray(c)); break;
  case 1n: t101 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s104 = c;
const s105 = c;
const av106 = v; const ao107 = c;
if (c + 32 > b.length) return null; c += 32;
void s105;
const n108 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 31))))))))); if (n108 === null || n108 < 0n) return null;
if (BigInt(c) + n108 * 32n > BigInt(b.length)) return null; c += Number(n108 * 32n);
void s104;
return c; })(b.subarray(c)); break;
  case 2n: t101 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s109 = c;
const s110 = c;
const av111 = v; const ao112 = c;
if (c + 32 > b.length) return null; c += 32;
void s110;
const s113 = c;
const av114 = v; const ao115 = c;
if (c + 32 > b.length) return null; c += 32;
void s113;
const n116 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av99.getUint8(ao100 + 31))))))))); if (n116 === null || n116 < 0n) return null;
if (BigInt(c) + n116 * 32n > BigInt(b.length)) return null; c += Number(n116 * 32n);
void s109;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t101 === null || c + t101 > b.length) return null; c += t101;
void s95;
void s88;
return c; })(b.subarray(c)); break;
  case 7n: t3 = 48; break;
  case 8n: t3 = 50; break;
  case 9n: t3 = 48; break;
  case 10n: t3 = 8; break;
  case 11n: t3 = 6; break;
  case 12n: t3 = 8; break;
  case 13n: t3 = 6; break;
  case 14n: t3 = 278; break;
  case 15n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s117 = c;
const s118 = c;
const s119 = c;
if (c + 2 > b.length) return null; const x120 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s121 = c;
const av122 = v; const ao123 = c;
if (c + 32 > b.length) return null; c += 32;
void s121;
void s119;
const s124 = c;
if (c + 2 > b.length) return null; const x125 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s126 = c;
const av127 = v; const ao128 = c;
if (c + 32 > b.length) return null; c += 32;
void s126;
void s124;
const s129 = c;
if (c + 2 > b.length) return null; const x130 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s131 = c;
const av132 = v; const ao133 = c;
if (c + 32 > b.length) return null; c += 32;
void s131;
void s129;
const s134 = c;
if (c + 2 > b.length) return null; const x135 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s136 = c;
const av137 = v; const ao138 = c;
if (c + 32 > b.length) return null; c += 32;
void s136;
void s134;
const s139 = c;
if (c + 2 > b.length) return null; const x140 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s141 = c;
const av142 = v; const ao143 = c;
if (c + 32 > b.length) return null; c += 32;
void s141;
void s139;
const s144 = c;
if (c + 2 > b.length) return null; const x145 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s146 = c;
const av147 = v; const ao148 = c;
if (c + 32 > b.length) return null; c += 32;
void s146;
void s144;
const s149 = c;
if (c + 2 > b.length) return null; const x150 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s151 = c;
const av152 = v; const ao153 = c;
if (c + 32 > b.length) return null; c += 32;
void s151;
void s149;
if (c + 4 > b.length) return null; const x154 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x155 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 32 > b.length) return null; c += 32;
void s118;
const s156 = c;
const s157 = c;
if (c + 8 > b.length) return null; const x158 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s159 = c;
const av160 = v; const ao161 = c;
if (c + 32 > b.length) return null; c += 32;
void s159;
void s157;
let t162: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x158, 62n), 3n)) as bigint | null) {
  case 0n: t162 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s163 = c;
const n164 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 31))))))))); if (n164 === null || n164 < 0n) return null;
if (BigInt(c) + n164 * 32n > BigInt(b.length)) return null; c += Number(n164 * 32n);
void s163;
return c; })(b.subarray(c)); break;
  case 1n: t162 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s165 = c;
const s166 = c;
const av167 = v; const ao168 = c;
if (c + 32 > b.length) return null; c += 32;
void s166;
const n169 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 31))))))))); if (n169 === null || n169 < 0n) return null;
if (BigInt(c) + n169 * 32n > BigInt(b.length)) return null; c += Number(n169 * 32n);
void s165;
return c; })(b.subarray(c)); break;
  case 2n: t162 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s170 = c;
const s171 = c;
const av172 = v; const ao173 = c;
if (c + 32 > b.length) return null; c += 32;
void s171;
const s174 = c;
const av175 = v; const ao176 = c;
if (c + 32 > b.length) return null; c += 32;
void s174;
const n177 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av160.getUint8(ao161 + 31))))))))); if (n177 === null || n177 < 0n) return null;
if (BigInt(c) + n177 * 32n > BigInt(b.length)) return null; c += Number(n177 * 32n);
void s170;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t162 === null || c + t162 > b.length) return null; c += t162;
void s156;
void s117;
return c; })(b.subarray(c)); break;
  case 16n: t3 = 278; break;
  case 17n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s178 = c;
const s179 = c;
const s180 = c;
if (c + 2 > b.length) return null; const x181 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s182 = c;
const av183 = v; const ao184 = c;
if (c + 32 > b.length) return null; c += 32;
void s182;
void s180;
const s185 = c;
if (c + 2 > b.length) return null; const x186 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s187 = c;
const av188 = v; const ao189 = c;
if (c + 32 > b.length) return null; c += 32;
void s187;
void s185;
const s190 = c;
if (c + 2 > b.length) return null; const x191 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s192 = c;
const av193 = v; const ao194 = c;
if (c + 32 > b.length) return null; c += 32;
void s192;
void s190;
const s195 = c;
if (c + 2 > b.length) return null; const x196 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s197 = c;
const av198 = v; const ao199 = c;
if (c + 32 > b.length) return null; c += 32;
void s197;
void s195;
const s200 = c;
if (c + 2 > b.length) return null; const x201 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s202 = c;
const av203 = v; const ao204 = c;
if (c + 32 > b.length) return null; c += 32;
void s202;
void s200;
const s205 = c;
if (c + 2 > b.length) return null; const x206 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s207 = c;
const av208 = v; const ao209 = c;
if (c + 32 > b.length) return null; c += 32;
void s207;
void s205;
const s210 = c;
if (c + 2 > b.length) return null; const x211 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
const s212 = c;
const av213 = v; const ao214 = c;
if (c + 32 > b.length) return null; c += 32;
void s212;
void s210;
if (c + 4 > b.length) return null; const x215 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 4 > b.length) return null; const x216 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
if (c + 32 > b.length) return null; c += 32;
void s179;
const s217 = c;
const s218 = c;
if (c + 8 > b.length) return null; const x219 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s220 = c;
const av221 = v; const ao222 = c;
if (c + 32 > b.length) return null; c += 32;
void s220;
void s218;
let t223: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x219, 62n), 3n)) as bigint | null) {
  case 0n: t223 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s224 = c;
const n225 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 31))))))))); if (n225 === null || n225 < 0n) return null;
if (BigInt(c) + n225 * 32n > BigInt(b.length)) return null; c += Number(n225 * 32n);
void s224;
return c; })(b.subarray(c)); break;
  case 1n: t223 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s226 = c;
const s227 = c;
const av228 = v; const ao229 = c;
if (c + 32 > b.length) return null; c += 32;
void s227;
const n230 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 31))))))))); if (n230 === null || n230 < 0n) return null;
if (BigInt(c) + n230 * 32n > BigInt(b.length)) return null; c += Number(n230 * 32n);
void s226;
return c; })(b.subarray(c)); break;
  case 2n: t223 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s231 = c;
const s232 = c;
const av233 = v; const ao234 = c;
if (c + 32 > b.length) return null; c += 32;
void s232;
const s235 = c;
const av236 = v; const ao237 = c;
if (c + 32 > b.length) return null; c += 32;
void s235;
const n238 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av221.getUint8(ao222 + 31))))))))); if (n238 === null || n238 < 0n) return null;
if (BigInt(c) + n238 * 32n > BigInt(b.length)) return null; c += Number(n238 * 32n);
void s231;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t223 === null || c + t223 > b.length) return null; c += t223;
void s217;
void s178;
return c; })(b.subarray(c)); break;
  case 18n: t3 = 278; break;
  case 19n: t3 = 278; break;
  case 20n: t3 = 278; break;
  case 21n: t3 = 278; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: AbiManagerInstruction.Params }): AbiManagerInstruction | null {
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
    const state = new AbiManagerInstruction(buffer, cached);
    return state;
  }


}

export namespace AbiManagerInstruction {
  export type Params = {
    /** ABI path: payload.discriminant */
    readonly payload_discriminant: bigint;
    /** ABI path: payload.payload_size */
    readonly payload_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    payload_discriminant: "payload.discriminant",
    payload_payload_size: "payload.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { payload_discriminant: number | bigint, payload_payload_size: number | bigint }): Params {
      return {
        payload_discriminant: __tnToBigInt(input.payload_discriminant),
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

  export function params(input: { payload_discriminant: number | bigint, payload_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class AbiManagerInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_discriminant: number | null = null;
  private __tnPayload_payload: { descriptor: typeof AbiManagerInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: AbiManagerInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: AbiManagerInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<AbiManagerInstructionBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(1);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_discriminant(value: number): void {
    this.__tnField_discriminant = value;
    this.__tnInvalidate();
  }

  set_discriminant(value: number): this {
    this.__tnAssign_discriminant(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<AbiManagerInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, AbiManagerInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_discriminant(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("AbiManagerInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AbiManagerInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = AbiManagerInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("AbiManagerInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AbiManagerInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = AbiManagerInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("AbiManagerInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): AbiManagerInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = AbiManagerInstruction.from_array(buffer, { params });
    if (!view) throw new Error("AbiManagerInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): AbiManagerInstruction {
    return this.finish();
  }

  dynamicParams(): AbiManagerInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): AbiManagerInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = AbiManagerInstruction.Params.fromValues({
      payload_discriminant: (() => { if (this.__tnField_discriminant === null) throw new Error("AbiManagerInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_discriminant); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("AbiManagerInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_discriminant === null) throw new Error("AbiManagerInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AbiManagerInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_discriminant);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: AbiManagerInstruction.Params): void {
    const result = AbiManagerInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ AbiManagerInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("AbiManagerInstruction", (params) => AbiManagerInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiManagerInstruction", (buffer, params) => AbiManagerInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiManagerInstruction", (buffer) => { const result = AbiManagerInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiMetaAccount ----- */

const __tn_ir_AbiMetaAccount = {
  typeName: "AbiMetaAccount",
  root: { op: "const", value: 99n }
} as const;

export class AbiMetaAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AbiMetaAccount {
    if (!buffer || buffer.length === undefined) throw new Error("AbiMetaAccount.__tnCreateView requires a Uint8Array");
    return new AbiMetaAccount(new Uint8Array(buffer));
  }

  static builder(): AbiMetaAccountBuilder {
    return new AbiMetaAccountBuilder();
  }

  static fromBuilder(builder: AbiMetaAccountBuilder): AbiMetaAccount | null {
    const buffer = builder.build();
    return AbiMetaAccount.from_array(buffer);
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

  get_flags(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_flags(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get flags(): number {
    return this.get_flags();
  }

  set flags(value: number) {
    this.set_flags(value);
  }

  get_body(): AbiMetaBody {
    const offset = 3;
    const slice = this.buffer.subarray(offset, offset + 96);
    return AbiMetaBody.from_array(slice)!;
  }

  set_body(value: AbiMetaBody): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 3;
    this.buffer.set(sourceBytes, offset);
  }

  get body(): AbiMetaBody {
    return this.get_body();
  }

  set body(value: AbiMetaBody) {
    this.set_body(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiMetaAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiMetaAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiMetaAccount');
    }
    return __tnBigIntToNumber(irResult, 'AbiMetaAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 99) return { ok: false, code: "tn.buffer_too_small", consumed: 99 };
    return { ok: true, consumed: 99 };
  }

  static from_array(buffer: Uint8Array): AbiMetaAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AbiMetaAccount(buffer);
  }

}

export class AbiMetaAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(99);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_kind(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_flags(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_body(value: Uint8Array): this {
    if (value.length !== 96) throw new Error("body expects 96 bytes");
    this.buffer.set(value, 3);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("AbiMetaAccount", AbiMetaAccount.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("AbiMetaAccount", AbiMetaAccount.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): AbiMetaAccount {
    const view = AbiMetaAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AbiMetaAccount");
    return view;
  }
}

__tnRegisterFootprint("AbiMetaAccount", (params) => AbiMetaAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiMetaAccount", (buffer, params) => AbiMetaAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiMetaAccount", (buffer) => { const result = AbiMetaAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AbiManagerProgramAccount ----- */

const __tn_ir_AbiManagerProgramAccount = {
  typeName: "AbiManagerProgramAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class AbiManagerProgramAccount_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): AbiManagerProgramAccount_payload_Inner {
    return new AbiManagerProgramAccount_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AbiManagerProgramAccount_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["account_type"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "meta_v1", tag: 1, payloadSize: 99 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "content_v1", tag: 2, payloadSize: null };
    }
    return new AbiManagerProgramAccount_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asMetaV1(): AbiMetaAccount | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return AbiMetaAccount.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asContentV1(): AbiAccount | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return AbiAccount.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class AbiManagerProgramAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: AbiManagerProgramAccount.Params;

  private constructor(private buffer: Uint8Array, params?: AbiManagerProgramAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = AbiManagerProgramAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("AbiManagerProgramAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: AbiManagerProgramAccount.Params, fieldContext?: Record<string, number | bigint> }): AbiManagerProgramAccount {
    if (!buffer || buffer.length === undefined) throw new Error("AbiManagerProgramAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = AbiManagerProgramAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("AbiManagerProgramAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new AbiManagerProgramAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): AbiManagerProgramAccount.Params {
    return this.__tnParams;
  }

  static builder(): AbiManagerProgramAccountBuilder {
    return new AbiManagerProgramAccountBuilder();
  }

  static fromBuilder(builder: AbiManagerProgramAccountBuilder): AbiManagerProgramAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return AbiManagerProgramAccount.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "meta_v1",
      tag: 1,
      payloadSize: 99,
      payloadType: "AbiManagerProgramAccount::payload::meta_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AbiMetaAccount),
    },
    {
      name: "content_v1",
      tag: 2,
      payloadSize: null,
      payloadType: "AbiManagerProgramAccount::payload::content_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AbiAccount),
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: AbiManagerProgramAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_account_type = __tnToBigInt(view.getUint8(0));
    const __tnLayout = AbiManagerProgramAccount.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = AbiManagerProgramAccount.Params.fromValues({
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

  payloadVariant(): typeof AbiManagerProgramAccount.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_account_type();
    return AbiManagerProgramAccount.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): AbiManagerProgramAccount_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("AbiManagerProgramAccount: unknown payload variant");
    const offset = AbiManagerProgramAccount.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("AbiManagerProgramAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return AbiManagerProgramAccount_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AbiManagerProgramAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AbiManagerProgramAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_account_type: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = AbiManagerProgramAccount.Params.fromValues({
      payload_account_type: payload_account_type,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: AbiManagerProgramAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.account_type"] = params.payload_account_type;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: AbiManagerProgramAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: AbiManagerProgramAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AbiManagerProgramAccount');
    return __tnBigIntToNumber(irResult, 'AbiManagerProgramAccount::footprintFromParams');
  }

  static footprintFromValues(input: { payload_account_type: number | bigint, payload_payload_size: number | bigint }): number {
    const params = AbiManagerProgramAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: AbiManagerProgramAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: AbiManagerProgramAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: AbiManagerProgramAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiManagerProgramAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiManagerProgramAccount::validate') : undefined;
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
  case 1n: t3 = 99; break;
  case 2n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s4 = c;
const s5 = c;
const av6 = v; const ao7 = c;
if (c + 32 > b.length) return null; c += 32;
void s5;
if (c + 8 > b.length) return null; const x8 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
if (c + 1 > b.length) return null; const x9 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
if (c + 4 > b.length) return null; const x10 = __tnU64(__tnToBigInt(v.getUint32(c, true))); c += 4;
const n11 = x10; if (n11 === null || n11 < 0n) return null;
if (BigInt(c) + n11 * 1n > BigInt(b.length)) return null; c += Number(n11 * 1n);
void s4;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: AbiManagerProgramAccount.Params }): AbiManagerProgramAccount | null {
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
    const state = new AbiManagerProgramAccount(buffer, cached);
    return state;
  }


}

export namespace AbiManagerProgramAccount {
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

export class AbiManagerProgramAccountBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_account_type: number | null = null;
  private __tnPayload_payload: { descriptor: typeof AbiManagerProgramAccount.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: AbiManagerProgramAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: AbiManagerProgramAccount.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<AbiManagerProgramAccountBuilder>;

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

  payload(): __TnVariantSelectorResult<AbiManagerProgramAccountBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, AbiManagerProgramAccount.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_account_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("AbiManagerProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AbiManagerProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = AbiManagerProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("AbiManagerProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AbiManagerProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = AbiManagerProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("AbiManagerProgramAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): AbiManagerProgramAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = AbiManagerProgramAccount.from_array(buffer, { params });
    if (!view) throw new Error("AbiManagerProgramAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): AbiManagerProgramAccount {
    return this.finish();
  }

  dynamicParams(): AbiManagerProgramAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): AbiManagerProgramAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = AbiManagerProgramAccount.Params.fromValues({
      payload_account_type: (() => { if (this.__tnField_account_type === null) throw new Error("AbiManagerProgramAccountBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_account_type); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("AbiManagerProgramAccountBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_account_type === null) throw new Error("AbiManagerProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AbiManagerProgramAccountBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_account_type);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: AbiManagerProgramAccount.Params): void {
    const result = AbiManagerProgramAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ AbiManagerProgramAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("AbiManagerProgramAccount", (params) => AbiManagerProgramAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiManagerProgramAccount", (buffer, params) => AbiManagerProgramAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiManagerProgramAccount", (buffer) => { const result = AbiManagerProgramAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
