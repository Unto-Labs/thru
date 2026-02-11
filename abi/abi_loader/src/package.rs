//! Package Identity and Resolution Types
//!
//! This module provides types for tracking package identity during import resolution,
//! enabling version conflict detection and cycle detection.

use crate::file::{AbiFile, ImportSource};

/* ============================================================================
   Package Identity
   ============================================================================ */

/* Unique identifier for an ABI package, used for version conflict detection */
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PackageId {
    /* Fully qualified package name (e.g., "thru.common.primitives") */
    pub package_name: String,
    /* Package semantic version */
    pub version: String,
}

impl PackageId {
    /* Create a new package ID */
    pub fn new(package_name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            package_name: package_name.into(),
            version: version.into(),
        }
    }

    /* Create a PackageId from an AbiFile */
    pub fn from_abi_file(abi_file: &AbiFile) -> Self {
        Self {
            package_name: abi_file.package().to_string(),
            version: abi_file.package_version().to_string(),
        }
    }

    /* Check if two packages have the same name but different versions (conflict) */
    pub fn conflicts_with(&self, other: &PackageId) -> bool {
        self.package_name == other.package_name && self.version != other.version
    }
}

impl std::fmt::Display for PackageId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}@{}", self.package_name, self.version)
    }
}

/* ============================================================================
   Resolved Package
   ============================================================================ */

/* A fully resolved ABI package with its source and dependencies */
#[derive(Debug, Clone)]
pub struct ResolvedPackage {
    /* Unique identifier for this package */
    pub id: PackageId,
    /* The import source this package was resolved from */
    pub source: ImportSource,
    /* The resolved ABI file contents */
    pub abi_file: AbiFile,
    /* IDs of packages this package depends on */
    pub dependencies: Vec<PackageId>,
    /* Whether this package was fetched from a remote source */
    pub is_remote: bool,
}

impl ResolvedPackage {
    /* Create a new resolved package */
    pub fn new(
        source: ImportSource,
        abi_file: AbiFile,
        dependencies: Vec<PackageId>,
    ) -> Self {
        let is_remote = source.is_remote();
        Self {
            id: PackageId::from_abi_file(&abi_file),
            source,
            abi_file,
            dependencies,
            is_remote,
        }
    }

    /* Get the package name */
    pub fn package_name(&self) -> &str {
        &self.id.package_name
    }

    /* Get the package version */
    pub fn version(&self) -> &str {
        &self.id.version
    }
}

/* ============================================================================
   Resolution Error Types
   ============================================================================ */

/* Errors that can occur during import resolution */
#[derive(Debug, Clone)]
pub enum ResolveError {
    /* Circular dependency detected */
    CyclicDependency {
        /* Package that was encountered twice */
        package_id: PackageId,
        /* Chain of packages leading to the cycle */
        cycle_chain: Vec<PackageId>,
    },

    /* Version conflict: same package imported with different versions */
    VersionConflict {
        /* Package name that has conflicting versions */
        package_name: String,
        /* First version encountered */
        version_a: String,
        /* Second (conflicting) version encountered */
        version_b: String,
    },

    /* Local import attempted from a remote package */
    LocalImportFromRemote {
        /* The remote package that tried to import locally */
        remote_package: PackageId,
        /* The local import that was attempted */
        local_import: ImportSource,
    },

    /* Import source type not allowed by configuration */
    ImportTypeNotAllowed {
        /* The disallowed import source */
        source: ImportSource,
        /* Description of why it's not allowed */
        reason: String,
    },

    /* Failed to fetch import content */
    FetchError {
        /* The import that failed to fetch */
        source: ImportSource,
        /* Error message */
        message: String,
    },

    /* Failed to parse ABI file */
    ParseError {
        /* Location of the ABI file */
        location: String,
        /* Parse error message */
        message: String,
    },

    /* Failed to initialize resolver infrastructure (e.g. HTTP client) */
    InitError {
        /* Error message */
        message: String,
    },

