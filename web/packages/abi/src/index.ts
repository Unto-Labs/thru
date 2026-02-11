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
export type { FormatOptions, Manifest, ManifestPackageInfo } from "./wasmBridge";
export type { FormattedReflection, FormattedValue, FormattedValueWithByteRange, ByteRange } from "./types";

/* Import resolver module */
export * from "./imports";
