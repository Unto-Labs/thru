//! ABI File Loading and Import Resolution
//!
//! This crate provides functionality for loading ABI files from disk,
//! resolving imports between ABI files, and preparing ABI data for
//! code generation or reflection.

pub mod file;
pub mod flatten;
pub mod resolver;

// Re-export commonly used types at the crate root
pub use file::{AbiFile, AbiMetadata, AbiOptions, ProgramMetadata, RootTypes};
pub use flatten::{flatten, flatten_to_yaml, flatten_with_options, normalize_type_refs};
pub use resolver::ImportResolver;

// Re-export abi_types for convenience
pub use abi_types;
