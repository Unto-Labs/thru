//! ABI File Loading and Import Resolution
//!
//! This crate provides functionality for loading ABI files from disk,
//! resolving imports between ABI files, and preparing ABI data for
//! code generation or reflection.

pub mod enhanced_resolver;
pub mod fetcher;
pub mod file;
pub mod flatten;
pub mod package;
pub mod resolver;

// Re-export commonly used types at the crate root
pub use file::{
    AbiFile, AbiMetadata, AbiOptions, ImportSource, OnchainTarget, ProgramMetadata, RevisionSpec,
    RootTypes,
};
pub use flatten::{flatten, flatten_to_yaml, flatten_with_options, normalize_type_refs};
pub use package::{PackageId, ResolutionResult, ResolveError, ResolvedPackage};
pub use resolver::ImportResolver;
pub use enhanced_resolver::EnhancedImportResolver;

// Re-export fetcher types
pub use fetcher::{
    CacheConfig, CompositeFetcher, FetchContext, FetchError, FetchResult, FetcherConfig,
    GitFetcherConfig, ImportFetcher, OnchainFetcherConfig,
};

// Re-export abi_types for convenience
pub use abi_types;
