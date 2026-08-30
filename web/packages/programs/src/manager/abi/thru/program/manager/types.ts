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

/* ----- TYPE DEFINITION FOR CreateEphemeralArgs ----- */

const __tn_ir_CreateEphemeralArgs = {
  typeName: "CreateEphemeralArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "seed.seed_len" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateEphemeralArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateEphemeralArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateEphemeralArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateEphemeralArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateEphemeralArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateEphemeralArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateEphemeralArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateEphemeralArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateEphemeralArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateEphemeralArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateEphemeralArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateEphemeralArgs.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateEphemeralArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreateEphemeralArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreateEphemeralArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateEphemeralArgsBuilder {
    return new CreateEphemeralArgsBuilder();
  }

  static fromBuilder(builder: CreateEphemeralArgsBuilder): CreateEphemeralArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateEphemeralArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "seed", method: "seed", sizeField: "seed_len", paramKey: "seed_len", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateEphemeralArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 20) {
      return null;
    }
    const __tnParam_seed_seed_len = __tnToBigInt(view.getUint32(16, true));
    const __tnExtractedParams = CreateEphemeralArgs.Params.fromValues({
      seed_seed_len: __tnParam_seed_seed_len,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_program_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_account_idx(): number {
    return this.get_program_account_idx();
  }

  set program_account_idx(value: number) {
    this.set_program_account_idx(value);
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

  get_seed_len(): number {
    const offset = 16;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seed_len(value: number): void {
    const offset = 16;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seed_len(): number {
    return this.get_seed_len();
  }

  set seed_len(value: number) {
    this.set_seed_len(value);
  }

  get_seed_length(): number {
    return this.__tnResolveFieldRef("seed_len");
  }

  get_seed_at(index: number): number {
    const offset = 20;
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
    const offset = 20;
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

  static footprintIr(seed_seed_len: number | bigint): bigint {
    const params = CreateEphemeralArgs.Params.fromValues({
      seed_seed_len: seed_seed_len,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateEphemeralArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["seed.seed_len"] = params.seed_seed_len;
    return record;
  }

  static footprintIrFromParams(params: CreateEphemeralArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateEphemeralArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateEphemeralArgs');
    return __tnBigIntToNumber(irResult, 'CreateEphemeralArgs::footprintFromParams');
  }

  static footprintFromValues(input: { seed_seed_len: number | bigint }): number {
    const params = CreateEphemeralArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateEphemeralArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateEphemeralArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateEphemeralArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateEphemeralArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateEphemeralArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateEphemeralArgs.Params }): CreateEphemeralArgs | null {
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
    const state = new CreateEphemeralArgs(buffer, cached);
    return state;
  }


}

export namespace CreateEphemeralArgs {
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

export class CreateEphemeralArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateEphemeralArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateEphemeralArgs.Params | null = null;
  private __tnFam_seed: Uint8Array | null = null;
  private __tnFam_seedCount: number | null = null;
  private __tnFamWriter_seed?: __TnFamWriterResult<CreateEphemeralArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(20);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_program_account_idx(value: number): this {
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

  set_seed_len(value: number): this {
    this.view.setUint32(16, value, true);
    this.__tnInvalidate();
    return this;
  }

  seed(): __TnFamWriterResult<CreateEphemeralArgsBuilder> {
    if (!this.__tnFamWriter_seed) {
      this.__tnFamWriter_seed = __tnCreateFamWriter(this, "seed", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_seed = bytes;
        this.__tnFam_seedCount = elementCount;
        this.set_seed_len(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_seed!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateEphemeralArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateEphemeralArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateEphemeralArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateEphemeralArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateEphemeralArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateEphemeralArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateEphemeralArgs {
    return this.finish();
  }

  dynamicParams(): CreateEphemeralArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateEphemeralArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateEphemeralArgs.Params.fromValues({
      seed_seed_len: (() => { if (this.__tnFam_seedCount === null) throw new Error("CreateEphemeralArgsBuilder: field 'seed' must be written before computing params"); return __tnToBigInt(this.__tnFam_seedCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_seed_bytes = this.__tnFam_seed;
    if (!__tnLocal_seed_bytes) throw new Error("CreateEphemeralArgsBuilder: field 'seed' must be written before build");
    target.set(__tnLocal_seed_bytes, cursor);
    cursor += __tnLocal_seed_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateEphemeralArgs.Params): void {
    const result = CreateEphemeralArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateEphemeralArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateEphemeralArgs", (params) => CreateEphemeralArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateEphemeralArgs", (buffer, params) => CreateEphemeralArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateEphemeralArgs", (buffer) => { const result = CreateEphemeralArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR HeaderOnlyArgs ----- */

const __tn_ir_HeaderOnlyArgs = {
  typeName: "HeaderOnlyArgs",
  root: { op: "const", value: 4n }
} as const;

export class HeaderOnlyArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): HeaderOnlyArgs {
    if (!buffer || buffer.length === undefined) throw new Error("HeaderOnlyArgs.__tnCreateView requires a Uint8Array");
    return new HeaderOnlyArgs(new Uint8Array(buffer));
  }

  static builder(): HeaderOnlyArgsBuilder {
    return new HeaderOnlyArgsBuilder();
  }

  static fromBuilder(builder: HeaderOnlyArgsBuilder): HeaderOnlyArgs | null {
    const buffer = builder.build();
    return HeaderOnlyArgs.from_array(buffer);
  }

  get_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_program_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_account_idx(): number {
    return this.get_program_account_idx();
  }

  set program_account_idx(value: number) {
    this.set_program_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_HeaderOnlyArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_HeaderOnlyArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for HeaderOnlyArgs');
    }
    return __tnBigIntToNumber(irResult, 'HeaderOnlyArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 4) return { ok: false, code: "tn.buffer_too_small", consumed: 4 };
    return { ok: true, consumed: 4 };
  }

  static new(meta_account_idx: number, program_account_idx: number): HeaderOnlyArgs {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, meta_account_idx, true); /* meta_account_idx (little-endian) */
    view.setUint16(2, program_account_idx, true); /* program_account_idx (little-endian) */

    return new HeaderOnlyArgs(buffer);
  }

  static from_array(buffer: Uint8Array): HeaderOnlyArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new HeaderOnlyArgs(buffer);
  }

}

export class HeaderOnlyArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(4);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
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

  finish(): HeaderOnlyArgs {
    const view = HeaderOnlyArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build HeaderOnlyArgs");
    return view;
  }
}

__tnRegisterFootprint("HeaderOnlyArgs", (params) => HeaderOnlyArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("HeaderOnlyArgs", (buffer, params) => HeaderOnlyArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("HeaderOnlyArgs", (buffer) => { const result = HeaderOnlyArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ManagerError ----- */

const __tn_ir_ManagerError = {
  typeName: "ManagerError",
  root: { op: "const", value: 2n }
} as const;

export class ManagerError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ManagerError {
    if (!buffer || buffer.length === undefined) throw new Error("ManagerError.__tnCreateView requires a Uint8Array");
    return new ManagerError(new Uint8Array(buffer));
  }

  static builder(): ManagerErrorBuilder {
    return new ManagerErrorBuilder();
  }

  static fromBuilder(builder: ManagerErrorBuilder): ManagerError | null {
    const buffer = builder.build();
    return ManagerError.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_ManagerError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ManagerError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ManagerError');
    }
    return __tnBigIntToNumber(irResult, 'ManagerError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 2) return { ok: false, code: "tn.buffer_too_small", consumed: 2 };
    return { ok: true, consumed: 2 };
  }

  static new(code: number): ManagerError {
    const buffer = new Uint8Array(2);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, code, true); /* code (little-endian) */

    return new ManagerError(buffer);
  }

  static from_array(buffer: Uint8Array): ManagerError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ManagerError(buffer);
  }

}

export class ManagerErrorBuilder {
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

  finish(): ManagerError {
    const view = ManagerError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ManagerError");
    return view;
  }
}

__tnRegisterFootprint("ManagerError", (params) => ManagerError.__tnInvokeFootprint(params));
__tnRegisterValidate("ManagerError", (buffer, params) => ManagerError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ManagerError", (buffer) => { const result = ManagerError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetAuthorityArgs ----- */

const __tn_ir_SetAuthorityArgs = {
  typeName: "SetAuthorityArgs",
  root: { op: "const", value: 36n }
} as const;

export class SetAuthorityArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SetAuthorityArgs {
    if (!buffer || buffer.length === undefined) throw new Error("SetAuthorityArgs.__tnCreateView requires a Uint8Array");
    return new SetAuthorityArgs(new Uint8Array(buffer));
  }

  static builder(): SetAuthorityArgsBuilder {
    return new SetAuthorityArgsBuilder();
  }

  static fromBuilder(builder: SetAuthorityArgsBuilder): SetAuthorityArgs | null {
    const buffer = builder.build();
    return SetAuthorityArgs.from_array(buffer);
  }

  get_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_program_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_account_idx(): number {
    return this.get_program_account_idx();
  }

  set program_account_idx(value: number) {
    this.set_program_account_idx(value);
  }

  get_authority_candidate(): Pubkey {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority_candidate(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
    this.buffer.set(sourceBytes, offset);
  }

  get authority_candidate(): Pubkey {
    return this.get_authority_candidate();
  }

  set authority_candidate(value: Pubkey) {
    this.set_authority_candidate(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SetAuthorityArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SetAuthorityArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SetAuthorityArgs');
    }
    return __tnBigIntToNumber(irResult, 'SetAuthorityArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 36) return { ok: false, code: "tn.buffer_too_small", consumed: 36 };
    return { ok: true, consumed: 36 };
  }

  static from_array(buffer: Uint8Array): SetAuthorityArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SetAuthorityArgs(buffer);
  }

}

export class SetAuthorityArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(36);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_candidate(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority_candidate expects 32 bytes");
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

  finish(): SetAuthorityArgs {
    const view = SetAuthorityArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetAuthorityArgs");
    return view;
  }
}

__tnRegisterFootprint("SetAuthorityArgs", (params) => SetAuthorityArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetAuthorityArgs", (buffer, params) => SetAuthorityArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetAuthorityArgs", (buffer) => { const result = SetAuthorityArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetPauseArgs ----- */

const __tn_ir_SetPauseArgs = {
  typeName: "SetPauseArgs",
  root: { op: "const", value: 5n }
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

  get_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_program_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_account_idx(): number {
    return this.get_program_account_idx();
  }

  set program_account_idx(value: number) {
    this.set_program_account_idx(value);
  }

  get_is_paused(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_is_paused(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get is_paused(): number {
    return this.get_is_paused();
  }

  set is_paused(value: number) {
    this.set_is_paused(value);
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
    if (buffer.length < 5) return { ok: false, code: "tn.buffer_too_small", consumed: 5 };
    return { ok: true, consumed: 5 };
  }

  static new(meta_account_idx: number, program_account_idx: number, is_paused: number): SetPauseArgs {
    const buffer = new Uint8Array(5);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, meta_account_idx, true); /* meta_account_idx (little-endian) */
    view.setUint16(2, program_account_idx, true); /* program_account_idx (little-endian) */
    view.setUint8(4, is_paused); /* is_paused */

    return new SetPauseArgs(buffer);
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
    this.buffer = new Uint8Array(5);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_is_paused(value: number): this {
    this.view.setUint8(4, value);
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

  finish(): SetPauseArgs {
    const view = SetPauseArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetPauseArgs");
    return view;
  }
}

__tnRegisterFootprint("SetPauseArgs", (params) => SetPauseArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetPauseArgs", (buffer, params) => SetPauseArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetPauseArgs", (buffer) => { const result = SetPauseArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpgradeArgs ----- */

const __tn_ir_UpgradeArgs = {
  typeName: "UpgradeArgs",
  root: { op: "const", value: 14n }
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

  get_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_program_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_account_idx(): number {
    return this.get_program_account_idx();
  }

  set program_account_idx(value: number) {
    this.set_program_account_idx(value);
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
    if (buffer.length < 14) return { ok: false, code: "tn.buffer_too_small", consumed: 14 };
    return { ok: true, consumed: 14 };
  }

  static new(meta_account_idx: number, program_account_idx: number, srcbuf_account_idx: number, srcbuf_offset: number, srcbuf_size: number): UpgradeArgs {
    const buffer = new Uint8Array(14);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, meta_account_idx, true); /* meta_account_idx (little-endian) */
    view.setUint16(2, program_account_idx, true); /* program_account_idx (little-endian) */
    view.setUint16(4, srcbuf_account_idx, true); /* srcbuf_account_idx (little-endian) */
    view.setUint32(6, srcbuf_offset, true); /* srcbuf_offset (little-endian) */
    view.setUint32(10, srcbuf_size, true); /* srcbuf_size (little-endian) */

    return new UpgradeArgs(buffer);
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
    this.buffer = new Uint8Array(14);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_program_account_idx(value: number): this {
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

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
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

/* ----- TYPE DEFINITION FOR ManagerProgramMeta ----- */

const __tn_ir_ManagerProgramMeta = {
  typeName: "ManagerProgramMeta",
  root: { op: "const", value: 73n }
} as const;

export class ManagerProgramMeta {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ManagerProgramMeta {
    if (!buffer || buffer.length === undefined) throw new Error("ManagerProgramMeta.__tnCreateView requires a Uint8Array");
    return new ManagerProgramMeta(new Uint8Array(buffer));
  }

  static builder(): ManagerProgramMetaBuilder {
    return new ManagerProgramMetaBuilder();
  }

  static fromBuilder(builder: ManagerProgramMetaBuilder): ManagerProgramMeta | null {
    const buffer = builder.build();
    return ManagerProgramMeta.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_ManagerProgramMeta.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ManagerProgramMeta, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ManagerProgramMeta');
    }
    return __tnBigIntToNumber(irResult, 'ManagerProgramMeta::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 73) return { ok: false, code: "tn.buffer_too_small", consumed: 73 };
    return { ok: true, consumed: 73 };
  }

  static from_array(buffer: Uint8Array): ManagerProgramMeta | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ManagerProgramMeta(buffer);
  }

}

export class ManagerProgramMetaBuilder {
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ManagerProgramMeta {
    const view = ManagerProgramMeta.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ManagerProgramMeta");
    return view;
  }
}

__tnRegisterFootprint("ManagerProgramMeta", (params) => ManagerProgramMeta.__tnInvokeFootprint(params));
__tnRegisterValidate("ManagerProgramMeta", (buffer, params) => ManagerProgramMeta.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ManagerProgramMeta", (buffer) => { const result = ManagerProgramMeta.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreatePermanentArgs ----- */

const __tn_ir_CreatePermanentArgs = {
  typeName: "CreatePermanentArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "seed.seed_len" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class CreatePermanentArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreatePermanentArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreatePermanentArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreatePermanentArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreatePermanentArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreatePermanentArgs.Params, fieldContext?: Record<string, number | bigint> }): CreatePermanentArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreatePermanentArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreatePermanentArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreatePermanentArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreatePermanentArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreatePermanentArgs.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreatePermanentArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreatePermanentArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreatePermanentArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreatePermanentArgsBuilder {
    return new CreatePermanentArgsBuilder();
  }

  static fromBuilder(builder: CreatePermanentArgsBuilder): CreatePermanentArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreatePermanentArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "seed", method: "seed", sizeField: "seed_len", paramKey: "seed_len", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_hdr_type_slot: bigint | null = null;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnFieldValue_meta_account_idx: number | null = null;
    let __tnFieldValue_program_account_idx: number | null = null;
    let __tnFieldValue_srcbuf_account_idx: number | null = null;
    let __tnFieldValue_srcbuf_offset: number | null = null;
    let __tnFieldValue_srcbuf_size: number | null = null;
    let __tnFieldValue_authority_account_idx: number | null = null;
    let __tnFieldValue_seed_len: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_meta_account_idx = __tnRead_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_program_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_program_account_idx = __tnRead_program_account_idx;
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
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_seed_len = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_seed_len = __tnRead_seed_len;
    __tnCursorMutable += 4;
    if (__tnFieldValue_seed_len === null) return null;
    const __tnArrayCount_seed = Math.trunc(Number(__tnFieldValue_seed_len));
    if (!Number.isFinite(__tnArrayCount_seed) || __tnArrayCount_seed < 0) return null;
    const __tnArrayBytes_seed = __tnArrayCount_seed * 1;
    if (__tnCursorMutable + __tnArrayBytes_seed > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_seed;
    offsets["meta_state_proof"] = __tnCursorMutable;
    const __tnTyperefResult_meta_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_meta_state_proof.ok || __tnTyperefResult_meta_state_proof.consumed === undefined) return null;
    const __tnTyperefParams_meta_state_proof = __tnTyperefResult_meta_state_proof.params ?? null;
    if (!__tnTyperefParams_meta_state_proof || __tnTyperefParams_meta_state_proof["proof_body_hdr_type_slot"] === undefined) return null;
    __tnParamSeq_proof_body_hdr_type_slot = __tnTyperefParams_meta_state_proof["proof_body_hdr_type_slot"];
    if (!__tnTyperefParams_meta_state_proof || __tnTyperefParams_meta_state_proof["proof_body_payload_size"] === undefined) return null;
    __tnParamSeq_proof_body_payload_size = __tnTyperefParams_meta_state_proof["proof_body_payload_size"];
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_meta_state_proof.consumed, "CreatePermanentArgs::meta_state_proof");
    offsets["program_state_proof"] = __tnCursorMutable;
    const __tnTyperefResult_program_state_proof = __tnInvokeDynamicValidate("StateProof", buffer.subarray(__tnCursorMutable));
    if (!__tnTyperefResult_program_state_proof.ok || __tnTyperefResult_program_state_proof.consumed === undefined) return null;
    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_program_state_proof.consumed, "CreatePermanentArgs::program_state_proof");
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_hdr_type_slot === null) return null;
    params["proof_body_hdr_type_slot"] = __tnParamSeq_proof_body_hdr_type_slot as bigint;
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreatePermanentArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 20) {
      return null;
    }
    const __tnParam_seed_seed_len = __tnToBigInt(view.getUint32(16, true));
    const __tnLayout = CreatePermanentArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_hdr_type_slot = __tnSeqParams["proof_body_hdr_type_slot"];
    if (__tnParamSeq_proof_body_hdr_type_slot === undefined) return null;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = CreatePermanentArgs.Params.fromValues({
      seed_seed_len: __tnParam_seed_seed_len,
      proof_body_hdr_type_slot: __tnParamSeq_proof_body_hdr_type_slot as bigint,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
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
      throw new Error("CreatePermanentArgs: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = CreatePermanentArgs.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("CreatePermanentArgs: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_meta_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_program_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_account_idx(): number {
    return this.get_program_account_idx();
  }

  set program_account_idx(value: number) {
    this.set_program_account_idx(value);
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

  get_seed_len(): number {
    const offset = 16;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seed_len(value: number): void {
    const offset = 16;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seed_len(): number {
    return this.get_seed_len();
  }

  set seed_len(value: number) {
    this.set_seed_len(value);
  }

  get_seed_length(): number {
    return this.__tnResolveFieldRef("seed_len");
  }

  get_seed_at(index: number): number {
    const offset = 20;
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
    const offset = 20;
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

  get_meta_state_proof(): StateProof {
    const offset = this.__tnGetDynamicOffset("meta_state_proof");
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("CreatePermanentArgs: failed to read field 'meta_state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_meta_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = this.__tnGetDynamicOffset("meta_state_proof");
    this.buffer.set(sourceBytes, offset);
  }

  get meta_state_proof(): StateProof {
    return this.get_meta_state_proof();
  }

  set meta_state_proof(value: StateProof) {
    this.set_meta_state_proof(value);
  }

  get_program_state_proof(): StateProof {
    const offset = this.__tnGetDynamicOffset("program_state_proof");
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("CreatePermanentArgs: failed to read field 'program_state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_program_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = this.__tnGetDynamicOffset("program_state_proof");
    this.buffer.set(sourceBytes, offset);
  }

  get program_state_proof(): StateProof {
    return this.get_program_state_proof();
  }

  set program_state_proof(value: StateProof) {
    this.set_program_state_proof(value);
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

  static footprintIr(seed_seed_len: number | bigint, proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = CreatePermanentArgs.Params.fromValues({
      seed_seed_len: seed_seed_len,
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreatePermanentArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["seed.seed_len"] = params.seed_seed_len;
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: CreatePermanentArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreatePermanentArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreatePermanentArgs');
    return __tnBigIntToNumber(irResult, 'CreatePermanentArgs::footprintFromParams');
  }

  static footprintFromValues(input: { seed_seed_len: number | bigint, proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = CreatePermanentArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreatePermanentArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreatePermanentArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreatePermanentArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreatePermanentArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreatePermanentArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreatePermanentArgs.Params }): CreatePermanentArgs | null {
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
    const state = new CreatePermanentArgs(buffer, cached);
    return state;
  }


}

export namespace CreatePermanentArgs {
  export type Params = {
    /** ABI path: seed.seed_len */
    readonly seed_seed_len: bigint;
    /** ABI path: proof_body.hdr.type_slot */
    readonly proof_body_hdr_type_slot: bigint;
    /** ABI path: proof_body.payload_size */
    readonly proof_body_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    seed_seed_len: "seed.seed_len",
    proof_body_hdr_type_slot: "proof_body.hdr.type_slot",
    proof_body_payload_size: "proof_body.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { seed_seed_len: number | bigint, proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
      return {
        seed_seed_len: __tnToBigInt(input.seed_seed_len),
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

  export function params(input: { seed_seed_len: number | bigint, proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreatePermanentArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreatePermanentArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreatePermanentArgs.Params | null = null;
  private __tnFam_seed: Uint8Array | null = null;
  private __tnFam_seedCount: number | null = null;
  private __tnFamWriter_seed?: __TnFamWriterResult<CreatePermanentArgsBuilder>;
  private __tnTail_meta_state_proof: Uint8Array | null = null;
  private __tnTailParams_meta_state_proof: Record<string, bigint> | null = null;
  private __tnTail_program_state_proof: Uint8Array | null = null;
  private __tnTailParams_program_state_proof: Record<string, bigint> | null = null;

  constructor() {
    this.buffer = new Uint8Array(20);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_program_account_idx(value: number): this {
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

  set_seed_len(value: number): this {
    this.view.setUint32(16, value, true);
    this.__tnInvalidate();
    return this;
  }

  seed(): __TnFamWriterResult<CreatePermanentArgsBuilder> {
    if (!this.__tnFamWriter_seed) {
      this.__tnFamWriter_seed = __tnCreateFamWriter(this, "seed", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_seed = bytes;
        this.__tnFam_seedCount = elementCount;
        this.set_seed_len(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_seed!;
  }

  set_meta_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "CreatePermanentArgsBuilder::meta_state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("CreatePermanentArgsBuilder: field 'meta_state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "CreatePermanentArgsBuilder::meta_state_proof") !== bytes.length) throw new Error("CreatePermanentArgsBuilder: field 'meta_state_proof' validation did not consume the full buffer");
    this.__tnTail_meta_state_proof = bytes;
    this.__tnTailParams_meta_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  set_program_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "CreatePermanentArgsBuilder::program_state_proof");
    const validation = __tnInvokeDynamicValidate("StateProof", bytes);
    if (!validation.ok || validation.consumed === undefined) throw new Error("CreatePermanentArgsBuilder: field 'program_state_proof' failed validation");
    if (__tnBigIntToNumber(validation.consumed, "CreatePermanentArgsBuilder::program_state_proof") !== bytes.length) throw new Error("CreatePermanentArgsBuilder: field 'program_state_proof' validation did not consume the full buffer");
    this.__tnTail_program_state_proof = bytes;
    this.__tnTailParams_program_state_proof = validation.params ?? null;
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreatePermanentArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreatePermanentArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreatePermanentArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreatePermanentArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreatePermanentArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreatePermanentArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreatePermanentArgs {
    return this.finish();
  }

  dynamicParams(): CreatePermanentArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreatePermanentArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreatePermanentArgs.Params.fromValues({
      seed_seed_len: (() => { if (this.__tnFam_seedCount === null) throw new Error("CreatePermanentArgsBuilder: field 'seed' must be written before computing params"); return __tnToBigInt(this.__tnFam_seedCount); })(),
      proof_body_hdr_type_slot: (() => { const params = this.__tnTailParams_meta_state_proof; if (!params || params["proof_body_hdr_type_slot"] === undefined) throw new Error("CreatePermanentArgsBuilder: field 'meta_state_proof' must be written before computing params"); return params["proof_body_hdr_type_slot"]; })(),
      proof_body_payload_size: (() => { const params = this.__tnTailParams_meta_state_proof; if (!params || params["proof_body_payload_size"] === undefined) throw new Error("CreatePermanentArgsBuilder: field 'meta_state_proof' must be written before computing params"); return params["proof_body_payload_size"]; })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_seed_bytes = this.__tnFam_seed;
    if (!__tnLocal_seed_bytes) throw new Error("CreatePermanentArgsBuilder: field 'seed' must be written before build");
    target.set(__tnLocal_seed_bytes, cursor);
    cursor += __tnLocal_seed_bytes.length;
    const __tnLocal_meta_state_proof_bytes = this.__tnTail_meta_state_proof;
    if (!__tnLocal_meta_state_proof_bytes) throw new Error("CreatePermanentArgsBuilder: field 'meta_state_proof' must be written before build");
    target.set(__tnLocal_meta_state_proof_bytes, cursor);
    cursor += __tnLocal_meta_state_proof_bytes.length;
    const __tnLocal_program_state_proof_bytes = this.__tnTail_program_state_proof;
    if (!__tnLocal_program_state_proof_bytes) throw new Error("CreatePermanentArgsBuilder: field 'program_state_proof' must be written before build");
    target.set(__tnLocal_program_state_proof_bytes, cursor);
    cursor += __tnLocal_program_state_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreatePermanentArgs.Params): void {
    const result = CreatePermanentArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreatePermanentArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreatePermanentArgs", (params) => CreatePermanentArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreatePermanentArgs", (buffer, params) => CreatePermanentArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreatePermanentArgs", (buffer) => { const result = CreatePermanentArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ManagerInstruction ----- */

const __tn_ir_ManagerInstruction = {
  typeName: "ManagerInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class ManagerInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): ManagerInstruction_payload_Inner {
    return new ManagerInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreatePermanent(): CreatePermanentArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return CreatePermanentArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateEphemeral(): CreateEphemeralArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return CreateEphemeralArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpgrade(): UpgradeArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return UpgradeArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetPause(): SetPauseArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return SetPauseArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asDestroy(): HeaderOnlyArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return HeaderOnlyArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFinalize(): HeaderOnlyArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 5) return null;
    return HeaderOnlyArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetAuthority(): SetAuthorityArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 6) return null;
    return SetAuthorityArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asClaimAuthority(): HeaderOnlyArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 7) return null;
    return HeaderOnlyArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class ManagerInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: ManagerInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: ManagerInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = ManagerInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("ManagerInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: ManagerInstruction.Params, fieldContext?: Record<string, number | bigint> }): ManagerInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ManagerInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = ManagerInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("ManagerInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new ManagerInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): ManagerInstruction.Params {
    return this.__tnParams;
  }

  static builder(): ManagerInstructionBuilder {
    return new ManagerInstructionBuilder();
  }

  static fromBuilder(builder: ManagerInstructionBuilder): ManagerInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return ManagerInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create_permanent",
      tag: 0,
      payloadSize: null,
      payloadType: "ManagerInstruction::payload::create_permanent",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreatePermanentArgs),
    },
    {
      name: "create_ephemeral",
      tag: 1,
      payloadSize: null,
      payloadType: "ManagerInstruction::payload::create_ephemeral",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateEphemeralArgs),
    },
    {
      name: "upgrade",
      tag: 2,
      payloadSize: 14,
      payloadType: "ManagerInstruction::payload::upgrade",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UpgradeArgs),
    },
    {
      name: "set_pause",
      tag: 3,
      payloadSize: 5,
      payloadType: "ManagerInstruction::payload::set_pause",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetPauseArgs),
    },
    {
      name: "destroy",
      tag: 4,
      payloadSize: 4,
      payloadType: "ManagerInstruction::payload::destroy",
      createPayloadBuilder: () => __tnMaybeCallBuilder(HeaderOnlyArgs),
    },
    {
      name: "finalize",
      tag: 5,
      payloadSize: 4,
      payloadType: "ManagerInstruction::payload::finalize",
      createPayloadBuilder: () => __tnMaybeCallBuilder(HeaderOnlyArgs),
    },
    {
      name: "set_authority",
      tag: 6,
      payloadSize: 36,
      payloadType: "ManagerInstruction::payload::set_authority",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetAuthorityArgs),
    },
    {
      name: "claim_authority",
      tag: 7,
      payloadSize: 4,
      payloadType: "ManagerInstruction::payload::claim_authority",
      createPayloadBuilder: () => __tnMaybeCallBuilder(HeaderOnlyArgs),
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
    switch (Number(__tnEnumTagValue_payload)) {
      case 0: break;
      case 1: break;
      case 2: break;
      case 3: break;
      case 4: break;
      case 5: break;
      case 6: break;
      case 7: break;
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: ManagerInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_tag = __tnToBigInt(view.getUint8(0));
    const __tnLayout = ManagerInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = ManagerInstruction.Params.fromValues({
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

  payloadVariant(): typeof ManagerInstruction.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return ManagerInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): ManagerInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("ManagerInstruction: unknown payload variant");
    const offset = ManagerInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("ManagerInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return ManagerInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ManagerInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ManagerInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_payload_size: number | bigint, payload_tag: number | bigint): bigint {
    const params = ManagerInstruction.Params.fromValues({
      payload_payload_size: payload_payload_size,
      payload_tag: payload_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: ManagerInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.payload_size"] = params.payload_payload_size;
    record["payload.tag"] = params.payload_tag;
    return record;
  }

  static footprintIrFromParams(params: ManagerInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: ManagerInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ManagerInstruction');
    return __tnBigIntToNumber(irResult, 'ManagerInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): number {
    const params = ManagerInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: ManagerInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: ManagerInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: ManagerInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ManagerInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ManagerInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: ManagerInstruction.Params }): ManagerInstruction | null {
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
    const state = new ManagerInstruction(buffer, cached);
    return state;
  }


}

export namespace ManagerInstruction {
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

export class ManagerInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof ManagerInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: ManagerInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: ManagerInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<ManagerInstructionBuilder>;

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

  payload(): __TnVariantSelectorResult<ManagerInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, ManagerInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("ManagerInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ManagerInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = ManagerInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("ManagerInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ManagerInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = ManagerInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("ManagerInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): ManagerInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = ManagerInstruction.from_array(buffer, { params });
    if (!view) throw new Error("ManagerInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): ManagerInstruction {
    return this.finish();
  }

  dynamicParams(): ManagerInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): ManagerInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = ManagerInstruction.Params.fromValues({
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("ManagerInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
      payload_tag: (() => { if (this.__tnField_tag === null) throw new Error("ManagerInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_tag === null) throw new Error("ManagerInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ManagerInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_tag);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: ManagerInstruction.Params): void {
    const result = ManagerInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ ManagerInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("ManagerInstruction", (params) => ManagerInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ManagerInstruction", (buffer, params) => ManagerInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ManagerInstruction", (buffer) => { const result = ManagerInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
