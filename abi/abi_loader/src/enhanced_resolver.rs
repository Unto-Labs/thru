//! Enhanced Import Resolver
//!
//! This module provides the full import resolution system that supports all import
//! types (path, git, http, onchain) with cycle detection, version conflict detection,
//! and the local import restriction rule.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use crate::fetcher::{CompositeFetcher, FetchContext, FetchError, FetcherConfig};
use crate::file::{AbiFile, ImportSource};
use crate::package::{PackageId, ResolutionResult, ResolveError, ResolvedPackage};

/* ============================================================================
   Enhanced Import Resolver
   ============================================================================ */

/* Full-featured import resolver supporting all import types */
pub struct EnhancedImportResolver {
    /* Composite fetcher for handling all import types */
    fetcher: CompositeFetcher,

    /* Include directories for path resolution */
    include_dirs: Vec<PathBuf>,

    /* Enable verbose logging */
    verbose: bool,
}

impl EnhancedImportResolver {
    /* Create a new enhanced import resolver with the given configuration */
    pub fn new(config: FetcherConfig, include_dirs: Vec<PathBuf>) -> Result<Self, ResolveError> {
        let fetcher = CompositeFetcher::new(config)
            .map_err(|e| ResolveError::InitError { message: e.to_string() })?;
        Ok(Self {
            fetcher,
            include_dirs,
            verbose: false,
        })
    }

    /* Create with default configuration (all import types enabled) */
    pub fn with_defaults(include_dirs: Vec<PathBuf>) -> Result<Self, ResolveError> {
        Self::new(FetcherConfig::cli_default(), include_dirs)
    }

    /* Enable verbose logging */
    pub fn with_verbose(mut self, verbose: bool) -> Self {
        self.verbose = verbose;
        self
    }

    /* Get the fetcher configuration */
    pub fn config(&self) -> &FetcherConfig {
        self.fetcher.config()
    }

    /* Resolve a root ABI file and all its transitive imports */
    pub fn resolve_file(&self, file_path: &PathBuf) -> Result<ResolutionResult, ResolveError> {
        /* Create root import source */
        let root_source = ImportSource::Path {
            path: file_path.to_string_lossy().to_string(),
        };

        /* Create root context */
        let root_ctx = FetchContext::for_root(Some(file_path.clone()), self.include_dirs.clone());

        /* Initialize resolution state */
        let mut state = ResolutionState::new();

        /* Resolve recursively */
        let root_id = self.resolve_import(&root_source, &root_ctx, &mut state)?;

        /* Build result */
        let root_package = state
            .resolved_packages
            .get(&root_id)
            .cloned()
            .ok_or_else(|| ResolveError::FetchError {
                source: root_source,
                message: "Root package not found in resolution state".to_string(),
            })?;

        Ok(ResolutionResult {
            root: root_package,
            all_packages: state.resolved_packages.into_values().collect(),
        })
    }

    /* Resolve an ABI from raw YAML content (for WASM/embedded use) */
    pub fn resolve_content(
        &self,
        content: &str,
        canonical_location: &str,
    ) -> Result<ResolutionResult, ResolveError> {
        /* Parse the ABI file */
        let abi_file: AbiFile = serde_yml::from_str(content).map_err(|e| ResolveError::ParseError {
            location: canonical_location.to_string(),
            message: e.to_string(),
        })?;

        /* Create a synthetic import source */
        let root_source = ImportSource::Path {
            path: canonical_location.to_string(),
        };

        /* Initialize resolution state */
        let mut state = ResolutionState::new();

        /* Create root context - not remote since content is provided directly */
        let root_ctx = FetchContext::for_root(None, self.include_dirs.clone());

        /* Process this package directly */
        let pkg_id = PackageId::from_abi_file(&abi_file);

        /* Check for version conflict */
        self.check_version_conflict(&pkg_id, &state)?;

        /* Mark as being resolved (for cycle detection) */
        state.in_progress.insert(canonical_location.to_string());
        state.resolution_chain.push(pkg_id.clone());

        /* Resolve all imports */
        let mut dependencies = Vec::new();
        for import in abi_file.imports() {
            let child_ctx = root_ctx.child_context(import, None);
            let dep_id = self.resolve_import(import, &child_ctx, &mut state)?;
            dependencies.push(dep_id);
        }

        /* Create resolved package */
        let resolved = ResolvedPackage::new(root_source.clone(), abi_file, dependencies);

        /* Mark as fully resolved */
        state.in_progress.remove(canonical_location);
        state.resolution_chain.pop();
        state.resolved_packages.insert(pkg_id.clone(), resolved.clone());
        state.versions.insert(pkg_id.package_name.clone(), pkg_id.version.clone());

        Ok(ResolutionResult {
            root: resolved,
            all_packages: state.resolved_packages.into_values().collect(),
        })
    }

