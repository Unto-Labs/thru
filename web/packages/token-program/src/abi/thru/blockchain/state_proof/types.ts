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
    };

type __TnIrContext = {
  params: Record<string, bigint>;
  buffer?: Uint8Array;
  typeName?: string;
};

type __TnValidateResult = { ok: boolean; code?: string; consumed?: bigint };
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

function __tnEvalFootprint(node: __TnIrNode, ctx: __TnIrContext): bigint {
  return __tnEvalIrNode(node, ctx);
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
    return { ok: true, value: __tnEvalIrNode(node, ctx) };
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

function __tnEvalIrNode(node: __TnIrNode, ctx: __TnIrContext): bigint {
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
      return __tnCheckedAdd(
        __tnEvalIrNode(node.left, ctx),
        __tnEvalIrNode(node.right, ctx)
      );
    case "mul":
      return __tnCheckedMul(
        __tnEvalIrNode(node.left, ctx),
        __tnEvalIrNode(node.right, ctx)
      );
    case "align":
      return __tnAlign(__tnEvalIrNode(node.node, ctx), node.alignment);
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
          return __tnEvalIrNode(caseNode.node, ctx);
        }
      }
      if (node.default) return __tnEvalIrNode(node.default, ctx);
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
        const nestedResult = __tnInvokeValidate(
          node.typeName,
          ctx.buffer,
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

/* ----- TYPE DEFINITION FOR StateProofHeader ----- */

const __tn_ir_StateProofHeader = {
  typeName: "StateProofHeader",
  root: { op: "const", value: 40n }
} as const;

export class StateProofHeader {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): StateProofHeader {
    if (!buffer || buffer.length === undefined) throw new Error("StateProofHeader.__tnCreateView requires a Uint8Array");
    return new StateProofHeader(new Uint8Array(buffer));
  }

  static builder(): StateProofHeaderBuilder {
    return new StateProofHeaderBuilder();
  }

  static fromBuilder(builder: StateProofHeaderBuilder): StateProofHeader | null {
    const buffer = builder.build();
    return StateProofHeader.from_array(buffer);
  }

  get_type_slot(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_type_slot(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get type_slot(): bigint {
    return this.get_type_slot();
  }

  set type_slot(value: bigint) {
    this.set_type_slot(value);
  }

  get_path_bitset(): Hash {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Hash.from_array(slice)!;
  }

  set_path_bitset(value: Hash): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get path_bitset(): Hash {
    return this.get_path_bitset();
  }

  set path_bitset(value: Hash) {
    this.set_path_bitset(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_StateProofHeader.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_StateProofHeader, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for StateProofHeader');
    }
    return __tnBigIntToNumber(irResult, 'StateProofHeader::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 40) return { ok: false, code: "tn.buffer_too_small", consumed: 40 };
    return { ok: true, consumed: 40 };
  }

  static from_array(buffer: Uint8Array): StateProofHeader | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new StateProofHeader(buffer);
  }

}

__tnRegisterFootprint("StateProofHeader", (params) => StateProofHeader.__tnInvokeFootprint(params));
__tnRegisterValidate("StateProofHeader", (buffer, params) => StateProofHeader.__tnInvokeValidate(buffer, params));

export class StateProofHeaderBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(40);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_type_slot(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_path_bitset(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("path_bitset expects 32 bytes");
    this.buffer.set(value, 8);
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

  finish(): StateProofHeader {
    const view = StateProofHeader.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build StateProofHeader");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR StateProof ----- */

const __tn_ir_StateProof = {
  typeName: "StateProof",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 40n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "proof_body.payload_size" } } } }
} as const;

export class StateProof_proof_body_existing_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;

  private constructor(private buffer: Uint8Array, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): StateProof_proof_body_existing_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("StateProof_proof_body_existing_Inner.__tnCreateView requires a Uint8Array");
    return new StateProof_proof_body_existing_Inner(new Uint8Array(buffer), opts?.fieldContext);
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "StateProof_proof_body_existing_Inner::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "StateProof_proof_body_existing_Inner::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("StateProof_proof_body_existing_Inner: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  get_sibling_hashes_length(): number {
    return ((__tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.0")) + __tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.1"))) + (__tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.2")) + __tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.3"))));
  }

  get_sibling_hashes_at(index: number): Hash {
    const offset = 0;
    const slice = this.buffer.subarray((offset + index * 32), (offset + (index + 1) * 32));
    return Hash.from_array(slice)!;
  }

  get_sibling_hashes(): Hash[] {
    const len = this.get_sibling_hashes_length();
    const result: Hash[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_sibling_hashes_at(i));
    }
    return result;
  }

  set_sibling_hashes_at(index: number, value: Hash): void {
    const offset = 0;
    const slice = this.buffer.subarray(offset + index * 32, offset + (index + 1) * 32);
    slice.set(value['buffer']);
  }

  set_sibling_hashes(value: Hash[]): void {
    const len = Math.min(this.get_sibling_hashes_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_sibling_hashes_at(i, value[i]);
    }
  }

  get sibling_hashes(): Hash[] {
    return this.get_sibling_hashes();
  }

  set sibling_hashes(value: Hash[]) {
    this.set_sibling_hashes(value);
  }

}

