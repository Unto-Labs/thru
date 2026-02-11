# PRD: Enhanced ABI Import Resolver

## Overview

Extend the ABI import system to support multiple import source types beyond local paths, enabling modular ABI composition across local, git, HTTP, and on-chain sources.

## Import Types

### 1. Path (existing)
```yaml
imports:
  - type: path
    path: "./local/file.abi.yaml"
```

### 2. Git
```yaml
imports:
  - type: git
    url: "https://github.com/org/repo"  # or ssh://
    ref: "v1.0.0"  # branch, tag, or commit
    path: "path/to/file.abi.yaml"
```

### 3. HTTP
```yaml
imports:
  - type: http
    url: "https://example.com/types.abi.yaml"
```

### 4. On-chain
```yaml
imports:
  - type: onchain
    address: "Abc123..."  # or TNS name like "mypackage.thru"
    target: program       # "program", "abi-meta", or "abi"
    network: "mainnet"    # or chain_id
    revision: 5           # exact, ">=5" (minimum), or "latest"
```

## Key Rules

| Rule | Description |
|------|-------------|
| **Local Restriction** | If a file is fetched from remote, ALL its imports must also be remote |
| **Version Conflicts** | Strict error on any package version conflict |
| **Multiple Locations** | Priority/fallback chain (try in order until success) |
| **Cycle Detection** | Package name + version as identity |
| **TNS Detection** | Address ending in `.thru` triggers TNS resolution |

## Architecture

### Import Fetcher

```
CompositeFetcher
├── PathFetcher      (local files)
├── GitFetcher       (git2 + full git config)
├── HttpFetcher      (reqwest)
└── OnchainFetcher   (gRPC client)
```

**Configuration** (fetcher-level, not in ABI):
- Enable/disable import types per environment
- Git: SSH keys, credential helpers, proxies
- On-chain: RPC endpoints per network
- Caching: In-memory runtime, optional global `~/.thru/abi-cache/`

### WASM Resolver

- **Approach**: Pre-bundled manifest
- **Input**: `Map<package_name, ABI_YAML_string>`
- **No runtime fetching** - all dependencies provided upfront
- New functions: `reflect_with_manifest()`, `build_reflector_with_manifest()`

### Explorer Integration

- **Only on-chain imports supported** in browser
- **New TypeScript import resolver library** that mirrors the Rust implementation
- Explorer uses TS resolver to:
  1. Parse ABI and extract on-chain imports
  2. Recursively fetch dependencies via gRPC client
  3. Build dependency manifest
  4. Pass manifest to WASM for reflection
- Must implement same rules: cycle detection, version conflict checking, revision validation

## New CLI Commands

### `prep-for-publish`

Prepares a single ABI file for on-chain publishing:

```bash
abi prep-for-publish -f input.abi.yaml -n mainnet -o output.abi.yaml [-I include/]
```

**Behavior**:
1. Inline all types from local (path) imports
2. Remove local import declarations
3. Validate remaining imports use same network
4. Error if non-onchain remote imports remain

### `bundle`

Resolves all dependencies without inlining types (preserves package structure):

```bash
abi bundle -f input.abi.yaml -o manifest.json [-I include/]
```

**Output**: JSON manifest mapping package names to resolved ABI YAML content

**Use cases**:
- Build systems that need resolved but separate packages
- Offline dependency caching
- Debugging dependency resolution

## Data Structures

### Import Types (Rust)

```rust
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ImportSource {
    Path { path: String },
    Git { url: String, git_ref: String, path: String },
    Http { url: String },
    Onchain { address: String, target: OnchainTarget, network: String, revision: RevisionSpec },
}

pub enum OnchainTarget {
    ProgramMeta, // ABI derived from a program meta account (official ABI)
    AbiMeta,     // ABI derived from an ABI meta account
    Abi,         // ABI account address provided directly
}

pub enum RevisionSpec {
    Exact(u64),      // revision: 5
    Minimum(String), // revision: ">=5"
    Latest,          // revision: "latest" or omitted
}
```

**Note**: No backward compatibility for legacy string imports. All imports must use structured format.

### Package Identity

```rust
pub struct PackageId {
    pub package_name: String,
    pub version: String,
}
```

## Files to Create