    /* Internal: Resolve a single import and its transitive dependencies */
    fn resolve_import(
        &self,
        source: &ImportSource,
        ctx: &FetchContext,
        state: &mut ResolutionState,
    ) -> Result<PackageId, ResolveError> {
        /* Fetch the content */
        let fetch_result = self.fetcher.fetch(source, ctx).map_err(|e| match e {
            FetchError::NotAllowed(s) => ResolveError::ImportTypeNotAllowed {
                source: s,
                reason: "Import type not allowed by configuration".to_string(),
            },
            FetchError::LocalFromRemote(path) => ResolveError::LocalImportFromRemote {
                remote_package: state
                    .resolution_chain
                    .last()
                    .cloned()
                    .unwrap_or_else(|| PackageId::new("<root>", "0.0.0")),
                local_import: ImportSource::Path { path },
            },
            FetchError::RevisionMismatch { required, actual } => ResolveError::RevisionMismatch {
                source: source.clone(),
                required,
                actual,
            },
            _ => ResolveError::FetchError {
                source: source.clone(),
                message: e.to_string(),
            },
        })?;

        if self.verbose {
            println!("[~] Fetched: {}", fetch_result.canonical_location);
        }

        /* Check for cycle using canonical location */
        if state.in_progress.contains(&fetch_result.canonical_location) {
            return Err(ResolveError::CyclicDependency {
                package_id: state
                    .resolution_chain
                    .last()
                    .cloned()
                    .unwrap_or_else(|| PackageId::new("<unknown>", "0.0.0")),
                cycle_chain: state.resolution_chain.clone(),
            });
        }

        /* Check if already fully resolved (by canonical location) */
        if let Some(pkg_id) = state.location_to_package.get(&fetch_result.canonical_location) {
            if self.verbose {
                println!("    [~] Already resolved: {}", pkg_id);
            }
            return Ok(pkg_id.clone());
        }

        /* Parse the ABI file */
        let abi_file: AbiFile =
            serde_yml::from_str(&fetch_result.content).map_err(|e| ResolveError::ParseError {
                location: fetch_result.canonical_location.clone(),
                message: e.to_string(),
            })?;

        let pkg_id = PackageId::from_abi_file(&abi_file);

        if self.verbose {
            println!("    Package: {}", pkg_id);
        }

        /* Check for version conflict */
        self.check_version_conflict(&pkg_id, state)?;

        /* Mark as being resolved */
        state.in_progress.insert(fetch_result.canonical_location.clone());
        state.resolution_chain.push(pkg_id.clone());

        /* Create context for resolving this file's imports:
           - base_path: current file's resolved path (for relative path resolution)
           - parent_is_remote: whether this file came from a remote source
           - include_dirs: inherited from root context */
        let import_ctx = FetchContext {
            base_path: fetch_result.resolved_path.clone(),
            parent_is_remote: fetch_result.is_remote,
            include_dirs: ctx.include_dirs.clone(),
        };

        /* Resolve all imports recursively */
        let mut dependencies = Vec::new();
        for import in abi_file.imports() {
            if self.verbose {
                println!("    [~] Resolving import: {:?}", import);
            }

            let dep_id = self.resolve_import(import, &import_ctx, state)?;
            dependencies.push(dep_id);
        }

        /* Create resolved package */
        let resolved = ResolvedPackage {
            id: pkg_id.clone(),
            source: source.clone(),
            abi_file,
            dependencies,
            is_remote: fetch_result.is_remote,
        };

        /* Mark as fully resolved */
        state.in_progress.remove(&fetch_result.canonical_location);
        state.resolution_chain.pop();
        state.resolved_packages.insert(pkg_id.clone(), resolved);
        state.location_to_package.insert(fetch_result.canonical_location, pkg_id.clone());
        state.versions.insert(pkg_id.package_name.clone(), pkg_id.version.clone());

        Ok(pkg_id)
    }

    /* Check for version conflicts */
    fn check_version_conflict(
        &self,
        pkg_id: &PackageId,
        state: &ResolutionState,
    ) -> Result<(), ResolveError> {
        if let Some(existing_version) = state.versions.get(&pkg_id.package_name) {
            if existing_version != &pkg_id.version {
                return Err(ResolveError::VersionConflict {
                    package_name: pkg_id.package_name.clone(),
                    version_a: existing_version.clone(),
                    version_b: pkg_id.version.clone(),
                });
            }
        }
        Ok(())
    }
}

/* ============================================================================
   Resolution State (internal)
   ============================================================================ */

