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

/* ----- TYPE DEFINITION FOR CreateBooleanFeedData ----- */

const __tn_ir_CreateBooleanFeedData = {
  typeName: "CreateBooleanFeedData",
  root: { op: "const", value: 0n }
} as const;

export class CreateBooleanFeedData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreateBooleanFeedData {
    if (!buffer || buffer.length === undefined) throw new Error("CreateBooleanFeedData.__tnCreateView requires a Uint8Array");
    return new CreateBooleanFeedData(new Uint8Array(buffer));
  }

  static builder(): CreateBooleanFeedDataBuilder {
    return new CreateBooleanFeedDataBuilder();
  }

  static fromBuilder(builder: CreateBooleanFeedDataBuilder): CreateBooleanFeedData | null {
    const buffer = builder.build();
    return CreateBooleanFeedData.from_array(buffer);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateBooleanFeedData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateBooleanFeedData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateBooleanFeedData');
    }
    return __tnBigIntToNumber(irResult, 'CreateBooleanFeedData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 0) return { ok: false, code: "tn.buffer_too_small", consumed: 0 };
    return { ok: true, consumed: 0 };
  }

  static new(): CreateBooleanFeedData {
    const buffer = new Uint8Array(0);
    const view = new DataView(buffer.buffer);

    let offset = 0;

    return new CreateBooleanFeedData(buffer);
  }

  static from_array(buffer: Uint8Array): CreateBooleanFeedData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreateBooleanFeedData(buffer);
  }

}

export class CreateBooleanFeedDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(0);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CreateBooleanFeedData {
    const view = CreateBooleanFeedData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreateBooleanFeedData");
    return view;
  }
}

