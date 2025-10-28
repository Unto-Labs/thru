//! Error types for the Thru CLI

use thiserror::Error;

/// Main error type for the Thru CLI
#[derive(Error, Debug)]
pub enum CliError {
    /// Configuration-related errors
    #[error("Configuration error: {0}")]
    Config(#[from] ConfigError),

    /// RPC client errors
    #[error("RPC error: {0}")]
    Rpc(String),

    /// Transport-level errors
    #[error("Transport error: {0}")]
    Transport(String),

    /// Validation errors
    #[error("Validation error: {0}")]
    Validation(String),

    /// I/O errors
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Cryptographic errors
    #[error("Crypto error: {0}")]
    Crypto(String),

    /// Program upload errors
    #[error("Program upload error: {0}")]
    ProgramUpload(String),

    /// Program cleanup errors
    #[error("Program cleanup error: {0}")]
    ProgramCleanup(String),

    /// Transaction submission errors
    #[error("Transaction submission error: {0}")]
    TransactionSubmission(String),

    /// Nonce management errors
    #[error("Nonce management error: {0}")]
    NonceManagement(String),

    /// Transaction verification errors
    #[error("Transaction verification error: {0}")]
    TransactionVerification(String),

    /// Resume validation errors
    #[error("Resume validation error: {0}")]
    ResumeValidation(String),

    /// Account not found errors
    #[error("Account not found: {0}")]
    AccountNotFound(String),

    /// Hash mismatch errors
    #[error("Hash mismatch: {0}")]
    HashMismatch(String),

    /// Meta account closed errors
    #[error("Meta account closed: {0}")]
    #[allow(dead_code)]
    MetaAccountClosed(String),

    /// Generic error with context
    #[error("{message}")]
    Generic { message: String },
}

/// Configuration-specific errors
#[derive(Error, Debug)]
pub enum ConfigError {
    /// Config file not found
    // #[error("Config file not found at {path}. Run 'thru-cli init' to create a default config")]
    // NotFound { path: String },

    /// Invalid config format
    #[error("Invalid config format: {0}")]
    InvalidFormat(#[from] serde_yaml::Error),

    /// Invalid private key
    #[error("Invalid private key: {0}")]
    InvalidPrivateKey(String),

    /// Invalid public key
    #[error("Invalid public key: {0}")]
    InvalidPublicKey(String),

    /// Invalid URL
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    /// Directory creation failed
    #[error("Failed to create config directory: {0}")]
    DirectoryCreation(std::io::Error),
}

impl From<anyhow::Error> for CliError {
    fn from(err: anyhow::Error) -> Self {
        CliError::Generic {
            message: err.to_string(),
        }
    }
}

impl From<tonic::Status> for CliError {
    fn from(status: tonic::Status) -> Self {
        CliError::Rpc(status.to_string())
    }
}

impl From<tonic::transport::Error> for CliError {
    fn from(err: tonic::transport::Error) -> Self {
        CliError::Transport(err.to_string())
    }
}
