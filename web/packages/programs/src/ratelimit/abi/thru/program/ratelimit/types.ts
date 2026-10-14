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

/* ----- TYPE DEFINITION FOR CallArgs ----- */

const __tn_ir_CallArgs = {
  typeName: "CallArgs",
  root: { op: "const", value: 8n }
} as const;

export class CallArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): CallArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CallArgs.__tnCreateView requires a Uint8Array");
    return new CallArgs(new Uint8Array(buffer));
  }

  static builder(): CallArgsBuilder {
    return new CallArgsBuilder();
  }

  static fromBuilder(builder: CallArgsBuilder): CallArgs | null {
    const buffer = builder.build();
    return CallArgs.from_array(buffer);
  }

  get_policy_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_policy_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get policy_account_idx(): number {
    return this.get_policy_account_idx();
  }

  set policy_account_idx(value: number) {
    this.set_policy_account_idx(value);
  }

  get_target_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_target_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get target_account_idx(): number {
    return this.get_target_account_idx();
  }

  set target_account_idx(value: number) {
    this.set_target_account_idx(value);
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

  get_inner_sz(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_inner_sz(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get inner_sz(): number {
    return this.get_inner_sz();
  }

  set inner_sz(value: number) {
    this.set_inner_sz(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CallArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CallArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CallArgs');
    }
    return __tnBigIntToNumber(irResult, 'CallArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(policy_account_idx: number, target_account_idx: number, authority_account_idx: number, inner_sz: number): CallArgs {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint16(0, policy_account_idx, true); /* policy_account_idx (little-endian) */
    view.setUint16(2, target_account_idx, true); /* target_account_idx (little-endian) */
    view.setUint16(4, authority_account_idx, true); /* authority_account_idx (little-endian) */
    view.setUint16(6, inner_sz, true); /* inner_sz (little-endian) */

    return new CallArgs(buffer);
  }

  static from_array(buffer: Uint8Array): CallArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new CallArgs(buffer);
  }

}

export class CallArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_policy_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_target_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_inner_sz(value: number): this {
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

  finish(): CallArgs {
    const view = CallArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build CallArgs");
    return view;
  }
}

__tnRegisterFootprint("CallArgs", (params) => CallArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CallArgs", (buffer, params) => CallArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CallArgs", (buffer) => { const result = CallArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateAuthorityArgs ----- */

const __tn_ir_CreateAuthorityArgs = {
  typeName: "CreateAuthorityArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateAuthorityArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateAuthorityArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateAuthorityArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateAuthorityArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateAuthorityArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateAuthorityArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateAuthorityArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateAuthorityArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateAuthorityArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateAuthorityArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateAuthorityArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateAuthorityArgs.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateAuthorityArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreateAuthorityArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreateAuthorityArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateAuthorityArgsBuilder {
    return new CreateAuthorityArgsBuilder();
  }

  static fromBuilder(builder: CreateAuthorityArgsBuilder): CreateAuthorityArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateAuthorityArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_sz", paramKey: "proof_sz", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateAuthorityArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 6) {
      return null;
    }
    const __tnParam_proof_proof_sz = __tnToBigInt(view.getUint16(4, true));
    const __tnExtractedParams = CreateAuthorityArgs.Params.fromValues({
      proof_proof_sz: __tnParam_proof_proof_sz,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_policy_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_policy_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get policy_account_idx(): number {
    return this.get_policy_account_idx();
  }

  set policy_account_idx(value: number) {
    this.set_policy_account_idx(value);
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

  get_proof_sz(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_proof_sz(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
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
    const offset = 6;
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
    const offset = 6;
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
    return __tnEvalFootprint(__tn_ir_CreateAuthorityArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateAuthorityArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_sz: number | bigint): bigint {
    const params = CreateAuthorityArgs.Params.fromValues({
      proof_proof_sz: proof_proof_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateAuthorityArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_sz"] = params.proof_proof_sz;
    return record;
  }

  static footprintIrFromParams(params: CreateAuthorityArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateAuthorityArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateAuthorityArgs');
    return __tnBigIntToNumber(irResult, 'CreateAuthorityArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_sz: number | bigint }): number {
    const params = CreateAuthorityArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateAuthorityArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateAuthorityArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateAuthorityArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAuthorityArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateAuthorityArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateAuthorityArgs.Params }): CreateAuthorityArgs | null {
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
    const state = new CreateAuthorityArgs(buffer, cached);
    return state;
  }


}

export namespace CreateAuthorityArgs {
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

export class CreateAuthorityArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateAuthorityArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateAuthorityArgs.Params | null = null;
  private __tnFam_proof: Uint8Array | null = null;
  private __tnFam_proofCount: number | null = null;
  private __tnFamWriter_proof?: __TnFamWriterResult<CreateAuthorityArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(6);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_policy_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_authority_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz(value: number): this {
    this.view.setUint16(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  proof(): __TnFamWriterResult<CreateAuthorityArgsBuilder> {
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
    const size = CreateAuthorityArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateAuthorityArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateAuthorityArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateAuthorityArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateAuthorityArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateAuthorityArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateAuthorityArgs {
    return this.finish();
  }

  dynamicParams(): CreateAuthorityArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateAuthorityArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateAuthorityArgs.Params.fromValues({
      proof_proof_sz: (() => { if (this.__tnFam_proofCount === null) throw new Error("CreateAuthorityArgsBuilder: field 'proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_proof_bytes = this.__tnFam_proof;
    if (!__tnLocal_proof_bytes) throw new Error("CreateAuthorityArgsBuilder: field 'proof' must be written before build");
    target.set(__tnLocal_proof_bytes, cursor);
    cursor += __tnLocal_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateAuthorityArgs.Params): void {
    const result = CreateAuthorityArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateAuthorityArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateAuthorityArgs", (params) => CreateAuthorityArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateAuthorityArgs", (buffer, params) => CreateAuthorityArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateAuthorityArgs", (buffer) => { const result = CreateAuthorityArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

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

__tnRegisterFootprint("Pubkey", (params) => Pubkey.__tnInvokeFootprint(params));
__tnRegisterValidate("Pubkey", (buffer, params) => Pubkey.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("Pubkey", (buffer) => { const result = Pubkey.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitAuthority ----- */

const __tn_ir_RatelimitAuthority = {
  typeName: "RatelimitAuthority",
  root: { op: "const", value: 40n }
} as const;

export class RatelimitAuthority {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitAuthority {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitAuthority.__tnCreateView requires a Uint8Array");
    return new RatelimitAuthority(new Uint8Array(buffer));
  }

  static builder(): RatelimitAuthorityBuilder {
    return new RatelimitAuthorityBuilder();
  }

  static fromBuilder(builder: RatelimitAuthorityBuilder): RatelimitAuthority | null {
    const buffer = builder.build();
    return RatelimitAuthority.from_array(buffer);
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

  get_policy(): Pubkey {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_policy(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get policy(): Pubkey {
    return this.get_policy();
  }

  set policy(value: Pubkey) {
    this.set_policy(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitAuthority.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitAuthority, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitAuthority');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitAuthority::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 40) return { ok: false, code: "tn.buffer_too_small", consumed: 40 };
    return { ok: true, consumed: 40 };
  }

  static from_array(buffer: Uint8Array): RatelimitAuthority | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitAuthority(buffer);
  }

}

export class RatelimitAuthorityBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(40);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_magic(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_policy(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("policy expects 32 bytes");
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

  finish(): RatelimitAuthority {
    const view = RatelimitAuthority.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitAuthority");
    return view;
  }
}

__tnRegisterFootprint("RatelimitAuthority", (params) => RatelimitAuthority.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitAuthority", (buffer, params) => RatelimitAuthority.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitAuthority", (buffer) => { const result = RatelimitAuthority.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitBucket ----- */

const __tn_ir_RatelimitBucket = {
  typeName: "RatelimitBucket",
  root: { op: "const", value: 113n }
} as const;

export class RatelimitBucket {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitBucket {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitBucket.__tnCreateView requires a Uint8Array");
    return new RatelimitBucket(new Uint8Array(buffer));
  }

  static builder(): RatelimitBucketBuilder {
    return new RatelimitBucketBuilder();
  }

  static fromBuilder(builder: RatelimitBucketBuilder): RatelimitBucket | null {
    const buffer = builder.build();
    return RatelimitBucket.from_array(buffer);
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

  get_policy(): Pubkey {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_policy(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get policy(): Pubkey {
    return this.get_policy();
  }

  set policy(value: Pubkey) {
    this.set_policy(value);
  }

  get_key(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_key(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get key(): Pubkey {
    return this.get_key();
  }

  set key(value: Pubkey) {
    this.set_key(value);
  }

  get_rule_idx(): number {
    const offset = 72;
    return this.view.getUint8(offset);
  }

  set_rule_idx(value: number): void {
    const offset = 72;
    this.view.setUint8(offset, value);
  }

  get rule_idx(): number {
    return this.get_rule_idx();
  }

  set rule_idx(value: number) {
    this.set_rule_idx(value);
  }

  get_window_start(): bigint {
    const offset = 73;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_window_start(value: bigint): void {
    const offset = 73;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get window_start(): bigint {
    return this.get_window_start();
  }

  set window_start(value: bigint) {
    this.set_window_start(value);
  }

  get_calls(): bigint {
    const offset = 81;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_calls(value: bigint): void {
    const offset = 81;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get calls(): bigint {
    return this.get_calls();
  }

  set calls(value: bigint) {
    this.set_calls(value);
  }

  get_amount(): bigint {
    const offset = 89;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_amount(value: bigint): void {
    const offset = 89;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get amount(): bigint {
    return this.get_amount();
  }

  set amount(value: bigint) {
    this.set_amount(value);
  }

  get_total_calls(): bigint {
    const offset = 97;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_total_calls(value: bigint): void {
    const offset = 97;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get total_calls(): bigint {
    return this.get_total_calls();
  }

  set total_calls(value: bigint) {
    this.set_total_calls(value);
  }

  get_total_amount(): bigint {
    const offset = 105;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_total_amount(value: bigint): void {
    const offset = 105;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get total_amount(): bigint {
    return this.get_total_amount();
  }

  set total_amount(value: bigint) {
    this.set_total_amount(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitBucket.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitBucket, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitBucket');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitBucket::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 113) return { ok: false, code: "tn.buffer_too_small", consumed: 113 };
    return { ok: true, consumed: 113 };
  }

  static from_array(buffer: Uint8Array): RatelimitBucket | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitBucket(buffer);
  }

}

export class RatelimitBucketBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(113);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_magic(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_policy(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("policy expects 32 bytes");
    this.buffer.set(value, 8);
    return this;
  }

  set_key(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("key expects 32 bytes");
    this.buffer.set(value, 40);
    return this;
  }

  set_rule_idx(value: number): this {
    this.view.setUint8(72, value);
    return this;
  }

  set_window_start(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(73, cast, true);
    return this;
  }

  set_calls(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(81, cast, true);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(89, cast, true);
    return this;
  }

  set_total_calls(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(97, cast, true);
    return this;
  }

  set_total_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(105, cast, true);
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

  finish(): RatelimitBucket {
    const view = RatelimitBucket.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitBucket");
    return view;
  }
}

__tnRegisterFootprint("RatelimitBucket", (params) => RatelimitBucket.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitBucket", (buffer, params) => RatelimitBucket.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitBucket", (buffer) => { const result = RatelimitBucket.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitCallBucket ----- */

const __tn_ir_RatelimitCallBucket = {
  typeName: "RatelimitCallBucket",
  root: { op: "const", value: 36n }
} as const;

export class RatelimitCallBucket {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitCallBucket {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitCallBucket.__tnCreateView requires a Uint8Array");
    return new RatelimitCallBucket(new Uint8Array(buffer));
  }

  static builder(): RatelimitCallBucketBuilder {
    return new RatelimitCallBucketBuilder();
  }

  static fromBuilder(builder: RatelimitCallBucketBuilder): RatelimitCallBucket | null {
    const buffer = builder.build();
    return RatelimitCallBucket.from_array(buffer);
  }

  get_bucket_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_bucket_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get bucket_account_idx(): number {
    return this.get_bucket_account_idx();
  }

  set bucket_account_idx(value: number) {
    this.set_bucket_account_idx(value);
  }

  get_proof_sz(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_proof_sz(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get proof_sz(): number {
    return this.get_proof_sz();
  }

  set proof_sz(value: number) {
    this.set_proof_sz(value);
  }

  get_key(): Pubkey {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_key(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
    this.buffer.set(sourceBytes, offset);
  }

  get key(): Pubkey {
    return this.get_key();
  }

  set key(value: Pubkey) {
    this.set_key(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitCallBucket.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitCallBucket, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitCallBucket');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitCallBucket::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 36) return { ok: false, code: "tn.buffer_too_small", consumed: 36 };
    return { ok: true, consumed: 36 };
  }

  static from_array(buffer: Uint8Array): RatelimitCallBucket | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitCallBucket(buffer);
  }

}

export class RatelimitCallBucketBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(36);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_bucket_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_proof_sz(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_key(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("key expects 32 bytes");
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

  finish(): RatelimitCallBucket {
    const view = RatelimitCallBucket.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitCallBucket");
    return view;
  }
}

__tnRegisterFootprint("RatelimitCallBucket", (params) => RatelimitCallBucket.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitCallBucket", (buffer, params) => RatelimitCallBucket.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitCallBucket", (buffer) => { const result = RatelimitCallBucket.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitCallEvent ----- */

const __tn_ir_RatelimitCallEvent = {
  typeName: "RatelimitCallEvent",
  root: { op: "const", value: 136n }
} as const;

export class RatelimitCallEvent {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitCallEvent {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitCallEvent.__tnCreateView requires a Uint8Array");
    return new RatelimitCallEvent(new Uint8Array(buffer));
  }

  static builder(): RatelimitCallEventBuilder {
    return new RatelimitCallEventBuilder();
  }

  static fromBuilder(builder: RatelimitCallEventBuilder): RatelimitCallEvent | null {
    const buffer = builder.build();
    return RatelimitCallEvent.from_array(buffer);
  }

  get_policy(): Pubkey {
    const offset = 0;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_policy(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 0;
    this.buffer.set(sourceBytes, offset);
  }

  get policy(): Pubkey {
    return this.get_policy();
  }

  set policy(value: Pubkey) {
    this.set_policy(value);
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

  get_window_start(): bigint[] {
    const offset = 40;
    const result: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getBigUint64((offset + i * 8), true));
    }
    return result;
  }

  set_window_start(value: bigint[]): void {
    const offset = 40;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setBigUint64((offset + i * 8), value[i], true);
    }
  }

  get window_start(): bigint[] {
    return this.get_window_start();
  }

  set window_start(value: bigint[]) {
    this.set_window_start(value);
  }

  get_calls(): bigint[] {
    const offset = 72;
    const result: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getBigUint64((offset + i * 8), true));
    }
    return result;
  }

  set_calls(value: bigint[]): void {
    const offset = 72;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setBigUint64((offset + i * 8), value[i], true);
    }
  }

  get calls(): bigint[] {
    return this.get_calls();
  }

  set calls(value: bigint[]) {
    this.set_calls(value);
  }

  get_amounts(): bigint[] {
    const offset = 104;
    const result: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.view.getBigUint64((offset + i * 8), true));
    }
    return result;
  }

  set_amounts(value: bigint[]): void {
    const offset = 104;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      this.view.setBigUint64((offset + i * 8), value[i], true);
    }
  }

  get amounts(): bigint[] {
    return this.get_amounts();
  }

  set amounts(value: bigint[]) {
    this.set_amounts(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitCallEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitCallEvent, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitCallEvent');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitCallEvent::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 136) return { ok: false, code: "tn.buffer_too_small", consumed: 136 };
    return { ok: true, consumed: 136 };
  }

  static from_array(buffer: Uint8Array): RatelimitCallEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitCallEvent(buffer);
  }

}

export class RatelimitCallEventBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(136);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_policy(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("policy expects 32 bytes");
    this.buffer.set(value, 0);
    return this;
  }

  set_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(32, cast, true);
    return this;
  }

  set_window_start(values: bigint[]): this {
    if (values.length !== 4) throw new Error("window_start expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 40 + i * 8;
      this.view.setBigUint64(byteOffset, values[i], true);
    }
    return this;
  }

  set_calls(values: bigint[]): this {
    if (values.length !== 4) throw new Error("calls expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 72 + i * 8;
      this.view.setBigUint64(byteOffset, values[i], true);
    }
    return this;
  }

  set_amounts(values: bigint[]): this {
    if (values.length !== 4) throw new Error("amounts expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 104 + i * 8;
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

  finish(): RatelimitCallEvent {
    const view = RatelimitCallEvent.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitCallEvent");
    return view;
  }
}

__tnRegisterFootprint("RatelimitCallEvent", (params) => RatelimitCallEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitCallEvent", (buffer, params) => RatelimitCallEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitCallEvent", (buffer) => { const result = RatelimitCallEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitConstraint ----- */

const __tn_ir_RatelimitConstraint = {
  typeName: "RatelimitConstraint",
  root: { op: "const", value: 34n }
} as const;

export class RatelimitConstraint {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitConstraint {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitConstraint.__tnCreateView requires a Uint8Array");
    return new RatelimitConstraint(new Uint8Array(buffer));
  }

  static builder(): RatelimitConstraintBuilder {
    return new RatelimitConstraintBuilder();
  }

  static fromBuilder(builder: RatelimitConstraintBuilder): RatelimitConstraint | null {
    const buffer = builder.build();
    return RatelimitConstraint.from_array(buffer);
  }

  get_idx_offset(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_idx_offset(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get idx_offset(): number {
    return this.get_idx_offset();
  }

  set idx_offset(value: number) {
    this.set_idx_offset(value);
  }

  get_expected(): Pubkey {
    const offset = 2;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_expected(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 2;
    this.buffer.set(sourceBytes, offset);
  }

  get expected(): Pubkey {
    return this.get_expected();
  }

  set expected(value: Pubkey) {
    this.set_expected(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitConstraint.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitConstraint, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitConstraint');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitConstraint::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 34) return { ok: false, code: "tn.buffer_too_small", consumed: 34 };
    return { ok: true, consumed: 34 };
  }

  static from_array(buffer: Uint8Array): RatelimitConstraint | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitConstraint(buffer);
  }

}

export class RatelimitConstraintBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(34);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_idx_offset(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_expected(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("expected expects 32 bytes");
    this.buffer.set(value, 2);
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

  finish(): RatelimitConstraint {
    const view = RatelimitConstraint.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitConstraint");
    return view;
  }
}

__tnRegisterFootprint("RatelimitConstraint", (params) => RatelimitConstraint.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitConstraint", (buffer, params) => RatelimitConstraint.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitConstraint", (buffer) => { const result = RatelimitConstraint.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitError ----- */

const __tn_ir_RatelimitError = {
  typeName: "RatelimitError",
  root: { op: "const", value: 8n }
} as const;

export class RatelimitError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitError {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitError.__tnCreateView requires a Uint8Array");
    return new RatelimitError(new Uint8Array(buffer));
  }

  static builder(): RatelimitErrorBuilder {
    return new RatelimitErrorBuilder();
  }

  static fromBuilder(builder: RatelimitErrorBuilder): RatelimitError | null {
    const buffer = builder.build();
    return RatelimitError.from_array(buffer);
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
    return __tnEvalFootprint(__tn_ir_RatelimitError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitError, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitError');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(code: bigint): RatelimitError {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, code, true); /* code (little-endian) */

    return new RatelimitError(buffer);
  }

  static from_array(buffer: Uint8Array): RatelimitError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitError(buffer);
  }

}

export class RatelimitErrorBuilder {
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

  finish(): RatelimitError {
    const view = RatelimitError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitError");
    return view;
  }
}

__tnRegisterFootprint("RatelimitError", (params) => RatelimitError.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitError", (buffer, params) => RatelimitError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitError", (buffer) => { const result = RatelimitError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitRule ----- */

const __tn_ir_RatelimitRule = {
  typeName: "RatelimitRule",
  root: { op: "const", value: 28n }
} as const;

export class RatelimitRule {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitRule {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitRule.__tnCreateView requires a Uint8Array");
    return new RatelimitRule(new Uint8Array(buffer));
  }

  static builder(): RatelimitRuleBuilder {
    return new RatelimitRuleBuilder();
  }

  static fromBuilder(builder: RatelimitRuleBuilder): RatelimitRule | null {
    const buffer = builder.build();
    return RatelimitRule.from_array(buffer);
  }

  get_key_kind(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_key_kind(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get key_kind(): number {
    return this.get_key_kind();
  }

  set key_kind(value: number) {
    this.set_key_kind(value);
  }

  get_clock(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_clock(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get clock(): number {
    return this.get_clock();
  }

  set clock(value: number) {
    this.set_clock(value);
  }

  get_key_offset(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_key_offset(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get key_offset(): number {
    return this.get_key_offset();
  }

  set key_offset(value: number) {
    this.set_key_offset(value);
  }

  get_window(): bigint {
    const offset = 4;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_window(value: bigint): void {
    const offset = 4;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get window(): bigint {
    return this.get_window();
  }

  set window(value: bigint) {
    this.set_window(value);
  }

  get_max_calls(): bigint {
    const offset = 12;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_calls(value: bigint): void {
    const offset = 12;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_calls(): bigint {
    return this.get_max_calls();
  }

  set max_calls(value: bigint) {
    this.set_max_calls(value);
  }

  get_max_amount(): bigint {
    const offset = 20;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_amount(value: bigint): void {
    const offset = 20;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_amount(): bigint {
    return this.get_max_amount();
  }

  set max_amount(value: bigint) {
    this.set_max_amount(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitRule.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitRule, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitRule');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitRule::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 28) return { ok: false, code: "tn.buffer_too_small", consumed: 28 };
    return { ok: true, consumed: 28 };
  }

  static new(key_kind: number, clock: number, key_offset: number, window: bigint, max_calls: bigint, max_amount: bigint): RatelimitRule {
    const buffer = new Uint8Array(28);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setUint8(0, key_kind); /* key_kind */
    view.setUint8(1, clock); /* clock */
    view.setUint16(2, key_offset, true); /* key_offset (little-endian) */
    view.setBigUint64(4, window, true); /* window (little-endian) */
    view.setBigUint64(12, max_calls, true); /* max_calls (little-endian) */
    view.setBigUint64(20, max_amount, true); /* max_amount (little-endian) */

    return new RatelimitRule(buffer);
  }

  static from_array(buffer: Uint8Array): RatelimitRule | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitRule(buffer);
  }

}

export class RatelimitRuleBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(28);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_key_kind(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_clock(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_key_offset(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_window(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(4, cast, true);
    return this;
  }

  set_max_calls(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(12, cast, true);
    return this;
  }

  set_max_amount(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(20, cast, true);
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

  finish(): RatelimitRule {
    const view = RatelimitRule.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitRule");
    return view;
  }
}

__tnRegisterFootprint("RatelimitRule", (params) => RatelimitRule.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitRule", (buffer, params) => RatelimitRule.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitRule", (buffer) => { const result = RatelimitRule.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SetAdminArgs ----- */

const __tn_ir_SetAdminArgs = {
  typeName: "SetAdminArgs",
  root: { op: "const", value: 34n }
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

  get_policy_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_policy_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get policy_account_idx(): number {
    return this.get_policy_account_idx();
  }

  set policy_account_idx(value: number) {
    this.set_policy_account_idx(value);
  }

  get_new_admin(): Pubkey {
    const offset = 2;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_new_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 2;
    this.buffer.set(sourceBytes, offset);
  }

  get new_admin(): Pubkey {
    return this.get_new_admin();
  }

  set new_admin(value: Pubkey) {
    this.set_new_admin(value);
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
    if (buffer.length < 34) return { ok: false, code: "tn.buffer_too_small", consumed: 34 };
    return { ok: true, consumed: 34 };
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
    this.buffer = new Uint8Array(34);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_policy_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_new_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("new_admin expects 32 bytes");
    this.buffer.set(value, 2);
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

/* ----- TYPE DEFINITION FOR RatelimitConfig ----- */

const __tn_ir_RatelimitConfig = {
  typeName: "RatelimitConfig",
  root: { op: "const", value: 309n }
} as const;

export class RatelimitConfig {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitConfig {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitConfig.__tnCreateView requires a Uint8Array");
    return new RatelimitConfig(new Uint8Array(buffer));
  }

  static builder(): RatelimitConfigBuilder {
    return new RatelimitConfigBuilder();
  }

  static fromBuilder(builder: RatelimitConfigBuilder): RatelimitConfig | null {
    const buffer = builder.build();
    return RatelimitConfig.from_array(buffer);
  }

  get_flags(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_flags(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get flags(): number {
    return this.get_flags();
  }

  set flags(value: number) {
    this.set_flags(value);
  }

  get_rule_cnt(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_rule_cnt(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get rule_cnt(): number {
    return this.get_rule_cnt();
  }

  set rule_cnt(value: number) {
    this.set_rule_cnt(value);
  }

  get_constraint_cnt(): number {
    const offset = 2;
    return this.view.getUint8(offset);
  }

  set_constraint_cnt(value: number): void {
    const offset = 2;
    this.view.setUint8(offset, value);
  }

  get constraint_cnt(): number {
    return this.get_constraint_cnt();
  }

  set constraint_cnt(value: number) {
    this.set_constraint_cnt(value);
  }

  get_selector_sz(): number {
    const offset = 3;
    return this.view.getUint8(offset);
  }

  set_selector_sz(value: number): void {
    const offset = 3;
    this.view.setUint8(offset, value);
  }

  get selector_sz(): number {
    return this.get_selector_sz();
  }

  set selector_sz(value: number) {
    this.set_selector_sz(value);
  }

  get_selector_offset(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_selector_offset(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get selector_offset(): number {
    return this.get_selector_offset();
  }

  set selector_offset(value: number) {
    this.set_selector_offset(value);
  }

  get_selector_value(): bigint {
    const offset = 6;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_selector_value(value: bigint): void {
    const offset = 6;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get selector_value(): bigint {
    return this.get_selector_value();
  }

  set selector_value(value: bigint) {
    this.set_selector_value(value);
  }

  get_instr_sz_min(): number {
    const offset = 14;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_instr_sz_min(value: number): void {
    const offset = 14;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get instr_sz_min(): number {
    return this.get_instr_sz_min();
  }

  set instr_sz_min(value: number) {
    this.set_instr_sz_min(value);
  }

  get_instr_sz_max(): number {
    const offset = 16;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_instr_sz_max(value: number): void {
    const offset = 16;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get instr_sz_max(): number {
    return this.get_instr_sz_max();
  }

  set instr_sz_max(value: number) {
    this.set_instr_sz_max(value);
  }

  get_amount_sz(): number {
    const offset = 18;
    return this.view.getUint8(offset);
  }

  set_amount_sz(value: number): void {
    const offset = 18;
    this.view.setUint8(offset, value);
  }

  get amount_sz(): number {
    return this.get_amount_sz();
  }

  set amount_sz(value: number) {
    this.set_amount_sz(value);
  }

  get_amount_offset(): number {
    const offset = 19;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_amount_offset(value: number): void {
    const offset = 19;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get amount_offset(): number {
    return this.get_amount_offset();
  }

  set amount_offset(value: number) {
    this.set_amount_offset(value);
  }

  get_max_amount_per_call(): bigint {
    const offset = 21;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_max_amount_per_call(value: bigint): void {
    const offset = 21;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get max_amount_per_call(): bigint {
    return this.get_max_amount_per_call();
  }

  set max_amount_per_call(value: bigint) {
    this.set_max_amount_per_call(value);
  }

  get_attester(): Pubkey {
    const offset = 29;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_attester(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 29;
    this.buffer.set(sourceBytes, offset);
  }

  get attester(): Pubkey {
    return this.get_attester();
  }

  set attester(value: Pubkey) {
    this.set_attester(value);
  }

  get_constraints(): RatelimitConstraint[] {
    const offset = 61;
    const result: RatelimitConstraint[] = [];
    for (let i = 0; i < 4; i++) {
      const slice = this.buffer.subarray((offset + i * 34), (offset + (i + 1) * 34));
      result.push(RatelimitConstraint.from_array(slice)!);
    }
    return result;
  }

  set_constraints(value: RatelimitConstraint[]): void {
    const offset = 61;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      const slice = this.buffer.subarray(offset + i * 34, offset + (i + 1) * 34);
      slice.set(value[i]['buffer']);
    }
  }

  get constraints(): RatelimitConstraint[] {
    return this.get_constraints();
  }

  set constraints(value: RatelimitConstraint[]) {
    this.set_constraints(value);
  }

  get_rules(): RatelimitRule[] {
    const offset = 197;
    const result: RatelimitRule[] = [];
    for (let i = 0; i < 4; i++) {
      const slice = this.buffer.subarray((offset + i * 28), (offset + (i + 1) * 28));
      result.push(RatelimitRule.from_array(slice)!);
    }
    return result;
  }

  set_rules(value: RatelimitRule[]): void {
    const offset = 197;
    if (value.length !== 4) {
      throw new Error('Array length must be 4');
    }
    for (let i = 0; i < 4; i++) {
      const slice = this.buffer.subarray(offset + i * 28, offset + (i + 1) * 28);
      slice.set(value[i]['buffer']);
    }
  }

  get rules(): RatelimitRule[] {
    return this.get_rules();
  }

  set rules(value: RatelimitRule[]) {
    this.set_rules(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitConfig.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitConfig, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitConfig');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitConfig::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 309) return { ok: false, code: "tn.buffer_too_small", consumed: 309 };
    return { ok: true, consumed: 309 };
  }

  static from_array(buffer: Uint8Array): RatelimitConfig | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitConfig(buffer);
  }

}

export class RatelimitConfigBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(309);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_flags(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_rule_cnt(value: number): this {
    this.view.setUint8(1, value);
    return this;
  }

  set_constraint_cnt(value: number): this {
    this.view.setUint8(2, value);
    return this;
  }

  set_selector_sz(value: number): this {
    this.view.setUint8(3, value);
    return this;
  }

  set_selector_offset(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_selector_value(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
    return this;
  }

  set_instr_sz_min(value: number): this {
    this.view.setUint16(14, value, true);
    return this;
  }

  set_instr_sz_max(value: number): this {
    this.view.setUint16(16, value, true);
    return this;
  }

  set_amount_sz(value: number): this {
    this.view.setUint8(18, value);
    return this;
  }

  set_amount_offset(value: number): this {
    this.view.setUint16(19, value, true);
    return this;
  }

  set_max_amount_per_call(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(21, cast, true);
    return this;
  }

  set_attester(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("attester expects 32 bytes");
    this.buffer.set(value, 29);
    return this;
  }

  set_constraints(values: RatelimitConstraint[]): this {
    if (values.length !== 4) throw new Error("constraints expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const slice = this.buffer.subarray(61 + i * 34, 61 + (i + 1) * 34);
      const source = values[i] as unknown as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
      const raw = source.buffer ? new Uint8Array(source.buffer, source.byteOffset ?? 0, 34) : (values[i] as unknown as Uint8Array);
      slice.set(raw);
    }
    return this;
  }

  set_rules(values: RatelimitRule[]): this {
    if (values.length !== 4) throw new Error("rules expects 4 elements");
    for (let i = 0; i < values.length; i++) {
      const slice = this.buffer.subarray(197 + i * 28, 197 + (i + 1) * 28);
      const source = values[i] as unknown as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
      const raw = source.buffer ? new Uint8Array(source.buffer, source.byteOffset ?? 0, 28) : (values[i] as unknown as Uint8Array);
      slice.set(raw);
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

  finish(): RatelimitConfig {
    const view = RatelimitConfig.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitConfig");
    return view;
  }
}

__tnRegisterFootprint("RatelimitConfig", (params) => RatelimitConfig.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitConfig", (buffer, params) => RatelimitConfig.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitConfig", (buffer) => { const result = RatelimitConfig.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitPolicy ----- */

const __tn_ir_RatelimitPolicy = {
  typeName: "RatelimitPolicy",
  root: { op: "const", value: 390n }
} as const;

export class RatelimitPolicy {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): RatelimitPolicy {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitPolicy.__tnCreateView requires a Uint8Array");
    return new RatelimitPolicy(new Uint8Array(buffer));
  }

  static builder(): RatelimitPolicyBuilder {
    return new RatelimitPolicyBuilder();
  }

  static fromBuilder(builder: RatelimitPolicyBuilder): RatelimitPolicy | null {
    const buffer = builder.build();
    return RatelimitPolicy.from_array(buffer);
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

  get_admin(): Pubkey {
    const offset = 8;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 8;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): Pubkey {
    return this.get_admin();
  }

  set admin(value: Pubkey) {
    this.set_admin(value);
  }

  get_target(): Pubkey {
    const offset = 40;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_target(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 40;
    this.buffer.set(sourceBytes, offset);
  }

  get target(): Pubkey {
    return this.get_target();
  }

  set target(value: Pubkey) {
    this.set_target(value);
  }

  get_policy_id(): bigint {
    const offset = 72;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_policy_id(value: bigint): void {
    const offset = 72;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get policy_id(): bigint {
    return this.get_policy_id();
  }

  set policy_id(value: bigint) {
    this.set_policy_id(value);
  }

  get_state_flags(): number {
    const offset = 80;
    return this.view.getUint8(offset);
  }

  set_state_flags(value: number): void {
    const offset = 80;
    this.view.setUint8(offset, value);
  }

  get state_flags(): number {
    return this.get_state_flags();
  }

  set state_flags(value: number) {
    this.set_state_flags(value);
  }

  get_config(): RatelimitConfig {
    const offset = 81;
    const slice = this.buffer.subarray(offset, offset + 309);
    return RatelimitConfig.from_array(slice)!;
  }

  set_config(value: RatelimitConfig): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 81;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): RatelimitConfig {
    return this.get_config();
  }

  set config(value: RatelimitConfig) {
    this.set_config(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitPolicy.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitPolicy, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitPolicy');
    }
    return __tnBigIntToNumber(irResult, 'RatelimitPolicy::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 390) return { ok: false, code: "tn.buffer_too_small", consumed: 390 };
    return { ok: true, consumed: 390 };
  }

  static from_array(buffer: Uint8Array): RatelimitPolicy | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new RatelimitPolicy(buffer);
  }

}

export class RatelimitPolicyBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(390);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_magic(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("admin expects 32 bytes");
    this.buffer.set(value, 8);
    return this;
  }

  set_target(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("target expects 32 bytes");
    this.buffer.set(value, 40);
    return this;
  }

  set_policy_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(72, cast, true);
    return this;
  }

  set_state_flags(value: number): this {
    this.view.setUint8(80, value);
    return this;
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 309) throw new Error("config expects 309 bytes");
    this.buffer.set(value, 81);
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

  finish(): RatelimitPolicy {
    const view = RatelimitPolicy.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build RatelimitPolicy");
    return view;
  }
}

__tnRegisterFootprint("RatelimitPolicy", (params) => RatelimitPolicy.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitPolicy", (buffer, params) => RatelimitPolicy.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitPolicy", (buffer) => { const result = RatelimitPolicy.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR UpdatePolicyArgs ----- */

const __tn_ir_UpdatePolicyArgs = {
  typeName: "UpdatePolicyArgs",
  root: { op: "const", value: 311n }
} as const;

export class UpdatePolicyArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): UpdatePolicyArgs {
    if (!buffer || buffer.length === undefined) throw new Error("UpdatePolicyArgs.__tnCreateView requires a Uint8Array");
    return new UpdatePolicyArgs(new Uint8Array(buffer));
  }

  static builder(): UpdatePolicyArgsBuilder {
    return new UpdatePolicyArgsBuilder();
  }

  static fromBuilder(builder: UpdatePolicyArgsBuilder): UpdatePolicyArgs | null {
    const buffer = builder.build();
    return UpdatePolicyArgs.from_array(buffer);
  }

  get_policy_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_policy_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get policy_account_idx(): number {
    return this.get_policy_account_idx();
  }

  set policy_account_idx(value: number) {
    this.set_policy_account_idx(value);
  }

  get_config(): RatelimitConfig {
    const offset = 2;
    const slice = this.buffer.subarray(offset, offset + 309);
    return RatelimitConfig.from_array(slice)!;
  }

  set_config(value: RatelimitConfig): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 2;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): RatelimitConfig {
    return this.get_config();
  }

  set config(value: RatelimitConfig) {
    this.set_config(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_UpdatePolicyArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_UpdatePolicyArgs, buffer, __tnParams);
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
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for UpdatePolicyArgs');
    }
    return __tnBigIntToNumber(irResult, 'UpdatePolicyArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 311) return { ok: false, code: "tn.buffer_too_small", consumed: 311 };
    return { ok: true, consumed: 311 };
  }

  static from_array(buffer: Uint8Array): UpdatePolicyArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new UpdatePolicyArgs(buffer);
  }

}

export class UpdatePolicyArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(311);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_policy_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 309) throw new Error("config expects 309 bytes");
    this.buffer.set(value, 2);
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

  finish(): UpdatePolicyArgs {
    const view = UpdatePolicyArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build UpdatePolicyArgs");
    return view;
  }
}

__tnRegisterFootprint("UpdatePolicyArgs", (params) => UpdatePolicyArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("UpdatePolicyArgs", (buffer, params) => UpdatePolicyArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("UpdatePolicyArgs", (buffer) => { const result = UpdatePolicyArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreatePolicyArgs ----- */

const __tn_ir_CreatePolicyArgs = {
  typeName: "CreatePolicyArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 309n } } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_sz" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreatePolicyArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreatePolicyArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreatePolicyArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreatePolicyArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreatePolicyArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreatePolicyArgs.Params, fieldContext?: Record<string, number | bigint> }): CreatePolicyArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreatePolicyArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreatePolicyArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreatePolicyArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreatePolicyArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreatePolicyArgs.Params {
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
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreatePolicyArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreatePolicyArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreatePolicyArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreatePolicyArgsBuilder {
    return new CreatePolicyArgsBuilder();
  }

  static fromBuilder(builder: CreatePolicyArgsBuilder): CreatePolicyArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreatePolicyArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_sz", paramKey: "proof_sz", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreatePolicyArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 387) {
      return null;
    }
    const __tnParam_proof_proof_sz = __tnToBigInt(view.getUint16(385, true));
    const __tnExtractedParams = CreatePolicyArgs.Params.fromValues({
      proof_proof_sz: __tnParam_proof_proof_sz,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_policy_account_idx(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_policy_account_idx(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get policy_account_idx(): number {
    return this.get_policy_account_idx();
  }

  set policy_account_idx(value: number) {
    this.set_policy_account_idx(value);
  }

  get_meta_account_idx(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_meta_account_idx(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get meta_account_idx(): number {
    return this.get_meta_account_idx();
  }

  set meta_account_idx(value: number) {
    this.set_meta_account_idx(value);
  }

  get_admin(): Pubkey {
    const offset = 4;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_admin(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 4;
    this.buffer.set(sourceBytes, offset);
  }

  get admin(): Pubkey {
    return this.get_admin();
  }

  set admin(value: Pubkey) {
    this.set_admin(value);
  }

  get_target(): Pubkey {
    const offset = 36;
    const slice = this.buffer.subarray(offset, offset + 32);
    return Pubkey.from_array(slice)!;
  }

  set_target(value: Pubkey): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 36;
    this.buffer.set(sourceBytes, offset);
  }

  get target(): Pubkey {
    return this.get_target();
  }

  set target(value: Pubkey) {
    this.set_target(value);
  }

  get_policy_id(): bigint {
    const offset = 68;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_policy_id(value: bigint): void {
    const offset = 68;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get policy_id(): bigint {
    return this.get_policy_id();
  }

  set policy_id(value: bigint) {
    this.set_policy_id(value);
  }

  get_config(): RatelimitConfig {
    const offset = 76;
    const slice = this.buffer.subarray(offset, offset + 309);
    return RatelimitConfig.from_array(slice)!;
  }

  set_config(value: RatelimitConfig): void {
    /* Copy bytes from source struct to this field */
    const sourceBytes = (value as any).buffer as Uint8Array;
    const offset = 76;
    this.buffer.set(sourceBytes, offset);
  }

  get config(): RatelimitConfig {
    return this.get_config();
  }

  set config(value: RatelimitConfig) {
    this.set_config(value);
  }

  get_proof_sz(): number {
    const offset = 385;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_proof_sz(value: number): void {
    const offset = 385;
    this.view.setUint16(offset, value, true); /* little-endian */
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
    const offset = 387;
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
    const offset = 387;
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
    return __tnEvalFootprint(__tn_ir_CreatePolicyArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreatePolicyArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_sz: number | bigint): bigint {
    const params = CreatePolicyArgs.Params.fromValues({
      proof_proof_sz: proof_proof_sz,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreatePolicyArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_sz"] = params.proof_proof_sz;
    return record;
  }

  static footprintIrFromParams(params: CreatePolicyArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreatePolicyArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreatePolicyArgs');
    return __tnBigIntToNumber(irResult, 'CreatePolicyArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_sz: number | bigint }): number {
    const params = CreatePolicyArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreatePolicyArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreatePolicyArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreatePolicyArgs.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreatePolicyArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreatePolicyArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreatePolicyArgs.Params }): CreatePolicyArgs | null {
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
    const state = new CreatePolicyArgs(buffer, cached);
    return state;
  }


}

export namespace CreatePolicyArgs {
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

export class CreatePolicyArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreatePolicyArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreatePolicyArgs.Params | null = null;
  private __tnFam_proof: Uint8Array | null = null;
  private __tnFam_proofCount: number | null = null;
  private __tnFamWriter_proof?: __TnFamWriterResult<CreatePolicyArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(387);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_policy_account_idx(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_meta_account_idx(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_admin(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("admin expects 32 bytes");
    this.buffer.set(value, 4);
    this.__tnInvalidate();
    return this;
  }

  set_target(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("target expects 32 bytes");
    this.buffer.set(value, 36);
    this.__tnInvalidate();
    return this;
  }

  set_policy_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(68, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_config(value: Uint8Array): this {
    if (value.length !== 309) throw new Error("config expects 309 bytes");
    this.buffer.set(value, 76);
    this.__tnInvalidate();
    return this;
  }

  set_proof_sz(value: number): this {
    this.view.setUint16(385, value, true);
    this.__tnInvalidate();
    return this;
  }

  proof(): __TnFamWriterResult<CreatePolicyArgsBuilder> {
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
    const size = CreatePolicyArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreatePolicyArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreatePolicyArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreatePolicyArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreatePolicyArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreatePolicyArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreatePolicyArgs {
    return this.finish();
  }

  dynamicParams(): CreatePolicyArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreatePolicyArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreatePolicyArgs.Params.fromValues({
      proof_proof_sz: (() => { if (this.__tnFam_proofCount === null) throw new Error("CreatePolicyArgsBuilder: field 'proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_proof_bytes = this.__tnFam_proof;
    if (!__tnLocal_proof_bytes) throw new Error("CreatePolicyArgsBuilder: field 'proof' must be written before build");
    target.set(__tnLocal_proof_bytes, cursor);
    cursor += __tnLocal_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreatePolicyArgs.Params): void {
    const result = CreatePolicyArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreatePolicyArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreatePolicyArgs", (params) => CreatePolicyArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreatePolicyArgs", (buffer, params) => CreatePolicyArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreatePolicyArgs", (buffer) => { const result = CreatePolicyArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitAccount ----- */

const __tn_ir_RatelimitAccount = {
  typeName: "RatelimitAccount",
  root: { op: "align", alignment: 1, node: { op: "align", alignment: 1, node: { op: "switch", tag: "RatelimitAccount::data.payload_size", cases: [{ value: 390, node: { op: "align", alignment: 1, node: { op: "const", value: 390n } } }, { value: 113, node: { op: "align", alignment: 1, node: { op: "const", value: 113n } } }, { value: 40, node: { op: "align", alignment: 1, node: { op: "const", value: 40n } } }] } } }
} as const;

export class RatelimitAccount {
  private view: DataView;
  private __tnParams: RatelimitAccount.Params;

  private constructor(private buffer: Uint8Array, params?: RatelimitAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = RatelimitAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("RatelimitAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: RatelimitAccount.Params, fieldContext?: Record<string, number | bigint> }): RatelimitAccount {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = RatelimitAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("RatelimitAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new RatelimitAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): RatelimitAccount.Params {
    return this.__tnParams;
  }

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_data_payload_size: bigint | null = null;
    let __tnCursorMutable = 0;
    const __tnSduAvailable_data = __tnLength - __tnCursorMutable;
    let __tnSduSize_data = -1;
    switch (__tnSduAvailable_data) {
      case 390: __tnSduSize_data = 390; break;
      case 113: __tnSduSize_data = 113; break;
      case 40: __tnSduSize_data = 40; break;
      default: return null;
    }
    __tnParamSeq_data_payload_size = __tnToBigInt(__tnSduSize_data);
    __tnCursorMutable += __tnSduSize_data;
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_data_payload_size === null) return null;
    params["data_payload_size"] = __tnParamSeq_data_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: RatelimitAccount.Params; derived: Record<string, bigint> | null } | null {
    const __tnLayout = RatelimitAccount.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_data_payload_size = __tnSeqParams["data_payload_size"];
    if (__tnParamSeq_data_payload_size === undefined) return null;
    const __tnExtractedParams = RatelimitAccount.Params.fromValues({
      data_payload_size: __tnParamSeq_data_payload_size as bigint,
    });
    return { params: __tnExtractedParams, derived: null };
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(data_payload_size: number | bigint): bigint {
    const params = RatelimitAccount.Params.fromValues({
      data_payload_size: data_payload_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: RatelimitAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["data.payload_size"] = params.data_payload_size;
    record["RatelimitAccount::data.payload_size"] = params.data_payload_size;
    return record;
  }

  static footprintIrFromParams(params: RatelimitAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: RatelimitAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitAccount');
    return __tnBigIntToNumber(irResult, 'RatelimitAccount::footprintFromParams');
  }

  static footprintFromValues(input: { data_payload_size: number | bigint }): number {
    const params = RatelimitAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: RatelimitAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: RatelimitAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: RatelimitAccount.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'RatelimitAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'RatelimitAccount::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: RatelimitAccount.Params }): RatelimitAccount | null {
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
    const state = new RatelimitAccount(buffer, cached);
    return state;
  }


}

export namespace RatelimitAccount {
  export type Params = {
    /** ABI path: data.payload_size */
    readonly data_payload_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    data_payload_size: "data.payload_size",
  } as const);

  export const Params = {
    fromValues(input: { data_payload_size: number | bigint }): Params {
      return {
        data_payload_size: __tnToBigInt(input.data_payload_size),
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

  export function params(input: { data_payload_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

__tnRegisterFootprint("RatelimitAccount", (params) => RatelimitAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitAccount", (buffer, params) => RatelimitAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitAccount", (buffer) => { const result = RatelimitAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR RatelimitInstruction ----- */

const __tn_ir_RatelimitInstruction = {
  typeName: "RatelimitInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 4, node: { op: "const", value: 4n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "payload.payload_size" } } } }
} as const;

export class RatelimitInstruction_payload_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): RatelimitInstruction_payload_Inner {
    return new RatelimitInstruction_payload_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreatePolicy(): CreatePolicyArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return CreatePolicyArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asUpdatePolicy(): UpdatePolicyArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return UpdatePolicyArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSetAdmin(): SetAdminArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return SetAdminArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateAuthority(): CreateAuthorityArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return CreateAuthorityArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCall(): CallArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return CallArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class RatelimitInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_payload = 4;
  private __tnParams: RatelimitInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: RatelimitInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = RatelimitInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("RatelimitInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: RatelimitInstruction.Params, fieldContext?: Record<string, number | bigint> }): RatelimitInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("RatelimitInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = RatelimitInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("RatelimitInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new RatelimitInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): RatelimitInstruction.Params {
    return this.__tnParams;
  }

  static builder(): RatelimitInstructionBuilder {
    return new RatelimitInstructionBuilder();
  }

  static fromBuilder(builder: RatelimitInstructionBuilder): RatelimitInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return RatelimitInstruction.from_array(buffer, { params });
  }

  static readonly payloadVariantDescriptors = Object.freeze([
    {
      name: "create_policy",
      tag: 0,
      payloadSize: null,
      payloadType: "RatelimitInstruction::payload::create_policy",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreatePolicyArgs),
    },
    {
      name: "update_policy",
      tag: 1,
      payloadSize: 311,
      payloadType: "RatelimitInstruction::payload::update_policy",
      createPayloadBuilder: () => __tnMaybeCallBuilder(UpdatePolicyArgs),
    },
    {
      name: "set_admin",
      tag: 2,
      payloadSize: 34,
      payloadType: "RatelimitInstruction::payload::set_admin",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SetAdminArgs),
    },
    {
      name: "create_authority",
      tag: 3,
      payloadSize: null,
      payloadType: "RatelimitInstruction::payload::create_authority",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateAuthorityArgs),
    },
    {
      name: "call",
      tag: 4,
      payloadSize: 8,
      payloadType: "RatelimitInstruction::payload::call",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CallArgs),
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_payload_payload_size: bigint | null = null;
    let __tnFieldValue_tag: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_tag = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_tag = __tnRead_tag;
    __tnCursorMutable += 4;
    const __tnEnumTagValue_payload = __tnFieldValue_tag;
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

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: RatelimitInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_payload_tag = __tnToBigInt(view.getUint32(0, true));
    const __tnLayout = RatelimitInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_payload_payload_size = __tnSeqParams["payload_payload_size"];
    if (__tnParamSeq_payload_payload_size === undefined) return null;
    const __tnExtractedParams = RatelimitInstruction.Params.fromValues({
      payload_payload_size: __tnParamSeq_payload_payload_size as bigint,
      payload_tag: __tnParam_payload_tag,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_tag(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_tag(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get tag(): number {
    return this.get_tag();
  }

  set tag(value: number) {
    this.set_tag(value);
  }

  payloadVariant(): typeof RatelimitInstruction.payloadVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return RatelimitInstruction.payloadVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  payload(): RatelimitInstruction_payload_Inner {
    const descriptor = this.payloadVariant();
    if (!descriptor) throw new Error("RatelimitInstruction: unknown payload variant");
    const offset = RatelimitInstruction.__tnFieldOffset_payload;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("RatelimitInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return RatelimitInstruction_payload_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_RatelimitInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_RatelimitInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(payload_payload_size: number | bigint, payload_tag: number | bigint): bigint {
    const params = RatelimitInstruction.Params.fromValues({
      payload_payload_size: payload_payload_size,
      payload_tag: payload_tag,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: RatelimitInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["payload.payload_size"] = params.payload_payload_size;
    record["payload.tag"] = params.payload_tag;
    return record;
  }

  static footprintIrFromParams(params: RatelimitInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: RatelimitInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for RatelimitInstruction');
    return __tnBigIntToNumber(irResult, 'RatelimitInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { payload_payload_size: number | bigint, payload_tag: number | bigint }): number {
    const params = RatelimitInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: RatelimitInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: RatelimitInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: RatelimitInstruction.Params } {
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
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'RatelimitInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'RatelimitInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: RatelimitInstruction.Params }): RatelimitInstruction | null {
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
    const state = new RatelimitInstruction(buffer, cached);
    return state;
  }


}

export namespace RatelimitInstruction {
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

export class RatelimitInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_tag: number | null = null;
  private __tnPayload_payload: { descriptor: typeof RatelimitInstruction.payloadVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: RatelimitInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: RatelimitInstruction.Params | null = null;
  private __tnVariantSelector_payload?: __TnVariantSelectorResult<RatelimitInstructionBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(4);
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

  payload(): __TnVariantSelectorResult<RatelimitInstructionBuilder> {
    if (!this.__tnVariantSelector_payload) {
      this.__tnVariantSelector_payload = __tnCreateVariantSelector(this, RatelimitInstruction.payloadVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_payload = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_tag(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_payload!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("RatelimitInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("RatelimitInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = RatelimitInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_tag === null) throw new Error("RatelimitInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("RatelimitInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_payload.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = RatelimitInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("RatelimitInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): RatelimitInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = RatelimitInstruction.from_array(buffer, { params });
    if (!view) throw new Error("RatelimitInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): RatelimitInstruction {
    return this.finish();
  }

  dynamicParams(): RatelimitInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): RatelimitInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = RatelimitInstruction.Params.fromValues({
      payload_payload_size: (() => { if (!this.__tnPayload_payload) throw new Error("RatelimitInstructionBuilder: payload 'payload' must be selected before build"); return __tnToBigInt(this.__tnPayload_payload.bytes.length); })(),
      payload_tag: (() => { if (this.__tnField_tag === null) throw new Error("RatelimitInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_tag); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_tag === null) throw new Error("RatelimitInstructionBuilder: field 'tag' must be set before build");
    if (!this.__tnPayload_payload) throw new Error("RatelimitInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint32(0, this.__tnField_tag, true);
    target.set(this.__tnPayload_payload.bytes, 4);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: RatelimitInstruction.Params): void {
    const result = RatelimitInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ RatelimitInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("RatelimitInstruction", (params) => RatelimitInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("RatelimitInstruction", (buffer, params) => RatelimitInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("RatelimitInstruction", (buffer) => { const result = RatelimitInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