export class StateProof_proof_body_updating_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;

  private constructor(private buffer: Uint8Array, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): StateProof_proof_body_updating_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("StateProof_proof_body_updating_Inner.__tnCreateView requires a Uint8Array");
    return new StateProof_proof_body_updating_Inner(new Uint8Array(buffer), opts?.fieldContext);
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "StateProof_proof_body_updating_Inner::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "StateProof_proof_body_updating_Inner::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("StateProof_proof_body_updating_Inner: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  get_existing_leaf_hash(): Hash {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Hash.from_array(slice)!;
  }

  set_existing_leaf_hash(value: Hash): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get existing_leaf_hash(): Hash {
    return this.get_existing_leaf_hash();
  }

  set existing_leaf_hash(value: Hash) {
    this.set_existing_leaf_hash(value);
  }

  get_sibling_hashes_length(): number {
    return ((__tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.0")) + __tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.1"))) + (__tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.2")) + __tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.3"))));
  }

  get_sibling_hashes_at(index: number): Hash {
    const offset = 32;
    const slice = this.buffer.subarray((offset + index * 32), (offset + (index + 1) * 32));
    return Hash.from_array(slice)!;
  }

  get_sibling_hashes(): Hash[] {
    const len = this.get_sibling_hashes_length();
    const result: Hash[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_sibling_hashes_at(i));
    }
    return result;
  }

  set_sibling_hashes_at(index: number, value: Hash): void {
    const offset = 32;
    const slice = this.buffer.subarray(offset + index * 32, offset + (index + 1) * 32);
    slice.set(value['buffer']);
  }

  set_sibling_hashes(value: Hash[]): void {
    const len = Math.min(this.get_sibling_hashes_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_sibling_hashes_at(i, value[i]);
    }
  }

  get sibling_hashes(): Hash[] {
    return this.get_sibling_hashes();
  }

  set sibling_hashes(value: Hash[]) {
    this.set_sibling_hashes(value);
  }

}

