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

/* ----- TYPE DEFINITION FOR ExchangeInitializeInstruction ----- */

const __tn_ir_ExchangeInitializeInstruction = {
  typeName: "ExchangeInitializeInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class ExchangeInitializeInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: ExchangeInitializeInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: ExchangeInitializeInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = ExchangeInitializeInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("ExchangeInitializeInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: ExchangeInitializeInstruction.Params, fieldContext?: Record<string, number | bigint> }): ExchangeInitializeInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeInitializeInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = ExchangeInitializeInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("ExchangeInitializeInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new ExchangeInitializeInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): ExchangeInitializeInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "ExchangeInitializeInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "ExchangeInitializeInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("ExchangeInitializeInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): ExchangeInitializeInstructionBuilder {
    return new ExchangeInitializeInstructionBuilder();
  }

  static fromBuilder(builder: ExchangeInitializeInstructionBuilder): ExchangeInitializeInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return ExchangeInitializeInstruction.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_sz", paramKey: "proof_sz", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: ExchangeInitializeInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 15) {
      return null;
    }
    const __tnParam_proof_proof_sz = __tnToBigInt(view.getUint32(11, true));
    const __tnExtractedParams = ExchangeInitializeInstruction.Params.fromValues({
      proof_proof_sz: __tnParam_proof_proof_sz,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_reserved0(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_reserved0(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_exchange_meta_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_meta_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_meta_account_idx(): number {
    return this.get_exchange_meta_account_idx();
  }

  set exchange_meta_account_idx(value: number) {
    this.set_exchange_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_token_program_idx(): number {
    const offset = 7;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_idx(value: number): void {
    const offset = 7;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_idx(): number {
    return this.get_token_program_idx();
  }

  set token_program_idx(value: number) {
    this.set_token_program_idx(value);
  }

  get_exchange_admin_account_idx(): number {
    const offset = 9;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_admin_account_idx(value: number): void {
    const offset = 9;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_admin_account_idx(): number {
    return this.get_exchange_admin_account_idx();
  }

  set exchange_admin_account_idx(value: number) {
    this.set_exchange_admin_account_idx(value);
  }

  get_proof_sz(): number {
    const offset = 11;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz(value: number): void {
    const offset = 11;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz(): number {
    return this.get_proof_sz();
  }

  set proof_sz(value: number) {
    this.set_proof_sz(value);
  }

  get_proof_length(): number {
    return this.__tnResolveFieldRef("proof_sz");
  }

  get_proof_at(index: number): number {
    const offset = 15;
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
    const offset = 15;
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
    return __tnEvalFootprint(__tn_ir_ExchangeInitializeInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeInitializeInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_sz: number | bigint): bigint {
    const params = ExchangeInitializeInstruction.Params.fromValues({
      proof_proof_sz: proof_proof_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: ExchangeInitializeInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_sz"] = params.proof_proof_sz;
    return record;
  }

  static footprintIrFromParams(params: ExchangeInitializeInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: ExchangeInitializeInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeInitializeInstruction');
    return __tnBigIntToNumber(irResult, 'ExchangeInitializeInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_sz: number | bigint }): number {
    const params = ExchangeInitializeInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: ExchangeInitializeInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: ExchangeInitializeInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: ExchangeInitializeInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ExchangeInitializeInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ExchangeInitializeInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: ExchangeInitializeInstruction.Params }): ExchangeInitializeInstruction | null {
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
    const state = new ExchangeInitializeInstruction(buffer, cached);
    return state;
  }


}

export namespace ExchangeInitializeInstruction {
  export type Params = {
    /** ABI path: proof.proof_sz */
    readonly proof_proof_sz: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_proof_sz: "proof.proof_sz",
  } as const);

  export const Params = {
    fromValues(input: { proof_proof_sz: number | bigint }): Params {
      return {
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

  export function params(input: { proof_proof_sz: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class ExchangeInitializeInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: ExchangeInitializeInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: ExchangeInitializeInstruction.Params | null = null;
  private __tnFam_proof: Uint8Array | null = null;
  private __tnFam_proofCount: number | null = null;
  private __tnFamWriter_proof?: __TnFamWriterResult<ExchangeInitializeInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(15);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_reserved0(value: number): this {
    this.view.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  set_exchange_meta_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(5, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_token_program_idx(value: number): this {
    this.view.setUint16(7, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_exchange_admin_account_idx(value: number): this {
    this.view.setUint16(9, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz(value: number): this {
    this.view.setUint32(11, value, true);
    this.__tnInvalidate();
    return this;
  }

  proof(): __TnFamWriterResult<ExchangeInitializeInstructionBuilder> {
    if (!this.__tnFamWriter_proof) {
      this.__tnFamWriter_proof = __tnCreateFamWriter(this, "proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof = bytes;
        this.__tnFam_proofCount = elementCount;
        this.set_proof_sz(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = ExchangeInitializeInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = ExchangeInitializeInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("ExchangeInitializeInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): ExchangeInitializeInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = ExchangeInitializeInstruction.from_array(buffer, { params });
    if (!view) throw new Error("ExchangeInitializeInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): ExchangeInitializeInstruction {
    return this.finish();
  }

  dynamicParams(): ExchangeInitializeInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): ExchangeInitializeInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = ExchangeInitializeInstruction.Params.fromValues({
      proof_proof_sz: (() => { if (this.__tnFam_proofCount === null) throw new Error("ExchangeInitializeInstructionBuilder: field 'proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_proof_bytes = this.__tnFam_proof;
    if (!__tnLocal_proof_bytes) throw new Error("ExchangeInitializeInstructionBuilder: field 'proof' must be written before build");
    target.set(__tnLocal_proof_bytes, cursor);
    cursor += __tnLocal_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: ExchangeInitializeInstruction.Params): void {
    const result = ExchangeInitializeInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ ExchangeInitializeInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("ExchangeInitializeInstruction", (params) => ExchangeInitializeInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeInitializeInstruction", (buffer, params) => ExchangeInitializeInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeInitializeInstruction", (buffer) => { const result = ExchangeInitializeInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExchangeRecoverAdminInstruction ----- */

const __tn_ir_ExchangeRecoverAdminInstruction = {
  typeName: "ExchangeRecoverAdminInstruction",
  root: { op: "const", value: 15n }
} as const;

export class ExchangeRecoverAdminInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeRecoverAdminInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeRecoverAdminInstruction.__tnCreateView requires a Uint8Array");
    return new ExchangeRecoverAdminInstruction(new Uint8Array(buffer));
  }

  static builder(): ExchangeRecoverAdminInstructionBuilder {
    return new ExchangeRecoverAdminInstructionBuilder();
  }

  static fromBuilder(builder: ExchangeRecoverAdminInstructionBuilder): ExchangeRecoverAdminInstruction | null {
    const buffer = builder.build();
    return ExchangeRecoverAdminInstruction.from_array(buffer);
  }

  get_reserved0(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_reserved0(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_exchange_meta_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_meta_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_meta_account_idx(): number {
    return this.get_exchange_meta_account_idx();
  }

  set exchange_meta_account_idx(value: number) {
    this.set_exchange_meta_account_idx(value);
  }

  get_program_meta_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_meta_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_meta_account_idx(): number {
    return this.get_program_meta_account_idx();
  }

  set program_meta_account_idx(value: number) {
    this.set_program_meta_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_new_admin_account_idx(): number {
    const offset = 7;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_new_admin_account_idx(value: number): void {
    const offset = 7;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get new_admin_account_idx(): number {
    return this.get_new_admin_account_idx();
  }

  set new_admin_account_idx(value: number) {
    this.set_new_admin_account_idx(value);
  }

  get_reserved1(): number[] {
    const offset = 9;
    const result: number[] = [];
    for (let i = 0; i < 6; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved1(value: number[]): void {
    const offset = 9;
    if (value.length !== 6) {
      throw new Error('Array length must be 6');
    }
    for (let i = 0; i < 6; i++) {
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
    return __tnEvalFootprint(__tn_ir_ExchangeRecoverAdminInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeRecoverAdminInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeRecoverAdminInstruction');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeRecoverAdminInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 15) return { ok: false, code: "tn.buffer_too_small", consumed: 15 };
    return { ok: true, consumed: 15 };
  }

  static from_array(buffer: Uint8Array): ExchangeRecoverAdminInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeRecoverAdminInstruction(buffer);
  }

}

export class ExchangeRecoverAdminInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(15);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_reserved0(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_exchange_meta_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_program_meta_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(5, value, true);
    return this;
  }

  set_new_admin_account_idx(value: number): this {
    this.view.setUint16(7, value, true);
    return this;
  }

  set_reserved1(values: number[]): this {
    if (values.length !== 6) throw new Error("reserved1 expects 6 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 9 + i * 1;
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

  finish(): ExchangeRecoverAdminInstruction {
    const view = ExchangeRecoverAdminInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeRecoverAdminInstruction");
    return view;
  }
}

__tnRegisterFootprint("ExchangeRecoverAdminInstruction", (params) => ExchangeRecoverAdminInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeRecoverAdminInstruction", (buffer, params) => ExchangeRecoverAdminInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeRecoverAdminInstruction", (buffer) => { const result = ExchangeRecoverAdminInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExchangeSetAdminInstruction ----- */

const __tn_ir_ExchangeSetAdminInstruction = {
  typeName: "ExchangeSetAdminInstruction",
  root: { op: "const", value: 7n }
} as const;

export class ExchangeSetAdminInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeSetAdminInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeSetAdminInstruction.__tnCreateView requires a Uint8Array");
    return new ExchangeSetAdminInstruction(new Uint8Array(buffer));
  }

  static builder(): ExchangeSetAdminInstructionBuilder {
    return new ExchangeSetAdminInstructionBuilder();
  }

  static fromBuilder(builder: ExchangeSetAdminInstructionBuilder): ExchangeSetAdminInstruction | null {
    const buffer = builder.build();
    return ExchangeSetAdminInstruction.from_array(buffer);
  }

  get_reserved0(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_reserved0(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_exchange_meta_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_meta_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_meta_account_idx(): number {
    return this.get_exchange_meta_account_idx();
  }

  set exchange_meta_account_idx(value: number) {
    this.set_exchange_meta_account_idx(value);
  }

  get_authority_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authority_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authority_account_idx(): number {
    return this.get_authority_account_idx();
  }

  set authority_account_idx(value: number) {
    this.set_authority_account_idx(value);
  }

  get_new_admin_account_idx(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_new_admin_account_idx(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get new_admin_account_idx(): number {
    return this.get_new_admin_account_idx();
  }

  set new_admin_account_idx(value: number) {
    this.set_new_admin_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ExchangeSetAdminInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeSetAdminInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeSetAdminInstruction');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeSetAdminInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(reserved0: number, exchange_meta_account_idx: number, authority_account_idx: number, new_admin_account_idx: number): ExchangeSetAdminInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, reserved0); /* reserved0 */
    view.setUint16(1, exchange_meta_account_idx, true); /* exchange_meta_account_idx (little-endian) */
    view.setUint16(3, authority_account_idx, true); /* authority_account_idx (little-endian) */
    view.setUint16(5, new_admin_account_idx, true); /* new_admin_account_idx (little-endian) */

    return new ExchangeSetAdminInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): ExchangeSetAdminInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeSetAdminInstruction(buffer);
  }

}

export class ExchangeSetAdminInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(7);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_reserved0(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_exchange_meta_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_new_admin_account_idx(value: number): this {
    this.view.setUint16(5, value, true);
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

  finish(): ExchangeSetAdminInstruction {
    const view = ExchangeSetAdminInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeSetAdminInstruction");
    return view;
  }
}

__tnRegisterFootprint("ExchangeSetAdminInstruction", (params) => ExchangeSetAdminInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeSetAdminInstruction", (buffer, params) => ExchangeSetAdminInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeSetAdminInstruction", (buffer) => { const result = ExchangeSetAdminInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExchangeSetStatusInstruction ----- */

const __tn_ir_ExchangeSetStatusInstruction = {
  typeName: "ExchangeSetStatusInstruction",
  root: { op: "const", value: 7n }
} as const;

export class ExchangeSetStatusInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeSetStatusInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeSetStatusInstruction.__tnCreateView requires a Uint8Array");
    return new ExchangeSetStatusInstruction(new Uint8Array(buffer));
  }

  static builder(): ExchangeSetStatusInstructionBuilder {
    return new ExchangeSetStatusInstructionBuilder();
  }

  static fromBuilder(builder: ExchangeSetStatusInstructionBuilder): ExchangeSetStatusInstruction | null {
    const buffer = builder.build();
    return ExchangeSetStatusInstruction.from_array(buffer);
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

  get_exchange_meta_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_meta_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_meta_account_idx(): number {
    return this.get_exchange_meta_account_idx();
  }

  set exchange_meta_account_idx(value: number) {
    this.set_exchange_meta_account_idx(value);
  }

  get_exchange_admin_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_admin_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_admin_account_idx(): number {
    return this.get_exchange_admin_account_idx();
  }

  set exchange_admin_account_idx(value: number) {
    this.set_exchange_admin_account_idx(value);
  }

  get_reserved0(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ExchangeSetStatusInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeSetStatusInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeSetStatusInstruction');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeSetStatusInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(status_flags: number, exchange_meta_account_idx: number, exchange_admin_account_idx: number, reserved0: number): ExchangeSetStatusInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, status_flags); /* status_flags */
    view.setUint16(1, exchange_meta_account_idx, true); /* exchange_meta_account_idx (little-endian) */
    view.setUint16(3, exchange_admin_account_idx, true); /* exchange_admin_account_idx (little-endian) */
    view.setUint16(5, reserved0, true); /* reserved0 (little-endian) */

    return new ExchangeSetStatusInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): ExchangeSetStatusInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeSetStatusInstruction(buffer);
  }

}

export class ExchangeSetStatusInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(7);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_status_flags(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_exchange_meta_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_exchange_admin_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(5, value, true);
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

  finish(): ExchangeSetStatusInstruction {
    const view = ExchangeSetStatusInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeSetStatusInstruction");
    return view;
  }
}

__tnRegisterFootprint("ExchangeSetStatusInstruction", (params) => ExchangeSetStatusInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeSetStatusInstruction", (buffer, params) => ExchangeSetStatusInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeSetStatusInstruction", (buffer) => { const result = ExchangeSetStatusInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FeeClaimInstruction ----- */

const __tn_ir_FeeClaimInstruction = {
  typeName: "FeeClaimInstruction",
  root: { op: "const", value: 15n }
} as const;

export class FeeClaimInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FeeClaimInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("FeeClaimInstruction.__tnCreateView requires a Uint8Array");
    return new FeeClaimInstruction(new Uint8Array(buffer));
  }

  static builder(): FeeClaimInstructionBuilder {
    return new FeeClaimInstructionBuilder();
  }

  static fromBuilder(builder: FeeClaimInstructionBuilder): FeeClaimInstruction | null {
    const buffer = builder.build();
    return FeeClaimInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_reserved1(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FeeClaimInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FeeClaimInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FeeClaimInstruction');
    }
    return __tnBigIntToNumber(irResult, 'FeeClaimInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 15) return { ok: false, code: "tn.buffer_too_small", consumed: 15 };
    return { ok: true, consumed: 15 };
  }

  static new(market_record_idx: number, reserved0: number, reserved1: number, amount: bigint): FeeClaimInstruction {
    const buffer = new Uint8Array(15);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, reserved1, true); /* reserved1 (little-endian) */
    view.setBigUint64(7, amount, true); /* amount (little-endian) */

    return new FeeClaimInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): FeeClaimInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FeeClaimInstruction(buffer);
  }

}

export class FeeClaimInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(15);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(3, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
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

  finish(): FeeClaimInstruction {
    const view = FeeClaimInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FeeClaimInstruction");
    return view;
  }
}

__tnRegisterFootprint("FeeClaimInstruction", (params) => FeeClaimInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("FeeClaimInstruction", (buffer, params) => FeeClaimInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FeeClaimInstruction", (buffer) => { const result = FeeClaimInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FundingUpdateInstruction ----- */

const __tn_ir_FundingUpdateInstruction = {
  typeName: "FundingUpdateInstruction",
  root: { op: "const", value: 7n }
} as const;

export class FundingUpdateInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FundingUpdateInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("FundingUpdateInstruction.__tnCreateView requires a Uint8Array");
    return new FundingUpdateInstruction(new Uint8Array(buffer));
  }

  static builder(): FundingUpdateInstructionBuilder {
    return new FundingUpdateInstructionBuilder();
  }

  static fromBuilder(builder: FundingUpdateInstructionBuilder): FundingUpdateInstruction | null {
    const buffer = builder.build();
    return FundingUpdateInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_reserved1(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FundingUpdateInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FundingUpdateInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FundingUpdateInstruction');
    }
    return __tnBigIntToNumber(irResult, 'FundingUpdateInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, reserved0: number, reserved1: number): FundingUpdateInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, reserved1, true); /* reserved1 (little-endian) */

    return new FundingUpdateInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): FundingUpdateInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FundingUpdateInstruction(buffer);
  }

}

export class FundingUpdateInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(3, value, true);
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

  finish(): FundingUpdateInstruction {
    const view = FundingUpdateInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FundingUpdateInstruction");
    return view;
  }
}

__tnRegisterFootprint("FundingUpdateInstruction", (params) => FundingUpdateInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("FundingUpdateInstruction", (buffer, params) => FundingUpdateInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FundingUpdateInstruction", (buffer) => { const result = FundingUpdateInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR InsuranceDepositInstruction ----- */

const __tn_ir_InsuranceDepositInstruction = {
  typeName: "InsuranceDepositInstruction",
  root: { op: "const", value: 15n }
} as const;

export class InsuranceDepositInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): InsuranceDepositInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("InsuranceDepositInstruction.__tnCreateView requires a Uint8Array");
    return new InsuranceDepositInstruction(new Uint8Array(buffer));
  }

  static builder(): InsuranceDepositInstructionBuilder {
    return new InsuranceDepositInstructionBuilder();
  }

  static fromBuilder(builder: InsuranceDepositInstructionBuilder): InsuranceDepositInstruction | null {
    const buffer = builder.build();
    return InsuranceDepositInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_reserved1(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InsuranceDepositInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InsuranceDepositInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InsuranceDepositInstruction');
    }
    return __tnBigIntToNumber(irResult, 'InsuranceDepositInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 15) return { ok: false, code: "tn.buffer_too_small", consumed: 15 };
    return { ok: true, consumed: 15 };
  }

  static new(market_record_idx: number, reserved0: number, reserved1: number, amount: bigint): InsuranceDepositInstruction {
    const buffer = new Uint8Array(15);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, reserved1, true); /* reserved1 (little-endian) */
    view.setBigUint64(7, amount, true); /* amount (little-endian) */

    return new InsuranceDepositInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): InsuranceDepositInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new InsuranceDepositInstruction(buffer);
  }

}

export class InsuranceDepositInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(15);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(3, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
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

  finish(): InsuranceDepositInstruction {
    const view = InsuranceDepositInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build InsuranceDepositInstruction");
    return view;
  }
}

__tnRegisterFootprint("InsuranceDepositInstruction", (params) => InsuranceDepositInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("InsuranceDepositInstruction", (buffer, params) => InsuranceDepositInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InsuranceDepositInstruction", (buffer) => { const result = InsuranceDepositInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR LiquidateInstruction ----- */

const __tn_ir_LiquidateInstruction = {
  typeName: "LiquidateInstruction",
  root: { op: "const", value: 7n }
} as const;

export class LiquidateInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): LiquidateInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("LiquidateInstruction.__tnCreateView requires a Uint8Array");
    return new LiquidateInstruction(new Uint8Array(buffer));
  }

  static builder(): LiquidateInstructionBuilder {
    return new LiquidateInstructionBuilder();
  }

  static fromBuilder(builder: LiquidateInstructionBuilder): LiquidateInstruction | null {
    const buffer = builder.build();
    return LiquidateInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_target_seat_idx(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_target_seat_idx(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get target_seat_idx(): number {
    return this.get_target_seat_idx();
  }

  set target_seat_idx(value: number) {
    this.set_target_seat_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_LiquidateInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_LiquidateInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for LiquidateInstruction');
    }
    return __tnBigIntToNumber(irResult, 'LiquidateInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, reserved0: number, target_seat_idx: number): LiquidateInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, target_seat_idx, true); /* target_seat_idx (little-endian) */

    return new LiquidateInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): LiquidateInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new LiquidateInstruction(buffer);
  }

}

export class LiquidateInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_target_seat_idx(value: number): this {
    this.view.setUint32(3, value, true);
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

  finish(): LiquidateInstruction {
    const view = LiquidateInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build LiquidateInstruction");
    return view;
  }
}

__tnRegisterFootprint("LiquidateInstruction", (params) => LiquidateInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("LiquidateInstruction", (buffer, params) => LiquidateInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("LiquidateInstruction", (buffer) => { const result = LiquidateInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginAccountCreateInstruction ----- */

const __tn_ir_MarginAccountCreateInstruction = {
  typeName: "MarginAccountCreateInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class MarginAccountCreateInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: MarginAccountCreateInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: MarginAccountCreateInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = MarginAccountCreateInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("MarginAccountCreateInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: MarginAccountCreateInstruction.Params, fieldContext?: Record<string, number | bigint> }): MarginAccountCreateInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarginAccountCreateInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = MarginAccountCreateInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("MarginAccountCreateInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new MarginAccountCreateInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): MarginAccountCreateInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "MarginAccountCreateInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "MarginAccountCreateInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("MarginAccountCreateInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): MarginAccountCreateInstructionBuilder {
    return new MarginAccountCreateInstructionBuilder();
  }

  static fromBuilder(builder: MarginAccountCreateInstructionBuilder): MarginAccountCreateInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return MarginAccountCreateInstruction.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_sz", paramKey: "proof_sz", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: MarginAccountCreateInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 15) {
      return null;
    }
    const __tnParam_proof_proof_sz = __tnToBigInt(view.getUint32(11, true));
    const __tnExtractedParams = MarginAccountCreateInstruction.Params.fromValues({
      proof_proof_sz: __tnParam_proof_proof_sz,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_reserved0(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_reserved0(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_owner_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_owner_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get owner_account_idx(): number {
    return this.get_owner_account_idx();
  }

  set owner_account_idx(value: number) {
    this.set_owner_account_idx(value);
  }

  get_margin_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_margin_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get margin_account_idx(): number {
    return this.get_margin_account_idx();
  }

  set margin_account_idx(value: number) {
    this.set_margin_account_idx(value);
  }

  get_vault_account_idx(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_account_idx(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_account_idx(): number {
    return this.get_vault_account_idx();
  }

  set vault_account_idx(value: number) {
    this.set_vault_account_idx(value);
  }

  get_account_id(): number {
    const offset = 7;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_account_id(value: number): void {
    const offset = 7;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get account_id(): number {
    return this.get_account_id();
  }

  set account_id(value: number) {
    this.set_account_id(value);
  }

  get_proof_sz(): number {
    const offset = 11;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz(value: number): void {
    const offset = 11;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz(): number {
    return this.get_proof_sz();
  }

  set proof_sz(value: number) {
    this.set_proof_sz(value);
  }

  get_proof_length(): number {
    return this.__tnResolveFieldRef("proof_sz");
  }

  get_proof_at(index: number): number {
    const offset = 15;
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
    const offset = 15;
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
    return __tnEvalFootprint(__tn_ir_MarginAccountCreateInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginAccountCreateInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_sz: number | bigint): bigint {
    const params = MarginAccountCreateInstruction.Params.fromValues({
      proof_proof_sz: proof_proof_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: MarginAccountCreateInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_sz"] = params.proof_proof_sz;
    return record;
  }

  static footprintIrFromParams(params: MarginAccountCreateInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: MarginAccountCreateInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginAccountCreateInstruction');
    return __tnBigIntToNumber(irResult, 'MarginAccountCreateInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_sz: number | bigint }): number {
    const params = MarginAccountCreateInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: MarginAccountCreateInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: MarginAccountCreateInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: MarginAccountCreateInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MarginAccountCreateInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MarginAccountCreateInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: MarginAccountCreateInstruction.Params }): MarginAccountCreateInstruction | null {
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
    const state = new MarginAccountCreateInstruction(buffer, cached);
    return state;
  }


}

export namespace MarginAccountCreateInstruction {
  export type Params = {
    /** ABI path: proof.proof_sz */
    readonly proof_proof_sz: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_proof_sz: "proof.proof_sz",
  } as const);

  export const Params = {
    fromValues(input: { proof_proof_sz: number | bigint }): Params {
      return {
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

  export function params(input: { proof_proof_sz: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class MarginAccountCreateInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: MarginAccountCreateInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: MarginAccountCreateInstruction.Params | null = null;
  private __tnFam_proof: Uint8Array | null = null;
  private __tnFam_proofCount: number | null = null;
  private __tnFamWriter_proof?: __TnFamWriterResult<MarginAccountCreateInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(15);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_reserved0(value: number): this {
    this.view.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  set_owner_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_margin_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_vault_account_idx(value: number): this {
    this.view.setUint16(5, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_account_id(value: number): this {
    this.view.setUint32(7, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz(value: number): this {
    this.view.setUint32(11, value, true);
    this.__tnInvalidate();
    return this;
  }

  proof(): __TnFamWriterResult<MarginAccountCreateInstructionBuilder> {
    if (!this.__tnFamWriter_proof) {
      this.__tnFamWriter_proof = __tnCreateFamWriter(this, "proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof = bytes;
        this.__tnFam_proofCount = elementCount;
        this.set_proof_sz(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = MarginAccountCreateInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = MarginAccountCreateInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("MarginAccountCreateInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): MarginAccountCreateInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = MarginAccountCreateInstruction.from_array(buffer, { params });
    if (!view) throw new Error("MarginAccountCreateInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): MarginAccountCreateInstruction {
    return this.finish();
  }

  dynamicParams(): MarginAccountCreateInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): MarginAccountCreateInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = MarginAccountCreateInstruction.Params.fromValues({
      proof_proof_sz: (() => { if (this.__tnFam_proofCount === null) throw new Error("MarginAccountCreateInstructionBuilder: field 'proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_proof_bytes = this.__tnFam_proof;
    if (!__tnLocal_proof_bytes) throw new Error("MarginAccountCreateInstructionBuilder: field 'proof' must be written before build");
    target.set(__tnLocal_proof_bytes, cursor);
    cursor += __tnLocal_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: MarginAccountCreateInstruction.Params): void {
    const result = MarginAccountCreateInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ MarginAccountCreateInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("MarginAccountCreateInstruction", (params) => MarginAccountCreateInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginAccountCreateInstruction", (buffer, params) => MarginAccountCreateInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginAccountCreateInstruction", (buffer) => { const result = MarginAccountCreateInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginLinkInstruction ----- */

const __tn_ir_MarginLinkInstruction = {
  typeName: "MarginLinkInstruction",
  root: { op: "const", value: 7n }
} as const;

export class MarginLinkInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarginLinkInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarginLinkInstruction.__tnCreateView requires a Uint8Array");
    return new MarginLinkInstruction(new Uint8Array(buffer));
  }

  static builder(): MarginLinkInstructionBuilder {
    return new MarginLinkInstructionBuilder();
  }

  static fromBuilder(builder: MarginLinkInstructionBuilder): MarginLinkInstruction | null {
    const buffer = builder.build();
    return MarginLinkInstruction.from_array(buffer);
  }

  get_margin_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_margin_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get margin_record_idx(): number {
    return this.get_margin_record_idx();
  }

  set margin_record_idx(value: number) {
    this.set_margin_record_idx(value);
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginLinkInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginLinkInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginLinkInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarginLinkInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static from_array(buffer: Uint8Array): MarginLinkInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarginLinkInstruction(buffer);
  }

}

export class MarginLinkInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(7);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_margin_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_market_record_idx(value: number): this {
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

  finish(): MarginLinkInstruction {
    const view = MarginLinkInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarginLinkInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarginLinkInstruction", (params) => MarginLinkInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginLinkInstruction", (buffer, params) => MarginLinkInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginLinkInstruction", (buffer) => { const result = MarginLinkInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginRecordEntry ----- */

const __tn_ir_MarginRecordEntry = {
  typeName: "MarginRecordEntry",
  root: { op: "const", value: 4n }
} as const;

export class MarginRecordEntry {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarginRecordEntry {
    if (!buffer || buffer.length === undefined) throw new Error("MarginRecordEntry.__tnCreateView requires a Uint8Array");
    return new MarginRecordEntry(new Uint8Array(buffer));
  }

  static builder(): MarginRecordEntryBuilder {
    return new MarginRecordEntryBuilder();
  }

  static fromBuilder(builder: MarginRecordEntryBuilder): MarginRecordEntry | null {
    const buffer = builder.build();
    return MarginRecordEntry.from_array(buffer);
  }

  get_seat_arena_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_seat_arena_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get seat_arena_account_idx(): number {
    return this.get_seat_arena_account_idx();
  }

  set seat_arena_account_idx(value: number) {
    this.set_seat_arena_account_idx(value);
  }

  get_oracle_feed_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_oracle_feed_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get oracle_feed_account_idx(): number {
    return this.get_oracle_feed_account_idx();
  }

  set oracle_feed_account_idx(value: number) {
    this.set_oracle_feed_account_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginRecordEntry.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginRecordEntry, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginRecordEntry');
    }
    return __tnBigIntToNumber(irResult, 'MarginRecordEntry::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 4) return { ok: false, code: "tn.buffer_too_small", consumed: 4 };
    return { ok: true, consumed: 4 };
  }

  static new(seat_arena_account_idx: number, oracle_feed_account_idx: number): MarginRecordEntry {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, seat_arena_account_idx, true); /* seat_arena_account_idx (little-endian) */
    view.setUint16(2, oracle_feed_account_idx, true); /* oracle_feed_account_idx (little-endian) */

    return new MarginRecordEntry(buffer);
  }

  static from_array(buffer: Uint8Array): MarginRecordEntry | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarginRecordEntry(buffer);
  }

}

export class MarginRecordEntryBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(4);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_arena_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_oracle_feed_account_idx(value: number): this {
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

  finish(): MarginRecordEntry {
    const view = MarginRecordEntry.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarginRecordEntry");
    return view;
  }
}

__tnRegisterFootprint("MarginRecordEntry", (params) => MarginRecordEntry.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginRecordEntry", (buffer, params) => MarginRecordEntry.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginRecordEntry", (buffer) => { const result = MarginRecordEntry.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginRecordInstruction ----- */

const __tn_ir_MarginRecordInstruction = {
  typeName: "MarginRecordInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "entries.link_cnt" }, right: { op: "const", value: 4n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "mul", left: { op: "bitAnd", left: { op: "field", param: "padding.link_cnt" }, right: { op: "const", value: 1n } }, right: { op: "const", value: 4n } }, right: { op: "const", value: 1n } } } } }
} as const;

export class MarginRecordInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: MarginRecordInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: MarginRecordInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = MarginRecordInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("MarginRecordInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: MarginRecordInstruction.Params, fieldContext?: Record<string, number | bigint> }): MarginRecordInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarginRecordInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = MarginRecordInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("MarginRecordInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new MarginRecordInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): MarginRecordInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "MarginRecordInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "MarginRecordInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("MarginRecordInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_margin_record_idx: number | null = null;
    let __tnFieldValue_margin_account_idx: number | null = null;
    let __tnFieldValue_link_cnt: number | null = null;
    let __tnFieldValue_reserved0: number | null = null;
    let __tnFieldValue_exchange_meta_account_idx: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_margin_record_idx = view.getUint8(__tnCursorMutable);
    __tnFieldValue_margin_record_idx = __tnRead_margin_record_idx;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_margin_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_margin_account_idx = __tnRead_margin_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_link_cnt = view.getUint8(__tnCursorMutable);
    __tnFieldValue_link_cnt = __tnRead_link_cnt;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_reserved0 = view.getUint8(__tnCursorMutable);
    __tnFieldValue_reserved0 = __tnRead_reserved0;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_exchange_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_exchange_meta_account_idx = __tnRead_exchange_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnFieldValue_link_cnt === null) return null;
    const __tnArrayCount_entries = Math.trunc(Number(__tnFieldValue_link_cnt));
    if (!Number.isFinite(__tnArrayCount_entries) || __tnArrayCount_entries < 0) return null;
    const __tnArrayBytes_entries = __tnArrayCount_entries * 4;
    if (__tnCursorMutable + __tnArrayBytes_entries > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_entries;
    if (__tnFieldValue_link_cnt === null) return null;
    const __tnArrayCount_padding = Math.trunc(((Number(__tnFieldValue_link_cnt) & 1) * 4));
    if (!Number.isFinite(__tnArrayCount_padding) || __tnArrayCount_padding < 0) return null;
    const __tnArrayBytes_padding = __tnArrayCount_padding * 1;
    offsets["padding"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_padding > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_padding;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: MarginRecordInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_entries_link_cnt = __tnToBigInt(view.getUint8(3));
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_padding_link_cnt = __tnToBigInt(view.getUint8(3));
    const __tnExtractedParams = MarginRecordInstruction.Params.fromValues({
      entries_link_cnt: __tnParam_entries_link_cnt,
      padding_link_cnt: __tnParam_padding_link_cnt,
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
      throw new Error("MarginRecordInstruction: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = MarginRecordInstruction.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("MarginRecordInstruction: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_margin_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_margin_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get margin_record_idx(): number {
    return this.get_margin_record_idx();
  }

  set margin_record_idx(value: number) {
    this.set_margin_record_idx(value);
  }

  get_margin_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_margin_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get margin_account_idx(): number {
    return this.get_margin_account_idx();
  }

  set margin_account_idx(value: number) {
    this.set_margin_account_idx(value);
  }

  get_link_cnt(): number {
    const offset = 3;
    return this.view.getUint8(offset);
  }

  set_link_cnt(value: number): void {
    const offset = 3;
    this.view.setUint8(offset, value);
  }

  get link_cnt(): number {
    return this.get_link_cnt();
  }

  set link_cnt(value: number) {
    this.set_link_cnt(value);
  }

  get_reserved0(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_reserved0(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_exchange_meta_account_idx(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_meta_account_idx(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_meta_account_idx(): number {
    return this.get_exchange_meta_account_idx();
  }

  set exchange_meta_account_idx(value: number) {
    this.set_exchange_meta_account_idx(value);
  }

  get_entries_length(): number {
    return this.__tnResolveFieldRef("link_cnt");
  }

  get_entries_at(index: number): MarginRecordEntry {
    const offset = 7;
    const slice = this.buffer.subarray((offset + index * 4), (offset + (index + 1) * 4));
    return MarginRecordEntry.from_array(slice)!;
  }

  get_entries(): MarginRecordEntry[] {
    const len = this.get_entries_length();
    const result: MarginRecordEntry[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_entries_at(i));
    }
    return result;
  }

  set_entries_at(index: number, value: MarginRecordEntry): void {
    const offset = 7;
    const slice = this.buffer.subarray(offset + index * 4, offset + (index + 1) * 4);
    slice.set(value['buffer']);
  }

  set_entries(value: MarginRecordEntry[]): void {
    const len = Math.min(this.get_entries_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_entries_at(i, value[i]);
    }
  }

  get entries(): MarginRecordEntry[] {
    return this.get_entries();
  }

  set entries(value: MarginRecordEntry[]) {
    this.set_entries(value);
  }

  get_padding_length(): number {
    return ((this.__tnResolveFieldRef("link_cnt") & 1) * 4);
  }

  get_padding_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("padding");
    return this.view.getUint8(offset + index * 1);
  }

  get_padding(): number[] {
    const len = this.get_padding_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_padding_at(i));
    }
    return result;
  }

  set_padding_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("padding");
    this.view.setUint8((offset + index * 1), value);
  }

  set_padding(value: number[]): void {
    const len = Math.min(this.get_padding_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_padding_at(i, value[i]);
    }
  }

  get padding(): number[] {
    return this.get_padding();
  }

  set padding(value: number[]) {
    this.set_padding(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginRecordInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginRecordInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(entries_link_cnt: number | bigint, padding_link_cnt: number | bigint): bigint {
    const params = MarginRecordInstruction.Params.fromValues({
      entries_link_cnt: entries_link_cnt,
      padding_link_cnt: padding_link_cnt,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: MarginRecordInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["entries.link_cnt"] = params.entries_link_cnt;
    record["padding.link_cnt"] = params.padding_link_cnt;
    return record;
  }

  static footprintIrFromParams(params: MarginRecordInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: MarginRecordInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginRecordInstruction');
    return __tnBigIntToNumber(irResult, 'MarginRecordInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { entries_link_cnt: number | bigint, padding_link_cnt: number | bigint }): number {
    const params = MarginRecordInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: MarginRecordInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: MarginRecordInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: MarginRecordInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MarginRecordInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'MarginRecordInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: MarginRecordInstruction.Params }): MarginRecordInstruction | null {
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
    const state = new MarginRecordInstruction(buffer, cached);
    return state;
  }


}

export namespace MarginRecordInstruction {
  export type Params = {
    /** ABI path: entries.link_cnt */
    readonly entries_link_cnt: bigint;
    /** ABI path: padding.link_cnt */
    readonly padding_link_cnt: bigint;
  };

  export const ParamKeys = Object.freeze({
    entries_link_cnt: "entries.link_cnt",
    padding_link_cnt: "padding.link_cnt",
  } as const);

  export const Params = {
    fromValues(input: { entries_link_cnt: number | bigint, padding_link_cnt: number | bigint }): Params {
      return {
        entries_link_cnt: __tnToBigInt(input.entries_link_cnt),
        padding_link_cnt: __tnToBigInt(input.padding_link_cnt),
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

  export function params(input: { entries_link_cnt: number | bigint, padding_link_cnt: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("MarginRecordInstruction", (params) => MarginRecordInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginRecordInstruction", (buffer, params) => MarginRecordInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginRecordInstruction", (buffer) => { const result = MarginRecordInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginTransferInstruction ----- */

const __tn_ir_MarginTransferInstruction = {
  typeName: "MarginTransferInstruction",
  root: { op: "const", value: 15n }
} as const;

export class MarginTransferInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarginTransferInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarginTransferInstruction.__tnCreateView requires a Uint8Array");
    return new MarginTransferInstruction(new Uint8Array(buffer));
  }

  static builder(): MarginTransferInstructionBuilder {
    return new MarginTransferInstructionBuilder();
  }

  static fromBuilder(builder: MarginTransferInstructionBuilder): MarginTransferInstruction | null {
    const buffer = builder.build();
    return MarginTransferInstruction.from_array(buffer);
  }

  get_margin_record_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_margin_record_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get margin_record_idx(): number {
    return this.get_margin_record_idx();
  }

  set margin_record_idx(value: number) {
    this.set_margin_record_idx(value);
  }

  get_from_link(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_from_link(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get from_link(): number {
    return this.get_from_link();
  }

  set from_link(value: number) {
    this.set_from_link(value);
  }

  get_to_link(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_to_link(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get to_link(): number {
    return this.get_to_link();
  }

  set to_link(value: number) {
    this.set_to_link(value);
  }

  get_owner_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_owner_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get owner_account_idx(): number {
    return this.get_owner_account_idx();
  }

  set owner_account_idx(value: number) {
    this.set_owner_account_idx(value);
  }

  get_reserved0(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginTransferInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginTransferInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginTransferInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarginTransferInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 15) return { ok: false, code: "tn.buffer_too_small", consumed: 15 };
    return { ok: true, consumed: 15 };
  }

  static new(margin_record_idx: number, from_link: number, to_link: number, owner_account_idx: number, reserved0: number, amount: bigint): MarginTransferInstruction {
    const buffer = new Uint8Array(15);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, margin_record_idx); /* margin_record_idx */
    view.setUint8(1, from_link); /* from_link */
    view.setUint8(2, to_link); /* to_link */
    view.setUint16(3, owner_account_idx, true); /* owner_account_idx (little-endian) */
    view.setUint16(5, reserved0, true); /* reserved0 (little-endian) */
    view.setBigUint64(7, amount, true); /* amount (little-endian) */

    return new MarginTransferInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarginTransferInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarginTransferInstruction(buffer);
  }

}

export class MarginTransferInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(15);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_margin_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_from_link(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_to_link(value: number): this {
    this.view.setUint8(2, value);
    return this;
  }

  set_owner_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(5, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
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

  finish(): MarginTransferInstruction {
    const view = MarginTransferInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarginTransferInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarginTransferInstruction", (params) => MarginTransferInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginTransferInstruction", (buffer, params) => MarginTransferInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginTransferInstruction", (buffer) => { const result = MarginTransferInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketCreateInstruction ----- */

const __tn_ir_MarketCreateInstruction = {
  typeName: "MarketCreateInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_seat_arena.proof_sz_seat_arena" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_order_arena.proof_sz_order_arena" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_bids_cbook.proof_sz_bids_cbook" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_asks_cbook.proof_sz_asks_cbook" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof_quote_vault.proof_sz_quote_vault" }, right: { op: "const", value: 1n } } } } }
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
    { field: "proof_quote_vault", method: "proof_quote_vault", sizeField: "proof_sz_quote_vault", paramKey: "proof_sz_quote_vault", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_market_record_idx: number | null = null;
    let __tnFieldValue_token_program_idx: number | null = null;
    let __tnFieldValue_exchange_meta_account_idx: number | null = null;
    let __tnFieldValue_quote_mint_idx: number | null = null;
    let __tnFieldValue_lot_size: bigint | null = null;
    let __tnFieldValue_tick_size: bigint | null = null;
    let __tnFieldValue_price_cap: bigint | null = null;
    let __tnFieldValue_max_position_lots: bigint | null = null;
    let __tnFieldValue_seat_arena_account_idx: number | null = null;
    let __tnFieldValue_order_arena_account_idx: number | null = null;
    let __tnFieldValue_bids_cbook_account_idx: number | null = null;
    let __tnFieldValue_asks_cbook_account_idx: number | null = null;
    let __tnFieldValue_quote_vault_account_idx: number | null = null;
    let __tnFieldValue_market_authority_account_idx: number | null = null;
    let __tnFieldValue_proof_sz_seat_arena: number | null = null;
    let __tnFieldValue_proof_sz_order_arena: number | null = null;
    let __tnFieldValue_proof_sz_bids_cbook: number | null = null;
    let __tnFieldValue_proof_sz_asks_cbook: number | null = null;
    let __tnFieldValue_proof_sz_quote_vault: number | null = null;
    let __tnFieldValue_oracle_feed_account_idx: number | null = null;
    let __tnFieldValue_initial_margin_bps: number | null = null;
    let __tnFieldValue_maintenance_margin_bps: number | null = null;
    let __tnFieldValue_liquidation_fee_bps: number | null = null;
    let __tnFieldValue_mark_num: bigint | null = null;
    let __tnFieldValue_mark_den: bigint | null = null;
    let __tnFieldValue_oracle_exponent: number | null = null;
    let __tnFieldValue_reserved1: number | null = null;
    let __tnFieldValue_max_mark_age_ns: bigint | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_market_record_idx = view.getUint8(__tnCursorMutable);
    __tnFieldValue_market_record_idx = __tnRead_market_record_idx;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_token_program_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_token_program_idx = __tnRead_token_program_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_exchange_meta_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_exchange_meta_account_idx = __tnRead_exchange_meta_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_quote_mint_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_quote_mint_idx = __tnRead_quote_mint_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_lot_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_lot_size = __tnRead_lot_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_tick_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_tick_size = __tnRead_tick_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_price_cap = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_price_cap = __tnRead_price_cap;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_max_position_lots = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_max_position_lots = __tnRead_max_position_lots;
    __tnCursorMutable += 8;
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
    const __tnRead_proof_sz_quote_vault = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_proof_sz_quote_vault = __tnRead_proof_sz_quote_vault;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_oracle_feed_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_oracle_feed_account_idx = __tnRead_oracle_feed_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_initial_margin_bps = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_initial_margin_bps = __tnRead_initial_margin_bps;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_maintenance_margin_bps = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_maintenance_margin_bps = __tnRead_maintenance_margin_bps;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_liquidation_fee_bps = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_liquidation_fee_bps = __tnRead_liquidation_fee_bps;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_mark_num = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_mark_num = __tnRead_mark_num;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_mark_den = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_mark_den = __tnRead_mark_den;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_oracle_exponent = view.getInt32(__tnCursorMutable, true);
    __tnFieldValue_oracle_exponent = __tnRead_oracle_exponent;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_reserved1 = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_reserved1 = __tnRead_reserved1;
    __tnCursorMutable += 4;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_max_mark_age_ns = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_max_mark_age_ns = __tnRead_max_mark_age_ns;
    __tnCursorMutable += 8;
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
    if (buffer.length < 67) {
      return null;
    }
    const __tnParam_proof_asks_cbook_proof_sz_asks_cbook = __tnToBigInt(view.getUint32(63, true));
    if (buffer.length < 63) {
      return null;
    }
    const __tnParam_proof_bids_cbook_proof_sz_bids_cbook = __tnToBigInt(view.getUint32(59, true));
    if (buffer.length < 59) {
      return null;
    }
    const __tnParam_proof_order_arena_proof_sz_order_arena = __tnToBigInt(view.getUint32(55, true));
    if (buffer.length < 71) {
      return null;
    }
    const __tnParam_proof_quote_vault_proof_sz_quote_vault = __tnToBigInt(view.getUint32(67, true));
    if (buffer.length < 55) {
      return null;
    }
    const __tnParam_proof_seat_arena_proof_sz_seat_arena = __tnToBigInt(view.getUint32(51, true));
    const __tnExtractedParams = MarketCreateInstruction.Params.fromValues({
      proof_asks_cbook_proof_sz_asks_cbook: __tnParam_proof_asks_cbook_proof_sz_asks_cbook,
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

  get_exchange_meta_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_meta_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_meta_account_idx(): number {
    return this.get_exchange_meta_account_idx();
  }

  set exchange_meta_account_idx(value: number) {
    this.set_exchange_meta_account_idx(value);
  }

  get_quote_mint_idx(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_quote_mint_idx(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get quote_mint_idx(): number {
    return this.get_quote_mint_idx();
  }

  set quote_mint_idx(value: number) {
    this.set_quote_mint_idx(value);
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

  get_price_cap(): bigint {
    const offset = 23;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price_cap(value: bigint): void {
    const offset = 23;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price_cap(): bigint {
    return this.get_price_cap();
  }

  set price_cap(value: bigint) {
    this.set_price_cap(value);
  }

  get_max_position_lots(): bigint {
    const offset = 31;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_position_lots(value: bigint): void {
    const offset = 31;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_position_lots(): bigint {
    return this.get_max_position_lots();
  }

  set max_position_lots(value: bigint) {
    this.set_max_position_lots(value);
  }

  get_seat_arena_account_idx(): number {
    const offset = 39;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_seat_arena_account_idx(value: number): void {
    const offset = 39;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get seat_arena_account_idx(): number {
    return this.get_seat_arena_account_idx();
  }

  set seat_arena_account_idx(value: number) {
    this.set_seat_arena_account_idx(value);
  }

  get_order_arena_account_idx(): number {
    const offset = 41;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_order_arena_account_idx(value: number): void {
    const offset = 41;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get order_arena_account_idx(): number {
    return this.get_order_arena_account_idx();
  }

  set order_arena_account_idx(value: number) {
    this.set_order_arena_account_idx(value);
  }

  get_bids_cbook_account_idx(): number {
    const offset = 43;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_bids_cbook_account_idx(value: number): void {
    const offset = 43;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get bids_cbook_account_idx(): number {
    return this.get_bids_cbook_account_idx();
  }

  set bids_cbook_account_idx(value: number) {
    this.set_bids_cbook_account_idx(value);
  }

  get_asks_cbook_account_idx(): number {
    const offset = 45;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_asks_cbook_account_idx(value: number): void {
    const offset = 45;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get asks_cbook_account_idx(): number {
    return this.get_asks_cbook_account_idx();
  }

  set asks_cbook_account_idx(value: number) {
    this.set_asks_cbook_account_idx(value);
  }

  get_quote_vault_account_idx(): number {
    const offset = 47;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_quote_vault_account_idx(value: number): void {
    const offset = 47;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get quote_vault_account_idx(): number {
    return this.get_quote_vault_account_idx();
  }

  set quote_vault_account_idx(value: number) {
    this.set_quote_vault_account_idx(value);
  }

  get_market_authority_account_idx(): number {
    const offset = 49;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_market_authority_account_idx(value: number): void {
    const offset = 49;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get market_authority_account_idx(): number {
    return this.get_market_authority_account_idx();
  }

  set market_authority_account_idx(value: number) {
    this.set_market_authority_account_idx(value);
  }

  get_proof_sz_seat_arena(): number {
    const offset = 51;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_seat_arena(value: number): void {
    const offset = 51;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_seat_arena(): number {
    return this.get_proof_sz_seat_arena();
  }

  set proof_sz_seat_arena(value: number) {
    this.set_proof_sz_seat_arena(value);
  }

  get_proof_sz_order_arena(): number {
    const offset = 55;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_order_arena(value: number): void {
    const offset = 55;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_order_arena(): number {
    return this.get_proof_sz_order_arena();
  }

  set proof_sz_order_arena(value: number) {
    this.set_proof_sz_order_arena(value);
  }

  get_proof_sz_bids_cbook(): number {
    const offset = 59;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_bids_cbook(value: number): void {
    const offset = 59;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_bids_cbook(): number {
    return this.get_proof_sz_bids_cbook();
  }

  set proof_sz_bids_cbook(value: number) {
    this.set_proof_sz_bids_cbook(value);
  }

  get_proof_sz_asks_cbook(): number {
    const offset = 63;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_asks_cbook(value: number): void {
    const offset = 63;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_asks_cbook(): number {
    return this.get_proof_sz_asks_cbook();
  }

  set proof_sz_asks_cbook(value: number) {
    this.set_proof_sz_asks_cbook(value);
  }

  get_proof_sz_quote_vault(): number {
    const offset = 67;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_sz_quote_vault(value: number): void {
    const offset = 67;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_sz_quote_vault(): number {
    return this.get_proof_sz_quote_vault();
  }

  set proof_sz_quote_vault(value: number) {
    this.set_proof_sz_quote_vault(value);
  }

  get_oracle_feed_account_idx(): number {
    const offset = 71;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_oracle_feed_account_idx(value: number): void {
    const offset = 71;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get oracle_feed_account_idx(): number {
    return this.get_oracle_feed_account_idx();
  }

  set oracle_feed_account_idx(value: number) {
    this.set_oracle_feed_account_idx(value);
  }

  get_initial_margin_bps(): number {
    const offset = 73;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_initial_margin_bps(value: number): void {
    const offset = 73;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get initial_margin_bps(): number {
    return this.get_initial_margin_bps();
  }

  set initial_margin_bps(value: number) {
    this.set_initial_margin_bps(value);
  }

  get_maintenance_margin_bps(): number {
    const offset = 75;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_maintenance_margin_bps(value: number): void {
    const offset = 75;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get maintenance_margin_bps(): number {
    return this.get_maintenance_margin_bps();
  }

  set maintenance_margin_bps(value: number) {
    this.set_maintenance_margin_bps(value);
  }

  get_liquidation_fee_bps(): number {
    const offset = 77;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_liquidation_fee_bps(value: number): void {
    const offset = 77;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get liquidation_fee_bps(): number {
    return this.get_liquidation_fee_bps();
  }

  set liquidation_fee_bps(value: number) {
    this.set_liquidation_fee_bps(value);
  }

  get_mark_num(): bigint {
    const offset = 79;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_num(value: bigint): void {
    const offset = 79;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_num(): bigint {
    return this.get_mark_num();
  }

  set mark_num(value: bigint) {
    this.set_mark_num(value);
  }

  get_mark_den(): bigint {
    const offset = 87;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_den(value: bigint): void {
    const offset = 87;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_den(): bigint {
    return this.get_mark_den();
  }

  set mark_den(value: bigint) {
    this.set_mark_den(value);
  }

  get_oracle_exponent(): number {
    const offset = 95;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_oracle_exponent(value: number): void {
    const offset = 95;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get oracle_exponent(): number {
    return this.get_oracle_exponent();
  }

  set oracle_exponent(value: number) {
    this.set_oracle_exponent(value);
  }

  get_reserved1(): number {
    const offset = 99;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 99;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  get_max_mark_age_ns(): bigint {
    const offset = 103;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_mark_age_ns(value: bigint): void {
    const offset = 103;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_mark_age_ns(): bigint {
    return this.get_max_mark_age_ns();
  }

  set max_mark_age_ns(value: bigint) {
    this.set_max_mark_age_ns(value);
  }

  get_proof_seat_arena_length(): number {
    return this.__tnResolveFieldRef("proof_sz_seat_arena");
  }

  get_proof_seat_arena_at(index: number): number {
    const offset = 111;
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
    const offset = 111;
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

  static footprintIr(proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint): bigint {
    const params = MarketCreateInstruction.Params.fromValues({
      proof_asks_cbook_proof_sz_asks_cbook: proof_asks_cbook_proof_sz_asks_cbook,
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

  static footprintFromValues(input: { proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint }): number {
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
    proof_bids_cbook_proof_sz_bids_cbook: "proof_bids_cbook.proof_sz_bids_cbook",
    proof_order_arena_proof_sz_order_arena: "proof_order_arena.proof_sz_order_arena",
    proof_quote_vault_proof_sz_quote_vault: "proof_quote_vault.proof_sz_quote_vault",
    proof_seat_arena_proof_sz_seat_arena: "proof_seat_arena.proof_sz_seat_arena",
  } as const);

  export const Params = {
    fromValues(input: { proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint }): Params {
      return {
        proof_asks_cbook_proof_sz_asks_cbook: __tnToBigInt(input.proof_asks_cbook_proof_sz_asks_cbook),
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

  export function params(input: { proof_asks_cbook_proof_sz_asks_cbook: number | bigint, proof_bids_cbook_proof_sz_bids_cbook: number | bigint, proof_order_arena_proof_sz_order_arena: number | bigint, proof_quote_vault_proof_sz_quote_vault: number | bigint, proof_seat_arena_proof_sz_seat_arena: number | bigint }): Params {
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
  private __tnFam_proof_quote_vault: Uint8Array | null = null;
  private __tnFam_proof_quote_vaultCount: number | null = null;
  private __tnFamWriter_proof_quote_vault?: __TnFamWriterResult<MarketCreateInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(111);
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

  set_token_program_idx(value: number): this {
    this.view.setUint16(1, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_exchange_meta_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_quote_mint_idx(value: number): this {
    this.view.setUint16(5, value, true);
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

  set_price_cap(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(23, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_max_position_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(31, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_seat_arena_account_idx(value: number): this {
    this.view.setUint16(39, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_order_arena_account_idx(value: number): this {
    this.view.setUint16(41, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_bids_cbook_account_idx(value: number): this {
    this.view.setUint16(43, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_asks_cbook_account_idx(value: number): this {
    this.view.setUint16(45, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_quote_vault_account_idx(value: number): this {
    this.view.setUint16(47, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_market_authority_account_idx(value: number): this {
    this.view.setUint16(49, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_seat_arena(value: number): this {
    this.view.setUint32(51, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_order_arena(value: number): this {
    this.view.setUint32(55, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_bids_cbook(value: number): this {
    this.view.setUint32(59, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_asks_cbook(value: number): this {
    this.view.setUint32(63, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz_quote_vault(value: number): this {
    this.view.setUint32(67, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_oracle_feed_account_idx(value: number): this {
    this.view.setUint16(71, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_initial_margin_bps(value: number): this {
    this.view.setUint16(73, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_maintenance_margin_bps(value: number): this {
    this.view.setUint16(75, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_liquidation_fee_bps(value: number): this {
    this.view.setUint16(77, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_mark_num(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(79, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_mark_den(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(87, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_oracle_exponent(value: number): this {
    this.view.setInt32(95, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(99, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_max_mark_age_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(103, cast, true);
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
  root: { op: "const", value: 31n }
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

  get_exchange_meta_account_idx(): number {
    const offset = 15;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_meta_account_idx(value: number): void {
    const offset = 15;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_meta_account_idx(): number {
    return this.get_exchange_meta_account_idx();
  }

  set exchange_meta_account_idx(value: number) {
    this.set_exchange_meta_account_idx(value);
  }

  get_token_program_idx(): number {
    const offset = 17;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_idx(value: number): void {
    const offset = 17;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_idx(): number {
    return this.get_token_program_idx();
  }

  set token_program_idx(value: number) {
    this.set_token_program_idx(value);
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

  get_oracle_feed_account_idx(): number {
    const offset = 23;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_oracle_feed_account_idx(value: number): void {
    const offset = 23;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get oracle_feed_account_idx(): number {
    return this.get_oracle_feed_account_idx();
  }

  set oracle_feed_account_idx(value: number) {
    this.set_oracle_feed_account_idx(value);
  }

  get_builder_seat_idx(): number {
    const offset = 25;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_builder_seat_idx(value: number): void {
    const offset = 25;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get builder_seat_idx(): number {
    return this.get_builder_seat_idx();
  }

  set builder_seat_idx(value: number) {
    this.set_builder_seat_idx(value);
  }

  get_builder_fee_ppm(): number {
    const offset = 27;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_builder_fee_ppm(value: number): void {
    const offset = 27;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get builder_fee_ppm(): number {
    return this.get_builder_fee_ppm();
  }

  set builder_fee_ppm(value: number) {
    this.set_builder_fee_ppm(value);
  }

  get_reserved0(): number[] {
    const offset = 29;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 29;
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
    if (buffer.length < 31) return { ok: false, code: "tn.buffer_too_small", consumed: 31 };
    return { ok: true, consumed: 31 };
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
    this.buffer = new Uint8Array(31);
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

  set_exchange_meta_account_idx(value: number): this {
    this.view.setUint16(15, value, true);
    return this;
  }

  set_token_program_idx(value: number): this {
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

  set_oracle_feed_account_idx(value: number): this {
    this.view.setUint16(23, value, true);
    return this;
  }

  set_builder_seat_idx(value: number): this {
    this.view.setUint16(25, value, true);
    return this;
  }

  set_builder_fee_ppm(value: number): this {
    this.view.setUint16(27, value, true);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 2) throw new Error("reserved0 expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 29 + i * 1;
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

  finish(): MarketRecordInstruction {
    const view = MarketRecordInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketRecordInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketRecordInstruction", (params) => MarketRecordInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketRecordInstruction", (buffer, params) => MarketRecordInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketRecordInstruction", (buffer) => { const result = MarketRecordInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketSetCrossInstruction ----- */

const __tn_ir_MarketSetCrossInstruction = {
  typeName: "MarketSetCrossInstruction",
  root: { op: "const", value: 7n }
} as const;

export class MarketSetCrossInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetCrossInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetCrossInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetCrossInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetCrossInstructionBuilder {
    return new MarketSetCrossInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetCrossInstructionBuilder): MarketSetCrossInstruction | null {
    const buffer = builder.build();
    return MarketSetCrossInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_cross_upnl_haircut_bps(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_cross_upnl_haircut_bps(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get cross_upnl_haircut_bps(): number {
    return this.get_cross_upnl_haircut_bps();
  }

  set cross_upnl_haircut_bps(value: number) {
    this.set_cross_upnl_haircut_bps(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetCrossInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetCrossInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetCrossInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetCrossInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, reserved0: number, cross_upnl_haircut_bps: number): MarketSetCrossInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, cross_upnl_haircut_bps, true); /* cross_upnl_haircut_bps (little-endian) */

    return new MarketSetCrossInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketSetCrossInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetCrossInstruction(buffer);
  }

}

export class MarketSetCrossInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_cross_upnl_haircut_bps(value: number): this {
    this.view.setUint32(3, value, true);
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

  finish(): MarketSetCrossInstruction {
    const view = MarketSetCrossInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetCrossInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetCrossInstruction", (params) => MarketSetCrossInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetCrossInstruction", (buffer, params) => MarketSetCrossInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetCrossInstruction", (buffer) => { const result = MarketSetCrossInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketSetExchangeStatusInstruction ----- */

const __tn_ir_MarketSetExchangeStatusInstruction = {
  typeName: "MarketSetExchangeStatusInstruction",
  root: { op: "const", value: 7n }
} as const;

export class MarketSetExchangeStatusInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetExchangeStatusInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetExchangeStatusInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetExchangeStatusInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetExchangeStatusInstructionBuilder {
    return new MarketSetExchangeStatusInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetExchangeStatusInstructionBuilder): MarketSetExchangeStatusInstruction | null {
    const buffer = builder.build();
    return MarketSetExchangeStatusInstruction.from_array(buffer);
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

  get_exchange_admin_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_admin_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_admin_account_idx(): number {
    return this.get_exchange_admin_account_idx();
  }

  set exchange_admin_account_idx(value: number) {
    this.set_exchange_admin_account_idx(value);
  }

  get_reserved1(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetExchangeStatusInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetExchangeStatusInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetExchangeStatusInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetExchangeStatusInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, status_flags: number, reserved0: number, exchange_admin_account_idx: number, reserved1: number): MarketSetExchangeStatusInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint8(1, status_flags); /* status_flags */
    view.setUint8(2, reserved0); /* reserved0 */
    view.setUint16(3, exchange_admin_account_idx, true); /* exchange_admin_account_idx (little-endian) */
    view.setUint16(5, reserved1, true); /* reserved1 (little-endian) */

    return new MarketSetExchangeStatusInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketSetExchangeStatusInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetExchangeStatusInstruction(buffer);
  }

}

export class MarketSetExchangeStatusInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint8(2, value);
    return this;
  }

  set_exchange_admin_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint16(5, value, true);
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

  finish(): MarketSetExchangeStatusInstruction {
    const view = MarketSetExchangeStatusInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetExchangeStatusInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetExchangeStatusInstruction", (params) => MarketSetExchangeStatusInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetExchangeStatusInstruction", (buffer, params) => MarketSetExchangeStatusInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetExchangeStatusInstruction", (buffer) => { const result = MarketSetExchangeStatusInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketSetFeesInstruction ----- */

const __tn_ir_MarketSetFeesInstruction = {
  typeName: "MarketSetFeesInstruction",
  root: { op: "const", value: 23n }
} as const;

export class MarketSetFeesInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetFeesInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetFeesInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetFeesInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetFeesInstructionBuilder {
    return new MarketSetFeesInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetFeesInstructionBuilder): MarketSetFeesInstruction | null {
    const buffer = builder.build();
    return MarketSetFeesInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_taker_fee_ppm(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_taker_fee_ppm(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get taker_fee_ppm(): number {
    return this.get_taker_fee_ppm();
  }

  set taker_fee_ppm(value: number) {
    this.set_taker_fee_ppm(value);
  }

  get_maker_rebate_ppm(): number {
    const offset = 7;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_maker_rebate_ppm(value: number): void {
    const offset = 7;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get maker_rebate_ppm(): number {
    return this.get_maker_rebate_ppm();
  }

  set maker_rebate_ppm(value: number) {
    this.set_maker_rebate_ppm(value);
  }

  get_builder_fee_cap_ppm(): number {
    const offset = 11;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_builder_fee_cap_ppm(value: number): void {
    const offset = 11;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get builder_fee_cap_ppm(): number {
    return this.get_builder_fee_cap_ppm();
  }

  set builder_fee_cap_ppm(value: number) {
    this.set_builder_fee_cap_ppm(value);
  }

  get_fee_insurance_share_ppm(): number {
    const offset = 15;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_fee_insurance_share_ppm(value: number): void {
    const offset = 15;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get fee_insurance_share_ppm(): number {
    return this.get_fee_insurance_share_ppm();
  }

  set fee_insurance_share_ppm(value: number) {
    this.set_fee_insurance_share_ppm(value);
  }

  get_liq_insurance_share_ppm(): number {
    const offset = 19;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_liq_insurance_share_ppm(value: number): void {
    const offset = 19;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get liq_insurance_share_ppm(): number {
    return this.get_liq_insurance_share_ppm();
  }

  set liq_insurance_share_ppm(value: number) {
    this.set_liq_insurance_share_ppm(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetFeesInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetFeesInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetFeesInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetFeesInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 23) return { ok: false, code: "tn.buffer_too_small", consumed: 23 };
    return { ok: true, consumed: 23 };
  }

  static new(market_record_idx: number, reserved0: number, taker_fee_ppm: number, maker_rebate_ppm: number, builder_fee_cap_ppm: number, fee_insurance_share_ppm: number, liq_insurance_share_ppm: number): MarketSetFeesInstruction {
    const buffer = new Uint8Array(23);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, taker_fee_ppm, true); /* taker_fee_ppm (little-endian) */
    view.setUint32(7, maker_rebate_ppm, true); /* maker_rebate_ppm (little-endian) */
    view.setUint32(11, builder_fee_cap_ppm, true); /* builder_fee_cap_ppm (little-endian) */
    view.setUint32(15, fee_insurance_share_ppm, true); /* fee_insurance_share_ppm (little-endian) */
    view.setUint32(19, liq_insurance_share_ppm, true); /* liq_insurance_share_ppm (little-endian) */

    return new MarketSetFeesInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketSetFeesInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetFeesInstruction(buffer);
  }

}

export class MarketSetFeesInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_taker_fee_ppm(value: number): this {
    this.view.setUint32(3, value, true);
    return this;
  }

  set_maker_rebate_ppm(value: number): this {
    this.view.setUint32(7, value, true);
    return this;
  }

  set_builder_fee_cap_ppm(value: number): this {
    this.view.setUint32(11, value, true);
    return this;
  }

  set_fee_insurance_share_ppm(value: number): this {
    this.view.setUint32(15, value, true);
    return this;
  }

  set_liq_insurance_share_ppm(value: number): this {
    this.view.setUint32(19, value, true);
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

  finish(): MarketSetFeesInstruction {
    const view = MarketSetFeesInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetFeesInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetFeesInstruction", (params) => MarketSetFeesInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetFeesInstruction", (buffer, params) => MarketSetFeesInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetFeesInstruction", (buffer) => { const result = MarketSetFeesInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketSetFundingInstruction ----- */

const __tn_ir_MarketSetFundingInstruction = {
  typeName: "MarketSetFundingInstruction",
  root: { op: "const", value: 31n }
} as const;

export class MarketSetFundingInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetFundingInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetFundingInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetFundingInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetFundingInstructionBuilder {
    return new MarketSetFundingInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetFundingInstructionBuilder): MarketSetFundingInstruction | null {
    const buffer = builder.build();
    return MarketSetFundingInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_interest_rate(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_interest_rate(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get interest_rate(): number {
    return this.get_interest_rate();
  }

  set interest_rate(value: number) {
    this.set_interest_rate(value);
  }

  get_clamp_small(): number {
    const offset = 7;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_clamp_small(value: number): void {
    const offset = 7;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get clamp_small(): number {
    return this.get_clamp_small();
  }

  set clamp_small(value: number) {
    this.set_clamp_small(value);
  }

  get_clamp_big(): number {
    const offset = 11;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_clamp_big(value: number): void {
    const offset = 11;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get clamp_big(): number {
    return this.get_clamp_big();
  }

  set clamp_big(value: number) {
    this.set_clamp_big(value);
  }

  get_premium_multiplier(): number {
    const offset = 15;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_premium_multiplier(value: number): void {
    const offset = 15;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get premium_multiplier(): number {
    return this.get_premium_multiplier();
  }

  set premium_multiplier(value: number) {
    this.set_premium_multiplier(value);
  }

  get_reserved1(): number {
    const offset = 19;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 19;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  get_impact_notional(): bigint {
    const offset = 23;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_impact_notional(value: bigint): void {
    const offset = 23;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get impact_notional(): bigint {
    return this.get_impact_notional();
  }

  set impact_notional(value: bigint) {
    this.set_impact_notional(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetFundingInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetFundingInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetFundingInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetFundingInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 31) return { ok: false, code: "tn.buffer_too_small", consumed: 31 };
    return { ok: true, consumed: 31 };
  }

  static new(market_record_idx: number, reserved0: number, interest_rate: number, clamp_small: number, clamp_big: number, premium_multiplier: number, reserved1: number, impact_notional: bigint): MarketSetFundingInstruction {
    const buffer = new Uint8Array(31);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, interest_rate, true); /* interest_rate (little-endian) */
    view.setUint32(7, clamp_small, true); /* clamp_small (little-endian) */
    view.setUint32(11, clamp_big, true); /* clamp_big (little-endian) */
    view.setUint32(15, premium_multiplier, true); /* premium_multiplier (little-endian) */
    view.setUint32(19, reserved1, true); /* reserved1 (little-endian) */
    view.setBigUint64(23, impact_notional, true); /* impact_notional (little-endian) */

    return new MarketSetFundingInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketSetFundingInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetFundingInstruction(buffer);
  }

}

export class MarketSetFundingInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(31);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_interest_rate(value: number): this {
    this.view.setUint32(3, value, true);
    return this;
  }

  set_clamp_small(value: number): this {
    this.view.setUint32(7, value, true);
    return this;
  }

  set_clamp_big(value: number): this {
    this.view.setUint32(11, value, true);
    return this;
  }

  set_premium_multiplier(value: number): this {
    this.view.setUint32(15, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(19, value, true);
    return this;
  }

  set_impact_notional(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(23, cast, true);
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

  finish(): MarketSetFundingInstruction {
    const view = MarketSetFundingInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetFundingInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetFundingInstruction", (params) => MarketSetFundingInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetFundingInstruction", (buffer, params) => MarketSetFundingInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetFundingInstruction", (buffer) => { const result = MarketSetFundingInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketSetOracleInstruction ----- */

const __tn_ir_MarketSetOracleInstruction = {
  typeName: "MarketSetOracleInstruction",
  root: { op: "const", value: 39n }
} as const;

export class MarketSetOracleInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetOracleInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetOracleInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetOracleInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetOracleInstructionBuilder {
    return new MarketSetOracleInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetOracleInstructionBuilder): MarketSetOracleInstruction | null {
    const buffer = builder.build();
    return MarketSetOracleInstruction.from_array(buffer);
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

  get_oracle_feed_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_oracle_feed_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get oracle_feed_account_idx(): number {
    return this.get_oracle_feed_account_idx();
  }

  set oracle_feed_account_idx(value: number) {
    this.set_oracle_feed_account_idx(value);
  }

  get_oracle_exponent(): number {
    const offset = 3;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_oracle_exponent(value: number): void {
    const offset = 3;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get oracle_exponent(): number {
    return this.get_oracle_exponent();
  }

  set oracle_exponent(value: number) {
    this.set_oracle_exponent(value);
  }

  get_mark_num(): bigint {
    const offset = 7;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_num(value: bigint): void {
    const offset = 7;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_num(): bigint {
    return this.get_mark_num();
  }

  set mark_num(value: bigint) {
    this.set_mark_num(value);
  }

  get_mark_den(): bigint {
    const offset = 15;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_den(value: bigint): void {
    const offset = 15;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_den(): bigint {
    return this.get_mark_den();
  }

  set mark_den(value: bigint) {
    this.set_mark_den(value);
  }

  get_max_mark_age_ns(): bigint {
    const offset = 23;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_mark_age_ns(value: bigint): void {
    const offset = 23;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_mark_age_ns(): bigint {
    return this.get_max_mark_age_ns();
  }

  set max_mark_age_ns(value: bigint) {
    this.set_max_mark_age_ns(value);
  }

  get_reserved0(): bigint {
    const offset = 31;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_reserved0(value: bigint): void {
    const offset = 31;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get reserved0(): bigint {
    return this.get_reserved0();
  }

  set reserved0(value: bigint) {
    this.set_reserved0(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetOracleInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetOracleInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetOracleInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetOracleInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 39) return { ok: false, code: "tn.buffer_too_small", consumed: 39 };
    return { ok: true, consumed: 39 };
  }

  static new(market_record_idx: number, oracle_feed_account_idx: number, oracle_exponent: number, mark_num: bigint, mark_den: bigint, max_mark_age_ns: bigint, reserved0: bigint): MarketSetOracleInstruction {
    const buffer = new Uint8Array(39);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, oracle_feed_account_idx, true); /* oracle_feed_account_idx (little-endian) */
    view.setInt32(3, oracle_exponent, true); /* oracle_exponent (little-endian) */
    view.setBigUint64(7, mark_num, true); /* mark_num (little-endian) */
    view.setBigUint64(15, mark_den, true); /* mark_den (little-endian) */
    view.setBigUint64(23, max_mark_age_ns, true); /* max_mark_age_ns (little-endian) */
    view.setBigUint64(31, reserved0, true); /* reserved0 (little-endian) */

    return new MarketSetOracleInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketSetOracleInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetOracleInstruction(buffer);
  }

}

export class MarketSetOracleInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(39);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market_record_idx(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_oracle_feed_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_oracle_exponent(value: number): this {
    this.view.setInt32(3, value, true);
    return this;
  }

  set_mark_num(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    return this;
  }

  set_mark_den(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(15, cast, true);
    return this;
  }

  set_max_mark_age_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(23, cast, true);
    return this;
  }

  set_reserved0(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(31, cast, true);
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

  finish(): MarketSetOracleInstruction {
    const view = MarketSetOracleInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetOracleInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetOracleInstruction", (params) => MarketSetOracleInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetOracleInstruction", (buffer, params) => MarketSetOracleInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetOracleInstruction", (buffer) => { const result = MarketSetOracleInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketSetRiskParamsInstruction ----- */

const __tn_ir_MarketSetRiskParamsInstruction = {
  typeName: "MarketSetRiskParamsInstruction",
  root: { op: "const", value: 7n }
} as const;

export class MarketSetRiskParamsInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetRiskParamsInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetRiskParamsInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetRiskParamsInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetRiskParamsInstructionBuilder {
    return new MarketSetRiskParamsInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetRiskParamsInstructionBuilder): MarketSetRiskParamsInstruction | null {
    const buffer = builder.build();
    return MarketSetRiskParamsInstruction.from_array(buffer);
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

  get_socialize_cap_bps(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_socialize_cap_bps(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get socialize_cap_bps(): number {
    return this.get_socialize_cap_bps();
  }

  set socialize_cap_bps(value: number) {
    this.set_socialize_cap_bps(value);
  }

  get_if_epoch_budget_bps(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_if_epoch_budget_bps(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get if_epoch_budget_bps(): number {
    return this.get_if_epoch_budget_bps();
  }

  set if_epoch_budget_bps(value: number) {
    this.set_if_epoch_budget_bps(value);
  }

  get_bankrupt_liq_reward_bps(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_bankrupt_liq_reward_bps(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get bankrupt_liq_reward_bps(): number {
    return this.get_bankrupt_liq_reward_bps();
  }

  set bankrupt_liq_reward_bps(value: number) {
    this.set_bankrupt_liq_reward_bps(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetRiskParamsInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetRiskParamsInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetRiskParamsInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetRiskParamsInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, socialize_cap_bps: number, if_epoch_budget_bps: number, bankrupt_liq_reward_bps: number): MarketSetRiskParamsInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, socialize_cap_bps, true); /* socialize_cap_bps (little-endian) */
    view.setUint16(3, if_epoch_budget_bps, true); /* if_epoch_budget_bps (little-endian) */
    view.setUint16(5, bankrupt_liq_reward_bps, true); /* bankrupt_liq_reward_bps (little-endian) */

    return new MarketSetRiskParamsInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketSetRiskParamsInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetRiskParamsInstruction(buffer);
  }

}

export class MarketSetRiskParamsInstructionBuilder {
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

  set_socialize_cap_bps(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_if_epoch_budget_bps(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_bankrupt_liq_reward_bps(value: number): this {
    this.view.setUint16(5, value, true);
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

  finish(): MarketSetRiskParamsInstruction {
    const view = MarketSetRiskParamsInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetRiskParamsInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetRiskParamsInstruction", (params) => MarketSetRiskParamsInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetRiskParamsInstruction", (buffer, params) => MarketSetRiskParamsInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetRiskParamsInstruction", (buffer) => { const result = MarketSetRiskParamsInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

/* ----- TYPE DEFINITION FOR MarketSetVaultInstruction ----- */

const __tn_ir_MarketSetVaultInstruction = {
  typeName: "MarketSetVaultInstruction",
  root: { op: "const", value: 7n }
} as const;

export class MarketSetVaultInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketSetVaultInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("MarketSetVaultInstruction.__tnCreateView requires a Uint8Array");
    return new MarketSetVaultInstruction(new Uint8Array(buffer));
  }

  static builder(): MarketSetVaultInstructionBuilder {
    return new MarketSetVaultInstructionBuilder();
  }

  static fromBuilder(builder: MarketSetVaultInstructionBuilder): MarketSetVaultInstruction | null {
    const buffer = builder.build();
    return MarketSetVaultInstruction.from_array(buffer);
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

  get_exchange_admin_account_idx(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_exchange_admin_account_idx(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get exchange_admin_account_idx(): number {
    return this.get_exchange_admin_account_idx();
  }

  set exchange_admin_account_idx(value: number) {
    this.set_exchange_admin_account_idx(value);
  }

  get_new_vault_account_idx(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_new_vault_account_idx(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get new_vault_account_idx(): number {
    return this.get_new_vault_account_idx();
  }

  set new_vault_account_idx(value: number) {
    this.set_new_vault_account_idx(value);
  }

  get_reserved0(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketSetVaultInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketSetVaultInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketSetVaultInstruction');
    }
    return __tnBigIntToNumber(irResult, 'MarketSetVaultInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, exchange_admin_account_idx: number, new_vault_account_idx: number, reserved0: number): MarketSetVaultInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, exchange_admin_account_idx, true); /* exchange_admin_account_idx (little-endian) */
    view.setUint16(3, new_vault_account_idx, true); /* new_vault_account_idx (little-endian) */
    view.setUint16(5, reserved0, true); /* reserved0 (little-endian) */

    return new MarketSetVaultInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): MarketSetVaultInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketSetVaultInstruction(buffer);
  }

}

export class MarketSetVaultInstructionBuilder {
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

  set_exchange_admin_account_idx(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_new_vault_account_idx(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(5, value, true);
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

  finish(): MarketSetVaultInstruction {
    const view = MarketSetVaultInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketSetVaultInstruction");
    return view;
  }
}

__tnRegisterFootprint("MarketSetVaultInstruction", (params) => MarketSetVaultInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketSetVaultInstruction", (buffer, params) => MarketSetVaultInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketSetVaultInstruction", (buffer) => { const result = MarketSetVaultInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

/* ----- TYPE DEFINITION FOR OrderArenaHeader ----- */

const __tn_ir_OrderArenaHeader = {
  typeName: "OrderArenaHeader",
  root: { op: "const", value: 64n }
} as const;

export class OrderArenaHeader {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): OrderArenaHeader {
    if (!buffer || buffer.length === undefined) throw new Error("OrderArenaHeader.__tnCreateView requires a Uint8Array");
    return new OrderArenaHeader(new Uint8Array(buffer));
  }

  static builder(): OrderArenaHeaderBuilder {
    return new OrderArenaHeaderBuilder();
  }

  static fromBuilder(builder: OrderArenaHeaderBuilder): OrderArenaHeader | null {
    const buffer = builder.build();
    return OrderArenaHeader.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_OrderArenaHeader.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_OrderArenaHeader, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for OrderArenaHeader');
    }
    return __tnBigIntToNumber(irResult, 'OrderArenaHeader::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 64) return { ok: false, code: "tn.buffer_too_small", consumed: 64 };
    return { ok: true, consumed: 64 };
  }

  static from_array(buffer: Uint8Array): OrderArenaHeader | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new OrderArenaHeader(buffer);
  }

}

export class OrderArenaHeaderBuilder {
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

  finish(): OrderArenaHeader {
    const view = OrderArenaHeader.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build OrderArenaHeader");
    return view;
  }
}

__tnRegisterFootprint("OrderArenaHeader", (params) => OrderArenaHeader.__tnInvokeFootprint(params));
__tnRegisterValidate("OrderArenaHeader", (buffer, params) => OrderArenaHeader.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("OrderArenaHeader", (buffer) => { const result = OrderArenaHeader.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

  get_builder_seat_idx(): number {
    const offset = 32;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_builder_seat_idx(value: number): void {
    const offset = 32;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get builder_seat_idx(): number {
    return this.get_builder_seat_idx();
  }

  set builder_seat_idx(value: number) {
    this.set_builder_seat_idx(value);
  }

  get_builder_fee_ppm(): number {
    const offset = 36;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_builder_fee_ppm(value: number): void {
    const offset = 36;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get builder_fee_ppm(): number {
    return this.get_builder_fee_ppm();
  }

  set builder_fee_ppm(value: number) {
    this.set_builder_fee_ppm(value);
  }

  get_reserved0(): number {
    const offset = 38;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 38;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
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

  set_builder_seat_idx(value: number): this {
    this.view.setUint32(32, value, true);
    return this;
  }

  set_builder_fee_ppm(value: number): this {
    this.view.setUint16(36, value, true);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint16(38, value, true);
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

/* ----- TYPE DEFINITION FOR PerpError ----- */

const __tn_ir_PerpError = {
  typeName: "PerpError",
  root: { op: "const", value: 8n }
} as const;

export class PerpError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): PerpError {
    if (!buffer || buffer.length === undefined) throw new Error("PerpError.__tnCreateView requires a Uint8Array");
    return new PerpError(new Uint8Array(buffer));
  }

  static builder(): PerpErrorBuilder {
    return new PerpErrorBuilder();
  }

  static fromBuilder(builder: PerpErrorBuilder): PerpError | null {
    const buffer = builder.build();
    return PerpError.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_PerpError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PerpError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PerpError');
    }
    return __tnBigIntToNumber(irResult, 'PerpError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(code: bigint): PerpError {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, code, true); /* code (little-endian) */

    return new PerpError(buffer);
  }

  static from_array(buffer: Uint8Array): PerpError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new PerpError(buffer);
  }

}

export class PerpErrorBuilder {
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

  finish(): PerpError {
    const view = PerpError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build PerpError");
    return view;
  }
}

__tnRegisterFootprint("PerpError", (params) => PerpError.__tnInvokeFootprint(params));
__tnRegisterValidate("PerpError", (buffer, params) => PerpError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PerpError", (buffer) => { const result = PerpError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ResolveBadDebtInstruction ----- */

const __tn_ir_ResolveBadDebtInstruction = {
  typeName: "ResolveBadDebtInstruction",
  root: { op: "const", value: 7n }
} as const;

export class ResolveBadDebtInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ResolveBadDebtInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("ResolveBadDebtInstruction.__tnCreateView requires a Uint8Array");
    return new ResolveBadDebtInstruction(new Uint8Array(buffer));
  }

  static builder(): ResolveBadDebtInstructionBuilder {
    return new ResolveBadDebtInstructionBuilder();
  }

  static fromBuilder(builder: ResolveBadDebtInstructionBuilder): ResolveBadDebtInstruction | null {
    const buffer = builder.build();
    return ResolveBadDebtInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_reserved1(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ResolveBadDebtInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ResolveBadDebtInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ResolveBadDebtInstruction');
    }
    return __tnBigIntToNumber(irResult, 'ResolveBadDebtInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, reserved0: number, reserved1: number): ResolveBadDebtInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, reserved1, true); /* reserved1 (little-endian) */

    return new ResolveBadDebtInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): ResolveBadDebtInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ResolveBadDebtInstruction(buffer);
  }

}

export class ResolveBadDebtInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(3, value, true);
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

  finish(): ResolveBadDebtInstruction {
    const view = ResolveBadDebtInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ResolveBadDebtInstruction");
    return view;
  }
}

__tnRegisterFootprint("ResolveBadDebtInstruction", (params) => ResolveBadDebtInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ResolveBadDebtInstruction", (buffer, params) => ResolveBadDebtInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ResolveBadDebtInstruction", (buffer) => { const result = ResolveBadDebtInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SeatArenaHeader ----- */

const __tn_ir_SeatArenaHeader = {
  typeName: "SeatArenaHeader",
  root: { op: "const", value: 128n }
} as const;

export class SeatArenaHeader {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SeatArenaHeader {
    if (!buffer || buffer.length === undefined) throw new Error("SeatArenaHeader.__tnCreateView requires a Uint8Array");
    return new SeatArenaHeader(new Uint8Array(buffer));
  }

  static builder(): SeatArenaHeaderBuilder {
    return new SeatArenaHeaderBuilder();
  }

  static fromBuilder(builder: SeatArenaHeaderBuilder): SeatArenaHeader | null {
    const buffer = builder.build();
    return SeatArenaHeader.from_array(buffer);
  }

  get_reserved0(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 116; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 0;
    if (value.length !== 116) {
      throw new Error('Array length must be 116');
    }
    for (let i = 0; i < 116; i++) {
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
    const offset = 116;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_next_entry_idx(value: number): void {
    const offset = 116;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get next_entry_idx(): number {
    return this.get_next_entry_idx();
  }

  set next_entry_idx(value: number) {
    this.set_next_entry_idx(value);
  }

  get_free_magic(): bigint {
    const offset = 120;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_free_magic(value: bigint): void {
    const offset = 120;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get free_magic(): bigint {
    return this.get_free_magic();
  }

  set free_magic(value: bigint) {
    this.set_free_magic(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SeatArenaHeader.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SeatArenaHeader, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SeatArenaHeader');
    }
    return __tnBigIntToNumber(irResult, 'SeatArenaHeader::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 128) return { ok: false, code: "tn.buffer_too_small", consumed: 128 };
    return { ok: true, consumed: 128 };
  }

  static from_array(buffer: Uint8Array): SeatArenaHeader | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SeatArenaHeader(buffer);
  }

}

export class SeatArenaHeaderBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(128);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 116) throw new Error("reserved0 expects 116 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_next_entry_idx(value: number): this {
    this.view.setUint32(116, value, true);
    return this;
  }

  set_free_magic(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(120, cast, true);
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

  finish(): SeatArenaHeader {
    const view = SeatArenaHeader.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SeatArenaHeader");
    return view;
  }
}

__tnRegisterFootprint("SeatArenaHeader", (params) => SeatArenaHeader.__tnInvokeFootprint(params));
__tnRegisterValidate("SeatArenaHeader", (buffer, params) => SeatArenaHeader.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SeatArenaHeader", (buffer) => { const result = SeatArenaHeader.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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
  root: { op: "const", value: 128n }
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

  get_quantity_quote(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity_quote(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity_quote(): bigint {
    return this.get_quantity_quote();
  }

  set quantity_quote(value: bigint) {
    this.set_quantity_quote(value);
  }

  get_long_lots(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_long_lots(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get long_lots(): bigint {
    return this.get_long_lots();
  }

  set long_lots(value: bigint) {
    this.set_long_lots(value);
  }

  get_short_lots(): bigint {
    const offset = 48;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_short_lots(value: bigint): void {
    const offset = 48;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get short_lots(): bigint {
    return this.get_short_lots();
  }

  set short_lots(value: bigint) {
    this.set_short_lots(value);
  }

  get_open_bid_lots(): bigint {
    const offset = 56;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_open_bid_lots(value: bigint): void {
    const offset = 56;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get open_bid_lots(): bigint {
    return this.get_open_bid_lots();
  }

  set open_bid_lots(value: bigint) {
    this.set_open_bid_lots(value);
  }

  get_open_ask_lots(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_open_ask_lots(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get open_ask_lots(): bigint {
    return this.get_open_ask_lots();
  }

  set open_ask_lots(value: bigint) {
    this.set_open_ask_lots(value);
  }

  get_head_order_entry_idx(): number {
    const offset = 72;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_head_order_entry_idx(value: number): void {
    const offset = 72;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get head_order_entry_idx(): number {
    return this.get_head_order_entry_idx();
  }

  set head_order_entry_idx(value: number) {
    this.set_head_order_entry_idx(value);
  }

  get_funding_carry(): number {
    const offset = 76;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_carry(value: number): void {
    const offset = 76;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_carry(): number {
    return this.get_funding_carry();
  }

  set funding_carry(value: number) {
    this.set_funding_carry(value);
  }

  get_entry_notional(): bigint {
    const offset = 80;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_entry_notional(value: bigint): void {
    const offset = 80;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get entry_notional(): bigint {
    return this.get_entry_notional();
  }

  set entry_notional(value: bigint) {
    this.set_entry_notional(value);
  }

  get_open_bid_notional(): bigint {
    const offset = 88;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_open_bid_notional(value: bigint): void {
    const offset = 88;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get open_bid_notional(): bigint {
    return this.get_open_bid_notional();
  }

  set open_bid_notional(value: bigint) {
    this.set_open_bid_notional(value);
  }

  get_open_ask_notional(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_open_ask_notional(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get open_ask_notional(): bigint {
    return this.get_open_ask_notional();
  }

  set open_ask_notional(value: bigint) {
    this.set_open_ask_notional(value);
  }

  get_funding_snapshot_lo(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_snapshot_lo(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_snapshot_lo(): bigint {
    return this.get_funding_snapshot_lo();
  }

  set funding_snapshot_lo(value: bigint) {
    this.set_funding_snapshot_lo(value);
  }

  get_funding_snapshot_hi(): bigint {
    const offset = 112;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_snapshot_hi(value: bigint): void {
    const offset = 112;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_snapshot_hi(): bigint {
    return this.get_funding_snapshot_hi();
  }

  set funding_snapshot_hi(value: bigint) {
    this.set_funding_snapshot_hi(value);
  }

  get_flags(): bigint {
    const offset = 120;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_flags(value: bigint): void {
    const offset = 120;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get flags(): bigint {
    return this.get_flags();
  }

  set flags(value: bigint) {
    this.set_flags(value);
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
    if (buffer.length < 128) return { ok: false, code: "tn.buffer_too_small", consumed: 128 };
    return { ok: true, consumed: 128 };
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
    this.buffer = new Uint8Array(128);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_authority_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seat_authority_pubkey expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_quantity_quote(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    return this;
  }

  set_long_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
    return this;
  }

  set_short_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(48, cast, true);
    return this;
  }

  set_open_bid_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(56, cast, true);
    return this;
  }

  set_open_ask_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_head_order_entry_idx(value: number): this {
    this.view.setUint32(72, value, true);
    return this;
  }

  set_funding_carry(value: number): this {
    this.view.setUint32(76, value, true);
    return this;
  }

  set_entry_notional(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(80, cast, true);
    return this;
  }

  set_open_bid_notional(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(88, cast, true);
    return this;
  }

  set_open_ask_notional(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_funding_snapshot_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_funding_snapshot_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(112, cast, true);
    return this;
  }

  set_flags(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(120, cast, true);
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

/* ----- TYPE DEFINITION FOR SeatSetBuilderApprovalInstruction ----- */

const __tn_ir_SeatSetBuilderApprovalInstruction = {
  typeName: "SeatSetBuilderApprovalInstruction",
  root: { op: "const", value: 7n }
} as const;

export class SeatSetBuilderApprovalInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SeatSetBuilderApprovalInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("SeatSetBuilderApprovalInstruction.__tnCreateView requires a Uint8Array");
    return new SeatSetBuilderApprovalInstruction(new Uint8Array(buffer));
  }

  static builder(): SeatSetBuilderApprovalInstructionBuilder {
    return new SeatSetBuilderApprovalInstructionBuilder();
  }

  static fromBuilder(builder: SeatSetBuilderApprovalInstructionBuilder): SeatSetBuilderApprovalInstruction | null {
    const buffer = builder.build();
    return SeatSetBuilderApprovalInstruction.from_array(buffer);
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

  get_max_fee_ppm(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_max_fee_ppm(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get max_fee_ppm(): number {
    return this.get_max_fee_ppm();
  }

  set max_fee_ppm(value: number) {
    this.set_max_fee_ppm(value);
  }

  get_builder_seat_idx(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_builder_seat_idx(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get builder_seat_idx(): number {
    return this.get_builder_seat_idx();
  }

  set builder_seat_idx(value: number) {
    this.set_builder_seat_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SeatSetBuilderApprovalInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SeatSetBuilderApprovalInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SeatSetBuilderApprovalInstruction');
    }
    return __tnBigIntToNumber(irResult, 'SeatSetBuilderApprovalInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, max_fee_ppm: number, builder_seat_idx: number): SeatSetBuilderApprovalInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, max_fee_ppm, true); /* max_fee_ppm (little-endian) */
    view.setUint32(3, builder_seat_idx, true); /* builder_seat_idx (little-endian) */

    return new SeatSetBuilderApprovalInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): SeatSetBuilderApprovalInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SeatSetBuilderApprovalInstruction(buffer);
  }

}

export class SeatSetBuilderApprovalInstructionBuilder {
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

  set_max_fee_ppm(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_builder_seat_idx(value: number): this {
    this.view.setUint32(3, value, true);
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

  finish(): SeatSetBuilderApprovalInstruction {
    const view = SeatSetBuilderApprovalInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SeatSetBuilderApprovalInstruction");
    return view;
  }
}

__tnRegisterFootprint("SeatSetBuilderApprovalInstruction", (params) => SeatSetBuilderApprovalInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("SeatSetBuilderApprovalInstruction", (buffer, params) => SeatSetBuilderApprovalInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SeatSetBuilderApprovalInstruction", (buffer) => { const result = SeatSetBuilderApprovalInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SeatSetFeeReceiverInstruction ----- */

const __tn_ir_SeatSetFeeReceiverInstruction = {
  typeName: "SeatSetFeeReceiverInstruction",
  root: { op: "const", value: 7n }
} as const;

export class SeatSetFeeReceiverInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SeatSetFeeReceiverInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("SeatSetFeeReceiverInstruction.__tnCreateView requires a Uint8Array");
    return new SeatSetFeeReceiverInstruction(new Uint8Array(buffer));
  }

  static builder(): SeatSetFeeReceiverInstructionBuilder {
    return new SeatSetFeeReceiverInstructionBuilder();
  }

  static fromBuilder(builder: SeatSetFeeReceiverInstructionBuilder): SeatSetFeeReceiverInstruction | null {
    const buffer = builder.build();
    return SeatSetFeeReceiverInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_reserved1(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SeatSetFeeReceiverInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SeatSetFeeReceiverInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SeatSetFeeReceiverInstruction');
    }
    return __tnBigIntToNumber(irResult, 'SeatSetFeeReceiverInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, reserved0: number, reserved1: number): SeatSetFeeReceiverInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, reserved1, true); /* reserved1 (little-endian) */

    return new SeatSetFeeReceiverInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): SeatSetFeeReceiverInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SeatSetFeeReceiverInstruction(buffer);
  }

}

export class SeatSetFeeReceiverInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(3, value, true);
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

  finish(): SeatSetFeeReceiverInstruction {
    const view = SeatSetFeeReceiverInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SeatSetFeeReceiverInstruction");
    return view;
  }
}

__tnRegisterFootprint("SeatSetFeeReceiverInstruction", (params) => SeatSetFeeReceiverInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("SeatSetFeeReceiverInstruction", (buffer, params) => SeatSetFeeReceiverInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SeatSetFeeReceiverInstruction", (buffer) => { const result = SeatSetFeeReceiverInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SettleFundingInstruction ----- */

const __tn_ir_SettleFundingInstruction = {
  typeName: "SettleFundingInstruction",
  root: { op: "const", value: 7n }
} as const;

export class SettleFundingInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SettleFundingInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("SettleFundingInstruction.__tnCreateView requires a Uint8Array");
    return new SettleFundingInstruction(new Uint8Array(buffer));
  }

  static builder(): SettleFundingInstructionBuilder {
    return new SettleFundingInstructionBuilder();
  }

  static fromBuilder(builder: SettleFundingInstructionBuilder): SettleFundingInstruction | null {
    const buffer = builder.build();
    return SettleFundingInstruction.from_array(buffer);
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

  get_reserved0(): number {
    const offset = 1;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved0(value: number): void {
    const offset = 1;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved0(): number {
    return this.get_reserved0();
  }

  set reserved0(value: number) {
    this.set_reserved0(value);
  }

  get_target_seat_idx(): number {
    const offset = 3;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_target_seat_idx(value: number): void {
    const offset = 3;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get target_seat_idx(): number {
    return this.get_target_seat_idx();
  }

  set target_seat_idx(value: number) {
    this.set_target_seat_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SettleFundingInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SettleFundingInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SettleFundingInstruction');
    }
    return __tnBigIntToNumber(irResult, 'SettleFundingInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 7) return { ok: false, code: "tn.buffer_too_small", consumed: 7 };
    return { ok: true, consumed: 7 };
  }

  static new(market_record_idx: number, reserved0: number, target_seat_idx: number): SettleFundingInstruction {
    const buffer = new Uint8Array(7);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, market_record_idx); /* market_record_idx */
    view.setUint16(1, reserved0, true); /* reserved0 (little-endian) */
    view.setUint32(3, target_seat_idx, true); /* target_seat_idx (little-endian) */

    return new SettleFundingInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): SettleFundingInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SettleFundingInstruction(buffer);
  }

}

export class SettleFundingInstructionBuilder {
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

  set_reserved0(value: number): this {
    this.view.setUint16(1, value, true);
    return this;
  }

  set_target_seat_idx(value: number): this {
    this.view.setUint32(3, value, true);
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

  finish(): SettleFundingInstruction {
    const view = SettleFundingInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SettleFundingInstruction");
    return view;
  }
}

__tnRegisterFootprint("SettleFundingInstruction", (params) => SettleFundingInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("SettleFundingInstruction", (buffer, params) => SettleFundingInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SettleFundingInstruction", (buffer) => { const result = SettleFundingInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR TokenBalanceEvent ----- */

const __tn_ir_TokenBalanceEvent = {
  typeName: "TokenBalanceEvent",
  root: { op: "const", value: 168n }
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

  get_reserved0(): number[] {
    const offset = 4;
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 4;
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

  get_quantity_quote(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_quantity_quote(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get quantity_quote(): bigint {
    return this.get_quantity_quote();
  }

  set quantity_quote(value: bigint) {
    this.set_quantity_quote(value);
  }

  get_long_lots(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_long_lots(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get long_lots(): bigint {
    return this.get_long_lots();
  }

  set long_lots(value: bigint) {
    this.set_long_lots(value);
  }

  get_short_lots(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_short_lots(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get short_lots(): bigint {
    return this.get_short_lots();
  }

  set short_lots(value: bigint) {
    this.set_short_lots(value);
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

  get_wallet(): Pubkey {
    const offset = 104;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_wallet(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 104;
    this.buffer.set(sourceBytes, offset);
  }

  get wallet(): Pubkey {
    return this.get_wallet();
  }

  set wallet(value: Pubkey) {
    this.set_wallet(value);
  }

  get_vault(): Pubkey {
    const offset = 136;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 136;
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
    if (buffer.length < 168) return { ok: false, code: "tn.buffer_too_small", consumed: 168 };
    return { ok: true, consumed: 168 };
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
    this.buffer = new Uint8Array(168);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 4) throw new Error("reserved0 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 4 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(8, cast, true);
    return this;
  }

  set_quantity_quote(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_long_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_short_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
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

  set_wallet(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("wallet expects 32 bytes");
    this.buffer.set(value, 104);
    return this;
  }

  set_vault(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault expects 32 bytes");
    this.buffer.set(value, 136);
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

/* ----- TYPE DEFINITION FOR ExchangeAdminEvent ----- */

const __tn_ir_ExchangeAdminEvent = {
  typeName: "ExchangeAdminEvent",
  root: { op: "const", value: 136n }
} as const;

export class ExchangeAdminEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeAdminEvent {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeAdminEvent.__tnCreateView requires a Uint8Array");
    return new ExchangeAdminEvent(new Uint8Array(buffer));
  }

  static builder(): ExchangeAdminEventBuilder {
    return new ExchangeAdminEventBuilder();
  }

  static fromBuilder(builder: ExchangeAdminEventBuilder): ExchangeAdminEvent | null {
    const buffer = builder.build();
    return ExchangeAdminEvent.from_array(buffer);
  }

  get_is_recovery(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_is_recovery(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get is_recovery(): number {
    return this.get_is_recovery();
  }

  set is_recovery(value: number) {
    this.set_is_recovery(value);
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

  get_exchange_meta(): Pubkey {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_meta(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_meta(): Pubkey {
    return this.get_exchange_meta();
  }

  set exchange_meta(value: Pubkey) {
    this.set_exchange_meta(value);
  }

  get_old_admin(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_old_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get old_admin(): Pubkey {
    return this.get_old_admin();
  }

  set old_admin(value: Pubkey) {
    this.set_old_admin(value);
  }

  get_new_admin(): Pubkey {
    const offset = 72;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_new_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 72;
    this.buffer.set(sourceBytes, offset);
  }

  get new_admin(): Pubkey {
    return this.get_new_admin();
  }

  set new_admin(value: Pubkey) {
    this.set_new_admin(value);
  }

  get_authority(): Pubkey {
    const offset = 104;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 104;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Pubkey {
    return this.get_authority();
  }

  set authority(value: Pubkey) {
    this.set_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ExchangeAdminEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeAdminEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeAdminEvent');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeAdminEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 136) return { ok: false, code: "tn.buffer_too_small", consumed: 136 };
    return { ok: true, consumed: 136 };
  }

  static from_array(buffer: Uint8Array): ExchangeAdminEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeAdminEvent(buffer);
  }

}

export class ExchangeAdminEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(136);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_is_recovery(value: number): this {
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

  set_exchange_meta(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_meta expects 32 bytes");
    this.buffer.set(value, 8);
    return this;
  }

  set_old_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("old_admin expects 32 bytes");
    this.buffer.set(value, 40);
    return this;
  }

  set_new_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("new_admin expects 32 bytes");
    this.buffer.set(value, 72);
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("authority expects 32 bytes");
    this.buffer.set(value, 104);
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

  finish(): ExchangeAdminEvent {
    const view = ExchangeAdminEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeAdminEvent");
    return view;
  }
}

__tnRegisterFootprint("ExchangeAdminEvent", (params) => ExchangeAdminEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeAdminEvent", (buffer, params) => ExchangeAdminEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeAdminEvent", (buffer) => { const result = ExchangeAdminEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExchangeInitializedEvent ----- */

const __tn_ir_ExchangeInitializedEvent = {
  typeName: "ExchangeInitializedEvent",
  root: { op: "const", value: 104n }
} as const;

export class ExchangeInitializedEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeInitializedEvent {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeInitializedEvent.__tnCreateView requires a Uint8Array");
    return new ExchangeInitializedEvent(new Uint8Array(buffer));
  }

  static builder(): ExchangeInitializedEventBuilder {
    return new ExchangeInitializedEventBuilder();
  }

  static fromBuilder(builder: ExchangeInitializedEventBuilder): ExchangeInitializedEvent | null {
    const buffer = builder.build();
    return ExchangeInitializedEvent.from_array(buffer);
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

  get_exchange_meta(): Pubkey {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_meta(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_meta(): Pubkey {
    return this.get_exchange_meta();
  }

  set exchange_meta(value: Pubkey) {
    this.set_exchange_meta(value);
  }

  get_token_program(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_token_program(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get token_program(): Pubkey {
    return this.get_token_program();
  }

  set token_program(value: Pubkey) {
    this.set_token_program(value);
  }

  get_exchange_admin(): Pubkey {
    const offset = 72;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 72;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_admin(): Pubkey {
    return this.get_exchange_admin();
  }

  set exchange_admin(value: Pubkey) {
    this.set_exchange_admin(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ExchangeInitializedEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeInitializedEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeInitializedEvent');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeInitializedEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 104) return { ok: false, code: "tn.buffer_too_small", consumed: 104 };
    return { ok: true, consumed: 104 };
  }

  static from_array(buffer: Uint8Array): ExchangeInitializedEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeInitializedEvent(buffer);
  }

}

export class ExchangeInitializedEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(104);
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

  set_exchange_meta(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_meta expects 32 bytes");
    this.buffer.set(value, 8);
    return this;
  }

  set_token_program(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("token_program expects 32 bytes");
    this.buffer.set(value, 40);
    return this;
  }

  set_exchange_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_admin expects 32 bytes");
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

  finish(): ExchangeInitializedEvent {
    const view = ExchangeInitializedEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeInitializedEvent");
    return view;
  }
}

__tnRegisterFootprint("ExchangeInitializedEvent", (params) => ExchangeInitializedEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeInitializedEvent", (buffer, params) => ExchangeInitializedEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeInitializedEvent", (buffer) => { const result = ExchangeInitializedEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExchangeMetaAccount ----- */

const __tn_ir_ExchangeMetaAccount = {
  typeName: "ExchangeMetaAccount",
  root: { op: "const", value: 96n }
} as const;

export class ExchangeMetaAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeMetaAccount {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeMetaAccount.__tnCreateView requires a Uint8Array");
    return new ExchangeMetaAccount(new Uint8Array(buffer));
  }

  static builder(): ExchangeMetaAccountBuilder {
    return new ExchangeMetaAccountBuilder();
  }

  static fromBuilder(builder: ExchangeMetaAccountBuilder): ExchangeMetaAccount | null {
    const buffer = builder.build();
    return ExchangeMetaAccount.from_array(buffer);
  }

  get_magic(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_magic(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get magic(): bigint {
    return this.get_magic();
  }

  set magic(value: bigint) {
    this.set_magic(value);
  }

  get_version(): number {
    const offset = 8;
    return this.view.getUint8(offset);
  }

  set_version(value: number): void {
    const offset = 8;
    this.view.setUint8(offset, value);
  }

  get version(): number {
    return this.get_version();
  }

  set version(value: number) {
    this.set_version(value);
  }

  get_status_flags(): number {
    const offset = 9;
    return this.view.getUint8(offset);
  }

  set_status_flags(value: number): void {
    const offset = 9;
    this.view.setUint8(offset, value);
  }

  get status_flags(): number {
    return this.get_status_flags();
  }

  set status_flags(value: number) {
    this.set_status_flags(value);
  }

  get_reserved0(): number[] {
    const offset = 10;
    const result: number[] = [];
    for (let i = 0; i < 6; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 10;
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

  get_token_program_pubkey(): Pubkey {
    const offset = 16;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_token_program_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 16;
    this.buffer.set(sourceBytes, offset);
  }

  get token_program_pubkey(): Pubkey {
    return this.get_token_program_pubkey();
  }

  set token_program_pubkey(value: Pubkey) {
    this.set_token_program_pubkey(value);
  }

  get_exchange_admin_pubkey(): Pubkey {
    const offset = 48;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_admin_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 48;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_admin_pubkey(): Pubkey {
    return this.get_exchange_admin_pubkey();
  }

  set exchange_admin_pubkey(value: Pubkey) {
    this.set_exchange_admin_pubkey(value);
  }

  get_reserved1(): number[] {
    const offset = 80;
    const result: number[] = [];
    for (let i = 0; i < 16; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved1(value: number[]): void {
    const offset = 80;
    if (value.length !== 16) {
      throw new Error('Array length must be 16');
    }
    for (let i = 0; i < 16; i++) {
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
    return __tnEvalFootprint(__tn_ir_ExchangeMetaAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeMetaAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeMetaAccount');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeMetaAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): ExchangeMetaAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeMetaAccount(buffer);
  }

}

export class ExchangeMetaAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(96);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_magic(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_version(value: number): this {
    this.view.setUint8(8, value);
    return this;
  }

  set_status_flags(value: number): this {
    this.view.setUint8(9, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 6) throw new Error("reserved0 expects 6 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 10 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_token_program_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("token_program_pubkey expects 32 bytes");
    this.buffer.set(value, 16);
    return this;
  }

  set_exchange_admin_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_admin_pubkey expects 32 bytes");
    this.buffer.set(value, 48);
    return this;
  }

  set_reserved1(values: number[]): this {
    if (values.length !== 16) throw new Error("reserved1 expects 16 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 80 + i * 1;
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

  finish(): ExchangeMetaAccount {
    const view = ExchangeMetaAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeMetaAccount");
    return view;
  }
}

__tnRegisterFootprint("ExchangeMetaAccount", (params) => ExchangeMetaAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeMetaAccount", (buffer, params) => ExchangeMetaAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeMetaAccount", (buffer) => { const result = ExchangeMetaAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExchangeMetaAccountPayload ----- */

const __tn_ir_ExchangeMetaAccountPayload = {
  typeName: "ExchangeMetaAccountPayload",
  root: { op: "const", value: 95n }
} as const;

export class ExchangeMetaAccountPayload {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeMetaAccountPayload {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeMetaAccountPayload.__tnCreateView requires a Uint8Array");
    return new ExchangeMetaAccountPayload(new Uint8Array(buffer));
  }

  static builder(): ExchangeMetaAccountPayloadBuilder {
    return new ExchangeMetaAccountPayloadBuilder();
  }

  static fromBuilder(builder: ExchangeMetaAccountPayloadBuilder): ExchangeMetaAccountPayload | null {
    const buffer = builder.build();
    return ExchangeMetaAccountPayload.from_array(buffer);
  }

  get_magic_suffix(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 7; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_magic_suffix(value: number[]): void {
    const offset = 0;
    if (value.length !== 7) {
      throw new Error('Array length must be 7');
    }
    for (let i = 0; i < 7; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get magic_suffix(): number[] {
    return this.get_magic_suffix();
  }

  set magic_suffix(value: number[]) {
    this.set_magic_suffix(value);
  }

  get_version(): number {
    const offset = 7;
    return this.view.getUint8(offset);
  }

  set_version(value: number): void {
    const offset = 7;
    this.view.setUint8(offset, value);
  }

  get version(): number {
    return this.get_version();
  }

  set version(value: number) {
    this.set_version(value);
  }

  get_status_flags(): number {
    const offset = 8;
    return this.view.getUint8(offset);
  }

  set_status_flags(value: number): void {
    const offset = 8;
    this.view.setUint8(offset, value);
  }

  get status_flags(): number {
    return this.get_status_flags();
  }

  set status_flags(value: number) {
    this.set_status_flags(value);
  }

  get_reserved0(): number[] {
    const offset = 9;
    const result: number[] = [];
    for (let i = 0; i < 6; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 9;
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

  get_token_program_pubkey(): Pubkey {
    const offset = 15;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_token_program_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 15;
    this.buffer.set(sourceBytes, offset);
  }

  get token_program_pubkey(): Pubkey {
    return this.get_token_program_pubkey();
  }

  set token_program_pubkey(value: Pubkey) {
    this.set_token_program_pubkey(value);
  }

  get_exchange_admin_pubkey(): Pubkey {
    const offset = 47;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_admin_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 47;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_admin_pubkey(): Pubkey {
    return this.get_exchange_admin_pubkey();
  }

  set exchange_admin_pubkey(value: Pubkey) {
    this.set_exchange_admin_pubkey(value);
  }

  get_reserved1(): number[] {
    const offset = 79;
    const result: number[] = [];
    for (let i = 0; i < 16; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved1(value: number[]): void {
    const offset = 79;
    if (value.length !== 16) {
      throw new Error('Array length must be 16');
    }
    for (let i = 0; i < 16; i++) {
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
    return __tnEvalFootprint(__tn_ir_ExchangeMetaAccountPayload.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeMetaAccountPayload, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeMetaAccountPayload');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeMetaAccountPayload::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 95) return { ok: false, code: "tn.buffer_too_small", consumed: 95 };
    return { ok: true, consumed: 95 };
  }

  static from_array(buffer: Uint8Array): ExchangeMetaAccountPayload | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeMetaAccountPayload(buffer);
  }

}

export class ExchangeMetaAccountPayloadBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(95);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_magic_suffix(values: number[]): this {
    if (values.length !== 7) throw new Error("magic_suffix expects 7 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_version(value: number): this {
    this.view.setUint8(7, value);
    return this;
  }

  set_status_flags(value: number): this {
    this.view.setUint8(8, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 6) throw new Error("reserved0 expects 6 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 9 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_token_program_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("token_program_pubkey expects 32 bytes");
    this.buffer.set(value, 15);
    return this;
  }

  set_exchange_admin_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_admin_pubkey expects 32 bytes");
    this.buffer.set(value, 47);
    return this;
  }

  set_reserved1(values: number[]): this {
    if (values.length !== 16) throw new Error("reserved1 expects 16 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 79 + i * 1;
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

  finish(): ExchangeMetaAccountPayload {
    const view = ExchangeMetaAccountPayload.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeMetaAccountPayload");
    return view;
  }
}

__tnRegisterFootprint("ExchangeMetaAccountPayload", (params) => ExchangeMetaAccountPayload.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeMetaAccountPayload", (buffer, params) => ExchangeMetaAccountPayload.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeMetaAccountPayload", (buffer) => { const result = ExchangeMetaAccountPayload.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR ExchangeStatusEvent ----- */

const __tn_ir_ExchangeStatusEvent = {
  typeName: "ExchangeStatusEvent",
  root: { op: "const", value: 72n }
} as const;

export class ExchangeStatusEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): ExchangeStatusEvent {
    if (!buffer || buffer.length === undefined) throw new Error("ExchangeStatusEvent.__tnCreateView requires a Uint8Array");
    return new ExchangeStatusEvent(new Uint8Array(buffer));
  }

  static builder(): ExchangeStatusEventBuilder {
    return new ExchangeStatusEventBuilder();
  }

  static fromBuilder(builder: ExchangeStatusEventBuilder): ExchangeStatusEvent | null {
    const buffer = builder.build();
    return ExchangeStatusEvent.from_array(buffer);
  }

  get_old_status_flags(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_old_status_flags(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get old_status_flags(): number {
    return this.get_old_status_flags();
  }

  set old_status_flags(value: number) {
    this.set_old_status_flags(value);
  }

  get_new_status_flags(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_new_status_flags(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get new_status_flags(): number {
    return this.get_new_status_flags();
  }

  set new_status_flags(value: number) {
    this.set_new_status_flags(value);
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

  get_exchange_meta(): Pubkey {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_meta(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_meta(): Pubkey {
    return this.get_exchange_meta();
  }

  set exchange_meta(value: Pubkey) {
    this.set_exchange_meta(value);
  }

  get_exchange_admin(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_admin(): Pubkey {
    return this.get_exchange_admin();
  }

  set exchange_admin(value: Pubkey) {
    this.set_exchange_admin(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ExchangeStatusEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ExchangeStatusEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ExchangeStatusEvent');
    }
    return __tnBigIntToNumber(irResult, 'ExchangeStatusEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 72) return { ok: false, code: "tn.buffer_too_small", consumed: 72 };
    return { ok: true, consumed: 72 };
  }

  static from_array(buffer: Uint8Array): ExchangeStatusEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new ExchangeStatusEvent(buffer);
  }

}

export class ExchangeStatusEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(72);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_old_status_flags(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_new_status_flags(value: number): this {
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

  set_exchange_meta(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_meta expects 32 bytes");
    this.buffer.set(value, 8);
    return this;
  }

  set_exchange_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_admin expects 32 bytes");
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

  finish(): ExchangeStatusEvent {
    const view = ExchangeStatusEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ExchangeStatusEvent");
    return view;
  }
}

__tnRegisterFootprint("ExchangeStatusEvent", (params) => ExchangeStatusEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("ExchangeStatusEvent", (buffer, params) => ExchangeStatusEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("ExchangeStatusEvent", (buffer) => { const result = ExchangeStatusEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FeeEvent ----- */

const __tn_ir_FeeEvent = {
  typeName: "FeeEvent",
  root: { op: "const", value: 176n }
} as const;

export class FeeEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FeeEvent {
    if (!buffer || buffer.length === undefined) throw new Error("FeeEvent.__tnCreateView requires a Uint8Array");
    return new FeeEvent(new Uint8Array(buffer));
  }

  static builder(): FeeEventBuilder {
    return new FeeEventBuilder();
  }

  static fromBuilder(builder: FeeEventBuilder): FeeEvent | null {
    const buffer = builder.build();
    return FeeEvent.from_array(buffer);
  }

  get_market(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_seat_idx(): number {
    const offset = 32;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 32;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_builder_seat_idx(): number {
    const offset = 36;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_builder_seat_idx(value: number): void {
    const offset = 36;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get builder_seat_idx(): number {
    return this.get_builder_seat_idx();
  }

  set builder_seat_idx(value: number) {
    this.set_builder_seat_idx(value);
  }

  get_kind(): number {
    const offset = 40;
    return this.view.getUint8(offset);
  }

  set_kind(value: number): void {
    const offset = 40;
    this.view.setUint8(offset, value);
  }

  get kind(): number {
    return this.get_kind();
  }

  set kind(value: number) {
    this.set_kind(value);
  }

  get_fill_cnt(): number {
    const offset = 41;
    return this.view.getUint8(offset);
  }

  set_fill_cnt(value: number): void {
    const offset = 41;
    this.view.setUint8(offset, value);
  }

  get fill_cnt(): number {
    return this.get_fill_cnt();
  }

  set fill_cnt(value: number) {
    this.set_fill_cnt(value);
  }

  get_reserved0(): number[] {
    const offset = 42;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 42;
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

  get_taker_fee_ppm(): number {
    const offset = 44;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_taker_fee_ppm(value: number): void {
    const offset = 44;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get taker_fee_ppm(): number {
    return this.get_taker_fee_ppm();
  }

  set taker_fee_ppm(value: number) {
    this.set_taker_fee_ppm(value);
  }

  get_maker_rebate_ppm(): number {
    const offset = 48;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_maker_rebate_ppm(value: number): void {
    const offset = 48;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get maker_rebate_ppm(): number {
    return this.get_maker_rebate_ppm();
  }

  set maker_rebate_ppm(value: number) {
    this.set_maker_rebate_ppm(value);
  }

  get_builder_fee_ppm(): number {
    const offset = 52;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_builder_fee_ppm(value: number): void {
    const offset = 52;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get builder_fee_ppm(): number {
    return this.get_builder_fee_ppm();
  }

  set builder_fee_ppm(value: number) {
    this.set_builder_fee_ppm(value);
  }

  get_notional(): bigint {
    const offset = 56;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_notional(value: bigint): void {
    const offset = 56;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get notional(): bigint {
    return this.get_notional();
  }

  set notional(value: bigint) {
    this.set_notional(value);
  }

  get_taker_fee(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_taker_fee(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get taker_fee(): bigint {
    return this.get_taker_fee();
  }

  set taker_fee(value: bigint) {
    this.set_taker_fee(value);
  }

  get_taker_fee_waived(): bigint {
    const offset = 72;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_taker_fee_waived(value: bigint): void {
    const offset = 72;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get taker_fee_waived(): bigint {
    return this.get_taker_fee_waived();
  }

  set taker_fee_waived(value: bigint) {
    this.set_taker_fee_waived(value);
  }

  get_maker_rebates(): bigint {
    const offset = 80;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_maker_rebates(value: bigint): void {
    const offset = 80;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get maker_rebates(): bigint {
    return this.get_maker_rebates();
  }

  set maker_rebates(value: bigint) {
    this.set_maker_rebates(value);
  }

  get_builder_fee(): bigint {
    const offset = 88;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_builder_fee(value: bigint): void {
    const offset = 88;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get builder_fee(): bigint {
    return this.get_builder_fee();
  }

  set builder_fee(value: bigint) {
    this.set_builder_fee(value);
  }

  get_builder_fee_waived(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_builder_fee_waived(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get builder_fee_waived(): bigint {
    return this.get_builder_fee_waived();
  }

  set builder_fee_waived(value: bigint) {
    this.set_builder_fee_waived(value);
  }

  get_maker_builder_fees(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_maker_builder_fees(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get maker_builder_fees(): bigint {
    return this.get_maker_builder_fees();
  }

  set maker_builder_fees(value: bigint) {
    this.set_maker_builder_fees(value);
  }

  get_protocol_fee(): bigint {
    const offset = 112;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_protocol_fee(value: bigint): void {
    const offset = 112;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get protocol_fee(): bigint {
    return this.get_protocol_fee();
  }

  set protocol_fee(value: bigint) {
    this.set_protocol_fee(value);
  }

  get_insurance(): bigint {
    const offset = 120;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_insurance(value: bigint): void {
    const offset = 120;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get insurance(): bigint {
    return this.get_insurance();
  }

  set insurance(value: bigint) {
    this.set_insurance(value);
  }

  get_fee_balance(): bigint {
    const offset = 128;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_fee_balance(value: bigint): void {
    const offset = 128;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get fee_balance(): bigint {
    return this.get_fee_balance();
  }

  set fee_balance(value: bigint) {
    this.set_fee_balance(value);
  }

  get_insurance_balance(): bigint {
    const offset = 136;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_insurance_balance(value: bigint): void {
    const offset = 136;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get insurance_balance(): bigint {
    return this.get_insurance_balance();
  }

  set insurance_balance(value: bigint) {
    this.set_insurance_balance(value);
  }

  get_waived_map(): bigint[] {
    const offset = 144;
    const result: bigint[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getBigUint64((offset + i * 8), true));
    }
    return result;
  }

  set_waived_map(value: bigint[]): void {
    const offset = 144;
    if (value.length !== 2) {
      throw new Error('Array length must be 2');
    }
    for (let i = 0; i < 2; i++) {
      this.view.setBigUint64((offset + i * 8), value[i], true);
    }
  }

  get waived_map(): bigint[] {
    return this.get_waived_map();
  }

  set waived_map(value: bigint[]) {
    this.set_waived_map(value);
  }

  get_maker_fee_map(): bigint[] {
    const offset = 160;
    const result: bigint[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getBigUint64((offset + i * 8), true));
    }
    return result;
  }

  set_maker_fee_map(value: bigint[]): void {
    const offset = 160;
    if (value.length !== 2) {
      throw new Error('Array length must be 2');
    }
    for (let i = 0; i < 2; i++) {
      this.view.setBigUint64((offset + i * 8), value[i], true);
    }
  }

  get maker_fee_map(): bigint[] {
    return this.get_maker_fee_map();
  }

  set maker_fee_map(value: bigint[]) {
    this.set_maker_fee_map(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FeeEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FeeEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FeeEvent');
    }
    return __tnBigIntToNumber(irResult, 'FeeEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 176) return { ok: false, code: "tn.buffer_too_small", consumed: 176 };
    return { ok: true, consumed: 176 };
  }

  static from_array(buffer: Uint8Array): FeeEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FeeEvent(buffer);
  }

}

export class FeeEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(176);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(32, value, true);
    return this;
  }

  set_builder_seat_idx(value: number): this {
    this.view.setUint32(36, value, true);
    return this;
  }

  set_kind(value: number): this {
    this.view.setUint8(40, value);
    return this;
  }

  set_fill_cnt(value: number): this {
    this.view.setUint8(41, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 2) throw new Error("reserved0 expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 42 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_taker_fee_ppm(value: number): this {
    this.view.setUint32(44, value, true);
    return this;
  }

  set_maker_rebate_ppm(value: number): this {
    this.view.setUint32(48, value, true);
    return this;
  }

  set_builder_fee_ppm(value: number): this {
    this.view.setUint32(52, value, true);
    return this;
  }

  set_notional(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(56, cast, true);
    return this;
  }

  set_taker_fee(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_taker_fee_waived(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(72, cast, true);
    return this;
  }

  set_maker_rebates(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(80, cast, true);
    return this;
  }

  set_builder_fee(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(88, cast, true);
    return this;
  }

  set_builder_fee_waived(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_maker_builder_fees(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_protocol_fee(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(112, cast, true);
    return this;
  }

  set_insurance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(120, cast, true);
    return this;
  }

  set_fee_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(128, cast, true);
    return this;
  }

  set_insurance_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(136, cast, true);
    return this;
  }

  set_waived_map(values: bigint[]): this {
    if (values.length !== 2) throw new Error("waived_map expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 144 + i * 8;
      this.view.setBigUint64(byteOffset, values[i], true);
    }
    return this;
  }

  set_maker_fee_map(values: bigint[]): this {
    if (values.length !== 2) throw new Error("maker_fee_map expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 160 + i * 8;
      this.view.setBigUint64(byteOffset, values[i], true);
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

  finish(): FeeEvent {
    const view = FeeEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FeeEvent");
    return view;
  }
}

__tnRegisterFootprint("FeeEvent", (params) => FeeEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("FeeEvent", (buffer, params) => FeeEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FeeEvent", (buffer) => { const result = FeeEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FundingRoundEvent ----- */

const __tn_ir_FundingRoundEvent = {
  typeName: "FundingRoundEvent",
  root: { op: "const", value: 88n }
} as const;

export class FundingRoundEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FundingRoundEvent {
    if (!buffer || buffer.length === undefined) throw new Error("FundingRoundEvent.__tnCreateView requires a Uint8Array");
    return new FundingRoundEvent(new Uint8Array(buffer));
  }

  static builder(): FundingRoundEventBuilder {
    return new FundingRoundEventBuilder();
  }

  static fromBuilder(builder: FundingRoundEventBuilder): FundingRoundEvent | null {
    const buffer = builder.build();
    return FundingRoundEvent.from_array(buffer);
  }

  get_market(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_rate(): bigint {
    const offset = 32;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_rate(value: bigint): void {
    const offset = 32;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get rate(): bigint {
    return this.get_rate();
  }

  set rate(value: bigint) {
    this.set_rate(value);
  }

  get_premium_sum(): bigint {
    const offset = 40;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_premium_sum(value: bigint): void {
    const offset = 40;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get premium_sum(): bigint {
    return this.get_premium_sum();
  }

  set premium_sum(value: bigint) {
    this.set_premium_sum(value);
  }

  get_sample_cnt(): number {
    const offset = 48;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_sample_cnt(value: number): void {
    const offset = 48;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get sample_cnt(): number {
    return this.get_sample_cnt();
  }

  set sample_cnt(value: number) {
    this.set_sample_cnt(value);
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

  get_index_price(): bigint {
    const offset = 56;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_index_price(value: bigint): void {
    const offset = 56;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get index_price(): bigint {
    return this.get_index_price();
  }

  set index_price(value: bigint) {
    this.set_index_price(value);
  }

  get_funding_index_lo(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_index_lo(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_index_lo(): bigint {
    return this.get_funding_index_lo();
  }

  set funding_index_lo(value: bigint) {
    this.set_funding_index_lo(value);
  }

  get_funding_index_hi(): bigint {
    const offset = 72;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_index_hi(value: bigint): void {
    const offset = 72;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_index_hi(): bigint {
    return this.get_funding_index_hi();
  }

  set funding_index_hi(value: bigint) {
    this.set_funding_index_hi(value);
  }

  get_round_ns(): bigint {
    const offset = 80;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_round_ns(value: bigint): void {
    const offset = 80;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get round_ns(): bigint {
    return this.get_round_ns();
  }

  set round_ns(value: bigint) {
    this.set_round_ns(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FundingRoundEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FundingRoundEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FundingRoundEvent');
    }
    return __tnBigIntToNumber(irResult, 'FundingRoundEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 88) return { ok: false, code: "tn.buffer_too_small", consumed: 88 };
    return { ok: true, consumed: 88 };
  }

  static from_array(buffer: Uint8Array): FundingRoundEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FundingRoundEvent(buffer);
  }

}

export class FundingRoundEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(88);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_rate(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(32, cast, true);
    return this;
  }

  set_premium_sum(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(40, cast, true);
    return this;
  }

  set_sample_cnt(value: number): this {
    this.view.setUint32(48, value, true);
    return this;
  }

  set_reserved0(value: number): this {
    this.view.setUint32(52, value, true);
    return this;
  }

  set_index_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(56, cast, true);
    return this;
  }

  set_funding_index_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_funding_index_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(72, cast, true);
    return this;
  }

  set_round_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(80, cast, true);
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

  finish(): FundingRoundEvent {
    const view = FundingRoundEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FundingRoundEvent");
    return view;
  }
}

__tnRegisterFootprint("FundingRoundEvent", (params) => FundingRoundEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("FundingRoundEvent", (buffer, params) => FundingRoundEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FundingRoundEvent", (buffer) => { const result = FundingRoundEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR InsuranceEvent ----- */

const __tn_ir_InsuranceEvent = {
  typeName: "InsuranceEvent",
  root: { op: "const", value: 56n }
} as const;

export class InsuranceEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): InsuranceEvent {
    if (!buffer || buffer.length === undefined) throw new Error("InsuranceEvent.__tnCreateView requires a Uint8Array");
    return new InsuranceEvent(new Uint8Array(buffer));
  }

  static builder(): InsuranceEventBuilder {
    return new InsuranceEventBuilder();
  }

  static fromBuilder(builder: InsuranceEventBuilder): InsuranceEvent | null {
    const buffer = builder.build();
    return InsuranceEvent.from_array(buffer);
  }

  get_market(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_amount(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_balance_after(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_balance_after(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get balance_after(): bigint {
    return this.get_balance_after();
  }

  set balance_after(value: bigint) {
    this.set_balance_after(value);
  }

  get_seat_idx(): number {
    const offset = 48;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 48;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_kind(): number {
    const offset = 52;
    return this.view.getUint8(offset);
  }

  set_kind(value: number): void {
    const offset = 52;
    this.view.setUint8(offset, value);
  }

  get kind(): number {
    return this.get_kind();
  }

  set kind(value: number) {
    this.set_kind(value);
  }

  get_reserved0(): number[] {
    const offset = 53;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 53;
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InsuranceEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InsuranceEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InsuranceEvent');
    }
    return __tnBigIntToNumber(irResult, 'InsuranceEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 56) return { ok: false, code: "tn.buffer_too_small", consumed: 56 };
    return { ok: true, consumed: 56 };
  }

  static from_array(buffer: Uint8Array): InsuranceEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new InsuranceEvent(buffer);
  }

}

export class InsuranceEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(56);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    return this;
  }

  set_balance_after(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
    return this;
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(48, value, true);
    return this;
  }

  set_kind(value: number): this {
    this.view.setUint8(52, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 3) throw new Error("reserved0 expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 53 + i * 1;
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

  finish(): InsuranceEvent {
    const view = InsuranceEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build InsuranceEvent");
    return view;
  }
}

__tnRegisterFootprint("InsuranceEvent", (params) => InsuranceEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("InsuranceEvent", (buffer, params) => InsuranceEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("InsuranceEvent", (buffer) => { const result = InsuranceEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR LiquidationEvent ----- */

const __tn_ir_LiquidationEvent = {
  typeName: "LiquidationEvent",
  root: { op: "const", value: 160n }
} as const;

export class LiquidationEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): LiquidationEvent {
    if (!buffer || buffer.length === undefined) throw new Error("LiquidationEvent.__tnCreateView requires a Uint8Array");
    return new LiquidationEvent(new Uint8Array(buffer));
  }

  static builder(): LiquidationEventBuilder {
    return new LiquidationEventBuilder();
  }

  static fromBuilder(builder: LiquidationEventBuilder): LiquidationEvent | null {
    const buffer = builder.build();
    return LiquidationEvent.from_array(buffer);
  }

  get_market(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_liquidator(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_liquidator(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get liquidator(): Pubkey {
    return this.get_liquidator();
  }

  set liquidator(value: Pubkey) {
    this.set_liquidator(value);
  }

  get_target(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_target(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get target(): Pubkey {
    return this.get_target();
  }

  set target(value: Pubkey) {
    this.set_target(value);
  }

  get_liquidator_seat_idx(): number {
    const offset = 96;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_liquidator_seat_idx(value: number): void {
    const offset = 96;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get liquidator_seat_idx(): number {
    return this.get_liquidator_seat_idx();
  }

  set liquidator_seat_idx(value: number) {
    this.set_liquidator_seat_idx(value);
  }

  get_target_seat_idx(): number {
    const offset = 100;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_target_seat_idx(value: number): void {
    const offset = 100;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get target_seat_idx(): number {
    return this.get_target_seat_idx();
  }

  set target_seat_idx(value: number) {
    this.set_target_seat_idx(value);
  }

  get_lots(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lots(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lots(): bigint {
    return this.get_lots();
  }

  set lots(value: bigint) {
    this.set_lots(value);
  }

  get_mark_price(): bigint {
    const offset = 112;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_price(value: bigint): void {
    const offset = 112;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_price(): bigint {
    return this.get_mark_price();
  }

  set mark_price(value: bigint) {
    this.set_mark_price(value);
  }

  get_fee(): bigint {
    const offset = 120;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_fee(value: bigint): void {
    const offset = 120;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get fee(): bigint {
    return this.get_fee();
  }

  set fee(value: bigint) {
    this.set_fee(value);
  }

  get_bad_debt(): bigint {
    const offset = 128;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_bad_debt(value: bigint): void {
    const offset = 128;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get bad_debt(): bigint {
    return this.get_bad_debt();
  }

  set bad_debt(value: bigint) {
    this.set_bad_debt(value);
  }

  get_target_quote_after(): bigint {
    const offset = 136;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_target_quote_after(value: bigint): void {
    const offset = 136;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get target_quote_after(): bigint {
    return this.get_target_quote_after();
  }

  set target_quote_after(value: bigint) {
    this.set_target_quote_after(value);
  }

  get_liquidator_quote_after(): bigint {
    const offset = 144;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_liquidator_quote_after(value: bigint): void {
    const offset = 144;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get liquidator_quote_after(): bigint {
    return this.get_liquidator_quote_after();
  }

  set liquidator_quote_after(value: bigint) {
    this.set_liquidator_quote_after(value);
  }

  get_side(): number {
    const offset = 152;
    return this.view.getUint8(offset);
  }

  set_side(value: number): void {
    const offset = 152;
    this.view.setUint8(offset, value);
  }

  get side(): number {
    return this.get_side();
  }

  set side(value: number) {
    this.set_side(value);
  }

  get_reserved0(): number[] {
    const offset = 153;
    const result: number[] = [];
    for (let i = 0; i < 7; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 153;
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_LiquidationEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_LiquidationEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for LiquidationEvent');
    }
    return __tnBigIntToNumber(irResult, 'LiquidationEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 160) return { ok: false, code: "tn.buffer_too_small", consumed: 160 };
    return { ok: true, consumed: 160 };
  }

  static from_array(buffer: Uint8Array): LiquidationEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new LiquidationEvent(buffer);
  }

}

export class LiquidationEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(160);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_liquidator(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("liquidator expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_target(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("target expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_liquidator_seat_idx(value: number): this {
    this.view.setUint32(96, value, true);
    return this;
  }

  set_target_seat_idx(value: number): this {
    this.view.setUint32(100, value, true);
    return this;
  }

  set_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_mark_price(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(112, cast, true);
    return this;
  }

  set_fee(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(120, cast, true);
    return this;
  }

  set_bad_debt(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(128, cast, true);
    return this;
  }

  set_target_quote_after(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(136, cast, true);
    return this;
  }

  set_liquidator_quote_after(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(144, cast, true);
    return this;
  }

  set_side(value: number): this {
    this.view.setUint8(152, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 7) throw new Error("reserved0 expects 7 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 153 + i * 1;
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

  finish(): LiquidationEvent {
    const view = LiquidationEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build LiquidationEvent");
    return view;
  }
}

__tnRegisterFootprint("LiquidationEvent", (params) => LiquidationEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("LiquidationEvent", (buffer, params) => LiquidationEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("LiquidationEvent", (buffer) => { const result = LiquidationEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR LossEvent ----- */

const __tn_ir_LossEvent = {
  typeName: "LossEvent",
  root: { op: "const", value: 120n }
} as const;

export class LossEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): LossEvent {
    if (!buffer || buffer.length === undefined) throw new Error("LossEvent.__tnCreateView requires a Uint8Array");
    return new LossEvent(new Uint8Array(buffer));
  }

  static builder(): LossEventBuilder {
    return new LossEventBuilder();
  }

  static fromBuilder(builder: LossEventBuilder): LossEvent | null {
    const buffer = builder.build();
    return LossEvent.from_array(buffer);
  }

  get_market(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_deficit(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_deficit(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get deficit(): bigint {
    return this.get_deficit();
  }

  set deficit(value: bigint) {
    this.set_deficit(value);
  }

  get_fee_cover(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_fee_cover(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get fee_cover(): bigint {
    return this.get_fee_cover();
  }

  set fee_cover(value: bigint) {
    this.set_fee_cover(value);
  }

  get_ins_cover(): bigint {
    const offset = 48;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_ins_cover(value: bigint): void {
    const offset = 48;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get ins_cover(): bigint {
    return this.get_ins_cover();
  }

  set ins_cover(value: bigint) {
    this.set_ins_cover(value);
  }

  get_soc_cover(): bigint {
    const offset = 56;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_soc_cover(value: bigint): void {
    const offset = 56;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get soc_cover(): bigint {
    return this.get_soc_cover();
  }

  set soc_cover(value: bigint) {
    this.set_soc_cover(value);
  }

  get_residual(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_residual(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get residual(): bigint {
    return this.get_residual();
  }

  set residual(value: bigint) {
    this.set_residual(value);
  }

  get_delta(): bigint {
    const offset = 72;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_delta(value: bigint): void {
    const offset = 72;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get delta(): bigint {
    return this.get_delta();
  }

  set delta(value: bigint) {
    this.set_delta(value);
  }

  get_oi_lots(): bigint {
    const offset = 80;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_oi_lots(value: bigint): void {
    const offset = 80;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get oi_lots(): bigint {
    return this.get_oi_lots();
  }

  set oi_lots(value: bigint) {
    this.set_oi_lots(value);
  }

  get_mark(): bigint {
    const offset = 88;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark(value: bigint): void {
    const offset = 88;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark(): bigint {
    return this.get_mark();
  }

  set mark(value: bigint) {
    this.set_mark(value);
  }

  get_bad_debt_after(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_bad_debt_after(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get bad_debt_after(): bigint {
    return this.get_bad_debt_after();
  }

  set bad_debt_after(value: bigint) {
    this.set_bad_debt_after(value);
  }

  get_insurance_after(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_insurance_after(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get insurance_after(): bigint {
    return this.get_insurance_after();
  }

  set insurance_after(value: bigint) {
    this.set_insurance_after(value);
  }

  get_epoch_id(): number {
    const offset = 112;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_epoch_id(value: number): void {
    const offset = 112;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get epoch_id(): number {
    return this.get_epoch_id();
  }

  set epoch_id(value: number) {
    this.set_epoch_id(value);
  }

  get_side(): number {
    const offset = 116;
    return this.view.getUint8(offset);
  }

  set_side(value: number): void {
    const offset = 116;
    this.view.setUint8(offset, value);
  }

  get side(): number {
    return this.get_side();
  }

  set side(value: number) {
    this.set_side(value);
  }

  get_cause(): number {
    const offset = 117;
    return this.view.getUint8(offset);
  }

  set_cause(value: number): void {
    const offset = 117;
    this.view.setUint8(offset, value);
  }

  get cause(): number {
    return this.get_cause();
  }

  set cause(value: number) {
    this.set_cause(value);
  }

  get_reserved0(): number[] {
    const offset = 118;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 118;
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_LossEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_LossEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for LossEvent');
    }
    return __tnBigIntToNumber(irResult, 'LossEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 120) return { ok: false, code: "tn.buffer_too_small", consumed: 120 };
    return { ok: true, consumed: 120 };
  }

  static from_array(buffer: Uint8Array): LossEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new LossEvent(buffer);
  }

}

export class LossEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(120);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_deficit(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    return this;
  }

  set_fee_cover(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
    return this;
  }

  set_ins_cover(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(48, cast, true);
    return this;
  }

  set_soc_cover(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(56, cast, true);
    return this;
  }

  set_residual(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_delta(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(72, cast, true);
    return this;
  }

  set_oi_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(80, cast, true);
    return this;
  }

  set_mark(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(88, cast, true);
    return this;
  }

  set_bad_debt_after(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_insurance_after(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_epoch_id(value: number): this {
    this.view.setUint32(112, value, true);
    return this;
  }

  set_side(value: number): this {
    this.view.setUint8(116, value);
    return this;
  }

  set_cause(value: number): this {
    this.view.setUint8(117, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 2) throw new Error("reserved0 expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 118 + i * 1;
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

  finish(): LossEvent {
    const view = LossEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build LossEvent");
    return view;
  }
}

__tnRegisterFootprint("LossEvent", (params) => LossEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("LossEvent", (buffer, params) => LossEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("LossEvent", (buffer) => { const result = LossEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginEvent ----- */

const __tn_ir_MarginEvent = {
  typeName: "MarginEvent",
  root: { op: "const", value: 152n }
} as const;

export class MarginEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarginEvent {
    if (!buffer || buffer.length === undefined) throw new Error("MarginEvent.__tnCreateView requires a Uint8Array");
    return new MarginEvent(new Uint8Array(buffer));
  }

  static builder(): MarginEventBuilder {
    return new MarginEventBuilder();
  }

  static fromBuilder(builder: MarginEventBuilder): MarginEvent | null {
    const buffer = builder.build();
    return MarginEvent.from_array(buffer);
  }

  get_action(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_action(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get action(): number {
    return this.get_action();
  }

  set action(value: number) {
    this.set_action(value);
  }

  get_link_cnt(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_link_cnt(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get link_cnt(): number {
    return this.get_link_cnt();
  }

  set link_cnt(value: number) {
    this.set_link_cnt(value);
  }

  get_reserved0(): number[] {
    const offset = 2;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 2;
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

  get_seat_idx(): number {
    const offset = 4;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 4;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_to_seat_idx(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_to_seat_idx(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get to_seat_idx(): number {
    return this.get_to_seat_idx();
  }

  set to_seat_idx(value: number) {
    this.set_to_seat_idx(value);
  }

  get_account_id(): number {
    const offset = 12;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_account_id(value: number): void {
    const offset = 12;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get account_id(): number {
    return this.get_account_id();
  }

  set account_id(value: number) {
    this.set_account_id(value);
  }

  get_amount(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_margin_account(): Pubkey {
    const offset = 24;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_margin_account(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 24;
    this.buffer.set(sourceBytes, offset);
  }

  get margin_account(): Pubkey {
    return this.get_margin_account();
  }

  set margin_account(value: Pubkey) {
    this.set_margin_account(value);
  }

  get_owner(): Pubkey {
    const offset = 56;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_owner(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 56;
    this.buffer.set(sourceBytes, offset);
  }

  get owner(): Pubkey {
    return this.get_owner();
  }

  set owner(value: Pubkey) {
    this.set_owner(value);
  }

  get_market(): Pubkey {
    const offset = 88;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 88;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_to_market(): Pubkey {
    const offset = 120;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_to_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 120;
    this.buffer.set(sourceBytes, offset);
  }

  get to_market(): Pubkey {
    return this.get_to_market();
  }

  set to_market(value: Pubkey) {
    this.set_to_market(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginEvent');
    }
    return __tnBigIntToNumber(irResult, 'MarginEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 152) return { ok: false, code: "tn.buffer_too_small", consumed: 152 };
    return { ok: true, consumed: 152 };
  }

  static from_array(buffer: Uint8Array): MarginEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarginEvent(buffer);
  }

}

export class MarginEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(152);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_action(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_link_cnt(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 2) throw new Error("reserved0 expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 2 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(4, value, true);
    return this;
  }

  set_to_seat_idx(value: number): this {
    this.view.setUint32(8, value, true);
    return this;
  }

  set_account_id(value: number): this {
    this.view.setUint32(12, value, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_margin_account(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("margin_account expects 32 bytes");
    this.buffer.set(value, 24);
    return this;
  }

  set_owner(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("owner expects 32 bytes");
    this.buffer.set(value, 56);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 88);
    return this;
  }

  set_to_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("to_market expects 32 bytes");
    this.buffer.set(value, 120);
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

  finish(): MarginEvent {
    const view = MarginEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarginEvent");
    return view;
  }
}

__tnRegisterFootprint("MarginEvent", (params) => MarginEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginEvent", (buffer, params) => MarginEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginEvent", (buffer) => { const result = MarginEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginLink ----- */

const __tn_ir_MarginLink = {
  typeName: "MarginLink",
  root: { op: "const", value: 40n }
} as const;

export class MarginLink {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarginLink {
    if (!buffer || buffer.length === undefined) throw new Error("MarginLink.__tnCreateView requires a Uint8Array");
    return new MarginLink(new Uint8Array(buffer));
  }

  static builder(): MarginLinkBuilder {
    return new MarginLinkBuilder();
  }

  static fromBuilder(builder: MarginLinkBuilder): MarginLink | null {
    const buffer = builder.build();
    return MarginLink.from_array(buffer);
  }

  get_market(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_seat_idx(): number {
    const offset = 32;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_seat_idx(value: number): void {
    const offset = 32;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get seat_idx(): number {
    return this.get_seat_idx();
  }

  set seat_idx(value: number) {
    this.set_seat_idx(value);
  }

  get_reserved(): number {
    const offset = 36;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved(value: number): void {
    const offset = 36;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved(): number {
    return this.get_reserved();
  }

  set reserved(value: number) {
    this.set_reserved(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginLink.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginLink, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginLink');
    }
    return __tnBigIntToNumber(irResult, 'MarginLink::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 40) return { ok: false, code: "tn.buffer_too_small", consumed: 40 };
    return { ok: true, consumed: 40 };
  }

  static from_array(buffer: Uint8Array): MarginLink | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarginLink(buffer);
  }

}

export class MarginLinkBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(40);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_seat_idx(value: number): this {
    this.view.setUint32(32, value, true);
    return this;
  }

  set_reserved(value: number): this {
    this.view.setUint32(36, value, true);
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

  finish(): MarginLink {
    const view = MarginLink.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarginLink");
    return view;
  }
}

__tnRegisterFootprint("MarginLink", (params) => MarginLink.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginLink", (buffer, params) => MarginLink.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginLink", (buffer) => { const result = MarginLink.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketAccount ----- */

const __tn_ir_MarketAccount = {
  typeName: "MarketAccount",
  root: { op: "const", value: 512n }
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

  get_exchange_status_flags(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_exchange_status_flags(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get exchange_status_flags(): number {
    return this.get_exchange_status_flags();
  }

  set exchange_status_flags(value: number) {
    this.set_exchange_status_flags(value);
  }

  get_risk_flags(): number {
    const offset = 3;
    return this.view.getUint8(offset);
  }

  set_risk_flags(value: number): void {
    const offset = 3;
    this.view.setUint8(offset, value);
  }

  get risk_flags(): number {
    return this.get_risk_flags();
  }

  set risk_flags(value: number) {
    this.set_risk_flags(value);
  }

  get_socialize_cap_bps(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_socialize_cap_bps(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get socialize_cap_bps(): number {
    return this.get_socialize_cap_bps();
  }

  set socialize_cap_bps(value: number) {
    this.set_socialize_cap_bps(value);
  }

  get_if_epoch_budget_bps(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_if_epoch_budget_bps(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get if_epoch_budget_bps(): number {
    return this.get_if_epoch_budget_bps();
  }

  set if_epoch_budget_bps(value: number) {
    this.set_if_epoch_budget_bps(value);
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

  get_price_cap(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price_cap(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price_cap(): bigint {
    return this.get_price_cap();
  }

  set price_cap(value: bigint) {
    this.set_price_cap(value);
  }

  get_max_position_lots(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_position_lots(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_position_lots(): bigint {
    return this.get_max_position_lots();
  }

  set max_position_lots(value: bigint) {
    this.set_max_position_lots(value);
  }

  get_open_interest_lots(): bigint {
    const offset = 48;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_open_interest_lots(value: bigint): void {
    const offset = 48;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get open_interest_lots(): bigint {
    return this.get_open_interest_lots();
  }

  set open_interest_lots(value: bigint) {
    this.set_open_interest_lots(value);
  }

  get_bad_debt(): bigint {
    const offset = 56;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_bad_debt(value: bigint): void {
    const offset = 56;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get bad_debt(): bigint {
    return this.get_bad_debt();
  }

  set bad_debt(value: bigint) {
    this.set_bad_debt(value);
  }

  get_order_entry_pubkey(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_order_entry_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get order_entry_pubkey(): Pubkey {
    return this.get_order_entry_pubkey();
  }

  set order_entry_pubkey(value: Pubkey) {
    this.set_order_entry_pubkey(value);
  }

  get_bids_cbook_pubkey(): Pubkey {
    const offset = 96;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_bids_cbook_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 96;
    this.buffer.set(sourceBytes, offset);
  }

  get bids_cbook_pubkey(): Pubkey {
    return this.get_bids_cbook_pubkey();
  }

  set bids_cbook_pubkey(value: Pubkey) {
    this.set_bids_cbook_pubkey(value);
  }

  get_asks_cbook_pubkey(): Pubkey {
    const offset = 128;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_asks_cbook_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 128;
    this.buffer.set(sourceBytes, offset);
  }

  get asks_cbook_pubkey(): Pubkey {
    return this.get_asks_cbook_pubkey();
  }

  set asks_cbook_pubkey(value: Pubkey) {
    this.set_asks_cbook_pubkey(value);
  }

  get_quote_vault_pubkey(): Pubkey {
    const offset = 160;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_quote_vault_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 160;
    this.buffer.set(sourceBytes, offset);
  }

  get quote_vault_pubkey(): Pubkey {
    return this.get_quote_vault_pubkey();
  }

  set quote_vault_pubkey(value: Pubkey) {
    this.set_quote_vault_pubkey(value);
  }

  get_market_authority_pubkey(): Pubkey {
    const offset = 192;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market_authority_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 192;
    this.buffer.set(sourceBytes, offset);
  }

  get market_authority_pubkey(): Pubkey {
    return this.get_market_authority_pubkey();
  }

  set market_authority_pubkey(value: Pubkey) {
    this.set_market_authority_pubkey(value);
  }

  get_oracle_feed_pubkey(): Pubkey {
    const offset = 224;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_oracle_feed_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 224;
    this.buffer.set(sourceBytes, offset);
  }

  get oracle_feed_pubkey(): Pubkey {
    return this.get_oracle_feed_pubkey();
  }

  set oracle_feed_pubkey(value: Pubkey) {
    this.set_oracle_feed_pubkey(value);
  }

  get_mark_num(): bigint {
    const offset = 256;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_num(value: bigint): void {
    const offset = 256;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_num(): bigint {
    return this.get_mark_num();
  }

  set mark_num(value: bigint) {
    this.set_mark_num(value);
  }

  get_mark_den(): bigint {
    const offset = 264;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_den(value: bigint): void {
    const offset = 264;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_den(): bigint {
    return this.get_mark_den();
  }

  set mark_den(value: bigint) {
    this.set_mark_den(value);
  }

  get_initial_margin_bps(): number {
    const offset = 272;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_initial_margin_bps(value: number): void {
    const offset = 272;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get initial_margin_bps(): number {
    return this.get_initial_margin_bps();
  }

  set initial_margin_bps(value: number) {
    this.set_initial_margin_bps(value);
  }

  get_maintenance_margin_bps(): number {
    const offset = 276;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_maintenance_margin_bps(value: number): void {
    const offset = 276;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get maintenance_margin_bps(): number {
    return this.get_maintenance_margin_bps();
  }

  set maintenance_margin_bps(value: number) {
    this.set_maintenance_margin_bps(value);
  }

  get_liquidation_fee_bps(): number {
    const offset = 280;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_liquidation_fee_bps(value: number): void {
    const offset = 280;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get liquidation_fee_bps(): number {
    return this.get_liquidation_fee_bps();
  }

  set liquidation_fee_bps(value: number) {
    this.set_liquidation_fee_bps(value);
  }

  get_oracle_exponent(): number {
    const offset = 284;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_oracle_exponent(value: number): void {
    const offset = 284;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get oracle_exponent(): number {
    return this.get_oracle_exponent();
  }

  set oracle_exponent(value: number) {
    this.set_oracle_exponent(value);
  }

  get_max_mark_age_ns(): bigint {
    const offset = 288;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_mark_age_ns(value: bigint): void {
    const offset = 288;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_mark_age_ns(): bigint {
    return this.get_max_mark_age_ns();
  }

  set max_mark_age_ns(value: bigint) {
    this.set_max_mark_age_ns(value);
  }

  get_taker_fee_ppm(): number {
    const offset = 296;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_taker_fee_ppm(value: number): void {
    const offset = 296;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get taker_fee_ppm(): number {
    return this.get_taker_fee_ppm();
  }

  set taker_fee_ppm(value: number) {
    this.set_taker_fee_ppm(value);
  }

  get_maker_rebate_ppm(): number {
    const offset = 300;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_maker_rebate_ppm(value: number): void {
    const offset = 300;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get maker_rebate_ppm(): number {
    return this.get_maker_rebate_ppm();
  }

  set maker_rebate_ppm(value: number) {
    this.set_maker_rebate_ppm(value);
  }

  get_builder_fee_cap_ppm(): number {
    const offset = 304;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_builder_fee_cap_ppm(value: number): void {
    const offset = 304;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get builder_fee_cap_ppm(): number {
    return this.get_builder_fee_cap_ppm();
  }

  set builder_fee_cap_ppm(value: number) {
    this.set_builder_fee_cap_ppm(value);
  }

  get_fee_insurance_share_ppm(): number {
    const offset = 308;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_fee_insurance_share_ppm(value: number): void {
    const offset = 308;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get fee_insurance_share_ppm(): number {
    return this.get_fee_insurance_share_ppm();
  }

  set fee_insurance_share_ppm(value: number) {
    this.set_fee_insurance_share_ppm(value);
  }

  get_liq_insurance_share_ppm(): number {
    const offset = 312;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_liq_insurance_share_ppm(value: number): void {
    const offset = 312;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get liq_insurance_share_ppm(): number {
    return this.get_liq_insurance_share_ppm();
  }

  set liq_insurance_share_ppm(value: number) {
    this.set_liq_insurance_share_ppm(value);
  }

  get_bankrupt_liq_reward_bps(): number {
    const offset = 316;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_bankrupt_liq_reward_bps(value: number): void {
    const offset = 316;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get bankrupt_liq_reward_bps(): number {
    return this.get_bankrupt_liq_reward_bps();
  }

  set bankrupt_liq_reward_bps(value: number) {
    this.set_bankrupt_liq_reward_bps(value);
  }

  get_reserved3(): number {
    const offset = 318;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved3(value: number): void {
    const offset = 318;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved3(): number {
    return this.get_reserved3();
  }

  set reserved3(value: number) {
    this.set_reserved3(value);
  }

  get_funding_index_lo(): bigint {
    const offset = 320;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_index_lo(value: bigint): void {
    const offset = 320;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_index_lo(): bigint {
    return this.get_funding_index_lo();
  }

  set funding_index_lo(value: bigint) {
    this.set_funding_index_lo(value);
  }

  get_funding_index_hi(): bigint {
    const offset = 328;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_index_hi(value: bigint): void {
    const offset = 328;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_index_hi(): bigint {
    return this.get_funding_index_hi();
  }

  set funding_index_hi(value: bigint) {
    this.set_funding_index_hi(value);
  }

  get_funding_balance(): bigint {
    const offset = 336;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_funding_balance(value: bigint): void {
    const offset = 336;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get funding_balance(): bigint {
    return this.get_funding_balance();
  }

  set funding_balance(value: bigint) {
    this.set_funding_balance(value);
  }

  get_funding_last_round_ns(): bigint {
    const offset = 344;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_last_round_ns(value: bigint): void {
    const offset = 344;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_last_round_ns(): bigint {
    return this.get_funding_last_round_ns();
  }

  set funding_last_round_ns(value: bigint) {
    this.set_funding_last_round_ns(value);
  }

  get_funding_last_sample_ns(): bigint {
    const offset = 352;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_last_sample_ns(value: bigint): void {
    const offset = 352;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_last_sample_ns(): bigint {
    return this.get_funding_last_sample_ns();
  }

  set funding_last_sample_ns(value: bigint) {
    this.set_funding_last_sample_ns(value);
  }

  get_funding_premium_sum(): bigint {
    const offset = 360;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_funding_premium_sum(value: bigint): void {
    const offset = 360;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get funding_premium_sum(): bigint {
    return this.get_funding_premium_sum();
  }

  set funding_premium_sum(value: bigint) {
    this.set_funding_premium_sum(value);
  }

  get_funding_impact_notional(): bigint {
    const offset = 368;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_impact_notional(value: bigint): void {
    const offset = 368;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_impact_notional(): bigint {
    return this.get_funding_impact_notional();
  }

  set funding_impact_notional(value: bigint) {
    this.set_funding_impact_notional(value);
  }

  get_funding_rate(): bigint {
    const offset = 376;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_funding_rate(value: bigint): void {
    const offset = 376;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get funding_rate(): bigint {
    return this.get_funding_rate();
  }

  set funding_rate(value: bigint) {
    this.set_funding_rate(value);
  }

  get_funding_interest_rate(): number {
    const offset = 384;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_interest_rate(value: number): void {
    const offset = 384;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_interest_rate(): number {
    return this.get_funding_interest_rate();
  }

  set funding_interest_rate(value: number) {
    this.set_funding_interest_rate(value);
  }

  get_funding_clamp_small(): number {
    const offset = 388;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_clamp_small(value: number): void {
    const offset = 388;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_clamp_small(): number {
    return this.get_funding_clamp_small();
  }

  set funding_clamp_small(value: number) {
    this.set_funding_clamp_small(value);
  }

  get_funding_clamp_big(): number {
    const offset = 392;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_clamp_big(value: number): void {
    const offset = 392;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_clamp_big(): number {
    return this.get_funding_clamp_big();
  }

  set funding_clamp_big(value: number) {
    this.set_funding_clamp_big(value);
  }

  get_funding_premium_multiplier(): number {
    const offset = 396;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_premium_multiplier(value: number): void {
    const offset = 396;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_premium_multiplier(): number {
    return this.get_funding_premium_multiplier();
  }

  set funding_premium_multiplier(value: number) {
    this.set_funding_premium_multiplier(value);
  }

  get_funding_sample_cnt(): number {
    const offset = 400;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_sample_cnt(value: number): void {
    const offset = 400;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_sample_cnt(): number {
    return this.get_funding_sample_cnt();
  }

  set funding_sample_cnt(value: number) {
    this.set_funding_sample_cnt(value);
  }

  get_cross_upnl_haircut_bps(): number {
    const offset = 404;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_cross_upnl_haircut_bps(value: number): void {
    const offset = 404;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get cross_upnl_haircut_bps(): number {
    return this.get_cross_upnl_haircut_bps();
  }

  set cross_upnl_haircut_bps(value: number) {
    this.set_cross_upnl_haircut_bps(value);
  }

  get_fee_balance(): bigint {
    const offset = 408;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_fee_balance(value: bigint): void {
    const offset = 408;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get fee_balance(): bigint {
    return this.get_fee_balance();
  }

  set fee_balance(value: bigint) {
    this.set_fee_balance(value);
  }

  get_insurance_balance(): bigint {
    const offset = 416;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_insurance_balance(value: bigint): void {
    const offset = 416;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get insurance_balance(): bigint {
    return this.get_insurance_balance();
  }

  set insurance_balance(value: bigint) {
    this.set_insurance_balance(value);
  }

  get_epoch_if_drawn(): bigint {
    const offset = 424;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_epoch_if_drawn(value: bigint): void {
    const offset = 424;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get epoch_if_drawn(): bigint {
    return this.get_epoch_if_drawn();
  }

  set epoch_if_drawn(value: bigint) {
    this.set_epoch_if_drawn(value);
  }

  get_epoch_soc_ticks(): bigint {
    const offset = 432;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_epoch_soc_ticks(value: bigint): void {
    const offset = 432;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get epoch_soc_ticks(): bigint {
    return this.get_epoch_soc_ticks();
  }

  set epoch_soc_ticks(value: bigint) {
    this.set_epoch_soc_ticks(value);
  }

  get_bad_debt_both(): bigint {
    const offset = 440;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_bad_debt_both(value: bigint): void {
    const offset = 440;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get bad_debt_both(): bigint {
    return this.get_bad_debt_both();
  }

  set bad_debt_both(value: bigint) {
    this.set_bad_debt_both(value);
  }

  get_loss_offset_long_lo(): bigint {
    const offset = 448;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_long_lo(value: bigint): void {
    const offset = 448;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_long_lo(): bigint {
    return this.get_loss_offset_long_lo();
  }

  set loss_offset_long_lo(value: bigint) {
    this.set_loss_offset_long_lo(value);
  }

  get_loss_offset_long_hi(): bigint {
    const offset = 456;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_long_hi(value: bigint): void {
    const offset = 456;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_long_hi(): bigint {
    return this.get_loss_offset_long_hi();
  }

  set loss_offset_long_hi(value: bigint) {
    this.set_loss_offset_long_hi(value);
  }

  get_loss_offset_short_lo(): bigint {
    const offset = 464;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_short_lo(value: bigint): void {
    const offset = 464;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_short_lo(): bigint {
    return this.get_loss_offset_short_lo();
  }

  set loss_offset_short_lo(value: bigint) {
    this.set_loss_offset_short_lo(value);
  }

  get_loss_offset_short_hi(): bigint {
    const offset = 472;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_short_hi(value: bigint): void {
    const offset = 472;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_short_hi(): bigint {
    return this.get_loss_offset_short_hi();
  }

  set loss_offset_short_hi(value: bigint) {
    this.set_loss_offset_short_hi(value);
  }

  get_epoch_id(): number {
    const offset = 480;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_epoch_id(value: number): void {
    const offset = 480;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get epoch_id(): number {
    return this.get_epoch_id();
  }

  set epoch_id(value: number) {
    this.set_epoch_id(value);
  }

  get_reserved5(): number {
    const offset = 484;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved5(value: number): void {
    const offset = 484;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved5(): number {
    return this.get_reserved5();
  }

  set reserved5(value: number) {
    this.set_reserved5(value);
  }

  get_pending_taker_fee_ppm(): number {
    const offset = 488;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_pending_taker_fee_ppm(value: number): void {
    const offset = 488;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get pending_taker_fee_ppm(): number {
    return this.get_pending_taker_fee_ppm();
  }

  set pending_taker_fee_ppm(value: number) {
    this.set_pending_taker_fee_ppm(value);
  }

  get_pending_builder_fee_cap_ppm(): number {
    const offset = 492;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_pending_builder_fee_cap_ppm(value: number): void {
    const offset = 492;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get pending_builder_fee_cap_ppm(): number {
    return this.get_pending_builder_fee_cap_ppm();
  }

  set pending_builder_fee_cap_ppm(value: number) {
    this.set_pending_builder_fee_cap_ppm(value);
  }

  get_pending_activation_ns(): bigint {
    const offset = 496;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_pending_activation_ns(value: bigint): void {
    const offset = 496;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get pending_activation_ns(): bigint {
    return this.get_pending_activation_ns();
  }

  set pending_activation_ns(value: bigint) {
    this.set_pending_activation_ns(value);
  }

  get_reserved6(): bigint {
    const offset = 504;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_reserved6(value: bigint): void {
    const offset = 504;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get reserved6(): bigint {
    return this.get_reserved6();
  }

  set reserved6(value: bigint) {
    this.set_reserved6(value);
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
    if (buffer.length < 512) return { ok: false, code: "tn.buffer_too_small", consumed: 512 };
    return { ok: true, consumed: 512 };
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
    this.buffer = new Uint8Array(512);
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

  set_exchange_status_flags(value: number): this {
    this.view.setUint8(2, value);
    return this;
  }

  set_risk_flags(value: number): this {
    this.view.setUint8(3, value);
    return this;
  }

  set_socialize_cap_bps(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_if_epoch_budget_bps(value: number): this {
    this.view.setUint16(6, value, true);
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

  set_price_cap(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    return this;
  }

  set_max_position_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
    return this;
  }

  set_open_interest_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(48, cast, true);
    return this;
  }

  set_bad_debt(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(56, cast, true);
    return this;
  }

  set_order_entry_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("order_entry_pubkey expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_bids_cbook_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("bids_cbook_pubkey expects 32 bytes");
    this.buffer.set(value, 96);
    return this;
  }

  set_asks_cbook_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("asks_cbook_pubkey expects 32 bytes");
    this.buffer.set(value, 128);
    return this;
  }

  set_quote_vault_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("quote_vault_pubkey expects 32 bytes");
    this.buffer.set(value, 160);
    return this;
  }

  set_market_authority_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market_authority_pubkey expects 32 bytes");
    this.buffer.set(value, 192);
    return this;
  }

  set_oracle_feed_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("oracle_feed_pubkey expects 32 bytes");
    this.buffer.set(value, 224);
    return this;
  }

  set_mark_num(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(256, cast, true);
    return this;
  }

  set_mark_den(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(264, cast, true);
    return this;
  }

  set_initial_margin_bps(value: number): this {
    this.view.setUint32(272, value, true);
    return this;
  }

  set_maintenance_margin_bps(value: number): this {
    this.view.setUint32(276, value, true);
    return this;
  }

  set_liquidation_fee_bps(value: number): this {
    this.view.setUint32(280, value, true);
    return this;
  }

  set_oracle_exponent(value: number): this {
    this.view.setInt32(284, value, true);
    return this;
  }

  set_max_mark_age_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(288, cast, true);
    return this;
  }

  set_taker_fee_ppm(value: number): this {
    this.view.setUint32(296, value, true);
    return this;
  }

  set_maker_rebate_ppm(value: number): this {
    this.view.setUint32(300, value, true);
    return this;
  }

  set_builder_fee_cap_ppm(value: number): this {
    this.view.setUint32(304, value, true);
    return this;
  }

  set_fee_insurance_share_ppm(value: number): this {
    this.view.setUint32(308, value, true);
    return this;
  }

  set_liq_insurance_share_ppm(value: number): this {
    this.view.setUint32(312, value, true);
    return this;
  }

  set_bankrupt_liq_reward_bps(value: number): this {
    this.view.setUint16(316, value, true);
    return this;
  }

  set_reserved3(value: number): this {
    this.view.setUint16(318, value, true);
    return this;
  }

  set_funding_index_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(320, cast, true);
    return this;
  }

  set_funding_index_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(328, cast, true);
    return this;
  }

  set_funding_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(336, cast, true);
    return this;
  }

  set_funding_last_round_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(344, cast, true);
    return this;
  }

  set_funding_last_sample_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(352, cast, true);
    return this;
  }

  set_funding_premium_sum(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(360, cast, true);
    return this;
  }

  set_funding_impact_notional(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(368, cast, true);
    return this;
  }

  set_funding_rate(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(376, cast, true);
    return this;
  }

  set_funding_interest_rate(value: number): this {
    this.view.setUint32(384, value, true);
    return this;
  }

  set_funding_clamp_small(value: number): this {
    this.view.setUint32(388, value, true);
    return this;
  }

  set_funding_clamp_big(value: number): this {
    this.view.setUint32(392, value, true);
    return this;
  }

  set_funding_premium_multiplier(value: number): this {
    this.view.setUint32(396, value, true);
    return this;
  }

  set_funding_sample_cnt(value: number): this {
    this.view.setUint32(400, value, true);
    return this;
  }

  set_cross_upnl_haircut_bps(value: number): this {
    this.view.setUint32(404, value, true);
    return this;
  }

  set_fee_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(408, cast, true);
    return this;
  }

  set_insurance_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(416, cast, true);
    return this;
  }

  set_epoch_if_drawn(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(424, cast, true);
    return this;
  }

  set_epoch_soc_ticks(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(432, cast, true);
    return this;
  }

  set_bad_debt_both(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(440, cast, true);
    return this;
  }

  set_loss_offset_long_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(448, cast, true);
    return this;
  }

  set_loss_offset_long_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(456, cast, true);
    return this;
  }

  set_loss_offset_short_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(464, cast, true);
    return this;
  }

  set_loss_offset_short_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(472, cast, true);
    return this;
  }

  set_epoch_id(value: number): this {
    this.view.setUint32(480, value, true);
    return this;
  }

  set_reserved5(value: number): this {
    this.view.setUint32(484, value, true);
    return this;
  }

  set_pending_taker_fee_ppm(value: number): this {
    this.view.setUint32(488, value, true);
    return this;
  }

  set_pending_builder_fee_cap_ppm(value: number): this {
    this.view.setUint32(492, value, true);
    return this;
  }

  set_pending_activation_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(496, cast, true);
    return this;
  }

  set_reserved6(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(504, cast, true);
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

/* ----- TYPE DEFINITION FOR MarketAccountPayload ----- */

const __tn_ir_MarketAccountPayload = {
  typeName: "MarketAccountPayload",
  root: { op: "const", value: 511n }
} as const;

export class MarketAccountPayload {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketAccountPayload {
    if (!buffer || buffer.length === undefined) throw new Error("MarketAccountPayload.__tnCreateView requires a Uint8Array");
    return new MarketAccountPayload(new Uint8Array(buffer));
  }

  static builder(): MarketAccountPayloadBuilder {
    return new MarketAccountPayloadBuilder();
  }

  static fromBuilder(builder: MarketAccountPayloadBuilder): MarketAccountPayload | null {
    const buffer = builder.build();
    return MarketAccountPayload.from_array(buffer);
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

  get_exchange_status_flags(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_exchange_status_flags(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get exchange_status_flags(): number {
    return this.get_exchange_status_flags();
  }

  set exchange_status_flags(value: number) {
    this.set_exchange_status_flags(value);
  }

  get_risk_flags(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_risk_flags(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get risk_flags(): number {
    return this.get_risk_flags();
  }

  set risk_flags(value: number) {
    this.set_risk_flags(value);
  }

  get_socialize_cap_bps(): number {
    const offset = 3;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_socialize_cap_bps(value: number): void {
    const offset = 3;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get socialize_cap_bps(): number {
    return this.get_socialize_cap_bps();
  }

  set socialize_cap_bps(value: number) {
    this.set_socialize_cap_bps(value);
  }

  get_if_epoch_budget_bps(): number {
    const offset = 5;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_if_epoch_budget_bps(value: number): void {
    const offset = 5;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get if_epoch_budget_bps(): number {
    return this.get_if_epoch_budget_bps();
  }

  set if_epoch_budget_bps(value: number) {
    this.set_if_epoch_budget_bps(value);
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

  get_next_order_id(): bigint {
    const offset = 23;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_next_order_id(value: bigint): void {
    const offset = 23;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get next_order_id(): bigint {
    return this.get_next_order_id();
  }

  set next_order_id(value: bigint) {
    this.set_next_order_id(value);
  }

  get_price_cap(): bigint {
    const offset = 31;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price_cap(value: bigint): void {
    const offset = 31;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price_cap(): bigint {
    return this.get_price_cap();
  }

  set price_cap(value: bigint) {
    this.set_price_cap(value);
  }

  get_max_position_lots(): bigint {
    const offset = 39;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_position_lots(value: bigint): void {
    const offset = 39;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_position_lots(): bigint {
    return this.get_max_position_lots();
  }

  set max_position_lots(value: bigint) {
    this.set_max_position_lots(value);
  }

  get_open_interest_lots(): bigint {
    const offset = 47;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_open_interest_lots(value: bigint): void {
    const offset = 47;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get open_interest_lots(): bigint {
    return this.get_open_interest_lots();
  }

  set open_interest_lots(value: bigint) {
    this.set_open_interest_lots(value);
  }

  get_bad_debt(): bigint {
    const offset = 55;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_bad_debt(value: bigint): void {
    const offset = 55;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get bad_debt(): bigint {
    return this.get_bad_debt();
  }

  set bad_debt(value: bigint) {
    this.set_bad_debt(value);
  }

  get_order_entry_pubkey(): Pubkey {
    const offset = 63;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_order_entry_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 63;
    this.buffer.set(sourceBytes, offset);
  }

  get order_entry_pubkey(): Pubkey {
    return this.get_order_entry_pubkey();
  }

  set order_entry_pubkey(value: Pubkey) {
    this.set_order_entry_pubkey(value);
  }

  get_bids_cbook_pubkey(): Pubkey {
    const offset = 95;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_bids_cbook_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 95;
    this.buffer.set(sourceBytes, offset);
  }

  get bids_cbook_pubkey(): Pubkey {
    return this.get_bids_cbook_pubkey();
  }

  set bids_cbook_pubkey(value: Pubkey) {
    this.set_bids_cbook_pubkey(value);
  }

  get_asks_cbook_pubkey(): Pubkey {
    const offset = 127;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_asks_cbook_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 127;
    this.buffer.set(sourceBytes, offset);
  }

  get asks_cbook_pubkey(): Pubkey {
    return this.get_asks_cbook_pubkey();
  }

  set asks_cbook_pubkey(value: Pubkey) {
    this.set_asks_cbook_pubkey(value);
  }

  get_quote_vault_pubkey(): Pubkey {
    const offset = 159;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_quote_vault_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 159;
    this.buffer.set(sourceBytes, offset);
  }

  get quote_vault_pubkey(): Pubkey {
    return this.get_quote_vault_pubkey();
  }

  set quote_vault_pubkey(value: Pubkey) {
    this.set_quote_vault_pubkey(value);
  }

  get_market_authority_pubkey(): Pubkey {
    const offset = 191;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market_authority_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 191;
    this.buffer.set(sourceBytes, offset);
  }

  get market_authority_pubkey(): Pubkey {
    return this.get_market_authority_pubkey();
  }

  set market_authority_pubkey(value: Pubkey) {
    this.set_market_authority_pubkey(value);
  }

  get_oracle_feed_pubkey(): Pubkey {
    const offset = 223;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_oracle_feed_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 223;
    this.buffer.set(sourceBytes, offset);
  }

  get oracle_feed_pubkey(): Pubkey {
    return this.get_oracle_feed_pubkey();
  }

  set oracle_feed_pubkey(value: Pubkey) {
    this.set_oracle_feed_pubkey(value);
  }

  get_mark_num(): bigint {
    const offset = 255;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_num(value: bigint): void {
    const offset = 255;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_num(): bigint {
    return this.get_mark_num();
  }

  set mark_num(value: bigint) {
    this.set_mark_num(value);
  }

  get_mark_den(): bigint {
    const offset = 263;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_mark_den(value: bigint): void {
    const offset = 263;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get mark_den(): bigint {
    return this.get_mark_den();
  }

  set mark_den(value: bigint) {
    this.set_mark_den(value);
  }

  get_initial_margin_bps(): number {
    const offset = 271;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_initial_margin_bps(value: number): void {
    const offset = 271;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get initial_margin_bps(): number {
    return this.get_initial_margin_bps();
  }

  set initial_margin_bps(value: number) {
    this.set_initial_margin_bps(value);
  }

  get_maintenance_margin_bps(): number {
    const offset = 275;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_maintenance_margin_bps(value: number): void {
    const offset = 275;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get maintenance_margin_bps(): number {
    return this.get_maintenance_margin_bps();
  }

  set maintenance_margin_bps(value: number) {
    this.set_maintenance_margin_bps(value);
  }

  get_liquidation_fee_bps(): number {
    const offset = 279;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_liquidation_fee_bps(value: number): void {
    const offset = 279;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get liquidation_fee_bps(): number {
    return this.get_liquidation_fee_bps();
  }

  set liquidation_fee_bps(value: number) {
    this.set_liquidation_fee_bps(value);
  }

  get_oracle_exponent(): number {
    const offset = 283;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_oracle_exponent(value: number): void {
    const offset = 283;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get oracle_exponent(): number {
    return this.get_oracle_exponent();
  }

  set oracle_exponent(value: number) {
    this.set_oracle_exponent(value);
  }

  get_max_mark_age_ns(): bigint {
    const offset = 287;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_mark_age_ns(value: bigint): void {
    const offset = 287;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_mark_age_ns(): bigint {
    return this.get_max_mark_age_ns();
  }

  set max_mark_age_ns(value: bigint) {
    this.set_max_mark_age_ns(value);
  }

  get_taker_fee_ppm(): number {
    const offset = 295;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_taker_fee_ppm(value: number): void {
    const offset = 295;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get taker_fee_ppm(): number {
    return this.get_taker_fee_ppm();
  }

  set taker_fee_ppm(value: number) {
    this.set_taker_fee_ppm(value);
  }

  get_maker_rebate_ppm(): number {
    const offset = 299;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_maker_rebate_ppm(value: number): void {
    const offset = 299;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get maker_rebate_ppm(): number {
    return this.get_maker_rebate_ppm();
  }

  set maker_rebate_ppm(value: number) {
    this.set_maker_rebate_ppm(value);
  }

  get_builder_fee_cap_ppm(): number {
    const offset = 303;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_builder_fee_cap_ppm(value: number): void {
    const offset = 303;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get builder_fee_cap_ppm(): number {
    return this.get_builder_fee_cap_ppm();
  }

  set builder_fee_cap_ppm(value: number) {
    this.set_builder_fee_cap_ppm(value);
  }

  get_fee_insurance_share_ppm(): number {
    const offset = 307;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_fee_insurance_share_ppm(value: number): void {
    const offset = 307;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get fee_insurance_share_ppm(): number {
    return this.get_fee_insurance_share_ppm();
  }

  set fee_insurance_share_ppm(value: number) {
    this.set_fee_insurance_share_ppm(value);
  }

  get_liq_insurance_share_ppm(): number {
    const offset = 311;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_liq_insurance_share_ppm(value: number): void {
    const offset = 311;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get liq_insurance_share_ppm(): number {
    return this.get_liq_insurance_share_ppm();
  }

  set liq_insurance_share_ppm(value: number) {
    this.set_liq_insurance_share_ppm(value);
  }

  get_bankrupt_liq_reward_bps(): number {
    const offset = 315;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_bankrupt_liq_reward_bps(value: number): void {
    const offset = 315;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get bankrupt_liq_reward_bps(): number {
    return this.get_bankrupt_liq_reward_bps();
  }

  set bankrupt_liq_reward_bps(value: number) {
    this.set_bankrupt_liq_reward_bps(value);
  }

  get_reserved3(): number {
    const offset = 317;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_reserved3(value: number): void {
    const offset = 317;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get reserved3(): number {
    return this.get_reserved3();
  }

  set reserved3(value: number) {
    this.set_reserved3(value);
  }

  get_funding_index_lo(): bigint {
    const offset = 319;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_index_lo(value: bigint): void {
    const offset = 319;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_index_lo(): bigint {
    return this.get_funding_index_lo();
  }

  set funding_index_lo(value: bigint) {
    this.set_funding_index_lo(value);
  }

  get_funding_index_hi(): bigint {
    const offset = 327;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_index_hi(value: bigint): void {
    const offset = 327;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_index_hi(): bigint {
    return this.get_funding_index_hi();
  }

  set funding_index_hi(value: bigint) {
    this.set_funding_index_hi(value);
  }

  get_funding_balance(): bigint {
    const offset = 335;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_funding_balance(value: bigint): void {
    const offset = 335;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get funding_balance(): bigint {
    return this.get_funding_balance();
  }

  set funding_balance(value: bigint) {
    this.set_funding_balance(value);
  }

  get_funding_last_round_ns(): bigint {
    const offset = 343;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_last_round_ns(value: bigint): void {
    const offset = 343;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_last_round_ns(): bigint {
    return this.get_funding_last_round_ns();
  }

  set funding_last_round_ns(value: bigint) {
    this.set_funding_last_round_ns(value);
  }

  get_funding_last_sample_ns(): bigint {
    const offset = 351;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_last_sample_ns(value: bigint): void {
    const offset = 351;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_last_sample_ns(): bigint {
    return this.get_funding_last_sample_ns();
  }

  set funding_last_sample_ns(value: bigint) {
    this.set_funding_last_sample_ns(value);
  }

  get_funding_premium_sum(): bigint {
    const offset = 359;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_funding_premium_sum(value: bigint): void {
    const offset = 359;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get funding_premium_sum(): bigint {
    return this.get_funding_premium_sum();
  }

  set funding_premium_sum(value: bigint) {
    this.set_funding_premium_sum(value);
  }

  get_funding_impact_notional(): bigint {
    const offset = 367;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_funding_impact_notional(value: bigint): void {
    const offset = 367;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get funding_impact_notional(): bigint {
    return this.get_funding_impact_notional();
  }

  set funding_impact_notional(value: bigint) {
    this.set_funding_impact_notional(value);
  }

  get_funding_rate(): bigint {
    const offset = 375;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_funding_rate(value: bigint): void {
    const offset = 375;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get funding_rate(): bigint {
    return this.get_funding_rate();
  }

  set funding_rate(value: bigint) {
    this.set_funding_rate(value);
  }

  get_funding_interest_rate(): number {
    const offset = 383;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_interest_rate(value: number): void {
    const offset = 383;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_interest_rate(): number {
    return this.get_funding_interest_rate();
  }

  set funding_interest_rate(value: number) {
    this.set_funding_interest_rate(value);
  }

  get_funding_clamp_small(): number {
    const offset = 387;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_clamp_small(value: number): void {
    const offset = 387;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_clamp_small(): number {
    return this.get_funding_clamp_small();
  }

  set funding_clamp_small(value: number) {
    this.set_funding_clamp_small(value);
  }

  get_funding_clamp_big(): number {
    const offset = 391;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_clamp_big(value: number): void {
    const offset = 391;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_clamp_big(): number {
    return this.get_funding_clamp_big();
  }

  set funding_clamp_big(value: number) {
    this.set_funding_clamp_big(value);
  }

  get_funding_premium_multiplier(): number {
    const offset = 395;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_premium_multiplier(value: number): void {
    const offset = 395;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_premium_multiplier(): number {
    return this.get_funding_premium_multiplier();
  }

  set funding_premium_multiplier(value: number) {
    this.set_funding_premium_multiplier(value);
  }

  get_funding_sample_cnt(): number {
    const offset = 399;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_funding_sample_cnt(value: number): void {
    const offset = 399;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get funding_sample_cnt(): number {
    return this.get_funding_sample_cnt();
  }

  set funding_sample_cnt(value: number) {
    this.set_funding_sample_cnt(value);
  }

  get_cross_upnl_haircut_bps(): number {
    const offset = 403;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_cross_upnl_haircut_bps(value: number): void {
    const offset = 403;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get cross_upnl_haircut_bps(): number {
    return this.get_cross_upnl_haircut_bps();
  }

  set cross_upnl_haircut_bps(value: number) {
    this.set_cross_upnl_haircut_bps(value);
  }

  get_fee_balance(): bigint {
    const offset = 407;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_fee_balance(value: bigint): void {
    const offset = 407;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get fee_balance(): bigint {
    return this.get_fee_balance();
  }

  set fee_balance(value: bigint) {
    this.set_fee_balance(value);
  }

  get_insurance_balance(): bigint {
    const offset = 415;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_insurance_balance(value: bigint): void {
    const offset = 415;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get insurance_balance(): bigint {
    return this.get_insurance_balance();
  }

  set insurance_balance(value: bigint) {
    this.set_insurance_balance(value);
  }

  get_epoch_if_drawn(): bigint {
    const offset = 423;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_epoch_if_drawn(value: bigint): void {
    const offset = 423;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get epoch_if_drawn(): bigint {
    return this.get_epoch_if_drawn();
  }

  set epoch_if_drawn(value: bigint) {
    this.set_epoch_if_drawn(value);
  }

  get_epoch_soc_ticks(): bigint {
    const offset = 431;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_epoch_soc_ticks(value: bigint): void {
    const offset = 431;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get epoch_soc_ticks(): bigint {
    return this.get_epoch_soc_ticks();
  }

  set epoch_soc_ticks(value: bigint) {
    this.set_epoch_soc_ticks(value);
  }

  get_bad_debt_both(): bigint {
    const offset = 439;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_bad_debt_both(value: bigint): void {
    const offset = 439;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get bad_debt_both(): bigint {
    return this.get_bad_debt_both();
  }

  set bad_debt_both(value: bigint) {
    this.set_bad_debt_both(value);
  }

  get_loss_offset_long_lo(): bigint {
    const offset = 447;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_long_lo(value: bigint): void {
    const offset = 447;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_long_lo(): bigint {
    return this.get_loss_offset_long_lo();
  }

  set loss_offset_long_lo(value: bigint) {
    this.set_loss_offset_long_lo(value);
  }

  get_loss_offset_long_hi(): bigint {
    const offset = 455;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_long_hi(value: bigint): void {
    const offset = 455;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_long_hi(): bigint {
    return this.get_loss_offset_long_hi();
  }

  set loss_offset_long_hi(value: bigint) {
    this.set_loss_offset_long_hi(value);
  }

  get_loss_offset_short_lo(): bigint {
    const offset = 463;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_short_lo(value: bigint): void {
    const offset = 463;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_short_lo(): bigint {
    return this.get_loss_offset_short_lo();
  }

  set loss_offset_short_lo(value: bigint) {
    this.set_loss_offset_short_lo(value);
  }

  get_loss_offset_short_hi(): bigint {
    const offset = 471;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_loss_offset_short_hi(value: bigint): void {
    const offset = 471;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get loss_offset_short_hi(): bigint {
    return this.get_loss_offset_short_hi();
  }

  set loss_offset_short_hi(value: bigint) {
    this.set_loss_offset_short_hi(value);
  }

  get_epoch_id(): number {
    const offset = 479;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_epoch_id(value: number): void {
    const offset = 479;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get epoch_id(): number {
    return this.get_epoch_id();
  }

  set epoch_id(value: number) {
    this.set_epoch_id(value);
  }

  get_reserved5(): number {
    const offset = 483;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved5(value: number): void {
    const offset = 483;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved5(): number {
    return this.get_reserved5();
  }

  set reserved5(value: number) {
    this.set_reserved5(value);
  }

  get_pending_taker_fee_ppm(): number {
    const offset = 487;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_pending_taker_fee_ppm(value: number): void {
    const offset = 487;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get pending_taker_fee_ppm(): number {
    return this.get_pending_taker_fee_ppm();
  }

  set pending_taker_fee_ppm(value: number) {
    this.set_pending_taker_fee_ppm(value);
  }

  get_pending_builder_fee_cap_ppm(): number {
    const offset = 491;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_pending_builder_fee_cap_ppm(value: number): void {
    const offset = 491;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get pending_builder_fee_cap_ppm(): number {
    return this.get_pending_builder_fee_cap_ppm();
  }

  set pending_builder_fee_cap_ppm(value: number) {
    this.set_pending_builder_fee_cap_ppm(value);
  }

  get_pending_activation_ns(): bigint {
    const offset = 495;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_pending_activation_ns(value: bigint): void {
    const offset = 495;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get pending_activation_ns(): bigint {
    return this.get_pending_activation_ns();
  }

  set pending_activation_ns(value: bigint) {
    this.set_pending_activation_ns(value);
  }

  get_reserved6(): bigint {
    const offset = 503;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_reserved6(value: bigint): void {
    const offset = 503;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get reserved6(): bigint {
    return this.get_reserved6();
  }

  set reserved6(value: bigint) {
    this.set_reserved6(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketAccountPayload.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketAccountPayload, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketAccountPayload');
    }
    return __tnBigIntToNumber(irResult, 'MarketAccountPayload::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 511) return { ok: false, code: "tn.buffer_too_small", consumed: 511 };
    return { ok: true, consumed: 511 };
  }

  static from_array(buffer: Uint8Array): MarketAccountPayload | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketAccountPayload(buffer);
  }

}

export class MarketAccountPayloadBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(511);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_status_flags(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_exchange_status_flags(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_risk_flags(value: number): this {
    this.view.setUint8(2, value);
    return this;
  }

  set_socialize_cap_bps(value: number): this {
    this.view.setUint16(3, value, true);
    return this;
  }

  set_if_epoch_budget_bps(value: number): this {
    this.view.setUint16(5, value, true);
    return this;
  }

  set_lot_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(7, cast, true);
    return this;
  }

  set_tick_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(15, cast, true);
    return this;
  }

  set_next_order_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(23, cast, true);
    return this;
  }

  set_price_cap(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(31, cast, true);
    return this;
  }

  set_max_position_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(39, cast, true);
    return this;
  }

  set_open_interest_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(47, cast, true);
    return this;
  }

  set_bad_debt(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(55, cast, true);
    return this;
  }

  set_order_entry_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("order_entry_pubkey expects 32 bytes");
    this.buffer.set(value, 63);
    return this;
  }

  set_bids_cbook_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("bids_cbook_pubkey expects 32 bytes");
    this.buffer.set(value, 95);
    return this;
  }

  set_asks_cbook_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("asks_cbook_pubkey expects 32 bytes");
    this.buffer.set(value, 127);
    return this;
  }

  set_quote_vault_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("quote_vault_pubkey expects 32 bytes");
    this.buffer.set(value, 159);
    return this;
  }

  set_market_authority_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market_authority_pubkey expects 32 bytes");
    this.buffer.set(value, 191);
    return this;
  }

  set_oracle_feed_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("oracle_feed_pubkey expects 32 bytes");
    this.buffer.set(value, 223);
    return this;
  }

  set_mark_num(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(255, cast, true);
    return this;
  }

  set_mark_den(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(263, cast, true);
    return this;
  }

  set_initial_margin_bps(value: number): this {
    this.view.setUint32(271, value, true);
    return this;
  }

  set_maintenance_margin_bps(value: number): this {
    this.view.setUint32(275, value, true);
    return this;
  }

  set_liquidation_fee_bps(value: number): this {
    this.view.setUint32(279, value, true);
    return this;
  }

  set_oracle_exponent(value: number): this {
    this.view.setInt32(283, value, true);
    return this;
  }

  set_max_mark_age_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(287, cast, true);
    return this;
  }

  set_taker_fee_ppm(value: number): this {
    this.view.setUint32(295, value, true);
    return this;
  }

  set_maker_rebate_ppm(value: number): this {
    this.view.setUint32(299, value, true);
    return this;
  }

  set_builder_fee_cap_ppm(value: number): this {
    this.view.setUint32(303, value, true);
    return this;
  }

  set_fee_insurance_share_ppm(value: number): this {
    this.view.setUint32(307, value, true);
    return this;
  }

  set_liq_insurance_share_ppm(value: number): this {
    this.view.setUint32(311, value, true);
    return this;
  }

  set_bankrupt_liq_reward_bps(value: number): this {
    this.view.setUint16(315, value, true);
    return this;
  }

  set_reserved3(value: number): this {
    this.view.setUint16(317, value, true);
    return this;
  }

  set_funding_index_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(319, cast, true);
    return this;
  }

  set_funding_index_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(327, cast, true);
    return this;
  }

  set_funding_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(335, cast, true);
    return this;
  }

  set_funding_last_round_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(343, cast, true);
    return this;
  }

  set_funding_last_sample_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(351, cast, true);
    return this;
  }

  set_funding_premium_sum(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(359, cast, true);
    return this;
  }

  set_funding_impact_notional(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(367, cast, true);
    return this;
  }

  set_funding_rate(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(375, cast, true);
    return this;
  }

  set_funding_interest_rate(value: number): this {
    this.view.setUint32(383, value, true);
    return this;
  }

  set_funding_clamp_small(value: number): this {
    this.view.setUint32(387, value, true);
    return this;
  }

  set_funding_clamp_big(value: number): this {
    this.view.setUint32(391, value, true);
    return this;
  }

  set_funding_premium_multiplier(value: number): this {
    this.view.setUint32(395, value, true);
    return this;
  }

  set_funding_sample_cnt(value: number): this {
    this.view.setUint32(399, value, true);
    return this;
  }

  set_cross_upnl_haircut_bps(value: number): this {
    this.view.setUint32(403, value, true);
    return this;
  }

  set_fee_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(407, cast, true);
    return this;
  }

  set_insurance_balance(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(415, cast, true);
    return this;
  }

  set_epoch_if_drawn(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(423, cast, true);
    return this;
  }

  set_epoch_soc_ticks(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(431, cast, true);
    return this;
  }

  set_bad_debt_both(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(439, cast, true);
    return this;
  }

  set_loss_offset_long_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(447, cast, true);
    return this;
  }

  set_loss_offset_long_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(455, cast, true);
    return this;
  }

  set_loss_offset_short_lo(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(463, cast, true);
    return this;
  }

  set_loss_offset_short_hi(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(471, cast, true);
    return this;
  }

  set_epoch_id(value: number): this {
    this.view.setUint32(479, value, true);
    return this;
  }

  set_reserved5(value: number): this {
    this.view.setUint32(483, value, true);
    return this;
  }

  set_pending_taker_fee_ppm(value: number): this {
    this.view.setUint32(487, value, true);
    return this;
  }

  set_pending_builder_fee_cap_ppm(value: number): this {
    this.view.setUint32(491, value, true);
    return this;
  }

  set_pending_activation_ns(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(495, cast, true);
    return this;
  }

  set_reserved6(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(503, cast, true);
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

  finish(): MarketAccountPayload {
    const view = MarketAccountPayload.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketAccountPayload");
    return view;
  }
}

__tnRegisterFootprint("MarketAccountPayload", (params) => MarketAccountPayload.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketAccountPayload", (buffer, params) => MarketAccountPayload.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketAccountPayload", (buffer) => { const result = MarketAccountPayload.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketCreatedEvent ----- */

const __tn_ir_MarketCreatedEvent = {
  typeName: "MarketCreatedEvent",
  root: { op: "const", value: 256n }
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

  get_price_cap(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_price_cap(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get price_cap(): bigint {
    return this.get_price_cap();
  }

  set price_cap(value: bigint) {
    this.set_price_cap(value);
  }

  get_max_position_lots(): bigint {
    const offset = 24;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_position_lots(value: bigint): void {
    const offset = 24;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_position_lots(): bigint {
    return this.get_max_position_lots();
  }

  set max_position_lots(value: bigint) {
    this.set_max_position_lots(value);
  }

  get_quote_mint(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_quote_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get quote_mint(): Pubkey {
    return this.get_quote_mint();
  }

  set quote_mint(value: Pubkey) {
    this.set_quote_mint(value);
  }

  get_market_authority(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get market_authority(): Pubkey {
    return this.get_market_authority();
  }

  set market_authority(value: Pubkey) {
    this.set_market_authority(value);
  }

  get_market(): Pubkey {
    const offset = 96;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 96;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_order_arena(): Pubkey {
    const offset = 128;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_order_arena(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 128;
    this.buffer.set(sourceBytes, offset);
  }

  get order_arena(): Pubkey {
    return this.get_order_arena();
  }

  set order_arena(value: Pubkey) {
    this.set_order_arena(value);
  }

  get_bids_cbook(): Pubkey {
    const offset = 160;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_bids_cbook(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 160;
    this.buffer.set(sourceBytes, offset);
  }

  get bids_cbook(): Pubkey {
    return this.get_bids_cbook();
  }

  set bids_cbook(value: Pubkey) {
    this.set_bids_cbook(value);
  }

  get_asks_cbook(): Pubkey {
    const offset = 192;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_asks_cbook(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 192;
    this.buffer.set(sourceBytes, offset);
  }

  get asks_cbook(): Pubkey {
    return this.get_asks_cbook();
  }

  set asks_cbook(value: Pubkey) {
    this.set_asks_cbook(value);
  }

  get_quote_vault(): Pubkey {
    const offset = 224;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_quote_vault(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 224;
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
    if (buffer.length < 256) return { ok: false, code: "tn.buffer_too_small", consumed: 256 };
    return { ok: true, consumed: 256 };
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
    this.buffer = new Uint8Array(256);
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

  set_price_cap(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
    return this;
  }

  set_max_position_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(24, cast, true);
    return this;
  }

  set_quote_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("quote_mint expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_market_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market_authority expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 96);
    return this;
  }

  set_order_arena(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("order_arena expects 32 bytes");
    this.buffer.set(value, 128);
    return this;
  }

  set_bids_cbook(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("bids_cbook expects 32 bytes");
    this.buffer.set(value, 160);
    return this;
  }

  set_asks_cbook(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("asks_cbook expects 32 bytes");
    this.buffer.set(value, 192);
    return this;
  }

  set_quote_vault(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("quote_vault expects 32 bytes");
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

  finish(): MarketCreatedEvent {
    const view = MarketCreatedEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketCreatedEvent");
    return view;
  }
}

__tnRegisterFootprint("MarketCreatedEvent", (params) => MarketCreatedEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketCreatedEvent", (buffer, params) => MarketCreatedEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketCreatedEvent", (buffer) => { const result = MarketCreatedEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarketExchangeStatusEvent ----- */

const __tn_ir_MarketExchangeStatusEvent = {
  typeName: "MarketExchangeStatusEvent",
  root: { op: "const", value: 72n }
} as const;

export class MarketExchangeStatusEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarketExchangeStatusEvent {
    if (!buffer || buffer.length === undefined) throw new Error("MarketExchangeStatusEvent.__tnCreateView requires a Uint8Array");
    return new MarketExchangeStatusEvent(new Uint8Array(buffer));
  }

  static builder(): MarketExchangeStatusEventBuilder {
    return new MarketExchangeStatusEventBuilder();
  }

  static fromBuilder(builder: MarketExchangeStatusEventBuilder): MarketExchangeStatusEvent | null {
    const buffer = builder.build();
    return MarketExchangeStatusEvent.from_array(buffer);
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

  get_exchange_admin(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_exchange_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get exchange_admin(): Pubkey {
    return this.get_exchange_admin();
  }

  set exchange_admin(value: Pubkey) {
    this.set_exchange_admin(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarketExchangeStatusEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarketExchangeStatusEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarketExchangeStatusEvent');
    }
    return __tnBigIntToNumber(irResult, 'MarketExchangeStatusEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 72) return { ok: false, code: "tn.buffer_too_small", consumed: 72 };
    return { ok: true, consumed: 72 };
  }

  static from_array(buffer: Uint8Array): MarketExchangeStatusEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarketExchangeStatusEvent(buffer);
  }

}

export class MarketExchangeStatusEventBuilder {
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

  set_exchange_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("exchange_admin expects 32 bytes");
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

  finish(): MarketExchangeStatusEvent {
    const view = MarketExchangeStatusEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarketExchangeStatusEvent");
    return view;
  }
}

__tnRegisterFootprint("MarketExchangeStatusEvent", (params) => MarketExchangeStatusEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("MarketExchangeStatusEvent", (buffer, params) => MarketExchangeStatusEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarketExchangeStatusEvent", (buffer) => { const result = MarketExchangeStatusEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

  get_header(): OrderArenaHeader {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 64);
    return OrderArenaHeader.from_array(slice)!;
  }

  set_header(value: OrderArenaHeader): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get header(): OrderArenaHeader {
    return this.get_header();
  }

  set header(value: OrderArenaHeader) {
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
  root: { op: "const", value: 180n }
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

  get_taker_long_lots(): bigint {
    const offset = 52;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_taker_long_lots(value: bigint): void {
    const offset = 52;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get taker_long_lots(): bigint {
    return this.get_taker_long_lots();
  }

  set taker_long_lots(value: bigint) {
    this.set_taker_long_lots(value);
  }

  get_taker_short_lots(): bigint {
    const offset = 60;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_taker_short_lots(value: bigint): void {
    const offset = 60;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get taker_short_lots(): bigint {
    return this.get_taker_short_lots();
  }

  set taker_short_lots(value: bigint) {
    this.set_taker_short_lots(value);
  }

  get_maker_long_lots(): bigint {
    const offset = 68;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_maker_long_lots(value: bigint): void {
    const offset = 68;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get maker_long_lots(): bigint {
    return this.get_maker_long_lots();
  }

  set maker_long_lots(value: bigint) {
    this.set_maker_long_lots(value);
  }

  get_maker_short_lots(): bigint {
    const offset = 76;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_maker_short_lots(value: bigint): void {
    const offset = 76;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get maker_short_lots(): bigint {
    return this.get_maker_short_lots();
  }

  set maker_short_lots(value: bigint) {
    this.set_maker_short_lots(value);
  }

  get_market(): Pubkey {
    const offset = 84;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_market(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 84;
    this.buffer.set(sourceBytes, offset);
  }

  get market(): Pubkey {
    return this.get_market();
  }

  set market(value: Pubkey) {
    this.set_market(value);
  }

  get_taker_seat_authority(): Pubkey {
    const offset = 116;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_taker_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 116;
    this.buffer.set(sourceBytes, offset);
  }

  get taker_seat_authority(): Pubkey {
    return this.get_taker_seat_authority();
  }

  set taker_seat_authority(value: Pubkey) {
    this.set_taker_seat_authority(value);
  }

  get_maker_seat_authority(): Pubkey {
    const offset = 148;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_maker_seat_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 148;
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
    if (buffer.length < 180) return { ok: false, code: "tn.buffer_too_small", consumed: 180 };
    return { ok: true, consumed: 180 };
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
    this.buffer = new Uint8Array(180);
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

  set_taker_long_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(52, cast, true);
    return this;
  }

  set_taker_short_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(60, cast, true);
    return this;
  }

  set_maker_long_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(68, cast, true);
    return this;
  }

  set_maker_short_lots(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(76, cast, true);
    return this;
  }

  set_market(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("market expects 32 bytes");
    this.buffer.set(value, 84);
    return this;
  }

  set_taker_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("taker_seat_authority expects 32 bytes");
    this.buffer.set(value, 116);
    return this;
  }

  set_maker_seat_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("maker_seat_authority expects 32 bytes");
    this.buffer.set(value, 148);
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

/* ----- TYPE DEFINITION FOR PerpEvent ----- */

const __tn_ir_PerpEvent = {
  typeName: "PerpEvent",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 8, node: { op: "const", value: 8n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "PerpEvent::payload.event_type", cases: [{ value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 68n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 104n } } }, { value: 3, node: { op: "align", alignment: 1, node: { op: "const", value: 256n } } }, { value: 4, node: { op: "align", alignment: 1, node: { op: "const", value: 180n } } }, { value: 5, node: { op: "align", alignment: 1, node: { op: "const", value: 112n } } }, { value: 6, node: { op: "align", alignment: 1, node: { op: "const", value: 112n } } }, { value: 7, node: { op: "align", alignment: 1, node: { op: "const", value: 120n } } }, { value: 8, node: { op: "align", alignment: 1, node: { op: "const", value: 168n } } }, { value: 9, node: { op: "align", alignment: 1, node: { op: "const", value: 168n } } }, { value: 10, node: { op: "align", alignment: 1, node: { op: "const", value: 72n } } }, { value: 11, node: { op: "align", alignment: 1, node: { op: "const", value: 104n } } }, { value: 12, node: { op: "align", alignment: 1, node: { op: "const", value: 72n } } }, { value: 13, node: { op: "align", alignment: 1, node: { op: "const", value: 136n } } }, { value: 14, node: { op: "align", alignment: 1, node: { op: "const", value: 72n } } }, { value: 15, node: { op: "align", alignment: 1, node: { op: "const", value: 160n } } }, { value: 16, node: { op: "align", alignment: 1, node: { op: "const", value: 88n } } }, { value: 17, node: { op: "align", alignment: 1, node: { op: "const", value: 152n } } }, { value: 18, node: { op: "align", alignment: 1, node: { op: "const", value: 176n } } }, { value: 19, node: { op: "align", alignment: 1, node: { op: "const", value: 120n } } }, { value: 20, node: { op: "align", alignment: 1, node: { op: "const", value: 56n } } }] } } } }
} as const;

export class PerpEvent_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): PerpEvent_payload_Inner {
    return new PerpEvent_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
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

  asExchangeInitialized(): ExchangeInitializedEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 11) return null;
    return ExchangeInitializedEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asExchangeStatus(): ExchangeStatusEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 12) return null;
    return ExchangeStatusEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asExchangeAdmin(): ExchangeAdminEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 13) return null;
    return ExchangeAdminEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketExchangeStatus(): MarketExchangeStatusEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 14) return null;
    return MarketExchangeStatusEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asLiquidation(): LiquidationEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 15) return null;
    return LiquidationEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFundingRound(): FundingRoundEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 16) return null;
    return FundingRoundEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMargin(): MarginEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 17) return null;
    return MarginEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFee(): FeeEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 18) return null;
    return FeeEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asLoss(): LossEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 19) return null;
    return LossEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInsurance(): InsuranceEvent | null {
    if (!this.descriptor || this.descriptor.tag !== 20) return null;
    return InsuranceEvent.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class PerpEvent {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 8;
  private __tnParams: PerpEvent.Params;

  private constructor(private buffer: Uint8Array, params?: PerpEvent.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = PerpEvent.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("PerpEvent: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: PerpEvent.Params, fieldContext?: Record<string, number | bigint> }): PerpEvent {
    if (!buffer || buffer.length === undefined) throw new Error("PerpEvent.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = PerpEvent.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("PerpEvent.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new PerpEvent(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): PerpEvent.Params {
    return this.__tnParams;
  }

  static builder(): PerpEventBuilder {
    return new PerpEventBuilder();
  }

  static fromBuilder(builder: PerpEventBuilder): PerpEvent | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return PerpEvent.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "seat_assigned",
      tag: 1,
      payloadSize: 68,
      payloadType: "PerpEvent::payload::seat_assigned",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SeatAssignedEvent),
    },
    {
      name: "order_cancelled",
      tag: 2,
      payloadSize: 104,
      payloadType: "PerpEvent::payload::order_cancelled",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderCancelledEvent),
    },
    {
      name: "market_created",
      tag: 3,
      payloadSize: 256,
      payloadType: "PerpEvent::payload::market_created",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketCreatedEvent),
    },
    {
      name: "order_filled",
      tag: 4,
      payloadSize: 180,
      payloadType: "PerpEvent::payload::order_filled",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderFilledEvent),
    },
    {
      name: "order_posted",
      tag: 5,
      payloadSize: 112,
      payloadType: "PerpEvent::payload::order_posted",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderPostedEvent),
    },
    {
      name: "order_entry_removed",
      tag: 6,
      payloadSize: 112,
      payloadType: "PerpEvent::payload::order_entry_removed",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderEntryRemovedEvent),
    },
    {
      name: "order_modified",
      tag: 7,
      payloadSize: 120,
      payloadType: "PerpEvent::payload::order_modified",
      createPayloadBuilder: () => __tnMaybeCallBuilder(OrderModifiedEvent),
    },
    {
      name: "token_deposit",
      tag: 8,
      payloadSize: 168,
      payloadType: "PerpEvent::payload::token_deposit",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenBalanceEvent),
    },
    {
      name: "token_withdraw",
      tag: 9,
      payloadSize: 168,
      payloadType: "PerpEvent::payload::token_withdraw",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenBalanceEvent),
    },
    {
      name: "market_status",
      tag: 10,
      payloadSize: 72,
      payloadType: "PerpEvent::payload::market_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketStatusEvent),
    },
    {
      name: "exchange_initialized",
      tag: 11,
      payloadSize: 104,
      payloadType: "PerpEvent::payload::exchange_initialized",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeInitializedEvent),
    },
    {
      name: "exchange_status",
      tag: 12,
      payloadSize: 72,
      payloadType: "PerpEvent::payload::exchange_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeStatusEvent),
    },
    {
      name: "exchange_admin",
      tag: 13,
      payloadSize: 136,
      payloadType: "PerpEvent::payload::exchange_admin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeAdminEvent),
    },
    {
      name: "market_exchange_status",
      tag: 14,
      payloadSize: 72,
      payloadType: "PerpEvent::payload::market_exchange_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketExchangeStatusEvent),
    },
    {
      name: "liquidation",
      tag: 15,
      payloadSize: 160,
      payloadType: "PerpEvent::payload::liquidation",
      createPayloadBuilder: () => __tnMaybeCallBuilder(LiquidationEvent),
    },
    {
      name: "funding_round",
      tag: 16,
      payloadSize: 88,
      payloadType: "PerpEvent::payload::funding_round",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FundingRoundEvent),
    },
    {
      name: "margin",
      tag: 17,
      payloadSize: 152,
      payloadType: "PerpEvent::payload::margin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarginEvent),
    },
    {
      name: "fee",
      tag: 18,
      payloadSize: 176,
      payloadType: "PerpEvent::payload::fee",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FeeEvent),
    },
    {
      name: "loss",
      tag: 19,
      payloadSize: 120,
      payloadType: "PerpEvent::payload::loss",
      createPayloadBuilder: () => __tnMaybeCallBuilder(LossEvent),
    },
    {
      name: "insurance",
      tag: 20,
      payloadSize: 56,
      payloadType: "PerpEvent::payload::insurance",
      createPayloadBuilder: () => __tnMaybeCallBuilder(InsuranceEvent),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: PerpEvent.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 8) {
      return null;
    }
    const __tnParam_payload_event_type = __tnToBigInt(view.getBigUint64(0, true));
    const __tnExtractedParams = PerpEvent.Params.fromValues({
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

  payloadVariant(): typeof PerpEvent.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return PerpEvent.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): PerpEvent_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("PerpEvent: unknown payload variant");
    const offset = PerpEvent.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("PerpEvent: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return PerpEvent_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PerpEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PerpEvent, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_event_type: number | bigint): bigint {
    const params = PerpEvent.Params.fromValues({
      payload_event_type: payload_event_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: PerpEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.event_type"] = params.payload_event_type;
    record["PerpEvent::payload.event_type"] = params.payload_event_type;
    return record;
  }

  static footprintIrFromParams(params: PerpEvent.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: PerpEvent.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PerpEvent');
    return __tnBigIntToNumber(irResult, 'PerpEvent::footprintFromParams');
  }

  static footprintFromValues(input: { payload_event_type: number | bigint }): number {
    const params = PerpEvent.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: PerpEvent.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: PerpEvent.Params }): { ok: boolean; code?: string; consumed?: number; params?: PerpEvent.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PerpEvent::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PerpEvent::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: PerpEvent.Params }): PerpEvent | null {
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
    const state = new PerpEvent(buffer, cached);
    return state;
  }


}

export namespace PerpEvent {
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

export class PerpEventBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_event_type: bigint | null = null;
  private __tnPayload_payload: { descriptor: typeof PerpEvent.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: PerpEvent.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: PerpEvent.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<PerpEventBuilder>;

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

  payload(): __TnVariantSelectorResult<PerpEventBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, PerpEvent.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_event_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("PerpEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 8 + payloadLength;
    const footprintSize = PerpEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("PerpEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 8 + payloadLength;
    const footprintSize = PerpEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("PerpEventBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): PerpEvent {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = PerpEvent.from_array(buffer, { params });
    if (!view) throw new Error("PerpEventBuilder: failed to finalize view");
    return view;
  }

  finishView(): PerpEvent {
    return this.finish();
  }

  dynamicParams(): PerpEvent.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): PerpEvent.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = PerpEvent.Params.fromValues({
      payload_event_type: (() => { if (this.__tnField_event_type === null) throw new Error("PerpEventBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_event_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_event_type === null) throw new Error("PerpEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpEventBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setBigUint64(0, __tnToBigInt(this.__tnField_event_type), true);
    target.set(this.__tnPayload_payload.bytes, 8);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: PerpEvent.Params): void {
    const result = PerpEvent.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ PerpEvent }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("PerpEvent", (params) => PerpEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("PerpEvent", (buffer, params) => PerpEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PerpEvent", (buffer) => { const result = PerpEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PerpInstruction ----- */

const __tn_ir_PerpInstruction = {
  typeName: "PerpInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class PerpInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): PerpInstruction_payload_Inner {
    return new PerpInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
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

  asExchangeInitialize(): ExchangeInitializeInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 11) return null;
    return ExchangeInitializeInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asExchangeSetStatus(): ExchangeSetStatusInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 12) return null;
    return ExchangeSetStatusInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asExchangeSetAdmin(): ExchangeSetAdminInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 13) return null;
    return ExchangeSetAdminInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asExchangeRecoverAdmin(): ExchangeRecoverAdminInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 14) return null;
    return ExchangeRecoverAdminInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetExchangeStatus(): MarketSetExchangeStatusInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 15) return null;
    return MarketSetExchangeStatusInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asLiquidate(): LiquidateInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 16) return null;
    return LiquidateInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetOracle(): MarketSetOracleInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 17) return null;
    return MarketSetOracleInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFundingUpdate(): FundingUpdateInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 18) return null;
    return FundingUpdateInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetFunding(): MarketSetFundingInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 19) return null;
    return MarketSetFundingInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSettleFunding(): SettleFundingInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 20) return null;
    return SettleFundingInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarginAccountCreate(): MarginAccountCreateInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 21) return null;
    return MarginAccountCreateInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarginRecord(): MarginRecordInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 22) return null;
    return MarginRecordInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarginLink(): MarginLinkInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 23) return null;
    return MarginLinkInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarginUnlink(): MarginLinkInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 24) return null;
    return MarginLinkInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarginTransfer(): MarginTransferInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 25) return null;
    return MarginTransferInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetVault(): MarketSetVaultInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 26) return null;
    return MarketSetVaultInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetCross(): MarketSetCrossInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 27) return null;
    return MarketSetCrossInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetFees(): MarketSetFeesInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 28) return null;
    return MarketSetFeesInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFeeClaim(): FeeClaimInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 29) return null;
    return FeeClaimInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInsuranceDeposit(): InsuranceDepositInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 30) return null;
    return InsuranceDepositInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSeatSetFeeReceiver(): SeatSetFeeReceiverInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 31) return null;
    return SeatSetFeeReceiverInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSeatSetBuilderApproval(): SeatSetBuilderApprovalInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 32) return null;
    return SeatSetBuilderApprovalInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asResolveBadDebt(): ResolveBadDebtInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 33) return null;
    return ResolveBadDebtInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarketSetRiskParams(): MarketSetRiskParamsInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 34) return null;
    return MarketSetRiskParamsInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class PerpInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: PerpInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: PerpInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = PerpInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("PerpInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: PerpInstruction.Params, fieldContext?: Record<string, number | bigint> }): PerpInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("PerpInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = PerpInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("PerpInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new PerpInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): PerpInstruction.Params {
    return this.__tnParams;
  }

  static builder(): PerpInstructionBuilder {
    return new PerpInstructionBuilder();
  }

  static fromBuilder(builder: PerpInstructionBuilder): PerpInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return PerpInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "market_record",
      tag: 0,
      payloadSize: 31,
      payloadType: "PerpInstruction::payload::market_record",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketRecordInstruction),
    },
    {
      name: "seat_create",
      tag: 1,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::seat_create",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SeatCreateInstruction),
    },
    {
      name: "token_deposit",
      tag: 2,
      payloadSize: 23,
      payloadType: "PerpInstruction::payload::token_deposit",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenTransferInstruction),
    },
    {
      name: "token_withdraw",
      tag: 3,
      payloadSize: 23,
      payloadType: "PerpInstruction::payload::token_withdraw",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TokenTransferInstruction),
    },
    {
      name: "create_order_entry",
      tag: 4,
      payloadSize: null,
      payloadType: "PerpInstruction::payload::create_order_entry",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateOrderEntryInstruction),
    },
    {
      name: "modify_order_entry",
      tag: 5,
      payloadSize: null,
      payloadType: "PerpInstruction::payload::modify_order_entry",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ModifyOrderEntryInstruction),
    },
    {
      name: "market_set_status",
      tag: 8,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::market_set_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetStatusInstruction),
    },
    {
      name: "market_create",
      tag: 9,
      payloadSize: null,
      payloadType: "PerpInstruction::payload::market_create",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketCreateInstruction),
    },
    {
      name: "exchange_initialize",
      tag: 11,
      payloadSize: null,
      payloadType: "PerpInstruction::payload::exchange_initialize",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeInitializeInstruction),
    },
    {
      name: "exchange_set_status",
      tag: 12,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::exchange_set_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeSetStatusInstruction),
    },
    {
      name: "exchange_set_admin",
      tag: 13,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::exchange_set_admin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeSetAdminInstruction),
    },
    {
      name: "exchange_recover_admin",
      tag: 14,
      payloadSize: 15,
      payloadType: "PerpInstruction::payload::exchange_recover_admin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeRecoverAdminInstruction),
    },
    {
      name: "market_set_exchange_status",
      tag: 15,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::market_set_exchange_status",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetExchangeStatusInstruction),
    },
    {
      name: "liquidate",
      tag: 16,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::liquidate",
      createPayloadBuilder: () => __tnMaybeCallBuilder(LiquidateInstruction),
    },
    {
      name: "market_set_oracle",
      tag: 17,
      payloadSize: 39,
      payloadType: "PerpInstruction::payload::market_set_oracle",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetOracleInstruction),
    },
    {
      name: "funding_update",
      tag: 18,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::funding_update",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FundingUpdateInstruction),
    },
    {
      name: "market_set_funding",
      tag: 19,
      payloadSize: 31,
      payloadType: "PerpInstruction::payload::market_set_funding",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetFundingInstruction),
    },
    {
      name: "settle_funding",
      tag: 20,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::settle_funding",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SettleFundingInstruction),
    },
    {
      name: "margin_account_create",
      tag: 21,
      payloadSize: null,
      payloadType: "PerpInstruction::payload::margin_account_create",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarginAccountCreateInstruction),
    },
    {
      name: "margin_record",
      tag: 22,
      payloadSize: null,
      payloadType: "PerpInstruction::payload::margin_record",
      createPayloadBuilder: () => null,
    },
    {
      name: "margin_link",
      tag: 23,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::margin_link",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarginLinkInstruction),
    },
    {
      name: "margin_unlink",
      tag: 24,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::margin_unlink",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarginLinkInstruction),
    },
    {
      name: "margin_transfer",
      tag: 25,
      payloadSize: 15,
      payloadType: "PerpInstruction::payload::margin_transfer",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarginTransferInstruction),
    },
    {
      name: "market_set_vault",
      tag: 26,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::market_set_vault",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetVaultInstruction),
    },
    {
      name: "market_set_cross",
      tag: 27,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::market_set_cross",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetCrossInstruction),
    },
    {
      name: "market_set_fees",
      tag: 28,
      payloadSize: 23,
      payloadType: "PerpInstruction::payload::market_set_fees",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetFeesInstruction),
    },
    {
      name: "fee_claim",
      tag: 29,
      payloadSize: 15,
      payloadType: "PerpInstruction::payload::fee_claim",
      createPayloadBuilder: () => __tnMaybeCallBuilder(FeeClaimInstruction),
    },
    {
      name: "insurance_deposit",
      tag: 30,
      payloadSize: 15,
      payloadType: "PerpInstruction::payload::insurance_deposit",
      createPayloadBuilder: () => __tnMaybeCallBuilder(InsuranceDepositInstruction),
    },
    {
      name: "seat_set_fee_receiver",
      tag: 31,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::seat_set_fee_receiver",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SeatSetFeeReceiverInstruction),
    },
    {
      name: "seat_set_builder_approval",
      tag: 32,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::seat_set_builder_approval",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SeatSetBuilderApprovalInstruction),
    },
    {
      name: "resolve_bad_debt",
      tag: 33,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::resolve_bad_debt",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ResolveBadDebtInstruction),
    },
    {
      name: "market_set_risk_params",
      tag: 34,
      payloadSize: 7,
      payloadType: "PerpInstruction::payload::market_set_risk_params",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketSetRiskParamsInstruction),
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
      case 11: break;
      case 12: break;
      case 13: break;
      case 14: break;
      case 15: break;
      case 16: break;
      case 17: break;
      case 18: break;
      case 19: break;
      case 20: break;
      case 21: break;
      case 22: break;
      case 23: break;
      case 24: break;
      case 25: break;
      case 26: break;
      case 27: break;
      case 28: break;
      case 29: break;
      case 30: break;
      case 31: break;
      case 32: break;
      case 33: break;
      case 34: break;
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: PerpInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_discriminant = __tnToBigInt(view.getUint8(0));
    const __tnLayout = PerpInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = PerpInstruction.Params.fromValues({
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

  payloadVariant(): typeof PerpInstruction.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return PerpInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): PerpInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("PerpInstruction: unknown payload variant");
    const offset = PerpInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("PerpInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return PerpInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PerpInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PerpInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_discriminant: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = PerpInstruction.Params.fromValues({
      payload_discriminant: payload_discriminant,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: PerpInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.discriminant"] = params.payload_discriminant;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: PerpInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: PerpInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PerpInstruction');
    return __tnBigIntToNumber(irResult, 'PerpInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_discriminant: number | bigint, payload_payload_size: number | bigint }): number {
    const params = PerpInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: PerpInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: PerpInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: PerpInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PerpInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PerpInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: PerpInstruction.Params }): PerpInstruction | null {
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
    const state = new PerpInstruction(buffer, cached);
    return state;
  }


}

export namespace PerpInstruction {
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

export class PerpInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_discriminant: number | null = null;
  private __tnPayload_payload: { descriptor: typeof PerpInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: PerpInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: PerpInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<PerpInstructionBuilder>;

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

  payload(): __TnVariantSelectorResult<PerpInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, PerpInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_discriminant(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("PerpInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PerpInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("PerpInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PerpInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("PerpInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): PerpInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = PerpInstruction.from_array(buffer, { params });
    if (!view) throw new Error("PerpInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): PerpInstruction {
    return this.finish();
  }

  dynamicParams(): PerpInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): PerpInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = PerpInstruction.Params.fromValues({
      payload_discriminant: (() => { if (this.__tnField_discriminant === null) throw new Error("PerpInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_discriminant); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("PerpInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_discriminant === null) throw new Error("PerpInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_discriminant);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: PerpInstruction.Params): void {
    const result = PerpInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ PerpInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("PerpInstruction", (params) => PerpInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("PerpInstruction", (buffer, params) => PerpInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PerpInstruction", (buffer) => { const result = PerpInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SeatArenaAccount ----- */

const __tn_ir_SeatArenaAccount = {
  typeName: "SeatArenaAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 512n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 128n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "div", left: { op: "sub", left: { op: "field", param: "__buffer_size" }, right: { op: "const", value: 640n } }, right: { op: "const", value: 128n } }, right: { op: "const", value: 128n } } } } }
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
    const slice = this.buffer.subarray(offset, offset + 512);
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

  get_header(): SeatArenaHeader {
    const offset = 512;
    const slice = this.buffer.subarray(offset, offset + 128);
    return SeatArenaHeader.from_array(slice)!;
  }

  set_header(value: SeatArenaHeader): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 512;
    this.buffer.set(sourceBytes, offset);
  }

  get header(): SeatArenaHeader {
    return this.get_header();
  }

  set header(value: SeatArenaHeader) {
    this.set_header(value);
  }

  get_entries_length(): number {
    return ((this.buffer.length - 640) / 128);
  }

  get_entries_at(index: number): SeatEntry {
    const offset = 640;
    const slice = this.buffer.subarray((offset + index * 128), (offset + (index + 1) * 128));
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
    const offset = 640;
    const slice = this.buffer.subarray(offset + index * 128, offset + (index + 1) * 128);
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

/* ----- TYPE DEFINITION FOR MarginAccount ----- */

const __tn_ir_MarginAccount = {
  typeName: "MarginAccount",
  root: { op: "const", value: 433n }
} as const;

export class MarginAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarginAccount {
    if (!buffer || buffer.length === undefined) throw new Error("MarginAccount.__tnCreateView requires a Uint8Array");
    return new MarginAccount(new Uint8Array(buffer));
  }

  static builder(): MarginAccountBuilder {
    return new MarginAccountBuilder();
  }

  static fromBuilder(builder: MarginAccountBuilder): MarginAccount | null {
    const buffer = builder.build();
    return MarginAccount.from_array(buffer);
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

  get_version(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_version(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get version(): number {
    return this.get_version();
  }

  set version(value: number) {
    this.set_version(value);
  }

  get_link_cnt(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_link_cnt(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get link_cnt(): number {
    return this.get_link_cnt();
  }

  set link_cnt(value: number) {
    this.set_link_cnt(value);
  }

  get_reserved0(): number[] {
    const offset = 3;
    const result: number[] = [];
    for (let i = 0; i < 5; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_reserved0(value: number[]): void {
    const offset = 3;
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

  get_account_id(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_account_id(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get account_id(): number {
    return this.get_account_id();
  }

  set account_id(value: number) {
    this.set_account_id(value);
  }

  get_reserved1(): number {
    const offset = 12;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 12;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  get_owner(): Pubkey {
    const offset = 16;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_owner(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 16;
    this.buffer.set(sourceBytes, offset);
  }

  get owner(): Pubkey {
    return this.get_owner();
  }

  set owner(value: Pubkey) {
    this.set_owner(value);
  }

  get_vault(): Pubkey {
    const offset = 48;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 48;
    this.buffer.set(sourceBytes, offset);
  }

  get vault(): Pubkey {
    return this.get_vault();
  }

  set vault(value: Pubkey) {
    this.set_vault(value);
  }

  get_links(): MarginLink[] {
    const offset = 80;
    const result: MarginLink[] = [];
    for (let i = 0; i < 8; i++) {
      const slice = this.buffer.subarray((offset + i * 40), (offset + (i + 1) * 40));
      result.push(MarginLink.from_array(slice)!);
    }
    return result;
  }

  set_links(value: MarginLink[]): void {
    const offset = 80;
    if (value.length !== 8) {
      throw new Error('Array length must be 8');
    }
    for (let i = 0; i < 8; i++) {
      const slice = this.buffer.subarray(offset + i * 40, offset + (i + 1) * 40);
      slice.set(value[i]['buffer']);
    }
  }

  get links(): MarginLink[] {
    return this.get_links();
  }

  set links(value: MarginLink[]) {
    this.set_links(value);
  }

  get_reserved2(): bigint[] {
    const offset = 400;
    const result: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getBigUint64((offset + i * 8), true));
    }
    return result;
  }

  set_reserved2(value: bigint[]): void {
    const offset = 400;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setBigUint64((offset + i * 8), value[i], true);
    }
  }

  get reserved2(): bigint[] {
    return this.get_reserved2();
  }

  set reserved2(value: bigint[]) {
    this.set_reserved2(value);
  }

  get_reserved3(): number {
    const offset = 432;
    return this.view.getUint8(offset);
  }

  set_reserved3(value: number): void {
    const offset = 432;
    this.view.setUint8(offset, value);
  }

  get reserved3(): number {
    return this.get_reserved3();
  }

  set reserved3(value: number) {
    this.set_reserved3(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginAccount');
    }
    return __tnBigIntToNumber(irResult, 'MarginAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 433) return { ok: false, code: "tn.buffer_too_small", consumed: 433 };
    return { ok: true, consumed: 433 };
  }

  static from_array(buffer: Uint8Array): MarginAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarginAccount(buffer);
  }

}

export class MarginAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(433);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_magic(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_version(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_link_cnt(value: number): this {
    this.view.setUint8(2, value);
    return this;
  }

  set_reserved0(values: number[]): this {
    if (values.length !== 5) throw new Error("reserved0 expects 5 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 3 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_account_id(value: number): this {
    this.view.setUint32(8, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(12, value, true);
    return this;
  }

  set_owner(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("owner expects 32 bytes");
    this.buffer.set(value, 16);
    return this;
  }

  set_vault(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault expects 32 bytes");
    this.buffer.set(value, 48);
    return this;
  }

  set_links(values: MarginLink[]): this {
    if (values.length !== 8) throw new Error("links expects 8 elements");
    for (let i = 0; i < values.length; i++) {
      const slice = this.buffer.subarray(80 + i * 40, 80 + (i + 1) * 40);
      const source = values[i] as unknown as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
      const raw = source.buffer ? new Uint8Array(source.buffer, source.byteOffset ?? 0, 40) : (values[i] as unknown as Uint8Array);
      slice.set(raw);
    }
    return this;
  }

  set_reserved2(values: bigint[]): this {
    if (values.length !== 4) throw new Error("reserved2 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 400 + i * 8;
      this.view.setBigUint64(byteOffset, values[i], true);
    }
    return this;
  }

  set_reserved3(value: number): this {
    this.view.setUint8(432, value);
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

  finish(): MarginAccount {
    const view = MarginAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarginAccount");
    return view;
  }
}

__tnRegisterFootprint("MarginAccount", (params) => MarginAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginAccount", (buffer, params) => MarginAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginAccount", (buffer) => { const result = MarginAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MarginAccountPayload ----- */

const __tn_ir_MarginAccountPayload = {
  typeName: "MarginAccountPayload",
  root: { op: "const", value: 432n }
} as const;

export class MarginAccountPayload {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MarginAccountPayload {
    if (!buffer || buffer.length === undefined) throw new Error("MarginAccountPayload.__tnCreateView requires a Uint8Array");
    return new MarginAccountPayload(new Uint8Array(buffer));
  }

  static builder(): MarginAccountPayloadBuilder {
    return new MarginAccountPayloadBuilder();
  }

  static fromBuilder(builder: MarginAccountPayloadBuilder): MarginAccountPayload | null {
    const buffer = builder.build();
    return MarginAccountPayload.from_array(buffer);
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

  get_link_cnt(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_link_cnt(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get link_cnt(): number {
    return this.get_link_cnt();
  }

  set link_cnt(value: number) {
    this.set_link_cnt(value);
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

  get_account_id(): number {
    const offset = 7;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_account_id(value: number): void {
    const offset = 7;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get account_id(): number {
    return this.get_account_id();
  }

  set account_id(value: number) {
    this.set_account_id(value);
  }

  get_reserved1(): number {
    const offset = 11;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_reserved1(value: number): void {
    const offset = 11;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get reserved1(): number {
    return this.get_reserved1();
  }

  set reserved1(value: number) {
    this.set_reserved1(value);
  }

  get_owner(): Pubkey {
    const offset = 15;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_owner(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 15;
    this.buffer.set(sourceBytes, offset);
  }

  get owner(): Pubkey {
    return this.get_owner();
  }

  set owner(value: Pubkey) {
    this.set_owner(value);
  }

  get_vault(): Pubkey {
    const offset = 47;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 47;
    this.buffer.set(sourceBytes, offset);
  }

  get vault(): Pubkey {
    return this.get_vault();
  }

  set vault(value: Pubkey) {
    this.set_vault(value);
  }

  get_links(): MarginLink[] {
    const offset = 79;
    const result: MarginLink[] = [];
    for (let i = 0; i < 8; i++) {
      const slice = this.buffer.subarray((offset + i * 40), (offset + (i + 1) * 40));
      result.push(MarginLink.from_array(slice)!);
    }
    return result;
  }

  set_links(value: MarginLink[]): void {
    const offset = 79;
    if (value.length !== 8) {
      throw new Error('Array length must be 8');
    }
    for (let i = 0; i < 8; i++) {
      const slice = this.buffer.subarray(offset + i * 40, offset + (i + 1) * 40);
      slice.set(value[i]['buffer']);
    }
  }

  get links(): MarginLink[] {
    return this.get_links();
  }

  set links(value: MarginLink[]) {
    this.set_links(value);
  }

  get_reserved2(): bigint[] {
    const offset = 399;
    const result: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getBigUint64((offset + i * 8), true));
    }
    return result;
  }

  set_reserved2(value: bigint[]): void {
    const offset = 399;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setBigUint64((offset + i * 8), value[i], true);
    }
  }

  get reserved2(): bigint[] {
    return this.get_reserved2();
  }

  set reserved2(value: bigint[]) {
    this.set_reserved2(value);
  }

  get_reserved3(): number {
    const offset = 431;
    return this.view.getUint8(offset);
  }

  set_reserved3(value: number): void {
    const offset = 431;
    this.view.setUint8(offset, value);
  }

  get reserved3(): number {
    return this.get_reserved3();
  }

  set reserved3(value: number) {
    this.set_reserved3(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MarginAccountPayload.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MarginAccountPayload, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MarginAccountPayload');
    }
    return __tnBigIntToNumber(irResult, 'MarginAccountPayload::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 432) return { ok: false, code: "tn.buffer_too_small", consumed: 432 };
    return { ok: true, consumed: 432 };
  }

  static from_array(buffer: Uint8Array): MarginAccountPayload | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MarginAccountPayload(buffer);
  }

}

export class MarginAccountPayloadBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(432);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_version(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_link_cnt(value: number): this {
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

  set_account_id(value: number): this {
    this.view.setUint32(7, value, true);
    return this;
  }

  set_reserved1(value: number): this {
    this.view.setUint32(11, value, true);
    return this;
  }

  set_owner(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("owner expects 32 bytes");
    this.buffer.set(value, 15);
    return this;
  }

  set_vault(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault expects 32 bytes");
    this.buffer.set(value, 47);
    return this;
  }

  set_links(values: MarginLink[]): this {
    if (values.length !== 8) throw new Error("links expects 8 elements");
    for (let i = 0; i < values.length; i++) {
      const slice = this.buffer.subarray(79 + i * 40, 79 + (i + 1) * 40);
      const source = values[i] as unknown as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
      const raw = source.buffer ? new Uint8Array(source.buffer, source.byteOffset ?? 0, 40) : (values[i] as unknown as Uint8Array);
      slice.set(raw);
    }
    return this;
  }

  set_reserved2(values: bigint[]): this {
    if (values.length !== 4) throw new Error("reserved2 expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 399 + i * 8;
      this.view.setBigUint64(byteOffset, values[i], true);
    }
    return this;
  }

  set_reserved3(value: number): this {
    this.view.setUint8(431, value);
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

  finish(): MarginAccountPayload {
    const view = MarginAccountPayload.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MarginAccountPayload");
    return view;
  }
}

__tnRegisterFootprint("MarginAccountPayload", (params) => MarginAccountPayload.__tnInvokeFootprint(params));
__tnRegisterValidate("MarginAccountPayload", (buffer, params) => MarginAccountPayload.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MarginAccountPayload", (buffer) => { const result = MarginAccountPayload.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PerpProgramAccount ----- */

const __tn_ir_PerpProgramAccount = {
  typeName: "PerpProgramAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "PerpProgramAccount::payload.account_tag", cases: [{ value: 121, node: { op: "align", alignment: 1, node: { op: "const", value: 511n } } }, { value: 120, node: { op: "align", alignment: 1, node: { op: "const", value: 95n } } }, { value: 122, node: { op: "align", alignment: 1, node: { op: "const", value: 432n } } }] } } } }
} as const;

export class PerpProgramAccount_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): PerpProgramAccount_payload_Inner {
    return new PerpProgramAccount_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asMarket(): MarketAccountPayload | null {
    if (!this.descriptor || this.descriptor.tag !== 121) return null;
    return MarketAccountPayload.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asExchangeMeta(): ExchangeMetaAccountPayload | null {
    if (!this.descriptor || this.descriptor.tag !== 120) return null;
    return ExchangeMetaAccountPayload.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMarginAccount(): MarginAccountPayload | null {
    if (!this.descriptor || this.descriptor.tag !== 122) return null;
    return MarginAccountPayload.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class PerpProgramAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: PerpProgramAccount.Params;

  private constructor(private buffer: Uint8Array, params?: PerpProgramAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = PerpProgramAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("PerpProgramAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: PerpProgramAccount.Params, fieldContext?: Record<string, number | bigint> }): PerpProgramAccount {
    if (!buffer || buffer.length === undefined) throw new Error("PerpProgramAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = PerpProgramAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("PerpProgramAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new PerpProgramAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): PerpProgramAccount.Params {
    return this.__tnParams;
  }

  static builder(): PerpProgramAccountBuilder {
    return new PerpProgramAccountBuilder();
  }

  static fromBuilder(builder: PerpProgramAccountBuilder): PerpProgramAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return PerpProgramAccount.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "market",
      tag: 121,
      payloadSize: 511,
      payloadType: "PerpProgramAccount::payload::market",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarketAccountPayload),
    },
    {
      name: "exchange_meta",
      tag: 120,
      payloadSize: 95,
      payloadType: "PerpProgramAccount::payload::exchange_meta",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ExchangeMetaAccountPayload),
    },
    {
      name: "margin_account",
      tag: 122,
      payloadSize: 432,
      payloadType: "PerpProgramAccount::payload::margin_account",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MarginAccountPayload),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: PerpProgramAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_account_tag = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = PerpProgramAccount.Params.fromValues({
      payload_account_tag: __tnParam_payload_account_tag,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_account_tag(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_account_tag(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get account_tag(): number {
    return this.get_account_tag();
  }

  set account_tag(value: number) {
    this.set_account_tag(value);
  }

  payloadVariant(): typeof PerpProgramAccount.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return PerpProgramAccount.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): PerpProgramAccount_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("PerpProgramAccount: unknown payload variant");
    const offset = PerpProgramAccount.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("PerpProgramAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return PerpProgramAccount_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PerpProgramAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PerpProgramAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_account_tag: number | bigint): bigint {
    const params = PerpProgramAccount.Params.fromValues({
      payload_account_tag: payload_account_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: PerpProgramAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.account_tag"] = params.payload_account_tag;
    record["PerpProgramAccount::payload.account_tag"] = params.payload_account_tag;
    return record;
  }

  static footprintIrFromParams(params: PerpProgramAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: PerpProgramAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PerpProgramAccount');
    return __tnBigIntToNumber(irResult, 'PerpProgramAccount::footprintFromParams');
  }

  static footprintFromValues(input: { payload_account_tag: number | bigint }): number {
    const params = PerpProgramAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: PerpProgramAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: PerpProgramAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: PerpProgramAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PerpProgramAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PerpProgramAccount::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: PerpProgramAccount.Params }): PerpProgramAccount | null {
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
    const state = new PerpProgramAccount(buffer, cached);
    return state;
  }


}

export namespace PerpProgramAccount {
  export type Params = {
    /** ABI path: payload.account_tag */
    readonly payload_account_tag: bigint;
  };

  export const ParamKeys = Object.freeze({
    payload_account_tag: "payload.account_tag",
  } as const);

  export const Params = {
    fromValues(input: { payload_account_tag: number | bigint }): Params {
      return {
        payload_account_tag: __tnToBigInt(input.payload_account_tag),
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

  export function params(input: { payload_account_tag: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class PerpProgramAccountBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_account_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof PerpProgramAccount.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: PerpProgramAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: PerpProgramAccount.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<PerpProgramAccountBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(1);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_account_tag(value: number): void {
    this.__tnField_account_tag = value;
    this.__tnInvalidate();
  }

  set_account_tag(value: number): this {
    this.__tnAssign_account_tag(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<PerpProgramAccountBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, PerpProgramAccount.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_account_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_tag === null) throw new Error("PerpProgramAccountBuilder: field 'account_tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PerpProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_account_tag === null) throw new Error("PerpProgramAccountBuilder: field 'account_tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpProgramAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PerpProgramAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("PerpProgramAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): PerpProgramAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = PerpProgramAccount.from_array(buffer, { params });
    if (!view) throw new Error("PerpProgramAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): PerpProgramAccount {
    return this.finish();
  }

  dynamicParams(): PerpProgramAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): PerpProgramAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = PerpProgramAccount.Params.fromValues({
      payload_account_tag: (() => { if (this.__tnField_account_tag === null) throw new Error("PerpProgramAccountBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_account_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_account_tag === null) throw new Error("PerpProgramAccountBuilder: field 'account_tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PerpProgramAccountBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_account_tag);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: PerpProgramAccount.Params): void {
    const result = PerpProgramAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ PerpProgramAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("PerpProgramAccount", (params) => PerpProgramAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("PerpProgramAccount", (buffer, params) => PerpProgramAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PerpProgramAccount", (buffer) => { const result = PerpProgramAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
