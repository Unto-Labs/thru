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
  /* Manifest-based functions for ABIs with imports */
  reflect_with_manifest: (manifest: string, rootPackage: string, typeName: string, buffer: Uint8Array) => string;
  reflect_instruction_with_manifest: (manifest: string, rootPackage: string, buffer: Uint8Array) => string;
  reflect_account_with_manifest: (manifest: string, rootPackage: string, buffer: Uint8Array) => string;
  reflect_event_with_manifest: (manifest: string, rootPackage: string, buffer: Uint8Array) => string;
  build_layout_ir_with_manifest: (manifest: string, rootPackage: string) => string;
  get_manifest_packages: (manifest: string) => string;
  validate_manifest: (manifest: string) => string;
  wasm_start?: () => void;
};

type JsonValue = unknown;
declare const require: ((specifier: string) => unknown) | undefined;
declare const HermesInternal: unknown;

export interface WasmConfig {
  /**
   * Public URL for the generated wasm-pack JS glue module.
   *
   * Browser apps that bundle @thru/sdk can use this to load ABI
   * reflection from a stable static asset path instead of relying on a
   * package-relative dynamic import.
   */
  moduleUrl?: string;

  /**
   * Public URL for abi_reflect_wasm_bg.wasm.
   */
  wasmUrl: string;
}

// Configuration for WASM loading
let configuredWasmUrl: string | undefined;
let configuredWasmModuleUrl: string | undefined;

/**
 * Configure the URL from which to load the WASM file.
 * Must be called before any reflection functions are used.
 *
 * This is useful for environments like Next.js where bundler-based WASM loading
 * doesn't work. Instead, copy the WASM file to your public directory and call:
 *
 * @example
 * ```ts
 * import { configureWasm } from "@thru/sdk/abi";
 * configureWasm("/wasm/abi_reflect_wasm_bg.wasm");
 * ```
 *
 * Browser apps that serve both the generated wasm-pack JS glue and the
 * `.wasm` binary from public assets should pass both URLs:
 *
 * @example
 * ```ts
 * configureWasm({
 *   moduleUrl: "/wasm/abi/web/abi_reflect_wasm.js",
 *   wasmUrl: "/wasm/abi/web/abi_reflect_wasm_bg.wasm",
 * });
 * ```
 *
 * Passing a string preserves the legacy behavior and only configures
 * the `.wasm` binary URL.
 *
 * @param config - WASM URL or full browser asset configuration.
 */
export function configureWasm(config: string | WasmConfig): void {
  if (cachedBindings) {
    console.warn("configureWasm called after WASM was already loaded. Configuration ignored.");
    return;
  }
  if (typeof config === "string") {
    configuredWasmUrl = config;
    configuredWasmModuleUrl = undefined;
    return;
  }
  configuredWasmUrl = config.wasmUrl;
  configuredWasmModuleUrl = config.moduleUrl;
}

const wasmDir = resolveWasmDir();
let bindingsPromise: Promise<WasmReflectBindings> | undefined;
let cachedBindings: WasmReflectBindings | undefined;
let dynamicImport: ((specifier: string) => Promise<unknown>) | undefined;

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function hasWasmBinding(value: unknown, name: keyof WasmReflectBindings): boolean {
  return isObjectLike(value) && typeof value[name] === "function";
}

function isWasmReflectBindings(value: unknown): value is WasmReflectBindings {
  return (
    hasWasmBinding(value, "reflect") &&
    hasWasmBinding(value, "reflect_instruction") &&
    hasWasmBinding(value, "format_reflection")
  );
}