export class StateProof_proof_body_creation_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;

  private constructor(private buffer: Uint8Array, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): StateProof_proof_body_creation_Inner {
    if (!buffer || buffer.length === undefined) throw new Error("StateProof_proof_body_creation_Inner.__tnCreateView requires a Uint8Array");
    return new StateProof_proof_body_creation_Inner(new Uint8Array(buffer), opts?.fieldContext);
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "StateProof_proof_body_creation_Inner::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "StateProof_proof_body_creation_Inner::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("StateProof_proof_body_creation_Inner: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  get_existing_leaf_pubkey(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_existing_leaf_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get existing_leaf_pubkey(): Pubkey {
    return this.get_existing_leaf_pubkey();
  }

  set existing_leaf_pubkey(value: Pubkey) {
    this.set_existing_leaf_pubkey(value);
  }

  get_existing_leaf_hash(): Hash {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Hash.from_array(slice)!;
  }

  set_existing_leaf_hash(value: Hash): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get existing_leaf_hash(): Hash {
    return this.get_existing_leaf_hash();
  }

  set existing_leaf_hash(value: Hash) {
    this.set_existing_leaf_hash(value);
  }

  get_sibling_hashes_length(): number {
    return ((__tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.0")) + __tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.1"))) + (__tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.2")) + __tnPopcount(this.__tnResolveFieldRef("hdr.path_bitset.bytes.3"))));
  }

  get_sibling_hashes_at(index: number): Hash {
    const offset = 64;
    const slice = this.buffer.subarray((offset + index * 32), (offset + (index + 1) * 32));
    return Hash.from_array(slice)!;
  }

  get_sibling_hashes(): Hash[] {
    const len = this.get_sibling_hashes_length();
    const result: Hash[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_sibling_hashes_at(i));
    }
    return result;
  }

  set_sibling_hashes_at(index: number, value: Hash): void {
    const offset = 64;
    const slice = this.buffer.subarray(offset + index * 32, offset + (index + 1) * 32);
    slice.set(value['buffer']);
  }

  set_sibling_hashes(value: Hash[]): void {
    const len = Math.min(this.get_sibling_hashes_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_sibling_hashes_at(i, value[i]);
    }
  }

  get sibling_hashes(): Hash[] {
    return this.get_sibling_hashes();
  }

  set sibling_hashes(value: Hash[]) {
    this.set_sibling_hashes(value);
  }

}

export class StateProof_proof_body_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): StateProof_proof_body_Inner {
    return new StateProof_proof_body_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asExisting(): StateProof_proof_body_existing_Inner | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return StateProof_proof_body_existing_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpdating(): StateProof_proof_body_updating_Inner | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return StateProof_proof_body_updating_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreation(): StateProof_proof_body_creation_Inner | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return StateProof_proof_body_creation_Inner.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class StateProof {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private static readonly __tnFieldOffset_proof_body = 40;
  private __tnParams: StateProof.Params;
  private __tnDerivedParams: Record<string, bigint> | null = null;

  private constructor(private buffer: Uint8Array, params?: StateProof.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = StateProof.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("StateProof: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
      this.__tnDerivedParams = derived.derived;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: StateProof.Params, fieldContext?: Record<string, number | bigint> }): StateProof {
    if (!buffer || buffer.length === undefined) throw new Error("StateProof.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    let derivedRecord: Record<string, bigint> | null = null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = StateProof.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("StateProof.__tnCreateView: failed to derive params");
      params = derived.params;
      derivedRecord = derived.derived;
    }
    const instance = new StateProof(new Uint8Array(buffer), params, opts?.fieldContext);
    if (derivedRecord) instance.__tnDerivedParams = derivedRecord;
    return instance;
  }

  dynamicParams(): StateProof.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "StateProof::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "StateProof::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("StateProof: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): StateProofBuilder {
    return new StateProofBuilder();
  }

  static fromBuilder(builder: StateProofBuilder): StateProof | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return StateProof.from_array(buffer, { params });
  }

