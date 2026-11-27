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

/* ----- TYPE DEFINITION FOR BurnInstruction ----- */

const __tn_ir_BurnInstruction = {
  typeName: "BurnInstruction",
  root: { op: "const", value: 14n }
} as const;

export class BurnInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): BurnInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("BurnInstruction.__tnCreateView requires a Uint8Array");
    return new BurnInstruction(new Uint8Array(buffer));
  }

  static builder(): BurnInstructionBuilder {
    return new BurnInstructionBuilder();
  }

  static fromBuilder(builder: BurnInstructionBuilder): BurnInstruction | null {
    const buffer = builder.build();
    return BurnInstruction.from_array(buffer);
  }

  get_token_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_account_index(): number {
    return this.get_token_account_index();
  }

  set token_account_index(value: number) {
    this.set_token_account_index(value);
  }

  get_mint_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_account_index(): number {
    return this.get_mint_account_index();
  }

  set mint_account_index(value: number) {
    this.set_mint_account_index(value);
  }

  get_authority_account_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_index(): number {
    return this.get_authority_account_index();
  }

  set authority_account_index(value: number) {
    this.set_authority_account_index(value);
  }

  get_amount(): bigint {
    const offset = 6;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 6;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_BurnInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_BurnInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for BurnInstruction');
    }
    return __tnBigIntToNumber(irResult, 'BurnInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 14) return { ok: false, code: "tn.buffer_too_small", consumed: 14 };
    return { ok: true, consumed: 14 };
  }

  static new(token_account_index: number, mint_account_index: number, authority_account_index: number, amount: bigint): BurnInstruction {
    const buffer = new Uint8Array(14);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, token_account_index, true); /* token_account_index (little-endian) */
    view.setUint16(2, mint_account_index, true); /* mint_account_index (little-endian) */
    view.setUint16(4, authority_account_index, true); /* authority_account_index (little-endian) */
    view.setBigUint64(6, amount, true); /* amount (little-endian) */

    return new BurnInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): BurnInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new BurnInstruction(buffer);
  }

}

