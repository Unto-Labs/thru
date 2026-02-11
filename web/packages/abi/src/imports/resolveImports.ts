/**
 * Import Resolver
 *
 * Resolves ABI imports and builds a manifest for WASM consumption.
 */

import * as yaml from "yaml";
import type {
  ImportSource,
  ImportSourceYaml,
  PackageId,
  ResolvedPackage,
  ResolutionResult,
  AbiMetadata,
  AbiFile,
  RpcEndpoints,
  RevisionSpec,
} from "./types";
import { ResolutionError, DEFAULT_RPC_ENDPOINTS } from "./types";
import { OnchainFetcher, type OnchainFetcherConfig } from "./onchainFetcher";

export interface ResolverConfig {
  onchainFetcher?: OnchainFetcher;
  rpcEndpoints?: RpcEndpoints;
  maxDepth?: number;
}

/**
 * Resolve all imports for an ABI and return a manifest.
 *
 * The resolver only supports on-chain imports for browser environments.
 * For path imports, use the CLI `bundle` command.
 */
export async function resolveImports(
  rootAbiYaml: string,
  config: ResolverConfig = {}
): Promise<ResolutionResult> {
  const resolver = new ImportResolver(config);
  return resolver.resolve(rootAbiYaml);
}

/**
 * Create a manifest from an ABI and its resolved imports.
 *
 * The manifest maps package names to ABI YAML content.
 */
export function createManifest(result: ResolutionResult): Record<string, string> {
  return result.manifest;
}

class ImportResolver {
  private onchainFetcher: OnchainFetcher;
  private maxDepth: number;
  private visited: Map<string, ResolvedPackage>;
  private inProgress: Set<string>;

  constructor(config: ResolverConfig = {}) {
    this.onchainFetcher =
      config.onchainFetcher ??
      new OnchainFetcher({
        rpcEndpoints: { ...DEFAULT_RPC_ENDPOINTS, ...config.rpcEndpoints },
      });
    this.maxDepth = config.maxDepth ?? 10;
    this.visited = new Map();
    this.inProgress = new Set();
  }

  async resolve(rootAbiYaml: string): Promise<ResolutionResult> {
    this.visited.clear();
    this.inProgress.clear();

    const rootPackage = await this.resolvePackage(rootAbiYaml, false, 0);
    const allPackages = Array.from(this.visited.values());
    const manifest: Record<string, string> = {};

    for (const pkg of allPackages) {
      manifest[pkg.id.packageName] = pkg.abiYaml;
    }

    return {
      root: rootPackage,
      allPackages,
      manifest,
    };
  }

  private async resolvePackage(
    abiYaml: string,
    isRemote: boolean,
    depth: number
  ): Promise<ResolvedPackage> {
    if (depth > this.maxDepth) {
      throw new ResolutionError(
        "CYCLIC_DEPENDENCY",
        `Maximum resolution depth (${this.maxDepth}) exceeded`
      );
    }

    const abiFile = this.parseAbiYaml(abiYaml);
    const packageId = this.extractPackageId(abiFile);
    const canonicalKey = `${packageId.packageName}@${packageId.version}`;

    /* Check for cycle */
    if (this.inProgress.has(canonicalKey)) {
      throw new ResolutionError(
        "CYCLIC_DEPENDENCY",
        `Cyclic dependency detected: ${canonicalKey}`
      );
    }

    /* Check if already resolved (keyed by name@version to match inProgress) */
    const existing = this.visited.get(canonicalKey);
    if (existing) {
      return existing;
    }

    /* Check for version conflict: same package name, different version */
    for (const [key, pkg] of this.visited) {
      if (pkg.id.packageName === packageId.packageName && pkg.id.version !== packageId.version) {
        throw new ResolutionError(
          "VERSION_CONFLICT",
          `Version conflict for ${packageId.packageName}: ` +
            `${pkg.id.version} vs ${packageId.version}`,
          { existing: pkg.id, conflicting: packageId }
        );
      }
    }

    this.inProgress.add(canonicalKey);

    const imports = abiFile.abi.imports ?? [];
    const dependencies: PackageId[] = [];

    for (const importYaml of imports) {
      const importSource = this.normalizeImportSource(importYaml);

      /* Enforce local import restriction */
      if (isRemote && importSource.type === "path") {
        throw new ResolutionError(
          "UNSUPPORTED_IMPORT_TYPE",
          `Remote package ${packageId.packageName} cannot import local path: ${importSource.path}`
        );
      }

      /* Determine child remoteness from the import source type, not the parent.
         Non-path imports (onchain, git, http) are always remote. */
      const childIsRemote = importSource.type !== "path";
      const depPackage = await this.resolveImport(importSource, childIsRemote, depth + 1);
      dependencies.push(depPackage.id);
    }

    this.inProgress.delete(canonicalKey);

    const resolvedPackage: ResolvedPackage = {
      id: packageId,
      source: { type: "path", path: "<root>" },
      abiYaml,
      dependencies,
      isRemote,
    };

    this.visited.set(canonicalKey, resolvedPackage);
    return resolvedPackage;
  }

