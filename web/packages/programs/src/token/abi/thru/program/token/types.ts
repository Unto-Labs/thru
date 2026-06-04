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

__tnRegisterFootprint("BurnInstruction", (params) => BurnInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("BurnInstruction", (buffer, params) => BurnInstruction.__tnInvokeValidate(buffer, params));

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

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
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

  finish(): BurnInstruction {
    const view = BurnInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BurnInstruction");
    return view;
  }
}

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

__tnRegisterFootprint("CloseAccountInstruction", (params) => CloseAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("CloseAccountInstruction", (buffer, params) => CloseAccountInstruction.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CloseAccountInstruction {
    const view = CloseAccountInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CloseAccountInstruction");
    return view;
  }
}

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

__tnRegisterFootprint("FreezeAccountInstruction", (params) => FreezeAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("FreezeAccountInstruction", (buffer, params) => FreezeAccountInstruction.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FreezeAccountInstruction {
    const view = FreezeAccountInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FreezeAccountInstruction");
    return view;
  }
}

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

__tnRegisterFootprint("MintToInstruction", (params) => MintToInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("MintToInstruction", (buffer, params) => MintToInstruction.__tnInvokeValidate(buffer, params));

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

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
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

  finish(): MintToInstruction {
    const view = MintToInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MintToInstruction");
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

__tnRegisterFootprint("ThawAccountEventData", (params) => ThawAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("ThawAccountEventData", (buffer, params) => ThawAccountEventData.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ThawAccountEventData {
    const view = ThawAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ThawAccountEventData");
    return view;
  }
}

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

__tnRegisterFootprint("ThawAccountInstruction", (params) => ThawAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("ThawAccountInstruction", (buffer, params) => ThawAccountInstruction.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): ThawAccountInstruction {
    const view = ThawAccountInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build ThawAccountInstruction");
    return view;
  }
}

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

__tnRegisterFootprint("TickerField", (params) => TickerField.__tnInvokeFootprint(params));
__tnRegisterValidate("TickerField", (buffer, params) => TickerField.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TickerField {
    const view = TickerField.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TickerField");
    return view;
  }
}

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

__tnRegisterFootprint("TokenAccount", (params) => TokenAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenAccount", (buffer, params) => TokenAccount.__tnInvokeValidate(buffer, params));

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

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_is_frozen(value: number): this {
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

  finish(): TokenAccount {
    const view = TokenAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TokenAccount");
    return view;
  }
}

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

__tnRegisterFootprint("TokenMintAccount", (params) => TokenMintAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenMintAccount", (buffer, params) => TokenMintAccount.__tnInvokeValidate(buffer, params));

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

  set_supply(value: number): this {
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): TokenMintAccount {
    const view = TokenMintAccount.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TokenMintAccount");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR TokenProgramAccount ----- */

const __tn_ir_TokenProgramAccount = {
  typeName: "TokenProgramAccount",
  root: { op: "align", alignment: 1, node: { op: "align", alignment: 1, node: { op: "switch", tag: "TokenProgramAccount::data.payload_size", cases: [{ value: 73, node: { op: "align", alignment: 1, node: { op: "const", value: 73n } } }, { value: 115, node: { op: "align", alignment: 1, node: { op: "const", value: 115n } } }] } } }
} as const;

export class TokenProgramAccount {
  private view: DataView;
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

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: TokenProgramAccount.Params }): TokenProgramAccount {
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

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_data_payload_size: bigint | null = null;
    let __tnParamSeq_TokenProgramAccount__data_payload_size: bigint | null = null;
    let __tnCursorMutable = 0;
    const __tnSduAvailable_data = __tnLength - __tnCursorMutable;
    let __tnSduSize_data = -1;
    switch (__tnSduAvailable_data) {
      case 73: __tnSduSize_data = 73; break;
      case 115: __tnSduSize_data = 115; break;
      default: return null;
    }
    __tnParamSeq_data_payload_size = __tnToBigInt(__tnSduSize_data);
    __tnParamSeq_TokenProgramAccount__data_payload_size = __tnToBigInt(__tnSduSize_data);
    __tnCursorMutable += __tnSduSize_data;
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_data_payload_size === null) return null;
    params["data_payload_size"] = __tnParamSeq_data_payload_size as bigint;
    if (__tnParamSeq_TokenProgramAccount__data_payload_size === null) return null;
    params["TokenProgramAccount__data_payload_size"] = __tnParamSeq_TokenProgramAccount__data_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: TokenProgramAccount.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = TokenProgramAccount.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_data_payload_size = __tnSeqParams["data_payload_size"];
    if (__tnParamSeq_data_payload_size === undefined) return null;
    const __tnParamSeq_TokenProgramAccount__data_payload_size = __tnSeqParams["TokenProgramAccount__data_payload_size"];
    if (__tnParamSeq_TokenProgramAccount__data_payload_size === undefined) return null;
    const __tnExtractedParams = TokenProgramAccount.Params.fromValues({
      data_payload_size: __tnParamSeq_data_payload_size as bigint,
      TokenProgramAccount__data_payload_size: __tnParamSeq_TokenProgramAccount__data_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
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

  static footprintIr(data_payload_size: number | bigint, TokenProgramAccount__data_payload_size: number | bigint): bigint {
    const params = TokenProgramAccount.Params.fromValues({
      data_payload_size: data_payload_size,
      TokenProgramAccount__data_payload_size: TokenProgramAccount__data_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: TokenProgramAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["data.payload_size"] = params.data_payload_size;
    record["TokenProgramAccount::data.payload_size"] = params.TokenProgramAccount__data_payload_size;
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

  static footprintFromValues(input: { data_payload_size: number | bigint, TokenProgramAccount__data_payload_size: number | bigint }): number {
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
    return { ok: true, consumed, params };
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
    /** ABI path: data.payload_size */
    readonly data_payload_size: bigint;
    /** Runtime payload size (bytes) selecting size-discriminated variant (ABI path: TokenProgramAccount::data.payload_size) */
    readonly TokenProgramAccount__data_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    data_payload_size: "data.payload_size",
    TokenProgramAccount__data_payload_size: "TokenProgramAccount::data.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { data_payload_size: number | bigint, TokenProgramAccount__data_payload_size: number | bigint }): Params {
      return {
        data_payload_size: __tnToBigInt(input.data_payload_size),
        TokenProgramAccount__data_payload_size: __tnToBigInt(input.TokenProgramAccount__data_payload_size),
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

  export function params(input: { data_payload_size: number | bigint, TokenProgramAccount__data_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("TokenProgramAccount", (params) => TokenProgramAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenProgramAccount", (buffer, params) => TokenProgramAccount.__tnInvokeValidate(buffer, params));

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

__tnRegisterFootprint("TransferEventData", (params) => TransferEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("TransferEventData", (buffer, params) => TransferEventData.__tnInvokeValidate(buffer, params));

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

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(64, cast, true);
    return this;
  }

  set_source_post_balance(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(72, cast, true);
    return this;
  }

  set_dest_post_balance(value: number): this {
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

  finish(): TransferEventData {
    const view = TransferEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TransferEventData");
    return view;
  }
}

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

__tnRegisterFootprint("TransferInstruction", (params) => TransferInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("TransferInstruction", (buffer, params) => TransferInstruction.__tnInvokeValidate(buffer, params));

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

  finish(): TransferInstruction {
    const view = TransferInstruction.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build TransferInstruction");
    return view;
  }
}

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

__tnRegisterFootprint("BurnEventData", (params) => BurnEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("BurnEventData", (buffer, params) => BurnEventData.__tnInvokeValidate(buffer, params));

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

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_account_post_balance(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_mint_supply(value: number): this {
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

  finish(): BurnEventData {
    const view = BurnEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BurnEventData");
    return view;
  }
}

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

__tnRegisterFootprint("CloseAccountEventData", (params) => CloseAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("CloseAccountEventData", (buffer, params) => CloseAccountEventData.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): CloseAccountEventData {
    const view = CloseAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CloseAccountEventData");
    return view;
  }
}

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

__tnRegisterFootprint("FreezeAccountEventData", (params) => FreezeAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("FreezeAccountEventData", (buffer, params) => FreezeAccountEventData.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FreezeAccountEventData {
    const view = FreezeAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FreezeAccountEventData");
    return view;
  }
}

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

__tnRegisterFootprint("InitializeAccountEventData", (params) => InitializeAccountEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeAccountEventData", (buffer, params) => InitializeAccountEventData.__tnInvokeValidate(buffer, params));

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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): InitializeAccountEventData {
    const view = InitializeAccountEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build InitializeAccountEventData");
    return view;
  }
}

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

__tnRegisterFootprint("InitializeMintEventData", (params) => InitializeMintEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeMintEventData", (buffer, params) => InitializeMintEventData.__tnInvokeValidate(buffer, params));

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

  set_supply(value: number): this {
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
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): InitializeMintEventData {
    const view = InitializeMintEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build InitializeMintEventData");
    return view;
  }
}

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

__tnRegisterFootprint("MintToEventData", (params) => MintToEventData.__tnInvokeFootprint(params));
__tnRegisterValidate("MintToEventData", (buffer, params) => MintToEventData.__tnInvokeValidate(buffer, params));

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

  set_amount(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(96, cast, true);
    return this;
  }

  set_dest_post_balance(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(104, cast, true);
    return this;
  }

  set_mint_supply(value: number): this {
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

  finish(): MintToEventData {
    const view = MintToEventData.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build MintToEventData");
    return view;
  }
}

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

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInitializeMint(): InitializeMintEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return InitializeMintEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInitializeAccount(): InitializeAccountEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return InitializeAccountEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTransfer(): TransferEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return TransferEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMintTo(): MintToEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return MintToEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBurn(): BurnEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return BurnEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAccount(): CloseAccountEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 5) return null;
    return CloseAccountEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFreezeAccount(): FreezeAccountEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 6) return null;
    return FreezeAccountEventData.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asThawAccount(): ThawAccountEventData | null {
    if (!this.descriptor || this.descriptor.tag !== 7) return null;
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

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: TokenEvent.Params }): TokenEvent {
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
    if (buffer.length < 1) {
      return null;
    }
    const __tnParam_TokenEvent__payload_event_type = __tnToBigInt(view.getUint8(0));
    const __tnExtractedParams = TokenEvent.Params.fromValues({
      payload_event_type: __tnParam_payload_event_type,
      TokenEvent__payload_event_type: __tnParam_TokenEvent__payload_event_type,
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
    const tag = this.view.getUint8(0);
    return TokenEvent.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
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

  static footprintIr(payload_event_type: number | bigint, TokenEvent__payload_event_type: number | bigint): bigint {
    const params = TokenEvent.Params.fromValues({
      payload_event_type: payload_event_type,
      TokenEvent__payload_event_type: TokenEvent__payload_event_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: TokenEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.event_type"] = params.payload_event_type;
    record["TokenEvent::payload.event_type"] = params.TokenEvent__payload_event_type;
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

  static footprintFromValues(input: { payload_event_type: number | bigint, TokenEvent__payload_event_type: number | bigint }): number {
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
    return { ok: true, consumed, params };
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
    /** ABI path: TokenEvent::payload.event_type */
    readonly TokenEvent__payload_event_type: bigint;
  };

  export const ParamKeys = Object.freeze({
    payload_event_type: "payload.event_type",
    TokenEvent__payload_event_type: "TokenEvent::payload.event_type",
  } as const);

  export const Params = {
    fromValues(input: { payload_event_type: number | bigint, TokenEvent__payload_event_type?: number | bigint }): Params {
      const payloadEventType = __tnToBigInt(input.payload_event_type);
      const tokenEventPayloadType = input.TokenEvent__payload_event_type !== undefined
        ? __tnToBigInt(input.TokenEvent__payload_event_type)
        : payloadEventType;
      return {
        payload_event_type: payloadEventType,
        TokenEvent__payload_event_type: tokenEventPayloadType,
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

  export function params(input: { payload_event_type: number | bigint, TokenEvent__payload_event_type?: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("TokenEvent", (params) => TokenEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenEvent", (buffer, params) => TokenEvent.__tnInvokeValidate(buffer, params));

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
    this.__tnField_event_type = value & 0xff;
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
    const eventType = __tnToBigInt(this.__tnPrefixView.getUint8(0));
    const params = TokenEvent.Params.fromValues({
      payload_event_type: eventType,
      TokenEvent__payload_event_type: eventType,
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

/* ----- TYPE DEFINITION FOR InitializeAccountInstruction ----- */

const __tn_ir_InitializeAccountInstruction = {
  typeName: "InitializeAccountInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class InitializeAccountInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): InitializeAccountInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("InitializeAccountInstruction.__tnCreateView requires a Uint8Array");
    return new InitializeAccountInstruction(new Uint8Array(buffer));
  }

  static builder(): InitializeAccountInstructionBuilder {
    return new InitializeAccountInstructionBuilder();
  }

  static fromBuilder(builder: InitializeAccountInstructionBuilder): InitializeAccountInstruction | null {
    const buffer = builder.build();
    return InitializeAccountInstruction.from_array(buffer);
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

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InitializeAccountInstruction');
    }
    return __tnBigIntToNumber(irResult, 'InitializeAccountInstruction::footprint');
  }

  static validate(_buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    __tnLogWarn("InitializeAccountInstruction::validate falling back to basic length check");
    return { ok: true, consumed: _buffer.length };
  }

  static from_array(buffer: Uint8Array): InitializeAccountInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new InitializeAccountInstruction(buffer);
  }

}

__tnRegisterFootprint("InitializeAccountInstruction", (params) => InitializeAccountInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeAccountInstruction", (buffer, params) => InitializeAccountInstruction.__tnInvokeValidate(buffer, params));

export class InitializeAccountInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnTail_state_proof: Uint8Array | null = null;

  constructor() {
    this.buffer = new Uint8Array(38);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    /* Placeholder for future cache invalidation. */
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
    if (target.length - offset < size) throw new Error("InitializeAccountInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice, fragments);
    this.__tnValidateOrThrow(slice);
    return target;
  }

  finish(): InitializeAccountInstruction {
    const buffer = this.build();
    const view = InitializeAccountInstruction.from_array(buffer);
    if (!view) throw new Error("InitializeAccountInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): InitializeAccountInstruction {
    return this.finish();
  }

  private __tnCollectTailFragments(): Uint8Array[] {
    return [
      (() => {
        const bytes = this.__tnTail_state_proof;
        if (!bytes) throw new Error("InitializeAccountInstructionBuilder: field 'state_proof' must be set before build()");
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
    const result = InitializeAccountInstruction.validate(buffer);
    if (!result.ok) {
      throw new Error(`InitializeAccountInstructionBuilder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
  }
}

/* ----- TYPE DEFINITION FOR InitializeMintInstruction ----- */

const __tn_ir_InitializeMintInstruction = {
  typeName: "InitializeMintInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 9n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "call", typeName: "StateProof", args: [{ name: "proof_body.hdr.type_slot", source: "proof_body.hdr.type_slot" }, { name: "proof_body.payload_size", source: "proof_body.payload_size" }] } } } }
} as const;

export class InitializeMintInstruction {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): InitializeMintInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("InitializeMintInstruction.__tnCreateView requires a Uint8Array");
    return new InitializeMintInstruction(new Uint8Array(buffer));
  }

  static builder(): InitializeMintInstructionBuilder {
    return new InitializeMintInstructionBuilder();
  }

  static fromBuilder(builder: InitializeMintInstructionBuilder): InitializeMintInstruction | null {
    const buffer = builder.build();
    return InitializeMintInstruction.from_array(buffer);
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

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InitializeMintInstruction');
    }
    return __tnBigIntToNumber(irResult, 'InitializeMintInstruction::footprint');
  }

  static validate(_buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    __tnLogWarn("InitializeMintInstruction::validate falling back to basic length check");
    return { ok: true, consumed: _buffer.length };
  }

  static from_array(buffer: Uint8Array): InitializeMintInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new InitializeMintInstruction(buffer);
  }

}

__tnRegisterFootprint("InitializeMintInstruction", (params) => InitializeMintInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("InitializeMintInstruction", (buffer, params) => InitializeMintInstruction.__tnInvokeValidate(buffer, params));

export class InitializeMintInstructionBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnTail_state_proof: Uint8Array | null = null;

  constructor() {
    this.buffer = new Uint8Array(141);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    /* Placeholder for future cache invalidation. */
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
    if (target.length - offset < size) throw new Error("InitializeMintInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice, fragments);
    this.__tnValidateOrThrow(slice);
    return target;
  }

  finish(): InitializeMintInstruction {
    const buffer = this.build();
    const view = InitializeMintInstruction.from_array(buffer);
    if (!view) throw new Error("InitializeMintInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): InitializeMintInstruction {
    return this.finish();
  }

  private __tnCollectTailFragments(): Uint8Array[] {
    return [
      (() => {
        const bytes = this.__tnTail_state_proof;
        if (!bytes) throw new Error("InitializeMintInstructionBuilder: field 'state_proof' must be set before build()");
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
    const result = InitializeMintInstruction.validate(buffer);
    if (!result.ok) {
      throw new Error(`InitializeMintInstructionBuilder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
  }
}

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

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asInitializeMint(): InitializeMintInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return InitializeMintInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asInitializeAccount(): InitializeAccountInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return InitializeAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asTransfer(): TransferInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return TransferInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asMintTo(): MintToInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return MintToInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asBurn(): BurnInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return BurnInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCloseAccount(): CloseAccountInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 5) return null;
    return CloseAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asFreezeAccount(): FreezeAccountInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 6) return null;
    return FreezeAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asThawAccount(): ThawAccountInstruction | null {
    if (!this.descriptor || this.descriptor.tag !== 7) return null;
    return ThawAccountInstruction.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
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

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: TokenInstruction.Params }): TokenInstruction {
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
    const tag = this.view.getUint8(0);
    return TokenInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
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
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'TokenInstruction::validate') : undefined;
    return { ok: true, consumed, params };
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

__tnRegisterFootprint("TokenInstruction", (params) => TokenInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("TokenInstruction", (buffer, params) => TokenInstruction.__tnInvokeValidate(buffer, params));

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
    this.__tnField_tag = value & 0xff;
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