function describeImportedBindings(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function unwrapImportedBindings(imported: unknown, relativePath: string): WasmReflectBindings {
  const defaultExport = isObjectLike(imported) ? imported.default : undefined;
  const candidate = defaultExport ?? imported;

  if (isWasmReflectBindings(candidate)) {
    return candidate;
  }
  if (isWasmReflectBindings(imported)) {
    return imported;
  }

  throw new Error(
    `WASM bindings import did not return a module object for ${relativePath} (received ${describeImportedBindings(imported)})`
  );
}

function resolveImportMetaUrl(): string {
  const url = import.meta.url as string | null | undefined;
  if (typeof url === "string" && url.length > 0) return url;

  const location =
    typeof globalThis.location === "object" && globalThis.location
      ? globalThis.location
      : undefined;
  if (typeof location?.href === "string" && location.href.length > 0) {
    return location.href;
  }

  return "file:///";
}

async function importModule(specifier: string): Promise<unknown> {
  if (isHermesRuntime()) {
    throw new Error(
      "WASM ABI reflection is not available in React Native/Hermes. Use known-payload decoding or a reflection API fallback."
    );
  }

  dynamicImport ??= new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<unknown>;

  return dynamicImport(specifier);
}

function isHermesRuntime(): boolean {
  return typeof HermesInternal !== "undefined";
}

function resolveModuleUrl(path: string, base: string): string {
  return new URL(path, base).href;
}

function resolveRuntimeUrl(url: string): string {
  if (/^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/\/)/.test(url)) {
    return url;
  }

  const location =
    typeof globalThis.location === "object" && globalThis.location
      ? globalThis.location
      : undefined;
  const base =
    typeof location?.href === "string" && location.href.length > 0
      ? location.href
      : resolveImportMetaUrl();

  return resolveModuleUrl(url, base);
}

function requireModule(moduleUrl: string): unknown | undefined {
  try {
    const requireFn = typeof require === "function" ? require : undefined;
    if (!requireFn) return undefined;

    const specifier = moduleUrl.startsWith("file:")
      ? decodeURIComponent(new URL(moduleUrl).pathname)
      : moduleUrl;
    return requireFn(specifier);
  } catch {
    return undefined;
  }
}

function resolveWasmDir(): string {
  const url = resolveImportMetaUrl();
  if (url.includes("/src/abi/")) return "../../wasm/abi";
  if (url.includes("/dist/")) return "./wasm";
  return "./wasm";
}

function resolveConfiguredWasmModuleUrl(wasmUrl: string): string {
  const base =
    typeof globalThis.location === "object" &&
    typeof globalThis.location?.href === "string"
      ? globalThis.location.href
      : resolveImportMetaUrl();
  const resolved = new URL(wasmUrl, base);
  if (resolved.pathname.endsWith("_bg.wasm")) {
    resolved.pathname = resolved.pathname.slice(0, -"_bg.wasm".length) + ".js";
  } else if (resolved.pathname.endsWith(".wasm")) {
    resolved.pathname = resolved.pathname.slice(0, -".wasm".length) + ".js";
  } else {
    throw new Error(
      `Configured WASM URL must end in .wasm (received ${wasmUrl})`,
    );
  }
  resolved.search = "";
  resolved.hash = "";
  return resolved.href;
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
      loader = loadWebBindings(configuredWasmUrl, configuredWasmModuleUrl);
    } else {
      loader = loadBundlerBindings();
    }
    bindingsPromise = loader.then(
      (bindings) => {
        cachedBindings = bindings;
        return bindings;
      },
      (err) => {
        bindingsPromise = undefined;
        throw err;
      }
    );
  }
  return bindingsPromise;
}

async function loadWebBindings(
  wasmUrl: string,
  moduleUrlOverride?: string,
): Promise<WasmReflectBindings> {
  const moduleUrl = moduleUrlOverride
    ? resolveRuntimeUrl(moduleUrlOverride)
    : resolveConfiguredWasmModuleUrl(wasmUrl);
  const imported = await importModule(moduleUrl);
  const mod = unwrapImportedBindings(imported, moduleUrl);
  const initializer = isObjectLike(imported) ? imported.default : undefined;
  if (typeof initializer !== "function") {
    throw new Error(`WASM web module is missing default initializer for ${moduleUrl}`);
  }

  // Initialize with the configured WASM URL
  await initializer({ module_or_path: resolveRuntimeUrl(wasmUrl) });

  return mod;
}

async function loadBundlerBindings(): Promise<WasmReflectBindings> {
  const mod = await importBindings("bundler/abi_reflect_wasm.js");
  return mod;
}

async function loadNodeBindings(): Promise<WasmReflectBindings> {
  const relativePath = "node/abi_reflect_wasm.js";
  const moduleUrl = resolveModuleUrl(`${wasmDir}/${relativePath}`, resolveImportMetaUrl());
  const imported = requireModule(moduleUrl) ?? (await importModule(moduleUrl));
  const mod = unwrapImportedBindings(imported, relativePath);
  if (typeof mod.wasm_start === "function") {
    mod.wasm_start();
  }
  return mod;
}