/* Internal state tracked during resolution */
struct ResolutionState {
    /* Packages currently being resolved (for cycle detection) */
    in_progress: HashSet<String>,

    /* Chain of packages being resolved (for error reporting) */
    resolution_chain: Vec<PackageId>,

    /* Fully resolved packages by PackageId */
    resolved_packages: HashMap<PackageId, ResolvedPackage>,

    /* Map from canonical location to PackageId */
    location_to_package: HashMap<String, PackageId>,

    /* Map from package name to resolved version (for conflict detection) */
    versions: HashMap<String, String>,
}

impl ResolutionState {
    fn new() -> Self {
        Self {
            in_progress: HashSet::new(),
            resolution_chain: Vec::new(),
            resolved_packages: HashMap::new(),
            location_to_package: HashMap::new(),
            versions: HashMap::new(),
        }
    }
}

/* ============================================================================
   Tests
   ============================================================================ */

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_abi(dir: &std::path::Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn test_resolve_single_file() {
        let temp_dir = TempDir::new().unwrap();
        let abi_content = r#"
abi:
  package: "test.single"
  abi-version: 1
  package-version: "1.0.0"
  description: "Single file test"
types: []
"#;
        let abi_path = create_test_abi(temp_dir.path(), "single.abi.yaml", abi_content);

        let resolver = EnhancedImportResolver::with_defaults(vec![]).unwrap();
        let result = resolver.resolve_file(&abi_path).unwrap();

        assert_eq!(result.root.package_name(), "test.single");
        assert_eq!(result.package_count(), 1);
    }

    #[test]
    fn test_resolve_with_imports() {
        let temp_dir = TempDir::new().unwrap();

        /* Create child ABI */
        let child_content = r#"
abi:
  package: "test.child"
  abi-version: 1
  package-version: "1.0.0"
  description: "Child package"
types:
  - name: "ChildType"
    kind:
      struct:
        fields:
          - name: "value"
            field-type:
              primitive: u32
"#;
        create_test_abi(temp_dir.path(), "child.abi.yaml", child_content);

        /* Create parent ABI that imports child */
        let parent_content = r#"
abi:
  package: "test.parent"
  abi-version: 1
  package-version: "1.0.0"
  description: "Parent package"
  imports:
    - type: path
      path: "child.abi.yaml"
types:
  - name: "ParentType"
    kind:
      struct:
        fields:
          - name: "child"
            field-type:
              type-ref:
                name: ChildType
"#;
        let parent_path = create_test_abi(temp_dir.path(), "parent.abi.yaml", parent_content);

        let resolver = EnhancedImportResolver::with_defaults(vec![]).unwrap();
        let result = resolver.resolve_file(&parent_path).unwrap();

        assert_eq!(result.root.package_name(), "test.parent");
        assert_eq!(result.package_count(), 2);

        /* Verify child was resolved */
        let child_id = PackageId::new("test.child", "1.0.0");
        assert!(result.get_package(&child_id).is_some());
    }

    #[test]
    fn test_cycle_detection() {
        let temp_dir = TempDir::new().unwrap();

        /* Create ABI A that imports B */
        let a_content = r#"
abi:
  package: "test.a"
  abi-version: 1
  package-version: "1.0.0"
  description: "Package A"
  imports:
    - type: path
      path: "b.abi.yaml"
types: []
"#;
        create_test_abi(temp_dir.path(), "a.abi.yaml", a_content);

        /* Create ABI B that imports A (cycle) */
        let b_content = r#"
abi:
  package: "test.b"
  abi-version: 1
  package-version: "1.0.0"
  description: "Package B"
  imports:
    - type: path
      path: "a.abi.yaml"
types: []
"#;
        create_test_abi(temp_dir.path(), "b.abi.yaml", b_content);

        let a_path = temp_dir.path().join("a.abi.yaml");
        let resolver = EnhancedImportResolver::with_defaults(vec![]).unwrap();
        let result = resolver.resolve_file(&a_path);

        assert!(matches!(result, Err(ResolveError::CyclicDependency { .. })));
    }

    #[test]
    fn test_version_conflict_detection() {
        let temp_dir = TempDir::new().unwrap();

        /* Create two versions of the same package */
        let common_v1 = r#"
abi:
  package: "test.common"
  abi-version: 1
  package-version: "1.0.0"
  description: "Common v1"
types: []
"#;
        create_test_abi(temp_dir.path(), "common_v1.abi.yaml", common_v1);

        let common_v2 = r#"
abi:
  package: "test.common"
  abi-version: 1
  package-version: "2.0.0"
  description: "Common v2"
types: []
"#;
        create_test_abi(temp_dir.path(), "common_v2.abi.yaml", common_v2);

        /* Create package A importing common v1 */
        let a_content = r#"
abi:
  package: "test.a"
  abi-version: 1
  package-version: "1.0.0"
  description: "Package A"
  imports:
    - type: path
      path: "common_v1.abi.yaml"
types: []
"#;
        create_test_abi(temp_dir.path(), "a.abi.yaml", a_content);

        /* Create package B importing common v2 */
        let b_content = r#"
abi:
  package: "test.b"
  abi-version: 1
  package-version: "1.0.0"
  description: "Package B"
  imports:
    - type: path
      path: "common_v2.abi.yaml"
types: []
"#;
        create_test_abi(temp_dir.path(), "b.abi.yaml", b_content);

        /* Create root importing both A and B */
        let root_content = r#"
abi:
  package: "test.root"
  abi-version: 1
  package-version: "1.0.0"
  description: "Root package"
  imports:
    - type: path
      path: "a.abi.yaml"
    - type: path
      path: "b.abi.yaml"
types: []
"#;
        let root_path = create_test_abi(temp_dir.path(), "root.abi.yaml", root_content);

        let resolver = EnhancedImportResolver::with_defaults(vec![]).unwrap();
        let result = resolver.resolve_file(&root_path);

        assert!(matches!(
            result,
            Err(ResolveError::VersionConflict {
                package_name,
                ..
            }) if package_name == "test.common"
        ));
    }

    #[test]
    fn test_duplicate_import_deduplication() {
        let temp_dir = TempDir::new().unwrap();

        /* Create common package */
        let common_content = r#"
abi:
  package: "test.common"
  abi-version: 1
  package-version: "1.0.0"
  description: "Common package"
types: []
"#;
        create_test_abi(temp_dir.path(), "common.abi.yaml", common_content);

        /* Create A importing common */
        let a_content = r#"
abi:
  package: "test.a"
  abi-version: 1
  package-version: "1.0.0"
  description: "Package A"
  imports:
    - type: path
      path: "common.abi.yaml"
types: []
"#;
        create_test_abi(temp_dir.path(), "a.abi.yaml", a_content);

        /* Create B importing common */
        let b_content = r#"
abi:
  package: "test.b"
  abi-version: 1
  package-version: "1.0.0"
  description: "Package B"
  imports:
    - type: path
      path: "common.abi.yaml"
types: []
"#;
        create_test_abi(temp_dir.path(), "b.abi.yaml", b_content);

        /* Create root importing both A and B (common imported twice, same version) */
        let root_content = r#"
abi:
  package: "test.root"
  abi-version: 1
  package-version: "1.0.0"
  description: "Root package"
  imports:
    - type: path
      path: "a.abi.yaml"
    - type: path
      path: "b.abi.yaml"
types: []
"#;
        let root_path = create_test_abi(temp_dir.path(), "root.abi.yaml", root_content);

        let resolver = EnhancedImportResolver::with_defaults(vec![]).unwrap();
        let result = resolver.resolve_file(&root_path).unwrap();

        /* Should have 4 packages: root, a, b, common (common only once) */
        assert_eq!(result.package_count(), 4);

        /* Verify common appears only once */
        let common_count = result
            .all_packages
            .iter()
            .filter(|p| p.package_name() == "test.common")
            .count();
        assert_eq!(common_count, 1);
    }

    #[test]
    fn test_to_manifest() {
        let temp_dir = TempDir::new().unwrap();
        let abi_content = r#"
abi:
  package: "test.manifest"
  abi-version: 1
  package-version: "1.0.0"
  description: "Manifest test"
types:
  - name: "TestType"
    kind:
      struct:
        fields:
          - name: "value"
            field-type:
              primitive: u32
"#;
        let abi_path = create_test_abi(temp_dir.path(), "manifest.abi.yaml", abi_content);

        let resolver = EnhancedImportResolver::with_defaults(vec![]).unwrap();
        let result = resolver.resolve_file(&abi_path).unwrap();

        let manifest = result.to_manifest();
        assert_eq!(manifest.len(), 1);
        assert!(manifest.contains_key("test.manifest"));
        assert!(manifest.get("test.manifest").unwrap().contains("TestType"));
    }

    #[test]
    fn test_local_only_config() {
        let temp_dir = TempDir::new().unwrap();
        let abi_content = r#"
abi:
  package: "test.local"
  abi-version: 1
  package-version: "1.0.0"
  description: "Local only test"
types: []
"#;
        let abi_path = create_test_abi(temp_dir.path(), "local.abi.yaml", abi_content);

        /* Use local_only config */
        let resolver = EnhancedImportResolver::new(FetcherConfig::local_only(), vec![]).unwrap();
        let result = resolver.resolve_file(&abi_path).unwrap();

        assert_eq!(result.root.package_name(), "test.local");
    }
}