  static readonly proof_bodyVariantDescriptors = Object.freeze([
    {
      name: "existing",
      tag: 0,
      payloadSize: null,
      payloadType: "StateProof::proof_body::existing",
      createPayloadBuilder: () => null,
    },
    {
      name: "updating",
      tag: 1,
      payloadSize: null,
      payloadType: "StateProof::proof_body::updating",
      createPayloadBuilder: () => null,
    },
    {
      name: "creation",
      tag: 2,
      payloadSize: null,
      payloadType: "StateProof::proof_body::creation",
      createPayloadBuilder: () => null,
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const derived: Record<string, bigint> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnParamSeq_proof_body_payload_size: bigint | null = null;
    let __tnCursorMutable = 0;
    if (__tnLength < 8) return null;
    const __tnRef_hdr_type_slot = view.getBigUint64(0, true);
    if (__tnCursorMutable + 40 > __tnLength) return null;
    __tnCursorMutable += 40;
    const __tnEnumTagValue_proof_body = Math.trunc(Number(((__tnRef_hdr_type_slot >> 62n) & 3n)));
    if (!Number.isFinite(__tnEnumTagValue_proof_body)) return null;
    let __tnEnumSize_proof_body = 0;
    switch (Number(__tnEnumTagValue_proof_body)) {
      case 0: break;
      case 1: break;
      case 2: break;
      default: return null;
    }
    if (__tnCursorMutable > __tnLength) return null;
    __tnEnumSize_proof_body = __tnLength - __tnCursorMutable;
    __tnCursorMutable = __tnLength;
    derived["StateProof__proof_body_computed_tag"] = __tnToBigInt(__tnEnumTagValue_proof_body);
    __tnParamSeq_proof_body_payload_size = __tnToBigInt(__tnEnumSize_proof_body);
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_proof_body_payload_size === null) return null;
    params["proof_body_payload_size"] = __tnParamSeq_proof_body_payload_size as bigint;
    return { params, offsets: null, derived: derived };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: StateProof.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 8) {
      return null;
    }
    const __tnParam_proof_body_hdr_type_slot = __tnToBigInt(view.getBigUint64(0, true));
    const __tnLayout = StateProof.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_proof_body_payload_size = __tnSeqParams["proof_body_payload_size"];
    if (__tnParamSeq_proof_body_payload_size === undefined) return null;
    const __tnExtractedParams = StateProof.Params.fromValues({
      proof_body_hdr_type_slot: __tnParam_proof_body_hdr_type_slot,
      proof_body_payload_size: __tnParamSeq_proof_body_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: (__tnLayout && __tnLayout.derived ? __tnLayout.derived : null) };
  }

  private __tnEnsureDerivedParams(): Record<string, bigint> | null {
    if (this.__tnDerivedParams) return this.__tnDerivedParams;
    const layout = StateProof.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.derived) return null;
    this.__tnDerivedParams = layout.derived;
    return this.__tnDerivedParams;
  }

  private __tnReadDerivedParam(key: string): number | null {
    const params = this.__tnEnsureDerivedParams();
    if (!params) return null;
    const value = params[key];
    if (value === undefined) return null;
    return __tnBigIntToNumber(value, "StateProof::__tnReadDerivedParam");
  }

  get_hdr(): StateProofHeader {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 40);
    return StateProofHeader.from_array(slice)!;
  }

  set_hdr(value: StateProofHeader): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get hdr(): StateProofHeader {
    return this.get_hdr();
  }

  set hdr(value: StateProofHeader) {
    this.set_hdr(value);
  }

  get_proof_body_computed_tag(): number {
    let tag = this.__tnReadDerivedParam("StateProof__proof_body_computed_tag");
    if (tag === null) {
      tag = (((this.__tnResolveFieldRef("hdr.type_slot") >> 62) & 3));
    }
    return tag;
  }

  proofBodyVariant(): typeof StateProof.proof_bodyVariantDescriptors[number] | null {
    const tag = this.get_proof_body_computed_tag();
    return StateProof.proof_bodyVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  proof_body(): StateProof_proof_body_Inner {
    const descriptor = this.proofBodyVariant();
    if (!descriptor) throw new Error("StateProof: unknown proof_body variant");
    const offset = StateProof.__tnFieldOffset_proof_body;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("StateProof: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    const __tnAutoContext: Record<string, number | bigint> = {
      "hdr.path_bitset.bytes.0": this.view.getUint8(8),
      "hdr.path_bitset.bytes.1": this.view.getUint8(9),
      "hdr.path_bitset.bytes.2": this.view.getUint8(10),
      "hdr.path_bitset.bytes.3": this.view.getUint8(11),
    };
    const __tnMergedContext = this.__tnFieldContext ? { ...__tnAutoContext, ...this.__tnFieldContext } : __tnAutoContext;
    return StateProof_proof_body_Inner.__tnCreate(slice, descriptor, __tnMergedContext);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_StateProof.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_StateProof, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint): bigint {
    const params = StateProof.Params.fromValues({
      proof_body_hdr_type_slot: proof_body_hdr_type_slot,
      proof_body_payload_size: proof_body_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: StateProof.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof_body.hdr.type_slot"] = params.proof_body_hdr_type_slot;
    record["proof_body.payload_size"] = params.proof_body_payload_size;
    return record;
  }

  static footprintIrFromParams(params: StateProof.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: StateProof.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for StateProof');
    return __tnBigIntToNumber(irResult, 'StateProof::footprintFromParams');
  }

  static footprintFromValues(input: { proof_body_hdr_type_slot: number | bigint, proof_body_payload_size: number | bigint }): number {
    const params = StateProof.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: StateProof.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: StateProof.Params }): { ok: boolean; code?: string; consumed?: number; params?: StateProof.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'StateProof::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'StateProof::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: StateProof.Params }): StateProof | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    let derivedRecord: Record<string, bigint> | null = null;
    if (!params) {
      const derived = this.__tnExtractParams(view, buffer);
      if (!derived) return null;
      params = derived.params;
      derivedRecord = derived.derived;
    }
    const validation = this.validate(buffer, { params });
    if (!validation.ok) {
      return null;
    }
    const cached = validation.params ?? params;
    const state = new StateProof(buffer, cached);
    if (derivedRecord) state.__tnDerivedParams = derivedRecord;
    return state;
  }


}

