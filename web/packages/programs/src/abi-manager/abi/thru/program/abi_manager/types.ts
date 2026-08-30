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
      readonly cases: readonly { readonly value: number; readonly node: __TnIrNode }[];
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
  readonly tag: number;
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

function __tnPopcount(value: number | bigint): number {
  let v =
    typeof value === "bigint"
      ? Number(value & BigInt(0xffffffff))
      : Number(value) >>> 0;
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
    if (result < BigInt(0)) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected negative size via addition"
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
    if (result < BigInt(0)) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected negative size via multiplication"
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
  const amount = __tnBigIntToNumber(rhs, "IR shift amount");
  if (amount < 0 || amount >= 64 || !Number.isInteger(amount)) {
    __tnRaiseIrError("tn.ir.overflow", "IR runtime invalid shift amount");
  }
  if (__tnHasNativeBigInt) {
    const shift = BigInt(amount);
    return direction === "left" ? (lhs as bigint) << shift : (lhs as bigint) >> shift;
  }
  const value = lhs as unknown as number;
  const result = direction === "left" ? value * 2 ** amount : Math.floor(value / 2 ** amount);
  if (!Number.isSafeInteger(result)) {
    __tnWarnOnce("[thru-net] Precision loss while polyfilling BigInt shift");
  }
  return (result as unknown) as bigint;
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
      return val;
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
    case "mul":
      return __tnCheckedMul(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
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
      const tagVal = ctx.params[node.tag];
      if (tagVal === undefined) {
        const prefix = ctx.typeName ? `${ctx.typeName}: ` : "";
        __tnRaiseIrError(
          "tn.ir.missing_param",
          `${prefix}Missing IR switch tag '${node.tag}'`
        );
      }
      const tagNumber = Number(tagVal);
      for (const caseNode of node.cases) {
        if (caseNode.value === tagNumber) {
          return __tnEvalIrNode(caseNode.node, ctx, baseOffset);
        }
      }
      if (node.default) return __tnEvalIrNode(node.default, ctx, baseOffset);
      __tnRaiseIrError(
        "tn.ir.invalid_tag",
        `Unhandled IR switch value ${tagNumber} for '${node.tag}'`
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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

/* ----- TYPE DEFINITION FOR CreateAbiExternalEphemeralArgs ----- */

const __tn_ir_CreateAbiExternalEphemeralArgs = {
  typeName: "CreateAbiExternalEphemeralArgs",
  root: { op: "const", value: 16n }
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

  get_authority_account_idx(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 14;
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
    if (buffer.length < 16) return { ok: false, code: "tn.buffer_too_small", consumed: 16 };
    return { ok: true, consumed: 16 };
  }

  static new(abi_meta_account_idx: number, abi_account_idx: number, srcbuf_account_idx: number, srcbuf_offset: number, srcbuf_size: number, authority_account_idx: number): CreateAbiExternalEphemeralArgs {
    const buffer = new Uint8Array(16);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(4, srcbuf_account_idx, true); /* srcbuf_account_idx (little-endian) */
    view.setUint32(6, srcbuf_offset, true); /* srcbuf_offset (little-endian) */
    view.setUint32(10, srcbuf_size, true); /* srcbuf_size (little-endian) */
    view.setUint16(14, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new CreateAbiExternalEphemeralArgs(buffer);
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
    this.buffer = new Uint8Array(16);
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

  set_authority_account_idx(value: number): this {
    this.view.setUint16(14, value, true);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
  root: { op: "const", value: 18n }
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

  get_authority_account_idx(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 16;
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
    if (buffer.length < 18) return { ok: false, code: "tn.buffer_too_small", consumed: 18 };
    return { ok: true, consumed: 18 };
  }

  static new(abi_meta_account_idx: number, program_meta_account_idx: number, abi_account_idx: number, srcbuf_account_idx: number, srcbuf_offset: number, srcbuf_size: number, authority_account_idx: number): CreateAbiOfficialEphemeralArgs {
    const buffer = new Uint8Array(18);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, program_meta_account_idx, true); /* program_meta_account_idx (little-endian) */
    view.setUint16(4, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(6, srcbuf_account_idx, true); /* srcbuf_account_idx (little-endian) */
    view.setUint32(8, srcbuf_offset, true); /* srcbuf_offset (little-endian) */
    view.setUint32(12, srcbuf_size, true); /* srcbuf_size (little-endian) */
    view.setUint16(16, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new CreateAbiOfficialEphemeralArgs(buffer);
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
    this.buffer = new Uint8Array(18);
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

  set_authority_account_idx(value: number): this {
    this.view.setUint16(16, value, true);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
  root: { op: "const", value: 16n }
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

  get_authority_account_idx(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 14;
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
    if (buffer.length < 16) return { ok: false, code: "tn.buffer_too_small", consumed: 16 };
    return { ok: true, consumed: 16 };
  }

  static new(abi_meta_account_idx: number, abi_account_idx: number, srcbuf_account_idx: number, srcbuf_offset: number, srcbuf_size: number, authority_account_idx: number): UpgradeAbiExternalArgs {
    const buffer = new Uint8Array(16);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(4, srcbuf_account_idx, true); /* srcbuf_account_idx (little-endian) */
    view.setUint32(6, srcbuf_offset, true); /* srcbuf_offset (little-endian) */
    view.setUint32(10, srcbuf_size, true); /* srcbuf_size (little-endian) */
    view.setUint16(14, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new UpgradeAbiExternalArgs(buffer);
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
    this.buffer = new Uint8Array(16);
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

  set_authority_account_idx(value: number): this {
    this.view.setUint16(14, value, true);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
  root: { op: "const", value: 18n }
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

  get_authority_account_idx(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 16;
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
    if (buffer.length < 18) return { ok: false, code: "tn.buffer_too_small", consumed: 18 };
    return { ok: true, consumed: 18 };
  }

  static new(abi_meta_account_idx: number, program_meta_account_idx: number, abi_account_idx: number, srcbuf_account_idx: number, srcbuf_offset: number, srcbuf_size: number, authority_account_idx: number): UpgradeAbiOfficialArgs {
    const buffer = new Uint8Array(18);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, abi_meta_account_idx, true); /* abi_meta_account_idx (little-endian) */
    view.setUint16(2, program_meta_account_idx, true); /* program_meta_account_idx (little-endian) */
    view.setUint16(4, abi_account_idx, true); /* abi_account_idx (little-endian) */
    view.setUint16(6, srcbuf_account_idx, true); /* srcbuf_account_idx (little-endian) */
    view.setUint32(8, srcbuf_offset, true); /* srcbuf_offset (little-endian) */
    view.setUint32(12, srcbuf_size, true); /* srcbuf_size (little-endian) */
    view.setUint16(16, authority_account_idx, true); /* authority_account_idx (little-endian) */

    return new UpgradeAbiOfficialArgs(buffer);
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
    this.buffer = new Uint8Array(18);
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

  set_authority_account_idx(value: number): this {
    this.view.setUint16(16, value, true);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 32n } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "contents.content_sz" }, right: { op: "const", value: 1n } } } } }
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

  private __tnResolveFieldRef(path: string): number {
    const getterName = `get_${path.replace(/[.]/g, '_')}`;
    const getter = (this as any)[getterName];
    if (typeof getter === "function") {
      const value = getter.call(this);
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "AbiAccount::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "AbiAccount::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("AbiAccount: field reference '" + path + "' is not available; provide fieldContext when creating this view");
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
    return this.__tnResolveFieldRef("content_sz");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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

/* ----- TYPE DEFINITION FOR AbiMetaBody ----- */

const __tn_ir_AbiMetaBody = {
  typeName: "AbiMetaBody",
  root: { op: "const", value: 96n }
} as const;

export class AbiMetaBody {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  /* Union field accessors would go here */

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

    return new AbiMetaBody(buffer);
  }

}

__tnRegisterFootprint("AbiMetaBody", (params) => AbiMetaBody.__tnInvokeFootprint(params));
__tnRegisterValidate("AbiMetaBody", (buffer, params) => AbiMetaBody.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AbiMetaBody", (buffer) => { const result = AbiMetaBody.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateAbiExternalPermanentArgs ----- */

const __tn_ir_CreateAbiExternalPermanentArgs = {
  typeName: "CreateAbiExternalPermanentArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
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

  get_authority_account_idx(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 14;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_state_proof(): StateProof {
    const offset = 16;
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
    const offset = 16;
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
      return { ok: false, code: "tn.param_extraction_failed" };
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiExternalPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiExternalPermanentArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateAbiExternalPermanentArgs.Params }): CreateAbiExternalPermanentArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      __tnLogWarn('CreateAbiExternalPermanentArgs::from_array requires params when IR extraction is unavailable');
      return null;
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
    this.buffer = new Uint8Array(16);
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

  set_authority_account_idx(value: number): this {
    this.view.setUint16(14, value, true);
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
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
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

  get_authority_account_idx(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 16;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_state_proof(): StateProof {
    const offset = 18;
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
    const offset = 18;
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
      return { ok: false, code: "tn.param_extraction_failed" };
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiOfficialPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAbiOfficialPermanentArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateAbiOfficialPermanentArgs.Params }): CreateAbiOfficialPermanentArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      __tnLogWarn('CreateAbiOfficialPermanentArgs::from_array requires params when IR extraction is unavailable');
      return null;
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
    this.buffer = new Uint8Array(18);
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

  set_authority_account_idx(value: number): this {
    this.view.setUint16(16, value, true);
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
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
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
      return { ok: false, code: "tn.param_extraction_failed" };
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaExternalPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaExternalPermanentArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateMetaExternalPermanentArgs.Params }): CreateMetaExternalPermanentArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      __tnLogWarn('CreateMetaExternalPermanentArgs::from_array requires params when IR extraction is unavailable');
      return null;
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
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
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
      return { ok: false, code: "tn.param_extraction_failed" };
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaOfficialPermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateMetaOfficialPermanentArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateMetaOfficialPermanentArgs.Params }): CreateMetaOfficialPermanentArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      __tnLogWarn('CreateMetaOfficialPermanentArgs::from_array requires params when IR extraction is unavailable');
      return null;
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

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreateMetaOfficialPermanent(): CreateMetaOfficialPermanentArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return CreateMetaOfficialPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateMetaOfficialEphemeral(): CreateMetaOfficialEphemeralArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return CreateMetaOfficialEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateMetaExternalPermanent(): CreateMetaExternalPermanentArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return CreateMetaExternalPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateMetaExternalEphemeral(): CreateMetaExternalEphemeralArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return CreateMetaExternalEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiOfficialPermanent(): CreateAbiOfficialPermanentArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return CreateAbiOfficialPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiOfficialEphemeral(): CreateAbiOfficialEphemeralArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 5) return null;
    return CreateAbiOfficialEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiExternalPermanent(): CreateAbiExternalPermanentArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 6) return null;
    return CreateAbiExternalPermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAbiExternalEphemeral(): CreateAbiExternalEphemeralArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 7) return null;
    return CreateAbiExternalEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgradeAbiOfficial(): UpgradeAbiOfficialArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 8) return null;
    return UpgradeAbiOfficialArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgradeAbiExternal(): UpgradeAbiExternalArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 9) return null;
    return UpgradeAbiExternalArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAbiOfficial(): CloseAbiOfficialArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 10) return null;
    return CloseAbiOfficialArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAbiExternal(): CloseAbiExternalArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 11) return null;
    return CloseAbiExternalArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFinalizeAbiOfficial(): FinalizeAbiOfficialArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 12) return null;
    return FinalizeAbiOfficialArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFinalizeAbiExternal(): FinalizeAbiExternalArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 13) return null;
    return FinalizeAbiExternalArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
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
      payloadSize: 18,
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
      payloadSize: 16,
      payloadType: "AbiManagerInstruction::payload::create_abi_external_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateAbiExternalEphemeralArgs),
    },
    {
      name: "upgrade_abi_official",
      tag: 8,
      payloadSize: 18,
      payloadType: "AbiManagerInstruction::payload::upgrade_abi_official",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UpgradeAbiOfficialArgs),
    },
    {
      name: "upgrade_abi_external",
      tag: 9,
      payloadSize: 16,
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
    switch (Number(__tnEnumTagValue_payload)) {
      case 0: break;
      case 1: break;
      case 2: break;
      case 3: break;
      case 4: break;
      case 5: break;
      case 6: break;
      case 7: break;
      case 8: break;
      case 9: break;
      case 10: break;
      case 11: break;
      case 12: break;
      case 13: break;
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
    const tag = this.view.getUint8(0);
    return AbiManagerInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
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
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiManagerInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AbiManagerInstruction::validate') : undefined;
    return { ok: true, consumed, params };
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
  root: { op: "const", value: 100n }
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

  get_version(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_version(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get version(): number {
    return this.get_version();
  }

  set version(value: number) {
    this.set_version(value);
  }

  get_kind(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_kind(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get kind(): number {
    return this.get_kind();
  }

  set kind(value: number) {
    this.set_kind(value);
  }

  get_flags(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_flags(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get flags(): number {
    return this.get_flags();
  }

  set flags(value: number) {
    this.set_flags(value);
  }

  get_body(): AbiMetaBody {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 96);
    return AbiMetaBody.from_array(slice)!;
  }

  set_body(value: AbiMetaBody): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
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
    if (buffer.length < 100) return { ok: false, code: "tn.buffer_too_small", consumed: 100 };
    return { ok: true, consumed: 100 };
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
    this.buffer = new Uint8Array(100);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_version(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_kind(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_flags(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_body(value: Uint8Array): this {
    if (value.length !== 96) throw new Error("body expects 96 bytes");
    this.buffer.set(value, 4);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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