  private async resolveImport(
    source: ImportSource,
    parentIsRemote: boolean,
    depth: number
  ): Promise<ResolvedPackage> {
    switch (source.type) {
      case "path":
        throw new ResolutionError(
          "UNSUPPORTED_IMPORT_TYPE",
          `Path imports are not supported in browser. Use CLI 'bundle' command. Path: ${source.path}`
        );

      case "git":
        throw new ResolutionError(
          "UNSUPPORTED_IMPORT_TYPE",
          `Git imports are not supported in browser. Use CLI 'bundle' command. URL: ${source.url}`
        );

      case "http":
        throw new ResolutionError(
          "UNSUPPORTED_IMPORT_TYPE",
          `HTTP imports are not supported in browser. Use CLI 'bundle' command. URL: ${source.url}`
        );

      case "onchain":
        return this.resolveOnchainImport(source, depth);

      default:
        throw new ResolutionError(
          "UNSUPPORTED_IMPORT_TYPE",
          `Unknown import type: ${(source as ImportSource).type}`
        );
    }
  }

  private async resolveOnchainImport(
    source: Extract<ImportSource, { type: "onchain" }>,
    depth: number
  ): Promise<ResolvedPackage> {
    const result = await this.onchainFetcher.fetch(
      source.address,
      source.target,
      source.network,
      source.revision
    );

    const resolved = await this.resolvePackage(result.abiYaml, true, depth);
    resolved.source = source;
    resolved.isRemote = true;

    return resolved;
  }

  private parseAbiYaml(yamlContent: string): AbiFile {
    try {
      const parsed = yaml.parse(yamlContent);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid ABI YAML: not an object");
      }
      if (!parsed.abi || typeof parsed.abi !== "object") {
        throw new Error("Invalid ABI YAML: missing 'abi' section");
      }
      return parsed as AbiFile;
    } catch (error) {
      throw new ResolutionError(
        "PARSE_ERROR",
        `Failed to parse ABI YAML: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  private extractPackageId(abiFile: AbiFile): PackageId {
    const metadata = abiFile.abi;
    if (!metadata.package) {
      throw new ResolutionError("PARSE_ERROR", "ABI missing 'package' field");
    }
    return {
      packageName: metadata.package,
      version: metadata["package-version"] ?? "0.0.0",
    };
  }

  private normalizeImportSource(source: ImportSourceYaml): ImportSource {
    switch (source.type) {
      case "path":
        return { type: "path", path: source.path };

      case "git":
        return {
          type: "git",
          url: source.url,
          ref: source.ref,
          path: source.path,
        };

      case "http":
        return { type: "http", url: source.url };

      case "onchain": {
        const revision = this.parseRevisionSpec(source.revision);
        return {
          type: "onchain",
          address: source.address,
          target: source.target ?? "program",
          network: source.network,
          revision,
        };
      }

      default:
        throw new ResolutionError(
          "UNSUPPORTED_IMPORT_TYPE",
          `Unknown import type: ${(source as ImportSourceYaml).type}`
        );
    }
  }

  private parseRevisionSpec(revision: number | string | undefined): RevisionSpec {
    if (revision === undefined || revision === "latest") {
      return { type: "latest" };
    }
    if (typeof revision === "number") {
      return { type: "exact", value: revision };
    }
    if (typeof revision === "string") {
      if (revision.startsWith(">=")) {
        const value = parseInt(revision.slice(2), 10);
        if (isNaN(value)) {
          throw new Error(`Invalid minimum revision: ${revision}`);
        }
        return { type: "minimum", value };
      }
      const value = parseInt(revision, 10);
      if (!isNaN(value)) {
        return { type: "exact", value };
      }
    }
    throw new Error(`Invalid revision specification: ${revision}`);
  }
}
