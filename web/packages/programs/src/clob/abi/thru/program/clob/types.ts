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

/* ----- TYPE DEFINITION FOR ArenaHeader ----- */

const __tn_ir_ArenaHeader = {
  typeName: "ArenaHeader",
  root: { op: "const", value: 64n }
} as const;

export class ArenaHeader {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ArenaHeader {
    if (!buffer || buffer.length === undefined) throw new Error("ArenaHeader.__tnCreateView requires a Uint8Array");
    return new ArenaHeader(new Uint8Array(buffer));
  }

  static builder(): ArenaHeaderBuilder {
    return new ArenaHeaderBuilder();
  }

  static fromBuilder(builder: ArenaHeaderBuilder): ArenaHeader | null {
    const buffer = builder.build();
    return ArenaHeader.from_array(buffer);
  }

  get_reserved0(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 52; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 0;
    if (value.length !== 52) {
      throw new Error('Array length must be 52');
    }
    for (let i = 0; i < 52; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_next_entry_idx(): number {
    const offset = 52;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_next_entry_idx(value: number): void {
    const offset = 52;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get next_entry_idx(): number {
    return this.get_next_entry_idx();
  }

  set next_entry_idx(value: number) {
    this.set_next_entry_idx(value);
  }

  get_free_magic(): bigint {
    const offset = 56;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_free_magic(value: bigint): void {
    const offset = 56;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get free_magic(): bigint {
    return this.get_free_magic();
  }

  set free_magic(value: bigint) {
    this.set_free_magic(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ArenaHeader.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ArenaHeader, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ArenaHeader');
    }
    return __tnBigIntToNumber(irResult, 'ArenaHeader::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 64) return { ok: false, code: "tn.buffer_too_small", consumed: 64 };
    return { ok: true, consumed: 64 };
  }

  static from_array(buffer: Uint8Array): ArenaHeader | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ArenaHeader(buffer);
  }

}

export class ArenaHeaderBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(64);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 52) throw new Error("reserved0 expects 52 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_next_entry_idx(value: number): this {
    this.view.setUint32(52, value, true);
    return this;
  }

  set_free_magic(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(56, cast, true);
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

  finish(): ArenaHeader {
    const view = ArenaHeader.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ArenaHeader");
    return view;
  }
}

__tnRegisterFootprint("ArenaHeader", (params) => ArenaHeader.__tnInvokeFootprint(params));
__tnRegisterValidate("ArenaHeader", (buffer, params) => ArenaHeader.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ArenaHeader", (buffer) => { const result = ArenaHeader.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CbookHeader ----- */

const __tn_ir_CbookHeader = {
  typeName: "CbookHeader",
  root: { op: "const", value: 16n }
} as const;

export class CbookHeader {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CbookHeader {
    if (!buffer || buffer.length === undefined) throw new Error("CbookHeader.__tnCreateView requires a Uint8Array");
    return new CbookHeader(new Uint8Array(buffer));
  }

  static builder(): CbookHeaderBuilder {
    return new CbookHeaderBuilder();
  }

  static fromBuilder(builder: CbookHeaderBuilder): CbookHeader | null {
    const buffer = builder.build();
    return CbookHeader.from_array(buffer);
  }

  get_reserved0(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 0;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_best_level_idx(): number {
    const offset = 4;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_best_level_idx(value: number): void {
    const offset = 4;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get best_level_idx(): number {
    return this.get_best_level_idx();
  }

  set best_level_idx(value: number) {
    this.set_best_level_idx(value);
  }

  get_best_price_in_ticks(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_best_price_in_ticks(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get best_price_in_ticks(): bigint {
    return this.get_best_price_in_ticks();
  }

  set best_price_in_ticks(value: bigint) {
    this.set_best_price_in_ticks(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CbookHeader.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CbookHeader, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CbookHeader');
    }
    return __tnBigIntToNumber(irResult, 'CbookHeader::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 16) return { ok: false, code: "tn.buffer_too_small", consumed: 16 };
    return { ok: true, consumed: 16 };
  }

  static from_array(buffer: Uint8Array): CbookHeader | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CbookHeader(buffer);
  }

}

export class CbookHeaderBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(16);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved0 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_best_level_idx(value: number): this {
    this.view.setUint32(4, value, true);
    return this;
  }

  set_best_price_in_ticks(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
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

  finish(): CbookHeader {
    const view = CbookHeader.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CbookHeader");
    return view;
  }
}

__tnRegisterFootprint("CbookHeader", (params) => CbookHeader.__tnInvokeFootprint(params));
__tnRegisterValidate("CbookHeader", (buffer, params) => CbookHeader.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CbookHeader", (buffer) => { const result = CbookHeader.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CbookLevel ----- */

const __tn_ir_CbookLevel = {
  typeName: "CbookLevel",
  root: { op: "const", value: 8n }
} as const;

export class CbookLevel {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CbookLevel {
    if (!buffer || buffer.length === undefined) throw new Error("CbookLevel.__tnCreateView requires a Uint8Array");
    return new CbookLevel(new Uint8Array(buffer));
  }

  static builder(): CbookLevelBuilder {
    return new CbookLevelBuilder();
  }

  static fromBuilder(builder: CbookLevelBuilder): CbookLevel | null {
    const buffer = builder.build();
    return CbookLevel.from_array(buffer);
  }

  get_head_entry_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_head_entry_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get head_entry_idx(): number {
    return this.get_head_entry_idx();
  }

  set head_entry_idx(value: number) {
    this.set_head_entry_idx(value);
  }

  get_tail_entry_idx(): number {
    const offset = 4;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_tail_entry_idx(value: number): void {
    const offset = 4;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get tail_entry_idx(): number {
    return this.get_tail_entry_idx();
  }

  set tail_entry_idx(value: number) {
    this.set_tail_entry_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CbookLevel.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CbookLevel, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CbookLevel');
    }
    return __tnBigIntToNumber(irResult, 'CbookLevel::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(head_entry_idx: number, tail_entry_idx: number): CbookLevel {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint32(0, head_entry_idx, true); /* head_entry_idx (little-endian) */
    view.setUint32(4, tail_entry_idx, true); /* tail_entry_idx (little-endian) */

    return new CbookLevel(buffer);
  }

  static from_array(buffer: Uint8Array): CbookLevel | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CbookLevel(buffer);
  }

}

export class CbookLevelBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_head_entry_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_tail_entry_idx(value: number): this {
    this.view.setUint32(4, value, true);
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

  finish(): CbookLevel {
    const view = CbookLevel.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CbookLevel");
    return view;
  }
}

__tnRegisterFootprint("CbookLevel", (params) => CbookLevel.__tnInvokeFootprint(params));
__tnRegisterValidate("CbookLevel", (buffer, params) => CbookLevel.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CbookLevel", (buffer) => { const result = CbookLevel.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ClientId ----- */

const __tn_ir_ClientId = {
  typeName: "ClientId",
  root: { op: "const", value: 16n }
} as const;

export class ClientId {
  private view: DataView;
  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  private static readonly __tnElementSize = 1;
  private static readonly __tnElementCount: number | null = 16;

  get length(): number {
    const explicit = ClientId.__tnElementCount;
    if (explicit !== null) {
      return explicit;
    }
    const stride = ClientId.__tnElementSize;
    if (stride > 0) {
      return Math.floor(this.buffer.length / stride);
    }
    return this.buffer.length;
  }

  getElementBytes(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError('ClientId::getElementBytes index must be a non-negative integer');
    }
    const stride = ClientId.__tnElementSize;
    if (stride <= 0) {
      throw new Error('ClientId::getElementBytes requires constant element size');
    }
    const start = index * stride;
    const end = start + stride;
    if (end > this.buffer.length) {
      throw new RangeError('ClientId::getElementBytes out of bounds');
    }
    return this.buffer.subarray(start, end);
  }

  static from_array(buffer: Uint8Array): ClientId | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const validation = ClientId.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ClientId(buffer);
  }

  asUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ClientId.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ClientId, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ClientId');
    }
    return __tnBigIntToNumber(irResult, 'ClientId::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 16) return { ok: false, code: "tn.buffer_too_small", consumed: 16 };
    return { ok: true, consumed: 16 };
  }

}

__tnRegisterFootprint("ClientId", (params) => ClientId.__tnInvokeFootprint(params));
__tnRegisterValidate("ClientId", (buffer, params) => ClientId.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ClientId", (buffer) => { const result = ClientId.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ClobError ----- */

const __tn_ir_ClobError = {
  typeName: "ClobError",
  root: { op: "const", value: 8n }
} as const;

export class ClobError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ClobError {
    if (!buffer || buffer.length === undefined) throw new Error("ClobError.__tnCreateView requires a Uint8Array");
    return new ClobError(new Uint8Array(buffer));
  }

  static builder(): ClobErrorBuilder {
    return new ClobErrorBuilder();
  }

  static fromBuilder(builder: ClobErrorBuilder): ClobError | null {
    const buffer = builder.build();
    return ClobError.from_array(buffer);
  }

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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ClobError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ClobError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ClobError');
    }
    return __tnBigIntToNumber(irResult, 'ClobError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(code: bigint): ClobError {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, code, true); /* code (little-endian) */

    return new ClobError(buffer);
  }

  static from_array(buffer: Uint8Array): ClobError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ClobError(buffer);
  }

}

export class ClobErrorBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_code(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
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

  finish(): ClobError {
    const view = ClobError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ClobError");
    return view;
  }
}

__tnRegisterFootprint("ClobError", (params) => ClobError.__tnInvokeFootprint(params));
__tnRegisterValidate("ClobError", (buffer, params) => ClobError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ClobError", (buffer) => { const result = ClobError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateOrderEntryInstruction ----- */

const __tn_ir_CreateOrderEntryInstruction = {
  typeName: "CreateOrderEntryInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 5n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "mul", left: { op: "bitAnd", left: { op: "rightShift", left: { op: "field", param: "client_id.instruction_flags" }, right: { op: "const", value: 6n } }, right: { op: "const", value: 1n } }, right: { op: "const", value: 16n } }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateOrderEntryInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateOrderEntryInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: CreateOrderEntryInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateOrderEntryInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateOrderEntryInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateOrderEntryInstruction.Params, fieldContext?: Record<string, number | bigint> }): CreateOrderEntryInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("CreateOrderEntryInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateOrderEntryInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateOrderEntryInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateOrderEntryInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateOrderEntryInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateOrderEntryInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreateOrderEntryInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreateOrderEntryInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateOrderEntryInstructionBuilder {
    return new CreateOrderEntryInstructionBuilder();
  }

  static fromBuilder(builder: CreateOrderEntryInstructionBuilder): CreateOrderEntryInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateOrderEntryInstruction.from_array(buffer, { params });
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateOrderEntryInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_client_id_instruction_flags = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = CreateOrderEntryInstruction.Params.fromValues({
      client_id_instruction_flags: __tnParam_client_id_instruction_flags,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_instruction_flags(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_instruction_flags(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get instruction_flags(): number {
    return this.get_instruction_flags();
  }

  set instruction_flags(value: number) {
    this.set_instruction_flags(value);
  }

  get_market_record_idx(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
  }

  get_reserved0(): number[] {
    const offset = 2;
    const result: number[] = [];
    for (let i = 0; i < 5; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 2;
    if (value.length !== 5) {
      throw new Error('Array length must be 5');
    }
    for (let i = 0; i < 5; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_price(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_quantity(): bigint {
    const offset = 15;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity(value: bigint): void {
    const offset = 15;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity(): bigint {
    return this.get_quantity();
  }

  set quantity(value: bigint) {
    this.set_quantity(value);
  }

  get_exp_time(): bigint {
    const offset = 23;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_exp_time(value: bigint): void {
    const offset = 23;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get exp_time(): bigint {
    return this.get_exp_time();
  }

  set exp_time(value: bigint) {
    this.set_exp_time(value);
  }

  get_client_id_length(): number {
    return (((this.__tnResolveFieldRef("instruction_flags") >> 6) & 1) * 16);
  }

  get_client_id_at(index: number): number {
    const offset = 31;
    return this.view.getUint8(offset + index * 1);
  }

  get_client_id(): number[] {
    const len = this.get_client_id_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_client_id_at(i));
    }
    return result;
  }

  set_client_id_at(index: number, value: number): void {
    const offset = 31;
    this.view.setUint8((offset + index * 1), value);
  }

  set_client_id(value: number[]): void {
    const len = Math.min(this.get_client_id_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_client_id_at(i, value[i]);
    }
  }

  get client_id(): number[] {
    return this.get_client_id();
  }

  set client_id(value: number[]) {
    this.set_client_id(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateOrderEntryInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateOrderEntryInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(client_id_instruction_flags: number | bigint): bigint {
    const params = CreateOrderEntryInstruction.Params.fromValues({
      client_id_instruction_flags: client_id_instruction_flags,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateOrderEntryInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["client_id.instruction_flags"] = params.client_id_instruction_flags;
    return record;
  }

  static footprintIrFromParams(params: CreateOrderEntryInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateOrderEntryInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateOrderEntryInstruction');
    return __tnBigIntToNumber(irResult, 'CreateOrderEntryInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { client_id_instruction_flags: number | bigint }): number {
    const params = CreateOrderEntryInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateOrderEntryInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateOrderEntryInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateOrderEntryInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateOrderEntryInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateOrderEntryInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateOrderEntryInstruction.Params }): CreateOrderEntryInstruction | null {
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
    const state = new CreateOrderEntryInstruction(buffer, cached);
    return state;
  }


}

export namespace CreateOrderEntryInstruction {
  export type Params = {
    /** ABI path: client_id.instruction_flags */
    readonly client_id_instruction_flags: bigint;
  };

  export const ParamKeys = Object.freeze({
    client_id_instruction_flags: "client_id.instruction_flags",
  } as const);

  export const Params = {
    fromValues(input: { client_id_instruction_flags: number | bigint }): Params {
      return {
        client_id_instruction_flags: __tnToBigInt(input.client_id_instruction_flags),
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

  export function params(input: { client_id_instruction_flags: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateOrderEntryInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateOrderEntryInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateOrderEntryInstruction.Params | null = null;
  private __tnTail_client_id: Uint8Array | null = null;
  private __tnTailWriter_client_id?: __TnFamWriterResult<CreateOrderEntryInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(31);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_instruction_flags(value: number): this {
    this.view.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(1, value);
    this.__tnInvalidate();
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 5) throw new Error("reserved0 expects 5 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 2 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_quantity(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(15, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_exp_time(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(23, cast, true);
    this.__tnInvalidate();
    return this;
  }

  client_id(): __TnFamWriterResult<CreateOrderEntryInstructionBuilder> {
    if (!this.__tnTailWriter_client_id) {
      this.__tnTailWriter_client_id = __tnCreateFamWriter(this, "client_id", (payload) => {
        const bytes = new Uint8Array(payload);
        this.__tnTail_client_id = bytes;
        this.__tnInvalidate();
      });
    }
    return this.__tnTailWriter_client_id!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateOrderEntryInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateOrderEntryInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateOrderEntryInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateOrderEntryInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateOrderEntryInstruction.from_array(buffer, { params });
    if (!view) throw new Error("CreateOrderEntryInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateOrderEntryInstruction {
    return this.finish();
  }

  dynamicParams(): CreateOrderEntryInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateOrderEntryInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateOrderEntryInstruction.Params.fromValues({
      client_id_instruction_flags: (() => { return __tnToBigInt(this.view.getUint8(0)); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_client_id_bytes = this.__tnTail_client_id;
    const __tnExpected_client_id_bytes = (((this.view.getUint8(0) >> 6) & 1) * 16);
    if (__tnExpected_client_id_bytes > 0 && !__tnLocal_client_id_bytes) throw new Error("CreateOrderEntryInstructionBuilder: field 'client_id' must be written before build");
    if (__tnLocal_client_id_bytes && __tnLocal_client_id_bytes.length !== __tnExpected_client_id_bytes) throw new Error("CreateOrderEntryInstructionBuilder: field 'client_id' length does not match dynamic layout");
    if (__tnLocal_client_id_bytes) {
      target.set(__tnLocal_client_id_bytes, cursor);
      cursor += __tnLocal_client_id_bytes.length;
    }
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateOrderEntryInstruction.Params): void {
    const result = CreateOrderEntryInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateOrderEntryInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateOrderEntryInstruction", (params) => CreateOrderEntryInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateOrderEntryInstruction", (buffer, params) => CreateOrderEntryInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateOrderEntryInstruction", (buffer) => { const result = CreateOrderEntryInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateSeatlessOrderEntryInstruction ----- */

const __tn_ir_CreateSeatlessOrderEntryInstruction = {
  typeName: "CreateSeatlessOrderEntryInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 5n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "mul", left: { op: "bitAnd", left: { op: "rightShift", left: { op: "field", param: "client_id.instruction_flags" }, right: { op: "const", value: 6n } }, right: { op: "const", value: 1n } }, right: { op: "const", value: 16n } }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateSeatlessOrderEntryInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateSeatlessOrderEntryInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: CreateSeatlessOrderEntryInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateSeatlessOrderEntryInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateSeatlessOrderEntryInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateSeatlessOrderEntryInstruction.Params, fieldContext?: Record<string, number | bigint> }): CreateSeatlessOrderEntryInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("CreateSeatlessOrderEntryInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateSeatlessOrderEntryInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateSeatlessOrderEntryInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateSeatlessOrderEntryInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateSeatlessOrderEntryInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateSeatlessOrderEntryInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreateSeatlessOrderEntryInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreateSeatlessOrderEntryInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateSeatlessOrderEntryInstructionBuilder {
    return new CreateSeatlessOrderEntryInstructionBuilder();
  }

  static fromBuilder(builder: CreateSeatlessOrderEntryInstructionBuilder): CreateSeatlessOrderEntryInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateSeatlessOrderEntryInstruction.from_array(buffer, { params });
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateSeatlessOrderEntryInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_client_id_instruction_flags = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = CreateSeatlessOrderEntryInstruction.Params.fromValues({
      client_id_instruction_flags: __tnParam_client_id_instruction_flags,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_instruction_flags(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_instruction_flags(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get instruction_flags(): number {
    return this.get_instruction_flags();
  }

  set instruction_flags(value: number) {
    this.set_instruction_flags(value);
  }

  get_market_record_idx(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
  }

  get_reserved0(): number[] {
    const offset = 2;
    const result: number[] = [];
    for (let i = 0; i < 5; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 2;
    if (value.length !== 5) {
      throw new Error('Array length must be 5');
    }
    for (let i = 0; i < 5; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_price(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_quantity(): bigint {
    const offset = 15;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity(value: bigint): void {
    const offset = 15;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity(): bigint {
    return this.get_quantity();
  }

  set quantity(value: bigint) {
    this.set_quantity(value);
  }

  get_quote_wallet_idx(): number {
    const offset = 23;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_quote_wallet_idx(value: number): void {
    const offset = 23;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get quote_wallet_idx(): number {
    return this.get_quote_wallet_idx();
  }

  set quote_wallet_idx(value: number) {
    this.set_quote_wallet_idx(value);
  }

  get_base_wallet_idx(): number {
    const offset = 25;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_base_wallet_idx(value: number): void {
    const offset = 25;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get base_wallet_idx(): number {
    return this.get_base_wallet_idx();
  }

  set base_wallet_idx(value: number) {
    this.set_base_wallet_idx(value);
  }

  get_reserved1(): number[] {
    const offset = 27;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved1(value: number[]): void {
    const offset = 27;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved1(): number[] {
    return this.get_reserved1();
  }

  set reserved1(value: number[]) {
    this.set_reserved1(value);
  }

  get_client_id_length(): number {
    return (((this.__tnResolveFieldRef("instruction_flags") >> 6) & 1) * 16);
  }

  get_client_id_at(index: number): number {
    const offset = 31;
    return this.view.getUint8(offset + index * 1);
  }

  get_client_id(): number[] {
    const len = this.get_client_id_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_client_id_at(i));
    }
    return result;
  }

  set_client_id_at(index: number, value: number): void {
    const offset = 31;
    this.view.setUint8((offset + index * 1), value);
  }

  set_client_id(value: number[]): void {
    const len = Math.min(this.get_client_id_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_client_id_at(i, value[i]);
    }
  }

  get client_id(): number[] {
    return this.get_client_id();
  }

  set client_id(value: number[]) {
    this.set_client_id(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateSeatlessOrderEntryInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateSeatlessOrderEntryInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(client_id_instruction_flags: number | bigint): bigint {
    const params = CreateSeatlessOrderEntryInstruction.Params.fromValues({
      client_id_instruction_flags: client_id_instruction_flags,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateSeatlessOrderEntryInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["client_id.instruction_flags"] = params.client_id_instruction_flags;
    return record;
  }

  static footprintIrFromParams(params: CreateSeatlessOrderEntryInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateSeatlessOrderEntryInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateSeatlessOrderEntryInstruction');
    return __tnBigIntToNumber(irResult, 'CreateSeatlessOrderEntryInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { client_id_instruction_flags: number | bigint }): number {
    const params = CreateSeatlessOrderEntryInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateSeatlessOrderEntryInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateSeatlessOrderEntryInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateSeatlessOrderEntryInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateSeatlessOrderEntryInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateSeatlessOrderEntryInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateSeatlessOrderEntryInstruction.Params }): CreateSeatlessOrderEntryInstruction | null {
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
    const state = new CreateSeatlessOrderEntryInstruction(buffer, cached);
    return state;
  }


}

export namespace CreateSeatlessOrderEntryInstruction {
  export type Params = {
    /** ABI path: client_id.instruction_flags */
    readonly client_id_instruction_flags: bigint;
  };

  export const ParamKeys = Object.freeze({
    client_id_instruction_flags: "client_id.instruction_flags",
  } as const);

  export const Params = {
    fromValues(input: { client_id_instruction_flags: number | bigint }): Params {
      return {
        client_id_instruction_flags: __tnToBigInt(input.client_id_instruction_flags),
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

  export function params(input: { client_id_instruction_flags: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateSeatlessOrderEntryInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateSeatlessOrderEntryInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateSeatlessOrderEntryInstruction.Params | null = null;
  private __tnTail_client_id: Uint8Array | null = null;
  private __tnTailWriter_client_id?: __TnFamWriterResult<CreateSeatlessOrderEntryInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(31);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_instruction_flags(value: number): this {
    this.view.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(1, value);
    this.__tnInvalidate();
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 5) throw new Error("reserved0 expects 5 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 2 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_quantity(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(15, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_quote_wallet_idx(value: number): this {
    this.view.setUint16(23, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_base_wallet_idx(value: number): this {
    this.view.setUint16(25, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_reserved1(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved1 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 27 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  client_id(): __TnFamWriterResult<CreateSeatlessOrderEntryInstructionBuilder> {
    if (!this.__tnTailWriter_client_id) {
      this.__tnTailWriter_client_id = __tnCreateFamWriter(this, "client_id", (payload) => {
        const bytes = new Uint8Array(payload);
        this.__tnTail_client_id = bytes;
        this.__tnInvalidate();
      });
    }
    return this.__tnTailWriter_client_id!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateSeatlessOrderEntryInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateSeatlessOrderEntryInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateSeatlessOrderEntryInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateSeatlessOrderEntryInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateSeatlessOrderEntryInstruction.from_array(buffer, { params });
    if (!view) throw new Error("CreateSeatlessOrderEntryInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateSeatlessOrderEntryInstruction {
    return this.finish();
  }

  dynamicParams(): CreateSeatlessOrderEntryInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateSeatlessOrderEntryInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateSeatlessOrderEntryInstruction.Params.fromValues({
      client_id_instruction_flags: (() => { return __tnToBigInt(this.view.getUint8(0)); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_client_id_bytes = this.__tnTail_client_id;
    const __tnExpected_client_id_bytes = (((this.view.getUint8(0) >> 6) & 1) * 16);
    if (__tnExpected_client_id_bytes > 0 && !__tnLocal_client_id_bytes) throw new Error("CreateSeatlessOrderEntryInstructionBuilder: field 'client_id' must be written before build");
    if (__tnLocal_client_id_bytes && __tnLocal_client_id_bytes.length !== __tnExpected_client_id_bytes) throw new Error("CreateSeatlessOrderEntryInstructionBuilder: field 'client_id' length does not match dynamic layout");
    if (__tnLocal_client_id_bytes) {
      target.set(__tnLocal_client_id_bytes, cursor);
      cursor += __tnLocal_client_id_bytes.length;
    }
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateSeatlessOrderEntryInstruction.Params): void {
    const result = CreateSeatlessOrderEntryInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateSeatlessOrderEntryInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateSeatlessOrderEntryInstruction", (params) => CreateSeatlessOrderEntryInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateSeatlessOrderEntryInstruction", (buffer, params) => CreateSeatlessOrderEntryInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateSeatlessOrderEntryInstruction", (buffer) => { const result = CreateSeatlessOrderEntryInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketCreateInstruction ----- */

const __tn_ir_MarketCreateInstruction = {
  typeName: "MarketCreateInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 6n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_seat_arena.proof_sz_seat_arena" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_order_arena.proof_sz_order_arena" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_bids_cbook.proof_sz_bids_cbook" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_asks_cbook.proof_sz_asks_cbook" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_base_vault.proof_sz_base_vault" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_quote_vault.proof_sz_quote_vault" }, right: { op: "const", value: 1n } } } } }
} as const;

export class MarketCreateInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: MarketCreateInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: MarketCreateInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = MarketCreateInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("MarketCreateInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: MarketCreateInstruction.Params, fieldContext?: Record<string, number | bigint> }): MarketCreateInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketCreateInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = MarketCreateInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("MarketCreateInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new MarketCreateInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): MarketCreateInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "MarketCreateInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "MarketCreateInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("MarketCreateInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): MarketCreateInstructionBuilder {
    return new MarketCreateInstructionBuilder();
  }

  static fromBuilder(builder: MarketCreateInstructionBuilder): MarketCreateInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return MarketCreateInstruction.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof_seat_arena", method: "proof_seat_arena", sizeField: "proof_sz_seat_arena", paramKey: "proof_sz_seat_arena", elementSize: 1 },
    { field: "proof_order_arena", method: "proof_order_arena", sizeField: "proof_sz_order_arena", paramKey: "proof_sz_order_arena", elementSize: 1 },
    { field: "proof_bids_cbook", method: "proof_bids_cbook", sizeField: "proof_sz_bids_cbook", paramKey: "proof_sz_bids_cbook", elementSize: 1 },
    { field: "proof_asks_cbook", method: "proof_asks_cbook", sizeField: "proof_sz_asks_cbook", paramKey: "proof_sz_asks_cbook", elementSize: 1 },
    { field: "proof_base_vault", method: "proof_base_vault", sizeField: "proof_sz_base_vault", paramKey: "proof_sz_base_vault", elementSize: 1 },
    { field: "proof_quote_vault", method: "proof_quote_vault", sizeField: "proof_sz_quote_vault", paramKey: "proof_sz_quote_vault", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_market_record_idx: number | null = null;
    let __tnFieldValue_lot_size: bigint | null = null;
    let __tnFieldValue_tick_size: bigint | null = null;
    let __tnFieldValue_token_program_idx: number | null = null;
    let __tnFieldValue_base_mint_idx: number | null = null;
    let __tnFieldValue_quote_mint_idx: number | null = null;
    let __tnFieldValue_seat_arena_account_idx: number | null = null;
    let __tnFieldValue_order_arena_account_idx: number | null = null;
    let __tnFieldValue_bids_cbook_account_idx: number | null = null;
    let __tnFieldValue_asks_cbook_account_idx: number | null = null;
    let __tnFieldValue_base_vault_account_idx: number | null = null;
    let __tnFieldValue_quote_vault_account_idx: number | null = null;
    let __tnFieldValue_market_authority_account_idx: number | null = null;
    let __tnFieldValue_proof_sz_seat_arena: number | null = null;
    let __tnFieldValue_proof_sz_order_arena: number | null = null;
    let __tnFieldValue_proof_sz_bids_cbook: number | null = null;
    let __tnFieldValue_proof_sz_asks_cbook: number | null = null;
    let __tnFieldValue_proof_sz_base_vault: number | null = null;
    let __tnFieldValue_proof_sz_quote_vault: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_market_record_idx = view.getUint8(__tnCursorMutable);
    __tnFieldValue_market_record_idx = __tnRead_market_record_idx;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 6 > __tnLength) return null;
    __tnCursorMutable += 6;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_lot_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_lot_size = __tnRead_lot_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_tick_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_tick_size = __tnRead_tick_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_token_program_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_token_program_idx = __tnRead_token_program_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_base_mint_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_base_mint_idx = __tnRead_base_mint_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_quote_mint_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_quote_mint_idx = __tnRead_quote_mint_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_seat_arena_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_seat_arena_account_idx = __tnRead_seat_arena_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_order_arena_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_order_arena_account_idx = __tnRead_order_arena_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_bids_cbook_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_bids_cbook_account_idx = __tnRead_bids_cbook_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_asks_cbook_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_asks_cbook_account_idx = __tnRead_asks_cbook_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_base_vault_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_base_vault_account_idx = __tnRead_base_vault_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_quote_vault_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_quote_vault_account_idx = __tnRead_quote_vault_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_market_authority_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_market_authority_account_idx = __tnRead_market_authority_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_proof_sz_seat_arena = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_proof_sz_seat_arena = __tnRead_proof_sz_seat_arena;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_proof_sz_order_arena = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_proof_sz_order_arena = __tnRead_proof_sz_order_arena;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_proof_sz_bids_cbook = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_proof_sz_bids_cbook = __tnRead_proof_sz_bids_cbook;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_proof_sz_asks_cbook = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_proof_sz_asks_cbook = __tnRead_proof_sz_asks_cbook;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_proof_sz_base_vault = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_proof_sz_base_vault = __tnRead_proof_sz_base_vault;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_proof_sz_quote_vault = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_proof_sz_quote_vault = __tnRead_proof_sz_quote_vault;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    __tnCursorMutable += 4;
    if (__tnFieldValue_proof_sz_seat_arena === null) return null;
    const __tnArrayCount_proof_seat_arena = Math.trunc(Number(__tnFieldValue_proof_sz_seat_arena));
    if (!Number.isFinite(__tnArrayCount_proof_seat_arena) || __tnArrayCount_proof_seat_arena < 0) return null;
    const __tnArrayBytes_proof_seat_arena = __tnArrayCount_proof_seat_arena * 1;
    if (__tnCursorMutable + __tnArrayBytes_proof_seat_arena > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof_seat_arena;
    if (__tnFieldValue_proof_sz_order_arena === null) return null;
    const __tnArrayCount_proof_order_arena = Math.trunc(Number(__tnFieldValue_proof_sz_order_arena));
    if (!Number.isFinite(__tnArrayCount_proof_order_arena) || __tnArrayCount_proof_order_arena < 0) return null;
    const __tnArrayBytes_proof_order_arena = __tnArrayCount_proof_order_arena * 1;
    offsets["proof_order_arena"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof_order_arena > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof_order_arena;
    if (__tnFieldValue_proof_sz_bids_cbook === null) return null;
    const __tnArrayCount_proof_bids_cbook = Math.trunc(Number(__tnFieldValue_proof_sz_bids_cbook));
    if (!Number.isFinite(__tnArrayCount_proof_bids_cbook) || __tnArrayCount_proof_bids_cbook < 0) return null;
    const __tnArrayBytes_proof_bids_cbook = __tnArrayCount_proof_bids_cbook * 1;
    offsets["proof_bids_cbook"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof_bids_cbook > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof_bids_cbook;
    if (__tnFieldValue_proof_sz_asks_cbook === null) return null;
    const __tnArrayCount_proof_asks_cbook = Math.trunc(Number(__tnFieldValue_proof_sz_asks_cbook));
    if (!Number.isFinite(__tnArrayCount_proof_asks_cbook) || __tnArrayCount_proof_asks_cbook < 0) return null;
    const __tnArrayBytes_proof_asks_cbook = __tnArrayCount_proof_asks_cbook * 1;
    offsets["proof_asks_cbook"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof_asks_cbook > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof_asks_cbook;
    if (__tnFieldValue_proof_sz_base_vault === null) return null;
    const __tnArrayCount_proof_base_vault = Math.trunc(Number(__tnFieldValue_proof_sz_base_vault));
    if (!Number.isFinite(__tnArrayCount_proof_base_vault) || __tnArrayCount_proof_base_vault < 0) return null;
    const __tnArrayBytes_proof_base_vault = __tnArrayCount_proof_base_vault * 1;
    offsets["proof_base_vault"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof_base_vault > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof_base_vault;
    if (__tnFieldValue_proof_sz_quote_vault === null) return null;
    const __tnArrayCount_proof_quote_vault = Math.trunc(Number(__tnFieldValue_proof_sz_quote_vault));
    if (!Number.isFinite(__tnArrayCount_proof_quote_vault) || __tnArrayCount_proof_quote_vault < 0) return null;
    const __tnArrayBytes_proof_quote_vault = __tnArrayCount_proof_quote_vault * 1;
    offsets["proof_quote_vault"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof_quote_vault > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof_quote_vault;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: MarketCreateInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 59) {
      return null;
    }
    const __tnParam_proof_asks_cbook_proof_sz_asks_cbook = __tnToBigInt(view.getUint32(55, true));
    if (buffer.length < 63) {
      return null;
    }
    const __tnParam_proof_base_vault_proof_sz_base_vault = __tnToBigInt(view.getUint32(59, true));
    if (buffer.length < 55) {
      return null;
    }
    const __tnParam_proof_bids_cbook_proof_sz_bids_cbook = __tnToBigInt(view.getUint32(51, true));
    if (buffer.length < 51) {
      return null;
    }
    const __tnParam_proof_order_arena_proof_sz_order_arena = __tnToBigInt(view.getUint32(47, true));
    if (buffer.length < 67) {
      return null;
    }
    const __tnParam_proof_quote_vault_proof_sz_quote_vault = __tnToBigInt(view.getUint32(63, true));
    if (buffer.length < 47) {
      return null;
    }
    const __tnParam_proof_seat_arena_proof_sz_seat_arena = __tnToBigInt(view.getUint32(43, true));
    const __tnExtractedParams = MarketCreateInstruction.Params.fromValues({
      proof_asks_cbook_proof_sz_asks_cbook: __tnParam_proof_asks_cbook_proof_sz_asks_cbook,
      proof_base_vault_proof_sz_base_vault: __tnParam_proof_base_vault_proof_sz_base_vault,
      proof_bids_cbook_proof_sz_bids_cbook: __tnParam_proof_bids_cbook_proof_sz_bids_cbook,
      proof_order_arena_proof_sz_order_arena: __tnParam_proof_order_arena_proof_sz_order_arena,
      proof_quote_vault_proof_sz_quote_vault: __tnParam_proof_quote_vault_proof_sz_quote_vault,
      proof_seat_arena_proof_sz_seat_arena: __tnParam_proof_seat_arena_proof_sz_seat_arena,
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
      throw new Error("MarketCreateInstruction: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = MarketCreateInstruction.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("MarketCreateInstruction: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_market_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
  }

  get_reserved0(): number[] {
    const offset = 1;
    const result: number[] = [];
    for (let i = 0; i < 6; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 1;
    if (value.length !== 6) {
      throw new Error('Array length must be 6');
    }
    for (let i = 0; i < 6; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_lot_size(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lot_size(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lot_size(): bigint {
    return this.get_lot_size();
  }

  set lot_size(value: bigint) {
    this.set_lot_size(value);
  }

  get_tick_size(): bigint {
    const offset = 15;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_tick_size(value: bigint): void {
    const offset = 15;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get tick_size(): bigint {
    return this.get_tick_size();
  }

  set tick_size(value: bigint) {
    this.set_tick_size(value);
  }

  get_token_program_idx(): number {
    const offset = 23;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_idx(value: number): void {
    const offset = 23;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_idx(): number {
    return this.get_token_program_idx();
  }

  set token_program_idx(value: number) {
    this.set_token_program_idx(value);
  }

  get_base_mint_idx(): number {
    const offset = 25;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_base_mint_idx(value: number): void {
    const offset = 25;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get base_mint_idx(): number {
    return this.get_base_mint_idx();
  }

  set base_mint_idx(value: number) {
    this.set_base_mint_idx(value);
  }

  get_quote_mint_idx(): number {
    const offset = 27;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_quote_mint_idx(value: number): void {
    const offset = 27;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get quote_mint_idx(): number {
    return this.get_quote_mint_idx();
  }

  set quote_mint_idx(value: number) {
    this.set_quote_mint_idx(value);
  }

  get_seat_arena_account_idx(): number {
    const offset = 29;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_seat_arena_account_idx(value: number): void {
    const offset = 29;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get seat_arena_account_idx(): number {
    return this.get_seat_arena_account_idx();
  }

  set seat_arena_account_idx(value: number) {
    this.set_seat_arena_account_idx(value);
  }

  get_order_arena_account_idx(): number {
    const offset = 31;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_order_arena_account_idx(value: number): void {
    const offset = 31;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get order_arena_account_idx(): number {
    return this.get_order_arena_account_idx();
  }

  set order_arena_account_idx(value: number) {
    this.set_order_arena_account_idx(value);
  }

  get_bids_cbook_account_idx(): number {
    const offset = 33;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_bids_cbook_account_idx(value: number): void {
    const offset = 33;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get bids_cbook_account_idx(): number {
    return this.get_bids_cbook_account_idx();
  }

  set bids_cbook_account_idx(value: number) {
    this.set_bids_cbook_account_idx(value);
  }

  get_asks_cbook_account_idx(): number {
    const offset = 35;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_asks_cbook_account_idx(value: number): void {
    const offset = 35;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get asks_cbook_account_idx(): number {
    return this.get_asks_cbook_account_idx();
  }

  set asks_cbook_account_idx(value: number) {
    this.set_asks_cbook_account_idx(value);
  }

  get_base_vault_account_idx(): number {
    const offset = 37;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_base_vault_account_idx(value: number): void {
    const offset = 37;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get base_vault_account_idx(): number {
    return this.get_base_vault_account_idx();
  }

  set base_vault_account_idx(value: number) {
    this.set_base_vault_account_idx(value);
  }

  get_quote_vault_account_idx(): number {
    const offset = 39;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_quote_vault_account_idx(value: number): void {
    const offset = 39;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get quote_vault_account_idx(): number {
    return this.get_quote_vault_account_idx();
  }

  set quote_vault_account_idx(value: number) {
    this.set_quote_vault_account_idx(value);
  }

  get_market_authority_account_idx(): number {
    const offset = 41;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_market_authority_account_idx(value: number): void {
    const offset = 41;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get market_authority_account_idx(): number {
    return this.get_market_authority_account_idx();
  }

  set market_authority_account_idx(value: number) {
    this.set_market_authority_account_idx(value);
  }

  get_proof_sz_seat_arena(): number {
    const offset = 43;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_seat_arena(value: number): void {
    const offset = 43;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_seat_arena(): number {
    return this.get_proof_sz_seat_arena();
  }

  set proof_sz_seat_arena(value: number) {
    this.set_proof_sz_seat_arena(value);
  }

  get_proof_sz_order_arena(): number {
    const offset = 47;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_order_arena(value: number): void {
    const offset = 47;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_order_arena(): number {
    return this.get_proof_sz_order_arena();
  }

  set proof_sz_order_arena(value: number) {
    this.set_proof_sz_order_arena(value);
  }

  get_proof_sz_bids_cbook(): number {
    const offset = 51;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_bids_cbook(value: number): void {
    const offset = 51;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_bids_cbook(): number {
    return this.get_proof_sz_bids_cbook();
  }

  set proof_sz_bids_cbook(value: number) {
    this.set_proof_sz_bids_cbook(value);
  }

  get_proof_sz_asks_cbook(): number {
    const offset = 55;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_asks_cbook(value: number): void {
    const offset = 55;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_asks_cbook(): number {
    return this.get_proof_sz_asks_cbook();
  }

  set proof_sz_asks_cbook(value: number) {
    this.set_proof_sz_asks_cbook(value);
  }

  get_proof_sz_base_vault(): number {
    const offset = 59;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_base_vault(value: number): void {
    const offset = 59;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_base_vault(): number {
    return this.get_proof_sz_base_vault();
  }

  set proof_sz_base_vault(value: number) {
    this.set_proof_sz_base_vault(value);
  }

  get_proof_sz_quote_vault(): number {
    const offset = 63;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_quote_vault(value: number): void {
    const offset = 63;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_quote_vault(): number {
    return this.get_proof_sz_quote_vault();
  }

  set proof_sz_quote_vault(value: number) {
    this.set_proof_sz_quote_vault(value);
  }

  get_reserved1(): number[] {
    const offset = 67;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved1(value: number[]): void {
    const offset = 67;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved1(): number[] {
    return this.get_reserved1();
  }

  set reserved1(value: number[]) {
    this.set_reserved1(value);
  }

  get_proof_seat_arena_length(): number {
    return this.__tnResolveFieldRef("proof_sz_seat_arena");
  }

  get_proof_seat_arena_at(index: number): number {
    const offset = 71;
    return this.view.getUint8(offset + index * 1);
  }

  get_proof_seat_arena(): number[] {
    const len = this.get_proof_seat_arena_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_seat_arena_at(i));
    }
    return result;
  }

  set_proof_seat_arena_at(index: number, value: number): void {
    const offset = 71;
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof_seat_arena(value: number[]): void {
    const len = Math.min(this.get_proof_seat_arena_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_seat_arena_at(i, value[i]);
    }
  }

  get proof_seat_arena(): number[] {
    return this.get_proof_seat_arena();
  }

  set proof_seat_arena(value: number[]) {
    this.set_proof_seat_arena(value);
  }

  get_proof_order_arena_length(): number {
    return this.__tnResolveFieldRef("proof_sz_order_arena");
  }

  get_proof_order_arena_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("proof_order_arena");
    return this.view.getUint8(offset + index * 1);
  }

  get_proof_order_arena(): number[] {
    const len = this.get_proof_order_arena_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_order_arena_at(i));
    }
    return result;
  }

  set_proof_order_arena_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("proof_order_arena");
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof_order_arena(value: number[]): void {
    const len = Math.min(this.get_proof_order_arena_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_order_arena_at(i, value[i]);
    }
  }

  get proof_order_arena(): number[] {
    return this.get_proof_order_arena();
  }

  set proof_order_arena(value: number[]) {
    this.set_proof_order_arena(value);
  }

  get_proof_bids_cbook_length(): number {
    return this.__tnResolveFieldRef("proof_sz_bids_cbook");
  }

  get_proof_bids_cbook_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("proof_bids_cbook");
    return this.view.getUint8(offset + index * 1);
  }

  get_proof_bids_cbook(): number[] {
    const len = this.get_proof_bids_cbook_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_bids_cbook_at(i));
    }
    return result;
  }

  set_proof_bids_cbook_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("proof_bids_cbook");
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof_bids_cbook(value: number[]): void {
    const len = Math.min(this.get_proof_bids_cbook_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_bids_cbook_at(i, value[i]);
    }
  }

  get proof_bids_cbook(): number[] {
    return this.get_proof_bids_cbook();
  }

  set proof_bids_cbook(value: number[]) {
    this.set_proof_bids_cbook(value);
  }

  get_proof_asks_cbook_length(): number {
    return this.__tnResolveFieldRef("proof_sz_asks_cbook");
  }

  get_proof_asks_cbook_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("proof_asks_cbook");
    return this.view.getUint8(offset + index * 1);
  }

  get_proof_asks_cbook(): number[] {
    const len = this.get_proof_asks_cbook_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_asks_cbook_at(i));
    }
    return result;
  }

  set_proof_asks_cbook_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("proof_asks_cbook");
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof_asks_cbook(value: number[]): void {
    const len = Math.min(this.get_proof_asks_cbook_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_asks_cbook_at(i, value[i]);
    }
  }

  get proof_asks_cbook(): number[] {
    return this.get_proof_asks_cbook();
  }

  set proof_asks_cbook(value: number[]) {
    this.set_proof_asks_cbook(value);
  }

  get_proof_base_vault_length(): number {
    return this.__tnResolveFieldRef("proof_sz_base_vault");
  }

  get_proof_base_vault_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("proof_base_vault");
    return this.view.getUint8(offset + index * 1);
  }

  get_proof_base_vault(): number[] {
    const len = this.get_proof_base_vault_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_base_vault_at(i));
    }
    return result;
  }

  set_proof_base_vault_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("proof_base_vault");
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof_base_vault(value: number[]): void {
    const len = Math.min(this.get_proof_base_vault_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_base_vault_at(i, value[i]);
    }
  }

  get proof_base_vault(): number[] {
    return this.get_proof_base_vault();
  }

  set proof_base_vault(value: number[]) {
    this.set_proof_base_vault(value);
  }

  get_proof_quote_vault_length(): number {
    return this.__tnResolveFieldRef("proof_sz_quote_vault");
  }

  get_proof_quote_vault_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("proof_quote_vault");
    return this.view.getUint8(offset + index * 1);
  }

  get_proof_quote_vault(): number[] {
    const len = this.get_proof_quote_vault_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_quote_vault_at(i));
    }
    return result;
  }

  set_proof_quote_vault_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("proof_quote_vault");
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof_quote_vault(value: number[]): void {
    const len = Math.min(this.get_proof_quote_vault_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_quote_vault_at(i, value[i]);
    }
  }

  get proof_quote_vault(): number[] {
    return this.get_proof_quote_vault();
  }

  set proof_quote_vault(value: number[]) {
    this.set_proof_quote_vault(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketCreateInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketCreateInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_base_vault_proof_sz_base_vault: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint): bigint {
    const params = MarketCreateInstruction.Params.fromValues({
      proof_asks_cbook_proof_sz_asks_cbook: proof_asks_cbook_proof_sz_asks_cbook,
      proof_base_vault_proof_sz_base_vault: proof_base_vault_proof_sz_base_vault,
      proof_bids_cbook_proof_sz_bids_cbook: proof_bids_cbook_proof_sz_bids_cbook,
      proof_order_arena_proof_sz_order_arena: proof_order_arena_proof_sz_order_arena,
      proof_quote_vault_proof_sz_quote_vault: proof_quote_vault_proof_sz_quote_vault,
      proof_seat_arena_proof_sz_seat_arena: proof_seat_arena_proof_sz_seat_arena,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: MarketCreateInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_asks_cbook.proof_sz_asks_cbook"] = params.proof_asks_cbook_proof_sz_asks_cbook;
    record["proof_base_vault.proof_sz_base_vault"] = params.proof_base_vault_proof_sz_base_vault;
    record["proof_bids_cbook.proof_sz_bids_cbook"] = params.proof_bids_cbook_proof_sz_bids_cbook;
    record["proof_order_arena.proof_sz_order_arena"] = params.proof_order_arena_proof_sz_order_arena;
    record["proof_quote_vault.proof_sz_quote_vault"] = params.proof_quote_vault_proof_sz_quote_vault;
    record["proof_seat_arena.proof_sz_seat_arena"] = params.proof_seat_arena_proof_sz_seat_arena;
    return record;
  }

  static footprintIrFromParams(params: MarketCreateInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: MarketCreateInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketCreateInstruction');
    return __tnBigIntToNumber(irResult, 'MarketCreateInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_base_vault_proof_sz_base_vault: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint }): number {
    const params = MarketCreateInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: MarketCreateInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: MarketCreateInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: MarketCreateInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MarketCreateInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MarketCreateInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: MarketCreateInstruction.Params }): MarketCreateInstruction | null {
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
    const state = new MarketCreateInstruction(buffer, cached);
    return state;
  }


}

export namespace MarketCreateInstruction {
  export type Params = {
    /** ABI path: proof_asks_cbook.proof_sz_asks_cbook */
    readonly proof_asks_cbook_proof_sz_asks_cbook: bigint;
    /** ABI path: proof_base_vault.proof_sz_base_vault */
    readonly proof_base_vault_proof_sz_base_vault: bigint;
    /** ABI path: proof_bids_cbook.proof_sz_bids_cbook */
    readonly proof_bids_cbook_proof_sz_bids_cbook: bigint;
    /** ABI path: proof_order_arena.proof_sz_order_arena */
    readonly proof_order_arena_proof_sz_order_arena: bigint;
    /** ABI path: proof_quote_vault.proof_sz_quote_vault */
    readonly proof_quote_vault_proof_sz_quote_vault: bigint;
    /** ABI path: proof_seat_arena.proof_sz_seat_arena */
    readonly proof_seat_arena_proof_sz_seat_arena: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_asks_cbook_proof_sz_asks_cbook: "proof_asks_cbook.proof_sz_asks_cbook",
    proof_base_vault_proof_sz_base_vault: "proof_base_vault.proof_sz_base_vault",
    proof_bids_cbook_proof_sz_bids_cbook: "proof_bids_cbook.proof_sz_bids_cbook",
    proof_order_arena_proof_sz_order_arena: "proof_order_arena.proof_sz_order_arena",
    proof_quote_vault_proof_sz_quote_vault: "proof_quote_vault.proof_sz_quote_vault",
    proof_seat_arena_proof_sz_seat_arena: "proof_seat_arena.proof_sz_seat_arena",
  } as const);

  export const Params = {
    fromValues(input: { proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_base_vault_proof_sz_base_vault: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint }): Params {
      return {
        proof_asks_cbook_proof_sz_asks_cbook: __tnToBigInt(input.proof_asks_cbook_proof_sz_asks_cbook),
        proof_base_vault_proof_sz_base_vault: __tnToBigInt(input.proof_base_vault_proof_sz_base_vault),
        proof_bids_cbook_proof_sz_bids_cbook: __tnToBigInt(input.proof_bids_cbook_proof_sz_bids_cbook),
        proof_order_arena_proof_sz_order_arena: __tnToBigInt(input.proof_order_arena_proof_sz_order_arena),
        proof_quote_vault_proof_sz_quote_vault: __tnToBigInt(input.proof_quote_vault_proof_sz_quote_vault),
        proof_seat_arena_proof_sz_seat_arena: __tnToBigInt(input.proof_seat_arena_proof_sz_seat_arena),
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

  export function params(input: { proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_base_vault_proof_sz_base_vault: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class MarketCreateInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: MarketCreateInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: MarketCreateInstruction.Params | null = null;
  private __tnFam_proof_seat_arena: Uint8Array | null = null;
  private __tnFam_proof_seat_arenaCount: number | null = null;
  private __tnFamWriter_proof_seat_arena?: __TnFamWriterResult<MarketCreateInstructionBuilder>;
  private __tnFam_proof_order_arena: Uint8Array | null = null;
  private __tnFam_proof_order_arenaCount: number | null = null;
  private __tnFamWriter_proof_order_arena?: __TnFamWriterResult<MarketCreateInstructionBuilder>;
  private __tnFam_proof_bids_cbook: Uint8Array | null = null;
  private __tnFam_proof_bids_cbookCount: number | null = null;
  private __tnFamWriter_proof_bids_cbook?: __TnFamWriterResult<MarketCreateInstructionBuilder>;
  private __tnFam_proof_asks_cbook: Uint8Array | null = null;
  private __tnFam_proof_asks_cbookCount: number | null = null;
  private __tnFamWriter_proof_asks_cbook?: __TnFamWriterResult<MarketCreateInstructionBuilder>;
  private __tnFam_proof_base_vault: Uint8Array | null = null;
  private __tnFam_proof_base_vaultCount: number | null = null;
  private __tnFamWriter_proof_base_vault?: __TnFamWriterResult<MarketCreateInstructionBuilder>;
  private __tnFam_proof_quote_vault: Uint8Array | null = null;
  private __tnFam_proof_quote_vaultCount: number | null = null;
  private __tnFamWriter_proof_quote_vault?: __TnFamWriterResult<MarketCreateInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(71);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 6) throw new Error("reserved0 expects 6 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 1 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_lot_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_tick_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(15, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_token_program_idx(value: number): this {
    this.view.setUint16(23, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_base_mint_idx(value: number): this {
    this.view.setUint16(25, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_quote_mint_idx(value: number): this {
    this.view.setUint16(27, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_seat_arena_account_idx(value: number): this {
    this.view.setUint16(29, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_order_arena_account_idx(value: number): this {
    this.view.setUint16(31, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_bids_cbook_account_idx(value: number): this {
    this.view.setUint16(33, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_asks_cbook_account_idx(value: number): this {
    this.view.setUint16(35, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_base_vault_account_idx(value: number): this {
    this.view.setUint16(37, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_quote_vault_account_idx(value: number): this {
    this.view.setUint16(39, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_market_authority_account_idx(value: number): this {
    this.view.setUint16(41, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_seat_arena(value: number): this {
    this.view.setUint32(43, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_order_arena(value: number): this {
    this.view.setUint32(47, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_bids_cbook(value: number): this {
    this.view.setUint32(51, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_asks_cbook(value: number): this {
    this.view.setUint32(55, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_base_vault(value: number): this {
    this.view.setUint32(59, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_quote_vault(value: number): this {
    this.view.setUint32(63, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_reserved1(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved1 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 67 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  proof_seat_arena(): __TnFamWriterResult<MarketCreateInstructionBuilder> {
    if (!this.__tnFamWriter_proof_seat_arena) {
      this.__tnFamWriter_proof_seat_arena = __tnCreateFamWriter(this, "proof_seat_arena", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof_seat_arena = bytes;
        this.__tnFam_proof_seat_arenaCount = elementCount;
        this.set_proof_sz_seat_arena(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof_seat_arena!;
  }

  proof_order_arena(): __TnFamWriterResult<MarketCreateInstructionBuilder> {
    if (!this.__tnFamWriter_proof_order_arena) {
      this.__tnFamWriter_proof_order_arena = __tnCreateFamWriter(this, "proof_order_arena", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof_order_arena = bytes;
        this.__tnFam_proof_order_arenaCount = elementCount;
        this.set_proof_sz_order_arena(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof_order_arena!;
  }

  proof_bids_cbook(): __TnFamWriterResult<MarketCreateInstructionBuilder> {
    if (!this.__tnFamWriter_proof_bids_cbook) {
      this.__tnFamWriter_proof_bids_cbook = __tnCreateFamWriter(this, "proof_bids_cbook", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof_bids_cbook = bytes;
        this.__tnFam_proof_bids_cbookCount = elementCount;
        this.set_proof_sz_bids_cbook(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof_bids_cbook!;
  }

  proof_asks_cbook(): __TnFamWriterResult<MarketCreateInstructionBuilder> {
    if (!this.__tnFamWriter_proof_asks_cbook) {
      this.__tnFamWriter_proof_asks_cbook = __tnCreateFamWriter(this, "proof_asks_cbook", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof_asks_cbook = bytes;
        this.__tnFam_proof_asks_cbookCount = elementCount;
        this.set_proof_sz_asks_cbook(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof_asks_cbook!;
  }

  proof_base_vault(): __TnFamWriterResult<MarketCreateInstructionBuilder> {
    if (!this.__tnFamWriter_proof_base_vault) {
      this.__tnFamWriter_proof_base_vault = __tnCreateFamWriter(this, "proof_base_vault", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof_base_vault = bytes;
        this.__tnFam_proof_base_vaultCount = elementCount;
        this.set_proof_sz_base_vault(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof_base_vault!;
  }

  proof_quote_vault(): __TnFamWriterResult<MarketCreateInstructionBuilder> {
    if (!this.__tnFamWriter_proof_quote_vault) {
      this.__tnFamWriter_proof_quote_vault = __tnCreateFamWriter(this, "proof_quote_vault", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof_quote_vault = bytes;
        this.__tnFam_proof_quote_vaultCount = elementCount;
        this.set_proof_sz_quote_vault(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof_quote_vault!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = MarketCreateInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = MarketCreateInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("MarketCreateInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): MarketCreateInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = MarketCreateInstruction.from_array(buffer, { params });
    if (!view) throw new Error("MarketCreateInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): MarketCreateInstruction {
    return this.finish();
  }

  dynamicParams(): MarketCreateInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): MarketCreateInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = MarketCreateInstruction.Params.fromValues({
      proof_asks_cbook_proof_sz_asks_cbook: (() => { if (this.__tnFam_proof_asks_cbookCount === null) throw new Error("MarketCreateInstructionBuilder: field 'proof_asks_cbook' must be written before computing params"); return __tnToBigInt(this.__tnFam_proof_asks_cbookCount); })(),
      proof_base_vault_proof_sz_base_vault: (() => { if (this.__tnFam_proof_base_vaultCount === null) throw new Error("MarketCreateInstructionBuilder: field 'proof_base_vault' must be written before computing params"); return __tnToBigInt(this.__tnFam_proof_base_vaultCount); })(),
      proof_bids_cbook_proof_sz_bids_cbook: (() => { if (this.__tnFam_proof_bids_cbookCount === null) throw new Error("MarketCreateInstructionBuilder: field 'proof_bids_cbook' must be written before computing params"); return __tnToBigInt(this.__tnFam_proof_bids_cbookCount); })(),
      proof_order_arena_proof_sz_order_arena: (() => { if (this.__tnFam_proof_order_arenaCount === null) throw new Error("MarketCreateInstructionBuilder: field 'proof_order_arena' must be written before computing params"); return __tnToBigInt(this.__tnFam_proof_order_arenaCount); })(),
      proof_quote_vault_proof_sz_quote_vault: (() => { if (this.__tnFam_proof_quote_vaultCount === null) throw new Error("MarketCreateInstructionBuilder: field 'proof_quote_vault' must be written before computing params"); return __tnToBigInt(this.__tnFam_proof_quote_vaultCount); })(),
      proof_seat_arena_proof_sz_seat_arena: (() => { if (this.__tnFam_proof_seat_arenaCount === null) throw new Error("MarketCreateInstructionBuilder: field 'proof_seat_arena' must be written before computing params"); return __tnToBigInt(this.__tnFam_proof_seat_arenaCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_proof_seat_arena_bytes = this.__tnFam_proof_seat_arena;
    if (!__tnLocal_proof_seat_arena_bytes) throw new Error("MarketCreateInstructionBuilder: field 'proof_seat_arena' must be written before build");
    target.set(__tnLocal_proof_seat_arena_bytes, cursor);
    cursor += __tnLocal_proof_seat_arena_bytes.length;
    const __tnLocal_proof_order_arena_bytes = this.__tnFam_proof_order_arena;
    if (!__tnLocal_proof_order_arena_bytes) throw new Error("MarketCreateInstructionBuilder: field 'proof_order_arena' must be written before build");
    target.set(__tnLocal_proof_order_arena_bytes, cursor);
    cursor += __tnLocal_proof_order_arena_bytes.length;
    const __tnLocal_proof_bids_cbook_bytes = this.__tnFam_proof_bids_cbook;
    if (!__tnLocal_proof_bids_cbook_bytes) throw new Error("MarketCreateInstructionBuilder: field 'proof_bids_cbook' must be written before build");
    target.set(__tnLocal_proof_bids_cbook_bytes, cursor);
    cursor += __tnLocal_proof_bids_cbook_bytes.length;
    const __tnLocal_proof_asks_cbook_bytes = this.__tnFam_proof_asks_cbook;
    if (!__tnLocal_proof_asks_cbook_bytes) throw new Error("MarketCreateInstructionBuilder: field 'proof_asks_cbook' must be written before build");
    target.set(__tnLocal_proof_asks_cbook_bytes, cursor);
    cursor += __tnLocal_proof_asks_cbook_bytes.length;
    const __tnLocal_proof_base_vault_bytes = this.__tnFam_proof_base_vault;
    if (!__tnLocal_proof_base_vault_bytes) throw new Error("MarketCreateInstructionBuilder: field 'proof_base_vault' must be written before build");
    target.set(__tnLocal_proof_base_vault_bytes, cursor);
    cursor += __tnLocal_proof_base_vault_bytes.length;
    const __tnLocal_proof_quote_vault_bytes = this.__tnFam_proof_quote_vault;
    if (!__tnLocal_proof_quote_vault_bytes) throw new Error("MarketCreateInstructionBuilder: field 'proof_quote_vault' must be written before build");
    target.set(__tnLocal_proof_quote_vault_bytes, cursor);
    cursor += __tnLocal_proof_quote_vault_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: MarketCreateInstruction.Params): void {
    const result = MarketCreateInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ MarketCreateInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("MarketCreateInstruction", (params) => MarketCreateInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketCreateInstruction", (buffer, params) => MarketCreateInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketCreateInstruction", (buffer) => { const result = MarketCreateInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketRecordInstruction ----- */

const __tn_ir_MarketRecordInstruction = {
  typeName: "MarketRecordInstruction",
  root: { op: "const", value: 23n }
} as const;

export class MarketRecordInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketRecordInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketRecordInstruction.__tnCreateView requires a Uint8Array");
    return new MarketRecordInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketRecordInstructionBuilder {
    return new MarketRecordInstructionBuilder();
  }

  static fromBuilder(builder: MarketRecordInstructionBuilder): MarketRecordInstruction | null {
    const buffer = builder.build();
    return MarketRecordInstruction.from_array(buffer);
  }

  get_market_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
  }

  get_seat_arena_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_seat_arena_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get seat_arena_account_idx(): number {
    return this.get_seat_arena_account_idx();
  }

  set seat_arena_account_idx(value: number) {
    this.set_seat_arena_account_idx(value);
  }

  get_order_arena_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_order_arena_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get order_arena_account_idx(): number {
    return this.get_order_arena_account_idx();
  }

  set order_arena_account_idx(value: number) {
    this.set_order_arena_account_idx(value);
  }

  get_bids_cbook_account_idx(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_bids_cbook_account_idx(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get bids_cbook_account_idx(): number {
    return this.get_bids_cbook_account_idx();
  }

  set bids_cbook_account_idx(value: number) {
    this.set_bids_cbook_account_idx(value);
  }

  get_asks_cbook_account_idx(): number {
    const offset = 7;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_asks_cbook_account_idx(value: number): void {
    const offset = 7;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get asks_cbook_account_idx(): number {
    return this.get_asks_cbook_account_idx();
  }

  set asks_cbook_account_idx(value: number) {
    this.set_asks_cbook_account_idx(value);
  }

  get_seat_authority_account_idx(): number {
    const offset = 9;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_seat_authority_account_idx(value: number): void {
    const offset = 9;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get seat_authority_account_idx(): number {
    return this.get_seat_authority_account_idx();
  }

  set seat_authority_account_idx(value: number) {
    this.set_seat_authority_account_idx(value);
  }

  get_seat_idx(): number {
    const offset = 11;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 11;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_token_program_idx(): number {
    const offset = 15;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_idx(value: number): void {
    const offset = 15;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_idx(): number {
    return this.get_token_program_idx();
  }

  set token_program_idx(value: number) {
    this.set_token_program_idx(value);
  }

  get_base_vault_account_idx(): number {
    const offset = 17;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_base_vault_account_idx(value: number): void {
    const offset = 17;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get base_vault_account_idx(): number {
    return this.get_base_vault_account_idx();
  }

  set base_vault_account_idx(value: number) {
    this.set_base_vault_account_idx(value);
  }

  get_quote_vault_account_idx(): number {
    const offset = 19;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_quote_vault_account_idx(value: number): void {
    const offset = 19;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get quote_vault_account_idx(): number {
    return this.get_quote_vault_account_idx();
  }

  set quote_vault_account_idx(value: number) {
    this.set_quote_vault_account_idx(value);
  }

  get_market_authority_account_idx(): number {
    const offset = 21;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_market_authority_account_idx(value: number): void {
    const offset = 21;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get market_authority_account_idx(): number {
    return this.get_market_authority_account_idx();
  }

  set market_authority_account_idx(value: number) {
    this.set_market_authority_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketRecordInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketRecordInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketRecordInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketRecordInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 23) return { ok: false, code: "tn.buffer_too_small", consumed: 23 };
    return { ok: true, consumed: 23 };
  }

  static new(market_record_idx: number, seat_arena_account_idx: number, order_arena_account_idx: number, bids_cbook_account_idx: number, asks_cbook_account_idx: number, seat_authority_account_idx: number, seat_idx: number, token_program_idx: number, base_vault_account_idx: number, quote_vault_account_idx: number, market_authority_account_idx: number): MarketRecordInstruction {
    const buffer = new Uint8Array(23);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, seat_arena_account_idx, true); /* seat_arena_account_idx (little-endian) */
    view.setUint16(3, order_arena_account_idx, true); /* order_arena_account_idx (little-endian) */
    view.setUint16(5, bids_cbook_account_idx, true); /* bids_cbook_account_idx (little-endian) */
    view.setUint16(7, asks_cbook_account_idx, true); /* asks_cbook_account_idx (little-endian) */
    view.setUint16(9, seat_authority_account_idx, true); /* seat_authority_account_idx (little-endian) */
    view.setUint32(11, seat_idx, true); /* seat_idx (little-endian) */
    view.setUint16(15, token_program_idx, true); /* token_program_idx (little-endian) */
    view.setUint16(17, base_vault_account_idx, true); /* base_vault_account_idx (little-endian) */
    view.setUint16(19, quote_vault_account_idx, true); /* quote_vault_account_idx (little-endian) */
    view.setUint16(21, market_authority_account_idx, true); /* market_authority_account_idx (little-endian) */

    return new MarketRecordInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketRecordInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketRecordInstruction(buffer);
  }

}

export class MarketRecordInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(23);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_seat_arena_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_order_arena_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_bids_cbook_account_idx(value: number): this {
    this.view.setUint16(5, value, true);
    return this;
  }

  set_asks_cbook_account_idx(value: number): this {
    this.view.setUint16(7, value, true);
    return this;
  }

  set_seat_authority_account_idx(value: number): this {
    this.view.setUint16(9, value, true);
    return this;
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(11, value, true);
    return this;
  }

  set_token_program_idx(value: number): this {
    this.view.setUint16(15, value, true);
    return this;
  }

  set_base_vault_account_idx(value: number): this {
    this.view.setUint16(17, value, true);
    return this;
  }

  set_quote_vault_account_idx(value: number): this {
    this.view.setUint16(19, value, true);
    return this;
  }

  set_market_authority_account_idx(value: number): this {
    this.view.setUint16(21, value, true);
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

  finish(): MarketRecordInstruction {
    const view = MarketRecordInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketRecordInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketRecordInstruction", (params) => MarketRecordInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketRecordInstruction", (buffer, params) => MarketRecordInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketRecordInstruction", (buffer) => { const result = MarketRecordInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketSetStatusInstruction ----- */

const __tn_ir_MarketSetStatusInstruction = {
  typeName: "MarketSetStatusInstruction",
  root: { op: "const", value: 7n }
} as const;

export class MarketSetStatusInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetStatusInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetStatusInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetStatusInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetStatusInstructionBuilder {
    return new MarketSetStatusInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetStatusInstructionBuilder): MarketSetStatusInstruction | null {
    const buffer = builder.build();
    return MarketSetStatusInstruction.from_array(buffer);
  }

  get_market_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
  }

  get_status_flags(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_status_flags(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get status_flags(): number {
    return this.get_status_flags();
  }

  set status_flags(value: number) {
    this.set_status_flags(value);
  }

  get_reserved0(): number[] {
    const offset = 2;
    const result: number[] = [];
    for (let i = 0; i < 5; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 2;
    if (value.length !== 5) {
      throw new Error('Array length must be 5');
    }
    for (let i = 0; i < 5; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetStatusInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetStatusInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetStatusInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetStatusInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static from_array(buffer: Uint8Array): MarketSetStatusInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetStatusInstruction(buffer);
  }

}

export class MarketSetStatusInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(7);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_status_flags(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 5) throw new Error("reserved0 expects 5 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 2 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
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

  finish(): MarketSetStatusInstruction {
    const view = MarketSetStatusInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetStatusInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetStatusInstruction", (params) => MarketSetStatusInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetStatusInstruction", (buffer, params) => MarketSetStatusInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetStatusInstruction", (buffer) => { const result = MarketSetStatusInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ModifyOrderEntryInstruction ----- */

const __tn_ir_ModifyOrderEntryInstruction = {
  typeName: "ModifyOrderEntryInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "add", left: { op: "mul", left: { op: "bitAnd", left: { op: "rightShift", left: { op: "field", param: "metadata.instruction_flags" }, right: { op: "const", value: 1n } }, right: { op: "const", value: 1n } }, right: { op: "const", value: 16n } }, right: { op: "mul", left: { op: "bitAnd", left: { op: "rightShift", left: { op: "field", param: "metadata.instruction_flags" }, right: { op: "const", value: 2n } }, right: { op: "const", value: 1n } }, right: { op: "const", value: 8n } } }, right: { op: "const", value: 1n } } } } }
} as const;

export class ModifyOrderEntryInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: ModifyOrderEntryInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: ModifyOrderEntryInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = ModifyOrderEntryInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("ModifyOrderEntryInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: ModifyOrderEntryInstruction.Params, fieldContext?: Record<string, number | bigint> }): ModifyOrderEntryInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ModifyOrderEntryInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = ModifyOrderEntryInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("ModifyOrderEntryInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new ModifyOrderEntryInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): ModifyOrderEntryInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "ModifyOrderEntryInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "ModifyOrderEntryInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("ModifyOrderEntryInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): ModifyOrderEntryInstructionBuilder {
    return new ModifyOrderEntryInstructionBuilder();
  }

  static fromBuilder(builder: ModifyOrderEntryInstructionBuilder): ModifyOrderEntryInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return ModifyOrderEntryInstruction.from_array(buffer, { params });
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: ModifyOrderEntryInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_metadata_instruction_flags = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = ModifyOrderEntryInstruction.Params.fromValues({
      metadata_instruction_flags: __tnParam_metadata_instruction_flags,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_instruction_flags(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_instruction_flags(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get instruction_flags(): number {
    return this.get_instruction_flags();
  }

  set instruction_flags(value: number) {
    this.set_instruction_flags(value);
  }

  get_market_record_idx(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
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

  get_order_entry_idx(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_order_entry_idx(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get order_entry_idx(): number {
    return this.get_order_entry_idx();
  }

  set order_entry_idx(value: number) {
    this.set_order_entry_idx(value);
  }

  get_quantity(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity(): bigint {
    return this.get_quantity();
  }

  set quantity(value: bigint) {
    this.set_quantity(value);
  }

  get_exp_time(): bigint {
    const offset = 15;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_exp_time(value: bigint): void {
    const offset = 15;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get exp_time(): bigint {
    return this.get_exp_time();
  }

  set exp_time(value: bigint) {
    this.set_exp_time(value);
  }

  get_metadata_length(): number {
    return ((((this.__tnResolveFieldRef("instruction_flags") >> 1) & 1) * 16) + (((this.__tnResolveFieldRef("instruction_flags") >> 2) & 1) * 8));
  }

  get_metadata_at(index: number): number {
    const offset = 23;
    return this.view.getUint8(offset + index * 1);
  }

  get_metadata(): number[] {
    const len = this.get_metadata_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_metadata_at(i));
    }
    return result;
  }

  set_metadata_at(index: number, value: number): void {
    const offset = 23;
    this.view.setUint8((offset + index * 1), value);
  }

  set_metadata(value: number[]): void {
    const len = Math.min(this.get_metadata_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_metadata_at(i, value[i]);
    }
  }

  get metadata(): number[] {
    return this.get_metadata();
  }

  set metadata(value: number[]) {
    this.set_metadata(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ModifyOrderEntryInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ModifyOrderEntryInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(metadata_instruction_flags: number | bigint): bigint {
    const params = ModifyOrderEntryInstruction.Params.fromValues({
      metadata_instruction_flags: metadata_instruction_flags,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: ModifyOrderEntryInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["metadata.instruction_flags"] = params.metadata_instruction_flags;
    return record;
  }

  static footprintIrFromParams(params: ModifyOrderEntryInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: ModifyOrderEntryInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ModifyOrderEntryInstruction');
    return __tnBigIntToNumber(irResult, 'ModifyOrderEntryInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { metadata_instruction_flags: number | bigint }): number {
    const params = ModifyOrderEntryInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: ModifyOrderEntryInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: ModifyOrderEntryInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: ModifyOrderEntryInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ModifyOrderEntryInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ModifyOrderEntryInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: ModifyOrderEntryInstruction.Params }): ModifyOrderEntryInstruction | null {
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
    const state = new ModifyOrderEntryInstruction(buffer, cached);
    return state;
  }


}

export namespace ModifyOrderEntryInstruction {
  export type Params = {
    /** ABI path: metadata.instruction_flags */
    readonly metadata_instruction_flags: bigint;
  };

  export const ParamKeys = Object.freeze({
    metadata_instruction_flags: "metadata.instruction_flags",
  } as const);

  export const Params = {
    fromValues(input: { metadata_instruction_flags: number | bigint }): Params {
      return {
        metadata_instruction_flags: __tnToBigInt(input.metadata_instruction_flags),
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

  export function params(input: { metadata_instruction_flags: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class ModifyOrderEntryInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: ModifyOrderEntryInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: ModifyOrderEntryInstruction.Params | null = null;
  private __tnTail_metadata: Uint8Array | null = null;
  private __tnTailWriter_metadata?: __TnFamWriterResult<ModifyOrderEntryInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(23);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_instruction_flags(value: number): this {
    this.view.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(1, value);
    this.__tnInvalidate();
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint8(2, value);
    this.__tnInvalidate();
    return this;
  }

  set_order_entry_idx(value: number): this {
    this.view.setUint32(3, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_quantity(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_exp_time(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(15, cast, true);
    this.__tnInvalidate();
    return this;
  }

  metadata(): __TnFamWriterResult<ModifyOrderEntryInstructionBuilder> {
    if (!this.__tnTailWriter_metadata) {
      this.__tnTailWriter_metadata = __tnCreateFamWriter(this, "metadata", (payload) => {
        const bytes = new Uint8Array(payload);
        this.__tnTail_metadata = bytes;
        this.__tnInvalidate();
      });
    }
    return this.__tnTailWriter_metadata!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = ModifyOrderEntryInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = ModifyOrderEntryInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("ModifyOrderEntryInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): ModifyOrderEntryInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = ModifyOrderEntryInstruction.from_array(buffer, { params });
    if (!view) throw new Error("ModifyOrderEntryInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): ModifyOrderEntryInstruction {
    return this.finish();
  }

  dynamicParams(): ModifyOrderEntryInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): ModifyOrderEntryInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = ModifyOrderEntryInstruction.Params.fromValues({
      metadata_instruction_flags: (() => { return __tnToBigInt(this.view.getUint8(0)); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_metadata_bytes = this.__tnTail_metadata;
    const __tnExpected_metadata_bytes = ((((this.view.getUint8(0) >> 1) & 1) * 16) + (((this.view.getUint8(0) >> 2) & 1) * 8));
    if (__tnExpected_metadata_bytes > 0 && !__tnLocal_metadata_bytes) throw new Error("ModifyOrderEntryInstructionBuilder: field 'metadata' must be written before build");
    if (__tnLocal_metadata_bytes && __tnLocal_metadata_bytes.length !== __tnExpected_metadata_bytes) throw new Error("ModifyOrderEntryInstructionBuilder: field 'metadata' length does not match dynamic layout");
    if (__tnLocal_metadata_bytes) {
      target.set(__tnLocal_metadata_bytes, cursor);
      cursor += __tnLocal_metadata_bytes.length;
    }
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: ModifyOrderEntryInstruction.Params): void {
    const result = ModifyOrderEntryInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ ModifyOrderEntryInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("ModifyOrderEntryInstruction", (params) => ModifyOrderEntryInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ModifyOrderEntryInstruction", (buffer, params) => ModifyOrderEntryInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ModifyOrderEntryInstruction", (buffer) => { const result = ModifyOrderEntryInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OrderEntry ----- */

const __tn_ir_OrderEntry = {
  typeName: "OrderEntry",
  root: { op: "const", value: 64n }
} as const;

export class OrderEntry {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderEntry {
    if (!buffer || buffer.length === undefined) throw new Error("OrderEntry.__tnCreateView requires a Uint8Array");
    return new OrderEntry(new Uint8Array(buffer));
  }

  static builder(): OrderEntryBuilder {
    return new OrderEntryBuilder();
  }

  static fromBuilder(builder: OrderEntryBuilder): OrderEntry | null {
    const buffer = builder.build();
    return OrderEntry.from_array(buffer);
  }

  get_seat_ptrs(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_seat_ptrs(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get seat_ptrs(): bigint {
    return this.get_seat_ptrs();
  }

  set seat_ptrs(value: bigint) {
    this.set_seat_ptrs(value);
  }

  get_level_ptrs(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_level_ptrs(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get level_ptrs(): bigint {
    return this.get_level_ptrs();
  }

  set level_ptrs(value: bigint) {
    this.set_level_ptrs(value);
  }

  get_qty_in_lots(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_qty_in_lots(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get qty_in_lots(): bigint {
    return this.get_qty_in_lots();
  }

  set qty_in_lots(value: bigint) {
    this.set_qty_in_lots(value);
  }

  get_order_id(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_order_id(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get order_id(): bigint {
    return this.get_order_id();
  }

  set order_id(value: bigint) {
    this.set_order_id(value);
  }

  get_reserved0(): number[] {
    const offset = 32;
    const result: number[] = [];
    for (let i = 0; i < 8; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 32;
    if (value.length !== 8) {
      throw new Error('Array length must be 8');
    }
    for (let i = 0; i < 8; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_client_id(): ClientId {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 16);
    return ClientId.from_array(slice)!;
  }

  set_client_id(value: ClientId): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get client_id(): ClientId {
    return this.get_client_id();
  }

  set client_id(value: ClientId) {
    this.set_client_id(value);
  }

  get_expiry(): bigint {
    const offset = 56;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_expiry(value: bigint): void {
    const offset = 56;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get expiry(): bigint {
    return this.get_expiry();
  }

  set expiry(value: bigint) {
    this.set_expiry(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OrderEntry.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderEntry, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderEntry');
    }
    return __tnBigIntToNumber(irResult, 'OrderEntry::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 64) return { ok: false, code: "tn.buffer_too_small", consumed: 64 };
    return { ok: true, consumed: 64 };
  }

  static from_array(buffer: Uint8Array): OrderEntry | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderEntry(buffer);
  }

}

export class OrderEntryBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(64);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_ptrs(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_level_ptrs(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_qty_in_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_order_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 8) throw new Error("reserved0 expects 8 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 32 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_client_id(value: Uint8Array): this {
    if (value.length !== 16) throw new Error("client_id expects 16 bytes");
    this.buffer.set(value, 40);
    return this;
  }

  set_expiry(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(56, cast, true);
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

  finish(): OrderEntry {
    const view = OrderEntry.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OrderEntry");
    return view;
  }
}

__tnRegisterFootprint("OrderEntry", (params) => OrderEntry.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderEntry", (buffer, params) => OrderEntry.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderEntry", (buffer) => { const result = OrderEntry.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SeatAssignedEvent ----- */

const __tn_ir_SeatAssignedEvent = {
  typeName: "SeatAssignedEvent",
  root: { op: "const", value: 68n }
} as const;

export class SeatAssignedEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SeatAssignedEvent {
    if (!buffer || buffer.length === undefined) throw new Error("SeatAssignedEvent.__tnCreateView requires a Uint8Array");
    return new SeatAssignedEvent(new Uint8Array(buffer));
  }

  static builder(): SeatAssignedEventBuilder {
    return new SeatAssignedEventBuilder();
  }

  static fromBuilder(builder: SeatAssignedEventBuilder): SeatAssignedEvent | null {
    const buffer = builder.build();
    return SeatAssignedEvent.from_array(buffer);
  }

  get_seat_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_seat_authority(): Pubkey {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
    this.buffer.set(sourceBytes, offset);
  }

  get seat_authority(): Pubkey {
    return this.get_seat_authority();
  }

  set seat_authority(value: Pubkey) {
    this.set_seat_authority(value);
  }

  get_market(): Pubkey {
    const offset = 36;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 36;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SeatAssignedEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SeatAssignedEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SeatAssignedEvent');
    }
    return __tnBigIntToNumber(irResult, 'SeatAssignedEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 68) return { ok: false, code: "tn.buffer_too_small", consumed: 68 };
    return { ok: true, consumed: 68 };
  }

  static from_array(buffer: Uint8Array): SeatAssignedEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SeatAssignedEvent(buffer);
  }

}

export class SeatAssignedEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(68);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority expects 32 bytes");
    this.buffer.set(value, 4);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
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

  finish(): SeatAssignedEvent {
    const view = SeatAssignedEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SeatAssignedEvent");
    return view;
  }
}

__tnRegisterFootprint("SeatAssignedEvent", (params) => SeatAssignedEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("SeatAssignedEvent", (buffer, params) => SeatAssignedEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SeatAssignedEvent", (buffer) => { const result = SeatAssignedEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SeatCreateInstruction ----- */

const __tn_ir_SeatCreateInstruction = {
  typeName: "SeatCreateInstruction",
  root: { op: "const", value: 7n }
} as const;

export class SeatCreateInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SeatCreateInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("SeatCreateInstruction.__tnCreateView requires a Uint8Array");
    return new SeatCreateInstruction(new Uint8Array(buffer));
  }

  static builder(): SeatCreateInstructionBuilder {
    return new SeatCreateInstructionBuilder();
  }

  static fromBuilder(builder: SeatCreateInstructionBuilder): SeatCreateInstruction | null {
    const buffer = builder.build();
    return SeatCreateInstruction.from_array(buffer);
  }

  get_market_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
  }

  get_seat_authority_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_seat_authority_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get seat_authority_account_idx(): number {
    return this.get_seat_authority_account_idx();
  }

  set seat_authority_account_idx(value: number) {
    this.set_seat_authority_account_idx(value);
  }

  get_reserved0(): number[] {
    const offset = 3;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 3;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SeatCreateInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SeatCreateInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SeatCreateInstruction');
    }
    return __tnBigIntToNumber(irResult, 'SeatCreateInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static from_array(buffer: Uint8Array): SeatCreateInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SeatCreateInstruction(buffer);
  }

}

export class SeatCreateInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(7);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_seat_authority_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved0 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 3 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
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

  finish(): SeatCreateInstruction {
    const view = SeatCreateInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SeatCreateInstruction");
    return view;
  }
}

__tnRegisterFootprint("SeatCreateInstruction", (params) => SeatCreateInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("SeatCreateInstruction", (buffer, params) => SeatCreateInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SeatCreateInstruction", (buffer) => { const result = SeatCreateInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SeatEntry ----- */

const __tn_ir_SeatEntry = {
  typeName: "SeatEntry",
  root: { op: "const", value: 64n }
} as const;

export class SeatEntry {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SeatEntry {
    if (!buffer || buffer.length === undefined) throw new Error("SeatEntry.__tnCreateView requires a Uint8Array");
    return new SeatEntry(new Uint8Array(buffer));
  }

  static builder(): SeatEntryBuilder {
    return new SeatEntryBuilder();
  }

  static fromBuilder(builder: SeatEntryBuilder): SeatEntry | null {
    const buffer = builder.build();
    return SeatEntry.from_array(buffer);
  }

  get_seat_authority_pubkey(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_seat_authority_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get seat_authority_pubkey(): Pubkey {
    return this.get_seat_authority_pubkey();
  }

  set seat_authority_pubkey(value: Pubkey) {
    this.set_seat_authority_pubkey(value);
  }

  get_quantity_base(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity_base(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity_base(): bigint {
    return this.get_quantity_base();
  }

  set quantity_base(value: bigint) {
    this.set_quantity_base(value);
  }

  get_quantity_quote(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity_quote(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity_quote(): bigint {
    return this.get_quantity_quote();
  }

  set quantity_quote(value: bigint) {
    this.set_quantity_quote(value);
  }

  get_head_order_entry_idx(): number {
    const offset = 48;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_head_order_entry_idx(value: number): void {
    const offset = 48;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get head_order_entry_idx(): number {
    return this.get_head_order_entry_idx();
  }

  set head_order_entry_idx(value: number) {
    this.set_head_order_entry_idx(value);
  }

  get_reserved0(): number {
    const offset = 52;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 52;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_non_nullable_reserved(): bigint {
    const offset = 56;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_non_nullable_reserved(value: bigint): void {
    const offset = 56;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get non_nullable_reserved(): bigint {
    return this.get_non_nullable_reserved();
  }

  set non_nullable_reserved(value: bigint) {
    this.set_non_nullable_reserved(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SeatEntry.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SeatEntry, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SeatEntry');
    }
    return __tnBigIntToNumber(irResult, 'SeatEntry::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 64) return { ok: false, code: "tn.buffer_too_small", consumed: 64 };
    return { ok: true, consumed: 64 };
  }

  static from_array(buffer: Uint8Array): SeatEntry | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SeatEntry(buffer);
  }

}

export class SeatEntryBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(64);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_authority_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority_pubkey expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_quantity_base(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    return this;
  }

  set_quantity_quote(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
    return this;
  }

  set_head_order_entry_idx(value: number): this {
    this.view.setUint32(48, value, true);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint32(52, value, true);
    return this;
  }

  set_non_nullable_reserved(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(56, cast, true);
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

  finish(): SeatEntry {
    const view = SeatEntry.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SeatEntry");
    return view;
  }
}

__tnRegisterFootprint("SeatEntry", (params) => SeatEntry.__tnInvokeFootprint(params));
__tnRegisterValidate("SeatEntry", (buffer, params) => SeatEntry.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SeatEntry", (buffer) => { const result = SeatEntry.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenBalanceEvent ----- */

const __tn_ir_TokenBalanceEvent = {
  typeName: "TokenBalanceEvent",
  root: { op: "const", value: 160n }
} as const;

export class TokenBalanceEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenBalanceEvent {
    if (!buffer || buffer.length === undefined) throw new Error("TokenBalanceEvent.__tnCreateView requires a Uint8Array");
    return new TokenBalanceEvent(new Uint8Array(buffer));
  }

  static builder(): TokenBalanceEventBuilder {
    return new TokenBalanceEventBuilder();
  }

  static fromBuilder(builder: TokenBalanceEventBuilder): TokenBalanceEvent | null {
    const buffer = builder.build();
    return TokenBalanceEvent.from_array(buffer);
  }

  get_seat_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_token_side(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_token_side(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get token_side(): number {
    return this.get_token_side();
  }

  set token_side(value: number) {
    this.set_token_side(value);
  }

  get_reserved0(): number[] {
    const offset = 5;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 5;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_amount(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_quantity_base(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity_base(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity_base(): bigint {
    return this.get_quantity_base();
  }

  set quantity_base(value: bigint) {
    this.set_quantity_base(value);
  }

  get_quantity_quote(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity_quote(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity_quote(): bigint {
    return this.get_quantity_quote();
  }

  set quantity_quote(value: bigint) {
    this.set_quantity_quote(value);
  }

  get_market(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_seat_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get seat_authority(): Pubkey {
    return this.get_seat_authority();
  }

  set seat_authority(value: Pubkey) {
    this.set_seat_authority(value);
  }

  get_wallet(): Pubkey {
    const offset = 96;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_wallet(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 96;
    this.buffer.set(sourceBytes, offset);
  }

  get wallet(): Pubkey {
    return this.get_wallet();
  }

  set wallet(value: Pubkey) {
    this.set_wallet(value);
  }

  get_vault(): Pubkey {
    const offset = 128;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 128;
    this.buffer.set(sourceBytes, offset);
  }

  get vault(): Pubkey {
    return this.get_vault();
  }

  set vault(value: Pubkey) {
    this.set_vault(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenBalanceEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenBalanceEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenBalanceEvent');
    }
    return __tnBigIntToNumber(irResult, 'TokenBalanceEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 160) return { ok: false, code: "tn.buffer_too_small", consumed: 160 };
    return { ok: true, consumed: 160 };
  }

  static from_array(buffer: Uint8Array): TokenBalanceEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TokenBalanceEvent(buffer);
  }

}

export class TokenBalanceEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(160);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_token_side(value: number): this {
    this.view.setUint8(4, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 3) throw new Error("reserved0 expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 5 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_quantity_base(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_quantity_quote(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_wallet(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("wallet expects 32 bytes");
    this.buffer.set(value, 96);
    return this;
  }

  set_vault(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault expects 32 bytes");
    this.buffer.set(value, 128);
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

  finish(): TokenBalanceEvent {
    const view = TokenBalanceEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TokenBalanceEvent");
    return view;
  }
}

__tnRegisterFootprint("TokenBalanceEvent", (params) => TokenBalanceEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenBalanceEvent", (buffer, params) => TokenBalanceEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenBalanceEvent", (buffer) => { const result = TokenBalanceEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenTransferInstruction ----- */

const __tn_ir_TokenTransferInstruction = {
  typeName: "TokenTransferInstruction",
  root: { op: "const", value: 23n }
} as const;

export class TokenTransferInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TokenTransferInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("TokenTransferInstruction.__tnCreateView requires a Uint8Array");
    return new TokenTransferInstruction(new Uint8Array(buffer));
  }

  static builder(): TokenTransferInstructionBuilder {
    return new TokenTransferInstructionBuilder();
  }

  static fromBuilder(builder: TokenTransferInstructionBuilder): TokenTransferInstruction | null {
    const buffer = builder.build();
    return TokenTransferInstruction.from_array(buffer);
  }

  get_market_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_market_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get market_record_idx(): number {
    return this.get_market_record_idx();
  }

  set market_record_idx(value: number) {
    this.set_market_record_idx(value);
  }

  get_token_program_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_idx(): number {
    return this.get_token_program_idx();
  }

  set token_program_idx(value: number) {
    this.set_token_program_idx(value);
  }

  get_reserved0(): number[] {
    const offset = 3;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 3;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_amount(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_from_account_idx(): number {
    const offset = 15;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_from_account_idx(value: number): void {
    const offset = 15;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get from_account_idx(): number {
    return this.get_from_account_idx();
  }

  set from_account_idx(value: number) {
    this.set_from_account_idx(value);
  }

  get_to_account_idx(): number {
    const offset = 17;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_to_account_idx(value: number): void {
    const offset = 17;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get to_account_idx(): number {
    return this.get_to_account_idx();
  }

  set to_account_idx(value: number) {
    this.set_to_account_idx(value);
  }

  get_reserved1(): number[] {
    const offset = 19;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved1(value: number[]): void {
    const offset = 19;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved1(): number[] {
    return this.get_reserved1();
  }

  set reserved1(value: number[]) {
    this.set_reserved1(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_TokenTransferInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TokenTransferInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TokenTransferInstruction');
    }
    return __tnBigIntToNumber(irResult, 'TokenTransferInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 23) return { ok: false, code: "tn.buffer_too_small", consumed: 23 };
    return { ok: true, consumed: 23 };
  }

  static from_array(buffer: Uint8Array): TokenTransferInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TokenTransferInstruction(buffer);
  }

}

export class TokenTransferInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(23);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_token_program_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved0 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 3 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    return this;
  }

  set_from_account_idx(value: number): this {
    this.view.setUint16(15, value, true);
    return this;
  }

  set_to_account_idx(value: number): this {
    this.view.setUint16(17, value, true);
    return this;
  }

  set_reserved1(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved1 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 19 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
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

  finish(): TokenTransferInstruction {
    const view = TokenTransferInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TokenTransferInstruction");
    return view;
  }
}

__tnRegisterFootprint("TokenTransferInstruction", (params) => TokenTransferInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenTransferInstruction", (buffer, params) => TokenTransferInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("TokenTransferInstruction", (buffer) => { const result = TokenTransferInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CbookAccount ----- */

const __tn_ir_CbookAccount = {
  typeName: "CbookAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 16n } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "div", left: { op: "sub", left: { op: "field", param: "__buffer_size" }, right: { op: "const", value: 16n } }, right: { op: "const", value: 8n } }, right: { op: "const", value: 8n } } } } }
} as const;

export class CbookAccount {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;

  private constructor(private buffer: Uint8Array, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CbookAccount {
    if (!buffer || buffer.length === undefined) throw new Error("CbookAccount.__tnCreateView requires a Uint8Array");
    return new CbookAccount(new Uint8Array(buffer), opts?.fieldContext);
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CbookAccount::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CbookAccount::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CbookAccount: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  get_header(): CbookHeader {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 16);
    return CbookHeader.from_array(slice)!;
  }

  set_header(value: CbookHeader): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get header(): CbookHeader {
    return this.get_header();
  }

  set header(value: CbookHeader) {
    this.set_header(value);
  }

  get_levels_length(): number {
    return ((this.buffer.length - 16) / 8);
  }

  get_levels_at(index: number): CbookLevel {
    const offset = 16;
    const slice = this.buffer.subarray((offset + index * 8), (offset + (index + 1) * 8));
    return CbookLevel.from_array(slice)!;
  }

  get_levels(): CbookLevel[] {
    const len = this.get_levels_length();
    const result: CbookLevel[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_levels_at(i));
    }
    return result;
  }

  set_levels_at(index: number, value: CbookLevel): void {
    const offset = 16;
    const slice = this.buffer.subarray(offset + index * 8, offset + (index + 1) * 8);
    slice.set(value['buffer']);
  }

  set_levels(value: CbookLevel[]): void {
    const len = Math.min(this.get_levels_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_levels_at(i, value[i]);
    }
  }

  get levels(): CbookLevel[] {
    return this.get_levels();
  }

  set levels(value: CbookLevel[]) {
    this.set_levels(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CbookAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CbookAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CbookAccount');
    }
    return __tnBigIntToNumber(irResult, 'CbookAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (!buffer || buffer.length === undefined) return { ok: false, code: "tn.invalid_buffer" };
    const irResult = this.__tnValidateInternal(buffer, Object.create(null));
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CbookAccount::validate') : undefined };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CbookAccount::validate') : undefined;
    if (consumed !== buffer.length) return { ok: false, code: "tn.trailing_bytes", consumed };
    return { ok: true, consumed };
  }

  static from_array(buffer: Uint8Array): CbookAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CbookAccount(buffer);
  }

}

__tnRegisterFootprint("CbookAccount", (params) => CbookAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("CbookAccount", (buffer, params) => CbookAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CbookAccount", (buffer) => { const result = CbookAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ClobInstruction ----- */

const __tn_ir_ClobInstruction = {
  typeName: "ClobInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class ClobInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): ClobInstruction_payload_Inner {
    return new ClobInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asMarketRecord(): MarketRecordInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return MarketRecordInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSeatCreate(): SeatCreateInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return SeatCreateInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTokenDeposit(): TokenTransferInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return TokenTransferInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTokenWithdraw(): TokenTransferInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return TokenTransferInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateOrderEntry(): CreateOrderEntryInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return CreateOrderEntryInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asModifyOrderEntry(): ModifyOrderEntryInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 5) return null;
    return ModifyOrderEntryInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetStatus(): MarketSetStatusInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 8) return null;
    return MarketSetStatusInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketCreate(): MarketCreateInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 9) return null;
    return MarketCreateInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateSeatlessOrderEntry(): CreateSeatlessOrderEntryInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 10) return null;
    return CreateSeatlessOrderEntryInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class ClobInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: ClobInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: ClobInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = ClobInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("ClobInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: ClobInstruction.Params, fieldContext?: Record<string, number | bigint> }): ClobInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ClobInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = ClobInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("ClobInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new ClobInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): ClobInstruction.Params {
    return this.__tnParams;
  }

  static builder(): ClobInstructionBuilder {
    return new ClobInstructionBuilder();
  }

  static fromBuilder(builder: ClobInstructionBuilder): ClobInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return ClobInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "market_record",
      tag: 0,
      payloadSize: 23,
      payloadType: "ClobInstruction::payload::market_record",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketRecordInstruction),
    },
    {
      name: "seat_create",
      tag: 1,
      payloadSize: 7,
      payloadType: "ClobInstruction::payload::seat_create",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SeatCreateInstruction),
    },
    {
      name: "token_deposit",
      tag: 2,
      payloadSize: 23,
      payloadType: "ClobInstruction::payload::token_deposit",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenTransferInstruction),
    },
    {
      name: "token_withdraw",
      tag: 3,
      payloadSize: 23,
      payloadType: "ClobInstruction::payload::token_withdraw",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenTransferInstruction),
    },
    {
      name: "create_order_entry",
      tag: 4,
      payloadSize: null,
      payloadType: "ClobInstruction::payload::create_order_entry",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateOrderEntryInstruction),
    },
    {
      name: "modify_order_entry",
      tag: 5,
      payloadSize: null,
      payloadType: "ClobInstruction::payload::modify_order_entry",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ModifyOrderEntryInstruction),
    },
    {
      name: "market_set_status",
      tag: 8,
      payloadSize: 7,
      payloadType: "ClobInstruction::payload::market_set_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetStatusInstruction),
    },
    {
      name: "market_create",
      tag: 9,
      payloadSize: null,
      payloadType: "ClobInstruction::payload::market_create",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketCreateInstruction),
    },
    {
      name: "create_seatless_order_entry",
      tag: 10,
      payloadSize: null,
      payloadType: "ClobInstruction::payload::create_seatless_order_entry",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateSeatlessOrderEntryInstruction),
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
      case 8: break;
      case 9: break;
      case 10: break;
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: ClobInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_discriminant = __tnToBigInt(view.getUint8(0));
    const __tnLayout = ClobInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = ClobInstruction.Params.fromValues({
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

  payloadVariant(): typeof ClobInstruction.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return ClobInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): ClobInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("ClobInstruction: unknown payload variant");
    const offset = ClobInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("ClobInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return ClobInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ClobInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ClobInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_discriminant: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = ClobInstruction.Params.fromValues({
      payload_discriminant: payload_discriminant,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: ClobInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.discriminant"] = params.payload_discriminant;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: ClobInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: ClobInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ClobInstruction');
    return __tnBigIntToNumber(irResult, 'ClobInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_discriminant: number | bigint, payload_payload_size: number | bigint }): number {
    const params = ClobInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: ClobInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: ClobInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: ClobInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ClobInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ClobInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: ClobInstruction.Params }): ClobInstruction | null {
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
    const state = new ClobInstruction(buffer, cached);
    return state;
  }


}

export namespace ClobInstruction {
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

export class ClobInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_discriminant: number | null = null;
  private __tnPayload_payload: { descriptor: typeof ClobInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: ClobInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: ClobInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<ClobInstructionBuilder>;

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

  payload(): __TnVariantSelectorResult<ClobInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, ClobInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_discriminant(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("ClobInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ClobInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = ClobInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("ClobInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ClobInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = ClobInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("ClobInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): ClobInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = ClobInstruction.from_array(buffer, { params });
    if (!view) throw new Error("ClobInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): ClobInstruction {
    return this.finish();
  }

  dynamicParams(): ClobInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): ClobInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = ClobInstruction.Params.fromValues({
      payload_discriminant: (() => { if (this.__tnField_discriminant === null) throw new Error("ClobInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_discriminant); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("ClobInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_discriminant === null) throw new Error("ClobInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ClobInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_discriminant);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: ClobInstruction.Params): void {
    const result = ClobInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ ClobInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("ClobInstruction", (params) => ClobInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ClobInstruction", (buffer, params) => ClobInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ClobInstruction", (buffer) => { const result = ClobInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketAccount ----- */

const __tn_ir_MarketAccount = {
  typeName: "MarketAccount",
  root: { op: "const", value: 256n }
} as const;

export class MarketAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketAccount {
    if (!buffer || buffer.length === undefined) throw new Error("MarketAccount.__tnCreateView requires a Uint8Array");
    return new MarketAccount(new Uint8Array(buffer));
  }

  static builder(): MarketAccountBuilder {
    return new MarketAccountBuilder();
  }

  static fromBuilder(builder: MarketAccountBuilder): MarketAccount | null {
    const buffer = builder.build();
    return MarketAccount.from_array(buffer);
  }

  get_magic(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_magic(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get magic(): number {
    return this.get_magic();
  }

  set magic(value: number) {
    this.set_magic(value);
  }

  get_status_flags(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_status_flags(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get status_flags(): number {
    return this.get_status_flags();
  }

  set status_flags(value: number) {
    this.set_status_flags(value);
  }

  get_reserved0(): number[] {
    const offset = 2;
    const result: number[] = [];
    for (let i = 0; i < 6; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 2;
    if (value.length !== 6) {
      throw new Error('Array length must be 6');
    }
    for (let i = 0; i < 6; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_lot_size(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lot_size(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lot_size(): bigint {
    return this.get_lot_size();
  }

  set lot_size(value: bigint) {
    this.set_lot_size(value);
  }

  get_tick_size(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_tick_size(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get tick_size(): bigint {
    return this.get_tick_size();
  }

  set tick_size(value: bigint) {
    this.set_tick_size(value);
  }

  get_next_order_id(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_next_order_id(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get next_order_id(): bigint {
    return this.get_next_order_id();
  }

  set next_order_id(value: bigint) {
    this.set_next_order_id(value);
  }

  get_order_entry_pubkey(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_order_entry_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get order_entry_pubkey(): Pubkey {
    return this.get_order_entry_pubkey();
  }

  set order_entry_pubkey(value: Pubkey) {
    this.set_order_entry_pubkey(value);
  }

  get_bids_cbook_pubkey(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_bids_cbook_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get bids_cbook_pubkey(): Pubkey {
    return this.get_bids_cbook_pubkey();
  }

  set bids_cbook_pubkey(value: Pubkey) {
    this.set_bids_cbook_pubkey(value);
  }

  get_asks_cbook_pubkey(): Pubkey {
    const offset = 96;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_asks_cbook_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 96;
    this.buffer.set(sourceBytes, offset);
  }

  get asks_cbook_pubkey(): Pubkey {
    return this.get_asks_cbook_pubkey();
  }

  set asks_cbook_pubkey(value: Pubkey) {
    this.set_asks_cbook_pubkey(value);
  }

  get_token_program_pubkey(): Pubkey {
    const offset = 128;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_token_program_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 128;
    this.buffer.set(sourceBytes, offset);
  }

  get token_program_pubkey(): Pubkey {
    return this.get_token_program_pubkey();
  }

  set token_program_pubkey(value: Pubkey) {
    this.set_token_program_pubkey(value);
  }

  get_base_vault_pubkey(): Pubkey {
    const offset = 160;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_base_vault_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 160;
    this.buffer.set(sourceBytes, offset);
  }

  get base_vault_pubkey(): Pubkey {
    return this.get_base_vault_pubkey();
  }

  set base_vault_pubkey(value: Pubkey) {
    this.set_base_vault_pubkey(value);
  }

  get_quote_vault_pubkey(): Pubkey {
    const offset = 192;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_quote_vault_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 192;
    this.buffer.set(sourceBytes, offset);
  }

  get quote_vault_pubkey(): Pubkey {
    return this.get_quote_vault_pubkey();
  }

  set quote_vault_pubkey(value: Pubkey) {
    this.set_quote_vault_pubkey(value);
  }

  get_market_authority_pubkey(): Pubkey {
    const offset = 224;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market_authority_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 224;
    this.buffer.set(sourceBytes, offset);
  }

  get market_authority_pubkey(): Pubkey {
    return this.get_market_authority_pubkey();
  }

  set market_authority_pubkey(value: Pubkey) {
    this.set_market_authority_pubkey(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketAccount');
    }
    return __tnBigIntToNumber(irResult, 'MarketAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 256) return { ok: false, code: "tn.buffer_too_small", consumed: 256 };
    return { ok: true, consumed: 256 };
  }

  static from_array(buffer: Uint8Array): MarketAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketAccount(buffer);
  }

}

export class MarketAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(256);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_magic(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_status_flags(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 6) throw new Error("reserved0 expects 6 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 2 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_lot_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_tick_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_next_order_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_order_entry_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("order_entry_pubkey expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_bids_cbook_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("bids_cbook_pubkey expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_asks_cbook_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("asks_cbook_pubkey expects 32 bytes");
    this.buffer.set(value, 96);
    return this;
  }

  set_token_program_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("token_program_pubkey expects 32 bytes");
    this.buffer.set(value, 128);
    return this;
  }

  set_base_vault_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("base_vault_pubkey expects 32 bytes");
    this.buffer.set(value, 160);
    return this;
  }

  set_quote_vault_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("quote_vault_pubkey expects 32 bytes");
    this.buffer.set(value, 192);
    return this;
  }

  set_market_authority_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market_authority_pubkey expects 32 bytes");
    this.buffer.set(value, 224);
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

  finish(): MarketAccount {
    const view = MarketAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketAccount");
    return view;
  }
}

__tnRegisterFootprint("MarketAccount", (params) => MarketAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketAccount", (buffer, params) => MarketAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketAccount", (buffer) => { const result = MarketAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketCreatedEvent ----- */

const __tn_ir_MarketCreatedEvent = {
  typeName: "MarketCreatedEvent",
  root: { op: "const", value: 304n }
} as const;

export class MarketCreatedEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketCreatedEvent {
    if (!buffer || buffer.length === undefined) throw new Error("MarketCreatedEvent.__tnCreateView requires a Uint8Array");
    return new MarketCreatedEvent(new Uint8Array(buffer));
  }

  static builder(): MarketCreatedEventBuilder {
    return new MarketCreatedEventBuilder();
  }

  static fromBuilder(builder: MarketCreatedEventBuilder): MarketCreatedEvent | null {
    const buffer = builder.build();
    return MarketCreatedEvent.from_array(buffer);
  }

  get_lot_size(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lot_size(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lot_size(): bigint {
    return this.get_lot_size();
  }

  set lot_size(value: bigint) {
    this.set_lot_size(value);
  }

  get_tick_size(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_tick_size(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get tick_size(): bigint {
    return this.get_tick_size();
  }

  set tick_size(value: bigint) {
    this.set_tick_size(value);
  }

  get_base_mint(): Pubkey {
    const offset = 16;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_base_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 16;
    this.buffer.set(sourceBytes, offset);
  }

  get base_mint(): Pubkey {
    return this.get_base_mint();
  }

  set base_mint(value: Pubkey) {
    this.set_base_mint(value);
  }

  get_quote_mint(): Pubkey {
    const offset = 48;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_quote_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 48;
    this.buffer.set(sourceBytes, offset);
  }

  get quote_mint(): Pubkey {
    return this.get_quote_mint();
  }

  set quote_mint(value: Pubkey) {
    this.set_quote_mint(value);
  }

  get_market_authority(): Pubkey {
    const offset = 80;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 80;
    this.buffer.set(sourceBytes, offset);
  }

  get market_authority(): Pubkey {
    return this.get_market_authority();
  }

  set market_authority(value: Pubkey) {
    this.set_market_authority(value);
  }

  get_market(): Pubkey {
    const offset = 112;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 112;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_order_arena(): Pubkey {
    const offset = 144;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_order_arena(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 144;
    this.buffer.set(sourceBytes, offset);
  }

  get order_arena(): Pubkey {
    return this.get_order_arena();
  }

  set order_arena(value: Pubkey) {
    this.set_order_arena(value);
  }

  get_bids_cbook(): Pubkey {
    const offset = 176;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_bids_cbook(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 176;
    this.buffer.set(sourceBytes, offset);
  }

  get bids_cbook(): Pubkey {
    return this.get_bids_cbook();
  }

  set bids_cbook(value: Pubkey) {
    this.set_bids_cbook(value);
  }

  get_asks_cbook(): Pubkey {
    const offset = 208;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_asks_cbook(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 208;
    this.buffer.set(sourceBytes, offset);
  }

  get asks_cbook(): Pubkey {
    return this.get_asks_cbook();
  }

  set asks_cbook(value: Pubkey) {
    this.set_asks_cbook(value);
  }

  get_base_vault(): Pubkey {
    const offset = 240;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_base_vault(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 240;
    this.buffer.set(sourceBytes, offset);
  }

  get base_vault(): Pubkey {
    return this.get_base_vault();
  }

  set base_vault(value: Pubkey) {
    this.set_base_vault(value);
  }

  get_quote_vault(): Pubkey {
    const offset = 272;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_quote_vault(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 272;
    this.buffer.set(sourceBytes, offset);
  }

  get quote_vault(): Pubkey {
    return this.get_quote_vault();
  }

  set quote_vault(value: Pubkey) {
    this.set_quote_vault(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketCreatedEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketCreatedEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketCreatedEvent');
    }
    return __tnBigIntToNumber(irResult, 'MarketCreatedEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 304) return { ok: false, code: "tn.buffer_too_small", consumed: 304 };
    return { ok: true, consumed: 304 };
  }

  static from_array(buffer: Uint8Array): MarketCreatedEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketCreatedEvent(buffer);
  }

}

export class MarketCreatedEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(304);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_lot_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_tick_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_base_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("base_mint expects 32 bytes");
    this.buffer.set(value, 16);
    return this;
  }

  set_quote_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("quote_mint expects 32 bytes");
    this.buffer.set(value, 48);
    return this;
  }

  set_market_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market_authority expects 32 bytes");
    this.buffer.set(value, 80);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 112);
    return this;
  }

  set_order_arena(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("order_arena expects 32 bytes");
    this.buffer.set(value, 144);
    return this;
  }

  set_bids_cbook(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("bids_cbook expects 32 bytes");
    this.buffer.set(value, 176);
    return this;
  }

  set_asks_cbook(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("asks_cbook expects 32 bytes");
    this.buffer.set(value, 208);
    return this;
  }

  set_base_vault(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("base_vault expects 32 bytes");
    this.buffer.set(value, 240);
    return this;
  }

  set_quote_vault(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("quote_vault expects 32 bytes");
    this.buffer.set(value, 272);
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

  finish(): MarketCreatedEvent {
    const view = MarketCreatedEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketCreatedEvent");
    return view;
  }
}

__tnRegisterFootprint("MarketCreatedEvent", (params) => MarketCreatedEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketCreatedEvent", (buffer, params) => MarketCreatedEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketCreatedEvent", (buffer) => { const result = MarketCreatedEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketStatusEvent ----- */

const __tn_ir_MarketStatusEvent = {
  typeName: "MarketStatusEvent",
  root: { op: "const", value: 72n }
} as const;

export class MarketStatusEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketStatusEvent {
    if (!buffer || buffer.length === undefined) throw new Error("MarketStatusEvent.__tnCreateView requires a Uint8Array");
    return new MarketStatusEvent(new Uint8Array(buffer));
  }

  static builder(): MarketStatusEventBuilder {
    return new MarketStatusEventBuilder();
  }

  static fromBuilder(builder: MarketStatusEventBuilder): MarketStatusEvent | null {
    const buffer = builder.build();
    return MarketStatusEvent.from_array(buffer);
  }

  get_status_flags(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_status_flags(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get status_flags(): number {
    return this.get_status_flags();
  }

  set status_flags(value: number) {
    this.set_status_flags(value);
  }

  get_reserved0(): number[] {
    const offset = 1;
    const result: number[] = [];
    for (let i = 0; i < 7; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 1;
    if (value.length !== 7) {
      throw new Error('Array length must be 7');
    }
    for (let i = 0; i < 7; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_market(): Pubkey {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_market_authority(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get market_authority(): Pubkey {
    return this.get_market_authority();
  }

  set market_authority(value: Pubkey) {
    this.set_market_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketStatusEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketStatusEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketStatusEvent');
    }
    return __tnBigIntToNumber(irResult, 'MarketStatusEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 72) return { ok: false, code: "tn.buffer_too_small", consumed: 72 };
    return { ok: true, consumed: 72 };
  }

  static from_array(buffer: Uint8Array): MarketStatusEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketStatusEvent(buffer);
  }

}

export class MarketStatusEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(72);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_status_flags(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 7) throw new Error("reserved0 expects 7 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 1 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 8);
    return this;
  }

  set_market_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market_authority expects 32 bytes");
    this.buffer.set(value, 40);
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

  finish(): MarketStatusEvent {
    const view = MarketStatusEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketStatusEvent");
    return view;
  }
}

__tnRegisterFootprint("MarketStatusEvent", (params) => MarketStatusEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketStatusEvent", (buffer, params) => MarketStatusEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketStatusEvent", (buffer) => { const result = MarketStatusEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OrderArenaAccount ----- */

const __tn_ir_OrderArenaAccount = {
  typeName: "OrderArenaAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 8n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 64n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "div", left: { op: "sub", left: { op: "field", param: "__buffer_size" }, right: { op: "const", value: 72n } }, right: { op: "const", value: 64n } }, right: { op: "const", value: 64n } } } } }
} as const;

export class OrderArenaAccount {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;

  private constructor(private buffer: Uint8Array, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderArenaAccount {
    if (!buffer || buffer.length === undefined) throw new Error("OrderArenaAccount.__tnCreateView requires a Uint8Array");
    return new OrderArenaAccount(new Uint8Array(buffer), opts?.fieldContext);
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "OrderArenaAccount::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "OrderArenaAccount::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("OrderArenaAccount: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  get_reserved_header(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 8; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved_header(value: number[]): void {
    const offset = 0;
    if (value.length !== 8) {
      throw new Error('Array length must be 8');
    }
    for (let i = 0; i < 8; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved_header(): number[] {
    return this.get_reserved_header();
  }

  set reserved_header(value: number[]) {
    this.set_reserved_header(value);
  }

  get_header(): ArenaHeader {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 64);
    return ArenaHeader.from_array(slice)!;
  }

  set_header(value: ArenaHeader): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get header(): ArenaHeader {
    return this.get_header();
  }

  set header(value: ArenaHeader) {
    this.set_header(value);
  }

  get_entries_length(): number {
    return ((this.buffer.length - 72) / 64);
  }

  get_entries_at(index: number): OrderEntry {
    const offset = 72;
    const slice = this.buffer.subarray((offset + index * 64), (offset + (index + 1) * 64));
    return OrderEntry.from_array(slice)!;
  }

  get_entries(): OrderEntry[] {
    const len = this.get_entries_length();
    const result: OrderEntry[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_entries_at(i));
    }
    return result;
  }

  set_entries_at(index: number, value: OrderEntry): void {
    const offset = 72;
    const slice = this.buffer.subarray(offset + index * 64, offset + (index + 1) * 64);
    slice.set(value['buffer']);
  }

  set_entries(value: OrderEntry[]): void {
    const len = Math.min(this.get_entries_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_entries_at(i, value[i]);
    }
  }

  get entries(): OrderEntry[] {
    return this.get_entries();
  }

  set entries(value: OrderEntry[]) {
    this.set_entries(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OrderArenaAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderArenaAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderArenaAccount');
    }
    return __tnBigIntToNumber(irResult, 'OrderArenaAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (!buffer || buffer.length === undefined) return { ok: false, code: "tn.invalid_buffer" };
    const irResult = this.__tnValidateInternal(buffer, Object.create(null));
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OrderArenaAccount::validate') : undefined };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OrderArenaAccount::validate') : undefined;
    if (consumed !== buffer.length) return { ok: false, code: "tn.trailing_bytes", consumed };
    return { ok: true, consumed };
  }

  static from_array(buffer: Uint8Array): OrderArenaAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderArenaAccount(buffer);
  }

}

__tnRegisterFootprint("OrderArenaAccount", (params) => OrderArenaAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderArenaAccount", (buffer, params) => OrderArenaAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderArenaAccount", (buffer) => { const result = OrderArenaAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OrderCancelledEvent ----- */

const __tn_ir_OrderCancelledEvent = {
  typeName: "OrderCancelledEvent",
  root: { op: "const", value: 104n }
} as const;

export class OrderCancelledEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderCancelledEvent {
    if (!buffer || buffer.length === undefined) throw new Error("OrderCancelledEvent.__tnCreateView requires a Uint8Array");
    return new OrderCancelledEvent(new Uint8Array(buffer));
  }

  static builder(): OrderCancelledEventBuilder {
    return new OrderCancelledEventBuilder();
  }

  static fromBuilder(builder: OrderCancelledEventBuilder): OrderCancelledEvent | null {
    const buffer = builder.build();
    return OrderCancelledEvent.from_array(buffer);
  }

  get_seat_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_side(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_side(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get side(): number {
    return this.get_side();
  }

  set side(value: number) {
    this.set_side(value);
  }

  get_order_type(): number {
    const offset = 5;
    return this.view.getUint8(offset);
  }

  set_order_type(value: number): void {
    const offset = 5;
    this.view.setUint8(offset, value);
  }

  get order_type(): number {
    return this.get_order_type();
  }

  set order_type(value: number) {
    this.set_order_type(value);
  }

  get_reserved0(): number[] {
    const offset = 6;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 6;
    if (value.length !== 2) {
      throw new Error('Array length must be 2');
    }
    for (let i = 0; i < 2; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_price(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_qty(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_qty(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get qty(): bigint {
    return this.get_qty();
  }

  set qty(value: bigint) {
    this.set_qty(value);
  }

  get_client_id(): ClientId {
    const offset = 24;
    const slice = this.buffer.subarray(offset, offset + 16);
    return ClientId.from_array(slice)!;
  }

  set_client_id(value: ClientId): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 24;
    this.buffer.set(sourceBytes, offset);
  }

  get client_id(): ClientId {
    return this.get_client_id();
  }

  set client_id(value: ClientId) {
    this.set_client_id(value);
  }

  get_market(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_seat_authority(): Pubkey {
    const offset = 72;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 72;
    this.buffer.set(sourceBytes, offset);
  }

  get seat_authority(): Pubkey {
    return this.get_seat_authority();
  }

  set seat_authority(value: Pubkey) {
    this.set_seat_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OrderCancelledEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderCancelledEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderCancelledEvent');
    }
    return __tnBigIntToNumber(irResult, 'OrderCancelledEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 104) return { ok: false, code: "tn.buffer_too_small", consumed: 104 };
    return { ok: true, consumed: 104 };
  }

  static from_array(buffer: Uint8Array): OrderCancelledEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderCancelledEvent(buffer);
  }

}

export class OrderCancelledEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(104);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_side(value: number): this {
    this.view.setUint8(4, value);
    return this;
  }

  set_order_type(value: number): this {
    this.view.setUint8(5, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 2) throw new Error("reserved0 expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 6 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_qty(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_client_id(value: Uint8Array): this {
    if (value.length !== 16) throw new Error("client_id expects 16 bytes");
    this.buffer.set(value, 24);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 40);
    return this;
  }

  set_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority expects 32 bytes");
    this.buffer.set(value, 72);
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

  finish(): OrderCancelledEvent {
    const view = OrderCancelledEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OrderCancelledEvent");
    return view;
  }
}

__tnRegisterFootprint("OrderCancelledEvent", (params) => OrderCancelledEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderCancelledEvent", (buffer, params) => OrderCancelledEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderCancelledEvent", (buffer) => { const result = OrderCancelledEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OrderEntryRemovedEvent ----- */

const __tn_ir_OrderEntryRemovedEvent = {
  typeName: "OrderEntryRemovedEvent",
  root: { op: "const", value: 112n }
} as const;

export class OrderEntryRemovedEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderEntryRemovedEvent {
    if (!buffer || buffer.length === undefined) throw new Error("OrderEntryRemovedEvent.__tnCreateView requires a Uint8Array");
    return new OrderEntryRemovedEvent(new Uint8Array(buffer));
  }

  static builder(): OrderEntryRemovedEventBuilder {
    return new OrderEntryRemovedEventBuilder();
  }

  static fromBuilder(builder: OrderEntryRemovedEventBuilder): OrderEntryRemovedEvent | null {
    const buffer = builder.build();
    return OrderEntryRemovedEvent.from_array(buffer);
  }

  get_seat_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_side(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_side(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get side(): number {
    return this.get_side();
  }

  set side(value: number) {
    this.set_side(value);
  }

  get_reason(): number {
    const offset = 5;
    return this.view.getUint8(offset);
  }

  set_reason(value: number): void {
    const offset = 5;
    this.view.setUint8(offset, value);
  }

  get reason(): number {
    return this.get_reason();
  }

  set reason(value: number) {
    this.set_reason(value);
  }

  get_reserved0(): number[] {
    const offset = 6;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 6;
    if (value.length !== 2) {
      throw new Error('Array length must be 2');
    }
    for (let i = 0; i < 2; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_price(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_qty(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_qty(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get qty(): bigint {
    return this.get_qty();
  }

  set qty(value: bigint) {
    this.set_qty(value);
  }

  get_order_id(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_order_id(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get order_id(): bigint {
    return this.get_order_id();
  }

  set order_id(value: bigint) {
    this.set_order_id(value);
  }

  get_client_id(): ClientId {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 16);
    return ClientId.from_array(slice)!;
  }

  set_client_id(value: ClientId): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get client_id(): ClientId {
    return this.get_client_id();
  }

  set client_id(value: ClientId) {
    this.set_client_id(value);
  }

  get_market(): Pubkey {
    const offset = 48;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 48;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_seat_authority(): Pubkey {
    const offset = 80;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 80;
    this.buffer.set(sourceBytes, offset);
  }

  get seat_authority(): Pubkey {
    return this.get_seat_authority();
  }

  set seat_authority(value: Pubkey) {
    this.set_seat_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OrderEntryRemovedEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderEntryRemovedEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderEntryRemovedEvent');
    }
    return __tnBigIntToNumber(irResult, 'OrderEntryRemovedEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 112) return { ok: false, code: "tn.buffer_too_small", consumed: 112 };
    return { ok: true, consumed: 112 };
  }

  static from_array(buffer: Uint8Array): OrderEntryRemovedEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderEntryRemovedEvent(buffer);
  }

}

export class OrderEntryRemovedEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(112);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_side(value: number): this {
    this.view.setUint8(4, value);
    return this;
  }

  set_reason(value: number): this {
    this.view.setUint8(5, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 2) throw new Error("reserved0 expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 6 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_qty(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_order_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_client_id(value: Uint8Array): this {
    if (value.length !== 16) throw new Error("client_id expects 16 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 48);
    return this;
  }

  set_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority expects 32 bytes");
    this.buffer.set(value, 80);
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

  finish(): OrderEntryRemovedEvent {
    const view = OrderEntryRemovedEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OrderEntryRemovedEvent");
    return view;
  }
}

__tnRegisterFootprint("OrderEntryRemovedEvent", (params) => OrderEntryRemovedEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderEntryRemovedEvent", (buffer, params) => OrderEntryRemovedEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderEntryRemovedEvent", (buffer) => { const result = OrderEntryRemovedEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OrderFilledEvent ----- */

const __tn_ir_OrderFilledEvent = {
  typeName: "OrderFilledEvent",
  root: { op: "const", value: 148n }
} as const;

export class OrderFilledEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderFilledEvent {
    if (!buffer || buffer.length === undefined) throw new Error("OrderFilledEvent.__tnCreateView requires a Uint8Array");
    return new OrderFilledEvent(new Uint8Array(buffer));
  }

  static builder(): OrderFilledEventBuilder {
    return new OrderFilledEventBuilder();
  }

  static fromBuilder(builder: OrderFilledEventBuilder): OrderFilledEvent | null {
    const buffer = builder.build();
    return OrderFilledEvent.from_array(buffer);
  }

  get_taker_seat_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_taker_seat_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get taker_seat_idx(): number {
    return this.get_taker_seat_idx();
  }

  set taker_seat_idx(value: number) {
    this.set_taker_seat_idx(value);
  }

  get_maker_seat_idx(): number {
    const offset = 4;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_maker_seat_idx(value: number): void {
    const offset = 4;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get maker_seat_idx(): number {
    return this.get_maker_seat_idx();
  }

  set maker_seat_idx(value: number) {
    this.set_maker_seat_idx(value);
  }

  get_taker_side(): number {
    const offset = 8;
    return this.view.getUint8(offset);
  }

  set_taker_side(value: number): void {
    const offset = 8;
    this.view.setUint8(offset, value);
  }

  get taker_side(): number {
    return this.get_taker_side();
  }

  set taker_side(value: number) {
    this.set_taker_side(value);
  }

  get_reserved0(): number[] {
    const offset = 9;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 9;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_price(): bigint {
    const offset = 12;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 12;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_qty(): bigint {
    const offset = 20;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_qty(value: bigint): void {
    const offset = 20;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get qty(): bigint {
    return this.get_qty();
  }

  set qty(value: bigint) {
    this.set_qty(value);
  }

  get_maker_order_id(): bigint {
    const offset = 28;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_maker_order_id(value: bigint): void {
    const offset = 28;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get maker_order_id(): bigint {
    return this.get_maker_order_id();
  }

  set maker_order_id(value: bigint) {
    this.set_maker_order_id(value);
  }

  get_maker_client_id(): ClientId {
    const offset = 36;
    const slice = this.buffer.subarray(offset, offset + 16);
    return ClientId.from_array(slice)!;
  }

  set_maker_client_id(value: ClientId): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 36;
    this.buffer.set(sourceBytes, offset);
  }

  get maker_client_id(): ClientId {
    return this.get_maker_client_id();
  }

  set maker_client_id(value: ClientId) {
    this.set_maker_client_id(value);
  }

  get_market(): Pubkey {
    const offset = 52;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 52;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_taker_seat_authority(): Pubkey {
    const offset = 84;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_taker_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 84;
    this.buffer.set(sourceBytes, offset);
  }

  get taker_seat_authority(): Pubkey {
    return this.get_taker_seat_authority();
  }

  set taker_seat_authority(value: Pubkey) {
    this.set_taker_seat_authority(value);
  }

  get_maker_seat_authority(): Pubkey {
    const offset = 116;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_maker_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 116;
    this.buffer.set(sourceBytes, offset);
  }

  get maker_seat_authority(): Pubkey {
    return this.get_maker_seat_authority();
  }

  set maker_seat_authority(value: Pubkey) {
    this.set_maker_seat_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OrderFilledEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderFilledEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderFilledEvent');
    }
    return __tnBigIntToNumber(irResult, 'OrderFilledEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 148) return { ok: false, code: "tn.buffer_too_small", consumed: 148 };
    return { ok: true, consumed: 148 };
  }

  static from_array(buffer: Uint8Array): OrderFilledEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderFilledEvent(buffer);
  }

}

export class OrderFilledEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(148);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_taker_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_maker_seat_idx(value: number): this {
    this.view.setUint32(4, value, true);
    return this;
  }

  set_taker_side(value: number): this {
    this.view.setUint8(8, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 3) throw new Error("reserved0 expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 9 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(12, cast, true);
    return this;
  }

  set_qty(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(20, cast, true);
    return this;
  }

  set_maker_order_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(28, cast, true);
    return this;
  }

  set_maker_client_id(value: Uint8Array): this {
    if (value.length !== 16) throw new Error("maker_client_id expects 16 bytes");
    this.buffer.set(value, 36);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 52);
    return this;
  }

  set_taker_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("taker_seat_authority expects 32 bytes");
    this.buffer.set(value, 84);
    return this;
  }

  set_maker_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("maker_seat_authority expects 32 bytes");
    this.buffer.set(value, 116);
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

  finish(): OrderFilledEvent {
    const view = OrderFilledEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OrderFilledEvent");
    return view;
  }
}

__tnRegisterFootprint("OrderFilledEvent", (params) => OrderFilledEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderFilledEvent", (buffer, params) => OrderFilledEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderFilledEvent", (buffer) => { const result = OrderFilledEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OrderModifiedEvent ----- */

const __tn_ir_OrderModifiedEvent = {
  typeName: "OrderModifiedEvent",
  root: { op: "const", value: 120n }
} as const;

export class OrderModifiedEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderModifiedEvent {
    if (!buffer || buffer.length === undefined) throw new Error("OrderModifiedEvent.__tnCreateView requires a Uint8Array");
    return new OrderModifiedEvent(new Uint8Array(buffer));
  }

  static builder(): OrderModifiedEventBuilder {
    return new OrderModifiedEventBuilder();
  }

  static fromBuilder(builder: OrderModifiedEventBuilder): OrderModifiedEvent | null {
    const buffer = builder.build();
    return OrderModifiedEvent.from_array(buffer);
  }

  get_seat_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_side(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_side(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get side(): number {
    return this.get_side();
  }

  set side(value: number) {
    this.set_side(value);
  }

  get_reserved0(): number[] {
    const offset = 5;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 5;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_price(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_qty(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_qty(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get qty(): bigint {
    return this.get_qty();
  }

  set qty(value: bigint) {
    this.set_qty(value);
  }

  get_order_id(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_order_id(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get order_id(): bigint {
    return this.get_order_id();
  }

  set order_id(value: bigint) {
    this.set_order_id(value);
  }

  get_client_id(): ClientId {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 16);
    return ClientId.from_array(slice)!;
  }

  set_client_id(value: ClientId): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get client_id(): ClientId {
    return this.get_client_id();
  }

  set client_id(value: ClientId) {
    this.set_client_id(value);
  }

  get_exp_time(): bigint {
    const offset = 48;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_exp_time(value: bigint): void {
    const offset = 48;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get exp_time(): bigint {
    return this.get_exp_time();
  }

  set exp_time(value: bigint) {
    this.set_exp_time(value);
  }

  get_market(): Pubkey {
    const offset = 56;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 56;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_seat_authority(): Pubkey {
    const offset = 88;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 88;
    this.buffer.set(sourceBytes, offset);
  }

  get seat_authority(): Pubkey {
    return this.get_seat_authority();
  }

  set seat_authority(value: Pubkey) {
    this.set_seat_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OrderModifiedEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderModifiedEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderModifiedEvent');
    }
    return __tnBigIntToNumber(irResult, 'OrderModifiedEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 120) return { ok: false, code: "tn.buffer_too_small", consumed: 120 };
    return { ok: true, consumed: 120 };
  }

  static from_array(buffer: Uint8Array): OrderModifiedEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderModifiedEvent(buffer);
  }

}

export class OrderModifiedEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(120);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_side(value: number): this {
    this.view.setUint8(4, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 3) throw new Error("reserved0 expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 5 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_qty(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_order_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_client_id(value: Uint8Array): this {
    if (value.length !== 16) throw new Error("client_id expects 16 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_exp_time(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(48, cast, true);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 56);
    return this;
  }

  set_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority expects 32 bytes");
    this.buffer.set(value, 88);
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

  finish(): OrderModifiedEvent {
    const view = OrderModifiedEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OrderModifiedEvent");
    return view;
  }
}

__tnRegisterFootprint("OrderModifiedEvent", (params) => OrderModifiedEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderModifiedEvent", (buffer, params) => OrderModifiedEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderModifiedEvent", (buffer) => { const result = OrderModifiedEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OrderPostedEvent ----- */

const __tn_ir_OrderPostedEvent = {
  typeName: "OrderPostedEvent",
  root: { op: "const", value: 112n }
} as const;

export class OrderPostedEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderPostedEvent {
    if (!buffer || buffer.length === undefined) throw new Error("OrderPostedEvent.__tnCreateView requires a Uint8Array");
    return new OrderPostedEvent(new Uint8Array(buffer));
  }

  static builder(): OrderPostedEventBuilder {
    return new OrderPostedEventBuilder();
  }

  static fromBuilder(builder: OrderPostedEventBuilder): OrderPostedEvent | null {
    const buffer = builder.build();
    return OrderPostedEvent.from_array(buffer);
  }

  get_seat_idx(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_side(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_side(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get side(): number {
    return this.get_side();
  }

  set side(value: number) {
    this.set_side(value);
  }

  get_order_type(): number {
    const offset = 5;
    return this.view.getUint8(offset);
  }

  set_order_type(value: number): void {
    const offset = 5;
    this.view.setUint8(offset, value);
  }

  get order_type(): number {
    return this.get_order_type();
  }

  set order_type(value: number) {
    this.set_order_type(value);
  }

  get_reserved0(): number[] {
    const offset = 6;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 6;
    if (value.length !== 2) {
      throw new Error('Array length must be 2');
    }
    for (let i = 0; i < 2; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get reserved0(): number[] {
    return this.get_reserved0();
  }

  set reserved0(value: number[]) {
    this.set_reserved0(value);
  }

  get_price(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_qty(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_qty(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get qty(): bigint {
    return this.get_qty();
  }

  set qty(value: bigint) {
    this.set_qty(value);
  }

  get_order_id(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_order_id(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get order_id(): bigint {
    return this.get_order_id();
  }

  set order_id(value: bigint) {
    this.set_order_id(value);
  }

  get_client_id(): ClientId {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 16);
    return ClientId.from_array(slice)!;
  }

  set_client_id(value: ClientId): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get client_id(): ClientId {
    return this.get_client_id();
  }

  set client_id(value: ClientId) {
    this.set_client_id(value);
  }

  get_market(): Pubkey {
    const offset = 48;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 48;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_seat_authority(): Pubkey {
    const offset = 80;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 80;
    this.buffer.set(sourceBytes, offset);
  }

  get seat_authority(): Pubkey {
    return this.get_seat_authority();
  }

  set seat_authority(value: Pubkey) {
    this.set_seat_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OrderPostedEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderPostedEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderPostedEvent');
    }
    return __tnBigIntToNumber(irResult, 'OrderPostedEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 112) return { ok: false, code: "tn.buffer_too_small", consumed: 112 };
    return { ok: true, consumed: 112 };
  }

  static from_array(buffer: Uint8Array): OrderPostedEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderPostedEvent(buffer);
  }

}

export class OrderPostedEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(112);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_side(value: number): this {
    this.view.setUint8(4, value);
    return this;
  }

  set_order_type(value: number): this {
    this.view.setUint8(5, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 2) throw new Error("reserved0 expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 6 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_qty(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_order_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_client_id(value: Uint8Array): this {
    if (value.length !== 16) throw new Error("client_id expects 16 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 48);
    return this;
  }

  set_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority expects 32 bytes");
    this.buffer.set(value, 80);
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

  finish(): OrderPostedEvent {
    const view = OrderPostedEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OrderPostedEvent");
    return view;
  }
}

__tnRegisterFootprint("OrderPostedEvent", (params) => OrderPostedEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderPostedEvent", (buffer, params) => OrderPostedEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderPostedEvent", (buffer) => { const result = OrderPostedEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SeatArenaAccount ----- */

const __tn_ir_SeatArenaAccount = {
  typeName: "SeatArenaAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 256n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 64n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "div", left: { op: "sub", left: { op: "field", param: "__buffer_size" }, right: { op: "const", value: 320n } }, right: { op: "const", value: 64n } }, right: { op: "const", value: 64n } } } } }
} as const;

export class SeatArenaAccount {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;

  private constructor(private buffer: Uint8Array, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SeatArenaAccount {
    if (!buffer || buffer.length === undefined) throw new Error("SeatArenaAccount.__tnCreateView requires a Uint8Array");
    return new SeatArenaAccount(new Uint8Array(buffer), opts?.fieldContext);
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "SeatArenaAccount::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "SeatArenaAccount::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("SeatArenaAccount: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  get_market(): MarketAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 256);
    return MarketAccount.from_array(slice)!;
  }

  set_market(value: MarketAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): MarketAccount {
    return this.get_market();
  }

  set market(value: MarketAccount) {
    this.set_market(value);
  }

  get_header(): ArenaHeader {
    const offset = 256;
    const slice = this.buffer.subarray(offset, offset + 64);
    return ArenaHeader.from_array(slice)!;
  }

  set_header(value: ArenaHeader): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 256;
    this.buffer.set(sourceBytes, offset);
  }

  get header(): ArenaHeader {
    return this.get_header();
  }

  set header(value: ArenaHeader) {
    this.set_header(value);
  }

  get_entries_length(): number {
    return ((this.buffer.length - 320) / 64);
  }

  get_entries_at(index: number): SeatEntry {
    const offset = 320;
    const slice = this.buffer.subarray((offset + index * 64), (offset + (index + 1) * 64));
    return SeatEntry.from_array(slice)!;
  }

  get_entries(): SeatEntry[] {
    const len = this.get_entries_length();
    const result: SeatEntry[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_entries_at(i));
    }
    return result;
  }

  set_entries_at(index: number, value: SeatEntry): void {
    const offset = 320;
    const slice = this.buffer.subarray(offset + index * 64, offset + (index + 1) * 64);
    slice.set(value['buffer']);
  }

  set_entries(value: SeatEntry[]): void {
    const len = Math.min(this.get_entries_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_entries_at(i, value[i]);
    }
  }

  get entries(): SeatEntry[] {
    return this.get_entries();
  }

  set entries(value: SeatEntry[]) {
    this.set_entries(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SeatArenaAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SeatArenaAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SeatArenaAccount');
    }
    return __tnBigIntToNumber(irResult, 'SeatArenaAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (!buffer || buffer.length === undefined) return { ok: false, code: "tn.invalid_buffer" };
    const irResult = this.__tnValidateInternal(buffer, Object.create(null));
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'SeatArenaAccount::validate') : undefined };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'SeatArenaAccount::validate') : undefined;
    if (consumed !== buffer.length) return { ok: false, code: "tn.trailing_bytes", consumed };
    return { ok: true, consumed };
  }

  static from_array(buffer: Uint8Array): SeatArenaAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SeatArenaAccount(buffer);
  }

}

__tnRegisterFootprint("SeatArenaAccount", (params) => SeatArenaAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("SeatArenaAccount", (buffer, params) => SeatArenaAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SeatArenaAccount", (buffer) => { const result = SeatArenaAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ClobEvent ----- */

const __tn_ir_ClobEvent = {
  typeName: "ClobEvent",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 8, node: { op: "const", value: 8n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "ClobEvent::payload.event_type", cases: [{ value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 68n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 104n } } }, { value: 3, node: { op: "align", alignment: 1, node: { op: "const", value: 304n } } }, { value: 4, node: { op: "align", alignment: 1, node: { op: "const", value: 148n } } }, { value: 5, node: { op: "align", alignment: 1, node: { op: "const", value: 112n } } }, { value: 6, node: { op: "align", alignment: 1, node: { op: "const", value: 112n } } }, { value: 7, node: { op: "align", alignment: 1, node: { op: "const", value: 120n } } }, { value: 8, node: { op: "align", alignment: 1, node: { op: "const", value: 160n } } }, { value: 9, node: { op: "align", alignment: 1, node: { op: "const", value: 160n } } }, { value: 10, node: { op: "align", alignment: 1, node: { op: "const", value: 72n } } }] } } } }
} as const;

export class ClobEvent_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): ClobEvent_payload_Inner {
    return new ClobEvent_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asSeatAssigned(): SeatAssignedEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return SeatAssignedEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOrderCancelled(): OrderCancelledEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return OrderCancelledEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketCreated(): MarketCreatedEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return MarketCreatedEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOrderFilled(): OrderFilledEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return OrderFilledEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOrderPosted(): OrderPostedEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 5) return null;
    return OrderPostedEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOrderEntryRemoved(): OrderEntryRemovedEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 6) return null;
    return OrderEntryRemovedEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asOrderModified(): OrderModifiedEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 7) return null;
    return OrderModifiedEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTokenDeposit(): TokenBalanceEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 8) return null;
    return TokenBalanceEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTokenWithdraw(): TokenBalanceEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 9) return null;
    return TokenBalanceEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketStatus(): MarketStatusEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 10) return null;
    return MarketStatusEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class ClobEvent {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 8;
  private __tnParams: ClobEvent.Params;

  private constructor(private buffer: Uint8Array, params?: ClobEvent.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = ClobEvent.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("ClobEvent: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: ClobEvent.Params, fieldContext?: Record<string, number | bigint> }): ClobEvent {
    if (!buffer || buffer.length === undefined) throw new Error("ClobEvent.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = ClobEvent.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("ClobEvent.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new ClobEvent(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): ClobEvent.Params {
    return this.__tnParams;
  }

  static builder(): ClobEventBuilder {
    return new ClobEventBuilder();
  }

  static fromBuilder(builder: ClobEventBuilder): ClobEvent | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return ClobEvent.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "seat_assigned",
      tag: 1,
      payloadSize: 68,
      payloadType: "ClobEvent::payload::seat_assigned",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SeatAssignedEvent),
    },
    {
      name: "order_cancelled",
      tag: 2,
      payloadSize: 104,
      payloadType: "ClobEvent::payload::order_cancelled",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderCancelledEvent),
    },
    {
      name: "market_created",
      tag: 3,
      payloadSize: 304,
      payloadType: "ClobEvent::payload::market_created",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketCreatedEvent),
    },
    {
      name: "order_filled",
      tag: 4,
      payloadSize: 148,
      payloadType: "ClobEvent::payload::order_filled",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderFilledEvent),
    },
    {
      name: "order_posted",
      tag: 5,
      payloadSize: 112,
      payloadType: "ClobEvent::payload::order_posted",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderPostedEvent),
    },
    {
      name: "order_entry_removed",
      tag: 6,
      payloadSize: 112,
      payloadType: "ClobEvent::payload::order_entry_removed",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderEntryRemovedEvent),
    },
    {
      name: "order_modified",
      tag: 7,
      payloadSize: 120,
      payloadType: "ClobEvent::payload::order_modified",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderModifiedEvent),
    },
    {
      name: "token_deposit",
      tag: 8,
      payloadSize: 160,
      payloadType: "ClobEvent::payload::token_deposit",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenBalanceEvent),
    },
    {
      name: "token_withdraw",
      tag: 9,
      payloadSize: 160,
      payloadType: "ClobEvent::payload::token_withdraw",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenBalanceEvent),
    },
    {
      name: "market_status",
      tag: 10,
      payloadSize: 72,
      payloadType: "ClobEvent::payload::market_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketStatusEvent),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: ClobEvent.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 8) {
      return null;
    }
    const __tnParam_payload_event_type = __tnToBigInt(view.getBigUint64(0, true));
    const __tnExtractedParams = ClobEvent.Params.fromValues({
      payload_event_type: __tnParam_payload_event_type,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_event_type(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_event_type(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get event_type(): bigint {
    return this.get_event_type();
  }

  set event_type(value: bigint) {
    this.set_event_type(value);
  }

  payloadVariant(): typeof ClobEvent.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return ClobEvent.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): ClobEvent_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("ClobEvent: unknown payload variant");
    const offset = ClobEvent.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("ClobEvent: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return ClobEvent_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ClobEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ClobEvent, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_event_type: number | bigint): bigint {
    const params = ClobEvent.Params.fromValues({
      payload_event_type: payload_event_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: ClobEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.event_type"] = params.payload_event_type;
    record["ClobEvent::payload.event_type"] = params.payload_event_type;
    return record;
  }

  static footprintIrFromParams(params: ClobEvent.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: ClobEvent.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ClobEvent');
    return __tnBigIntToNumber(irResult, 'ClobEvent::footprintFromParams');
  }

  static footprintFromValues(input: { payload_event_type: number | bigint }): number {
    const params = ClobEvent.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: ClobEvent.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: ClobEvent.Params }): { ok: boolean; code?: string; consumed?: number; params?: ClobEvent.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ClobEvent::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ClobEvent::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: ClobEvent.Params }): ClobEvent | null {
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
    const state = new ClobEvent(buffer, cached);
    return state;
  }


}

export namespace ClobEvent {
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

export class ClobEventBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_event_type: bigint | null = null;
  private __tnPayload_payload: { descriptor: typeof ClobEvent.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: ClobEvent.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: ClobEvent.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<ClobEventBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(8);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_event_type(value: number | bigint): void {
    this.__tnField_event_type = __tnToBigInt(value);
    this.__tnInvalidate();
  }

  set_event_type(value: number | bigint): this {
    this.__tnAssign_event_type(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<ClobEventBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, ClobEvent.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_event_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("ClobEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ClobEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 8 + payloadLength;
    const footprintSize = ClobEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("ClobEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ClobEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 8 + payloadLength;
    const footprintSize = ClobEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("ClobEventBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): ClobEvent {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = ClobEvent.from_array(buffer, { params });
    if (!view) throw new Error("ClobEventBuilder: failed to finalize view");
    return view;
  }

  finishView(): ClobEvent {
    return this.finish();
  }

  dynamicParams(): ClobEvent.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): ClobEvent.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = ClobEvent.Params.fromValues({
      payload_event_type: (() => { if (this.__tnField_event_type === null) throw new Error("ClobEventBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_event_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_event_type === null) throw new Error("ClobEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("ClobEventBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setBigUint64(0, __tnToBigInt(this.__tnField_event_type), true);
    target.set(this.__tnPayload_payload.bytes, 8);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: ClobEvent.Params): void {
    const result = ClobEvent.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ ClobEvent }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("ClobEvent", (params) => ClobEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("ClobEvent", (buffer, params) => ClobEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ClobEvent", (buffer) => { const result = ClobEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ClobProgramAccount ----- */

const __tn_ir_ClobProgramAccount = {
  typeName: "ClobProgramAccount",
  root: { op: "const", value: 256n }
} as const;

export class ClobProgramAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ClobProgramAccount {
    if (!buffer || buffer.length === undefined) throw new Error("ClobProgramAccount.__tnCreateView requires a Uint8Array");
    return new ClobProgramAccount(new Uint8Array(buffer));
  }

  static builder(): ClobProgramAccountBuilder {
    return new ClobProgramAccountBuilder();
  }

  static fromBuilder(builder: ClobProgramAccountBuilder): ClobProgramAccount | null {
    const buffer = builder.build();
    return ClobProgramAccount.from_array(buffer);
  }

  get_market(): MarketAccount {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 256);
    return MarketAccount.from_array(slice)!;
  }

  set_market(value: MarketAccount): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): MarketAccount {
    return this.get_market();
  }

  set market(value: MarketAccount) {
    this.set_market(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ClobProgramAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ClobProgramAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ClobProgramAccount');
    }
    return __tnBigIntToNumber(irResult, 'ClobProgramAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 256) return { ok: false, code: "tn.buffer_too_small", consumed: 256 };
    return { ok: true, consumed: 256 };
  }

  static from_array(buffer: Uint8Array): ClobProgramAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ClobProgramAccount(buffer);
  }

}

export class ClobProgramAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(256);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 256) throw new Error("market expects 256 bytes");
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

  finish(): ClobProgramAccount {
    const view = ClobProgramAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ClobProgramAccount");
    return view;
  }
}

__tnRegisterFootprint("ClobProgramAccount", (params) => ClobProgramAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("ClobProgramAccount", (buffer, params) => ClobProgramAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ClobProgramAccount", (buffer) => { const result = ClobProgramAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