async function importBindings(relativePath: string): Promise<WasmReflectBindings> {
  const moduleUrl = resolveModuleUrl(`${wasmDir}/${relativePath}`, resolveImportMetaUrl());
  const imported = await importModule(moduleUrl);
  return unwrapImportedBindings(imported, relativePath);
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

/* ============================================================================
   Manifest-based Functions

   These functions support ABIs with imports by accepting a pre-resolved manifest
   (a map of package names to their ABI YAML content).
   ============================================================================ */

export type Manifest = Record<string, string>;

async function callReflectWithManifest(
  manifest: Manifest,
  rootPackage: string,
  typeName: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const manifestJson = JSON.stringify(manifest);
  const result = bindings.reflect_with_manifest(manifestJson, rootPackage, typeName, buffer);
  return JSON.parse(result);
}

async function callReflectInstructionWithManifest(
  manifest: Manifest,
  rootPackage: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const manifestJson = JSON.stringify(manifest);
  const result = bindings.reflect_instruction_with_manifest(manifestJson, rootPackage, buffer);
  return JSON.parse(result);
}

async function callReflectAccountWithManifest(
  manifest: Manifest,
  rootPackage: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const manifestJson = JSON.stringify(manifest);
  const result = bindings.reflect_account_with_manifest(manifestJson, rootPackage, buffer);
  return JSON.parse(result);
}

async function callReflectEventWithManifest(
  manifest: Manifest,
  rootPackage: string,
  buffer: Uint8Array,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const manifestJson = JSON.stringify(manifest);
  const result = bindings.reflect_event_with_manifest(manifestJson, rootPackage, buffer);
  return JSON.parse(result);
}

/**
 * Reflect a binary buffer using a pre-resolved manifest.
 *
 * @param manifest - Map of package names to ABI YAML content
 * @param rootPackage - The package containing the target type
 * @param typeName - The type name to parse
 * @param payload - Binary data to reflect
 */
export async function reflectWithManifest(
  manifest: Manifest,
  rootPackage: string,
  typeName: string,
  payload: ReflectRootPayload,
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflectWithManifest(manifest, rootPackage, typeName, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflectWithManifest(manifest, rootPackage, typeName, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

/**
 * Reflect an instruction using a pre-resolved manifest.
 */
export async function reflectInstructionWithManifest(
  manifest: Manifest,
  rootPackage: string,
  payload: ReflectRootPayload,
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflectInstructionWithManifest(manifest, rootPackage, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflectInstructionWithManifest(manifest, rootPackage, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

/**
 * Reflect an account using a pre-resolved manifest.
 */
export async function reflectAccountWithManifest(
  manifest: Manifest,
  rootPackage: string,
  payload: ReflectRootPayload,
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflectAccountWithManifest(manifest, rootPackage, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflectAccountWithManifest(manifest, rootPackage, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

/**
 * Reflect an event using a pre-resolved manifest.
 */
export async function reflectEventWithManifest(
  manifest: Manifest,
  rootPackage: string,
  payload: ReflectRootPayload,
): Promise<JsonValue> {
  if (payload.type === 'binary') {
    return callReflectEventWithManifest(manifest, rootPackage, toUint8Array(payload.value));
  }
  if (payload.type === 'hex') {
    return callReflectEventWithManifest(manifest, rootPackage, hexToBytes(payload.value));
  }
  throw new Error(`Invalid payload type`);
}

/**
 * Build layout IR using a pre-resolved manifest.
 */
export async function buildLayoutIrWithManifest(
  manifest: Manifest,
  rootPackage: string,
): Promise<JsonValue> {
  const bindings = await loadBindings();
  const manifestJson = JSON.stringify(manifest);
  const result = bindings.build_layout_ir_with_manifest(manifestJson, rootPackage);
  return JSON.parse(result);
}

/**
 * Get the list of package names in a manifest.
 */
export async function getManifestPackages(manifest: Manifest): Promise<string[]> {
  const bindings = await loadBindings();
  const manifestJson = JSON.stringify(manifest);
  const result = bindings.get_manifest_packages(manifestJson);
  return JSON.parse(result);
}

export interface ManifestPackageInfo {
  name: string;
  package: string;
  version: number;
  type_count: number;
  has_root_types: boolean;
}

/**
 * Validate a manifest and return information about its contents.
 */
export async function validateManifest(manifest: Manifest): Promise<ManifestPackageInfo[]> {
  const bindings = await loadBindings();
  const manifestJson = JSON.stringify(manifest);
  const result = bindings.validate_manifest(manifestJson);
  return JSON.parse(result);
}