    /* Revision requirement not satisfied for on-chain import */
    RevisionMismatch {
        /* The import that had a revision mismatch */
        source: ImportSource,
        /* Required revision specifier */
        required: String,
        /* Actual revision found */
        actual: u64,
    },
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolveError::CyclicDependency { package_id, cycle_chain } => {
                write!(
                    f,
                    "Circular dependency detected: {} (chain: {})",
                    package_id,
                    cycle_chain
                        .iter()
                        .map(|p| p.to_string())
                        .collect::<Vec<_>>()
                        .join(" -> ")
                )
            }
            ResolveError::VersionConflict {
                package_name,
                version_a,
                version_b,
            } => {
                write!(
                    f,
                    "Version conflict for package '{}': {} vs {}",
                    package_name, version_a, version_b
                )
            }
            ResolveError::LocalImportFromRemote {
                remote_package,
                local_import,
            } => {
                write!(
                    f,
                    "Remote package '{}' cannot have local import: {:?}",
                    remote_package, local_import
                )
            }
            ResolveError::ImportTypeNotAllowed { source, reason } => {
                write!(f, "Import type not allowed: {:?} - {}", source, reason)
            }
            ResolveError::FetchError { source, message } => {
                write!(f, "Failed to fetch {:?}: {}", source, message)
            }
            ResolveError::ParseError { location, message } => {
                write!(f, "Failed to parse ABI at '{}': {}", location, message)
            }
            ResolveError::InitError { message } => {
                write!(f, "Initialization error: {}", message)
            }
            ResolveError::RevisionMismatch {
                source,
                required,
                actual,
            } => {
                write!(
                    f,
                    "Revision mismatch for {:?}: required {}, got {}",
                    source, required, actual
                )
            }
        }
    }
}

impl std::error::Error for ResolveError {}

/* ============================================================================
   Resolution Result Type
   ============================================================================ */

/* Result of a full import resolution */
#[derive(Debug, Clone)]
pub struct ResolutionResult {
    /* The root package that was resolved */
    pub root: ResolvedPackage,
    /* All resolved packages (including transitive dependencies) */
    pub all_packages: Vec<ResolvedPackage>,
}

impl ResolutionResult {
    /* Get the total number of packages resolved */
    pub fn package_count(&self) -> usize {
        self.all_packages.len()
    }

    /* Get a package by its ID */
    pub fn get_package(&self, id: &PackageId) -> Option<&ResolvedPackage> {
        self.all_packages.iter().find(|p| p.id == *id)
    }

    /* Get all package IDs */
    pub fn package_ids(&self) -> Vec<&PackageId> {
        self.all_packages.iter().map(|p| &p.id).collect()
    }

    /* Create a manifest map (package_name -> ABI YAML) for WASM consumption */
    pub fn to_manifest(&self) -> std::collections::HashMap<String, String> {
        let mut manifest = std::collections::HashMap::new();
        for pkg in &self.all_packages {
            if let Ok(yaml) = serde_yml::to_string(&pkg.abi_file) {
                manifest.insert(pkg.id.package_name.clone(), yaml);
            }
        }
        manifest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_package_id_display() {
        let id = PackageId::new("thru.common.primitives", "1.0.0");
        assert_eq!(id.to_string(), "thru.common.primitives@1.0.0");
    }

    #[test]
    fn test_package_id_conflicts() {
        let id_a = PackageId::new("thru.common", "1.0.0");
        let id_b = PackageId::new("thru.common", "2.0.0");
        let id_c = PackageId::new("thru.other", "1.0.0");

        assert!(id_a.conflicts_with(&id_b));
        assert!(!id_a.conflicts_with(&id_c));
        assert!(!id_a.conflicts_with(&id_a));
    }

    #[test]
    fn test_resolve_error_display() {
        let err = ResolveError::VersionConflict {
            package_name: "thru.common".to_string(),
            version_a: "1.0.0".to_string(),
            version_b: "2.0.0".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("thru.common"));
        assert!(msg.contains("1.0.0"));
        assert!(msg.contains("2.0.0"));
    }
}