__tnRegisterFootprint("CreateBooleanFeedData", (params) => CreateBooleanFeedData.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateBooleanFeedData", (buffer, params) => CreateBooleanFeedData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateBooleanFeedData", (buffer) => { const result = CreateBooleanFeedData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreatePriceFeedData ----- */

const __tn_ir_CreatePriceFeedData = {
  typeName: "CreatePriceFeedData",
  root: { op: "const", value: 8n }
} as const;

export class CreatePriceFeedData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreatePriceFeedData {
    if (!buffer || buffer.length === undefined) throw new Error("CreatePriceFeedData.__tnCreateView requires a Uint8Array");
    return new CreatePriceFeedData(new Uint8Array(buffer));
  }

  static builder(): CreatePriceFeedDataBuilder {
    return new CreatePriceFeedDataBuilder();
  }

  static fromBuilder(builder: CreatePriceFeedDataBuilder): CreatePriceFeedData | null {
    const buffer = builder.build();
    return CreatePriceFeedData.from_array(buffer);
  }

  get_max_variance_bps(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_max_variance_bps(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get max_variance_bps(): number {
    return this.get_max_variance_bps();
  }

  set max_variance_bps(value: number) {
    this.set_max_variance_bps(value);
  }

  get_exponent(): number {
    const offset = 4;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_exponent(value: number): void {
    const offset = 4;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get exponent(): number {
    return this.get_exponent();
  }

  set exponent(value: number) {
    this.set_exponent(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreatePriceFeedData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreatePriceFeedData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreatePriceFeedData');
    }
    return __tnBigIntToNumber(irResult, 'CreatePriceFeedData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(max_variance_bps: number, exponent: number): CreatePriceFeedData {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint32(0, max_variance_bps, true); /* max_variance_bps (little-endian) */
    view.setInt32(4, exponent, true); /* exponent (little-endian) */

    return new CreatePriceFeedData(buffer);
  }

  static from_array(buffer: Uint8Array): CreatePriceFeedData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreatePriceFeedData(buffer);
  }

}

export class CreatePriceFeedDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_max_variance_bps(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_exponent(value: number): this {
    this.view.setInt32(4, value, true);
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

  finish(): CreatePriceFeedData {
    const view = CreatePriceFeedData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CreatePriceFeedData");
    return view;
  }
}

__tnRegisterFootprint("CreatePriceFeedData", (params) => CreatePriceFeedData.__tnInvokeFootprint(params));
__tnRegisterValidate("CreatePriceFeedData", (buffer, params) => CreatePriceFeedData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreatePriceFeedData", (buffer) => { const result = CreatePriceFeedData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FeedName64 ----- */

const __tn_ir_FeedName64 = {
  typeName: "FeedName64",
  root: { op: "const", value: 64n }
} as const;

export class FeedName64 {
  private view: DataView;
  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  private static readonly __tnElementSize = 1;
  private static readonly __tnElementCount: number | null = 64;

  get length(): number {
    const explicit = FeedName64.__tnElementCount;
    if (explicit !== null) {
      return explicit;
    }
    const stride = FeedName64.__tnElementSize;
    if (stride > 0) {
      return Math.floor(this.buffer.length / stride);
    }
    return this.buffer.length;
  }

  getElementBytes(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError('FeedName64::getElementBytes index must be a non-negative integer');
    }
    const stride = FeedName64.__tnElementSize;
    if (stride <= 0) {
      throw new Error('FeedName64::getElementBytes requires constant element size');
    }
    const start = index * stride;
    const end = start + stride;
    if (end > this.buffer.length) {
      throw new RangeError('FeedName64::getElementBytes out of bounds');
    }
    return this.buffer.subarray(start, end);
  }

  static from_array(buffer: Uint8Array): FeedName64 | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const validation = FeedName64.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FeedName64(buffer);
  }

  asUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FeedName64.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FeedName64, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FeedName64');
    }
    return __tnBigIntToNumber(irResult, 'FeedName64::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 64) return { ok: false, code: "tn.buffer_too_small", consumed: 64 };
    return { ok: true, consumed: 64 };
  }

}

__tnRegisterFootprint("FeedName64", (params) => FeedName64.__tnInvokeFootprint(params));
__tnRegisterValidate("FeedName64", (buffer, params) => FeedName64.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FeedName64", (buffer) => { const result = FeedName64.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OracleError ----- */

const __tn_ir_OracleError = {
  typeName: "OracleError",
  root: { op: "const", value: 8n }
} as const;

export class OracleError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OracleError {
    if (!buffer || buffer.length === undefined) throw new Error("OracleError.__tnCreateView requires a Uint8Array");
    return new OracleError(new Uint8Array(buffer));
  }

  static builder(): OracleErrorBuilder {
    return new OracleErrorBuilder();
  }

  static fromBuilder(builder: OracleErrorBuilder): OracleError | null {
    const buffer = builder.build();
    return OracleError.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_OracleError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OracleError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OracleError');
    }
    return __tnBigIntToNumber(irResult, 'OracleError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(code: bigint): OracleError {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, code, true); /* code (little-endian) */

    return new OracleError(buffer);
  }

  static from_array(buffer: Uint8Array): OracleError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OracleError(buffer);
  }

}

export class OracleErrorBuilder {
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

  finish(): OracleError {
    const view = OracleError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OracleError");
    return view;
  }
}

__tnRegisterFootprint("OracleError", (params) => OracleError.__tnInvokeFootprint(params));
__tnRegisterValidate("OracleError", (buffer, params) => OracleError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OracleError", (buffer) => { const result = OracleError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PostBooleanUpdateArgs ----- */

const __tn_ir_PostBooleanUpdateArgs = {
  typeName: "PostBooleanUpdateArgs",
  root: { op: "const", value: 11n }
} as const;

export class PostBooleanUpdateArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): PostBooleanUpdateArgs {
    if (!buffer || buffer.length === undefined) throw new Error("PostBooleanUpdateArgs.__tnCreateView requires a Uint8Array");
    return new PostBooleanUpdateArgs(new Uint8Array(buffer));
  }

  static builder(): PostBooleanUpdateArgsBuilder {
    return new PostBooleanUpdateArgsBuilder();
  }

  static fromBuilder(builder: PostBooleanUpdateArgsBuilder): PostBooleanUpdateArgs | null {
    const buffer = builder.build();
    return PostBooleanUpdateArgs.from_array(buffer);
  }

  get_value(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_value(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get value(): number {
    return this.get_value();
  }

  set value(value: number) {
    this.set_value(value);
  }

  get_timestamp_ns(): bigint {
    const offset = 1;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_timestamp_ns(value: bigint): void {
    const offset = 1;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get timestamp_ns(): bigint {
    return this.get_timestamp_ns();
  }

  set timestamp_ns(value: bigint) {
    this.set_timestamp_ns(value);
  }

  get_feed_account_idx(): number {
    const offset = 9;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_feed_account_idx(value: number): void {
    const offset = 9;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get feed_account_idx(): number {
    return this.get_feed_account_idx();
  }

  set feed_account_idx(value: number) {
    this.set_feed_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PostBooleanUpdateArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PostBooleanUpdateArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PostBooleanUpdateArgs');
    }
    return __tnBigIntToNumber(irResult, 'PostBooleanUpdateArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 11) return { ok: false, code: "tn.buffer_too_small", consumed: 11 };
    return { ok: true, consumed: 11 };
  }

  static new(value: number, timestamp_ns: bigint, feed_account_idx: number): PostBooleanUpdateArgs {
    const buffer = new Uint8Array(11);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, value); /* value */
    view.setBigUint64(1, timestamp_ns, true); /* timestamp_ns (little-endian) */
    view.setUint16(9, feed_account_idx, true); /* feed_account_idx (little-endian) */

    return new PostBooleanUpdateArgs(buffer);
  }

  static from_array(buffer: Uint8Array): PostBooleanUpdateArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new PostBooleanUpdateArgs(buffer);
  }

}

export class PostBooleanUpdateArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(11);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_value(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_timestamp_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(1, cast, true);
    return this;
  }

  set_feed_account_idx(value: number): this {
    this.view.setUint16(9, value, true);
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

  finish(): PostBooleanUpdateArgs {
    const view = PostBooleanUpdateArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build PostBooleanUpdateArgs");
    return view;
  }
}

__tnRegisterFootprint("PostBooleanUpdateArgs", (params) => PostBooleanUpdateArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("PostBooleanUpdateArgs", (buffer, params) => PostBooleanUpdateArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PostBooleanUpdateArgs", (buffer) => { const result = PostBooleanUpdateArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PostPriceUpdateArgs ----- */

const __tn_ir_PostPriceUpdateArgs = {
  typeName: "PostPriceUpdateArgs",
  root: { op: "const", value: 18n }
} as const;

export class PostPriceUpdateArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): PostPriceUpdateArgs {
    if (!buffer || buffer.length === undefined) throw new Error("PostPriceUpdateArgs.__tnCreateView requires a Uint8Array");
    return new PostPriceUpdateArgs(new Uint8Array(buffer));
  }

  static builder(): PostPriceUpdateArgsBuilder {
    return new PostPriceUpdateArgsBuilder();
  }

  static fromBuilder(builder: PostPriceUpdateArgsBuilder): PostPriceUpdateArgs | null {
    const buffer = builder.build();
    return PostPriceUpdateArgs.from_array(buffer);
  }

  get_price(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_timestamp_ns(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_timestamp_ns(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get timestamp_ns(): bigint {
    return this.get_timestamp_ns();
  }

  set timestamp_ns(value: bigint) {
    this.set_timestamp_ns(value);
  }

  get_feed_account_idx(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_feed_account_idx(value: number): void {
    const offset = 16;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get feed_account_idx(): number {
    return this.get_feed_account_idx();
  }

  set feed_account_idx(value: number) {
    this.set_feed_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PostPriceUpdateArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PostPriceUpdateArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PostPriceUpdateArgs');
    }
    return __tnBigIntToNumber(irResult, 'PostPriceUpdateArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 18) return { ok: false, code: "tn.buffer_too_small", consumed: 18 };
    return { ok: true, consumed: 18 };
  }

  static new(price: bigint, timestamp_ns: bigint, feed_account_idx: number): PostPriceUpdateArgs {
    const buffer = new Uint8Array(18);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, price, true); /* price (little-endian) */
    view.setBigUint64(8, timestamp_ns, true); /* timestamp_ns (little-endian) */
    view.setUint16(16, feed_account_idx, true); /* feed_account_idx (little-endian) */

    return new PostPriceUpdateArgs(buffer);
  }

  static from_array(buffer: Uint8Array): PostPriceUpdateArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new PostPriceUpdateArgs(buffer);
  }

}

export class PostPriceUpdateArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(18);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_timestamp_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_feed_account_idx(value: number): this {
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

  finish(): PostPriceUpdateArgs {
    const view = PostPriceUpdateArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build PostPriceUpdateArgs");
    return view;
  }
}

__tnRegisterFootprint("PostPriceUpdateArgs", (params) => PostPriceUpdateArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("PostPriceUpdateArgs", (buffer, params) => PostPriceUpdateArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PostPriceUpdateArgs", (buffer) => { const result = PostPriceUpdateArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PostUpdateArgs ----- */

const __tn_ir_PostUpdateArgs = {
  typeName: "PostUpdateArgs",
  root: { op: "align", alignment: 1, node: { op: "align", alignment: 1, node: { op: "switch", tag: "PostUpdateArgs::update.payload_size", cases: [{ value: 18, node: { op: "align", alignment: 1, node: { op: "const", value: 18n } } }, { value: 11, node: { op: "align", alignment: 1, node: { op: "const", value: 11n } } }] } } }
} as const;

export class PostUpdateArgs {
  private view: DataView;
  private __tnParams: PostUpdateArgs.Params;

  private constructor(private buffer: Uint8Array, params?: PostUpdateArgs.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = PostUpdateArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("PostUpdateArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: PostUpdateArgs.Params, fieldContext?: Record<string, number | bigint> }): PostUpdateArgs {
    if (!buffer || buffer.length === undefined) throw new Error("PostUpdateArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = PostUpdateArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("PostUpdateArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new PostUpdateArgs(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): PostUpdateArgs.Params {
    return this.__tnParams;
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_update_payload_size: bigint | null = null;
    let __tnCursorMutable = 0;
    const __tnSduAvailable_update = __tnLength - __tnCursorMutable;
    let __tnSduSize_update = -1;
    switch (__tnSduAvailable_update) {
      case 18: __tnSduSize_update = 18; break;
      case 11: __tnSduSize_update = 11; break;
      default: return null;
    }
    __tnParamSeq_update_payload_size = __tnToBigInt(__tnSduSize_update);
    __tnCursorMutable += __tnSduSize_update;
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_update_payload_size === null) return null;
    params["update_payload_size"] = __tnParamSeq_update_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: PostUpdateArgs.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = PostUpdateArgs.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_update_payload_size = __tnSeqParams["update_payload_size"];
    if (__tnParamSeq_update_payload_size === undefined) return null;
    const __tnExtractedParams = PostUpdateArgs.Params.fromValues({
      update_payload_size: __tnParamSeq_update_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PostUpdateArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PostUpdateArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(update_payload_size: number | bigint): bigint {
    const params = PostUpdateArgs.Params.fromValues({
      update_payload_size: update_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: PostUpdateArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["update.payload_size"] = params.update_payload_size;
    record["PostUpdateArgs::update.payload_size"] = params.update_payload_size;
    return record;
  }

  static footprintIrFromParams(params: PostUpdateArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: PostUpdateArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PostUpdateArgs');
    return __tnBigIntToNumber(irResult, 'PostUpdateArgs::footprintFromParams');
  }

  static footprintFromValues(input: { update_payload_size: number | bigint }): number {
    const params = PostUpdateArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: PostUpdateArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: PostUpdateArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: PostUpdateArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PostUpdateArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PostUpdateArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: PostUpdateArgs.Params }): PostUpdateArgs | null {
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
    const state = new PostUpdateArgs(buffer, cached);
    return state;
  }


}

export namespace PostUpdateArgs {
  export type Params = {
    /** ABI path: update.payload_size */
    readonly update_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    update_payload_size: "update.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { update_payload_size: number | bigint }): Params {
      return {
        update_payload_size: __tnToBigInt(input.update_payload_size),
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

  export function params(input: { update_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("PostUpdateArgs", (params) => PostUpdateArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("PostUpdateArgs", (buffer, params) => PostUpdateArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PostUpdateArgs", (buffer) => { const result = PostUpdateArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

/* ----- TYPE DEFINITION FOR SetAdminArgs ----- */

const __tn_ir_SetAdminArgs = {
  typeName: "SetAdminArgs",
  root: { op: "const", value: 4n }
} as const;

export class SetAdminArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SetAdminArgs {
    if (!buffer || buffer.length === undefined) throw new Error("SetAdminArgs.__tnCreateView requires a Uint8Array");
    return new SetAdminArgs(new Uint8Array(buffer));
  }

  static builder(): SetAdminArgsBuilder {
    return new SetAdminArgsBuilder();
  }

  static fromBuilder(builder: SetAdminArgsBuilder): SetAdminArgs | null {
    const buffer = builder.build();
    return SetAdminArgs.from_array(buffer);
  }

  get_feed_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_feed_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get feed_account_idx(): number {
    return this.get_feed_account_idx();
  }

  set feed_account_idx(value: number) {
    this.set_feed_account_idx(value);
  }

  get_new_admin_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_new_admin_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get new_admin_account_idx(): number {
    return this.get_new_admin_account_idx();
  }

  set new_admin_account_idx(value: number) {
    this.set_new_admin_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SetAdminArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SetAdminArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SetAdminArgs');
    }
    return __tnBigIntToNumber(irResult, 'SetAdminArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 4) return { ok: false, code: "tn.buffer_too_small", consumed: 4 };
    return { ok: true, consumed: 4 };
  }

  static new(feed_account_idx: number, new_admin_account_idx: number): SetAdminArgs {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, feed_account_idx, true); /* feed_account_idx (little-endian) */
    view.setUint16(2, new_admin_account_idx, true); /* new_admin_account_idx (little-endian) */

    return new SetAdminArgs(buffer);
  }

  static from_array(buffer: Uint8Array): SetAdminArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SetAdminArgs(buffer);
  }

}

export class SetAdminArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(4);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_feed_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_new_admin_account_idx(value: number): this {
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

  finish(): SetAdminArgs {
    const view = SetAdminArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetAdminArgs");
    return view;
  }
}

__tnRegisterFootprint("SetAdminArgs", (params) => SetAdminArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetAdminArgs", (buffer, params) => SetAdminArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetAdminArgs", (buffer) => { const result = SetAdminArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetParamsArgs ----- */

const __tn_ir_SetParamsArgs = {
  typeName: "SetParamsArgs",
  root: { op: "const", value: 14n }
} as const;

export class SetParamsArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SetParamsArgs {
    if (!buffer || buffer.length === undefined) throw new Error("SetParamsArgs.__tnCreateView requires a Uint8Array");
    return new SetParamsArgs(new Uint8Array(buffer));
  }

  static builder(): SetParamsArgsBuilder {
    return new SetParamsArgsBuilder();
  }

  static fromBuilder(builder: SetParamsArgsBuilder): SetParamsArgs | null {
    const buffer = builder.build();
    return SetParamsArgs.from_array(buffer);
  }

  get_max_staleness_ns(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_staleness_ns(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_staleness_ns(): bigint {
    return this.get_max_staleness_ns();
  }

  set max_staleness_ns(value: bigint) {
    this.set_max_staleness_ns(value);
  }

  get_max_variance_bps(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_max_variance_bps(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get max_variance_bps(): number {
    return this.get_max_variance_bps();
  }

  set max_variance_bps(value: number) {
    this.set_max_variance_bps(value);
  }

  get_feed_account_idx(): number {
    const offset = 12;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_feed_account_idx(value: number): void {
    const offset = 12;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get feed_account_idx(): number {
    return this.get_feed_account_idx();
  }

  set feed_account_idx(value: number) {
    this.set_feed_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SetParamsArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SetParamsArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SetParamsArgs');
    }
    return __tnBigIntToNumber(irResult, 'SetParamsArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 14) return { ok: false, code: "tn.buffer_too_small", consumed: 14 };
    return { ok: true, consumed: 14 };
  }

  static new(max_staleness_ns: bigint, max_variance_bps: number, feed_account_idx: number): SetParamsArgs {
    const buffer = new Uint8Array(14);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, max_staleness_ns, true); /* max_staleness_ns (little-endian) */
    view.setUint32(8, max_variance_bps, true); /* max_variance_bps (little-endian) */
    view.setUint16(12, feed_account_idx, true); /* feed_account_idx (little-endian) */

    return new SetParamsArgs(buffer);
  }

  static from_array(buffer: Uint8Array): SetParamsArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SetParamsArgs(buffer);
  }

}

export class SetParamsArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(14);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_max_staleness_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_max_variance_bps(value: number): this {
    this.view.setUint32(8, value, true);
    return this;
  }

  set_feed_account_idx(value: number): this {
    this.view.setUint16(12, value, true);
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

  finish(): SetParamsArgs {
    const view = SetParamsArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetParamsArgs");
    return view;
  }
}

__tnRegisterFootprint("SetParamsArgs", (params) => SetParamsArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetParamsArgs", (buffer, params) => SetParamsArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetParamsArgs", (buffer) => { const result = SetParamsArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetReporterArgs ----- */

const __tn_ir_SetReporterArgs = {
  typeName: "SetReporterArgs",
  root: { op: "const", value: 4n }
} as const;

export class SetReporterArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SetReporterArgs {
    if (!buffer || buffer.length === undefined) throw new Error("SetReporterArgs.__tnCreateView requires a Uint8Array");
    return new SetReporterArgs(new Uint8Array(buffer));
  }

  static builder(): SetReporterArgsBuilder {
    return new SetReporterArgsBuilder();
  }

  static fromBuilder(builder: SetReporterArgsBuilder): SetReporterArgs | null {
    const buffer = builder.build();
    return SetReporterArgs.from_array(buffer);
  }

  get_feed_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_feed_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get feed_account_idx(): number {
    return this.get_feed_account_idx();
  }

  set feed_account_idx(value: number) {
    this.set_feed_account_idx(value);
  }

  get_new_reporter_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_new_reporter_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get new_reporter_account_idx(): number {
    return this.get_new_reporter_account_idx();
  }

  set new_reporter_account_idx(value: number) {
    this.set_new_reporter_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SetReporterArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SetReporterArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SetReporterArgs');
    }
    return __tnBigIntToNumber(irResult, 'SetReporterArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 4) return { ok: false, code: "tn.buffer_too_small", consumed: 4 };
    return { ok: true, consumed: 4 };
  }

  static new(feed_account_idx: number, new_reporter_account_idx: number): SetReporterArgs {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, feed_account_idx, true); /* feed_account_idx (little-endian) */
    view.setUint16(2, new_reporter_account_idx, true); /* new_reporter_account_idx (little-endian) */

    return new SetReporterArgs(buffer);
  }

  static from_array(buffer: Uint8Array): SetReporterArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SetReporterArgs(buffer);
  }

}

export class SetReporterArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(4);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_feed_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_new_reporter_account_idx(value: number): this {
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

  finish(): SetReporterArgs {
    const view = SetReporterArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SetReporterArgs");
    return view;
  }
}

__tnRegisterFootprint("SetReporterArgs", (params) => SetReporterArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("SetReporterArgs", (buffer, params) => SetReporterArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SetReporterArgs", (buffer) => { const result = SetReporterArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR BooleanUpdateEventData ----- */

const __tn_ir_BooleanUpdateEventData = {
  typeName: "BooleanUpdateEventData",
  root: { op: "const", value: 106n }
} as const;

export class BooleanUpdateEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): BooleanUpdateEventData {
    if (!buffer || buffer.length === undefined) throw new Error("BooleanUpdateEventData.__tnCreateView requires a Uint8Array");
    return new BooleanUpdateEventData(new Uint8Array(buffer));
  }

  static builder(): BooleanUpdateEventDataBuilder {
    return new BooleanUpdateEventDataBuilder();
  }

  static fromBuilder(builder: BooleanUpdateEventDataBuilder): BooleanUpdateEventData | null {
    const buffer = builder.build();
    return BooleanUpdateEventData.from_array(buffer);
  }

  get_feed_name(): FeedName64 {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 64);
    return FeedName64.from_array(slice)!;
  }

  set_feed_name(value: FeedName64): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get feed_name(): FeedName64 {
    return this.get_feed_name();
  }

  set feed_name(value: FeedName64) {
    this.set_feed_name(value);
  }

  get_feed_address(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_feed_address(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get feed_address(): Pubkey {
    return this.get_feed_address();
  }

  set feed_address(value: Pubkey) {
    this.set_feed_address(value);
  }

  get_old_value(): number {
    const offset = 96;
    return this.view.getUint8(offset);
  }

  set_old_value(value: number): void {
    const offset = 96;
    this.view.setUint8(offset, value);
  }

  get old_value(): number {
    return this.get_old_value();
  }

  set old_value(value: number) {
    this.set_old_value(value);
  }

  get_new_value(): number {
    const offset = 97;
    return this.view.getUint8(offset);
  }

  set_new_value(value: number): void {
    const offset = 97;
    this.view.setUint8(offset, value);
  }

  get new_value(): number {
    return this.get_new_value();
  }

  set new_value(value: number) {
    this.set_new_value(value);
  }

  get_timestamp_ns(): bigint {
    const offset = 98;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_timestamp_ns(value: bigint): void {
    const offset = 98;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get timestamp_ns(): bigint {
    return this.get_timestamp_ns();
  }

  set timestamp_ns(value: bigint) {
    this.set_timestamp_ns(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_BooleanUpdateEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_BooleanUpdateEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for BooleanUpdateEventData');
    }
    return __tnBigIntToNumber(irResult, 'BooleanUpdateEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 106) return { ok: false, code: "tn.buffer_too_small", consumed: 106 };
    return { ok: true, consumed: 106 };
  }

  static from_array(buffer: Uint8Array): BooleanUpdateEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new BooleanUpdateEventData(buffer);
  }

}

export class BooleanUpdateEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(106);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_feed_name(value: Uint8Array): this {
    if (value.length !== 64) throw new Error("feed_name expects 64 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_feed_address(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("feed_address expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_old_value(value: number): this {
    this.view.setUint8(96, value);
    return this;
  }

  set_new_value(value: number): this {
    this.view.setUint8(97, value);
    return this;
  }

  set_timestamp_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(98, cast, true);
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

  finish(): BooleanUpdateEventData {
    const view = BooleanUpdateEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BooleanUpdateEventData");
    return view;
  }
}

__tnRegisterFootprint("BooleanUpdateEventData", (params) => BooleanUpdateEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("BooleanUpdateEventData", (buffer, params) => BooleanUpdateEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("BooleanUpdateEventData", (buffer) => { const result = BooleanUpdateEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateFeedArgs ----- */

const __tn_ir_CreateFeedArgs = {
  typeName: "CreateFeedArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 8, node: { op: "const", value: 8n } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 64n } } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "CreateFeedArgs::type_specific.feed_type", cases: [{ value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 8n } } }, { value: 2, node: { op: "zero" } }] } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_size" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateFeedArgs_type_specific_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): CreateFeedArgs_type_specific_Inner {
    return new CreateFeedArgs_type_specific_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asPrice(): CreatePriceFeedData | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return CreatePriceFeedData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBoolean(): CreateBooleanFeedData | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return CreateBooleanFeedData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class CreateFeedArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private static readonly __tnFieldOffset_type_specific = 127;
  private __tnParams: CreateFeedArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateFeedArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateFeedArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateFeedArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateFeedArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateFeedArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateFeedArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateFeedArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateFeedArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateFeedArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateFeedArgs.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateFeedArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreateFeedArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreateFeedArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static readonly type_specificVariantDescriptors = Object.freeze([
    {
      name: "price",
      tag: 1,
      payloadSize: 8,
      payloadType: "CreateFeedArgs::type_specific::price",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreatePriceFeedData),
    },
    {
      name: "boolean",
      tag: 2,
      payloadSize: 0,
      payloadType: "CreateFeedArgs::type_specific::boolean",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateBooleanFeedData),
    },
  ] as const);

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_size", paramKey: "proof_size", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_max_staleness_ns: bigint | null = null;
    let __tnFieldValue_proof_size: bigint | null = null;
    let __tnFieldValue_type_specific_size: bigint | null = null;
    let __tnFieldValue_admin_account_idx: number | null = null;
    let __tnFieldValue_reporter_account_idx: number | null = null;
    let __tnFieldValue_feed_account_idx: number | null = null;
    let __tnFieldValue_feed_type: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_max_staleness_ns = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_max_staleness_ns = __tnRead_max_staleness_ns;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_proof_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_proof_size = __tnRead_proof_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_type_specific_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_type_specific_size = __tnRead_type_specific_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_admin_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_admin_account_idx = __tnRead_admin_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_reporter_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_reporter_account_idx = __tnRead_reporter_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_feed_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_feed_account_idx = __tnRead_feed_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_feed_type = view.getUint8(__tnCursorMutable);
    __tnFieldValue_feed_type = __tnRead_feed_type;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 64 > __tnLength) return null;
    __tnCursorMutable += 64;
    const __tnEnumTagValue_type_specific = __tnFieldValue_feed_type;
    if (__tnEnumTagValue_type_specific === null) return null;
    let __tnEnumSize_type_specific = 0;
    switch (Number(__tnEnumTagValue_type_specific)) {
      case 1: __tnEnumSize_type_specific = 8; break;
      case 2: __tnEnumSize_type_specific = 0; break;
      default: return null;
    }
    if (__tnCursorMutable + __tnEnumSize_type_specific > __tnLength) return null;
    __tnCursorMutable += __tnEnumSize_type_specific;
    if (__tnFieldValue_proof_size === null) return null;
    const __tnArrayCount_proof = Math.trunc(Number(__tnFieldValue_proof_size));
    if (!Number.isFinite(__tnArrayCount_proof) || __tnArrayCount_proof < 0) return null;
    const __tnArrayBytes_proof = __tnArrayCount_proof * 1;
    offsets["proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_proof;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateFeedArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 16) {
      return null;
    }
    const __tnParam_proof_proof_size = __tnToBigInt(view.getBigUint64(8, true));
    if (buffer.length < 31) {
      return null;
    }
    const __tnParam_type_specific_feed_type = __tnToBigInt(view.getUint8(30));
    const __tnExtractedParams = CreateFeedArgs.Params.fromValues({
      proof_proof_size: __tnParam_proof_proof_size,
      type_specific_feed_type: __tnParam_type_specific_feed_type,
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
      throw new Error("CreateFeedArgs: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = CreateFeedArgs.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("CreateFeedArgs: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_max_staleness_ns(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_staleness_ns(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_staleness_ns(): bigint {
    return this.get_max_staleness_ns();
  }

  set max_staleness_ns(value: bigint) {
    this.set_max_staleness_ns(value);
  }

  get_proof_size(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_proof_size(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get proof_size(): bigint {
    return this.get_proof_size();
  }

  set proof_size(value: bigint) {
    this.set_proof_size(value);
  }

  get_type_specific_size(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_type_specific_size(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get type_specific_size(): bigint {
    return this.get_type_specific_size();
  }

  set type_specific_size(value: bigint) {
    this.set_type_specific_size(value);
  }

  get_admin_account_idx(): number {
    const offset = 24;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_admin_account_idx(value: number): void {
    const offset = 24;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get admin_account_idx(): number {
    return this.get_admin_account_idx();
  }

  set admin_account_idx(value: number) {
    this.set_admin_account_idx(value);
  }

  get_reporter_account_idx(): number {
    const offset = 26;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reporter_account_idx(value: number): void {
    const offset = 26;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reporter_account_idx(): number {
    return this.get_reporter_account_idx();
  }

  set reporter_account_idx(value: number) {
    this.set_reporter_account_idx(value);
  }

  get_feed_account_idx(): number {
    const offset = 28;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_feed_account_idx(value: number): void {
    const offset = 28;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get feed_account_idx(): number {
    return this.get_feed_account_idx();
  }

  set feed_account_idx(value: number) {
    this.set_feed_account_idx(value);
  }

  get_feed_type(): number {
    const offset = 30;
    return this.view.getUint8(offset);
  }

  set_feed_type(value: number): void {
    const offset = 30;
    this.view.setUint8(offset, value);
  }

  get feed_type(): number {
    return this.get_feed_type();
  }

  set feed_type(value: number) {
    this.set_feed_type(value);
  }

  get_feed_account_seed(): Seed32 {
    const offset = 31;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_feed_account_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 31;
    this.buffer.set(sourceBytes, offset);
  }

  get feed_account_seed(): Seed32 {
    return this.get_feed_account_seed();
  }

  set feed_account_seed(value: Seed32) {
    this.set_feed_account_seed(value);
  }

  get_feed_name(): FeedName64 {
    const offset = 63;
    const slice = this.buffer.subarray(offset, offset + 64);
    return FeedName64.from_array(slice)!;
  }

  set_feed_name(value: FeedName64): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 63;
    this.buffer.set(sourceBytes, offset);
  }

  get feed_name(): FeedName64 {
    return this.get_feed_name();
  }

  set feed_name(value: FeedName64) {
    this.set_feed_name(value);
  }

  get_proof_length(): number {
    return this.__tnResolveFieldRef("proof_size");
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

  typeSpecificVariant(): typeof CreateFeedArgs.type_specificVariantDescriptors[number] | null {
    const tag = this.view.getUint8(30);
    return CreateFeedArgs.type_specificVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  type_specific(): CreateFeedArgs_type_specific_Inner {
    const descriptor = this.typeSpecificVariant();
    if (!descriptor) throw new Error("CreateFeedArgs: unknown type_specific variant");
    const offset = CreateFeedArgs.__tnFieldOffset_type_specific;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("CreateFeedArgs: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return CreateFeedArgs_type_specific_Inner.__tnCreate(slice, descriptor, this.__tnFieldContext ?? undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateFeedArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateFeedArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_size: number | bigint, type_specific_feed_type: number | bigint): bigint {
    const params = CreateFeedArgs.Params.fromValues({
      proof_proof_size: proof_proof_size,
      type_specific_feed_type: type_specific_feed_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateFeedArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_size"] = params.proof_proof_size;
    record["type_specific.feed_type"] = params.type_specific_feed_type;
    record["CreateFeedArgs::type_specific.feed_type"] = params.type_specific_feed_type;
    return record;
  }

  static footprintIrFromParams(params: CreateFeedArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateFeedArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateFeedArgs');
    return __tnBigIntToNumber(irResult, 'CreateFeedArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_size: number | bigint, type_specific_feed_type: number | bigint }): number {
    const params = CreateFeedArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateFeedArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateFeedArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateFeedArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateFeedArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateFeedArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateFeedArgs.Params }): CreateFeedArgs | null {
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
    const state = new CreateFeedArgs(buffer, cached);
    return state;
  }


}

export namespace CreateFeedArgs {
  export type Params = {
    /** ABI path: proof.proof_size */
    readonly proof_proof_size: bigint;
    /** ABI path: type_specific.feed_type */
    readonly type_specific_feed_type: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_proof_size: "proof.proof_size",
    type_specific_feed_type: "type_specific.feed_type",
  } as const);

  export const Params = {
    fromValues(input: { proof_proof_size: number | bigint, type_specific_feed_type: number | bigint }): Params {
      return {
        proof_proof_size: __tnToBigInt(input.proof_proof_size),
        type_specific_feed_type: __tnToBigInt(input.type_specific_feed_type),
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

  export function params(input: { proof_proof_size: number | bigint, type_specific_feed_type: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("CreateFeedArgs", (params) => CreateFeedArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateFeedArgs", (buffer, params) => CreateFeedArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateFeedArgs", (buffer) => { const result = CreateFeedArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OracleFeedCommonData ----- */

const __tn_ir_OracleFeedCommonData = {
  typeName: "OracleFeedCommonData",
  root: { op: "const", value: 144n }
} as const;

export class OracleFeedCommonData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OracleFeedCommonData {
    if (!buffer || buffer.length === undefined) throw new Error("OracleFeedCommonData.__tnCreateView requires a Uint8Array");
    return new OracleFeedCommonData(new Uint8Array(buffer));
  }

  static builder(): OracleFeedCommonDataBuilder {
    return new OracleFeedCommonDataBuilder();
  }

  static fromBuilder(builder: OracleFeedCommonDataBuilder): OracleFeedCommonData | null {
    const buffer = builder.build();
    return OracleFeedCommonData.from_array(buffer);
  }

  get_max_staleness_ns(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_staleness_ns(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_staleness_ns(): bigint {
    return this.get_max_staleness_ns();
  }

  set max_staleness_ns(value: bigint) {
    this.set_max_staleness_ns(value);
  }

  get_last_update_ns(): bigint {
    const offset = 8;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_last_update_ns(value: bigint): void {
    const offset = 8;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get last_update_ns(): bigint {
    return this.get_last_update_ns();
  }

  set last_update_ns(value: bigint) {
    this.set_last_update_ns(value);
  }

  get_admin_address(): Pubkey {
    const offset = 16;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_admin_address(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 16;
    this.buffer.set(sourceBytes, offset);
  }

  get admin_address(): Pubkey {
    return this.get_admin_address();
  }

  set admin_address(value: Pubkey) {
    this.set_admin_address(value);
  }

  get_reporter_address(): Pubkey {
    const offset = 48;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_reporter_address(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 48;
    this.buffer.set(sourceBytes, offset);
  }

  get reporter_address(): Pubkey {
    return this.get_reporter_address();
  }

  set reporter_address(value: Pubkey) {
    this.set_reporter_address(value);
  }

  get_feed_name(): FeedName64 {
    const offset = 80;
    const slice = this.buffer.subarray(offset, offset + 64);
    return FeedName64.from_array(slice)!;
  }

  set_feed_name(value: FeedName64): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 80;
    this.buffer.set(sourceBytes, offset);
  }

  get feed_name(): FeedName64 {
    return this.get_feed_name();
  }

  set feed_name(value: FeedName64) {
    this.set_feed_name(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OracleFeedCommonData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OracleFeedCommonData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OracleFeedCommonData');
    }
    return __tnBigIntToNumber(irResult, 'OracleFeedCommonData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 144) return { ok: false, code: "tn.buffer_too_small", consumed: 144 };
    return { ok: true, consumed: 144 };
  }

  static from_array(buffer: Uint8Array): OracleFeedCommonData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OracleFeedCommonData(buffer);
  }

}

export class OracleFeedCommonDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(144);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_max_staleness_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_last_update_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_admin_address(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("admin_address expects 32 bytes");
    this.buffer.set(value, 16);
    return this;
  }

  set_reporter_address(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("reporter_address expects 32 bytes");
    this.buffer.set(value, 48);
    return this;
  }

  set_feed_name(value: Uint8Array): this {
    if (value.length !== 64) throw new Error("feed_name expects 64 bytes");
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

  finish(): OracleFeedCommonData {
    const view = OracleFeedCommonData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OracleFeedCommonData");
    return view;
  }
}

__tnRegisterFootprint("OracleFeedCommonData", (params) => OracleFeedCommonData.__tnInvokeFootprint(params));
__tnRegisterValidate("OracleFeedCommonData", (buffer, params) => OracleFeedCommonData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OracleFeedCommonData", (buffer) => { const result = OracleFeedCommonData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OracleInstruction ----- */

const __tn_ir_OracleInstruction = {
  typeName: "OracleInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 4, node: { op: "const", value: 4n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class OracleInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): OracleInstruction_payload_Inner {
    return new OracleInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreateFeed(): CreateFeedArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return CreateFeedArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asPostUpdate(): PostUpdateArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return PostUpdateArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetParams(): SetParamsArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return SetParamsArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetAdmin(): SetAdminArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return SetAdminArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetReporter(): SetReporterArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return SetReporterArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class OracleInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 4;
  private __tnParams: OracleInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: OracleInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = OracleInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("OracleInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: OracleInstruction.Params, fieldContext?: Record<string, number | bigint> }): OracleInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("OracleInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = OracleInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("OracleInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new OracleInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): OracleInstruction.Params {
    return this.__tnParams;
  }

  static builder(): OracleInstructionBuilder {
    return new OracleInstructionBuilder();
  }

  static fromBuilder(builder: OracleInstructionBuilder): OracleInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return OracleInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create_feed",
      tag: 0,
      payloadSize: null,
      payloadType: "OracleInstruction::payload::create_feed",
      createPayloadBuilder: () => null,
    },
    {
      name: "post_update",
      tag: 1,
      payloadSize: null,
      payloadType: "OracleInstruction::payload::post_update",
      createPayloadBuilder: () => null,
    },
    {
      name: "set_params",
      tag: 2,
      payloadSize: 14,
      payloadType: "OracleInstruction::payload::set_params",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetParamsArgs),
    },
    {
      name: "set_admin",
      tag: 3,
      payloadSize: 4,
      payloadType: "OracleInstruction::payload::set_admin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetAdminArgs),
    },
    {
      name: "set_reporter",
      tag: 4,
      payloadSize: 4,
      payloadType: "OracleInstruction::payload::set_reporter",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetReporterArgs),
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_payload_payload_size: bigint | null = null;
    let __tnFieldValue_discriminant: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_discriminant = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_discriminant = __tnRead_discriminant;
    __tnCursorMutable += 4;
    const __tnEnumTagValue_payload = __tnFieldValue_discriminant;
    if (__tnEnumTagValue_payload === null) return null;
    let __tnEnumSize_payload = 0;
    switch (Number(__tnEnumTagValue_payload)) {
      case 0: break;
      case 1: break;
      case 2: break;
      case 3: break;
      case 4: break;
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: OracleInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_payload_discriminant = __tnToBigInt(view.getUint32(0, true));
    const __tnLayout = OracleInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = OracleInstruction.Params.fromValues({
      payload_discriminant: __tnParam_payload_discriminant,
      payload_payload_size: __tnParamSeq_payload_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_discriminant(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_discriminant(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get discriminant(): number {
    return this.get_discriminant();
  }

  set discriminant(value: number) {
    this.set_discriminant(value);
  }

  payloadVariant(): typeof OracleInstruction.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return OracleInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): OracleInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("OracleInstruction: unknown payload variant");
    const offset = OracleInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("OracleInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return OracleInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OracleInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OracleInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_discriminant: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = OracleInstruction.Params.fromValues({
      payload_discriminant: payload_discriminant,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: OracleInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.discriminant"] = params.payload_discriminant;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: OracleInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: OracleInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OracleInstruction');
    return __tnBigIntToNumber(irResult, 'OracleInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_discriminant: number | bigint, payload_payload_size: number | bigint }): number {
    const params = OracleInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: OracleInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: OracleInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: OracleInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OracleInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OracleInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: OracleInstruction.Params }): OracleInstruction | null {
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
    const state = new OracleInstruction(buffer, cached);
    return state;
  }


}

export namespace OracleInstruction {
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

export class OracleInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_discriminant: number | null = null;
  private __tnPayload_payload: { descriptor: typeof OracleInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: OracleInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: OracleInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<OracleInstructionBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(4);
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

  payload(): __TnVariantSelectorResult<OracleInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, OracleInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_discriminant(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("OracleInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("OracleInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = OracleInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("OracleInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("OracleInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = OracleInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("OracleInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): OracleInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = OracleInstruction.from_array(buffer, { params });
    if (!view) throw new Error("OracleInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): OracleInstruction {
    return this.finish();
  }

  dynamicParams(): OracleInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): OracleInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = OracleInstruction.Params.fromValues({
      payload_discriminant: (() => { if (this.__tnField_discriminant === null) throw new Error("OracleInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_discriminant); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("OracleInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_discriminant === null) throw new Error("OracleInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("OracleInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint32(0, this.__tnField_discriminant, true);
    target.set(this.__tnPayload_payload.bytes, 4);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: OracleInstruction.Params): void {
    const result = OracleInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ OracleInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("OracleInstruction", (params) => OracleInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("OracleInstruction", (buffer, params) => OracleInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OracleInstruction", (buffer) => { const result = OracleInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OraclePriceFeedData ----- */

const __tn_ir_OraclePriceFeedData = {
  typeName: "OraclePriceFeedData",
  root: { op: "const", value: 160n }
} as const;

export class OraclePriceFeedData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OraclePriceFeedData {
    if (!buffer || buffer.length === undefined) throw new Error("OraclePriceFeedData.__tnCreateView requires a Uint8Array");
    return new OraclePriceFeedData(new Uint8Array(buffer));
  }

  static builder(): OraclePriceFeedDataBuilder {
    return new OraclePriceFeedDataBuilder();
  }

  static fromBuilder(builder: OraclePriceFeedDataBuilder): OraclePriceFeedData | null {
    const buffer = builder.build();
    return OraclePriceFeedData.from_array(buffer);
  }

  get_common(): OracleFeedCommonData {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 144);
    return OracleFeedCommonData.from_array(slice)!;
  }

  set_common(value: OracleFeedCommonData): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get common(): OracleFeedCommonData {
    return this.get_common();
  }

  set common(value: OracleFeedCommonData) {
    this.set_common(value);
  }

  get_price(): bigint {
    const offset = 144;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price(value: bigint): void {
    const offset = 144;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price(): bigint {
    return this.get_price();
  }

  set price(value: bigint) {
    this.set_price(value);
  }

  get_max_variance_bps(): number {
    const offset = 152;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_max_variance_bps(value: number): void {
    const offset = 152;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get max_variance_bps(): number {
    return this.get_max_variance_bps();
  }

  set max_variance_bps(value: number) {
    this.set_max_variance_bps(value);
  }

  get_exponent(): number {
    const offset = 156;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_exponent(value: number): void {
    const offset = 156;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get exponent(): number {
    return this.get_exponent();
  }

  set exponent(value: number) {
    this.set_exponent(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OraclePriceFeedData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OraclePriceFeedData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OraclePriceFeedData');
    }
    return __tnBigIntToNumber(irResult, 'OraclePriceFeedData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 160) return { ok: false, code: "tn.buffer_too_small", consumed: 160 };
    return { ok: true, consumed: 160 };
  }

  static from_array(buffer: Uint8Array): OraclePriceFeedData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OraclePriceFeedData(buffer);
  }

}

export class OraclePriceFeedDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(160);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_common(value: Uint8Array): this {
    if (value.length !== 144) throw new Error("common expects 144 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(144, cast, true);
    return this;
  }

  set_max_variance_bps(value: number): this {
    this.view.setUint32(152, value, true);
    return this;
  }

  set_exponent(value: number): this {
    this.view.setInt32(156, value, true);
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

  finish(): OraclePriceFeedData {
    const view = OraclePriceFeedData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OraclePriceFeedData");
    return view;
  }
}

__tnRegisterFootprint("OraclePriceFeedData", (params) => OraclePriceFeedData.__tnInvokeFootprint(params));
__tnRegisterValidate("OraclePriceFeedData", (buffer, params) => OraclePriceFeedData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OraclePriceFeedData", (buffer) => { const result = OraclePriceFeedData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PriceUpdateEventData ----- */

const __tn_ir_PriceUpdateEventData = {
  typeName: "PriceUpdateEventData",
  root: { op: "const", value: 120n }
} as const;

export class PriceUpdateEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): PriceUpdateEventData {
    if (!buffer || buffer.length === undefined) throw new Error("PriceUpdateEventData.__tnCreateView requires a Uint8Array");
    return new PriceUpdateEventData(new Uint8Array(buffer));
  }

  static builder(): PriceUpdateEventDataBuilder {
    return new PriceUpdateEventDataBuilder();
  }

  static fromBuilder(builder: PriceUpdateEventDataBuilder): PriceUpdateEventData | null {
    const buffer = builder.build();
    return PriceUpdateEventData.from_array(buffer);
  }

  get_feed_name(): FeedName64 {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 64);
    return FeedName64.from_array(slice)!;
  }

  set_feed_name(value: FeedName64): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get feed_name(): FeedName64 {
    return this.get_feed_name();
  }

  set feed_name(value: FeedName64) {
    this.set_feed_name(value);
  }

  get_feed_address(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_feed_address(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get feed_address(): Pubkey {
    return this.get_feed_address();
  }

  set feed_address(value: Pubkey) {
    this.set_feed_address(value);
  }

  get_old_price(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_old_price(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get old_price(): bigint {
    return this.get_old_price();
  }

  set old_price(value: bigint) {
    this.set_old_price(value);
  }

  get_new_price(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_new_price(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get new_price(): bigint {
    return this.get_new_price();
  }

  set new_price(value: bigint) {
    this.set_new_price(value);
  }

  get_timestamp_ns(): bigint {
    const offset = 112;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_timestamp_ns(value: bigint): void {
    const offset = 112;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get timestamp_ns(): bigint {
    return this.get_timestamp_ns();
  }

  set timestamp_ns(value: bigint) {
    this.set_timestamp_ns(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PriceUpdateEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PriceUpdateEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PriceUpdateEventData');
    }
    return __tnBigIntToNumber(irResult, 'PriceUpdateEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 120) return { ok: false, code: "tn.buffer_too_small", consumed: 120 };
    return { ok: true, consumed: 120 };
  }

  static from_array(buffer: Uint8Array): PriceUpdateEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new PriceUpdateEventData(buffer);
  }

}

export class PriceUpdateEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(120);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_feed_name(value: Uint8Array): this {
    if (value.length !== 64) throw new Error("feed_name expects 64 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_feed_address(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("feed_address expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_old_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_new_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_timestamp_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(112, cast, true);
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

  finish(): PriceUpdateEventData {
    const view = PriceUpdateEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build PriceUpdateEventData");
    return view;
  }
}

__tnRegisterFootprint("PriceUpdateEventData", (params) => PriceUpdateEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("PriceUpdateEventData", (buffer, params) => PriceUpdateEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PriceUpdateEventData", (buffer) => { const result = PriceUpdateEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OracleBooleanFeedData ----- */

const __tn_ir_OracleBooleanFeedData = {
  typeName: "OracleBooleanFeedData",
  root: { op: "const", value: 145n }
} as const;

export class OracleBooleanFeedData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OracleBooleanFeedData {
    if (!buffer || buffer.length === undefined) throw new Error("OracleBooleanFeedData.__tnCreateView requires a Uint8Array");
    return new OracleBooleanFeedData(new Uint8Array(buffer));
  }

  static builder(): OracleBooleanFeedDataBuilder {
    return new OracleBooleanFeedDataBuilder();
  }

  static fromBuilder(builder: OracleBooleanFeedDataBuilder): OracleBooleanFeedData | null {
    const buffer = builder.build();
    return OracleBooleanFeedData.from_array(buffer);
  }

  get_common(): OracleFeedCommonData {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 144);
    return OracleFeedCommonData.from_array(slice)!;
  }

  set_common(value: OracleFeedCommonData): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get common(): OracleFeedCommonData {
    return this.get_common();
  }

  set common(value: OracleFeedCommonData) {
    this.set_common(value);
  }

  get_value(): number {
    const offset = 144;
    return this.view.getUint8(offset);
  }

  set_value(value: number): void {
    const offset = 144;
    this.view.setUint8(offset, value);
  }

  get value(): number {
    return this.get_value();
  }

  set value(value: number) {
    this.set_value(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OracleBooleanFeedData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OracleBooleanFeedData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OracleBooleanFeedData');
    }
    return __tnBigIntToNumber(irResult, 'OracleBooleanFeedData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 145) return { ok: false, code: "tn.buffer_too_small", consumed: 145 };
    return { ok: true, consumed: 145 };
  }

  static from_array(buffer: Uint8Array): OracleBooleanFeedData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OracleBooleanFeedData(buffer);
  }

}

export class OracleBooleanFeedDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(145);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_common(value: Uint8Array): this {
    if (value.length !== 144) throw new Error("common expects 144 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_value(value: number): this {
    this.view.setUint8(144, value);
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

  finish(): OracleBooleanFeedData {
    const view = OracleBooleanFeedData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OracleBooleanFeedData");
    return view;
  }
}

__tnRegisterFootprint("OracleBooleanFeedData", (params) => OracleBooleanFeedData.__tnInvokeFootprint(params));
__tnRegisterValidate("OracleBooleanFeedData", (buffer, params) => OracleBooleanFeedData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OracleBooleanFeedData", (buffer) => { const result = OracleBooleanFeedData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OracleEvent ----- */

const __tn_ir_OracleEvent = {
  typeName: "OracleEvent",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "OracleEvent::data.event_type", cases: [{ value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 120n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 106n } } }] } } } }
} as const;

export class OracleEvent_data_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): OracleEvent_data_Inner {
    return new OracleEvent_data_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asPriceUpdate(): PriceUpdateEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return PriceUpdateEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBooleanUpdate(): BooleanUpdateEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return BooleanUpdateEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class OracleEvent {
  private view: DataView;
  private static readonly __tnFieldOffset_data = 1;
  private __tnParams: OracleEvent.Params;

  private constructor(private buffer: Uint8Array, params?: OracleEvent.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = OracleEvent.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("OracleEvent: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: OracleEvent.Params, fieldContext?: Record<string, number | bigint> }): OracleEvent {
    if (!buffer || buffer.length === undefined) throw new Error("OracleEvent.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = OracleEvent.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("OracleEvent.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new OracleEvent(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): OracleEvent.Params {
    return this.__tnParams;
  }

  static builder(): OracleEventBuilder {
    return new OracleEventBuilder();
  }

  static fromBuilder(builder: OracleEventBuilder): OracleEvent | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return OracleEvent.from_array(buffer, { params });
  }

  static readonly dataVariantDescriptors = Object.freeze([
    {
      name: "price_update",
      tag: 1,
      payloadSize: 120,
      payloadType: "OracleEvent::data::price_update",
      createPayloadBuilder: () => __tnMaybeCallBuilder(PriceUpdateEventData),
    },
    {
      name: "boolean_update",
      tag: 2,
      payloadSize: 106,
      payloadType: "OracleEvent::data::boolean_update",
      createPayloadBuilder: () => __tnMaybeCallBuilder(BooleanUpdateEventData),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: OracleEvent.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_data_event_type = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = OracleEvent.Params.fromValues({
      data_event_type: __tnParam_data_event_type,
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

  dataVariant(): typeof OracleEvent.dataVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return OracleEvent.dataVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  data(): OracleEvent_data_Inner {
    const descriptor = this.dataVariant();
    if (!descriptor) throw new Error("OracleEvent: unknown data variant");
    const offset = OracleEvent.__tnFieldOffset_data;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("OracleEvent: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return OracleEvent_data_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OracleEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OracleEvent, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(data_event_type: number | bigint): bigint {
    const params = OracleEvent.Params.fromValues({
      data_event_type: data_event_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: OracleEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["data.event_type"] = params.data_event_type;
    record["OracleEvent::data.event_type"] = params.data_event_type;
    return record;
  }

  static footprintIrFromParams(params: OracleEvent.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: OracleEvent.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OracleEvent');
    return __tnBigIntToNumber(irResult, 'OracleEvent::footprintFromParams');
  }

  static footprintFromValues(input: { data_event_type: number | bigint }): number {
    const params = OracleEvent.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: OracleEvent.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: OracleEvent.Params }): { ok: boolean; code?: string; consumed?: number; params?: OracleEvent.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OracleEvent::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OracleEvent::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: OracleEvent.Params }): OracleEvent | null {
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
    const state = new OracleEvent(buffer, cached);
    return state;
  }


}

export namespace OracleEvent {
  export type Params = {
    /** ABI path: data.event_type */
    readonly data_event_type: bigint;
  };

  export const ParamKeys = Object.freeze({
    data_event_type: "data.event_type",
  } as const);

  export const Params = {
    fromValues(input: { data_event_type: number | bigint }): Params {
      return {
        data_event_type: __tnToBigInt(input.data_event_type),
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

  export function params(input: { data_event_type: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class OracleEventBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_event_type: number | null = null;
  private __tnPayload_data: { descriptor: typeof OracleEvent.dataVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: OracleEvent.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: OracleEvent.Params | null = null;
  private __tnVariantSelector_data?: __TnVariantSelectorResult<OracleEventBuilder>;

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

  data(): __TnVariantSelectorResult<OracleEventBuilder> {
    if (!this.__tnVariantSelector_data) {
      this.__tnVariantSelector_data = __tnCreateVariantSelector(this, OracleEvent.dataVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_data = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_event_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_data!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("OracleEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_data) throw new Error("OracleEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_data.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = OracleEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("OracleEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_data) throw new Error("OracleEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_data.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = OracleEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("OracleEventBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): OracleEvent {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = OracleEvent.from_array(buffer, { params });
    if (!view) throw new Error("OracleEventBuilder: failed to finalize view");
    return view;
  }

  finishView(): OracleEvent {
    return this.finish();
  }

  dynamicParams(): OracleEvent.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): OracleEvent.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = OracleEvent.Params.fromValues({
      data_event_type: (() => { if (this.__tnField_event_type === null) throw new Error("OracleEventBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_event_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_event_type === null) throw new Error("OracleEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_data) throw new Error("OracleEventBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_event_type);
    target.set(this.__tnPayload_data.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: OracleEvent.Params): void {
    const result = OracleEvent.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ OracleEvent }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("OracleEvent", (params) => OracleEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("OracleEvent", (buffer, params) => OracleEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OracleEvent", (buffer) => { const result = OracleEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR OracleFeedAccount ----- */

const __tn_ir_OracleFeedAccount = {
  typeName: "OracleFeedAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "OracleFeedAccount::data.feed_type", cases: [{ value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 160n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 145n } } }] } } } }
} as const;

export class OracleFeedAccount_data_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): OracleFeedAccount_data_Inner {
    return new OracleFeedAccount_data_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asPrice(): OraclePriceFeedData | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return OraclePriceFeedData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBoolean(): OracleBooleanFeedData | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return OracleBooleanFeedData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class OracleFeedAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_data = 1;
  private __tnParams: OracleFeedAccount.Params;

  private constructor(private buffer: Uint8Array, params?: OracleFeedAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = OracleFeedAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("OracleFeedAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: OracleFeedAccount.Params, fieldContext?: Record<string, number | bigint> }): OracleFeedAccount {
    if (!buffer || buffer.length === undefined) throw new Error("OracleFeedAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = OracleFeedAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("OracleFeedAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new OracleFeedAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): OracleFeedAccount.Params {
    return this.__tnParams;
  }

  static builder(): OracleFeedAccountBuilder {
    return new OracleFeedAccountBuilder();
  }

  static fromBuilder(builder: OracleFeedAccountBuilder): OracleFeedAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return OracleFeedAccount.from_array(buffer, { params });
  }

  static readonly dataVariantDescriptors = Object.freeze([
    {
      name: "price",
      tag: 1,
      payloadSize: 160,
      payloadType: "OracleFeedAccount::data::price",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OraclePriceFeedData),
    },
    {
      name: "boolean",
      tag: 2,
      payloadSize: 145,
      payloadType: "OracleFeedAccount::data::boolean",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OracleBooleanFeedData),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: OracleFeedAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_data_feed_type = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = OracleFeedAccount.Params.fromValues({
      data_feed_type: __tnParam_data_feed_type,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_feed_type(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_feed_type(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get feed_type(): number {
    return this.get_feed_type();
  }

  set feed_type(value: number) {
    this.set_feed_type(value);
  }

  dataVariant(): typeof OracleFeedAccount.dataVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return OracleFeedAccount.dataVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  data(): OracleFeedAccount_data_Inner {
    const descriptor = this.dataVariant();
    if (!descriptor) throw new Error("OracleFeedAccount: unknown data variant");
    const offset = OracleFeedAccount.__tnFieldOffset_data;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("OracleFeedAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return OracleFeedAccount_data_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_OracleFeedAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OracleFeedAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(data_feed_type: number | bigint): bigint {
    const params = OracleFeedAccount.Params.fromValues({
      data_feed_type: data_feed_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: OracleFeedAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["data.feed_type"] = params.data_feed_type;
    record["OracleFeedAccount::data.feed_type"] = params.data_feed_type;
    return record;
  }

  static footprintIrFromParams(params: OracleFeedAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: OracleFeedAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OracleFeedAccount');
    return __tnBigIntToNumber(irResult, 'OracleFeedAccount::footprintFromParams');
  }

  static footprintFromValues(input: { data_feed_type: number | bigint }): number {
    const params = OracleFeedAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: OracleFeedAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: OracleFeedAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: OracleFeedAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OracleFeedAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'OracleFeedAccount::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: OracleFeedAccount.Params }): OracleFeedAccount | null {
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
    const state = new OracleFeedAccount(buffer, cached);
    return state;
  }


}

export namespace OracleFeedAccount {
  export type Params = {
    /** ABI path: data.feed_type */
    readonly data_feed_type: bigint;
  };

  export const ParamKeys = Object.freeze({
    data_feed_type: "data.feed_type",
  } as const);

  export const Params = {
    fromValues(input: { data_feed_type: number | bigint }): Params {
      return {
        data_feed_type: __tnToBigInt(input.data_feed_type),
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

  export function params(input: { data_feed_type: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class OracleFeedAccountBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_feed_type: number | null = null;
  private __tnPayload_data: { descriptor: typeof OracleFeedAccount.dataVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: OracleFeedAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: OracleFeedAccount.Params | null = null;
  private __tnVariantSelector_data?: __TnVariantSelectorResult<OracleFeedAccountBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(1);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_feed_type(value: number): void {
    this.__tnField_feed_type = value;
    this.__tnInvalidate();
  }

  set_feed_type(value: number): this {
    this.__tnAssign_feed_type(value);
    return this;
  }

  data(): __TnVariantSelectorResult<OracleFeedAccountBuilder> {
    if (!this.__tnVariantSelector_data) {
      this.__tnVariantSelector_data = __tnCreateVariantSelector(this, OracleFeedAccount.dataVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_data = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_feed_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_data!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_feed_type === null) throw new Error("OracleFeedAccountBuilder: field 'feed_type' must be set before build");
    if (!this.__tnPayload_data) throw new Error("OracleFeedAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_data.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = OracleFeedAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_feed_type === null) throw new Error("OracleFeedAccountBuilder: field 'feed_type' must be set before build");
    if (!this.__tnPayload_data) throw new Error("OracleFeedAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_data.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = OracleFeedAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("OracleFeedAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): OracleFeedAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = OracleFeedAccount.from_array(buffer, { params });
    if (!view) throw new Error("OracleFeedAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): OracleFeedAccount {
    return this.finish();
  }

  dynamicParams(): OracleFeedAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): OracleFeedAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = OracleFeedAccount.Params.fromValues({
      data_feed_type: (() => { if (this.__tnField_feed_type === null) throw new Error("OracleFeedAccountBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_feed_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_feed_type === null) throw new Error("OracleFeedAccountBuilder: field 'feed_type' must be set before build");
    if (!this.__tnPayload_data) throw new Error("OracleFeedAccountBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_feed_type);
    target.set(this.__tnPayload_data.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: OracleFeedAccount.Params): void {
    const result = OracleFeedAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ OracleFeedAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("OracleFeedAccount", (params) => OracleFeedAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("OracleFeedAccount", (buffer, params) => OracleFeedAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OracleFeedAccount", (buffer) => { const result = OracleFeedAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
