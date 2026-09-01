//! Error types for the Thru gRPC client library

use thiserror::Error;

/// Main error type for the Thru gRPC client
#[derive(Error, Debug)]
pub enum ClientError {
    /// RPC client errors
    #[error("RPC error: {0}")]
    Rpc(String),

    /// Transport-level errors
    #[error("Transport error: {0}")]
    Transport(String),

    /// Validation errors
    #[error("Validation error: {0}")]
    Validation(String),

    /// Transaction submission errors
    #[error("Transaction submission error: {0}")]
    TransactionSubmission(String),

    /// Transaction verification errors
    #[error("Transaction verification error: {0}")]
    TransactionVerification(String),

    /// A server-side stream dropped this subscriber for falling behind.
    ///
    /// The server disconnects a slow subscriber rather than silently skipping
    /// messages, so this is terminal for the subscription and re-subscribing
    /// resumes from the present, leaving a gap that must be filled through the
    /// query service.
    #[error("Stream lagged: {0}")]
    StreamLagged(String),

    /// Account not found errors
    #[error("Account not found: {0}")]
    AccountNotFound(String),

    /// Generic error with context
    #[error("{message}")]
    Generic { message: String },
}

impl From<anyhow::Error> for ClientError {
    fn from(err: anyhow::Error) -> Self {
        ClientError::Generic {
            message: err.to_string(),
        }
    }
}

impl From<tonic::Status> for ClientError {
    fn from(status: tonic::Status) -> Self {
        ClientError::Rpc(status.to_string())
    }
}

impl From<tonic::transport::Error> for ClientError {
    fn from(err: tonic::transport::Error) -> Self {
        ClientError::Transport(err.to_string())
    }
}
