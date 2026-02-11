/**
 * Import Source Types
 *
 * These types mirror the Rust ImportSource enum and related types.
 */

/* Target type for on-chain ABI imports */
export type OnchainTarget = "program" | "abi-meta" | "abi";

/* Revision specifier for on-chain imports */
export type RevisionSpec =
  | { type: "exact"; value: number }
  | { type: "minimum"; value: number }
  | { type: "latest" };

/* Import source specification */
export type ImportSource =
  | { type: "path"; path: string }
  | { type: "git"; url: string; ref: string; path: string }
  | { type: "http"; url: string }
  | {
      type: "onchain";
      address: string;
      target: OnchainTarget;
      network: string;
      revision: RevisionSpec;
    };

/* Package identifier */
export interface PackageId {
  packageName: string;
  version: string;
}

/* Resolved package information */
export interface ResolvedPackage {
  id: PackageId;
  source: ImportSource;
  abiYaml: string;
  dependencies: PackageId[];
  isRemote: boolean;
}

/* Resolution result */
export interface ResolutionResult {
  root: ResolvedPackage;
  allPackages: ResolvedPackage[];
  manifest: Record<string, string>;
}

/* Resolution error */
export class ResolutionError extends Error {
  constructor(
    public code:
      | "CYCLIC_DEPENDENCY"
      | "VERSION_CONFLICT"
      | "FETCH_ERROR"
      | "PARSE_ERROR"
      | "NOT_FOUND"
      | "UNSUPPORTED_IMPORT_TYPE",
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ResolutionError";
  }
}

/* ABI account header constants (matches Rust) */
export const ABI_ACCOUNT_HEADER_SIZE = 45;
export const ABI_STATE_OPEN = 0x00;
export const ABI_STATE_FINALIZED = 0x01;

/* Parsed ABI account data */
export interface AbiAccountData {
  abiMetaAccount: Uint8Array;
  revision: bigint;
  state: number;
  content: string;
}

/* RPC endpoint configuration */
export interface RpcEndpoints {
  [network: string]: string;
}

/* Default RPC endpoints */
export const DEFAULT_RPC_ENDPOINTS: RpcEndpoints = {
  mainnet: "https://rpc.thru.network",
  testnet: "https://rpc-testnet.thru.network",
};

/* ABI metadata parsed from YAML */
export interface AbiMetadata {
  package: string;
  name?: string;
  "abi-version": number;
  "package-version": string;
  description: string;
  imports?: ImportSourceYaml[];
}

/* Import source as it appears in YAML */
export type ImportSourceYaml =
  | { type: "path"; path: string }
  | { type: "git"; url: string; ref: string; path: string }
  | { type: "http"; url: string }
  | {
      type: "onchain";
      address: string;
      target?: OnchainTarget;
      network: string;
      revision?: number | string;
    };

/* Parsed ABI file */
export interface AbiFile {
  abi: AbiMetadata;
  types: unknown[];
}
