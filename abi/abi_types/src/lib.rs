//! ABI Type Definitions
//!
//! This crate contains the core type definitions for the ABI system.
//! It provides pure data structures for representing ABI schemas without
//! any file I/O or code generation logic.

pub mod expr;
pub mod types;

// Re-export commonly used types at the crate root
pub use expr::*;
pub use types::*;