export namespace StateProof {
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

__tnRegisterFootprint("StateProof", (params) => StateProof.__tnInvokeFootprint(params));
__tnRegisterValidate("StateProof", (buffer, params) => StateProof.__tnInvokeValidate(buffer, params));

export class StateProofBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnPayload_proof_body: { descriptor: typeof StateProof.proof_bodyVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: StateProof.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: StateProof.Params | null = null;
  private __tnVariantSelector_proof_body?: __TnVariantSelectorResult<StateProofBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(40);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  set_hdr(value: Uint8Array): this {
    if (value.length !== 40) throw new Error("hdr expects 40 bytes");
    this.__tnPrefixBuffer.set(value, 0);
    this.__tnInvalidate();
    return this;
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  proof_body(): __TnVariantSelectorResult<StateProofBuilder> {
    if (!this.__tnVariantSelector_proof_body) {
      this.__tnVariantSelector_proof_body = __tnCreateVariantSelector(this, StateProof.proof_bodyVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_proof_body = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnInvalidate();
      });
    }
    return this.__tnVariantSelector_proof_body!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (!this.__tnPayload_proof_body) throw new Error("StateProofBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_proof_body.bytes.length;
    const requiredSize = 40 + payloadLength;
    const footprintSize = StateProof.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (!this.__tnPayload_proof_body) throw new Error("StateProofBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_proof_body.bytes.length;
    const requiredSize = 40 + payloadLength;
    const footprintSize = StateProof.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("StateProofBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): StateProof {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = StateProof.from_array(buffer, { params });
    if (!view) throw new Error("StateProofBuilder: failed to finalize view");
    return view;
  }

  finishView(): StateProof {
    return this.finish();
  }

  dynamicParams(): StateProof.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): StateProof.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = StateProof.Params.fromValues({
      proof_body_hdr_type_slot: (() => { const slice = this.__tnPrefixBuffer.subarray(0, 40); const header = StateProofHeader.from_array(slice); if (!header) throw new Error("StateProofBuilder: field 'hdr' must be set before build"); return __tnToBigInt(header.get_type_slot()); })(),
      proof_body_payload_size: (() => { if (!this.__tnPayload_proof_body) throw new Error("StateProofBuilder: payload 'proof_body' must be selected before build"); return __tnToBigInt(this.__tnPayload_proof_body.bytes.length); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (!this.__tnPayload_proof_body) throw new Error("StateProofBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    target.set(this.__tnPayload_proof_body.bytes, 40);
    const __tnLayout = StateProof.__tnComputeSequentialLayout(view, target);
    if (!__tnLayout || !__tnLayout.derived) throw new Error("StateProofBuilder: failed to derive enum tag");
    const __tnDerivedTagValue = __tnLayout.derived["StateProof__proof_body_computed_tag"];
    if (__tnDerivedTagValue === undefined) throw new Error("StateProofBuilder: computed enum tag missing");
    const __tnDerivedTag = __tnBigIntToNumber(__tnDerivedTagValue, "StateProofBuilder::__tnWriteInto");
    const __tnExpectedTag = this.__tnPayload_proof_body!.descriptor.tag;
    if (__tnDerivedTag !== __tnExpectedTag) throw new Error("StateProofBuilder: computed enum tag does not match selected variant");
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: StateProof.Params): void {
    const result = StateProof.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ StateProof }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

