export {
  buildLayoutIr,
  configureWasm,
  ensureWasmLoaded,
  reflect,
  reflectInstruction,
  reflectAccount,
  reflectEvent,
  reflectError,
  errorVariants,
  reflectErrorWithManifest,
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
export type {
  FormatOptions,
  Manifest,
  ManifestPackageInfo,
  ReflectedError,
  WasmConfig,
} from "./wasmBridge";
export type {
  ByteRange,
  DisplayCard,
  DisplayForm,
  DisplayKind,
  DisplayRow,
  FormattedReflection,
  FormattedValue,
  FormattedValueWithByteRange,
} from "./types";
export {
  MAX_NESTED_INSTRUCTION_DECODES,
  MAX_NESTED_INSTRUCTION_DEPTH,
  resolveNestedInstructionData,
} from "./nestedInstructionData";
export type {
  NestedInstructionDecoder,
  NestedInstructionDecodeOptions,
} from "./nestedInstructionData";

/* Import resolver module */
export * from "./imports";
