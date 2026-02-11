/* Auto-generated TypeScript code */
/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */

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

/* ----- TYPE DEFINITION FOR Date ----- */

const __tn_ir_Date = {
  typeName: "Date",
  root: { op: "const", value: 6n }
} as const;

export class Date {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): Date {
    if (!buffer || buffer.length === undefined) throw new Error("Date.__tnCreateView requires a Uint8Array");
    return new Date(new Uint8Array(buffer));
  }

  static builder(): DateBuilder {
    return new DateBuilder();
  }

  static fromBuilder(builder: DateBuilder): Date | null {
    const buffer = builder.build();
    return Date.from_array(buffer);
  }

  get_year(): number {
    const offset = 0;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_year(value: number): void {
    const offset = 0;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get year(): number {
    return this.get_year();
  }

  set year(value: number) {
    this.set_year(value);
  }

  get_month(): number {
    const offset = 4;
    return this.view.getUint8(offset);
  }

  set_month(value: number): void {
    const offset = 4;
    this.view.setUint8(offset, value);
  }

  get month(): number {
    return this.get_month();
  }

  set month(value: number) {
    this.set_month(value);
  }

  get_day(): number {
    const offset = 5;
    return this.view.getUint8(offset);
  }

  set_day(value: number): void {
    const offset = 5;
    this.view.setUint8(offset, value);
  }

  get day(): number {
    return this.get_day();
  }

  set day(value: number) {
    this.set_day(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_Date.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Date, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Date');
    }
    return __tnBigIntToNumber(irResult, 'Date::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 6) return { ok: false, code: "tn.buffer_too_small", consumed: 6 };
    return { ok: true, consumed: 6 };
  }

  static new(year: number, month: number, day: number): Date {
    const buffer = new Uint8Array(6);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setInt32(0, year, true); /* year (little-endian) */
    view.setUint8(4, month); /* month */
    view.setUint8(5, day); /* day */

    return new Date(buffer);
  }

  static from_array(buffer: Uint8Array): Date | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Date(buffer);
  }

}

__tnRegisterFootprint("Date", (params) => Date.__tnInvokeFootprint(params));
__tnRegisterValidate("Date", (buffer, params) => Date.__tnInvokeValidate(buffer, params));

export class DateBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_year(value: number): this {
    this.view.setInt32(0, value, true);
    return this;
  }

  set_month(value: number): this {
    this.view.setUint8(4, value);
    return this;
  }

  set_day(value: number): this {
    this.view.setUint8(5, value);
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

  finish(): Date {
    const view = Date.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build Date");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR Duration ----- */

const __tn_ir_Duration = {
  typeName: "Duration",
  root: { op: "const", value: 12n }
} as const;

export class Duration {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): Duration {
    if (!buffer || buffer.length === undefined) throw new Error("Duration.__tnCreateView requires a Uint8Array");
    return new Duration(new Uint8Array(buffer));
  }

  static builder(): DurationBuilder {
    return new DurationBuilder();
  }

  static fromBuilder(builder: DurationBuilder): Duration | null {
    const buffer = builder.build();
    return Duration.from_array(buffer);
  }

  get_seconds(): bigint {
    const offset = 0;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_seconds(value: bigint): void {
    const offset = 0;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get seconds(): bigint {
    return this.get_seconds();
  }

  set seconds(value: bigint) {
    this.set_seconds(value);
  }

  get_nanos(): number {
    const offset = 8;
    return this.view.getInt32(offset, true); /* little-endian */
  }

  set_nanos(value: number): void {
    const offset = 8;
    this.view.setInt32(offset, value, true); /* little-endian */
  }

  get nanos(): number {
    return this.get_nanos();
  }

  set nanos(value: number) {
    this.set_nanos(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_Duration.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Duration, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Duration');
    }
    return __tnBigIntToNumber(irResult, 'Duration::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 12) return { ok: false, code: "tn.buffer_too_small", consumed: 12 };
    return { ok: true, consumed: 12 };
  }

  static new(seconds: bigint, nanos: number): Duration {
    const buffer = new Uint8Array(12);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigInt64(0, seconds, true); /* seconds (little-endian) */
    view.setInt32(8, nanos, true); /* nanos (little-endian) */

    return new Duration(buffer);
  }

  static from_array(buffer: Uint8Array): Duration | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Duration(buffer);
  }

}

__tnRegisterFootprint("Duration", (params) => Duration.__tnInvokeFootprint(params));
__tnRegisterValidate("Duration", (buffer, params) => Duration.__tnInvokeValidate(buffer, params));

export class DurationBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(12);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seconds(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(0, cast, true);
    return this;
  }

  set_nanos(value: number): this {
    this.view.setInt32(8, value, true);
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

  finish(): Duration {
    const view = Duration.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build Duration");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR FixedPoint ----- */

const __tn_ir_FixedPoint = {
  typeName: "FixedPoint",
  root: { op: "const", value: 9n }
} as const;

export class FixedPoint {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FixedPoint {
    if (!buffer || buffer.length === undefined) throw new Error("FixedPoint.__tnCreateView requires a Uint8Array");
    return new FixedPoint(new Uint8Array(buffer));
  }

  static builder(): FixedPointBuilder {
    return new FixedPointBuilder();
  }

  static fromBuilder(builder: FixedPointBuilder): FixedPoint | null {
    const buffer = builder.build();
    return FixedPoint.from_array(buffer);
  }

  get_mantissa(): bigint {
    const offset = 0;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_mantissa(value: bigint): void {
    const offset = 0;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get mantissa(): bigint {
    return this.get_mantissa();
  }

  set mantissa(value: bigint) {
    this.set_mantissa(value);
  }

  get_scale(): number {
    const offset = 8;
    return this.view.getUint8(offset);
  }

  set_scale(value: number): void {
    const offset = 8;
    this.view.setUint8(offset, value);
  }

  get scale(): number {
    return this.get_scale();
  }

  set scale(value: number) {
    this.set_scale(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FixedPoint.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FixedPoint, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FixedPoint');
    }
    return __tnBigIntToNumber(irResult, 'FixedPoint::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 9) return { ok: false, code: "tn.buffer_too_small", consumed: 9 };
    return { ok: true, consumed: 9 };
  }

  static new(mantissa: bigint, scale: number): FixedPoint {
    const buffer = new Uint8Array(9);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigInt64(0, mantissa, true); /* mantissa (little-endian) */
    view.setUint8(8, scale); /* scale */

    return new FixedPoint(buffer);
  }

  static from_array(buffer: Uint8Array): FixedPoint | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FixedPoint(buffer);
  }

}

__tnRegisterFootprint("FixedPoint", (params) => FixedPoint.__tnInvokeFootprint(params));
__tnRegisterValidate("FixedPoint", (buffer, params) => FixedPoint.__tnInvokeValidate(buffer, params));

export class FixedPointBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(9);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_mantissa(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(0, cast, true);
    return this;
  }

  set_scale(value: number): this {
    this.view.setUint8(8, value);
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

  finish(): FixedPoint {
    const view = FixedPoint.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FixedPoint");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR Hash ----- */

const __tn_ir_Hash = {
  typeName: "Hash",
  root: { op: "const", value: 32n }
} as const;

export class Hash {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): Hash {
    if (!buffer || buffer.length === undefined) throw new Error("Hash.__tnCreateView requires a Uint8Array");
    return new Hash(new Uint8Array(buffer));
  }

  static builder(): HashBuilder {
    return new HashBuilder();
  }

  static fromBuilder(builder: HashBuilder): Hash | null {
    const buffer = builder.build();
    return Hash.from_array(buffer);
  }

  get_bytes(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_bytes(value: number[]): void {
    const offset = 0;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
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
    return __tnEvalFootprint(__tn_ir_Hash.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Hash, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Hash');
    }
    return __tnBigIntToNumber(irResult, 'Hash::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 32) return { ok: false, code: "tn.buffer_too_small", consumed: 32 };
    return { ok: true, consumed: 32 };
  }

  static from_array(buffer: Uint8Array): Hash | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Hash(buffer);
  }

}

__tnRegisterFootprint("Hash", (params) => Hash.__tnInvokeFootprint(params));
__tnRegisterValidate("Hash", (buffer, params) => Hash.__tnInvokeValidate(buffer, params));

export class HashBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(32);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_bytes(values: number[]): this {
    if (values.length !== 32) throw new Error("bytes expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
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

  finish(): Hash {
    const view = Hash.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build Hash");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR InstructionData ----- */

const __tn_ir_InstructionData = {
  typeName: "InstructionData",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "data.data_size" }, right: { op: "const", value: 1n } } } } }
} as const;

export class InstructionData {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: InstructionData.Params;

  private constructor(private buffer: Uint8Array, params?: InstructionData.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = InstructionData.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("InstructionData: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: InstructionData.Params, fieldContext?: Record<string, number | bigint> }): InstructionData {
    if (!buffer || buffer.length === undefined) throw new Error("InstructionData.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = InstructionData.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("InstructionData.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new InstructionData(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): InstructionData.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "InstructionData::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "InstructionData::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("InstructionData: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): InstructionDataBuilder {
    return new InstructionDataBuilder();
  }

  static fromBuilder(builder: InstructionDataBuilder): InstructionData | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return InstructionData.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "data", method: "data", sizeField: "data_size", paramKey: "data_size", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: InstructionData.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 10) {
      return null;
    }
    const __tnParam_data_data_size = __tnToBigInt(view.getBigUint64(2, true));
    const __tnExtractedParams = InstructionData.Params.fromValues({
      data_data_size: __tnParam_data_data_size,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_program_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_program_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get program_idx(): number {
    return this.get_program_idx();
  }

  set program_idx(value: number) {
    this.set_program_idx(value);
  }

  get_data_size(): bigint {
    const offset = 2;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_data_size(value: bigint): void {
    const offset = 2;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get data_size(): bigint {
    return this.get_data_size();
  }

  set data_size(value: bigint) {
    this.set_data_size(value);
  }

  get_data_length(): number {
    return this.__tnResolveFieldRef("data_size");
  }

  get_data_at(index: number): number {
    const offset = 10;
    return this.view.getUint8(offset + index * 1);
  }

  get_data(): number[] {
    const len = this.get_data_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_data_at(i));
    }
    return result;
  }

  set_data_at(index: number, value: number): void {
    const offset = 10;
    this.view.setUint8((offset + index * 1), value);
  }

  set_data(value: number[]): void {
    const len = Math.min(this.get_data_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_data_at(i, value[i]);
    }
  }

  get data(): number[] {
    return this.get_data();
  }

  set data(value: number[]) {
    this.set_data(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_InstructionData.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_InstructionData, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(data_data_size: number | bigint): bigint {
    const params = InstructionData.Params.fromValues({
      data_data_size: data_data_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: InstructionData.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["data.data_size"] = params.data_data_size;
    return record;
  }

  static footprintIrFromParams(params: InstructionData.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: InstructionData.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for InstructionData');
    return __tnBigIntToNumber(irResult, 'InstructionData::footprintFromParams');
  }

  static footprintFromValues(input: { data_data_size: number | bigint }): number {
    const params = InstructionData.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: InstructionData.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: InstructionData.Params }): { ok: boolean; code?: string; consumed?: number; params?: InstructionData.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InstructionData::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'InstructionData::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: InstructionData.Params }): InstructionData | null {
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
    const state = new InstructionData(buffer, cached);
    return state;
  }


}

export namespace InstructionData {
  export type Params = {
    /** ABI path: data.data_size */
    readonly data_data_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    data_data_size: "data.data_size",
  } as const);

  export const Params = {
    fromValues(input: { data_data_size: number | bigint }): Params {
      return {
        data_data_size: __tnToBigInt(input.data_data_size),
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

  export function params(input: { data_data_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("InstructionData", (params) => InstructionData.__tnInvokeFootprint(params));
__tnRegisterValidate("InstructionData", (buffer, params) => InstructionData.__tnInvokeValidate(buffer, params));

export class InstructionDataBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: InstructionData.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: InstructionData.Params | null = null;
  private __tnFam_data: Uint8Array | null = null;
  private __tnFam_dataCount: number | null = null;
  private __tnFamWriter_data?: __TnFamWriterResult<InstructionDataBuilder>;

  constructor() {
    this.buffer = new Uint8Array(10);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_program_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_data_size(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(2, cast, true);
    this.__tnInvalidate();
    return this;
  }

  data(): __TnFamWriterResult<InstructionDataBuilder> {
    if (!this.__tnFamWriter_data) {
      this.__tnFamWriter_data = __tnCreateFamWriter(this, "data", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_data = bytes;
        this.__tnFam_dataCount = elementCount;
        this.set_data_size(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_data!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = InstructionData.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = InstructionData.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("InstructionDataBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): InstructionData {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = InstructionData.from_array(buffer, { params });
    if (!view) throw new Error("InstructionDataBuilder: failed to finalize view");
    return view;
  }

  finishView(): InstructionData {
    return this.finish();
  }

  dynamicParams(): InstructionData.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): InstructionData.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = InstructionData.Params.fromValues({
      data_data_size: (() => { if (this.__tnFam_dataCount === null) throw new Error("InstructionDataBuilder: field 'data' must be written before computing params"); return __tnToBigInt(this.__tnFam_dataCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_data_bytes = this.__tnFam_data;
    if (!__tnLocal_data_bytes) throw new Error("InstructionDataBuilder: field 'data' must be written before build");
    target.set(__tnLocal_data_bytes, cursor);
    cursor += __tnLocal_data_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: InstructionData.Params): void {
    const result = InstructionData.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ InstructionData }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

/* ----- TYPE DEFINITION FOR Pubkey ----- */

const __tn_ir_Pubkey = {
  typeName: "Pubkey",
  root: { op: "const", value: 32n }
} as const;

export class Pubkey {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): Pubkey {
    if (!buffer || buffer.length === undefined) throw new Error("Pubkey.__tnCreateView requires a Uint8Array");
    return new Pubkey(new Uint8Array(buffer));
  }

  static builder(): PubkeyBuilder {
    return new PubkeyBuilder();
  }

  static fromBuilder(builder: PubkeyBuilder): Pubkey | null {
    const buffer = builder.build();
    return Pubkey.from_array(buffer);
  }

  get_bytes(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_bytes(value: number[]): void {
    const offset = 0;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
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
    return __tnEvalFootprint(__tn_ir_Pubkey.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Pubkey, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Pubkey');
    }
    return __tnBigIntToNumber(irResult, 'Pubkey::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 32) return { ok: false, code: "tn.buffer_too_small", consumed: 32 };
    return { ok: true, consumed: 32 };
  }

  static from_array(buffer: Uint8Array): Pubkey | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Pubkey(buffer);
  }

}

__tnRegisterFootprint("Pubkey", (params) => Pubkey.__tnInvokeFootprint(params));
__tnRegisterValidate("Pubkey", (buffer, params) => Pubkey.__tnInvokeValidate(buffer, params));

export class PubkeyBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(32);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_bytes(values: number[]): this {
    if (values.length !== 32) throw new Error("bytes expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
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

  finish(): Pubkey {
    const view = Pubkey.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build Pubkey");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR Signature ----- */

const __tn_ir_Signature = {
  typeName: "Signature",
  root: { op: "const", value: 64n }
} as const;

export class Signature {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): Signature {
    if (!buffer || buffer.length === undefined) throw new Error("Signature.__tnCreateView requires a Uint8Array");
    return new Signature(new Uint8Array(buffer));
  }

  static builder(): SignatureBuilder {
    return new SignatureBuilder();
  }

  static fromBuilder(builder: SignatureBuilder): Signature | null {
    const buffer = builder.build();
    return Signature.from_array(buffer);
  }

  get_bytes(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 64; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_bytes(value: number[]): void {
    const offset = 0;
    if (value.length !== 64) {
      throw new Error('Array length must be 64');
    }
    for (let i = 0; i < 64; i++) {
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
    return __tnEvalFootprint(__tn_ir_Signature.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Signature, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Signature');
    }
    return __tnBigIntToNumber(irResult, 'Signature::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 64) return { ok: false, code: "tn.buffer_too_small", consumed: 64 };
    return { ok: true, consumed: 64 };
  }

  static from_array(buffer: Uint8Array): Signature | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Signature(buffer);
  }

}

__tnRegisterFootprint("Signature", (params) => Signature.__tnInvokeFootprint(params));
__tnRegisterValidate("Signature", (buffer, params) => Signature.__tnInvokeValidate(buffer, params));

export class SignatureBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(64);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_bytes(values: number[]): this {
    if (values.length !== 64) throw new Error("bytes expects 64 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
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

  finish(): Signature {
    const view = Signature.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build Signature");
    return view;
  }
}

/* ----- TYPE DEFINITION FOR Timestamp ----- */

const __tn_ir_Timestamp = {
  typeName: "Timestamp",
  root: { op: "const", value: 8n }
} as const;

export class Timestamp {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): Timestamp {
    if (!buffer || buffer.length === undefined) throw new Error("Timestamp.__tnCreateView requires a Uint8Array");
    return new Timestamp(new Uint8Array(buffer));
  }

  static builder(): TimestampBuilder {
    return new TimestampBuilder();
  }

  static fromBuilder(builder: TimestampBuilder): Timestamp | null {
    const buffer = builder.build();
    return Timestamp.from_array(buffer);
  }

  get_seconds(): bigint {
    const offset = 0;
    return this.view.getBigInt64(offset, true); /* little-endian */
  }

  set_seconds(value: bigint): void {
    const offset = 0;
    this.view.setBigInt64(offset, value, true); /* little-endian */
  }

  get seconds(): bigint {
    return this.get_seconds();
  }

  set seconds(value: bigint) {
    this.set_seconds(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_Timestamp.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_Timestamp, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for Timestamp');
    }
    return __tnBigIntToNumber(irResult, 'Timestamp::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(seconds: bigint): Timestamp {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigInt64(0, seconds, true); /* seconds (little-endian) */

    return new Timestamp(buffer);
  }

  static from_array(buffer: Uint8Array): Timestamp | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new Timestamp(buffer);
  }

}

__tnRegisterFootprint("Timestamp", (params) => Timestamp.__tnInvokeFootprint(params));
__tnRegisterValidate("Timestamp", (buffer, params) => Timestamp.__tnInvokeValidate(buffer, params));

export class TimestampBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_seconds(value: number): this {
    const cast = __tnToBigInt(value);
    this.view.setBigInt64(0, cast, true);
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

  finish(): Timestamp {
    const view = Timestamp.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build Timestamp");
    return view;
  }
}

