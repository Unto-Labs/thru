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
      readonly op: "mul";
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
    case "mul":
      return __tnCheckedMul(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
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

/* ----- TYPE DEFINITION FOR AmmAddLiquidityInstruction ----- */

const __tn_ir_AmmAddLiquidityInstruction = {
  typeName: "AmmAddLiquidityInstruction",
  root: { op: "const", value: 34n }
} as const;

export class AmmAddLiquidityInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AmmAddLiquidityInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("AmmAddLiquidityInstruction.__tnCreateView requires a Uint8Array");
    return new AmmAddLiquidityInstruction(new Uint8Array(buffer));
  }

  static builder(): AmmAddLiquidityInstructionBuilder {
    return new AmmAddLiquidityInstructionBuilder();
  }

  static fromBuilder(builder: AmmAddLiquidityInstructionBuilder): AmmAddLiquidityInstruction | null {
    const buffer = builder.build();
    return AmmAddLiquidityInstruction.from_array(buffer);
  }

  get_pool_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_pool_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get pool_account_idx(): number {
    return this.get_pool_account_idx();
  }

  set pool_account_idx(value: number) {
    this.set_pool_account_idx(value);
  }

  get_depositor_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_depositor_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get depositor_account_idx(): number {
    return this.get_depositor_account_idx();
  }

  set depositor_account_idx(value: number) {
    this.set_depositor_account_idx(value);
  }

  get_depositor_token_one_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_depositor_token_one_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get depositor_token_one_account_idx(): number {
    return this.get_depositor_token_one_account_idx();
  }

  set depositor_token_one_account_idx(value: number) {
    this.set_depositor_token_one_account_idx(value);
  }

  get_depositor_token_two_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_depositor_token_two_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get depositor_token_two_account_idx(): number {
    return this.get_depositor_token_two_account_idx();
  }

  set depositor_token_two_account_idx(value: number) {
    this.set_depositor_token_two_account_idx(value);
  }

  get_depositor_lp_account_idx(): number {
    const offset = 8;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_depositor_lp_account_idx(value: number): void {
    const offset = 8;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get depositor_lp_account_idx(): number {
    return this.get_depositor_lp_account_idx();
  }

  set depositor_lp_account_idx(value: number) {
    this.set_depositor_lp_account_idx(value);
  }

  get_vault_one_account_idx(): number {
    const offset = 10;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_one_account_idx(value: number): void {
    const offset = 10;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_one_account_idx(): number {
    return this.get_vault_one_account_idx();
  }

  set vault_one_account_idx(value: number) {
    this.set_vault_one_account_idx(value);
  }

  get_vault_two_account_idx(): number {
    const offset = 12;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_two_account_idx(value: number): void {
    const offset = 12;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_two_account_idx(): number {
    return this.get_vault_two_account_idx();
  }

  set vault_two_account_idx(value: number) {
    this.set_vault_two_account_idx(value);
  }

  get_lp_mint_account_idx(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_lp_mint_account_idx(value: number): void {
    const offset = 14;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get lp_mint_account_idx(): number {
    return this.get_lp_mint_account_idx();
  }

  set lp_mint_account_idx(value: number) {
    this.set_lp_mint_account_idx(value);
  }

  get_token_program_account_idx(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_account_idx(value: number): void {
    const offset = 16;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_account_idx(): number {
    return this.get_token_program_account_idx();
  }

  set token_program_account_idx(value: number) {
    this.set_token_program_account_idx(value);
  }

  get_max_amount_mint_one(): bigint {
    const offset = 18;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_amount_mint_one(value: bigint): void {
    const offset = 18;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_amount_mint_one(): bigint {
    return this.get_max_amount_mint_one();
  }

  set max_amount_mint_one(value: bigint) {
    this.set_max_amount_mint_one(value);
  }

  get_max_amount_mint_two(): bigint {
    const offset = 26;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_amount_mint_two(value: bigint): void {
    const offset = 26;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_amount_mint_two(): bigint {
    return this.get_max_amount_mint_two();
  }

  set max_amount_mint_two(value: bigint) {
    this.set_max_amount_mint_two(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AmmAddLiquidityInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmAddLiquidityInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmAddLiquidityInstruction');
    }
    return __tnBigIntToNumber(irResult, 'AmmAddLiquidityInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 34) return { ok: false, code: "tn.buffer_too_small", consumed: 34 };
    return { ok: true, consumed: 34 };
  }

  static new(pool_account_idx: number, depositor_account_idx: number, depositor_token_one_account_idx: number, depositor_token_two_account_idx: number, depositor_lp_account_idx: number, vault_one_account_idx: number, vault_two_account_idx: number, lp_mint_account_idx: number, token_program_account_idx: number, max_amount_mint_one: bigint, max_amount_mint_two: bigint): AmmAddLiquidityInstruction {
    const buffer = new Uint8Array(34);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, pool_account_idx, true); /* pool_account_idx (little-endian) */
    view.setUint16(2, depositor_account_idx, true); /* depositor_account_idx (little-endian) */
    view.setUint16(4, depositor_token_one_account_idx, true); /* depositor_token_one_account_idx (little-endian) */
    view.setUint16(6, depositor_token_two_account_idx, true); /* depositor_token_two_account_idx (little-endian) */
    view.setUint16(8, depositor_lp_account_idx, true); /* depositor_lp_account_idx (little-endian) */
    view.setUint16(10, vault_one_account_idx, true); /* vault_one_account_idx (little-endian) */
    view.setUint16(12, vault_two_account_idx, true); /* vault_two_account_idx (little-endian) */
    view.setUint16(14, lp_mint_account_idx, true); /* lp_mint_account_idx (little-endian) */
    view.setUint16(16, token_program_account_idx, true); /* token_program_account_idx (little-endian) */
    view.setBigUint64(18, max_amount_mint_one, true); /* max_amount_mint_one (little-endian) */
    view.setBigUint64(26, max_amount_mint_two, true); /* max_amount_mint_two (little-endian) */

    return new AmmAddLiquidityInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): AmmAddLiquidityInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AmmAddLiquidityInstruction(buffer);
  }

}

export class AmmAddLiquidityInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(34);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_depositor_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_depositor_token_one_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_depositor_token_two_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  set_depositor_lp_account_idx(value: number): this {
    this.view.setUint16(8, value, true);
    return this;
  }

  set_vault_one_account_idx(value: number): this {
    this.view.setUint16(10, value, true);
    return this;
  }

  set_vault_two_account_idx(value: number): this {
    this.view.setUint16(12, value, true);
    return this;
  }

  set_lp_mint_account_idx(value: number): this {
    this.view.setUint16(14, value, true);
    return this;
  }

  set_token_program_account_idx(value: number): this {
    this.view.setUint16(16, value, true);
    return this;
  }

  set_max_amount_mint_one(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(18, cast, true);
    return this;
  }

  set_max_amount_mint_two(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(26, cast, true);
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

  finish(): AmmAddLiquidityInstruction {
    const view = AmmAddLiquidityInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AmmAddLiquidityInstruction");
    return view;
  }
}

__tnRegisterFootprint("AmmAddLiquidityInstruction", (params) => AmmAddLiquidityInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmAddLiquidityInstruction", (buffer, params) => AmmAddLiquidityInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmAddLiquidityInstruction", (buffer) => { const result = AmmAddLiquidityInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AmmError ----- */

const __tn_ir_AmmError = {
  typeName: "AmmError",
  root: { op: "const", value: 8n }
} as const;

export class AmmError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AmmError {
    if (!buffer || buffer.length === undefined) throw new Error("AmmError.__tnCreateView requires a Uint8Array");
    return new AmmError(new Uint8Array(buffer));
  }

  static builder(): AmmErrorBuilder {
    return new AmmErrorBuilder();
  }

  static fromBuilder(builder: AmmErrorBuilder): AmmError | null {
    const buffer = builder.build();
    return AmmError.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_AmmError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmError');
    }
    return __tnBigIntToNumber(irResult, 'AmmError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(code: bigint): AmmError {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, code, true); /* code (little-endian) */

    return new AmmError(buffer);
  }

  static from_array(buffer: Uint8Array): AmmError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AmmError(buffer);
  }

}

export class AmmErrorBuilder {
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

  finish(): AmmError {
    const view = AmmError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AmmError");
    return view;
  }
}

__tnRegisterFootprint("AmmError", (params) => AmmError.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmError", (buffer, params) => AmmError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmError", (buffer) => { const result = AmmError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AmmSwapInstruction ----- */

const __tn_ir_AmmSwapInstruction = {
  typeName: "AmmSwapInstruction",
  root: { op: "const", value: 24n }
} as const;

export class AmmSwapInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AmmSwapInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("AmmSwapInstruction.__tnCreateView requires a Uint8Array");
    return new AmmSwapInstruction(new Uint8Array(buffer));
  }

  static builder(): AmmSwapInstructionBuilder {
    return new AmmSwapInstructionBuilder();
  }

  static fromBuilder(builder: AmmSwapInstructionBuilder): AmmSwapInstruction | null {
    const buffer = builder.build();
    return AmmSwapInstruction.from_array(buffer);
  }

  get_pool_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_pool_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get pool_account_idx(): number {
    return this.get_pool_account_idx();
  }

  set pool_account_idx(value: number) {
    this.set_pool_account_idx(value);
  }

  get_user_transfer_authority_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_user_transfer_authority_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get user_transfer_authority_idx(): number {
    return this.get_user_transfer_authority_idx();
  }

  set user_transfer_authority_idx(value: number) {
    this.set_user_transfer_authority_idx(value);
  }

  get_user_input_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_user_input_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get user_input_account_idx(): number {
    return this.get_user_input_account_idx();
  }

  set user_input_account_idx(value: number) {
    this.set_user_input_account_idx(value);
  }

  get_user_output_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_user_output_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get user_output_account_idx(): number {
    return this.get_user_output_account_idx();
  }

  set user_output_account_idx(value: number) {
    this.set_user_output_account_idx(value);
  }

  get_vault_input_account_idx(): number {
    const offset = 8;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_input_account_idx(value: number): void {
    const offset = 8;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_input_account_idx(): number {
    return this.get_vault_input_account_idx();
  }

  set vault_input_account_idx(value: number) {
    this.set_vault_input_account_idx(value);
  }

  get_vault_output_account_idx(): number {
    const offset = 10;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_output_account_idx(value: number): void {
    const offset = 10;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_output_account_idx(): number {
    return this.get_vault_output_account_idx();
  }

  set vault_output_account_idx(value: number) {
    this.set_vault_output_account_idx(value);
  }

  get_lp_mint_account_idx(): number {
    const offset = 12;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_lp_mint_account_idx(value: number): void {
    const offset = 12;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get lp_mint_account_idx(): number {
    return this.get_lp_mint_account_idx();
  }

  set lp_mint_account_idx(value: number) {
    this.set_lp_mint_account_idx(value);
  }

  get_token_program_account_idx(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_account_idx(value: number): void {
    const offset = 14;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_account_idx(): number {
    return this.get_token_program_account_idx();
  }

  set token_program_account_idx(value: number) {
    this.set_token_program_account_idx(value);
  }

  get_amount_in(): bigint {
    const offset = 16;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount_in(value: bigint): void {
    const offset = 16;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount_in(): bigint {
    return this.get_amount_in();
  }

  set amount_in(value: bigint) {
    this.set_amount_in(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AmmSwapInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmSwapInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmSwapInstruction');
    }
    return __tnBigIntToNumber(irResult, 'AmmSwapInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 24) return { ok: false, code: "tn.buffer_too_small", consumed: 24 };
    return { ok: true, consumed: 24 };
  }

  static new(pool_account_idx: number, user_transfer_authority_idx: number, user_input_account_idx: number, user_output_account_idx: number, vault_input_account_idx: number, vault_output_account_idx: number, lp_mint_account_idx: number, token_program_account_idx: number, amount_in: bigint): AmmSwapInstruction {
    const buffer = new Uint8Array(24);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, pool_account_idx, true); /* pool_account_idx (little-endian) */
    view.setUint16(2, user_transfer_authority_idx, true); /* user_transfer_authority_idx (little-endian) */
    view.setUint16(4, user_input_account_idx, true); /* user_input_account_idx (little-endian) */
    view.setUint16(6, user_output_account_idx, true); /* user_output_account_idx (little-endian) */
    view.setUint16(8, vault_input_account_idx, true); /* vault_input_account_idx (little-endian) */
    view.setUint16(10, vault_output_account_idx, true); /* vault_output_account_idx (little-endian) */
    view.setUint16(12, lp_mint_account_idx, true); /* lp_mint_account_idx (little-endian) */
    view.setUint16(14, token_program_account_idx, true); /* token_program_account_idx (little-endian) */
    view.setBigUint64(16, amount_in, true); /* amount_in (little-endian) */

    return new AmmSwapInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): AmmSwapInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AmmSwapInstruction(buffer);
  }

}

export class AmmSwapInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(24);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_user_transfer_authority_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_user_input_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_user_output_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  set_vault_input_account_idx(value: number): this {
    this.view.setUint16(8, value, true);
    return this;
  }

  set_vault_output_account_idx(value: number): this {
    this.view.setUint16(10, value, true);
    return this;
  }

  set_lp_mint_account_idx(value: number): this {
    this.view.setUint16(12, value, true);
    return this;
  }

  set_token_program_account_idx(value: number): this {
    this.view.setUint16(14, value, true);
    return this;
  }

  set_amount_in(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(16, cast, true);
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

  finish(): AmmSwapInstruction {
    const view = AmmSwapInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AmmSwapInstruction");
    return view;
  }
}

__tnRegisterFootprint("AmmSwapInstruction", (params) => AmmSwapInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmSwapInstruction", (buffer, params) => AmmSwapInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmSwapInstruction", (buffer) => { const result = AmmSwapInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AmmWithdrawLiquidityInstruction ----- */

const __tn_ir_AmmWithdrawLiquidityInstruction = {
  typeName: "AmmWithdrawLiquidityInstruction",
  root: { op: "const", value: 26n }
} as const;

export class AmmWithdrawLiquidityInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AmmWithdrawLiquidityInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("AmmWithdrawLiquidityInstruction.__tnCreateView requires a Uint8Array");
    return new AmmWithdrawLiquidityInstruction(new Uint8Array(buffer));
  }

  static builder(): AmmWithdrawLiquidityInstructionBuilder {
    return new AmmWithdrawLiquidityInstructionBuilder();
  }

  static fromBuilder(builder: AmmWithdrawLiquidityInstructionBuilder): AmmWithdrawLiquidityInstruction | null {
    const buffer = builder.build();
    return AmmWithdrawLiquidityInstruction.from_array(buffer);
  }

  get_pool_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_pool_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get pool_account_idx(): number {
    return this.get_pool_account_idx();
  }

  set pool_account_idx(value: number) {
    this.set_pool_account_idx(value);
  }

  get_withdrawer_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_withdrawer_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get withdrawer_account_idx(): number {
    return this.get_withdrawer_account_idx();
  }

  set withdrawer_account_idx(value: number) {
    this.set_withdrawer_account_idx(value);
  }

  get_withdrawer_token_one_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_withdrawer_token_one_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get withdrawer_token_one_account_idx(): number {
    return this.get_withdrawer_token_one_account_idx();
  }

  set withdrawer_token_one_account_idx(value: number) {
    this.set_withdrawer_token_one_account_idx(value);
  }

  get_withdrawer_token_two_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_withdrawer_token_two_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get withdrawer_token_two_account_idx(): number {
    return this.get_withdrawer_token_two_account_idx();
  }

  set withdrawer_token_two_account_idx(value: number) {
    this.set_withdrawer_token_two_account_idx(value);
  }

  get_withdrawer_lp_account_idx(): number {
    const offset = 8;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_withdrawer_lp_account_idx(value: number): void {
    const offset = 8;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get withdrawer_lp_account_idx(): number {
    return this.get_withdrawer_lp_account_idx();
  }

  set withdrawer_lp_account_idx(value: number) {
    this.set_withdrawer_lp_account_idx(value);
  }

  get_vault_one_account_idx(): number {
    const offset = 10;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_one_account_idx(value: number): void {
    const offset = 10;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_one_account_idx(): number {
    return this.get_vault_one_account_idx();
  }

  set vault_one_account_idx(value: number) {
    this.set_vault_one_account_idx(value);
  }

  get_vault_two_account_idx(): number {
    const offset = 12;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_two_account_idx(value: number): void {
    const offset = 12;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_two_account_idx(): number {
    return this.get_vault_two_account_idx();
  }

  set vault_two_account_idx(value: number) {
    this.set_vault_two_account_idx(value);
  }

  get_lp_mint_account_idx(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_lp_mint_account_idx(value: number): void {
    const offset = 14;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get lp_mint_account_idx(): number {
    return this.get_lp_mint_account_idx();
  }

  set lp_mint_account_idx(value: number) {
    this.set_lp_mint_account_idx(value);
  }

  get_token_program_account_idx(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_account_idx(value: number): void {
    const offset = 16;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_account_idx(): number {
    return this.get_token_program_account_idx();
  }

  set token_program_account_idx(value: number) {
    this.set_token_program_account_idx(value);
  }

  get_lp_amount(): bigint {
    const offset = 18;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lp_amount(value: bigint): void {
    const offset = 18;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lp_amount(): bigint {
    return this.get_lp_amount();
  }

  set lp_amount(value: bigint) {
    this.set_lp_amount(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AmmWithdrawLiquidityInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmWithdrawLiquidityInstruction, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmWithdrawLiquidityInstruction');
    }
    return __tnBigIntToNumber(irResult, 'AmmWithdrawLiquidityInstruction::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 26) return { ok: false, code: "tn.buffer_too_small", consumed: 26 };
    return { ok: true, consumed: 26 };
  }

  static new(pool_account_idx: number, withdrawer_account_idx: number, withdrawer_token_one_account_idx: number, withdrawer_token_two_account_idx: number, withdrawer_lp_account_idx: number, vault_one_account_idx: number, vault_two_account_idx: number, lp_mint_account_idx: number, token_program_account_idx: number, lp_amount: bigint): AmmWithdrawLiquidityInstruction {
    const buffer = new Uint8Array(26);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, pool_account_idx, true); /* pool_account_idx (little-endian) */
    view.setUint16(2, withdrawer_account_idx, true); /* withdrawer_account_idx (little-endian) */
    view.setUint16(4, withdrawer_token_one_account_idx, true); /* withdrawer_token_one_account_idx (little-endian) */
    view.setUint16(6, withdrawer_token_two_account_idx, true); /* withdrawer_token_two_account_idx (little-endian) */
    view.setUint16(8, withdrawer_lp_account_idx, true); /* withdrawer_lp_account_idx (little-endian) */
    view.setUint16(10, vault_one_account_idx, true); /* vault_one_account_idx (little-endian) */
    view.setUint16(12, vault_two_account_idx, true); /* vault_two_account_idx (little-endian) */
    view.setUint16(14, lp_mint_account_idx, true); /* lp_mint_account_idx (little-endian) */
    view.setUint16(16, token_program_account_idx, true); /* token_program_account_idx (little-endian) */
    view.setBigUint64(18, lp_amount, true); /* lp_amount (little-endian) */

    return new AmmWithdrawLiquidityInstruction(buffer);
  }

  static from_array(buffer: Uint8Array): AmmWithdrawLiquidityInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AmmWithdrawLiquidityInstruction(buffer);
  }

}

export class AmmWithdrawLiquidityInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(26);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_withdrawer_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_withdrawer_token_one_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_withdrawer_token_two_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  set_withdrawer_lp_account_idx(value: number): this {
    this.view.setUint16(8, value, true);
    return this;
  }

  set_vault_one_account_idx(value: number): this {
    this.view.setUint16(10, value, true);
    return this;
  }

  set_vault_two_account_idx(value: number): this {
    this.view.setUint16(12, value, true);
    return this;
  }

  set_lp_mint_account_idx(value: number): this {
    this.view.setUint16(14, value, true);
    return this;
  }

  set_token_program_account_idx(value: number): this {
    this.view.setUint16(16, value, true);
    return this;
  }

  set_lp_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(18, cast, true);
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

  finish(): AmmWithdrawLiquidityInstruction {
    const view = AmmWithdrawLiquidityInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AmmWithdrawLiquidityInstruction");
    return view;
  }
}

__tnRegisterFootprint("AmmWithdrawLiquidityInstruction", (params) => AmmWithdrawLiquidityInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmWithdrawLiquidityInstruction", (buffer, params) => AmmWithdrawLiquidityInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmWithdrawLiquidityInstruction", (buffer) => { const result = AmmWithdrawLiquidityInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

/* ----- TYPE DEFINITION FOR SwapEventData ----- */

const __tn_ir_SwapEventData = {
  typeName: "SwapEventData",
  root: { op: "const", value: 113n }
} as const;

export class SwapEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SwapEventData {
    if (!buffer || buffer.length === undefined) throw new Error("SwapEventData.__tnCreateView requires a Uint8Array");
    return new SwapEventData(new Uint8Array(buffer));
  }

  static builder(): SwapEventDataBuilder {
    return new SwapEventDataBuilder();
  }

  static fromBuilder(builder: SwapEventDataBuilder): SwapEventData | null {
    const buffer = builder.build();
    return SwapEventData.from_array(buffer);
  }

  get_pool(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_pool(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get pool(): Pubkey {
    return this.get_pool();
  }

  set pool(value: Pubkey) {
    this.set_pool(value);
  }

  get_sender(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_sender(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get sender(): Pubkey {
    return this.get_sender();
  }

  set sender(value: Pubkey) {
    this.set_sender(value);
  }

  get_to(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_to(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get to(): Pubkey {
    return this.get_to();
  }

  set to(value: Pubkey) {
    this.set_to(value);
  }

  get_amount_in(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount_in(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount_in(): bigint {
    return this.get_amount_in();
  }

  set amount_in(value: bigint) {
    this.set_amount_in(value);
  }

  get_amount_out(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount_out(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount_out(): bigint {
    return this.get_amount_out();
  }

  set amount_out(value: bigint) {
    this.set_amount_out(value);
  }

  get_swap_direction(): number {
    const offset = 112;
    return this.view.getUint8(offset);
  }

  set_swap_direction(value: number): void {
    const offset = 112;
    this.view.setUint8(offset, value);
  }

  get swap_direction(): number {
    return this.get_swap_direction();
  }

  set swap_direction(value: number) {
    this.set_swap_direction(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SwapEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SwapEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SwapEventData');
    }
    return __tnBigIntToNumber(irResult, 'SwapEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 113) return { ok: false, code: "tn.buffer_too_small", consumed: 113 };
    return { ok: true, consumed: 113 };
  }

  static from_array(buffer: Uint8Array): SwapEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SwapEventData(buffer);
  }

}

export class SwapEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(113);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("pool expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_sender(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("sender expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_to(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("to expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_amount_in(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_amount_out(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_swap_direction(value: number): this {
    this.view.setUint8(112, value);
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

  finish(): SwapEventData {
    const view = SwapEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SwapEventData");
    return view;
  }
}

__tnRegisterFootprint("SwapEventData", (params) => SwapEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("SwapEventData", (buffer, params) => SwapEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SwapEventData", (buffer) => { const result = SwapEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SyncEventData ----- */

const __tn_ir_SyncEventData = {
  typeName: "SyncEventData",
  root: { op: "const", value: 48n }
} as const;

export class SyncEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SyncEventData {
    if (!buffer || buffer.length === undefined) throw new Error("SyncEventData.__tnCreateView requires a Uint8Array");
    return new SyncEventData(new Uint8Array(buffer));
  }

  static builder(): SyncEventDataBuilder {
    return new SyncEventDataBuilder();
  }

  static fromBuilder(builder: SyncEventDataBuilder): SyncEventData | null {
    const buffer = builder.build();
    return SyncEventData.from_array(buffer);
  }

  get_pool(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_pool(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get pool(): Pubkey {
    return this.get_pool();
  }

  set pool(value: Pubkey) {
    this.set_pool(value);
  }

  get_reserve_one(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_reserve_one(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get reserve_one(): bigint {
    return this.get_reserve_one();
  }

  set reserve_one(value: bigint) {
    this.set_reserve_one(value);
  }

  get_reserve_two(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_reserve_two(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get reserve_two(): bigint {
    return this.get_reserve_two();
  }

  set reserve_two(value: bigint) {
    this.set_reserve_two(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SyncEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SyncEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SyncEventData');
    }
    return __tnBigIntToNumber(irResult, 'SyncEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 48) return { ok: false, code: "tn.buffer_too_small", consumed: 48 };
    return { ok: true, consumed: 48 };
  }

  static from_array(buffer: Uint8Array): SyncEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SyncEventData(buffer);
  }

}

export class SyncEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(48);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("pool expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_reserve_one(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    return this;
  }

  set_reserve_two(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
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

  finish(): SyncEventData {
    const view = SyncEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SyncEventData");
    return view;
  }
}

__tnRegisterFootprint("SyncEventData", (params) => SyncEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("SyncEventData", (buffer, params) => SyncEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SyncEventData", (buffer) => { const result = SyncEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AmmInitPoolInstruction ----- */

const __tn_ir_AmmInitPoolInstruction = {
  typeName: "AmmInitPoolInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "pool_proof.pool_proof_size" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "lp_mint_proof.lp_mint_proof_size" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "vault_one_proof.vault_one_proof_size" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "vault_two_proof.vault_two_proof_size" }, right: { op: "const", value: 1n } } } } }
} as const;

export class AmmInitPoolInstruction {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: AmmInitPoolInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: AmmInitPoolInstruction.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = AmmInitPoolInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("AmmInitPoolInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: AmmInitPoolInstruction.Params, fieldContext?: Record<string, number | bigint> }): AmmInitPoolInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("AmmInitPoolInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = AmmInitPoolInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("AmmInitPoolInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new AmmInitPoolInstruction(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): AmmInitPoolInstruction.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "AmmInitPoolInstruction::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "AmmInitPoolInstruction::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("AmmInitPoolInstruction: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): AmmInitPoolInstructionBuilder {
    return new AmmInitPoolInstructionBuilder();
  }

  static fromBuilder(builder: AmmInitPoolInstructionBuilder): AmmInitPoolInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return AmmInitPoolInstruction.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "pool_proof", method: "pool_proof", sizeField: "pool_proof_size", paramKey: "pool_proof_size", elementSize: 1 },
    { field: "lp_mint_proof", method: "lp_mint_proof", sizeField: "lp_mint_proof_size", paramKey: "lp_mint_proof_size", elementSize: 1 },
    { field: "vault_one_proof", method: "vault_one_proof", sizeField: "vault_one_proof_size", paramKey: "vault_one_proof_size", elementSize: 1 },
    { field: "vault_two_proof", method: "vault_two_proof", sizeField: "vault_two_proof_size", paramKey: "vault_two_proof_size", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_payer_account_idx: number | null = null;
    let __tnFieldValue_pool_account_idx: number | null = null;
    let __tnFieldValue_lp_mint_account_idx: number | null = null;
    let __tnFieldValue_vault_one_account_idx: number | null = null;
    let __tnFieldValue_vault_two_account_idx: number | null = null;
    let __tnFieldValue_mint_one_account_idx: number | null = null;
    let __tnFieldValue_mint_two_account_idx: number | null = null;
    let __tnFieldValue_token_program_account_idx: number | null = null;
    let __tnFieldValue_swap_fee_bps: number | null = null;
    let __tnFieldValue_pool_proof_size: bigint | null = null;
    let __tnFieldValue_lp_mint_proof_size: bigint | null = null;
    let __tnFieldValue_vault_one_proof_size: bigint | null = null;
    let __tnFieldValue_vault_two_proof_size: bigint | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_payer_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_payer_account_idx = __tnRead_payer_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_pool_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_pool_account_idx = __tnRead_pool_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_lp_mint_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_lp_mint_account_idx = __tnRead_lp_mint_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_vault_one_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_vault_one_account_idx = __tnRead_vault_one_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_vault_two_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_vault_two_account_idx = __tnRead_vault_two_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_mint_one_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_mint_one_account_idx = __tnRead_mint_one_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_mint_two_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_mint_two_account_idx = __tnRead_mint_two_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_token_program_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_token_program_account_idx = __tnRead_token_program_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_swap_fee_bps = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_swap_fee_bps = __tnRead_swap_fee_bps;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_pool_proof_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_pool_proof_size = __tnRead_pool_proof_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_lp_mint_proof_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_lp_mint_proof_size = __tnRead_lp_mint_proof_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_vault_one_proof_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_vault_one_proof_size = __tnRead_vault_one_proof_size;
    __tnCursorMutable += 8;
    if (__tnCursorMutable + 8 > __tnLength) return null;
    const __tnRead_vault_two_proof_size = view.getBigUint64(__tnCursorMutable, true);
    __tnFieldValue_vault_two_proof_size = __tnRead_vault_two_proof_size;
    __tnCursorMutable += 8;
    if (__tnFieldValue_pool_proof_size === null) return null;
    const __tnArrayCount_pool_proof = Math.trunc(Number(__tnFieldValue_pool_proof_size));
    if (!Number.isFinite(__tnArrayCount_pool_proof) || __tnArrayCount_pool_proof < 0) return null;
    const __tnArrayBytes_pool_proof = __tnArrayCount_pool_proof * 1;
    if (__tnCursorMutable + __tnArrayBytes_pool_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_pool_proof;
    if (__tnFieldValue_lp_mint_proof_size === null) return null;
    const __tnArrayCount_lp_mint_proof = Math.trunc(Number(__tnFieldValue_lp_mint_proof_size));
    if (!Number.isFinite(__tnArrayCount_lp_mint_proof) || __tnArrayCount_lp_mint_proof < 0) return null;
    const __tnArrayBytes_lp_mint_proof = __tnArrayCount_lp_mint_proof * 1;
    offsets["lp_mint_proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_lp_mint_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_lp_mint_proof;
    if (__tnFieldValue_vault_one_proof_size === null) return null;
    const __tnArrayCount_vault_one_proof = Math.trunc(Number(__tnFieldValue_vault_one_proof_size));
    if (!Number.isFinite(__tnArrayCount_vault_one_proof) || __tnArrayCount_vault_one_proof < 0) return null;
    const __tnArrayBytes_vault_one_proof = __tnArrayCount_vault_one_proof * 1;
    offsets["vault_one_proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_vault_one_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_vault_one_proof;
    if (__tnFieldValue_vault_two_proof_size === null) return null;
    const __tnArrayCount_vault_two_proof = Math.trunc(Number(__tnFieldValue_vault_two_proof_size));
    if (!Number.isFinite(__tnArrayCount_vault_two_proof) || __tnArrayCount_vault_two_proof < 0) return null;
    const __tnArrayBytes_vault_two_proof = __tnArrayCount_vault_two_proof * 1;
    offsets["vault_two_proof"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_vault_two_proof > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_vault_two_proof;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: AmmInitPoolInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 66) {
      return null;
    }
    const __tnParam_lp_mint_proof_lp_mint_proof_size = __tnToBigInt(view.getBigUint64(58, true));
    if (buffer.length < 58) {
      return null;
    }
    const __tnParam_pool_proof_pool_proof_size = __tnToBigInt(view.getBigUint64(50, true));
    if (buffer.length < 74) {
      return null;
    }
    const __tnParam_vault_one_proof_vault_one_proof_size = __tnToBigInt(view.getBigUint64(66, true));
    if (buffer.length < 82) {
      return null;
    }
    const __tnParam_vault_two_proof_vault_two_proof_size = __tnToBigInt(view.getBigUint64(74, true));
    const __tnExtractedParams = AmmInitPoolInstruction.Params.fromValues({
      lp_mint_proof_lp_mint_proof_size: __tnParam_lp_mint_proof_lp_mint_proof_size,
      pool_proof_pool_proof_size: __tnParam_pool_proof_pool_proof_size,
      vault_one_proof_vault_one_proof_size: __tnParam_vault_one_proof_vault_one_proof_size,
      vault_two_proof_vault_two_proof_size: __tnParam_vault_two_proof_vault_two_proof_size,
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
      throw new Error("AmmInitPoolInstruction: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = AmmInitPoolInstruction.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("AmmInitPoolInstruction: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_payer_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_payer_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get payer_account_idx(): number {
    return this.get_payer_account_idx();
  }

  set payer_account_idx(value: number) {
    this.set_payer_account_idx(value);
  }

  get_pool_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_pool_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get pool_account_idx(): number {
    return this.get_pool_account_idx();
  }

  set pool_account_idx(value: number) {
    this.set_pool_account_idx(value);
  }

  get_lp_mint_account_idx(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_lp_mint_account_idx(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get lp_mint_account_idx(): number {
    return this.get_lp_mint_account_idx();
  }

  set lp_mint_account_idx(value: number) {
    this.set_lp_mint_account_idx(value);
  }

  get_vault_one_account_idx(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_one_account_idx(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_one_account_idx(): number {
    return this.get_vault_one_account_idx();
  }

  set vault_one_account_idx(value: number) {
    this.set_vault_one_account_idx(value);
  }

  get_vault_two_account_idx(): number {
    const offset = 8;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_vault_two_account_idx(value: number): void {
    const offset = 8;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get vault_two_account_idx(): number {
    return this.get_vault_two_account_idx();
  }

  set vault_two_account_idx(value: number) {
    this.set_vault_two_account_idx(value);
  }

  get_mint_one_account_idx(): number {
    const offset = 10;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_one_account_idx(value: number): void {
    const offset = 10;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_one_account_idx(): number {
    return this.get_mint_one_account_idx();
  }

  set mint_one_account_idx(value: number) {
    this.set_mint_one_account_idx(value);
  }

  get_mint_two_account_idx(): number {
    const offset = 12;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_mint_two_account_idx(value: number): void {
    const offset = 12;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get mint_two_account_idx(): number {
    return this.get_mint_two_account_idx();
  }

  set mint_two_account_idx(value: number) {
    this.set_mint_two_account_idx(value);
  }

  get_token_program_account_idx(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_token_program_account_idx(value: number): void {
    const offset = 14;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get token_program_account_idx(): number {
    return this.get_token_program_account_idx();
  }

  set token_program_account_idx(value: number) {
    this.set_token_program_account_idx(value);
  }

  get_swap_fee_bps(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_swap_fee_bps(value: number): void {
    const offset = 16;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get swap_fee_bps(): number {
    return this.get_swap_fee_bps();
  }

  set swap_fee_bps(value: number) {
    this.set_swap_fee_bps(value);
  }

  get_lp_mint_seed(): Seed32 {
    const offset = 18;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_lp_mint_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 18;
    this.buffer.set(sourceBytes, offset);
  }

  get lp_mint_seed(): Seed32 {
    return this.get_lp_mint_seed();
  }

  set lp_mint_seed(value: Seed32) {
    this.set_lp_mint_seed(value);
  }

  get_pool_proof_size(): bigint {
    const offset = 50;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_pool_proof_size(value: bigint): void {
    const offset = 50;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get pool_proof_size(): bigint {
    return this.get_pool_proof_size();
  }

  set pool_proof_size(value: bigint) {
    this.set_pool_proof_size(value);
  }

  get_lp_mint_proof_size(): bigint {
    const offset = 58;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lp_mint_proof_size(value: bigint): void {
    const offset = 58;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lp_mint_proof_size(): bigint {
    return this.get_lp_mint_proof_size();
  }

  set lp_mint_proof_size(value: bigint) {
    this.set_lp_mint_proof_size(value);
  }

  get_vault_one_proof_size(): bigint {
    const offset = 66;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_vault_one_proof_size(value: bigint): void {
    const offset = 66;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get vault_one_proof_size(): bigint {
    return this.get_vault_one_proof_size();
  }

  set vault_one_proof_size(value: bigint) {
    this.set_vault_one_proof_size(value);
  }

  get_vault_two_proof_size(): bigint {
    const offset = 74;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_vault_two_proof_size(value: bigint): void {
    const offset = 74;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get vault_two_proof_size(): bigint {
    return this.get_vault_two_proof_size();
  }

  set vault_two_proof_size(value: bigint) {
    this.set_vault_two_proof_size(value);
  }

  get_pool_proof_length(): number {
    return this.__tnResolveFieldRef("pool_proof_size");
  }

  get_pool_proof_at(index: number): number {
    const offset = 82;
    return this.view.getUint8(offset + index * 1);
  }

  get_pool_proof(): number[] {
    const len = this.get_pool_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_pool_proof_at(i));
    }
    return result;
  }

  set_pool_proof_at(index: number, value: number): void {
    const offset = 82;
    this.view.setUint8((offset + index * 1), value);
  }

  set_pool_proof(value: number[]): void {
    const len = Math.min(this.get_pool_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_pool_proof_at(i, value[i]);
    }
  }

  get pool_proof(): number[] {
    return this.get_pool_proof();
  }

  set pool_proof(value: number[]) {
    this.set_pool_proof(value);
  }

  get_lp_mint_proof_length(): number {
    return this.__tnResolveFieldRef("lp_mint_proof_size");
  }

  get_lp_mint_proof_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("lp_mint_proof");
    return this.view.getUint8(offset + index * 1);
  }

  get_lp_mint_proof(): number[] {
    const len = this.get_lp_mint_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_lp_mint_proof_at(i));
    }
    return result;
  }

  set_lp_mint_proof_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("lp_mint_proof");
    this.view.setUint8((offset + index * 1), value);
  }

  set_lp_mint_proof(value: number[]): void {
    const len = Math.min(this.get_lp_mint_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_lp_mint_proof_at(i, value[i]);
    }
  }

  get lp_mint_proof(): number[] {
    return this.get_lp_mint_proof();
  }

  set lp_mint_proof(value: number[]) {
    this.set_lp_mint_proof(value);
  }

  get_vault_one_proof_length(): number {
    return this.__tnResolveFieldRef("vault_one_proof_size");
  }

  get_vault_one_proof_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("vault_one_proof");
    return this.view.getUint8(offset + index * 1);
  }

  get_vault_one_proof(): number[] {
    const len = this.get_vault_one_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_vault_one_proof_at(i));
    }
    return result;
  }

  set_vault_one_proof_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("vault_one_proof");
    this.view.setUint8((offset + index * 1), value);
  }

  set_vault_one_proof(value: number[]): void {
    const len = Math.min(this.get_vault_one_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_vault_one_proof_at(i, value[i]);
    }
  }

  get vault_one_proof(): number[] {
    return this.get_vault_one_proof();
  }

  set vault_one_proof(value: number[]) {
    this.set_vault_one_proof(value);
  }

  get_vault_two_proof_length(): number {
    return this.__tnResolveFieldRef("vault_two_proof_size");
  }

  get_vault_two_proof_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("vault_two_proof");
    return this.view.getUint8(offset + index * 1);
  }

  get_vault_two_proof(): number[] {
    const len = this.get_vault_two_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_vault_two_proof_at(i));
    }
    return result;
  }

  set_vault_two_proof_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("vault_two_proof");
    this.view.setUint8((offset + index * 1), value);
  }

  set_vault_two_proof(value: number[]): void {
    const len = Math.min(this.get_vault_two_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_vault_two_proof_at(i, value[i]);
    }
  }

  get vault_two_proof(): number[] {
    return this.get_vault_two_proof();
  }

  set vault_two_proof(value: number[]) {
    this.set_vault_two_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AmmInitPoolInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmInitPoolInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(lp_mint_proof_lp_mint_proof_size: number | bigint, pool_proof_pool_proof_size: number | bigint, vault_one_proof_vault_one_proof_size: number | bigint, vault_two_proof_vault_two_proof_size: number | bigint): bigint {
    const params = AmmInitPoolInstruction.Params.fromValues({
      lp_mint_proof_lp_mint_proof_size: lp_mint_proof_lp_mint_proof_size,
      pool_proof_pool_proof_size: pool_proof_pool_proof_size,
      vault_one_proof_vault_one_proof_size: vault_one_proof_vault_one_proof_size,
      vault_two_proof_vault_two_proof_size: vault_two_proof_vault_two_proof_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: AmmInitPoolInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["lp_mint_proof.lp_mint_proof_size"] = params.lp_mint_proof_lp_mint_proof_size;
    record["pool_proof.pool_proof_size"] = params.pool_proof_pool_proof_size;
    record["vault_one_proof.vault_one_proof_size"] = params.vault_one_proof_vault_one_proof_size;
    record["vault_two_proof.vault_two_proof_size"] = params.vault_two_proof_vault_two_proof_size;
    return record;
  }

  static footprintIrFromParams(params: AmmInitPoolInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: AmmInitPoolInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmInitPoolInstruction');
    return __tnBigIntToNumber(irResult, 'AmmInitPoolInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { lp_mint_proof_lp_mint_proof_size: number | bigint, pool_proof_pool_proof_size: number | bigint, vault_one_proof_vault_one_proof_size: number | bigint, vault_two_proof_vault_two_proof_size: number | bigint }): number {
    const params = AmmInitPoolInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: AmmInitPoolInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: AmmInitPoolInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: AmmInitPoolInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AmmInitPoolInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AmmInitPoolInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: AmmInitPoolInstruction.Params }): AmmInitPoolInstruction | null {
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
    const state = new AmmInitPoolInstruction(buffer, cached);
    return state;
  }


}

export namespace AmmInitPoolInstruction {
  export type Params = {
    /** ABI path: lp_mint_proof.lp_mint_proof_size */
    readonly lp_mint_proof_lp_mint_proof_size: bigint;
    /** ABI path: pool_proof.pool_proof_size */
    readonly pool_proof_pool_proof_size: bigint;
    /** ABI path: vault_one_proof.vault_one_proof_size */
    readonly vault_one_proof_vault_one_proof_size: bigint;
    /** ABI path: vault_two_proof.vault_two_proof_size */
    readonly vault_two_proof_vault_two_proof_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    lp_mint_proof_lp_mint_proof_size: "lp_mint_proof.lp_mint_proof_size",
    pool_proof_pool_proof_size: "pool_proof.pool_proof_size",
    vault_one_proof_vault_one_proof_size: "vault_one_proof.vault_one_proof_size",
    vault_two_proof_vault_two_proof_size: "vault_two_proof.vault_two_proof_size",
  } as const);

  export const Params = {
    fromValues(input: { lp_mint_proof_lp_mint_proof_size: number | bigint, pool_proof_pool_proof_size: number | bigint, vault_one_proof_vault_one_proof_size: number | bigint, vault_two_proof_vault_two_proof_size: number | bigint }): Params {
      return {
        lp_mint_proof_lp_mint_proof_size: __tnToBigInt(input.lp_mint_proof_lp_mint_proof_size),
        pool_proof_pool_proof_size: __tnToBigInt(input.pool_proof_pool_proof_size),
        vault_one_proof_vault_one_proof_size: __tnToBigInt(input.vault_one_proof_vault_one_proof_size),
        vault_two_proof_vault_two_proof_size: __tnToBigInt(input.vault_two_proof_vault_two_proof_size),
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

  export function params(input: { lp_mint_proof_lp_mint_proof_size: number | bigint, pool_proof_pool_proof_size: number | bigint, vault_one_proof_vault_one_proof_size: number | bigint, vault_two_proof_vault_two_proof_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class AmmInitPoolInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: AmmInitPoolInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: AmmInitPoolInstruction.Params | null = null;
  private __tnFam_pool_proof: Uint8Array | null = null;
  private __tnFam_pool_proofCount: number | null = null;
  private __tnFamWriter_pool_proof?: __TnFamWriterResult<AmmInitPoolInstructionBuilder>;
  private __tnFam_lp_mint_proof: Uint8Array | null = null;
  private __tnFam_lp_mint_proofCount: number | null = null;
  private __tnFamWriter_lp_mint_proof?: __TnFamWriterResult<AmmInitPoolInstructionBuilder>;
  private __tnFam_vault_one_proof: Uint8Array | null = null;
  private __tnFam_vault_one_proofCount: number | null = null;
  private __tnFamWriter_vault_one_proof?: __TnFamWriterResult<AmmInitPoolInstructionBuilder>;
  private __tnFam_vault_two_proof: Uint8Array | null = null;
  private __tnFam_vault_two_proofCount: number | null = null;
  private __tnFamWriter_vault_two_proof?: __TnFamWriterResult<AmmInitPoolInstructionBuilder>;

  constructor() {
    this.buffer = new Uint8Array(82);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_payer_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_pool_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_lp_mint_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_vault_one_account_idx(value: number): this {
    this.view.setUint16(6, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_vault_two_account_idx(value: number): this {
    this.view.setUint16(8, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_mint_one_account_idx(value: number): this {
    this.view.setUint16(10, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_mint_two_account_idx(value: number): this {
    this.view.setUint16(12, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_token_program_account_idx(value: number): this {
    this.view.setUint16(14, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_swap_fee_bps(value: number): this {
    this.view.setUint16(16, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_lp_mint_seed(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("lp_mint_seed expects 32 bytes");
    this.buffer.set(value, 18);
    this.__tnInvalidate();
    return this;
  }

  set_pool_proof_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(50, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_lp_mint_proof_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(58, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_vault_one_proof_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(66, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_vault_two_proof_size(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(74, cast, true);
    this.__tnInvalidate();
    return this;
  }

  pool_proof(): __TnFamWriterResult<AmmInitPoolInstructionBuilder> {
    if (!this.__tnFamWriter_pool_proof) {
      this.__tnFamWriter_pool_proof = __tnCreateFamWriter(this, "pool_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_pool_proof = bytes;
        this.__tnFam_pool_proofCount = elementCount;
        this.set_pool_proof_size(__tnToBigInt(elementCount));
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_pool_proof!;
  }

  lp_mint_proof(): __TnFamWriterResult<AmmInitPoolInstructionBuilder> {
    if (!this.__tnFamWriter_lp_mint_proof) {
      this.__tnFamWriter_lp_mint_proof = __tnCreateFamWriter(this, "lp_mint_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_lp_mint_proof = bytes;
        this.__tnFam_lp_mint_proofCount = elementCount;
        this.set_lp_mint_proof_size(__tnToBigInt(elementCount));
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_lp_mint_proof!;
  }

  vault_one_proof(): __TnFamWriterResult<AmmInitPoolInstructionBuilder> {
    if (!this.__tnFamWriter_vault_one_proof) {
      this.__tnFamWriter_vault_one_proof = __tnCreateFamWriter(this, "vault_one_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_vault_one_proof = bytes;
        this.__tnFam_vault_one_proofCount = elementCount;
        this.set_vault_one_proof_size(__tnToBigInt(elementCount));
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_vault_one_proof!;
  }

  vault_two_proof(): __TnFamWriterResult<AmmInitPoolInstructionBuilder> {
    if (!this.__tnFamWriter_vault_two_proof) {
      this.__tnFamWriter_vault_two_proof = __tnCreateFamWriter(this, "vault_two_proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_vault_two_proof = bytes;
        this.__tnFam_vault_two_proofCount = elementCount;
        this.set_vault_two_proof_size(__tnToBigInt(elementCount));
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_vault_two_proof!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = AmmInitPoolInstruction.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = AmmInitPoolInstruction.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("AmmInitPoolInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): AmmInitPoolInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = AmmInitPoolInstruction.from_array(buffer, { params });
    if (!view) throw new Error("AmmInitPoolInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): AmmInitPoolInstruction {
    return this.finish();
  }

  dynamicParams(): AmmInitPoolInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): AmmInitPoolInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = AmmInitPoolInstruction.Params.fromValues({
      lp_mint_proof_lp_mint_proof_size: (() => { if (this.__tnFam_lp_mint_proofCount === null) throw new Error("AmmInitPoolInstructionBuilder: field 'lp_mint_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_lp_mint_proofCount); })(),
      pool_proof_pool_proof_size: (() => { if (this.__tnFam_pool_proofCount === null) throw new Error("AmmInitPoolInstructionBuilder: field 'pool_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_pool_proofCount); })(),
      vault_one_proof_vault_one_proof_size: (() => { if (this.__tnFam_vault_one_proofCount === null) throw new Error("AmmInitPoolInstructionBuilder: field 'vault_one_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_vault_one_proofCount); })(),
      vault_two_proof_vault_two_proof_size: (() => { if (this.__tnFam_vault_two_proofCount === null) throw new Error("AmmInitPoolInstructionBuilder: field 'vault_two_proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_vault_two_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_pool_proof_bytes = this.__tnFam_pool_proof;
    if (!__tnLocal_pool_proof_bytes) throw new Error("AmmInitPoolInstructionBuilder: field 'pool_proof' must be written before build");
    target.set(__tnLocal_pool_proof_bytes, cursor);
    cursor += __tnLocal_pool_proof_bytes.length;
    const __tnLocal_lp_mint_proof_bytes = this.__tnFam_lp_mint_proof;
    if (!__tnLocal_lp_mint_proof_bytes) throw new Error("AmmInitPoolInstructionBuilder: field 'lp_mint_proof' must be written before build");
    target.set(__tnLocal_lp_mint_proof_bytes, cursor);
    cursor += __tnLocal_lp_mint_proof_bytes.length;
    const __tnLocal_vault_one_proof_bytes = this.__tnFam_vault_one_proof;
    if (!__tnLocal_vault_one_proof_bytes) throw new Error("AmmInitPoolInstructionBuilder: field 'vault_one_proof' must be written before build");
    target.set(__tnLocal_vault_one_proof_bytes, cursor);
    cursor += __tnLocal_vault_one_proof_bytes.length;
    const __tnLocal_vault_two_proof_bytes = this.__tnFam_vault_two_proof;
    if (!__tnLocal_vault_two_proof_bytes) throw new Error("AmmInitPoolInstructionBuilder: field 'vault_two_proof' must be written before build");
    target.set(__tnLocal_vault_two_proof_bytes, cursor);
    cursor += __tnLocal_vault_two_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: AmmInitPoolInstruction.Params): void {
    const result = AmmInitPoolInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ AmmInitPoolInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("AmmInitPoolInstruction", (params) => AmmInitPoolInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmInitPoolInstruction", (buffer, params) => AmmInitPoolInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmInitPoolInstruction", (buffer) => { const result = AmmInitPoolInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AmmInstruction ----- */

const __tn_ir_AmmInstruction = {
  typeName: "AmmInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 4, node: { op: "const", value: 4n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class AmmInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): AmmInstruction_payload_Inner {
    return new AmmInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInitPool(): AmmInitPoolInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return AmmInitPoolInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAddLiquidity(): AmmAddLiquidityInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return AmmAddLiquidityInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asWithdrawLiquidity(): AmmWithdrawLiquidityInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return AmmWithdrawLiquidityInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSwap(): AmmSwapInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return AmmSwapInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class AmmInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 4;
  private __tnParams: AmmInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: AmmInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = AmmInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("AmmInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: AmmInstruction.Params, fieldContext?: Record<string, number | bigint> }): AmmInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("AmmInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = AmmInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("AmmInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new AmmInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): AmmInstruction.Params {
    return this.__tnParams;
  }

  static builder(): AmmInstructionBuilder {
    return new AmmInstructionBuilder();
  }

  static fromBuilder(builder: AmmInstructionBuilder): AmmInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return AmmInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "init_pool",
      tag: 0,
      payloadSize: null,
      payloadType: "AmmInstruction::payload::init_pool",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AmmInitPoolInstruction),
    },
    {
      name: "add_liquidity",
      tag: 1,
      payloadSize: 34,
      payloadType: "AmmInstruction::payload::add_liquidity",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AmmAddLiquidityInstruction),
    },
    {
      name: "withdraw_liquidity",
      tag: 2,
      payloadSize: 26,
      payloadType: "AmmInstruction::payload::withdraw_liquidity",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AmmWithdrawLiquidityInstruction),
    },
    {
      name: "swap",
      tag: 3,
      payloadSize: 24,
      payloadType: "AmmInstruction::payload::swap",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AmmSwapInstruction),
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: AmmInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_payload_discriminant = __tnToBigInt(view.getUint32(0, true));
    const __tnLayout = AmmInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = AmmInstruction.Params.fromValues({
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

  payloadVariant(): typeof AmmInstruction.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return AmmInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): AmmInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("AmmInstruction: unknown payload variant");
    const offset = AmmInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("AmmInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return AmmInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AmmInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_discriminant: number | bigint, payload_payload_size: number | bigint): bigint {
    const params = AmmInstruction.Params.fromValues({
      payload_discriminant: payload_discriminant,
      payload_payload_size: payload_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: AmmInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.discriminant"] = params.payload_discriminant;
    record["payload.payload_size"] = params.payload_payload_size;
    return record;
  }

  static footprintIrFromParams(params: AmmInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: AmmInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmInstruction');
    return __tnBigIntToNumber(irResult, 'AmmInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_discriminant: number | bigint, payload_payload_size: number | bigint }): number {
    const params = AmmInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: AmmInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: AmmInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: AmmInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AmmInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AmmInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: AmmInstruction.Params }): AmmInstruction | null {
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
    const state = new AmmInstruction(buffer, cached);
    return state;
  }


}

export namespace AmmInstruction {
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

export class AmmInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_discriminant: number | null = null;
  private __tnPayload_payload: { descriptor: typeof AmmInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: AmmInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: AmmInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<AmmInstructionBuilder>;

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
    this.__tnField_discriminant = value & 0xff;
    this.__tnInvalidate();
  }

  set_discriminant(value: number): this {
    this.__tnAssign_discriminant(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<AmmInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, AmmInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_discriminant(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("AmmInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AmmInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = AmmInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_discriminant === null) throw new Error("AmmInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AmmInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = AmmInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("AmmInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): AmmInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = AmmInstruction.from_array(buffer, { params });
    if (!view) throw new Error("AmmInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): AmmInstruction {
    return this.finish();
  }

  dynamicParams(): AmmInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): AmmInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = AmmInstruction.Params.fromValues({
      payload_discriminant: (() => { if (this.__tnField_discriminant === null) throw new Error("AmmInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_discriminant); })(),
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("AmmInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_discriminant === null) throw new Error("AmmInstructionBuilder: field 'discriminant' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AmmInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint32(0, this.__tnField_discriminant, true);
    target.set(this.__tnPayload_payload.bytes, 4);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: AmmInstruction.Params): void {
    const result = AmmInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ AmmInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("AmmInstruction", (params) => AmmInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmInstruction", (buffer, params) => AmmInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmInstruction", (buffer) => { const result = AmmInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AmmPoolMetadata ----- */

const __tn_ir_AmmPoolMetadata = {
  typeName: "AmmPoolMetadata",
  root: { op: "const", value: 203n }
} as const;

export class AmmPoolMetadata {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AmmPoolMetadata {
    if (!buffer || buffer.length === undefined) throw new Error("AmmPoolMetadata.__tnCreateView requires a Uint8Array");
    return new AmmPoolMetadata(new Uint8Array(buffer));
  }

  static builder(): AmmPoolMetadataBuilder {
    return new AmmPoolMetadataBuilder();
  }

  static fromBuilder(builder: AmmPoolMetadataBuilder): AmmPoolMetadata | null {
    const buffer = builder.build();
    return AmmPoolMetadata.from_array(buffer);
  }

  get_is_initialized(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_is_initialized(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get is_initialized(): number {
    return this.get_is_initialized();
  }

  set is_initialized(value: number) {
    this.set_is_initialized(value);
  }

  get_locked_lp_supply(): bigint {
    const offset = 1;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_locked_lp_supply(value: bigint): void {
    const offset = 1;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get locked_lp_supply(): bigint {
    return this.get_locked_lp_supply();
  }

  set locked_lp_supply(value: bigint) {
    this.set_locked_lp_supply(value);
  }

  get_swap_fee_bps(): number {
    const offset = 9;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_swap_fee_bps(value: number): void {
    const offset = 9;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get swap_fee_bps(): number {
    return this.get_swap_fee_bps();
  }

  set swap_fee_bps(value: number) {
    this.set_swap_fee_bps(value);
  }

  get_swap_pool_authority(): Pubkey {
    const offset = 11;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_swap_pool_authority(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 11;
    this.buffer.set(sourceBytes, offset);
  }

  get swap_pool_authority(): Pubkey {
    return this.get_swap_pool_authority();
  }

  set swap_pool_authority(value: Pubkey) {
    this.set_swap_pool_authority(value);
  }

  get_mint_one(): Pubkey {
    const offset = 43;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint_one(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 43;
    this.buffer.set(sourceBytes, offset);
  }

  get mint_one(): Pubkey {
    return this.get_mint_one();
  }

  set mint_one(value: Pubkey) {
    this.set_mint_one(value);
  }

  get_mint_two(): Pubkey {
    const offset = 75;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint_two(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 75;
    this.buffer.set(sourceBytes, offset);
  }

  get mint_two(): Pubkey {
    return this.get_mint_two();
  }

  set mint_two(value: Pubkey) {
    this.set_mint_two(value);
  }

  get_vault_one(): Pubkey {
    const offset = 107;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault_one(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 107;
    this.buffer.set(sourceBytes, offset);
  }

  get vault_one(): Pubkey {
    return this.get_vault_one();
  }

  set vault_one(value: Pubkey) {
    this.set_vault_one(value);
  }

  get_vault_two(): Pubkey {
    const offset = 139;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault_two(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 139;
    this.buffer.set(sourceBytes, offset);
  }

  get vault_two(): Pubkey {
    return this.get_vault_two();
  }

  set vault_two(value: Pubkey) {
    this.set_vault_two(value);
  }

  get_lp_mint(): Pubkey {
    const offset = 171;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_lp_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 171;
    this.buffer.set(sourceBytes, offset);
  }

  get lp_mint(): Pubkey {
    return this.get_lp_mint();
  }

  set lp_mint(value: Pubkey) {
    this.set_lp_mint(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AmmPoolMetadata.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmPoolMetadata, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmPoolMetadata');
    }
    return __tnBigIntToNumber(irResult, 'AmmPoolMetadata::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 203) return { ok: false, code: "tn.buffer_too_small", consumed: 203 };
    return { ok: true, consumed: 203 };
  }

  static from_array(buffer: Uint8Array): AmmPoolMetadata | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AmmPoolMetadata(buffer);
  }

}

export class AmmPoolMetadataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(203);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_is_initialized(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_locked_lp_supply(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(1, cast, true);
    return this;
  }

  set_swap_fee_bps(value: number): this {
    this.view.setUint16(9, value, true);
    return this;
  }

  set_swap_pool_authority(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("swap_pool_authority expects 32 bytes");
    this.buffer.set(value, 11);
    return this;
  }

  set_mint_one(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint_one expects 32 bytes");
    this.buffer.set(value, 43);
    return this;
  }

  set_mint_two(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint_two expects 32 bytes");
    this.buffer.set(value, 75);
    return this;
  }

  set_vault_one(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault_one expects 32 bytes");
    this.buffer.set(value, 107);
    return this;
  }

  set_vault_two(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault_two expects 32 bytes");
    this.buffer.set(value, 139);
    return this;
  }

  set_lp_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("lp_mint expects 32 bytes");
    this.buffer.set(value, 171);
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

  finish(): AmmPoolMetadata {
    const view = AmmPoolMetadata.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AmmPoolMetadata");
    return view;
  }
}

__tnRegisterFootprint("AmmPoolMetadata", (params) => AmmPoolMetadata.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmPoolMetadata", (buffer, params) => AmmPoolMetadata.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmPoolMetadata", (buffer) => { const result = AmmPoolMetadata.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR BurnEventData ----- */

const __tn_ir_BurnEventData = {
  typeName: "BurnEventData",
  root: { op: "const", value: 128n }
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

  get_pool(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_pool(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get pool(): Pubkey {
    return this.get_pool();
  }

  set pool(value: Pubkey) {
    this.set_pool(value);
  }

  get_sender(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_sender(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get sender(): Pubkey {
    return this.get_sender();
  }

  set sender(value: Pubkey) {
    this.set_sender(value);
  }

  get_to(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_to(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get to(): Pubkey {
    return this.get_to();
  }

  set to(value: Pubkey) {
    this.set_to(value);
  }

  get_amount_one(): bigint {
    const offset = 96;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount_one(value: bigint): void {
    const offset = 96;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount_one(): bigint {
    return this.get_amount_one();
  }

  set amount_one(value: bigint) {
    this.set_amount_one(value);
  }

  get_amount_two(): bigint {
    const offset = 104;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount_two(value: bigint): void {
    const offset = 104;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount_two(): bigint {
    return this.get_amount_two();
  }

  set amount_two(value: bigint) {
    this.set_amount_two(value);
  }

  get_lp_burned(): bigint {
    const offset = 112;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lp_burned(value: bigint): void {
    const offset = 112;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lp_burned(): bigint {
    return this.get_lp_burned();
  }

  set lp_burned(value: bigint) {
    this.set_lp_burned(value);
  }

  get_lp_total_supply(): bigint {
    const offset = 120;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lp_total_supply(value: bigint): void {
    const offset = 120;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lp_total_supply(): bigint {
    return this.get_lp_total_supply();
  }

  set lp_total_supply(value: bigint) {
    this.set_lp_total_supply(value);
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
    if (buffer.length < 128) return { ok: false, code: "tn.buffer_too_small", consumed: 128 };
    return { ok: true, consumed: 128 };
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
    this.buffer = new Uint8Array(128);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("pool expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_sender(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("sender expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_to(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("to expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_amount_one(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_amount_two(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_lp_burned(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(112, cast, true);
    return this;
  }

  set_lp_total_supply(value: bigint): this {
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

  finish(): BurnEventData {
    const view = BurnEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BurnEventData");
    return view;
  }
}

__tnRegisterFootprint("BurnEventData", (params) => BurnEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("BurnEventData", (buffer, params) => BurnEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("BurnEventData", (buffer) => { const result = BurnEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR MintEventData ----- */

const __tn_ir_MintEventData = {
  typeName: "MintEventData",
  root: { op: "const", value: 96n }
} as const;

export class MintEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): MintEventData {
    if (!buffer || buffer.length === undefined) throw new Error("MintEventData.__tnCreateView requires a Uint8Array");
    return new MintEventData(new Uint8Array(buffer));
  }

  static builder(): MintEventDataBuilder {
    return new MintEventDataBuilder();
  }

  static fromBuilder(builder: MintEventDataBuilder): MintEventData | null {
    const buffer = builder.build();
    return MintEventData.from_array(buffer);
  }

  get_pool(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_pool(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get pool(): Pubkey {
    return this.get_pool();
  }

  set pool(value: Pubkey) {
    this.set_pool(value);
  }

  get_sender(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_sender(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get sender(): Pubkey {
    return this.get_sender();
  }

  set sender(value: Pubkey) {
    this.set_sender(value);
  }

  get_amount_one(): bigint {
    const offset = 64;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount_one(value: bigint): void {
    const offset = 64;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount_one(): bigint {
    return this.get_amount_one();
  }

  set amount_one(value: bigint) {
    this.set_amount_one(value);
  }

  get_amount_two(): bigint {
    const offset = 72;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount_two(value: bigint): void {
    const offset = 72;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount_two(): bigint {
    return this.get_amount_two();
  }

  set amount_two(value: bigint) {
    this.set_amount_two(value);
  }

  get_lp_minted(): bigint {
    const offset = 80;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lp_minted(value: bigint): void {
    const offset = 80;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lp_minted(): bigint {
    return this.get_lp_minted();
  }

  set lp_minted(value: bigint) {
    this.set_lp_minted(value);
  }

  get_lp_total_supply(): bigint {
    const offset = 88;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_lp_total_supply(value: bigint): void {
    const offset = 88;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get lp_total_supply(): bigint {
    return this.get_lp_total_supply();
  }

  set lp_total_supply(value: bigint) {
    this.set_lp_total_supply(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_MintEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_MintEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for MintEventData');
    }
    return __tnBigIntToNumber(irResult, 'MintEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 96) return { ok: false, code: "tn.buffer_too_small", consumed: 96 };
    return { ok: true, consumed: 96 };
  }

  static from_array(buffer: Uint8Array): MintEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new MintEventData(buffer);
  }

}

export class MintEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(96);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("pool expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_sender(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("sender expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_amount_one(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_amount_two(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(72, cast, true);
    return this;
  }

  set_lp_minted(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(80, cast, true);
    return this;
  }

  set_lp_total_supply(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(88, cast, true);
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

  finish(): MintEventData {
    const view = MintEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MintEventData");
    return view;
  }
}

__tnRegisterFootprint("MintEventData", (params) => MintEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("MintEventData", (buffer, params) => MintEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("MintEventData", (buffer) => { const result = MintEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR PoolInitEventData ----- */

const __tn_ir_PoolInitEventData = {
  typeName: "PoolInitEventData",
  root: { op: "const", value: 194n }
} as const;

export class PoolInitEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): PoolInitEventData {
    if (!buffer || buffer.length === undefined) throw new Error("PoolInitEventData.__tnCreateView requires a Uint8Array");
    return new PoolInitEventData(new Uint8Array(buffer));
  }

  static builder(): PoolInitEventDataBuilder {
    return new PoolInitEventDataBuilder();
  }

  static fromBuilder(builder: PoolInitEventDataBuilder): PoolInitEventData | null {
    const buffer = builder.build();
    return PoolInitEventData.from_array(buffer);
  }

  get_pool(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_pool(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get pool(): Pubkey {
    return this.get_pool();
  }

  set pool(value: Pubkey) {
    this.set_pool(value);
  }

  get_mint_one(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint_one(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get mint_one(): Pubkey {
    return this.get_mint_one();
  }

  set mint_one(value: Pubkey) {
    this.set_mint_one(value);
  }

  get_mint_two(): Pubkey {
    const offset = 64;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_mint_two(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 64;
    this.buffer.set(sourceBytes, offset);
  }

  get mint_two(): Pubkey {
    return this.get_mint_two();
  }

  set mint_two(value: Pubkey) {
    this.set_mint_two(value);
  }

  get_lp_mint(): Pubkey {
    const offset = 96;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_lp_mint(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 96;
    this.buffer.set(sourceBytes, offset);
  }

  get lp_mint(): Pubkey {
    return this.get_lp_mint();
  }

  set lp_mint(value: Pubkey) {
    this.set_lp_mint(value);
  }

  get_vault_one(): Pubkey {
    const offset = 128;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault_one(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 128;
    this.buffer.set(sourceBytes, offset);
  }

  get vault_one(): Pubkey {
    return this.get_vault_one();
  }

  set vault_one(value: Pubkey) {
    this.set_vault_one(value);
  }

  get_vault_two(): Pubkey {
    const offset = 160;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_vault_two(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 160;
    this.buffer.set(sourceBytes, offset);
  }

  get vault_two(): Pubkey {
    return this.get_vault_two();
  }

  set vault_two(value: Pubkey) {
    this.set_vault_two(value);
  }

  get_swap_fee_bps(): number {
    const offset = 192;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_swap_fee_bps(value: number): void {
    const offset = 192;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get swap_fee_bps(): number {
    return this.get_swap_fee_bps();
  }

  set swap_fee_bps(value: number) {
    this.set_swap_fee_bps(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PoolInitEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PoolInitEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PoolInitEventData');
    }
    return __tnBigIntToNumber(irResult, 'PoolInitEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 194) return { ok: false, code: "tn.buffer_too_small", consumed: 194 };
    return { ok: true, consumed: 194 };
  }

  static from_array(buffer: Uint8Array): PoolInitEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new PoolInitEventData(buffer);
  }

}

export class PoolInitEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(194);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pool(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("pool expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_mint_one(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint_one expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_mint_two(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("mint_two expects 32 bytes");
    this.buffer.set(value, 64);
    return this;
  }

  set_lp_mint(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("lp_mint expects 32 bytes");
    this.buffer.set(value, 96);
    return this;
  }

  set_vault_one(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault_one expects 32 bytes");
    this.buffer.set(value, 128);
    return this;
  }

  set_vault_two(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("vault_two expects 32 bytes");
    this.buffer.set(value, 160);
    return this;
  }

  set_swap_fee_bps(value: number): this {
    this.view.setUint16(192, value, true);
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

  finish(): PoolInitEventData {
    const view = PoolInitEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build PoolInitEventData");
    return view;
  }
}

__tnRegisterFootprint("PoolInitEventData", (params) => PoolInitEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("PoolInitEventData", (buffer, params) => PoolInitEventData.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("PoolInitEventData", (buffer) => { const result = PoolInitEventData.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR AmmEvent ----- */

const __tn_ir_AmmEvent = {
  typeName: "AmmEvent",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "AmmEvent::payload.event_type", cases: [{ value: 0, node: { op: "align", alignment: 1, node: { op: "const", value: 194n } } }, { value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 96n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 128n } } }, { value: 3, node: { op: "align", alignment: 1, node: { op: "const", value: 113n } } }, { value: 4, node: { op: "align", alignment: 1, node: { op: "const", value: 48n } } }] } } } }
} as const;

export class AmmEvent_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): AmmEvent_payload_Inner {
    return new AmmEvent_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asPoolInit(): PoolInitEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return PoolInitEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMint(): MintEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return MintEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBurn(): BurnEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return BurnEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSwap(): SwapEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return SwapEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSync(): SyncEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return SyncEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class AmmEvent {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: AmmEvent.Params;

  private constructor(private buffer: Uint8Array, params?: AmmEvent.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = AmmEvent.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("AmmEvent: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: AmmEvent.Params, fieldContext?: Record<string, number | bigint> }): AmmEvent {
    if (!buffer || buffer.length === undefined) throw new Error("AmmEvent.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = AmmEvent.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("AmmEvent.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new AmmEvent(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): AmmEvent.Params {
    return this.__tnParams;
  }

  static builder(): AmmEventBuilder {
    return new AmmEventBuilder();
  }

  static fromBuilder(builder: AmmEventBuilder): AmmEvent | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return AmmEvent.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "pool_init",
      tag: 0,
      payloadSize: 194,
      payloadType: "AmmEvent::payload::pool_init",
      createPayloadBuilder: () => __tnMaybeCallBuilder(PoolInitEventData),
    },
    {
      name: "mint",
      tag: 1,
      payloadSize: 96,
      payloadType: "AmmEvent::payload::mint",
      createPayloadBuilder: () => __tnMaybeCallBuilder(MintEventData),
    },
    {
      name: "burn",
      tag: 2,
      payloadSize: 128,
      payloadType: "AmmEvent::payload::burn",
      createPayloadBuilder: () => __tnMaybeCallBuilder(BurnEventData),
    },
    {
      name: "swap",
      tag: 3,
      payloadSize: 113,
      payloadType: "AmmEvent::payload::swap",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SwapEventData),
    },
    {
      name: "sync",
      tag: 4,
      payloadSize: 48,
      payloadType: "AmmEvent::payload::sync",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SyncEventData),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: AmmEvent.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_event_type = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = AmmEvent.Params.fromValues({
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

  payloadVariant(): typeof AmmEvent.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return AmmEvent.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): AmmEvent_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("AmmEvent: unknown payload variant");
    const offset = AmmEvent.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("AmmEvent: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return AmmEvent_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AmmEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AmmEvent, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_event_type: number | bigint): bigint {
    const params = AmmEvent.Params.fromValues({
      payload_event_type: payload_event_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: AmmEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.event_type"] = params.payload_event_type;
    record["AmmEvent::payload.event_type"] = params.payload_event_type;
    return record;
  }

  static footprintIrFromParams(params: AmmEvent.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: AmmEvent.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AmmEvent');
    return __tnBigIntToNumber(irResult, 'AmmEvent::footprintFromParams');
  }

  static footprintFromValues(input: { payload_event_type: number | bigint }): number {
    const params = AmmEvent.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: AmmEvent.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: AmmEvent.Params }): { ok: boolean; code?: string; consumed?: number; params?: AmmEvent.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AmmEvent::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'AmmEvent::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: AmmEvent.Params }): AmmEvent | null {
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
    const state = new AmmEvent(buffer, cached);
    return state;
  }


}

export namespace AmmEvent {
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

export class AmmEventBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_event_type: number | null = null;
  private __tnPayload_payload: { descriptor: typeof AmmEvent.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: AmmEvent.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: AmmEvent.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<AmmEventBuilder>;

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
    this.__tnField_event_type = value & 0xff;
    this.__tnInvalidate();
  }

  set_event_type(value: number): this {
    this.__tnAssign_event_type(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<AmmEventBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, AmmEvent.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_event_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("AmmEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AmmEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = AmmEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("AmmEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AmmEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = AmmEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("AmmEventBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): AmmEvent {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = AmmEvent.from_array(buffer, { params });
    if (!view) throw new Error("AmmEventBuilder: failed to finalize view");
    return view;
  }

  finishView(): AmmEvent {
    return this.finish();
  }

  dynamicParams(): AmmEvent.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): AmmEvent.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = AmmEvent.Params.fromValues({
      payload_event_type: (() => { if (this.__tnField_event_type === null) throw new Error("AmmEventBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_event_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_event_type === null) throw new Error("AmmEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("AmmEventBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_event_type);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: AmmEvent.Params): void {
    const result = AmmEvent.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ AmmEvent }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("AmmEvent", (params) => AmmEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("AmmEvent", (buffer, params) => AmmEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AmmEvent", (buffer) => { const result = AmmEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
