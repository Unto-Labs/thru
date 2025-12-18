import { hexToBytes, toUint8Array } from "./utils/bytes";
import { isNodeRuntime } from "./utils/runtime";
import type { FormattedReflection } from "./types";

type WasmReflectBindings = {
  reflect: (abi: string, typeName: string, buffer: Uint8Array) => string;
  reflect_instruction: (abi: string, buffer: Uint8Array) => string;
  reflect_account: (abi: string, buffer: Uint8Array) => string;
  reflect_event: (abi: string, buffer: Uint8Array) => string;
  build_layout_ir: (abi: string) => string;
  format_reflection: (raw: string) => string;
  format_reflection_with_options: (raw: string, options: string) => string;
  wasm_start?: () => void;
};

type JsonValue = unknown;

// Configuration for WASM loading
let configuredWasmUrl: string | undefined;

/**
 * Configure the URL from which to load the WASM file.
 * Must be called before any reflection functions are used.
 *
 * This is useful for environments like Next.js where bundler-based WASM loading
 * doesn't work. Instead, copy the WASM file to your public directory and call:
 *
 * @example
 * ```ts
 * import { configureWasm } from "@thru/abi";
 * configureWasm("/wasm/abi_reflect_wasm_bg.wasm");
 * ```
 *
 * @param url - URL or path to the WASM file (e.g., "/wasm/abi_reflect_wasm_bg.wasm")
 */
export function configureWasm(url: string): void {
  if (cachedBindings) {
    console.warn("configureWasm called after WASM was already loaded. Configuration ignored.");
    return;
  }
  configuredWasmUrl = url;
}

const wasmDir = resolveWasmDir();
let bindingsPromise: Promise<WasmReflectBindings> | undefined;
let cachedBindings: WasmReflectBindings | undefined;

function resolveWasmDir(): string {
  const url = import.meta.url;
  if (url.includes("/src/")) return "../wasm";
  if (url.includes("/dist/")) return "./wasm";
  return "./wasm";
}

async function loadBindings(): Promise<WasmReflectBindings> {
  if (cachedBindings) {
    return cachedBindings;
  }
  if (!bindingsPromise) {
    let loader: Promise<WasmReflectBindings>;
    if (isNodeRuntime()) {
      loader = loadNodeBindings();
    } else if (configuredWasmUrl) {
      loader = loadWebBindings(configuredWasmUrl);
    } else {
      loader = loadBundlerBindings();
    }
    bindingsPromise = loader.then((bindings) => {
      cachedBindings = bindings;
      return bindings;
    });
  }
  return bindingsPromise;
}

async function loadWebBindings(wasmUrl: string): Promise<WasmReflectBindings> {
  const moduleUrl = new URL(`${wasmDir}/web/abi_reflect_wasm.js`, import.meta.url);
  const mod = (await import(
    /* webpackIgnore: true */
    /* @vite-ignore */
    moduleUrl.href
  )) as WasmReflectBindings & { default: (url: string) => Promise<void> };

  // Initialize with the configured WASM URL
  await mod.default(wasmUrl);

  return mod;
}

async function loadBundlerBindings(): Promise<WasmReflectBindings> {
  const mod = await importBindings("bundler/abi_reflect_wasm.js");
  return mod;
}

async function loadNodeBindings(): Promise<WasmReflectBindings> {
  const mod = await importBindings("node/abi_reflect_wasm.js");
  if (typeof mod.wasm_start === "function") {
    mod.wasm_start();
  }
  return mod;
}

async function importBindings(relativePath: string): Promise<WasmReflectBindings> {
  const moduleUrl = new URL(`${wasmDir}/${relativePath}`, import.meta.url);
  const imported = (await import(
    /* webpackIgnore: true */
    /* @vite-ignore */
    moduleUrl.href
  )) as WasmReflectBindings | { default: WasmReflectBindings };
  const bindings = "default" in imported ? imported.default : imported;
  return bindings;
}

async function callReflect(
  abiYaml: string,
  typeName: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const result = bindings.reflect(abiYaml, typeName, buffer);
  return JSON.parse(result);
}

async function callLayoutIr(abiYaml: string): Promise<JsonValue> {
  const bindings = await loadBindings();
  const result = bindings.build_layout_ir(abiYaml);
  return JSON.parse(result);
}

async function callReflectInstruction(
  abiYaml: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const result = bindings.reflect_instruction(abiYaml, buffer);
  return JSON.parse(result);
}

async function callReflectAccount(
  abiYaml: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const result = bindings.reflect_account(abiYaml, buffer);
  return JSON.parse(result);
}

async function callReflectEvent(
  abiYaml: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const result = bindings.reflect_event(abiYaml, buffer);
  return JSON.parse(result);
}

export type BinaryLike = Uint8Array | ArrayBuffer | ArrayBufferView | number[];

export async function reflect(
  abiYaml: string,
  typeName: string,
  payload: {type: 'binary', value: BinaryLike} | {type: 'hex', value: string },
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflect(abiYaml, typeName, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflect(abiYaml, typeName, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

export async function buildLayoutIr(abiYaml: string): Promise<JsonValue> {
  return callLayoutIr(abiYaml);
}

export type ReflectRootPayload = {type: 'binary', value: BinaryLike} | {type: 'hex', value: string };

export async function reflectInstruction(
  abiYaml: string,
  payload: ReflectRootPayload,
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflectInstruction(abiYaml, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflectInstruction(abiYaml, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

export async function reflectAccount(
  abiYaml: string,
  payload: ReflectRootPayload,
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflectAccount(abiYaml, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflectAccount(abiYaml, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

export async function reflectEvent(
  abiYaml: string,
  payload: ReflectRootPayload,
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflectEvent(abiYaml, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflectEvent(abiYaml, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

export async function ensureWasmLoaded(): Promise<void> {
  await loadBindings();
}

function requireBindings(): WasmReflectBindings {
  if (cachedBindings) {
    return cachedBindings;
  }
  throw new Error("WASM bindings are not loaded. Call ensureWasmLoaded() first.");
}

export interface FormatOptions {
  includeByteOffsets?: boolean;
}

export function formatReflection(raw: JsonValue, options?: FormatOptions): FormattedReflection {
  const bindings = requireBindings();
  const serialized = JSON.stringify(raw);

  if (options && Object.keys(options).length > 0) {
    const optionsJson = JSON.stringify(options);
    const result = bindings.format_reflection_with_options(serialized, optionsJson);
    return JSON.parse(result) as FormattedReflection;
  }

  const result = bindings.format_reflection(serialized);
  return JSON.parse(result) as FormattedReflection;
}