| File | Purpose |
|------|---------|
| `abi/abi_loader/src/fetcher/mod.rs` | Fetcher trait + CompositeFetcher |
| `abi/abi_loader/src/fetcher/path.rs` | Local file fetcher |
| `abi/abi_loader/src/fetcher/git.rs` | Git repository fetcher |
| `abi/abi_loader/src/fetcher/http.rs` | HTTP URL fetcher |
| `abi/abi_loader/src/fetcher/onchain.rs` | On-chain ABI fetcher |
| `abi/abi_loader/src/fetcher/cache.rs` | Optional caching layer |
| `abi/abi_loader/src/fetcher_config.rs` | Fetcher configuration types |
| `abi/abi_loader/src/package.rs` | PackageId, ResolvedPackage types |
| `web/packages/abi/src/resolver/index.ts` | TypeScript import resolver library (mirrors Rust) |
| `web/packages/abi/src/resolver/types.ts` | Import types (ImportSource, RevisionSpec, etc.) |
| `web/packages/abi/src/resolver/onchainFetcher.ts` | On-chain ABI fetcher via gRPC |
| `web/packages/abi/src/resolver/resolveImports.ts` | Recursive resolution with cycle/conflict detection |

## Files to Modify

| File | Changes |
|------|---------|
| `abi/abi_loader/src/file.rs` | Add Import, ImportSource, RevisionSpec enums |
| `abi/abi_loader/src/resolver.rs` | Replace with async EnhancedImportResolver |
| `abi/abi_loader/src/flatten.rs` | Use new resolver |
| `abi/abi_loader/src/lib.rs` | Export new modules |
| `abi/abi_loader/Cargo.toml` | Add async-trait, tokio, reqwest, git2, sha2 |
| `abi/abi_reflect_wasm/src/lib.rs` | Add manifest-based reflection functions |
| `abi/abi_cli/src/main.rs` | Add prep-for-publish, bundle commands + fetcher flags |
| `web/packages/abi/src/wasmBridge.ts` | Add reflectWithManifest, buildLayoutIrWithManifest |
| `web/packages/abi/src/index.ts` | Export new functions |
| `web/explorer/src/hooks/useAbi.ts` | Add useAbiWithDependencies hook |

## On-chain ABI Reference

From `rpc/thru-cli/src/commands/abi.rs`:

**Account Derivation**:
```rust
fn derive_abi_seed_bytes(kind: u8, abi_meta_body: &[u8; 96]) -> [u8; 32] {
    sha256([kind] || abi_meta_body || b"_abi_account")
}
```

**Account Header** (45 bytes):
```
abi_meta_acc: [u8; 32]      // ABI meta account pubkey
revision: u64               // Update counter
state: u8                   // 0x00=OPEN, 0x01=FINALIZED
content_sz: u32             // YAML content size
contents: [u8; content_sz]  // YAML content (flexible array)
```

## Resolution Algorithm

```
1. Fetch source content
2. Check cycle (canonical location in visited set) -> error if cycle
3. Parse ABI YAML
4. Create PackageId(name, version)
5. Check version conflict (same name, different version) -> error if conflict
6. For each import:
   a. If parent is remote AND import is local -> error
   b. Recurse with updated context (parent_is_remote flag)
7. Collect types from all resolved packages
8. Return resolved package tree
```

## Testing Strategy

1. **Unit tests**: Import parsing, revision spec parsing, package ID equality
2. **Resolver tests**: Cycle detection, version conflict, local-from-remote restriction
3. **Integration tests**: Full resolution with mock git/http/gRPC servers
4. **WASM tests**: Manifest-based reflection
5. **CLI tests**: prep-for-publish, bundle commands

## Migration / Backward Compatibility

- **No backward compatibility** for legacy string imports - all imports must use structured format
- Existing ABIs with string imports must be migrated to structured format
- Existing WASM `reflect()` continues to work for ABIs without imports
- Existing `flatten` command will be enhanced to handle all import types

## Implementation Order

1. **Phase 1**: Data structures (Import, ImportSource, RevisionSpec, PackageId)
2. **Phase 2**: Fetcher infrastructure (trait, composite, path fetcher)
3. **Phase 3**: Remote fetchers (git, http, onchain)
4. **Phase 4**: EnhancedImportResolver with cycle/conflict detection
5. **Phase 5**: CLI commands (prep-for-publish, bundle, fetcher flags)
6. **Phase 6**: WASM manifest support
7. **Phase 7**: TypeScript dependency resolver + Explorer integration
8. **Phase 8**: ABI spec documentation updates

## Dependencies to Add

```toml
# abi/abi_loader/Cargo.toml
async-trait = "0.1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.11", features = ["json"] }
git2 = "0.18"
sha2 = "0.10"
dirs = "5"
```
