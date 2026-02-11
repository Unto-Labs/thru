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

/* ----- TYPE DEFINITION FOR Authority ----- */

const __tn_ir_Authority = {
  typeName: "Authority",
  root: { op: "const", value: 65n }
} as const;

export class Authority {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): Authority {
    if (!buffer || buffer.length === undefined) throw new Error("Authority.__tnCreateView requires a Uint8Array");
    return new Authority(new Uint8Array(buffer));
  }

  static builder(): AuthorityBuilder {
    return new AuthorityBuilder();
  }

  static fromBuilder(builder: AuthorityBuilder): Authority | null {
    const buffer = builder.build();
    return Authority.from_array(buffer);
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

  get_data(): number[] {
    const offset = 1;
    const result: number[] = [];
    for (let i = 0; i < 64; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_data(value: number[]): void {
    const offset = 1;
    if (value.length !== 64) {
      throw new Error('Array length must be 64');
    }
    for (let i = 0; i < 64; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get data(): number[] {
    return this.get_data();
  }

  set data(value: number[]) {
    this.set_data(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_Authority.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Authority, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Authority');
    }
    return __tnBigIntToNumber(irResult, 'Authority::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 65) return { ok: false, code: "tn.buffer_too_small", consumed: 65 };
    return { ok: true, consumed: 65 };
  }

  static from_array(buffer: Uint8Array): Authority | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Authority(buffer);
  }

}

__tnRegisterFootprint("Authority", (params) => Authority.__tnInvokeFootprint(params));
__tnRegisterValidate("Authority", (buffer, params) => Authority.__tnInvokeValidate(buffer, params));

export class AuthorityBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(65);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_tag(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_data(values: number[]): this {
    if (values.length !== 64) throw new Error("data expects 64 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 1 + i * 1;
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

  finish(): Authority {
    const view = Authority.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build Authority");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR P256Point ----- */

const __tn_ir_P256Point = {
  typeName: "P256Point",
  root: { op: "const", value: 32n }
} as const;

export class P256Point {
  private view: DataView;
  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  private static readonly __tnElementSize = 1;
  private static readonly __tnElementCount: number | null = 32;

  get length(): number {
    const explicit = P256Point.__tnElementCount;
    if (explicit !== null) {
      return explicit;
    }
    const stride = P256Point.__tnElementSize;
    if (stride > 0) {
      return Math.floor(this.buffer.length / stride);
    }
    return this.buffer.length;
  }

  getElementBytes(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError('P256Point::getElementBytes index must be a non-negative integer');
    }
    const stride = P256Point.__tnElementSize;
    if (stride <= 0) {
      throw new Error('P256Point::getElementBytes requires constant element size');
    }
    const start = index * stride;
    const end = start + stride;
    if (end > this.buffer.length) {
      throw new RangeError('P256Point::getElementBytes out of bounds');
    }
    return this.buffer.subarray(start, end);
  }

  static from_array(buffer: Uint8Array): P256Point | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const validation = P256Point.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new P256Point(buffer);
  }

  asUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_P256Point.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_P256Point, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for P256Point');
    }
    return __tnBigIntToNumber(irResult, 'P256Point::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 32) return { ok: false, code: "tn.buffer_too_small", consumed: 32 };
    return { ok: true, consumed: 32 };
  }

}

__tnRegisterFootprint("P256Point", (params) => P256Point.__tnInvokeFootprint(params));
__tnRegisterValidate("P256Point", (buffer, params) => P256Point.__tnInvokeValidate(buffer, params));

/* ----- TYPE DEFINITION FOR RemoveAuthorityArgs ----- */

const __tn_ir_RemoveAuthorityArgs = {
  typeName: "RemoveAuthorityArgs",
  root: { op: "const", value: 1n }
} as const;

export class RemoveAuthorityArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RemoveAuthorityArgs {
    if (!buffer || buffer.length === undefined) throw new Error("RemoveAuthorityArgs.__tnCreateView requires a Uint8Array");
    return new RemoveAuthorityArgs(new Uint8Array(buffer));
  }

  static builder(): RemoveAuthorityArgsBuilder {
    return new RemoveAuthorityArgsBuilder();
  }

  static fromBuilder(builder: RemoveAuthorityArgsBuilder): RemoveAuthorityArgs | null {
    const buffer = builder.build();
    return RemoveAuthorityArgs.from_array(buffer);
  }

  get_auth_idx(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_auth_idx(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get auth_idx(): number {
    return this.get_auth_idx();
  }

  set auth_idx(value: number) {
    this.set_auth_idx(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RemoveAuthorityArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RemoveAuthorityArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RemoveAuthorityArgs');
    }
    return __tnBigIntToNumber(irResult, 'RemoveAuthorityArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 1) return { ok: false, code: "tn.buffer_too_small", consumed: 1 };
    return { ok: true, consumed: 1 };
  }

  static new(auth_idx: number): RemoveAuthorityArgs {
    const buffer = new Uint8Array(1);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, auth_idx); /* auth_idx */

    return new RemoveAuthorityArgs(buffer);
  }

  static from_array(buffer: Uint8Array): RemoveAuthorityArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RemoveAuthorityArgs(buffer);
  }

}

__tnRegisterFootprint("RemoveAuthorityArgs", (params) => RemoveAuthorityArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("RemoveAuthorityArgs", (buffer, params) => RemoveAuthorityArgs.__tnInvokeValidate(buffer, params));

export class RemoveAuthorityArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(1);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_auth_idx(value: number): this {
    this.view.setUint8(0, value);
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

  finish(): RemoveAuthorityArgs {
    const view = RemoveAuthorityArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RemoveAuthorityArgs");
    return view;
  }
}

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

/* ----- TYPE DEFINITION FOR TransferArgs ----- */

const __tn_ir_TransferArgs = {
  typeName: "TransferArgs",
  root: { op: "const", value: 12n }
} as const;

export class TransferArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): TransferArgs {
    if (!buffer || buffer.length === undefined) throw new Error("TransferArgs.__tnCreateView requires a Uint8Array");
    return new TransferArgs(new Uint8Array(buffer));
  }

  static builder(): TransferArgsBuilder {
    return new TransferArgsBuilder();
  }

  static fromBuilder(builder: TransferArgsBuilder): TransferArgs | null {
    const buffer = builder.build();
    return TransferArgs.from_array(buffer);
  }

  get_wallet_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_wallet_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get wallet_account_idx(): number {
    return this.get_wallet_account_idx();
  }

  set wallet_account_idx(value: number) {
    this.set_wallet_account_idx(value);
  }

  get_to_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_to_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get to_account_idx(): number {
    return this.get_to_account_idx();
  }

  set to_account_idx(value: number) {
    this.set_to_account_idx(value);
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
    return __tnEvalFootprint(__tn_ir_TransferArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_TransferArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for TransferArgs');
    }
    return __tnBigIntToNumber(irResult, 'TransferArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 12) return { ok: false, code: "tn.buffer_too_small", consumed: 12 };
    return { ok: true, consumed: 12 };
  }

  static new(wallet_account_idx: number, to_account_idx: number, amount: bigint): TransferArgs {
    const buffer = new Uint8Array(12);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, wallet_account_idx, true); /* wallet_account_idx (little-endian) */
    view.setUint16(2, to_account_idx, true); /* to_account_idx (little-endian) */
    view.setBigUint64(4, amount, true); /* amount (little-endian) */

    return new TransferArgs(buffer);
  }

  static from_array(buffer: Uint8Array): TransferArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new TransferArgs(buffer);
  }

}

__tnRegisterFootprint("TransferArgs", (params) => TransferArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("TransferArgs", (buffer, params) => TransferArgs.__tnInvokeValidate(buffer, params));

export class TransferArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(12);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_wallet_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_to_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(4, cast, true);
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

  finish(): TransferArgs {
    const view = TransferArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TransferArgs");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR ValidateArgs ----- */

const __tn_ir_ValidateArgs = {
  typeName: "ValidateArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "authenticator_data.authenticator_data_len" }, right: { op: "const", value: 1n } } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "client_data.client_data_len" }, right: { op: "const", value: 1n } } } } }
} as const;

export class ValidateArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: ValidateArgs.Params;

  private constructor(private buffer: Uint8Array, params?: ValidateArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = ValidateArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("ValidateArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: ValidateArgs.Params, fieldContext?: Record<string, number | bigint> }): ValidateArgs {
    if (!buffer || buffer.length === undefined) throw new Error("ValidateArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = ValidateArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("ValidateArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new ValidateArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): ValidateArgs.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "ValidateArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "ValidateArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("ValidateArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): ValidateArgsBuilder {
    return new ValidateArgsBuilder();
  }

  static fromBuilder(builder: ValidateArgsBuilder): ValidateArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return ValidateArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "authenticator_data", method: "authenticator_data", sizeField: "authenticator_data_len", paramKey: "authenticator_data_len", elementSize: 1 },
    { field: "client_data", method: "client_data", sizeField: "client_data_len", paramKey: "client_data_len", elementSize: 1 },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const offsets: Record<string, number> = Object.create(null);
    const __tnLength = buffer.length;
    let __tnFieldValue_wallet_account_idx: number | null = null;
    let __tnFieldValue_auth_idx: number | null = null;
    let __tnFieldValue_authenticator_data_len: number | null = null;
    let __tnFieldValue_client_data_len: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_wallet_account_idx = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_wallet_account_idx = __tnRead_wallet_account_idx;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 1 > __tnLength) return null;
    const __tnRead_auth_idx = view.getUint8(__tnCursorMutable);
    __tnFieldValue_auth_idx = __tnRead_auth_idx;
    __tnCursorMutable += 1;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 32 > __tnLength) return null;
    __tnCursorMutable += 32;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_authenticator_data_len = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_authenticator_data_len = __tnRead_authenticator_data_len;
    __tnCursorMutable += 2;
    if (__tnCursorMutable + 2 > __tnLength) return null;
    const __tnRead_client_data_len = view.getUint16(__tnCursorMutable, true);
    __tnFieldValue_client_data_len = __tnRead_client_data_len;
    __tnCursorMutable += 2;
    if (__tnFieldValue_authenticator_data_len === null) return null;
    const __tnArrayCount_authenticator_data = Math.trunc(Number(__tnFieldValue_authenticator_data_len));
    if (!Number.isFinite(__tnArrayCount_authenticator_data) || __tnArrayCount_authenticator_data < 0) return null;
    const __tnArrayBytes_authenticator_data = __tnArrayCount_authenticator_data * 1;
    if (__tnCursorMutable + __tnArrayBytes_authenticator_data > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_authenticator_data;
    if (__tnFieldValue_client_data_len === null) return null;
    const __tnArrayCount_client_data = Math.trunc(Number(__tnFieldValue_client_data_len));
    if (!Number.isFinite(__tnArrayCount_client_data) || __tnArrayCount_client_data < 0) return null;
    const __tnArrayBytes_client_data = __tnArrayCount_client_data * 1;
    offsets["client_data"] = __tnCursorMutable;
    if (__tnCursorMutable + __tnArrayBytes_client_data > __tnLength) return null;
    __tnCursorMutable += __tnArrayBytes_client_data;
    return { params: null, offsets: offsets, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: ValidateArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 69) {
      return null;
    }
    const __tnParam_authenticator_data_authenticator_data_len = __tnToBigInt(view.getUint16(67, true));
    if (buffer.length < 71) {
      return null;
    }
    const __tnParam_client_data_client_data_len = __tnToBigInt(view.getUint16(69, true));
    const __tnExtractedParams = ValidateArgs.Params.fromValues({
      authenticator_data_authenticator_data_len: __tnParam_authenticator_data_authenticator_data_len,
      client_data_client_data_len: __tnParam_client_data_client_data_len,
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
      throw new Error("ValidateArgs: field '" + field + "' does not have a dynamic offset");
    }
    return offset;
  }

  private __tnComputeDynamicOffsets(): Record<string, number> {
    const layout = ValidateArgs.__tnComputeSequentialLayout(this.view, this.buffer);
    if (!layout || !layout.offsets) {
      throw new Error("ValidateArgs: failed to compute dynamic offsets");
    }
    return layout.offsets;
  }

  get_wallet_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_wallet_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get wallet_account_idx(): number {
    return this.get_wallet_account_idx();
  }

  set wallet_account_idx(value: number) {
    this.set_wallet_account_idx(value);
  }

  get_auth_idx(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_auth_idx(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get auth_idx(): number {
    return this.get_auth_idx();
  }

  set auth_idx(value: number) {
    this.set_auth_idx(value);
  }

  get_signature_r(): P256Point {
    const offset = 3;
    const slice = this.buffer.subarray(offset, offset + 32);
    return P256Point.from_array(slice)!;
  }

  set_signature_r(value: P256Point): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 3;
    this.buffer.set(sourceBytes, offset);
  }

  get signature_r(): P256Point {
    return this.get_signature_r();
  }

  set signature_r(value: P256Point) {
    this.set_signature_r(value);
  }

  get_signature_s(): P256Point {
    const offset = 35;
    const slice = this.buffer.subarray(offset, offset + 32);
    return P256Point.from_array(slice)!;
  }

  set_signature_s(value: P256Point): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 35;
    this.buffer.set(sourceBytes, offset);
  }

  get signature_s(): P256Point {
    return this.get_signature_s();
  }

  set signature_s(value: P256Point) {
    this.set_signature_s(value);
  }

  get_authenticator_data_len(): number {
    const offset = 67;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_authenticator_data_len(value: number): void {
    const offset = 67;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get authenticator_data_len(): number {
    return this.get_authenticator_data_len();
  }

  set authenticator_data_len(value: number) {
    this.set_authenticator_data_len(value);
  }

  get_client_data_len(): number {
    const offset = 69;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_client_data_len(value: number): void {
    const offset = 69;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get client_data_len(): number {
    return this.get_client_data_len();
  }

  set client_data_len(value: number) {
    this.set_client_data_len(value);
  }

  get_authenticator_data_length(): number {
    return this.__tnResolveFieldRef("authenticator_data_len");
  }

  get_authenticator_data_at(index: number): number {
    const offset = 71;
    return this.view.getUint8(offset + index * 1);
  }

  get_authenticator_data(): number[] {
    const len = this.get_authenticator_data_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_authenticator_data_at(i));
    }
    return result;
  }

  set_authenticator_data_at(index: number, value: number): void {
    const offset = 71;
    this.view.setUint8((offset + index * 1), value);
  }

  set_authenticator_data(value: number[]): void {
    const len = Math.min(this.get_authenticator_data_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_authenticator_data_at(i, value[i]);
    }
  }

  get authenticator_data(): number[] {
    return this.get_authenticator_data();
  }

  set authenticator_data(value: number[]) {
    this.set_authenticator_data(value);
  }

  get_client_data_length(): number {
    return this.__tnResolveFieldRef("client_data_len");
  }

  get_client_data_at(index: number): number {
    const offset = this.__tnGetDynamicOffset("client_data");
    return this.view.getUint8(offset + index * 1);
  }

  get_client_data(): number[] {
    const len = this.get_client_data_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_client_data_at(i));
    }
    return result;
  }

  set_client_data_at(index: number, value: number): void {
    const offset = this.__tnGetDynamicOffset("client_data");
    this.view.setUint8((offset + index * 1), value);
  }

  set_client_data(value: number[]): void {
    const len = Math.min(this.get_client_data_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_client_data_at(i, value[i]);
    }
  }

  get client_data(): number[] {
    return this.get_client_data();
  }

  set client_data(value: number[]) {
    this.set_client_data(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_ValidateArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_ValidateArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(authenticator_data_authenticator_data_len: number | bigint, client_data_client_data_len: number | bigint): bigint {
    const params = ValidateArgs.Params.fromValues({
      authenticator_data_authenticator_data_len: authenticator_data_authenticator_data_len,
      client_data_client_data_len: client_data_client_data_len,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: ValidateArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["authenticator_data.authenticator_data_len"] = params.authenticator_data_authenticator_data_len;
    record["client_data.client_data_len"] = params.client_data_client_data_len;
    return record;
  }

  static footprintIrFromParams(params: ValidateArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: ValidateArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for ValidateArgs');
    return __tnBigIntToNumber(irResult, 'ValidateArgs::footprintFromParams');
  }

  static footprintFromValues(input: { authenticator_data_authenticator_data_len: number | bigint, client_data_client_data_len: number | bigint }): number {
    const params = ValidateArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: ValidateArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: ValidateArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: ValidateArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ValidateArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'ValidateArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: ValidateArgs.Params }): ValidateArgs | null {
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
    const state = new ValidateArgs(buffer, cached);
    return state;
  }


}

export namespace ValidateArgs {
  export type Params = {
    /** ABI path: authenticator_data.authenticator_data_len */
    readonly authenticator_data_authenticator_data_len: bigint;
    /** ABI path: client_data.client_data_len */
    readonly client_data_client_data_len: bigint;
  };

  export const ParamKeys = Object.freeze({
    authenticator_data_authenticator_data_len: "authenticator_data.authenticator_data_len",
    client_data_client_data_len: "client_data.client_data_len",
  } as const);

  export const Params = {
    fromValues(input: { authenticator_data_authenticator_data_len: number | bigint, client_data_client_data_len: number | bigint }): Params {
      return {
        authenticator_data_authenticator_data_len: __tnToBigInt(input.authenticator_data_authenticator_data_len),
        client_data_client_data_len: __tnToBigInt(input.client_data_client_data_len),
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

  export function params(input: { authenticator_data_authenticator_data_len: number | bigint, client_data_client_data_len: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("ValidateArgs", (params) => ValidateArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("ValidateArgs", (buffer, params) => ValidateArgs.__tnInvokeValidate(buffer, params));

export class ValidateArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: ValidateArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: ValidateArgs.Params | null = null;
  private __tnFam_authenticator_data: Uint8Array | null = null;
  private __tnFam_authenticator_dataCount: number | null = null;
  private __tnFamWriter_authenticator_data?: __TnFamWriterResult<ValidateArgsBuilder>;
  private __tnFam_client_data: Uint8Array | null = null;
  private __tnFam_client_dataCount: number | null = null;
  private __tnFamWriter_client_data?: __TnFamWriterResult<ValidateArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(71);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_wallet_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_auth_idx(value: number): this {
    this.view.setUint8(2, value);
    this.__tnInvalidate();
    return this;
  }

  set_signature_r(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("signature_r expects 32 bytes");
    this.buffer.set(value, 3);
    this.__tnInvalidate();
    return this;
  }

  set_signature_s(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("signature_s expects 32 bytes");
    this.buffer.set(value, 35);
    this.__tnInvalidate();
    return this;
  }

  set_authenticator_data_len(value: number): this {
    this.view.setUint16(67, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_client_data_len(value: number): this {
    this.view.setUint16(69, value, true);
    this.__tnInvalidate();
    return this;
  }

  authenticator_data(): __TnFamWriterResult<ValidateArgsBuilder> {
    if (!this.__tnFamWriter_authenticator_data) {
      this.__tnFamWriter_authenticator_data = __tnCreateFamWriter(this, "authenticator_data", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_authenticator_data = bytes;
        this.__tnFam_authenticator_dataCount = elementCount;
        this.set_authenticator_data_len(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_authenticator_data!;
  }

  client_data(): __TnFamWriterResult<ValidateArgsBuilder> {
    if (!this.__tnFamWriter_client_data) {
      this.__tnFamWriter_client_data = __tnCreateFamWriter(this, "client_data", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_client_data = bytes;
        this.__tnFam_client_dataCount = elementCount;
        this.set_client_data_len(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_client_data!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = ValidateArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = ValidateArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("ValidateArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): ValidateArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = ValidateArgs.from_array(buffer, { params });
    if (!view) throw new Error("ValidateArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): ValidateArgs {
    return this.finish();
  }

  dynamicParams(): ValidateArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): ValidateArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = ValidateArgs.Params.fromValues({
      authenticator_data_authenticator_data_len: (() => { if (this.__tnFam_authenticator_dataCount === null) throw new Error("ValidateArgsBuilder: field 'authenticator_data' must be written before computing params"); return __tnToBigInt(this.__tnFam_authenticator_dataCount); })(),
      client_data_client_data_len: (() => { if (this.__tnFam_client_dataCount === null) throw new Error("ValidateArgsBuilder: field 'client_data' must be written before computing params"); return __tnToBigInt(this.__tnFam_client_dataCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_authenticator_data_bytes = this.__tnFam_authenticator_data;
    if (!__tnLocal_authenticator_data_bytes) throw new Error("ValidateArgsBuilder: field 'authenticator_data' must be written before build");
    target.set(__tnLocal_authenticator_data_bytes, cursor);
    cursor += __tnLocal_authenticator_data_bytes.length;
    const __tnLocal_client_data_bytes = this.__tnFam_client_data;
    if (!__tnLocal_client_data_bytes) throw new Error("ValidateArgsBuilder: field 'client_data' must be written before build");
    target.set(__tnLocal_client_data_bytes, cursor);
    cursor += __tnLocal_client_data_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: ValidateArgs.Params): void {
    const result = ValidateArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ ValidateArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

/* ----- TYPE DEFINITION FOR WalletAccount ----- */

const __tn_ir_WalletAccount = {
  typeName: "WalletAccount",
  root: { op: "const", value: 9n }
} as const;

export class WalletAccount {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): WalletAccount {
    if (!buffer || buffer.length === undefined) throw new Error("WalletAccount.__tnCreateView requires a Uint8Array");
    return new WalletAccount(new Uint8Array(buffer));
  }

  static builder(): WalletAccountBuilder {
    return new WalletAccountBuilder();
  }

  static fromBuilder(builder: WalletAccountBuilder): WalletAccount | null {
    const buffer = builder.build();
    return WalletAccount.from_array(buffer);
  }

  get_num_auth(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_num_auth(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get num_auth(): number {
    return this.get_num_auth();
  }

  set num_auth(value: number) {
    this.set_num_auth(value);
  }

  get_nonce(): bigint {
    const offset = 1;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_nonce(value: bigint): void {
    const offset = 1;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get nonce(): bigint {
    return this.get_nonce();
  }

  set nonce(value: bigint) {
    this.set_nonce(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_WalletAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_WalletAccount, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for WalletAccount');
    }
    return __tnBigIntToNumber(irResult, 'WalletAccount::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 9) return { ok: false, code: "tn.buffer_too_small", consumed: 9 };
    return { ok: true, consumed: 9 };
  }

  static new(num_auth: number, nonce: bigint): WalletAccount {
    const buffer = new Uint8Array(9);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, num_auth); /* num_auth */
    view.setBigUint64(1, nonce, true); /* nonce (little-endian) */

    return new WalletAccount(buffer);
  }

  static from_array(buffer: Uint8Array): WalletAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new WalletAccount(buffer);
  }

}

__tnRegisterFootprint("WalletAccount", (params) => WalletAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("WalletAccount", (buffer, params) => WalletAccount.__tnInvokeValidate(buffer, params));

export class WalletAccountBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(9);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_num_auth(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_nonce(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(1, cast, true);
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

  finish(): WalletAccount {
    const view = WalletAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build WalletAccount");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR WalletCreatedEventData ----- */

const __tn_ir_WalletCreatedEventData = {
  typeName: "WalletCreatedEventData",
  root: { op: "const", value: 97n }
} as const;

export class WalletCreatedEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): WalletCreatedEventData {
    if (!buffer || buffer.length === undefined) throw new Error("WalletCreatedEventData.__tnCreateView requires a Uint8Array");
    return new WalletCreatedEventData(new Uint8Array(buffer));
  }

  static builder(): WalletCreatedEventDataBuilder {
    return new WalletCreatedEventDataBuilder();
  }

  static fromBuilder(builder: WalletCreatedEventDataBuilder): WalletCreatedEventData | null {
    const buffer = builder.build();
    return WalletCreatedEventData.from_array(buffer);
  }

  get_wallet(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_wallet(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get wallet(): Pubkey {
    return this.get_wallet();
  }

  set wallet(value: Pubkey) {
    this.set_wallet(value);
  }

  get_authority(): Authority {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 65);
    return Authority.from_array(slice)!;
  }

  set_authority(value: Authority): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Authority {
    return this.get_authority();
  }

  set authority(value: Authority) {
    this.set_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_WalletCreatedEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_WalletCreatedEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for WalletCreatedEventData');
    }
    return __tnBigIntToNumber(irResult, 'WalletCreatedEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 97) return { ok: false, code: "tn.buffer_too_small", consumed: 97 };
    return { ok: true, consumed: 97 };
  }

  static from_array(buffer: Uint8Array): WalletCreatedEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new WalletCreatedEventData(buffer);
  }

}

__tnRegisterFootprint("WalletCreatedEventData", (params) => WalletCreatedEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("WalletCreatedEventData", (buffer, params) => WalletCreatedEventData.__tnInvokeValidate(buffer, params));

export class WalletCreatedEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(97);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_wallet(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("wallet expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 65) throw new Error("authority expects 65 bytes");
    this.buffer.set(value, 32);
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

  finish(): WalletCreatedEventData {
    const view = WalletCreatedEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build WalletCreatedEventData");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR WalletTransferEventData ----- */

const __tn_ir_WalletTransferEventData = {
  typeName: "WalletTransferEventData",
  root: { op: "const", value: 72n }
} as const;

export class WalletTransferEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): WalletTransferEventData {
    if (!buffer || buffer.length === undefined) throw new Error("WalletTransferEventData.__tnCreateView requires a Uint8Array");
    return new WalletTransferEventData(new Uint8Array(buffer));
  }

  static builder(): WalletTransferEventDataBuilder {
    return new WalletTransferEventDataBuilder();
  }

  static fromBuilder(builder: WalletTransferEventDataBuilder): WalletTransferEventData | null {
    const buffer = builder.build();
    return WalletTransferEventData.from_array(buffer);
  }

  get_wallet(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_wallet(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get wallet(): Pubkey {
    return this.get_wallet();
  }

  set wallet(value: Pubkey) {
    this.set_wallet(value);
  }

  get_to(): Pubkey {
    const offset = 32;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_to(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 32;
    this.buffer.set(sourceBytes, offset);
  }

  get to(): Pubkey {
    return this.get_to();
  }

  set to(value: Pubkey) {
    this.set_to(value);
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

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_WalletTransferEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_WalletTransferEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for WalletTransferEventData');
    }
    return __tnBigIntToNumber(irResult, 'WalletTransferEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 72) return { ok: false, code: "tn.buffer_too_small", consumed: 72 };
    return { ok: true, consumed: 72 };
  }

  static from_array(buffer: Uint8Array): WalletTransferEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new WalletTransferEventData(buffer);
  }

}

__tnRegisterFootprint("WalletTransferEventData", (params) => WalletTransferEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("WalletTransferEventData", (buffer, params) => WalletTransferEventData.__tnInvokeValidate(buffer, params));

export class WalletTransferEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(72);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_wallet(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("wallet expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_to(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("to expects 32 bytes");
    this.buffer.set(value, 32);
    return this;
  }

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
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

  finish(): WalletTransferEventData {
    const view = WalletTransferEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build WalletTransferEventData");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR WalletValidatedEventData ----- */

const __tn_ir_WalletValidatedEventData = {
  typeName: "WalletValidatedEventData",
  root: { op: "const", value: 40n }
} as const;

export class WalletValidatedEventData {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): WalletValidatedEventData {
    if (!buffer || buffer.length === undefined) throw new Error("WalletValidatedEventData.__tnCreateView requires a Uint8Array");
    return new WalletValidatedEventData(new Uint8Array(buffer));
  }

  static builder(): WalletValidatedEventDataBuilder {
    return new WalletValidatedEventDataBuilder();
  }

  static fromBuilder(builder: WalletValidatedEventDataBuilder): WalletValidatedEventData | null {
    const buffer = builder.build();
    return WalletValidatedEventData.from_array(buffer);
  }

  get_wallet(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_wallet(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get wallet(): Pubkey {
    return this.get_wallet();
  }

  set wallet(value: Pubkey) {
    this.set_wallet(value);
  }

  get_new_nonce(): bigint {
    const offset = 32;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_new_nonce(value: bigint): void {
    const offset = 32;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get new_nonce(): bigint {
    return this.get_new_nonce();
  }

  set new_nonce(value: bigint) {
    this.set_new_nonce(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_WalletValidatedEventData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_WalletValidatedEventData, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for WalletValidatedEventData');
    }
    return __tnBigIntToNumber(irResult, 'WalletValidatedEventData::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 40) return { ok: false, code: "tn.buffer_too_small", consumed: 40 };
    return { ok: true, consumed: 40 };
  }

  static from_array(buffer: Uint8Array): WalletValidatedEventData | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new WalletValidatedEventData(buffer);
  }

}

__tnRegisterFootprint("WalletValidatedEventData", (params) => WalletValidatedEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("WalletValidatedEventData", (buffer, params) => WalletValidatedEventData.__tnInvokeValidate(buffer, params));

export class WalletValidatedEventDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(40);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_wallet(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("wallet expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_new_nonce(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
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

  finish(): WalletValidatedEventData {
    const view = WalletValidatedEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build WalletValidatedEventData");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR AddAuthorityArgs ----- */

const __tn_ir_AddAuthorityArgs = {
  typeName: "AddAuthorityArgs",
  root: { op: "const", value: 65n }
} as const;

export class AddAuthorityArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AddAuthorityArgs {
    if (!buffer || buffer.length === undefined) throw new Error("AddAuthorityArgs.__tnCreateView requires a Uint8Array");
    return new AddAuthorityArgs(new Uint8Array(buffer));
  }

  static builder(): AddAuthorityArgsBuilder {
    return new AddAuthorityArgsBuilder();
  }

  static fromBuilder(builder: AddAuthorityArgsBuilder): AddAuthorityArgs | null {
    const buffer = builder.build();
    return AddAuthorityArgs.from_array(buffer);
  }

  get_authority(): Authority {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 65);
    return Authority.from_array(slice)!;
  }

  set_authority(value: Authority): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Authority {
    return this.get_authority();
  }

  set authority(value: Authority) {
    this.set_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AddAuthorityArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AddAuthorityArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AddAuthorityArgs');
    }
    return __tnBigIntToNumber(irResult, 'AddAuthorityArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 65) return { ok: false, code: "tn.buffer_too_small", consumed: 65 };
    return { ok: true, consumed: 65 };
  }

  static from_array(buffer: Uint8Array): AddAuthorityArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AddAuthorityArgs(buffer);
  }

}

__tnRegisterFootprint("AddAuthorityArgs", (params) => AddAuthorityArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("AddAuthorityArgs", (buffer, params) => AddAuthorityArgs.__tnInvokeValidate(buffer, params));

export class AddAuthorityArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(65);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 65) throw new Error("authority expects 65 bytes");
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

  finish(): AddAuthorityArgs {
    const view = AddAuthorityArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AddAuthorityArgs");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR InvokeArgs ----- */

const __tn_ir_InvokeArgs = {
  typeName: "InvokeArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 32n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "instr.instr_len" }, right: { op: "const", value: 1n } } } } }
} as const;

export class InvokeArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: InvokeArgs.Params;

  private constructor(private buffer: Uint8Array, params?: InvokeArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = InvokeArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("InvokeArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: InvokeArgs.Params, fieldContext?: Record<string, number | bigint> }): InvokeArgs {
    if (!buffer || buffer.length === undefined) throw new Error("InvokeArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = InvokeArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("InvokeArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new InvokeArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): InvokeArgs.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "InvokeArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "InvokeArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("InvokeArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): InvokeArgsBuilder {
    return new InvokeArgsBuilder();
  }

  static fromBuilder(builder: InvokeArgsBuilder): InvokeArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return InvokeArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "instr", method: "instr", sizeField: "instr_len", paramKey: "instr_len", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: InvokeArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 34) {
      return null;
    }
    const __tnParam_instr_instr_len = __tnToBigInt(view.getUint16(32, true));
    const __tnExtractedParams = InvokeArgs.Params.fromValues({
      instr_instr_len: __tnParam_instr_instr_len,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_program_pubkey(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_program_pubkey(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get program_pubkey(): Pubkey {
    return this.get_program_pubkey();
  }

  set program_pubkey(value: Pubkey) {
    this.set_program_pubkey(value);
  }

  get_instr_len(): number {
    const offset = 32;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_instr_len(value: number): void {
    const offset = 32;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get instr_len(): number {
    return this.get_instr_len();
  }

  set instr_len(value: number) {
    this.set_instr_len(value);
  }

  get_instr_length(): number {
    return this.__tnResolveFieldRef("instr_len");
  }

  get_instr_at(index: number): number {
    const offset = 34;
    return this.view.getUint8(offset + index * 1);
  }

  get_instr(): number[] {
    const len = this.get_instr_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_instr_at(i));
    }
    return result;
  }

  set_instr_at(index: number, value: number): void {
    const offset = 34;
    this.view.setUint8((offset + index * 1), value);
  }

  set_instr(value: number[]): void {
    const len = Math.min(this.get_instr_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_instr_at(i, value[i]);
    }
  }

  get instr(): number[] {
    return this.get_instr();
  }

  set instr(value: number[]) {
    this.set_instr(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InvokeArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InvokeArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(instr_instr_len: number | bigint): bigint {
    const params = InvokeArgs.Params.fromValues({
      instr_instr_len: instr_instr_len,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: InvokeArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["instr.instr_len"] = params.instr_instr_len;
    return record;
  }

  static footprintIrFromParams(params: InvokeArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: InvokeArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InvokeArgs');
    return __tnBigIntToNumber(irResult, 'InvokeArgs::footprintFromParams');
  }

  static footprintFromValues(input: { instr_instr_len: number | bigint }): number {
    const params = InvokeArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: InvokeArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: InvokeArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: InvokeArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InvokeArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InvokeArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: InvokeArgs.Params }): InvokeArgs | null {
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
    const state = new InvokeArgs(buffer, cached);
    return state;
  }


}

export namespace InvokeArgs {
  export type Params = {
    /** ABI path: instr.instr_len */
    readonly instr_instr_len: bigint;
  };

  export const ParamKeys = Object.freeze({
    instr_instr_len: "instr.instr_len",
  } as const);

  export const Params = {
    fromValues(input: { instr_instr_len: number | bigint }): Params {
      return {
        instr_instr_len: __tnToBigInt(input.instr_instr_len),
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

  export function params(input: { instr_instr_len: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("InvokeArgs", (params) => InvokeArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("InvokeArgs", (buffer, params) => InvokeArgs.__tnInvokeValidate(buffer, params));

export class InvokeArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: InvokeArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: InvokeArgs.Params | null = null;
  private __tnFam_instr: Uint8Array | null = null;
  private __tnFam_instrCount: number | null = null;
  private __tnFamWriter_instr?: __TnFamWriterResult<InvokeArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(34);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_program_pubkey(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("program_pubkey expects 32 bytes");
    this.buffer.set(value, 0);
    this.__tnInvalidate();
    return this;
  }

  set_instr_len(value: number): this {
    this.view.setUint16(32, value, true);
    this.__tnInvalidate();
    return this;
  }

  instr(): __TnFamWriterResult<InvokeArgsBuilder> {
    if (!this.__tnFamWriter_instr) {
      this.__tnFamWriter_instr = __tnCreateFamWriter(this, "instr", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_instr = bytes;
        this.__tnFam_instrCount = elementCount;
        this.set_instr_len(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_instr!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = InvokeArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = InvokeArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("InvokeArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): InvokeArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = InvokeArgs.from_array(buffer, { params });
    if (!view) throw new Error("InvokeArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): InvokeArgs {
    return this.finish();
  }

  dynamicParams(): InvokeArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): InvokeArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = InvokeArgs.Params.fromValues({
      instr_instr_len: (() => { if (this.__tnFam_instrCount === null) throw new Error("InvokeArgsBuilder: field 'instr' must be written before computing params"); return __tnToBigInt(this.__tnFam_instrCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_instr_bytes = this.__tnFam_instr;
    if (!__tnLocal_instr_bytes) throw new Error("InvokeArgsBuilder: field 'instr' must be written before build");
    target.set(__tnLocal_instr_bytes, cursor);
    cursor += __tnLocal_instr_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: InvokeArgs.Params): void {
    const result = InvokeArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ InvokeArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

/* ----- TYPE DEFINITION FOR PasskeyEvent ----- */

const __tn_ir_PasskeyEvent = {
  typeName: "PasskeyEvent",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "PasskeyEvent::payload.event_type", cases: [{ value: 0, node: { op: "align", alignment: 1, node: { op: "const", value: 97n } } }, { value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 40n } } }, { value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 72n } } }] } } } }
} as const;

export class PasskeyEvent_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): PasskeyEvent_payload_Inner {
    return new PasskeyEvent_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asWalletCreated(): WalletCreatedEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return WalletCreatedEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asWalletValidated(): WalletValidatedEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return WalletValidatedEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asWalletTransfer(): WalletTransferEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return WalletTransferEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class PasskeyEvent {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: PasskeyEvent.Params;

  private constructor(private buffer: Uint8Array, params?: PasskeyEvent.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = PasskeyEvent.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("PasskeyEvent: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: PasskeyEvent.Params }): PasskeyEvent {
    if (!buffer || buffer.length === undefined) throw new Error("PasskeyEvent.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = PasskeyEvent.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("PasskeyEvent.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new PasskeyEvent(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): PasskeyEvent.Params {
    return this.__tnParams;
  }

  static builder(): PasskeyEventBuilder {
    return new PasskeyEventBuilder();
  }

  static fromBuilder(builder: PasskeyEventBuilder): PasskeyEvent | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return PasskeyEvent.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "wallet_created",
      tag: 0,
      payloadSize: 97,
      payloadType: "PasskeyEvent::payload::wallet_created",
      createPayloadBuilder: () => __tnMaybeCallBuilder(WalletCreatedEventData),
    },
    {
      name: "wallet_validated",
      tag: 1,
      payloadSize: 40,
      payloadType: "PasskeyEvent::payload::wallet_validated",
      createPayloadBuilder: () => __tnMaybeCallBuilder(WalletValidatedEventData),
    },
    {
      name: "wallet_transfer",
      tag: 2,
      payloadSize: 72,
      payloadType: "PasskeyEvent::payload::wallet_transfer",
      createPayloadBuilder: () => __tnMaybeCallBuilder(WalletTransferEventData),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: PasskeyEvent.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_event_type = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = PasskeyEvent.Params.fromValues({
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

  payloadVariant(): typeof PasskeyEvent.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return PasskeyEvent.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): PasskeyEvent_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("PasskeyEvent: unknown payload variant");
    const offset = PasskeyEvent.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("PasskeyEvent: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return PasskeyEvent_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PasskeyEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PasskeyEvent, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_event_type: number | bigint): bigint {
    const params = PasskeyEvent.Params.fromValues({
      payload_event_type: payload_event_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: PasskeyEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.event_type"] = params.payload_event_type;
    record["PasskeyEvent::payload.event_type"] = params.payload_event_type;
    return record;
  }

  static footprintIrFromParams(params: PasskeyEvent.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: PasskeyEvent.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PasskeyEvent');
    return __tnBigIntToNumber(irResult, 'PasskeyEvent::footprintFromParams');
  }

  static footprintFromValues(input: { payload_event_type: number | bigint }): number {
    const params = PasskeyEvent.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: PasskeyEvent.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: PasskeyEvent.Params }): { ok: boolean; code?: string; consumed?: number; params?: PasskeyEvent.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PasskeyEvent::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PasskeyEvent::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: PasskeyEvent.Params }): PasskeyEvent | null {
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
    const state = new PasskeyEvent(buffer, cached);
    return state;
  }


}

export namespace PasskeyEvent {
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

__tnRegisterFootprint("PasskeyEvent", (params) => PasskeyEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("PasskeyEvent", (buffer, params) => PasskeyEvent.__tnInvokeValidate(buffer, params));

export class PasskeyEventBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_event_type: number | null = null;
  private __tnPayload_payload: { descriptor: typeof PasskeyEvent.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: PasskeyEvent.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: PasskeyEvent.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<PasskeyEventBuilder>;

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

  payload(): __TnVariantSelectorResult<PasskeyEventBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, PasskeyEvent.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_event_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("PasskeyEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PasskeyEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PasskeyEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_event_type === null) throw new Error("PasskeyEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PasskeyEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PasskeyEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("PasskeyEventBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): PasskeyEvent {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = PasskeyEvent.from_array(buffer, { params });
    if (!view) throw new Error("PasskeyEventBuilder: failed to finalize view");
    return view;
  }

  finishView(): PasskeyEvent {
    return this.finish();
  }

  dynamicParams(): PasskeyEvent.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): PasskeyEvent.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = PasskeyEvent.Params.fromValues({
      payload_event_type: (() => { return __tnToBigInt(this.__tnPrefixView.getUint8(0)); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_event_type === null) throw new Error("PasskeyEventBuilder: field 'event_type' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PasskeyEventBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_event_type);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: PasskeyEvent.Params): void {
    const result = PasskeyEvent.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ PasskeyEvent }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

/* ----- TYPE DEFINITION FOR CreateArgs ----- */

const __tn_ir_CreateArgs = {
  typeName: "CreateArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 65n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class CreateArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CreateArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateArgs.__tnCreateView requires a Uint8Array");
    return new CreateArgs(new Uint8Array(buffer));
  }

  static builder(): CreateArgsBuilder {
    return new CreateArgsBuilder();
  }

  static fromBuilder(builder: CreateArgsBuilder): CreateArgs | null {
    const buffer = builder.build();
    return CreateArgs.from_array(buffer);
  }

  get_wallet_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_wallet_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get wallet_account_idx(): number {
    return this.get_wallet_account_idx();
  }

  set wallet_account_idx(value: number) {
    this.set_wallet_account_idx(value);
  }

  get_authority(): Authority {
    const offset = 2;
    const slice = this.buffer.subarray(offset, offset + 65);
    return Authority.from_array(slice)!;
  }

  set_authority(value: Authority): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 2;
    this.buffer.set(sourceBytes, offset);
  }

  get authority(): Authority {
    return this.get_authority();
  }

  set authority(value: Authority) {
    this.set_authority(value);
  }

  get_seed(): Seed32 {
    const offset = 67;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Seed32.from_array(slice)!;
  }

  set_seed(value: Seed32): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 67;
    this.buffer.set(sourceBytes, offset);
  }

  get seed(): Seed32 {
    return this.get_seed();
  }

  set seed(value: Seed32) {
    this.set_seed(value);
  }

  get_state_proof(): StateProof {
    const offset = 99;
    const tail = this.buffer.subarray(offset);
    const validation = StateProof.validate(tail);
    if (!validation.ok || validation.consumed === undefined) {
      throw new Error("CreateArgs: failed to read field 'state_proof' (invalid nested payload)");
    }
    const length = validation.consumed;
    const slice = tail.subarray(0, length);
    const opts = validation.params ? { params: validation.params } : undefined;
    return StateProof.from_array(slice, opts)!;
  }

  set_state_proof(value: StateProof): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 99;
    this.buffer.set(sourceBytes, offset);
  }

  get state_proof(): StateProof {
    return this.get_state_proof();
  }

  set state_proof(value: StateProof) {
    this.set_state_proof(value);
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

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateArgs');
    }
    return __tnBigIntToNumber(irResult, 'CreateArgs::footprint');
  }

  static validate(_buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    __tnLogWarn("CreateArgs::validate falling back to basic length check");
    return { ok: true, consumed: _buffer.length };
  }

  static from_array(buffer: Uint8Array): CreateArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CreateArgs(buffer);
  }

}

__tnRegisterFootprint("CreateArgs", (params) => CreateArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateArgs", (buffer, params) => CreateArgs.__tnInvokeValidate(buffer, params));

export class CreateArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnTail_state_proof: Uint8Array | null = null;

  constructor() {
    this.buffer = new Uint8Array(99);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    /* Placeholder for future cache invalidation. */
  }

  set_wallet_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_authority(value: Uint8Array): this {
    if (value.length !== 65) throw new Error("authority expects 65 bytes");
    this.buffer.set(value, 2);
    this.__tnInvalidate();
    return this;
  }

  set_seed(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("seed expects 32 bytes");
    this.buffer.set(value, 67);
    this.__tnInvalidate();
    return this;
  }

  set_state_proof(value: StateProof | __TnStructFieldInput): this {
    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, "CreateArgsBuilder::state_proof");
    this.__tnTail_state_proof = bytes;
    this.__tnInvalidate();
    return this;
  }

  build(): Uint8Array {
    const fragments = this.__tnCollectTailFragments();
    const size = this.__tnComputeSize(fragments);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer, fragments);
    this.__tnValidateOrThrow(buffer);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const fragments = this.__tnCollectTailFragments();
    const size = this.__tnComputeSize(fragments);
    if (target.length - offset < size) throw new Error("CreateArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice, fragments);
    this.__tnValidateOrThrow(slice);
    return target;
  }

  finish(): CreateArgs {
    const buffer = this.build();
    const view = CreateArgs.from_array(buffer);
    if (!view) throw new Error("CreateArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateArgs {
    return this.finish();
  }

  private __tnCollectTailFragments(): Uint8Array[] {
    return [
      (() => {
        const bytes = this.__tnTail_state_proof;
        if (!bytes) throw new Error("CreateArgsBuilder: field 'state_proof' must be set before build()");
        return bytes;
      })(),
    ];
  }

  private __tnComputeSize(fragments: readonly Uint8Array[]): number {
    let total = this.buffer.length;
    for (const fragment of fragments) {
      total += fragment.length;
    }
    return total;
  }

  private __tnWriteInto(target: Uint8Array, fragments: readonly Uint8Array[]): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    for (const fragment of fragments) {
      target.set(fragment, cursor);
      cursor += fragment.length;
    }
  }

  private __tnValidateOrThrow(buffer: Uint8Array): void {
    const result = CreateArgs.validate(buffer);
    if (!result.ok) {
      throw new Error(`CreateArgsBuilder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
  }
}

/* ----- TYPE DEFINITION FOR PasskeyInstruction ----- */

const __tn_ir_PasskeyInstruction = {
  typeName: "PasskeyInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class PasskeyInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): PasskeyInstruction_payload_Inner {
    return new PasskeyInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreate(): CreateArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return CreateArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asValidate(): ValidateArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return ValidateArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTransfer(): TransferArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return TransferArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInvoke(): InvokeArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return InvokeArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAddAuthority(): AddAuthorityArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return AddAuthorityArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asRemoveAuthority(): RemoveAuthorityArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 5) return null;
    return RemoveAuthorityArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class PasskeyInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 1;
  private __tnParams: PasskeyInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: PasskeyInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = PasskeyInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("PasskeyInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: PasskeyInstruction.Params }): PasskeyInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("PasskeyInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = PasskeyInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("PasskeyInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new PasskeyInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): PasskeyInstruction.Params {
    return this.__tnParams;
  }

  static builder(): PasskeyInstructionBuilder {
    return new PasskeyInstructionBuilder();
  }

  static fromBuilder(builder: PasskeyInstructionBuilder): PasskeyInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return PasskeyInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create",
      tag: 0,
      payloadSize: null,
      payloadType: "PasskeyInstruction::payload::create",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateArgs),
    },
    {
      name: "validate",
      tag: 1,
      payloadSize: null,
      payloadType: "PasskeyInstruction::payload::validate",
      createPayloadBuilder: () => __tnMaybeCallBuilder(ValidateArgs),
    },
    {
      name: "transfer",
      tag: 2,
      payloadSize: 12,
      payloadType: "PasskeyInstruction::payload::transfer",
      createPayloadBuilder: () => __tnMaybeCallBuilder(TransferArgs),
    },
    {
      name: "invoke",
      tag: 3,
      payloadSize: null,
      payloadType: "PasskeyInstruction::payload::invoke",
      createPayloadBuilder: () => __tnMaybeCallBuilder(InvokeArgs),
    },
    {
      name: "add_authority",
      tag: 4,
      payloadSize: 65,
      payloadType: "PasskeyInstruction::payload::add_authority",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AddAuthorityArgs),
    },
    {
      name: "remove_authority",
      tag: 5,
      payloadSize: 1,
      payloadType: "PasskeyInstruction::payload::remove_authority",
      createPayloadBuilder: () => __tnMaybeCallBuilder(RemoveAuthorityArgs),
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: PasskeyInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_payload_tag = __tnToBigInt(view.getUint8(0));
    const __tnLayout = PasskeyInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = PasskeyInstruction.Params.fromValues({
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

  payloadVariant(): typeof PasskeyInstruction.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return PasskeyInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): PasskeyInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("PasskeyInstruction: unknown payload variant");
    const offset = PasskeyInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("PasskeyInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return PasskeyInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_PasskeyInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_PasskeyInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_payload_size: number | bigint, payload_tag: number | bigint): bigint {
    const params = PasskeyInstruction.Params.fromValues({
      payload_payload_size: payload_payload_size,
      payload_tag: payload_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: PasskeyInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.payload_size"] = params.payload_payload_size;
    record["payload.tag"] = params.payload_tag;
    return record;
  }

  static footprintIrFromParams(params: PasskeyInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: PasskeyInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for PasskeyInstruction');
    return __tnBigIntToNumber(irResult, 'PasskeyInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): number {
    const params = PasskeyInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: PasskeyInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: PasskeyInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: PasskeyInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PasskeyInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'PasskeyInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: PasskeyInstruction.Params }): PasskeyInstruction | null {
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
    const state = new PasskeyInstruction(buffer, cached);
    return state;
  }


}

export namespace PasskeyInstruction {
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

__tnRegisterFootprint("PasskeyInstruction", (params) => PasskeyInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("PasskeyInstruction", (buffer, params) => PasskeyInstruction.__tnInvokeValidate(buffer, params));

export class PasskeyInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof PasskeyInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: PasskeyInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: PasskeyInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<PasskeyInstructionBuilder>;

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
    this.__tnField_tag = value & 0xff;
    this.__tnInvalidate();
  }

  set_tag(value: number): this {
    this.__tnAssign_tag(value);
    return this;
  }

  payload(): __TnVariantSelectorResult<PasskeyInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, PasskeyInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("PasskeyInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PasskeyInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PasskeyInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("PasskeyInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PasskeyInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 1 + payloadLength;
    const footprintSize = PasskeyInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("PasskeyInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): PasskeyInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = PasskeyInstruction.from_array(buffer, { params });
    if (!view) throw new Error("PasskeyInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): PasskeyInstruction {
    return this.finish();
  }

  dynamicParams(): PasskeyInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): PasskeyInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = PasskeyInstruction.Params.fromValues({
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("PasskeyInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
      payload_tag: (() => { if (this.__tnField_tag === null) throw new Error("PasskeyInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_tag === null) throw new Error("PasskeyInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("PasskeyInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(0, this.__tnField_tag);
    target.set(this.__tnPayload_payload.bytes, 1);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: PasskeyInstruction.Params): void {
    const result = PasskeyInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ PasskeyInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

