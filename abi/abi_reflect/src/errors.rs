use crate::parser::ParseError;
use abi_gen::codegen::shared::builder::IrBuildError;
use thiserror::Error;

/// Result alias used across the reflection crate.
pub type ReflectResult<T> = Result<T, ReflectError>;

/// Top-level errors produced by the reflection runtime.
#[derive(Debug, Error)]
pub enum ReflectError {
    /// Building the shared layout IR failed (usually due to resolver issues).
    #[error("failed to build layout IR: {0}")]
    IrBuild(#[from] IrBuildError),

    /// Requested type is missing from the IR cache.
    #[error("type '{type_name}' not found in IR cache")]
    UnknownType { type_name: String },

    /// A required IR dynamic parameter was missing.
    #[error("type '{type_name}' missing IR parameter '{parameter}'")]
    MissingIrParameter {
        type_name: String,
        parameter: String,
    },

    /// Encountered an invalid tag value during IR evaluation.
    #[error("type '{type_name}' has invalid tag value {value} for '{tag}'")]
    InvalidTagValue {
        type_name: String,
        tag: String,
        value: u128,
    },

    /// Arithmetic overflow detected while evaluating IR nodes.
    #[error("type '{type_name}' overflowed during {op}")]
    ArithmeticOverflow { type_name: String, op: &'static str },

    /// Buffer was too small for the computed IR footprint.
    #[error("type '{type_name}' requires {required} bytes but only {available} available")]
    BufferTooSmall {
        type_name: String,
        required: u128,
        available: u64,
    },

    /// Dynamic parameter extraction is not yet supported for this path.
    #[error("dynamic parameter '{parameter}' for type '{type_name}' is not supported: {reason}")]
    UnsupportedDynamicParam {
        type_name: String,
        parameter: String,
        reason: String,
    },

    /// Dynamic parameter produced a negative value.
    #[error(
        "dynamic parameter '{parameter}' for type '{type_name}' evaluated to a negative value"
    )]
    NegativeDynamicParam {
        type_name: String,
        parameter: String,
    },

    /// Parsing failed after IR validation.
    #[error("failed to parse type '{type_name}': {source}")]
    Parse {
        type_name: String,
        #[source]
        source: ParseError,
    },

    /// Required root type is not configured in the ABI.
    #[error("{root_kind} root type is not configured in the ABI")]
    MissingRootType { root_kind: &'static str },
}
