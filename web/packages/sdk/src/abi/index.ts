export {
  buildLayoutIr,
  configureWasm,
  ensureWasmLoaded,
  reflect,
  reflectInstruction,
  reflectAccount,
  reflectEvent,
  formatReflection,
  /* Manifest-based functions for ABIs with imports */
  reflectWithManifest,
  reflectInstructionWithManifest,
  reflectAccountWithManifest,
  reflectEventWithManifest,
  buildLayoutIrWithManifest,
  getManifestPackages,
  validateManifest,
} from "./wasmBridge";
export type { FormatOptions, Manifest, ManifestPackageInfo, WasmConfig } from "./wasmBridge";
export type { FormattedReflection, FormattedValue, FormattedValueWithByteRange, ByteRange } from "./types";
export {
  MAX_NESTED_INSTRUCTION_DEPTH,
  resolveNestedInstructionData,
} from "./nestedInstructionData";
export type {
  NestedInstructionDecoder,
  NestedInstructionDecodeOptions,
} from "./nestedInstructionData";

/* Import resolver module */
export * from "./imports";
