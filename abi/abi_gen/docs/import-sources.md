# ABI Import Sources

This document describes the enhanced import system for ABI files, which supports multiple import source types beyond local paths.

## Import Source Types

### 1. Path (Local Imports)

Local imports reference files on the filesystem relative to the importing file or include directories.

```yaml
abi:
  package: my.package
  imports:
    - type: path
      path: "./local/primitives.abi.yaml"
```

### 2. Git

Git imports fetch ABI files from Git repositories. Supports both HTTPS and SSH URLs.

```yaml
abi:
  package: my.package
  imports:
    - type: git
      url: "https://github.com/org/repo"
      ref: "v1.0.0"  # branch, tag, or commit hash
      path: "abi/types.abi.yaml"
```

### 3. HTTP

HTTP imports fetch ABI files from URLs.

```yaml
abi:
  package: my.package
  imports:
    - type: http
      url: "https://example.com/types.abi.yaml"
```

### 4. On-chain

On-chain imports fetch ABI from blockchain accounts.

```yaml
abi:
  package: my.package
  imports:
    - type: onchain
      address: "takGtYKFLFlA3-JmS8d3F-ti4F6cW1tcjVnNR1bVw913Gu"  # Thru address or TNS name (*.thru)
      target: program       # "program", "abi-meta", or "abi"
      network: "mainnet"    # network identifier
      revision: 5           # exact revision, ">=5" (minimum), or "latest"
```

#### On-chain Import Details

- **address**: Either a Thru address (46-character `ta`-prefixed encoding) or a TNS name ending in `.thru`
- **target**:
  - `program` - Treats the address as a program account and derives the official ABI account
  - `abi-meta` - Treats the address as an ABI meta account and derives the ABI account
  - `abi` - Uses the address directly as the ABI account
- **network**: Network identifier used to select the RPC endpoint
- **revision**: Version pinning
  - Exact: `5` - Must match revision exactly
  - Minimum: `">=5"` - Revision must be at least 5
  - Latest: `"latest"` or omitted - Accept any revision

## Import Rules

### Local Import Restriction

If a file is fetched from a remote source (git, http, onchain), ALL its imports must also be remote. This prevents remote dependencies from referencing local filesystem paths.

### Version Conflict Detection

The resolver enforces strict version conflict detection. If the same package name is imported with different versions, the resolution fails.

### Cycle Detection

The resolver tracks package identity (`package_name@version`) and detects cyclic dependencies.

## CLI Commands

### `abi flatten`

Resolves all imports and produces a single flattened ABI file with all types inlined.

```bash
abi flatten -f input.abi.yaml -o output.abi.yaml [-i include/]
```

### `abi prep-for-publish`

Prepares an ABI for on-chain publishing by:
1. Inlining types from local (path) imports
2. Removing local import declarations
3. Validating remaining imports use the same network

```bash
abi prep-for-publish -f input.abi.yaml -n mainnet -o output.abi.yaml [-i include/]
```

### `abi bundle`

Creates a dependency manifest for WASM/browser consumption. The manifest maps package names to their resolved ABI YAML content.

```bash
abi bundle -f input.abi.yaml -o manifest.json [-i include/]
```

Output format:
```json
{
  "my.package": "abi:\n  package: my.package\n  ...",
  "dependency.package": "abi:\n  package: dependency.package\n  ..."
}
```

## WASM/Browser Support

The WASM module provides manifest-based reflection functions for handling ABIs with imports:

- `reflect_with_manifest(manifest, rootPackage, typeName, buffer)`
- `reflect_instruction_with_manifest(manifest, rootPackage, buffer)`
- `reflect_account_with_manifest(manifest, rootPackage, buffer)`
- `reflect_event_with_manifest(manifest, rootPackage, buffer)`
- `build_layout_ir_with_manifest(manifest, rootPackage)`
- `validate_manifest(manifest)`

### TypeScript Usage

```typescript
import { resolveImports, createManifest, reflectWithManifest } from "@thru/abi";

// For ABIs without imports, create a simple manifest
const manifest = { [packageName]: abiYaml };

// For ABIs with on-chain imports, resolve dependencies
const result = await resolveImports(abiYaml, {
  rpcEndpoints: { mainnet: "https://rpc.thru.network" }
});
const manifest = createManifest(result);

// Reflect using the manifest
const reflected = await reflectWithManifest(
  manifest,
  result.root.id.packageName,
  "TypeName",
  { type: "binary", value: data }
);
```

## Architecture

### Fetcher Infrastructure

```
CompositeFetcher
├── PathFetcher      (local files)
├── GitFetcher       (git2 + credential helpers)
├── HttpFetcher      (reqwest)
└── OnchainFetcher   (RPC client)
```

### Configuration

Fetcher behavior is configured via `FetcherConfig`:

```rust
let config = FetcherConfig {
    enable_path: true,
    enable_git: true,
    enable_http: true,
    enable_onchain: true,
    rpc_endpoints: HashMap::from([
        ("mainnet".to_string(), "https://rpc.thru.network".to_string()),
    ]),
    cache_dir: Some(dirs::cache_dir().unwrap().join("thru/abi-cache")),
};
```

### Resolution Algorithm

1. Fetch source content
2. Check for cycles (canonical location in visited set)
3. Parse ABI YAML and extract package identity
4. Check for version conflicts (same name, different version)
5. For each import:
   - If parent is remote AND import is local → error
   - Recursively resolve the import
6. Collect all types from resolved packages
7. Return the package tree

## On-chain ABI Account Format

ABI accounts use the following binary format:

| Field | Size | Description |
|-------|------|-------------|
| abi_meta_account | 32 bytes | ABI meta account pubkey |
| revision | 8 bytes | Update counter (little-endian u64) |
| state | 1 byte | 0x00=OPEN, 0x01=FINALIZED |
| content_sz | 4 bytes | YAML content size (little-endian u32) |
| content | variable | ABI YAML content |

Total header size: 45 bytes

### Address Derivation

For `target: program` or `abi-meta`, the ABI account address is derived from
the ABI meta contents using `SHA256(kind || abi_meta_body || "_abi_account")`
and then the program-defined address scheme (owner + ephemeral flag + seed).