export class BurnInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(14);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_token_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_mint_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_index(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("BurnInstruction", BurnInstruction.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("BurnInstruction", BurnInstruction.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): BurnInstruction {
    const view = BurnInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BurnInstruction");
    return view;
  }
}

__tnRegisterFootprint("BurnInstruction", (params) => BurnInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("BurnInstruction", (buffer, params) => BurnInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("BurnInstruction", (buffer) => { const result = BurnInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CloseAccountInstruction ----- */

const __tn_ir_CloseAccountInstruction = {
  typeName: "CloseAccountInstruction",
  root: { op: "const", value: 6n }
} as const;

export class CloseAccountInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CloseAccountInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("CloseAccountInstruction.__tnCreateView requires a Uint8Array");
    return new CloseAccountInstruction(new Uint8Array(buffer));
  }

  static builder(): CloseAccountInstructionBuilder {
    return new CloseAccountInstructionBuilder();
  }

  static fromBuilder(builder: CloseAccountInstructionBuilder): CloseAccountInstruction | null {
    const buffer = builder.build();
    return CloseAccountInstruction.from_array(buffer);
  }

  get_token_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_account_index(): number {
    return this.get_token_account_index();
  }

  set token_account_index(value: number) {
    this.set_token_account_index(value);
  }

  get_dest_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_dest_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get dest_account_index(): number {
    return this.get_dest_account_index();
  }

  set dest_account_index(value: number) {
    this.set_dest_account_index(value);
  }

  get_authority_account_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_index(): number {
    return this.get_authority_account_index();
  }

  set authority_account_index(value: number) {
    this.set_authority_account_index(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CloseAccountInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CloseAccountInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CloseAccountInstruction');
    }
    return __tnBigIntToNumber(irResult, 'CloseAccountInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(token_account_index: number, dest_account_index: number, authority_account_index: number): CloseAccountInstruction {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, token_account_index, true); /* token_account_index (little-endian) */
    view.setUint16(2, dest_account_index, true); /* dest_account_index (little-endian) */
    view.setUint16(4, authority_account_index, true); /* authority_account_index (little-endian) */

    return new CloseAccountInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): CloseAccountInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CloseAccountInstruction(buffer);
  }

}

export class CloseAccountInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_token_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_dest_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_index(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CloseAccountInstruction", CloseAccountInstruction.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CloseAccountInstruction", CloseAccountInstruction.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CloseAccountInstruction {
    const view = CloseAccountInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CloseAccountInstruction");
    return view;
  }
}

__tnRegisterFootprint("CloseAccountInstruction", (params) => CloseAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("CloseAccountInstruction", (buffer, params) => CloseAccountInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CloseAccountInstruction", (buffer) => { const result = CloseAccountInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FreezeAccountInstruction ----- */

const __tn_ir_FreezeAccountInstruction = {
  typeName: "FreezeAccountInstruction",
  root: { op: "const", value: 6n }
} as const;

export class FreezeAccountInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FreezeAccountInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("FreezeAccountInstruction.__tnCreateView requires a Uint8Array");
    return new FreezeAccountInstruction(new Uint8Array(buffer));
  }

  static builder(): FreezeAccountInstructionBuilder {
    return new FreezeAccountInstructionBuilder();
  }

  static fromBuilder(builder: FreezeAccountInstructionBuilder): FreezeAccountInstruction | null {
    const buffer = builder.build();
    return FreezeAccountInstruction.from_array(buffer);
  }

  get_token_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_account_index(): number {
    return this.get_token_account_index();
  }

  set token_account_index(value: number) {
    this.set_token_account_index(value);
  }

  get_mint_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_account_index(): number {
    return this.get_mint_account_index();
  }

  set mint_account_index(value: number) {
    this.set_mint_account_index(value);
  }

  get_authority_account_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_index(): number {
    return this.get_authority_account_index();
  }

  set authority_account_index(value: number) {
    this.set_authority_account_index(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FreezeAccountInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FreezeAccountInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FreezeAccountInstruction');
    }
    return __tnBigIntToNumber(irResult, 'FreezeAccountInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(token_account_index: number, mint_account_index: number, authority_account_index: number): FreezeAccountInstruction {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, token_account_index, true); /* token_account_index (little-endian) */
    view.setUint16(2, mint_account_index, true); /* mint_account_index (little-endian) */
    view.setUint16(4, authority_account_index, true); /* authority_account_index (little-endian) */

    return new FreezeAccountInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): FreezeAccountInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FreezeAccountInstruction(buffer);
  }

}

export class FreezeAccountInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_token_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_mint_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_index(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("FreezeAccountInstruction", FreezeAccountInstruction.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("FreezeAccountInstruction", FreezeAccountInstruction.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FreezeAccountInstruction {
    const view = FreezeAccountInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FreezeAccountInstruction");
    return view;
  }
}

__tnRegisterFootprint("FreezeAccountInstruction", (params) => FreezeAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("FreezeAccountInstruction", (buffer, params) => FreezeAccountInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FreezeAccountInstruction", (buffer) => { const result = FreezeAccountInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MintToInstruction ----- */

const __tn_ir_MintToInstruction = {
  typeName: "MintToInstruction",
  root: { op: "const", value: 14n }
} as const;

export class MintToInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MintToInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MintToInstruction.__tnCreateView requires a Uint8Array");
    return new MintToInstruction(new Uint8Array(buffer));
  }

  static builder(): MintToInstructionBuilder {
    return new MintToInstructionBuilder();
  }

  static fromBuilder(builder: MintToInstructionBuilder): MintToInstruction | null {
    const buffer = builder.build();
    return MintToInstruction.from_array(buffer);
  }

  get_mint_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_account_index(): number {
    return this.get_mint_account_index();
  }

  set mint_account_index(value: number) {
    this.set_mint_account_index(value);
  }

  get_dest_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_dest_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get dest_account_index(): number {
    return this.get_dest_account_index();
  }

  set dest_account_index(value: number) {
    this.set_dest_account_index(value);
  }

  get_authority_account_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_index(): number {
    return this.get_authority_account_index();
  }

  set authority_account_index(value: number) {
    this.set_authority_account_index(value);
  }

  get_amount(): bigint {
    const offset = 6;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 6;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MintToInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MintToInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MintToInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MintToInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 14) return { ok: false, code: "tn.buffer_too_small", consumed: 14 };
    return { ok: true, consumed: 14 };
  }

  static new(mint_account_index: number, dest_account_index: number, authority_account_index: number, amount: bigint): MintToInstruction {
    const buffer = new Uint8Array(14);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, mint_account_index, true); /* mint_account_index (little-endian) */
    view.setUint16(2, dest_account_index, true); /* dest_account_index (little-endian) */
    view.setUint16(4, authority_account_index, true); /* authority_account_index (little-endian) */
    view.setBigUint64(6, amount, true); /* amount (little-endian) */

    return new MintToInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MintToInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MintToInstruction(buffer);
  }

}

export class MintToInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(14);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_mint_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_dest_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_index(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("MintToInstruction", MintToInstruction.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("MintToInstruction", MintToInstruction.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): MintToInstruction {
    const view = MintToInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MintToInstruction");
    return view;
  }
}

__tnRegisterFootprint("MintToInstruction", (params) => MintToInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MintToInstruction", (buffer, params) => MintToInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MintToInstruction", (buffer) => { const result = MintToInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

/* ----- TYPE DEFINITION FOR ThawAccountEventData ----- */

const __tn_ir_ThawAccountEventData = {
  typeName: "ThawAccountEventData",
  root: { op: "const", value: 96n }
} as const;

export class ThawAccountEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ThawAccountEventData {
    if (!buffer || buffer.length === undefined) throw new Error("ThawAccountEventData.__tnCreateView requires a Uint8Array");
    return new ThawAccountEventData(new Uint8Array(buffer));
  }

  static builder(): ThawAccountEventDataBuilder {
    return new ThawAccountEventDataBuilder();
  }

  static fromBuilder(builder: ThawAccountEventDataBuilder): ThawAccountEventData | null {
    const buffer = builder.build();
    return ThawAccountEventData.from_array(buffer);
  }

  get_account(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_account(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get account(): Pubkey {
    return this.get_account();
  }

  set account(value: Pubkey) {
    this.set_account(value);
  }

  get_mint(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get mint(): Pubkey {
    return this.get_mint();
  }

  set mint(value: Pubkey) {
    this.set_mint(value);
  }

  get_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Pubkey {
    return this.get_authority();
  }

  set authority(value: Pubkey) {
    this.set_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ThawAccountEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ThawAccountEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ThawAccountEventData');
    }
    return __tnBigIntToNumber(irResult, 'ThawAccountEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): ThawAccountEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ThawAccountEventData(buffer);
  }

}

export class ThawAccountEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(96);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_account(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("account expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("ThawAccountEventData", ThawAccountEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("ThawAccountEventData", ThawAccountEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ThawAccountEventData {
    const view = ThawAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ThawAccountEventData");
    return view;
  }
}

__tnRegisterFootprint("ThawAccountEventData", (params) => ThawAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("ThawAccountEventData", (buffer, params) => ThawAccountEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ThawAccountEventData", (buffer) => { const result = ThawAccountEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ThawAccountInstruction ----- */

const __tn_ir_ThawAccountInstruction = {
  typeName: "ThawAccountInstruction",
  root: { op: "const", value: 6n }
} as const;

export class ThawAccountInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ThawAccountInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ThawAccountInstruction.__tnCreateView requires a Uint8Array");
    return new ThawAccountInstruction(new Uint8Array(buffer));
  }

  static builder(): ThawAccountInstructionBuilder {
    return new ThawAccountInstructionBuilder();
  }

  static fromBuilder(builder: ThawAccountInstructionBuilder): ThawAccountInstruction | null {
    const buffer = builder.build();
    return ThawAccountInstruction.from_array(buffer);
  }

  get_token_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_account_index(): number {
    return this.get_token_account_index();
  }

  set token_account_index(value: number) {
    this.set_token_account_index(value);
  }

  get_mint_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_account_index(): number {
    return this.get_mint_account_index();
  }

  set mint_account_index(value: number) {
    this.set_mint_account_index(value);
  }

  get_authority_account_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_index(): number {
    return this.get_authority_account_index();
  }

  set authority_account_index(value: number) {
    this.set_authority_account_index(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ThawAccountInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ThawAccountInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ThawAccountInstruction');
    }
    return __tnBigIntToNumber(irResult, 'ThawAccountInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(token_account_index: number, mint_account_index: number, authority_account_index: number): ThawAccountInstruction {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, token_account_index, true); /* token_account_index (little-endian) */
    view.setUint16(2, mint_account_index, true); /* mint_account_index (little-endian) */
    view.setUint16(4, authority_account_index, true); /* authority_account_index (little-endian) */

    return new ThawAccountInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): ThawAccountInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ThawAccountInstruction(buffer);
  }

}

export class ThawAccountInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_token_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_mint_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_index(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("ThawAccountInstruction", ThawAccountInstruction.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("ThawAccountInstruction", ThawAccountInstruction.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ThawAccountInstruction {
    const view = ThawAccountInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ThawAccountInstruction");
    return view;
  }
}

__tnRegisterFootprint("ThawAccountInstruction", (params) => ThawAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ThawAccountInstruction", (buffer, params) => ThawAccountInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ThawAccountInstruction", (buffer) => { const result = ThawAccountInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TickerField ----- */

const __tn_ir_TickerField = {
  typeName: "TickerField",
  root: { op: "const", value: 9n }
} as const;

export class TickerField {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TickerField {
    if (!buffer || buffer.length === undefined) throw new Error("TickerField.__tnCreateView requires a Uint8Array");
    return new TickerField(new Uint8Array(buffer));
  }

  static builder(): TickerFieldBuilder {
    return new TickerFieldBuilder();
  }

  static fromBuilder(builder: TickerFieldBuilder): TickerField | null {
    const buffer = builder.build();
    return TickerField.from_array(buffer);
  }

  get_length(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_length(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get length(): number {
    return this.get_length();
  }

  set length(value: number) {
    this.set_length(value);
  }

  get_bytes(): number[] {
    const offset = 1;
    const result: number[] = [];
    for (let i = 0; i < 8; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_bytes(value: number[]): void {
    const offset = 1;
    if (value.length !== 8) {
      throw new Error('Array length must be 8');
    }
    for (let i = 0; i < 8; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get bytes(): number[] {
    return this.get_bytes();
  }

  set bytes(value: number[]) {
    this.set_bytes(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TickerField.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TickerField, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TickerField');
    }
    return __tnBigIntToNumber(irResult, 'TickerField::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 9) return { ok: false, code: "tn.buffer_too_small", consumed: 9 };
    return { ok: true, consumed: 9 };
  }

  static from_array(buffer: Uint8Array): TickerField | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TickerField(buffer);
  }

}

export class TickerFieldBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(9);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_length(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_bytes(values: number[]): this {
    if (values.length !== 8) throw new Error("bytes expects 8 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 1 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("TickerField", TickerField.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("TickerField", TickerField.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TickerField {
    const view = TickerField.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TickerField");
    return view;
  }
}

__tnRegisterFootprint("TickerField", (params) => TickerField.__tnInvokeFootprint(params));
__tnRegisterValidate("TickerField", (buffer, params) => TickerField.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TickerField", (buffer) => { const result = TickerField.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenAccount ----- */

const __tn_ir_TokenAccount = {
  typeName: "TokenAccount",
  root: { op: "const", value: 73n }
} as const;

export class TokenAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenAccount {
    if (!buffer || buffer.length === undefined) throw new Error("TokenAccount.__tnCreateView requires a Uint8Array");
    return new TokenAccount(new Uint8Array(buffer));
  }

  static builder(): TokenAccountBuilder {
    return new TokenAccountBuilder();
  }

  static fromBuilder(builder: TokenAccountBuilder): TokenAccount | null {
    const buffer = builder.build();
    return TokenAccount.from_array(buffer);
  }

  get_mint(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get mint(): Pubkey {
    return this.get_mint();
  }

  set mint(value: Pubkey) {
    this.set_mint(value);
  }

  get_owner(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_owner(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get owner(): Pubkey {
    return this.get_owner();
  }

  set owner(value: Pubkey) {
    this.set_owner(value);
  }

  get_amount(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_is_frozen(): number {
    const offset = 72;
    return this.view.getUint8(offset);
  }

  set_is_frozen(value: number): void {
    const offset = 72;
    this.view.setUint8(offset, value);
  }

  get is_frozen(): number {
    return this.get_is_frozen();
  }

  set is_frozen(value: number) {
    this.set_is_frozen(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenAccount');
    }
    return __tnBigIntToNumber(irResult, 'TokenAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 73) return { ok: false, code: "tn.buffer_too_small", consumed: 73 };
    return { ok: true, consumed: 73 };
  }

  static from_array(buffer: Uint8Array): TokenAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TokenAccount(buffer);
  }

}

export class TokenAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(73);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_owner(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("owner expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_is_frozen(value: number): this {
    this.view.setUint8(72, value);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("TokenAccount", TokenAccount.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("TokenAccount", TokenAccount.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TokenAccount {
    const view = TokenAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TokenAccount");
    return view;
  }
}

__tnRegisterFootprint("TokenAccount", (params) => TokenAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenAccount", (buffer, params) => TokenAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenAccount", (buffer) => { const result = TokenAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenError ----- */

const __tn_ir_TokenError = {
  typeName: "TokenError",
  root: { op: "const", value: 8n }
} as const;

export class TokenError_error_invalid_instruction_data_size_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_instruction_data_size_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_instruction_data_size_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_instruction_data_size_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_invalid_instruction_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_instruction_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_instruction_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_instruction_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_insufficient_funds_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_insufficient_funds_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_insufficient_funds_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_insufficient_funds_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_owner_mismatch_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_owner_mismatch_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_owner_mismatch_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_owner_mismatch_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_authority_mismatch_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_authority_mismatch_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_authority_mismatch_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_authority_mismatch_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_missing_required_signer_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_missing_required_signer_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_missing_required_signer_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_missing_required_signer_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_account_frozen_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_account_frozen_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_account_frozen_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_account_frozen_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_account_not_owned_by_program_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_account_not_owned_by_program_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_account_not_owned_by_program_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_account_not_owned_by_program_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_invalid_mint_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_mint_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_mint_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_mint_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_non_zero_balance_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_non_zero_balance_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_non_zero_balance_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_non_zero_balance_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_invalid_account_data_size_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_account_data_size_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_account_data_size_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_account_data_size_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_overflow_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_overflow_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_overflow_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_overflow_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_mint_mismatch_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_mint_mismatch_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_mint_mismatch_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_mint_mismatch_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_incorrect_program_id_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_incorrect_program_id_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_incorrect_program_id_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_incorrect_program_id_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_invalid_txn_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_txn_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_txn_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_txn_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_invalid_proof_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_proof_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_proof_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_proof_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_invalid_account_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_account_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_account_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_account_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_mint_cannot_freeze_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_mint_cannot_freeze_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_mint_cannot_freeze_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_mint_cannot_freeze_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_syscall_failed_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_syscall_failed_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_syscall_failed_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_syscall_failed_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_decimals_mismatch_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_decimals_mismatch_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_decimals_mismatch_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_decimals_mismatch_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_ticker_mismatch_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_ticker_mismatch_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_ticker_mismatch_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_ticker_mismatch_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_invalid_ticker_Inner {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_invalid_ticker_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError_error_invalid_ticker_Inner.__tnCreateView requires a Uint8Array");
    return new TokenError_error_invalid_ticker_Inner(new Uint8Array(buffer));
  }

}

export class TokenError_error_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): TokenError_error_Inner {
    return new TokenError_error_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError_error_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["code"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "invalid_instruction_data_size", tag: 1, payloadSize: 0 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "invalid_instruction", tag: 2, payloadSize: 0 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "insufficient_funds", tag: 4, payloadSize: 0 };
      if (__tnTagEquals(tag, 5)) descriptor = { name: "owner_mismatch", tag: 5, payloadSize: 0 };
      if (__tnTagEquals(tag, 6)) descriptor = { name: "authority_mismatch", tag: 6, payloadSize: 0 };
      if (__tnTagEquals(tag, 7)) descriptor = { name: "missing_required_signer", tag: 7, payloadSize: 0 };
      if (__tnTagEquals(tag, 8)) descriptor = { name: "account_frozen", tag: 8, payloadSize: 0 };
      if (__tnTagEquals(tag, 9)) descriptor = { name: "account_not_owned_by_program", tag: 9, payloadSize: 0 };
      if (__tnTagEquals(tag, 10)) descriptor = { name: "invalid_mint", tag: 10, payloadSize: 0 };
      if (__tnTagEquals(tag, 11)) descriptor = { name: "non_zero_balance", tag: 11, payloadSize: 0 };
      if (__tnTagEquals(tag, 12)) descriptor = { name: "invalid_account_data_size", tag: 12, payloadSize: 0 };
      if (__tnTagEquals(tag, 13)) descriptor = { name: "overflow", tag: 13, payloadSize: 0 };
      if (__tnTagEquals(tag, 14)) descriptor = { name: "mint_mismatch", tag: 14, payloadSize: 0 };
      if (__tnTagEquals(tag, 15)) descriptor = { name: "incorrect_program_id", tag: 15, payloadSize: 0 };
      if (__tnTagEquals(tag, 16)) descriptor = { name: "invalid_txn", tag: 16, payloadSize: 0 };
      if (__tnTagEquals(tag, 17)) descriptor = { name: "invalid_proof", tag: 17, payloadSize: 0 };
      if (__tnTagEquals(tag, 18)) descriptor = { name: "invalid_account", tag: 18, payloadSize: 0 };
      if (__tnTagEquals(tag, 19)) descriptor = { name: "mint_cannot_freeze", tag: 19, payloadSize: 0 };
      if (__tnTagEquals(tag, 20)) descriptor = { name: "syscall_failed", tag: 20, payloadSize: 0 };
      if (__tnTagEquals(tag, 21)) descriptor = { name: "decimals_mismatch", tag: 21, payloadSize: 0 };
      if (__tnTagEquals(tag, 22)) descriptor = { name: "ticker_mismatch", tag: 22, payloadSize: 0 };
      if (__tnTagEquals(tag, 23)) descriptor = { name: "invalid_ticker", tag: 23, payloadSize: 0 };
    }
    return new TokenError_error_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInvalidInstructionDataSize(): TokenError_error_invalid_instruction_data_size_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return TokenError_error_invalid_instruction_data_size_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidInstruction(): TokenError_error_invalid_instruction_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return TokenError_error_invalid_instruction_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInsufficientFunds(): TokenError_error_insufficient_funds_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return TokenError_error_insufficient_funds_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOwnerMismatch(): TokenError_error_owner_mismatch_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 5)) return null;
    return TokenError_error_owner_mismatch_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAuthorityMismatch(): TokenError_error_authority_mismatch_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 6)) return null;
    return TokenError_error_authority_mismatch_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMissingRequiredSigner(): TokenError_error_missing_required_signer_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 7)) return null;
    return TokenError_error_missing_required_signer_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccountFrozen(): TokenError_error_account_frozen_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 8)) return null;
    return TokenError_error_account_frozen_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAccountNotOwnedByProgram(): TokenError_error_account_not_owned_by_program_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 9)) return null;
    return TokenError_error_account_not_owned_by_program_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidMint(): TokenError_error_invalid_mint_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 10)) return null;
    return TokenError_error_invalid_mint_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asNonZeroBalance(): TokenError_error_non_zero_balance_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 11)) return null;
    return TokenError_error_non_zero_balance_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidAccountDataSize(): TokenError_error_invalid_account_data_size_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 12)) return null;
    return TokenError_error_invalid_account_data_size_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOverflow(): TokenError_error_overflow_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 13)) return null;
    return TokenError_error_overflow_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMintMismatch(): TokenError_error_mint_mismatch_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 14)) return null;
    return TokenError_error_mint_mismatch_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asIncorrectProgramId(): TokenError_error_incorrect_program_id_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 15)) return null;
    return TokenError_error_incorrect_program_id_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidTxn(): TokenError_error_invalid_txn_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 16)) return null;
    return TokenError_error_invalid_txn_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidProof(): TokenError_error_invalid_proof_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 17)) return null;
    return TokenError_error_invalid_proof_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidAccount(): TokenError_error_invalid_account_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 18)) return null;
    return TokenError_error_invalid_account_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMintCannotFreeze(): TokenError_error_mint_cannot_freeze_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 19)) return null;
    return TokenError_error_mint_cannot_freeze_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSyscallFailed(): TokenError_error_syscall_failed_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 20)) return null;
    return TokenError_error_syscall_failed_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asDecimalsMismatch(): TokenError_error_decimals_mismatch_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 21)) return null;
    return TokenError_error_decimals_mismatch_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTickerMismatch(): TokenError_error_ticker_mismatch_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 22)) return null;
    return TokenError_error_ticker_mismatch_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvalidTicker(): TokenError_error_invalid_ticker_Inner | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 23)) return null;
    return TokenError_error_invalid_ticker_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class TokenError {
  private view: DataView;
  private static readonly __tnFieldOffset_error = 8;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenError {
    if (!buffer || buffer.length === undefined) throw new Error("TokenError.__tnCreateView requires a Uint8Array");
    return new TokenError(new Uint8Array(buffer));
  }

  static builder(): TokenErrorBuilder {
    return new TokenErrorBuilder();
  }

  static fromBuilder(builder: TokenErrorBuilder): TokenError | null {
    const buffer = builder.build();
    return TokenError.from_array(buffer);
  }

  static readonly errorVariantDescriptors = Object.freeze([
    {
      name: "invalid_instruction_data_size",
      tag: 1,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_instruction_data_size",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_instruction",
      tag: 2,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_instruction",
      createPayloadBuilder: () => null,
    },
    {
      name: "insufficient_funds",
      tag: 4,
      payloadSize: 0,
      payloadType: "TokenError::error::insufficient_funds",
      createPayloadBuilder: () => null,
    },
    {
      name: "owner_mismatch",
      tag: 5,
      payloadSize: 0,
      payloadType: "TokenError::error::owner_mismatch",
      createPayloadBuilder: () => null,
    },
    {
      name: "authority_mismatch",
      tag: 6,
      payloadSize: 0,
      payloadType: "TokenError::error::authority_mismatch",
      createPayloadBuilder: () => null,
    },
    {
      name: "missing_required_signer",
      tag: 7,
      payloadSize: 0,
      payloadType: "TokenError::error::missing_required_signer",
      createPayloadBuilder: () => null,
    },
    {
      name: "account_frozen",
      tag: 8,
      payloadSize: 0,
      payloadType: "TokenError::error::account_frozen",
      createPayloadBuilder: () => null,
    },
    {
      name: "account_not_owned_by_program",
      tag: 9,
      payloadSize: 0,
      payloadType: "TokenError::error::account_not_owned_by_program",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_mint",
      tag: 10,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_mint",
      createPayloadBuilder: () => null,
    },
    {
      name: "non_zero_balance",
      tag: 11,
      payloadSize: 0,
      payloadType: "TokenError::error::non_zero_balance",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_account_data_size",
      tag: 12,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_account_data_size",
      createPayloadBuilder: () => null,
    },
    {
      name: "overflow",
      tag: 13,
      payloadSize: 0,
      payloadType: "TokenError::error::overflow",
      createPayloadBuilder: () => null,
    },
    {
      name: "mint_mismatch",
      tag: 14,
      payloadSize: 0,
      payloadType: "TokenError::error::mint_mismatch",
      createPayloadBuilder: () => null,
    },
    {
      name: "incorrect_program_id",
      tag: 15,
      payloadSize: 0,
      payloadType: "TokenError::error::incorrect_program_id",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_txn",
      tag: 16,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_txn",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_proof",
      tag: 17,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_proof",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_account",
      tag: 18,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_account",
      createPayloadBuilder: () => null,
    },
    {
      name: "mint_cannot_freeze",
      tag: 19,
      payloadSize: 0,
      payloadType: "TokenError::error::mint_cannot_freeze",
      createPayloadBuilder: () => null,
    },
    {
      name: "syscall_failed",
      tag: 20,
      payloadSize: 0,
      payloadType: "TokenError::error::syscall_failed",
      createPayloadBuilder: () => null,
    },
    {
      name: "decimals_mismatch",
      tag: 21,
      payloadSize: 0,
      payloadType: "TokenError::error::decimals_mismatch",
      createPayloadBuilder: () => null,
    },
    {
      name: "ticker_mismatch",
      tag: 22,
      payloadSize: 0,
      payloadType: "TokenError::error::ticker_mismatch",
      createPayloadBuilder: () => null,
    },
    {
      name: "invalid_ticker",
      tag: 23,
      payloadSize: 0,
      payloadType: "TokenError::error::invalid_ticker",
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

  errorVariant(): typeof TokenError.errorVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_code();
    return TokenError.errorVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  error(): TokenError_error_Inner {
    const descriptor = this.errorVariant();
    if (!descriptor) throw new Error("TokenError: unknown error variant");
    const offset = TokenError.__tnFieldOffset_error;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("TokenError: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return TokenError_error_Inner.__tnCreate(slice, descriptor, undefined);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenError');
    }
    return __tnBigIntToNumber(irResult, 'TokenError::footprint');
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

  static from_array(buffer: Uint8Array): TokenError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TokenError(buffer);
  }

}

export class TokenErrorBuilder {
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

  select_invalid_instruction(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_instruction expects 0 bytes");
    this.tag = 2n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_insufficient_funds(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_insufficient_funds expects 0 bytes");
    this.tag = 4n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_owner_mismatch(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_owner_mismatch expects 0 bytes");
    this.tag = 5n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_authority_mismatch(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_authority_mismatch expects 0 bytes");
    this.tag = 6n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_missing_required_signer(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_missing_required_signer expects 0 bytes");
    this.tag = 7n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account_frozen(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account_frozen expects 0 bytes");
    this.tag = 8n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_account_not_owned_by_program(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_account_not_owned_by_program expects 0 bytes");
    this.tag = 9n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_mint(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_mint expects 0 bytes");
    this.tag = 10n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_non_zero_balance(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_non_zero_balance expects 0 bytes");
    this.tag = 11n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_account_data_size(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_account_data_size expects 0 bytes");
    this.tag = 12n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_overflow(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_overflow expects 0 bytes");
    this.tag = 13n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_mint_mismatch(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_mint_mismatch expects 0 bytes");
    this.tag = 14n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_incorrect_program_id(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_incorrect_program_id expects 0 bytes");
    this.tag = 15n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_txn(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_txn expects 0 bytes");
    this.tag = 16n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_proof(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_proof expects 0 bytes");
    this.tag = 17n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_account(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_account expects 0 bytes");
    this.tag = 18n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_mint_cannot_freeze(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_mint_cannot_freeze expects 0 bytes");
    this.tag = 19n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_syscall_failed(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_syscall_failed expects 0 bytes");
    this.tag = 20n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_decimals_mismatch(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_decimals_mismatch expects 0 bytes");
    this.tag = 21n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_ticker_mismatch(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_ticker_mismatch expects 0 bytes");
    this.tag = 22n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  select_invalid_ticker(payload: Uint8Array | { build(): Uint8Array }): this {
    const bytes = payload instanceof Uint8Array ? payload : payload.build();
    if (bytes.length !== 0) throw new Error("select_invalid_ticker expects 0 bytes");
    this.tag = 23n;
    this.payload = new Uint8Array(bytes);
    return this;
  }

  build(): Uint8Array {
    if (this.tag === null || !this.payload) throw new Error("TokenError builder missing variant");
    const buffer = new Uint8Array(8 + this.payload.length);
    new DataView(buffer.buffer).setBigUint64(0, this.tag, true);
    buffer.set(this.payload, 8);
    __tnBuilderValidateOrThrow("TokenError", TokenError.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const bytes = this.build();
    if (target.length - offset < bytes.length) throw new Error("target buffer too small");
    target.set(bytes, offset);
    return target;
  }

  finish(): TokenError {
    const view = TokenError.from_array(this.build());
    if (!view) throw new Error("failed to build TokenError");
    return view;
  }
}

__tnRegisterFootprint("TokenError", (params) => TokenError.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenError", (buffer, params) => TokenError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenError", (buffer) => { const result = TokenError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenMintAccount ----- */

const __tn_ir_TokenMintAccount = {
  typeName: "TokenMintAccount",
  root: { op: "const", value: 115n }
} as const;

export class TokenMintAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenMintAccount {
    if (!buffer || buffer.length === undefined) throw new Error("TokenMintAccount.__tnCreateView requires a Uint8Array");
    return new TokenMintAccount(new Uint8Array(buffer));
  }

  static builder(): TokenMintAccountBuilder {
    return new TokenMintAccountBuilder();
  }

  static fromBuilder(builder: TokenMintAccountBuilder): TokenMintAccount | null {
    const buffer = builder.build();
    return TokenMintAccount.from_array(buffer);
  }

  get_decimals(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_decimals(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get decimals(): number {
    return this.get_decimals();
  }

  set decimals(value: number) {
    this.set_decimals(value);
  }

  get_supply(): bigint {
    const offset = 1;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_supply(value: bigint): void {
    const offset = 1;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get supply(): bigint {
    return this.get_supply();
  }

  set supply(value: bigint) {
    this.set_supply(value);
  }

  get_creator(): Pubkey {
    const offset = 9;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_creator(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 9;
    this.buffer.set(sourceBytes, offset);
  }

  get creator(): Pubkey {
    return this.get_creator();
  }

  set creator(value: Pubkey) {
    this.set_creator(value);
  }

  get_mint_authority(): Pubkey {
    const offset = 41;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 41;
    this.buffer.set(sourceBytes, offset);
  }

  get mint_authority(): Pubkey {
    return this.get_mint_authority();
  }

  set mint_authority(value: Pubkey) {
    this.set_mint_authority(value);
  }

  get_freeze_authority(): Pubkey {
    const offset = 73;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_freeze_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 73;
    this.buffer.set(sourceBytes, offset);
  }

  get freeze_authority(): Pubkey {
    return this.get_freeze_authority();
  }

  set freeze_authority(value: Pubkey) {
    this.set_freeze_authority(value);
  }

  get_has_freeze_authority(): number {
    const offset = 105;
    return this.view.getUint8(offset);
  }

  set_has_freeze_authority(value: number): void {
    const offset = 105;
    this.view.setUint8(offset, value);
  }

  get has_freeze_authority(): number {
    return this.get_has_freeze_authority();
  }

  set has_freeze_authority(value: number) {
    this.set_has_freeze_authority(value);
  }

  get_ticker(): TickerField {
    const offset = 106;
    const slice = this.buffer.subarray(offset, offset + 9);
    return TickerField.from_array(slice)!;
  }

  set_ticker(value: TickerField): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 106;
    this.buffer.set(sourceBytes, offset);
  }

  get ticker(): TickerField {
    return this.get_ticker();
  }

  set ticker(value: TickerField) {
    this.set_ticker(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenMintAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenMintAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenMintAccount');
    }
    return __tnBigIntToNumber(irResult, 'TokenMintAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 115) return { ok: false, code: "tn.buffer_too_small", consumed: 115 };
    return { ok: true, consumed: 115 };
  }

  static from_array(buffer: Uint8Array): TokenMintAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TokenMintAccount(buffer);
  }

}

export class TokenMintAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(115);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_decimals(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_supply(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(1, cast, true);
    return this;
  }

  set_creator(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("creator expects 32 bytes");
    this.buffer.set(value, 9);
    return this;
  }

  set_mint_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint_authority expects 32 bytes");
    this.buffer.set(value, 41);
    return this;
  }

  set_freeze_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("freeze_authority expects 32 bytes");
    this.buffer.set(value, 73);
    return this;
  }

  set_has_freeze_authority(value: number): this {
    this.view.setUint8(105, value);
    return this;
  }

  set_ticker(value: Uint8Array): this {
    if (value.length !== 9) throw new Error("ticker expects 9 bytes");
    this.buffer.set(value, 106);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("TokenMintAccount", TokenMintAccount.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("TokenMintAccount", TokenMintAccount.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TokenMintAccount {
    const view = TokenMintAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TokenMintAccount");
    return view;
  }
}

__tnRegisterFootprint("TokenMintAccount", (params) => TokenMintAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenMintAccount", (buffer, params) => TokenMintAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenMintAccount", (buffer) => { const result = TokenMintAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenProgramAccount ----- */

const __tn_ir_TokenProgramAccount = {
  typeName: "TokenProgramAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "TokenProgramAccount::payload.account_type", cases: [{ value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 115n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 73n } } }] } } } }
} as const;

export class TokenProgramAccount_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): TokenProgramAccount_payload_Inner {
    return new TokenProgramAccount_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenProgramAccount_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["account_type"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 1)) descriptor = { name: "mint_v1", tag: 1, payloadSize: 115 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "token_account_v1", tag: 2, payloadSize: 73 };
    }
    return new TokenProgramAccount_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asMintV1(): TokenMintAccount | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return TokenMintAccount.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTokenAccountV1(): TokenAccount | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return TokenAccount.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class TokenProgramAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: TokenProgramAccount.Params;

  private constructor(private buffer: Uint8Array, params?: TokenProgramAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = TokenProgramAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("TokenProgramAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: TokenProgramAccount.Params, fieldContext?: Record<string, number | bigint> }): TokenProgramAccount {
    if (!buffer || buffer.length === undefined) throw new Error("TokenProgramAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = TokenProgramAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("TokenProgramAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new TokenProgramAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): TokenProgramAccount.Params {
    return this.__tnParams;
  }

  static builder(): TokenProgramAccountBuilder {
    return new TokenProgramAccountBuilder();
  }

  static fromBuilder(builder: TokenProgramAccountBuilder): TokenProgramAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return TokenProgramAccount.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "mint_v1",
      tag: 1,
      payloadSize: 115,
      payloadType: "TokenProgramAccount::payload::mint_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenMintAccount),
    },
    {
      name: "token_account_v1",
      tag: 2,
      payloadSize: 73,
      payloadType: "TokenProgramAccount::payload::token_account_v1",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenAccount),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: TokenProgramAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_account_type = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = TokenProgramAccount.Params.fromValues({
      payload_account_type: __tnParam_payload_account_type,
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

  payloadVariant(): typeof TokenProgramAccount.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_account_type();
    return TokenProgramAccount.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): TokenProgramAccount_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("TokenProgramAccount: unknown payload variant");
    const offset = TokenProgramAccount.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("TokenProgramAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return TokenProgramAccount_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenProgramAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenProgramAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_account_type: number | bigint): bigint {
    const params = TokenProgramAccount.Params.fromValues({
      payload_account_type: payload_account_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: TokenProgramAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.account_type"] = params.payload_account_type;
    record["TokenProgramAccount::payload.account_type"] = params.payload_account_type;
    return record;
  }

  static footprintIrFromParams(params: TokenProgramAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: TokenProgramAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenProgramAccount');
    return __tnBigIntToNumber(irResult, 'TokenProgramAccount::footprintFromParams');
  }

  static footprintFromValues(input: { payload_account_type: number | bigint }): number {
    const params = TokenProgramAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: TokenProgramAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: TokenProgramAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: TokenProgramAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenProgramAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenProgramAccount::validate') : undefined;
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
  case 1n: t3 = 115; break;
  case 2n: t3 = 73; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: TokenProgramAccount.Params }): TokenProgramAccount | null {
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
    const state = new TokenProgramAccount(buffer, cached);
    return state;
  }


}

export namespace TokenProgramAccount {
  export type Params = {
    /** ABI path: payload.account_type */
    readonly payload_account_type: bigint;
  };

  export const ParamKeys = Object.freeze({
    payload_account_type: "payload.account_type",
  } as const);

  export const Params = {
    fromValues(input: { payload_account_type: number | bigint }): Params {
      return {
        payload_account_type: __tnToBigInt(input.payload_account_type),
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

  export function params(input: { payload_account_type: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class TokenProgramAccountBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_account_type: number | null = null;
  private __tnPayload_payload: { descriptor: typeof TokenProgramAccount.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: TokenProgramAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: TokenProgramAccount.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<TokenProgramAccountBuilder>;

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

  payload(): __TnVariantSelectorResult<TokenProgramAccountBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, TokenProgramAccount.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_account_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("TokenProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = TokenProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_type === null) throw new Error("TokenProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = TokenProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("TokenProgramAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): TokenProgramAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = TokenProgramAccount.from_array(buffer, { params });
    if (!view) throw new Error("TokenProgramAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): TokenProgramAccount {
    return this.finish();
  }

  dynamicParams(): TokenProgramAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): TokenProgramAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = TokenProgramAccount.Params.fromValues({
      payload_account_type: (() => { if (this.__tnField_account_type === null) throw new Error("TokenProgramAccountBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_account_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_account_type === null) throw new Error("TokenProgramAccountBuilder: field 'account_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenProgramAccountBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_account_type);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: TokenProgramAccount.Params): void {
    const result = TokenProgramAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ TokenProgramAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("TokenProgramAccount", (params) => TokenProgramAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenProgramAccount", (buffer, params) => TokenProgramAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenProgramAccount", (buffer) => { const result = TokenProgramAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TransferCheckedInstruction ----- */

const __tn_ir_TransferCheckedInstruction = {
  typeName: "TransferCheckedInstruction",
  root: { op: "const", value: 24n }
} as const;

export class TransferCheckedInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TransferCheckedInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("TransferCheckedInstruction.__tnCreateView requires a Uint8Array");
    return new TransferCheckedInstruction(new Uint8Array(buffer));
  }

  static builder(): TransferCheckedInstructionBuilder {
    return new TransferCheckedInstructionBuilder();
  }

  static fromBuilder(builder: TransferCheckedInstructionBuilder): TransferCheckedInstruction | null {
    const buffer = builder.build();
    return TransferCheckedInstruction.from_array(buffer);
  }

  get_source_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_source_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get source_account_index(): number {
    return this.get_source_account_index();
  }

  set source_account_index(value: number) {
    this.set_source_account_index(value);
  }

  get_dest_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_dest_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get dest_account_index(): number {
    return this.get_dest_account_index();
  }

  set dest_account_index(value: number) {
    this.set_dest_account_index(value);
  }

  get_mint_account_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_account_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_account_index(): number {
    return this.get_mint_account_index();
  }

  set mint_account_index(value: number) {
    this.set_mint_account_index(value);
  }

  get_amount(): bigint {
    const offset = 6;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 6;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_decimals(): number {
    const offset = 14;
    return this.view.getUint8(offset);
  }

  set_decimals(value: number): void {
    const offset = 14;
    this.view.setUint8(offset, value);
  }

  get decimals(): number {
    return this.get_decimals();
  }

  set decimals(value: number) {
    this.set_decimals(value);
  }

  get_ticker(): TickerField {
    const offset = 15;
    const slice = this.buffer.subarray(offset, offset + 9);
    return TickerField.from_array(slice)!;
  }

  set_ticker(value: TickerField): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 15;
    this.buffer.set(sourceBytes, offset);
  }

  get ticker(): TickerField {
    return this.get_ticker();
  }

  set ticker(value: TickerField) {
    this.set_ticker(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TransferCheckedInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TransferCheckedInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TransferCheckedInstruction');
    }
    return __tnBigIntToNumber(irResult, 'TransferCheckedInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 24) return { ok: false, code: "tn.buffer_too_small", consumed: 24 };
    return { ok: true, consumed: 24 };
  }

  static from_array(buffer: Uint8Array): TransferCheckedInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TransferCheckedInstruction(buffer);
  }

}

export class TransferCheckedInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(24);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_source_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_dest_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_mint_account_index(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
    return this;
  }

  set_decimals(value: number): this {
    this.view.setUint8(14, value);
    return this;
  }

  set_ticker(value: Uint8Array): this {
    if (value.length !== 9) throw new Error("ticker expects 9 bytes");
    this.buffer.set(value, 15);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("TransferCheckedInstruction", TransferCheckedInstruction.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("TransferCheckedInstruction", TransferCheckedInstruction.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TransferCheckedInstruction {
    const view = TransferCheckedInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TransferCheckedInstruction");
    return view;
  }
}

__tnRegisterFootprint("TransferCheckedInstruction", (params) => TransferCheckedInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("TransferCheckedInstruction", (buffer, params) => TransferCheckedInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TransferCheckedInstruction", (buffer) => { const result = TransferCheckedInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TransferEventData ----- */

const __tn_ir_TransferEventData = {
  typeName: "TransferEventData",
  root: { op: "const", value: 88n }
} as const;

export class TransferEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TransferEventData {
    if (!buffer || buffer.length === undefined) throw new Error("TransferEventData.__tnCreateView requires a Uint8Array");
    return new TransferEventData(new Uint8Array(buffer));
  }

  static builder(): TransferEventDataBuilder {
    return new TransferEventDataBuilder();
  }

  static fromBuilder(builder: TransferEventDataBuilder): TransferEventData | null {
    const buffer = builder.build();
    return TransferEventData.from_array(buffer);
  }

  get_source(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_source(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get source(): Pubkey {
    return this.get_source();
  }

  set source(value: Pubkey) {
    this.set_source(value);
  }

  get_dest(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_dest(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get dest(): Pubkey {
    return this.get_dest();
  }

  set dest(value: Pubkey) {
    this.set_dest(value);
  }

  get_amount(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_source_post_balance(): bigint {
    const offset = 72;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_source_post_balance(value: bigint): void {
    const offset = 72;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get source_post_balance(): bigint {
    return this.get_source_post_balance();
  }

  set source_post_balance(value: bigint) {
    this.set_source_post_balance(value);
  }

  get_dest_post_balance(): bigint {
    const offset = 80;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_dest_post_balance(value: bigint): void {
    const offset = 80;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get dest_post_balance(): bigint {
    return this.get_dest_post_balance();
  }

  set dest_post_balance(value: bigint) {
    this.set_dest_post_balance(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TransferEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TransferEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TransferEventData');
    }
    return __tnBigIntToNumber(irResult, 'TransferEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 88) return { ok: false, code: "tn.buffer_too_small", consumed: 88 };
    return { ok: true, consumed: 88 };
  }

  static from_array(buffer: Uint8Array): TransferEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TransferEventData(buffer);
  }

}

export class TransferEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(88);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_source(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("source expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_dest(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("dest expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_source_post_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(72, cast, true);
    return this;
  }

  set_dest_post_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(80, cast, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("TransferEventData", TransferEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("TransferEventData", TransferEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TransferEventData {
    const view = TransferEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TransferEventData");
    return view;
  }
}

__tnRegisterFootprint("TransferEventData", (params) => TransferEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("TransferEventData", (buffer, params) => TransferEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TransferEventData", (buffer) => { const result = TransferEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TransferInstruction ----- */

const __tn_ir_TransferInstruction = {
  typeName: "TransferInstruction",
  root: { op: "const", value: 12n }
} as const;

export class TransferInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TransferInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("TransferInstruction.__tnCreateView requires a Uint8Array");
    return new TransferInstruction(new Uint8Array(buffer));
  }

  static builder(): TransferInstructionBuilder {
    return new TransferInstructionBuilder();
  }

  static fromBuilder(builder: TransferInstructionBuilder): TransferInstruction | null {
    const buffer = builder.build();
    return TransferInstruction.from_array(buffer);
  }

  get_source_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_source_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get source_account_index(): number {
    return this.get_source_account_index();
  }

  set source_account_index(value: number) {
    this.set_source_account_index(value);
  }

  get_dest_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_dest_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get dest_account_index(): number {
    return this.get_dest_account_index();
  }

  set dest_account_index(value: number) {
    this.set_dest_account_index(value);
  }

  get_amount(): bigint {
    const offset = 4;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 4;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TransferInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TransferInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TransferInstruction');
    }
    return __tnBigIntToNumber(irResult, 'TransferInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 12) return { ok: false, code: "tn.buffer_too_small", consumed: 12 };
    return { ok: true, consumed: 12 };
  }

  static new(source_account_index: number, dest_account_index: number, amount: bigint): TransferInstruction {
    const buffer = new Uint8Array(12);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, source_account_index, true); /* source_account_index (little-endian) */
    view.setUint16(2, dest_account_index, true); /* dest_account_index (little-endian) */
    view.setBigUint64(4, amount, true); /* amount (little-endian) */

    return new TransferInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): TransferInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TransferInstruction(buffer);
  }

}

export class TransferInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(12);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_source_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_dest_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(4, cast, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("TransferInstruction", TransferInstruction.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("TransferInstruction", TransferInstruction.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TransferInstruction {
    const view = TransferInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TransferInstruction");
    return view;
  }
}

__tnRegisterFootprint("TransferInstruction", (params) => TransferInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("TransferInstruction", (buffer, params) => TransferInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TransferInstruction", (buffer) => { const result = TransferInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR BurnEventData ----- */

const __tn_ir_BurnEventData = {
  typeName: "BurnEventData",
  root: { op: "const", value: 120n }
} as const;

export class BurnEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): BurnEventData {
    if (!buffer || buffer.length === undefined) throw new Error("BurnEventData.__tnCreateView requires a Uint8Array");
    return new BurnEventData(new Uint8Array(buffer));
  }

  static builder(): BurnEventDataBuilder {
    return new BurnEventDataBuilder();
  }

  static fromBuilder(builder: BurnEventDataBuilder): BurnEventData | null {
    const buffer = builder.build();
    return BurnEventData.from_array(buffer);
  }

  get_mint(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get mint(): Pubkey {
    return this.get_mint();
  }

  set mint(value: Pubkey) {
    this.set_mint(value);
  }

  get_account(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_account(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get account(): Pubkey {
    return this.get_account();
  }

  set account(value: Pubkey) {
    this.set_account(value);
  }

  get_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Pubkey {
    return this.get_authority();
  }

  set authority(value: Pubkey) {
    this.set_authority(value);
  }

  get_amount(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_account_post_balance(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_account_post_balance(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get account_post_balance(): bigint {
    return this.get_account_post_balance();
  }

  set account_post_balance(value: bigint) {
    this.set_account_post_balance(value);
  }

  get_mint_supply(): bigint {
    const offset = 112;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mint_supply(value: bigint): void {
    const offset = 112;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mint_supply(): bigint {
    return this.get_mint_supply();
  }

  set mint_supply(value: bigint) {
    this.set_mint_supply(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_BurnEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_BurnEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for BurnEventData');
    }
    return __tnBigIntToNumber(irResult, 'BurnEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 120) return { ok: false, code: "tn.buffer_too_small", consumed: 120 };
    return { ok: true, consumed: 120 };
  }

  static from_array(buffer: Uint8Array): BurnEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new BurnEventData(buffer);
  }

}

export class BurnEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(120);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_account(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("account expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_account_post_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_mint_supply(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(112, cast, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("BurnEventData", BurnEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("BurnEventData", BurnEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): BurnEventData {
    const view = BurnEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BurnEventData");
    return view;
  }
}

__tnRegisterFootprint("BurnEventData", (params) => BurnEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("BurnEventData", (buffer, params) => BurnEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("BurnEventData", (buffer) => { const result = BurnEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CloseAccountEventData ----- */

const __tn_ir_CloseAccountEventData = {
  typeName: "CloseAccountEventData",
  root: { op: "const", value: 96n }
} as const;

export class CloseAccountEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CloseAccountEventData {
    if (!buffer || buffer.length === undefined) throw new Error("CloseAccountEventData.__tnCreateView requires a Uint8Array");
    return new CloseAccountEventData(new Uint8Array(buffer));
  }

  static builder(): CloseAccountEventDataBuilder {
    return new CloseAccountEventDataBuilder();
  }

  static fromBuilder(builder: CloseAccountEventDataBuilder): CloseAccountEventData | null {
    const buffer = builder.build();
    return CloseAccountEventData.from_array(buffer);
  }

  get_account(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_account(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get account(): Pubkey {
    return this.get_account();
  }

  set account(value: Pubkey) {
    this.set_account(value);
  }

  get_destination(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_destination(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get destination(): Pubkey {
    return this.get_destination();
  }

  set destination(value: Pubkey) {
    this.set_destination(value);
  }

  get_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Pubkey {
    return this.get_authority();
  }

  set authority(value: Pubkey) {
    this.set_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CloseAccountEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CloseAccountEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CloseAccountEventData');
    }
    return __tnBigIntToNumber(irResult, 'CloseAccountEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): CloseAccountEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CloseAccountEventData(buffer);
  }

}

export class CloseAccountEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(96);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_account(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("account expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_destination(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("destination expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("CloseAccountEventData", CloseAccountEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("CloseAccountEventData", CloseAccountEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CloseAccountEventData {
    const view = CloseAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CloseAccountEventData");
    return view;
  }
}

__tnRegisterFootprint("CloseAccountEventData", (params) => CloseAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("CloseAccountEventData", (buffer, params) => CloseAccountEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CloseAccountEventData", (buffer) => { const result = CloseAccountEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FreezeAccountEventData ----- */

const __tn_ir_FreezeAccountEventData = {
  typeName: "FreezeAccountEventData",
  root: { op: "const", value: 96n }
} as const;

export class FreezeAccountEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FreezeAccountEventData {
    if (!buffer || buffer.length === undefined) throw new Error("FreezeAccountEventData.__tnCreateView requires a Uint8Array");
    return new FreezeAccountEventData(new Uint8Array(buffer));
  }

  static builder(): FreezeAccountEventDataBuilder {
    return new FreezeAccountEventDataBuilder();
  }

  static fromBuilder(builder: FreezeAccountEventDataBuilder): FreezeAccountEventData | null {
    const buffer = builder.build();
    return FreezeAccountEventData.from_array(buffer);
  }

  get_account(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_account(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get account(): Pubkey {
    return this.get_account();
  }

  set account(value: Pubkey) {
    this.set_account(value);
  }

  get_mint(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get mint(): Pubkey {
    return this.get_mint();
  }

  set mint(value: Pubkey) {
    this.set_mint(value);
  }

  get_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Pubkey {
    return this.get_authority();
  }

  set authority(value: Pubkey) {
    this.set_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FreezeAccountEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FreezeAccountEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FreezeAccountEventData');
    }
    return __tnBigIntToNumber(irResult, 'FreezeAccountEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): FreezeAccountEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FreezeAccountEventData(buffer);
  }

}

export class FreezeAccountEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(96);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_account(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("account expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("FreezeAccountEventData", FreezeAccountEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("FreezeAccountEventData", FreezeAccountEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FreezeAccountEventData {
    const view = FreezeAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FreezeAccountEventData");
    return view;
  }
}

__tnRegisterFootprint("FreezeAccountEventData", (params) => FreezeAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("FreezeAccountEventData", (buffer, params) => FreezeAccountEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FreezeAccountEventData", (buffer) => { const result = FreezeAccountEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR InitializeAccountEventData ----- */

const __tn_ir_InitializeAccountEventData = {
  typeName: "InitializeAccountEventData",
  root: { op: "const", value: 96n }
} as const;

export class InitializeAccountEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): InitializeAccountEventData {
    if (!buffer || buffer.length === undefined) throw new Error("InitializeAccountEventData.__tnCreateView requires a Uint8Array");
    return new InitializeAccountEventData(new Uint8Array(buffer));
  }

  static builder(): InitializeAccountEventDataBuilder {
    return new InitializeAccountEventDataBuilder();
  }

  static fromBuilder(builder: InitializeAccountEventDataBuilder): InitializeAccountEventData | null {
    const buffer = builder.build();
    return InitializeAccountEventData.from_array(buffer);
  }

  get_account(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_account(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get account(): Pubkey {
    return this.get_account();
  }

  set account(value: Pubkey) {
    this.set_account(value);
  }

  get_owner(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_owner(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get owner(): Pubkey {
    return this.get_owner();
  }

  set owner(value: Pubkey) {
    this.set_owner(value);
  }

  get_mint(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get mint(): Pubkey {
    return this.get_mint();
  }

  set mint(value: Pubkey) {
    this.set_mint(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InitializeAccountEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InitializeAccountEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InitializeAccountEventData');
    }
    return __tnBigIntToNumber(irResult, 'InitializeAccountEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): InitializeAccountEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new InitializeAccountEventData(buffer);
  }

}

export class InitializeAccountEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(96);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_account(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("account expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_owner(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("owner expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("InitializeAccountEventData", InitializeAccountEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("InitializeAccountEventData", InitializeAccountEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): InitializeAccountEventData {
    const view = InitializeAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build InitializeAccountEventData");
    return view;
  }
}

__tnRegisterFootprint("InitializeAccountEventData", (params) => InitializeAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeAccountEventData", (buffer, params) => InitializeAccountEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InitializeAccountEventData", (buffer) => { const result = InitializeAccountEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR InitializeMintEventData ----- */

const __tn_ir_InitializeMintEventData = {
  typeName: "InitializeMintEventData",
  root: { op: "const", value: 115n }
} as const;

export class InitializeMintEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): InitializeMintEventData {
    if (!buffer || buffer.length === undefined) throw new Error("InitializeMintEventData.__tnCreateView requires a Uint8Array");
    return new InitializeMintEventData(new Uint8Array(buffer));
  }

  static builder(): InitializeMintEventDataBuilder {
    return new InitializeMintEventDataBuilder();
  }

  static fromBuilder(builder: InitializeMintEventDataBuilder): InitializeMintEventData | null {
    const buffer = builder.build();
    return InitializeMintEventData.from_array(buffer);
  }

  get_mint(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get mint(): Pubkey {
    return this.get_mint();
  }

  set mint(value: Pubkey) {
    this.set_mint(value);
  }

  get_mint_authority(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get mint_authority(): Pubkey {
    return this.get_mint_authority();
  }

  set mint_authority(value: Pubkey) {
    this.set_mint_authority(value);
  }

  get_freeze_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_freeze_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get freeze_authority(): Pubkey {
    return this.get_freeze_authority();
  }

  set freeze_authority(value: Pubkey) {
    this.set_freeze_authority(value);
  }

  get_supply(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_supply(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get supply(): bigint {
    return this.get_supply();
  }

  set supply(value: bigint) {
    this.set_supply(value);
  }

  get_decimals(): number {
    const offset = 104;
    return this.view.getUint8(offset);
  }

  set_decimals(value: number): void {
    const offset = 104;
    this.view.setUint8(offset, value);
  }

  get decimals(): number {
    return this.get_decimals();
  }

  set decimals(value: number) {
    this.set_decimals(value);
  }

  get_has_freeze_authority(): number {
    const offset = 105;
    return this.view.getUint8(offset);
  }

  set_has_freeze_authority(value: number): void {
    const offset = 105;
    this.view.setUint8(offset, value);
  }

  get has_freeze_authority(): number {
    return this.get_has_freeze_authority();
  }

  set has_freeze_authority(value: number) {
    this.set_has_freeze_authority(value);
  }

  get_ticker(): TickerField {
    const offset = 106;
    const slice = this.buffer.subarray(offset, offset + 9);
    return TickerField.from_array(slice)!;
  }

  set_ticker(value: TickerField): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 106;
    this.buffer.set(sourceBytes, offset);
  }

  get ticker(): TickerField {
    return this.get_ticker();
  }

  set ticker(value: TickerField) {
    this.set_ticker(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InitializeMintEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InitializeMintEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InitializeMintEventData');
    }
    return __tnBigIntToNumber(irResult, 'InitializeMintEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 115) return { ok: false, code: "tn.buffer_too_small", consumed: 115 };
    return { ok: true, consumed: 115 };
  }

  static from_array(buffer: Uint8Array): InitializeMintEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new InitializeMintEventData(buffer);
  }

}

export class InitializeMintEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(115);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_mint_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint_authority expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_freeze_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("freeze_authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_supply(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_decimals(value: number): this {
    this.view.setUint8(104, value);
    return this;
  }

  set_has_freeze_authority(value: number): this {
    this.view.setUint8(105, value);
    return this;
  }

  set_ticker(value: Uint8Array): this {
    if (value.length !== 9) throw new Error("ticker expects 9 bytes");
    this.buffer.set(value, 106);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("InitializeMintEventData", InitializeMintEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("InitializeMintEventData", InitializeMintEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): InitializeMintEventData {
    const view = InitializeMintEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build InitializeMintEventData");
    return view;
  }
}

__tnRegisterFootprint("InitializeMintEventData", (params) => InitializeMintEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeMintEventData", (buffer, params) => InitializeMintEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InitializeMintEventData", (buffer) => { const result = InitializeMintEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MintToEventData ----- */

const __tn_ir_MintToEventData = {
  typeName: "MintToEventData",
  root: { op: "const", value: 120n }
} as const;

export class MintToEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MintToEventData {
    if (!buffer || buffer.length === undefined) throw new Error("MintToEventData.__tnCreateView requires a Uint8Array");
    return new MintToEventData(new Uint8Array(buffer));
  }

  static builder(): MintToEventDataBuilder {
    return new MintToEventDataBuilder();
  }

  static fromBuilder(builder: MintToEventDataBuilder): MintToEventData | null {
    const buffer = builder.build();
    return MintToEventData.from_array(buffer);
  }

  get_mint(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get mint(): Pubkey {
    return this.get_mint();
  }

  set mint(value: Pubkey) {
    this.set_mint(value);
  }

  get_dest(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_dest(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get dest(): Pubkey {
    return this.get_dest();
  }

  set dest(value: Pubkey) {
    this.set_dest(value);
  }

  get_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Pubkey {
    return this.get_authority();
  }

  set authority(value: Pubkey) {
    this.set_authority(value);
  }

  get_amount(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_dest_post_balance(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_dest_post_balance(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get dest_post_balance(): bigint {
    return this.get_dest_post_balance();
  }

  set dest_post_balance(value: bigint) {
    this.set_dest_post_balance(value);
  }

  get_mint_supply(): bigint {
    const offset = 112;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mint_supply(value: bigint): void {
    const offset = 112;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mint_supply(): bigint {
    return this.get_mint_supply();
  }

  set mint_supply(value: bigint) {
    this.set_mint_supply(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MintToEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MintToEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MintToEventData');
    }
    return __tnBigIntToNumber(irResult, 'MintToEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 120) return { ok: false, code: "tn.buffer_too_small", consumed: 120 };
    return { ok: true, consumed: 120 };
  }

  static from_array(buffer: Uint8Array): MintToEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MintToEventData(buffer);
  }

}

export class MintToEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(120);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_dest(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("dest expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_dest_post_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_mint_supply(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(112, cast, true);
    return this;
  }

  build(): Uint8Array {
    const buffer = this.buffer.slice();
    __tnBuilderValidateOrThrow("MintToEventData", MintToEventData.validate(buffer));
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    __tnBuilderValidateOrThrow("MintToEventData", MintToEventData.validate(this.buffer));
    target.set(this.buffer, offset);
    return target;
  }

  finish(): MintToEventData {
    const view = MintToEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MintToEventData");
    return view;
  }
}

__tnRegisterFootprint("MintToEventData", (params) => MintToEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("MintToEventData", (buffer, params) => MintToEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MintToEventData", (buffer) => { const result = MintToEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenEvent ----- */

const __tn_ir_TokenEvent = {
  typeName: "TokenEvent",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "TokenEvent::payload.event_type", cases: [{ value: 0, node: { op: "align", alignment: 1, node: { op: "const", value: 115n } } }, { value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 96n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 88n } } }, { value: 3, node: { op: "align", alignment: 1, node: { op: "const", value: 120n } } }, { value: 4, node: { op: "align", alignment: 1, node: { op: "const", value: 120n } } }, { value: 5, node: { op: "align", alignment: 1, node: { op: "const", value: 96n } } }, { value: 6, node: { op: "align", alignment: 1, node: { op: "const", value: 96n } } }, { value: 7, node: { op: "align", alignment: 1, node: { op: "const", value: 96n } } }] } } } }
} as const;

export class TokenEvent_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): TokenEvent_payload_Inner {
    return new TokenEvent_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenEvent_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["event_type"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 0)) descriptor = { name: "initialize_mint", tag: 0, payloadSize: 115 };
      if (__tnTagEquals(tag, 1)) descriptor = { name: "initialize_account", tag: 1, payloadSize: 96 };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "transfer", tag: 2, payloadSize: 88 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "mint_to", tag: 3, payloadSize: 120 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "burn", tag: 4, payloadSize: 120 };
      if (__tnTagEquals(tag, 5)) descriptor = { name: "close_account", tag: 5, payloadSize: 96 };
      if (__tnTagEquals(tag, 6)) descriptor = { name: "freeze_account", tag: 6, payloadSize: 96 };
      if (__tnTagEquals(tag, 7)) descriptor = { name: "thaw_account", tag: 7, payloadSize: 96 };
    }
    return new TokenEvent_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInitializeMint(): InitializeMintEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 0)) return null;
    return InitializeMintEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInitializeAccount(): InitializeAccountEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return InitializeAccountEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTransfer(): TransferEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return TransferEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMintTo(): MintToEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return MintToEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBurn(): BurnEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return BurnEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAccount(): CloseAccountEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 5)) return null;
    return CloseAccountEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFreezeAccount(): FreezeAccountEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 6)) return null;
    return FreezeAccountEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asThawAccount(): ThawAccountEventData | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 7)) return null;
    return ThawAccountEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class TokenEvent {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: TokenEvent.Params;

  private constructor(private buffer: Uint8Array, params?: TokenEvent.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = TokenEvent.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("TokenEvent: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: TokenEvent.Params, fieldContext?: Record<string, number | bigint> }): TokenEvent {
    if (!buffer || buffer.length === undefined) throw new Error("TokenEvent.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = TokenEvent.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("TokenEvent.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new TokenEvent(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): TokenEvent.Params {
    return this.__tnParams;
  }

  static builder(): TokenEventBuilder {
    return new TokenEventBuilder();
  }

  static fromBuilder(builder: TokenEventBuilder): TokenEvent | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return TokenEvent.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "initialize_mint",
      tag: 0,
      payloadSize: 115,
      payloadType: "TokenEvent::payload::initialize_mint",
      createPayloadBuilder: () => __tnMaybeCallBuilder(InitializeMintEventData),
    },
    {
      name: "initialize_account",
      tag: 1,
      payloadSize: 96,
      payloadType: "TokenEvent::payload::initialize_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(InitializeAccountEventData),
    },
    {
      name: "transfer",
      tag: 2,
      payloadSize: 88,
      payloadType: "TokenEvent::payload::transfer",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TransferEventData),
    },
    {
      name: "mint_to",
      tag: 3,
      payloadSize: 120,
      payloadType: "TokenEvent::payload::mint_to",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MintToEventData),
    },
    {
      name: "burn",
      tag: 4,
      payloadSize: 120,
      payloadType: "TokenEvent::payload::burn",
      createPayloadBuilder: () => __tnMaybeCallBuilder(BurnEventData),
    },
    {
      name: "close_account",
      tag: 5,
      payloadSize: 96,
      payloadType: "TokenEvent::payload::close_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CloseAccountEventData),
    },
    {
      name: "freeze_account",
      tag: 6,
      payloadSize: 96,
      payloadType: "TokenEvent::payload::freeze_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FreezeAccountEventData),
    },
    {
      name: "thaw_account",
      tag: 7,
      payloadSize: 96,
      payloadType: "TokenEvent::payload::thaw_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ThawAccountEventData),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: TokenEvent.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_event_type = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = TokenEvent.Params.fromValues({
      payload_event_type: __tnParam_payload_event_type,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_event_type(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_event_type(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get event_type(): number {
    return this.get_event_type();
  }

  set event_type(value: number) {
    this.set_event_type(value);
  }

  payloadVariant(): typeof TokenEvent.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_event_type();
    return TokenEvent.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): TokenEvent_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("TokenEvent: unknown payload variant");
    const offset = TokenEvent.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("TokenEvent: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return TokenEvent_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenEvent, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_event_type: number | bigint): bigint {
    const params = TokenEvent.Params.fromValues({
      payload_event_type: payload_event_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: TokenEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.event_type"] = params.payload_event_type;
    record["TokenEvent::payload.event_type"] = params.payload_event_type;
    return record;
  }

  static footprintIrFromParams(params: TokenEvent.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: TokenEvent.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenEvent');
    return __tnBigIntToNumber(irResult, 'TokenEvent::footprintFromParams');
  }

  static footprintFromValues(input: { payload_event_type: number | bigint }): number {
    const params = TokenEvent.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: TokenEvent.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: TokenEvent.Params }): { ok: boolean; code?: string; consumed?: number; params?: TokenEvent.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenEvent::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenEvent::validate') : undefined;
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
  case 0n: t3 = 115; break;
  case 1n: t3 = 96; break;
  case 2n: t3 = 88; break;
  case 3n: t3 = 120; break;
  case 4n: t3 = 120; break;
  case 5n: t3 = 96; break;
  case 6n: t3 = 96; break;
  case 7n: t3 = 96; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: TokenEvent.Params }): TokenEvent | null {
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
    const state = new TokenEvent(buffer, cached);
    return state;
  }


}

export namespace TokenEvent {
  export type Params = {
    /** ABI path: payload.event_type */
    readonly payload_event_type: bigint;
  };

  export const ParamKeys = Object.freeze({
    payload_event_type: "payload.event_type",
  } as const);

  export const Params = {
    fromValues(input: { payload_event_type: number | bigint }): Params {
      return {
        payload_event_type: __tnToBigInt(input.payload_event_type),
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

  export function params(input: { payload_event_type: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class TokenEventBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_event_type: number | null = null;
  private __tnPayload_payload: { descriptor: typeof TokenEvent.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: TokenEvent.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: TokenEvent.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<TokenEventBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(1);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_event_type(value: number): void {
    this.__tnField_event_type = value;
    this.__tnInvalidate();
  }

  set_event_type(value: number): this {
    this.__tnAssign_event_type(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<TokenEventBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, TokenEvent.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_event_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("TokenEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = TokenEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("TokenEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = TokenEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("TokenEventBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): TokenEvent {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = TokenEvent.from_array(buffer, { params });
    if (!view) throw new Error("TokenEventBuilder: failed to finalize view");
    return view;
  }

  finishView(): TokenEvent {
    return this.finish();
  }

  dynamicParams(): TokenEvent.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): TokenEvent.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = TokenEvent.Params.fromValues({
      payload_event_type: (() => { if (this.__tnField_event_type === null) throw new Error("TokenEventBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_event_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_event_type === null) throw new Error("TokenEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenEventBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_event_type);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: TokenEvent.Params): void {
    const result = TokenEvent.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ TokenEvent }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("TokenEvent", (params) => TokenEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenEvent", (buffer, params) => TokenEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenEvent", (buffer) => { const result = TokenEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR InitializeAccountInstruction ----- */

const __tn_ir_InitializeAccountInstruction = {
  typeName: "InitializeAccountInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class InitializeAccountInstruction {
  private view: DataView;
  private __tnParams: InitializeAccountInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: InitializeAccountInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = InitializeAccountInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("InitializeAccountInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: InitializeAccountInstruction.Params, fieldContext?: Record<string, number | bigint> }): InitializeAccountInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("InitializeAccountInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = InitializeAccountInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("InitializeAccountInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new InitializeAccountInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): InitializeAccountInstruction.Params {
    return this.__tnParams;
  }

  static builder(): InitializeAccountInstructionBuilder {
    return new InitializeAccountInstructionBuilder();
  }

  static fromBuilder(builder: InitializeAccountInstructionBuilder): InitializeAccountInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return InitializeAccountInstruction.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnFieldValue_token_account_index: number | null = null;
    let __tnFieldValue_mint_account_index: number | null = null;
    let __tnFieldValue_owner_account_index: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_token_account_index = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_token_account_index = __tnRead_token_account_index;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_mint_account_index = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_mint_account_index = __tnRead_mint_account_index;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_owner_account_index = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_owner_account_index = __tnRead_owner_account_index;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    const __tnTyperefResult_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_state_proof.ok || __tnTyperefResult_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_state_proof = __tnTyperefResult_state_proof.params ?? null;
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_state_proof.consumed, "InitializeAccountInstruction::state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: InitializeAccountInstruction.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = InitializeAccountInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = InitializeAccountInstruction.Params.fromValues({
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_token_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_account_index(): number {
    return this.get_token_account_index();
  }

  set token_account_index(value: number) {
    this.set_token_account_index(value);
  }

  get_mint_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_account_index(): number {
    return this.get_mint_account_index();
  }

  set mint_account_index(value: number) {
    this.set_mint_account_index(value);
  }

  get_owner_account_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_owner_account_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get owner_account_index(): number {
    return this.get_owner_account_index();
  }

  set owner_account_index(value: number) {
    this.set_owner_account_index(value);
  }

  get_new_account_seed(): Seed32 {
    const offset = 6;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_new_account_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 6;
    this.buffer.set(sourceBytes, offset);
  }

  get new_account_seed(): Seed32 {
    return this.get_new_account_seed();
  }

  set new_account_seed(value: Seed32) {
    this.set_new_account_seed(value);
  }

  get_state_proof(): StateProof {
    const offset = 38;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("InitializeAccountInstruction: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 38;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InitializeAccountInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InitializeAccountInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = InitializeAccountInstruction.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: InitializeAccountInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: InitializeAccountInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: InitializeAccountInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InitializeAccountInstruction');
    return __tnBigIntToNumber(irResult, 'InitializeAccountInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = InitializeAccountInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: InitializeAccountInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: InitializeAccountInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: InitializeAccountInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InitializeAccountInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InitializeAccountInstruction::validate') : undefined;
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
if (c + 32 > b.length) return null; c += 32;
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

  static from_array(buffer: Uint8Array, opts?: { params?: InitializeAccountInstruction.Params }): InitializeAccountInstruction | null {
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
    const state = new InitializeAccountInstruction(buffer, cached);
    return state;
  }


}

export namespace InitializeAccountInstruction {
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

export class InitializeAccountInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: InitializeAccountInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: InitializeAccountInstruction.Params | null = null;
  private __tnTail_state_proof: Uint8Array | null = null;
  private __tnTailParams_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(38);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_token_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_mint_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_owner_account_index(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_new_account_seed(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("new_account_seed expects 32 bytes");
    this.buffer.set(value, 6);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "InitializeAccountInstructionBuilder::state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("InitializeAccountInstructionBuilder: field 'state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "InitializeAccountInstructionBuilder::state_proof") !== bytes.length) throw new Error("InitializeAccountInstructionBuilder: field 'state_proof' validation did not consume the full buffer");
    this.__tnTail_state_proof = bytes;
    this.__tnTailParams_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  private __tnSyncLengths(): void {
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = InitializeAccountInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = InitializeAccountInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("InitializeAccountInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): InitializeAccountInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = InitializeAccountInstruction.from_array(buffer, { params });
    if (!view) throw new Error("InitializeAccountInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): InitializeAccountInstruction {
    return this.finish();
  }

  dynamicParams(): InitializeAccountInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): InitializeAccountInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = InitializeAccountInstruction.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("InitializeAccountInstructionBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("InitializeAccountInstructionBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_state_proof_bytes = this.__tnTail_state_proof;
    if (!__tnLocal_state_proof_bytes) throw new Error("InitializeAccountInstructionBuilder: field 'state_proof' must be written before build");
    target.set(__tnLocal_state_proof_bytes, cursor);
    cursor += __tnLocal_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: InitializeAccountInstruction.Params): void {
    const result = InitializeAccountInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ InitializeAccountInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("InitializeAccountInstruction", (params) => InitializeAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeAccountInstruction", (buffer, params) => InitializeAccountInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InitializeAccountInstruction", (buffer) => { const result = InitializeAccountInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR InitializeMintInstruction ----- */

const __tn_ir_InitializeMintInstruction = {
  typeName: "InitializeMintInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 9n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class InitializeMintInstruction {
  private view: DataView;
  private __tnParams: InitializeMintInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: InitializeMintInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = InitializeMintInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("InitializeMintInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: InitializeMintInstruction.Params, fieldContext?: Record<string, number | bigint> }): InitializeMintInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("InitializeMintInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = InitializeMintInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("InitializeMintInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new InitializeMintInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): InitializeMintInstruction.Params {
    return this.__tnParams;
  }

  static builder(): InitializeMintInstructionBuilder {
    return new InitializeMintInstructionBuilder();
  }

  static fromBuilder(builder: InitializeMintInstructionBuilder): InitializeMintInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return InitializeMintInstruction.from_array(buffer, { params });
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnFieldValue_mint_account_index: number | null = null;
    let __tnFieldValue_decimals: number | null = null;
    let __tnFieldValue_has_freeze_authority: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_mint_account_index = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_mint_account_index = __tnRead_mint_account_index;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_decimals = view.getUint8(__tnCursorMutable);
    __tnFieldValue_decimals = __tnRead_decimals;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_has_freeze_authority = view.getUint8(__tnCursorMutable);
    __tnFieldValue_has_freeze_authority = __tnRead_has_freeze_authority;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 9 > __tnLength) return null;
    __tnCursorMutable += 9;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    const __tnTyperefResult_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_state_proof.ok || __tnTyperefResult_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_state_proof = __tnTyperefResult_state_proof.params ?? null;
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_state_proof || __tnTyperefParams_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_state_proof.consumed, "InitializeMintInstruction::state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: InitializeMintInstruction.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = InitializeMintInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = InitializeMintInstruction.Params.fromValues({
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_mint_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_account_index(): number {
    return this.get_mint_account_index();
  }

  set mint_account_index(value: number) {
    this.set_mint_account_index(value);
  }

  get_decimals(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_decimals(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get decimals(): number {
    return this.get_decimals();
  }

  set decimals(value: number) {
    this.set_decimals(value);
  }

  get_creator(): Pubkey {
    const offset = 3;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_creator(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 3;
    this.buffer.set(sourceBytes, offset);
  }

  get creator(): Pubkey {
    return this.get_creator();
  }

  set creator(value: Pubkey) {
    this.set_creator(value);
  }

  get_mint_authority(): Pubkey {
    const offset = 35;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 35;
    this.buffer.set(sourceBytes, offset);
  }

  get mint_authority(): Pubkey {
    return this.get_mint_authority();
  }

  set mint_authority(value: Pubkey) {
    this.set_mint_authority(value);
  }

  get_freeze_authority(): Pubkey {
    const offset = 67;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_freeze_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 67;
    this.buffer.set(sourceBytes, offset);
  }

  get freeze_authority(): Pubkey {
    return this.get_freeze_authority();
  }

  set freeze_authority(value: Pubkey) {
    this.set_freeze_authority(value);
  }

  get_has_freeze_authority(): number {
    const offset = 99;
    return this.view.getUint8(offset);
  }

  set_has_freeze_authority(value: number): void {
    const offset = 99;
    this.view.setUint8(offset, value);
  }

  get has_freeze_authority(): number {
    return this.get_has_freeze_authority();
  }

  set has_freeze_authority(value: number) {
    this.set_has_freeze_authority(value);
  }

  get_ticker(): TickerField {
    const offset = 100;
    const slice = this.buffer.subarray(offset, offset + 9);
    return TickerField.from_array(slice)!;
  }

  set_ticker(value: TickerField): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 100;
    this.buffer.set(sourceBytes, offset);
  }

  get ticker(): TickerField {
    return this.get_ticker();
  }

  set ticker(value: TickerField) {
    this.set_ticker(value);
  }

  get_seed(): Seed32 {
    const offset = 109;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 109;
    this.buffer.set(sourceBytes, offset);
  }

  get seed(): Seed32 {
    return this.get_seed();
  }

  set seed(value: Seed32) {
    this.set_seed(value);
  }

  get_state_proof(): StateProof {
    const offset = 141;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("InitializeMintInstruction: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 141;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InitializeMintInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InitializeMintInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = InitializeMintInstruction.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: InitializeMintInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: InitializeMintInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: InitializeMintInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InitializeMintInstruction');
    return __tnBigIntToNumber(irResult, 'InitializeMintInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = InitializeMintInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: InitializeMintInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: InitializeMintInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: InitializeMintInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InitializeMintInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InitializeMintInstruction::validate') : undefined;
    if (this.__tnWalkTags(buffer) === null) return { ok: false, code: "tn.invalid_tag" };
    return { ok: true, consumed, params };
  }

  /** Walks the value's bytes, checking every enum tag; its size, or null. */
  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {}): number | null {
    void ctx;
    return ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s1 = c;
if (c + 2 > b.length) return null; const x2 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 1 > b.length) return null; const x3 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
const s4 = c;
const av5 = v; const ao6 = c;
if (c + 32 > b.length) return null; c += 32;
void s4;
const s7 = c;
const av8 = v; const ao9 = c;
if (c + 32 > b.length) return null; c += 32;
void s7;
const s10 = c;
const av11 = v; const ao12 = c;
if (c + 32 > b.length) return null; c += 32;
void s10;
if (c + 1 > b.length) return null; const x13 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
const s14 = c;
if (c + 1 > b.length) return null; const x15 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
const av16 = v; const ao17 = c;
if (c + 8 > b.length) return null; c += 8;
void s14;
if (c + 32 > b.length) return null; c += 32;
const s18 = c;
const s19 = c;
if (c + 8 > b.length) return null; const x20 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s21 = c;
const av22 = v; const ao23 = c;
if (c + 32 > b.length) return null; c += 32;
void s21;
void s19;
let t24: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x20, 62n), 3n)) as bigint | null) {
  case 0n: t24 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s25 = c;
const n26 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 31))))))))); if (n26 === null || n26 < 0n) return null;
if (BigInt(c) + n26 * 32n > BigInt(b.length)) return null; c += Number(n26 * 32n);
void s25;
return c; })(b.subarray(c)); break;
  case 1n: t24 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s27 = c;
const s28 = c;
const av29 = v; const ao30 = c;
if (c + 32 > b.length) return null; c += 32;
void s28;
const n31 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 31))))))))); if (n31 === null || n31 < 0n) return null;
if (BigInt(c) + n31 * 32n > BigInt(b.length)) return null; c += Number(n31 * 32n);
void s27;
return c; })(b.subarray(c)); break;
  case 2n: t24 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s32 = c;
const s33 = c;
const av34 = v; const ao35 = c;
if (c + 32 > b.length) return null; c += 32;
void s33;
const s36 = c;
const av37 = v; const ao38 = c;
if (c + 32 > b.length) return null; c += 32;
void s36;
const n39 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av22.getUint8(ao23 + 31))))))))); if (n39 === null || n39 < 0n) return null;
if (BigInt(c) + n39 * 32n > BigInt(b.length)) return null; c += Number(n39 * 32n);
void s32;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t24 === null || c + t24 > b.length) return null; c += t24;
void s18;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: InitializeMintInstruction.Params }): InitializeMintInstruction | null {
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
    const state = new InitializeMintInstruction(buffer, cached);
    return state;
  }


}

export namespace InitializeMintInstruction {
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

export class InitializeMintInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: InitializeMintInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: InitializeMintInstruction.Params | null = null;
  private __tnTail_state_proof: Uint8Array | null = null;
  private __tnTailParams_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(141);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_mint_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_decimals(value: number): this {
    this.view.setUint8(2, value);
    this.__tnInvalidate();
    return this;
  }

  set_creator(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("creator expects 32 bytes");
    this.buffer.set(value, 3);
    this.__tnInvalidate();
    return this;
  }

  set_mint_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint_authority expects 32 bytes");
    this.buffer.set(value, 35);
    this.__tnInvalidate();
    return this;
  }

  set_freeze_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("freeze_authority expects 32 bytes");
    this.buffer.set(value, 67);
    this.__tnInvalidate();
    return this;
  }

  set_has_freeze_authority(value: number): this {
    this.view.setUint8(99, value);
    this.__tnInvalidate();
    return this;
  }

  set_ticker(value: Uint8Array): this {
    if (value.length !== 9) throw new Error("ticker expects 9 bytes");
    this.buffer.set(value, 100);
    this.__tnInvalidate();
    return this;
  }

  set_seed(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seed expects 32 bytes");
    this.buffer.set(value, 109);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "InitializeMintInstructionBuilder::state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("InitializeMintInstructionBuilder: field 'state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "InitializeMintInstructionBuilder::state_proof") !== bytes.length) throw new Error("InitializeMintInstructionBuilder: field 'state_proof' validation did not consume the full buffer");
    this.__tnTail_state_proof = bytes;
    this.__tnTailParams_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  private __tnSyncLengths(): void {
  }

  build(): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = InitializeMintInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    this.__tnSyncLengths();
    const params = this.__tnComputeParams();
    const size = InitializeMintInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("InitializeMintInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): InitializeMintInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = InitializeMintInstruction.from_array(buffer, { params });
    if (!view) throw new Error("InitializeMintInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): InitializeMintInstruction {
    return this.finish();
  }

  dynamicParams(): InitializeMintInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): InitializeMintInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = InitializeMintInstruction.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("InitializeMintInstructionBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("InitializeMintInstructionBuilder: field 'state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_state_proof_bytes = this.__tnTail_state_proof;
    if (!__tnLocal_state_proof_bytes) throw new Error("InitializeMintInstructionBuilder: field 'state_proof' must be written before build");
    target.set(__tnLocal_state_proof_bytes, cursor);
    cursor += __tnLocal_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: InitializeMintInstruction.Params): void {
    const result = InitializeMintInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ InitializeMintInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("InitializeMintInstruction", (params) => InitializeMintInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeMintInstruction", (buffer, params) => InitializeMintInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InitializeMintInstruction", (buffer) => { const result = InitializeMintInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenInstruction ----- */

const __tn_ir_TokenInstruction = {
  typeName: "TokenInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class TokenInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): TokenInstruction_payload_Inner {
    return new TokenInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenInstruction_payload_Inner {
    let descriptor: __TnVariantDescriptor | null = null;
    const tag = opts?.fieldContext?.["tag"];
    if (tag !== undefined) {
      if (__tnTagEquals(tag, 0)) descriptor = { name: "initialize_mint", tag: 0, payloadSize: null };
      if (__tnTagEquals(tag, 1)) descriptor = { name: "initialize_account", tag: 1, payloadSize: null };
      if (__tnTagEquals(tag, 2)) descriptor = { name: "transfer", tag: 2, payloadSize: 12 };
      if (__tnTagEquals(tag, 3)) descriptor = { name: "mint_to", tag: 3, payloadSize: 14 };
      if (__tnTagEquals(tag, 4)) descriptor = { name: "burn", tag: 4, payloadSize: 14 };
      if (__tnTagEquals(tag, 5)) descriptor = { name: "close_account", tag: 5, payloadSize: 6 };
      if (__tnTagEquals(tag, 6)) descriptor = { name: "freeze_account", tag: 6, payloadSize: 6 };
      if (__tnTagEquals(tag, 7)) descriptor = { name: "thaw_account", tag: 7, payloadSize: 6 };
      if (__tnTagEquals(tag, 8)) descriptor = { name: "transfer_checked", tag: 8, payloadSize: 24 };
    }
    return new TokenInstruction_payload_Inner(new Uint8Array(buffer), descriptor, opts?.fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInitializeMint(): InitializeMintInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 0)) return null;
    return InitializeMintInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInitializeAccount(): InitializeAccountInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 1)) return null;
    return InitializeAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTransfer(): TransferInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 2)) return null;
    return TransferInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMintTo(): MintToInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 3)) return null;
    return MintToInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBurn(): BurnInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 4)) return null;
    return BurnInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAccount(): CloseAccountInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 5)) return null;
    return CloseAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFreezeAccount(): FreezeAccountInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 6)) return null;
    return FreezeAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asThawAccount(): ThawAccountInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 7)) return null;
    return ThawAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTransferChecked(): TransferCheckedInstruction | null {
    if (!this.descriptor || !__tnTagEquals(this.descriptor.tag, 8)) return null;
    return TransferCheckedInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class TokenInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: TokenInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: TokenInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = TokenInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("TokenInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: TokenInstruction.Params, fieldContext?: Record<string, number | bigint> }): TokenInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("TokenInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = TokenInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("TokenInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new TokenInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): TokenInstruction.Params {
    return this.__tnParams;
  }

  static builder(): TokenInstructionBuilder {
    return new TokenInstructionBuilder();
  }

  static fromBuilder(builder: TokenInstructionBuilder): TokenInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return TokenInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "initialize_mint",
      tag: 0,
      payloadSize: null,
      payloadType: "TokenInstruction::payload::initialize_mint",
      createPayloadBuilder: () => __tnMaybeCallBuilder(InitializeMintInstruction),
    },
    {
      name: "initialize_account",
      tag: 1,
      payloadSize: null,
      payloadType: "TokenInstruction::payload::initialize_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(InitializeAccountInstruction),
    },
    {
      name: "transfer",
      tag: 2,
      payloadSize: 12,
      payloadType: "TokenInstruction::payload::transfer",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TransferInstruction),
    },
    {
      name: "mint_to",
      tag: 3,
      payloadSize: 14,
      payloadType: "TokenInstruction::payload::mint_to",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MintToInstruction),
    },
    {
      name: "burn",
      tag: 4,
      payloadSize: 14,
      payloadType: "TokenInstruction::payload::burn",
      createPayloadBuilder: () => __tnMaybeCallBuilder(BurnInstruction),
    },
    {
      name: "close_account",
      tag: 5,
      payloadSize: 6,
      payloadType: "TokenInstruction::payload::close_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CloseAccountInstruction),
    },
    {
      name: "freeze_account",
      tag: 6,
      payloadSize: 6,
      payloadType: "TokenInstruction::payload::freeze_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FreezeAccountInstruction),
    },
    {
      name: "thaw_account",
      tag: 7,
      payloadSize: 6,
      payloadType: "TokenInstruction::payload::thaw_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ThawAccountInstruction),
    },
    {
      name: "transfer_checked",
      tag: 8,
      payloadSize: 24,
      payloadType: "TokenInstruction::payload::transfer_checked",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TransferCheckedInstruction),
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: TokenInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_tag = __tnToBigInt(view.getUint8(0));
    const __tnLayout = TokenInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = TokenInstruction.Params.fromValues({
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

  payloadVariant(): typeof TokenInstruction.payloadVariantDescriptors[number] | null {
    const tag: number | bigint | null = this.get_tag();
    return TokenInstruction.payloadVariantDescriptors.find((variant) => __tnTagEquals(tag, variant.tag)) ?? null;
  }

  payload(): TokenInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("TokenInstruction: unknown payload variant");
    const offset = TokenInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("TokenInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return TokenInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_payload_size: number | bigint, payload_tag: number | bigint): bigint {
    const params = TokenInstruction.Params.fromValues({
      payload_payload_size: payload_payload_size,
      payload_tag: payload_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: TokenInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.payload_size"] = params.payload_payload_size;
    record["payload.tag"] = params.payload_tag;
    return record;
  }

  static footprintIrFromParams(params: TokenInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: TokenInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenInstruction');
    return __tnBigIntToNumber(irResult, 'TokenInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): number {
    const params = TokenInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: TokenInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: TokenInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: TokenInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenInstruction::validate') : undefined;
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
if (c + 1 > b.length) return null; const x6 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
const s7 = c;
const av8 = v; const ao9 = c;
if (c + 32 > b.length) return null; c += 32;
void s7;
const s10 = c;
const av11 = v; const ao12 = c;
if (c + 32 > b.length) return null; c += 32;
void s10;
const s13 = c;
const av14 = v; const ao15 = c;
if (c + 32 > b.length) return null; c += 32;
void s13;
if (c + 1 > b.length) return null; const x16 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
const s17 = c;
if (c + 1 > b.length) return null; const x18 = __tnU64(__tnToBigInt(v.getUint8(c))); c += 1;
const av19 = v; const ao20 = c;
if (c + 8 > b.length) return null; c += 8;
void s17;
if (c + 32 > b.length) return null; c += 32;
const s21 = c;
const s22 = c;
if (c + 8 > b.length) return null; const x23 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s24 = c;
const av25 = v; const ao26 = c;
if (c + 32 > b.length) return null; c += 32;
void s24;
void s22;
let t27: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x23, 62n), 3n)) as bigint | null) {
  case 0n: t27 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s28 = c;
const n29 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 31))))))))); if (n29 === null || n29 < 0n) return null;
if (BigInt(c) + n29 * 32n > BigInt(b.length)) return null; c += Number(n29 * 32n);
void s28;
return c; })(b.subarray(c)); break;
  case 1n: t27 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s30 = c;
const s31 = c;
const av32 = v; const ao33 = c;
if (c + 32 > b.length) return null; c += 32;
void s31;
const n34 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 31))))))))); if (n34 === null || n34 < 0n) return null;
if (BigInt(c) + n34 * 32n > BigInt(b.length)) return null; c += Number(n34 * 32n);
void s30;
return c; })(b.subarray(c)); break;
  case 2n: t27 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s35 = c;
const s36 = c;
const av37 = v; const ao38 = c;
if (c + 32 > b.length) return null; c += 32;
void s36;
const s39 = c;
const av40 = v; const ao41 = c;
if (c + 32 > b.length) return null; c += 32;
void s39;
const n42 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av25.getUint8(ao26 + 31))))))))); if (n42 === null || n42 < 0n) return null;
if (BigInt(c) + n42 * 32n > BigInt(b.length)) return null; c += Number(n42 * 32n);
void s35;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t27 === null || c + t27 > b.length) return null; c += t27;
void s21;
void s4;
return c; })(b.subarray(c)); break;
  case 1n: t3 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s43 = c;
if (c + 2 > b.length) return null; const x44 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x45 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 2 > b.length) return null; const x46 = __tnU64(__tnToBigInt(v.getUint16(c, true))); c += 2;
if (c + 32 > b.length) return null; c += 32;
const s47 = c;
const s48 = c;
if (c + 8 > b.length) return null; const x49 = __tnU64(__tnToBigInt(v.getBigUint64(c, true))); c += 8;
const s50 = c;
const av51 = v; const ao52 = c;
if (c + 32 > b.length) return null; c += 32;
void s50;
void s48;
let t53: number | null = null;
switch ((__tnU64Op("and", __tnU64Op("shr", x49, 62n), 3n)) as bigint | null) {
  case 0n: t53 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s54 = c;
const n55 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 31))))))))); if (n55 === null || n55 < 0n) return null;
if (BigInt(c) + n55 * 32n > BigInt(b.length)) return null; c += Number(n55 * 32n);
void s54;
return c; })(b.subarray(c)); break;
  case 1n: t53 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s56 = c;
const s57 = c;
const av58 = v; const ao59 = c;
if (c + 32 > b.length) return null; c += 32;
void s57;
const n60 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 31))))))))); if (n60 === null || n60 < 0n) return null;
if (BigInt(c) + n60 * 32n > BigInt(b.length)) return null; c += Number(n60 * 32n);
void s56;
return c; })(b.subarray(c)); break;
  case 2n: t53 = ((b: Uint8Array): number | null => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; const s61 = c;
const s62 = c;
const av63 = v; const ao64 = c;
if (c + 32 > b.length) return null; c += 32;
void s62;
const s65 = c;
const av66 = v; const ao67 = c;
if (c + 32 > b.length) return null; c += 32;
void s65;
const n68 = __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 0)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 1))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 2)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 3)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 4)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 5))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 6)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 7))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 8)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 9))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 10)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 11)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 12)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 13))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 14)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 15)))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 16)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 17))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 18)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 19)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 20)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 21))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 22)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 23))))))), __tnU64Op("add", __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 24)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 25))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 26)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 27)))))), __tnU64Op("add", __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 28)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 29))))), __tnU64Op("add", __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 30)))), __tnU64Unary("popcount", __tnU64(__tnToBigInt(av51.getUint8(ao52 + 31))))))))); if (n68 === null || n68 < 0n) return null;
if (BigInt(c) + n68 * 32n > BigInt(b.length)) return null; c += Number(n68 * 32n);
void s61;
return c; })(b.subarray(c)); break;
  default: return null;
}
if (t53 === null || c + t53 > b.length) return null; c += t53;
void s47;
void s43;
return c; })(b.subarray(c)); break;
  case 2n: t3 = 12; break;
  case 3n: t3 = 14; break;
  case 4n: t3 = 14; break;
  case 5n: t3 = 6; break;
  case 6n: t3 = 6; break;
  case 7n: t3 = 6; break;
  case 8n: t3 = 24; break;
  default: return null;
}
if (t3 === null || c + t3 > b.length) return null; c += t3;
void s1;
return c; })(buffer);
  }

  static from_array(buffer: Uint8Array, opts?: { params?: TokenInstruction.Params }): TokenInstruction | null {
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
    const state = new TokenInstruction(buffer, cached);
    return state;
  }


}

export namespace TokenInstruction {
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

export class TokenInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof TokenInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: TokenInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: TokenInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<TokenInstructionBuilder>;

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

  payload(): __TnVariantSelectorResult<TokenInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, TokenInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("TokenInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = TokenInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("TokenInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = TokenInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("TokenInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): TokenInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = TokenInstruction.from_array(buffer, { params });
    if (!view) throw new Error("TokenInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): TokenInstruction {
    return this.finish();
  }

  dynamicParams(): TokenInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): TokenInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = TokenInstruction.Params.fromValues({
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("TokenInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
      payload_tag: (() => { if (this.__tnField_tag === null) throw new Error("TokenInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_tag === null) throw new Error("TokenInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("TokenInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_tag);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: TokenInstruction.Params): void {
    const result = TokenInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ TokenInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("TokenInstruction", (params) => TokenInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenInstruction", (buffer, params) => TokenInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenInstruction", (buffer) => { const result = TokenInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
