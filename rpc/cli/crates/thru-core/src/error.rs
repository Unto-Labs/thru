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

    /// Structured Developers authentication/funding failure; never contains credentials
    #[error("{message}")]
    Developers {
        code: String,
        message: String,
        status: Option<u16>,
        retry_after: Option<u64>,
        signature: Option<String>,
    },

    /// I/O errors
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Cryptographic errors
    #[error("Crypto error: {0}")]
    Crypto(String),

    /// Upload errors
    #[error("Upload error: {0}")]
    ProgramUpload(String),

    /// Uploader cleanup errors
    #[error("Uploader cleanup error: {0}")]
    ProgramCleanup(String),

    /// Transaction submission errors
    #[error("Transaction submission error: {0}")]
    TransactionSubmission(String),

    /// Transaction failed with execution issues but was submitted
    #[error("{message}")]
    TransactionFailed {
        message: String,
        execution_result: u64,
        vm_error: i32,
        vm_error_label: String,
        user_error_code: u64,
        user_error_label: String,
        signature: String,
    },

    /// Error already reported to user (used to avoid duplicate output)
    #[error("Error already reported to user")]
    Reported,

    /// Nonce management errors
    #[error("Nonce management error: {0}")]
    NonceManagement(String),

    /// Transaction verification errors
    #[error("Transaction verification error: {0}")]
    TransactionVerification(String),

    /// Submission reached the stream, but full details could not be queried.
    #[error(
        "Transaction observed via stream but details unavailable (signature: {signature}): {message}"
    )]
    TransactionDetailsUnavailable {
        signature: String,
        outcome: Box<thru_client::proto::services::v1::SendAndTrackTxnResponse>,
        message: String,
    },

    /// Resume validation errors
    #[error("Resume validation error: {0}")]
    ResumeValidation(String),

    /// Resume validation errors with account details
    #[error("Resume validation error: {message}")]
    ResumeValidationAccount {
        message: String,
        account: String,
        seed: String,
    },

    /// The RPC endpoint rejected the request for exceeding a rate limit.
    /// `unkeyed` is set for the limit on requests without an API key, which a
    /// free API key lifts.
    #[error("RPC error: {}", thru_client::escape_controls(.message))]
    RateLimited { message: String, unkeyed: bool },

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

    /// Ledger hardware-wallet errors (device locked, wrong app, rejected, ...).
    /// `message` states the fix; `code` is a stable machine-readable class.
    #[error("Ledger: {message}")]
    Ledger {
        code: String,
        message: String,
        status_word: Option<u16>,
        /// Canonical reason class (corpus `sw_class`) for transaction and
        /// request rejections, e.g. `rw_unsorted`.
        reason: Option<String>,
    },

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
        match thru_client::ClientError::rate_limited_from_status(&status) {
            Some(rate_limited) => rate_limited.into(),
            None => CliError::Rpc(status.to_string()),
        }
    }
}

impl From<tonic::transport::Error> for CliError {
    fn from(err: tonic::transport::Error) -> Self {
        CliError::Transport(err.to_string())
    }
}

impl CliError {
    /// Converts a client error for a command that reports RPC failures in its
    /// own words: a rate limit stays [`CliError::RateLimited`], so the shared
    /// handler can point a keyless caller to an API key; anything else goes
    /// through `other`.
    pub fn rate_limited_or(
        err: thru_client::ClientError,
        other: impl FnOnce(thru_client::ClientError) -> CliError,
    ) -> CliError {
        if err.is_rate_limited() {
            CliError::from(err)
        } else {
            other(err)
        }
    }
}

impl From<thru_client::ClientError> for CliError {
    fn from(err: thru_client::ClientError) -> Self {
        match err {
            thru_client::ClientError::Rpc(msg) => CliError::Rpc(msg),
            thru_client::ClientError::Transport(msg) => CliError::Transport(msg),
            thru_client::ClientError::Validation(msg) => CliError::Validation(msg),
            thru_client::ClientError::TransactionSubmission(msg) => {
                CliError::TransactionSubmission(msg)
            }
            thru_client::ClientError::TransactionVerification(msg) => {
                CliError::TransactionVerification(msg)
            }
            thru_client::ClientError::TransactionDetailsUnavailable {
                signature,
                outcome,
                source,
            } => {
                if let Some(exec) = outcome
                    .execution_result
                    .as_ref()
                    .filter(|exec| exec.execution_result != 0 || exec.vm_error != 0)
                {
                    let vm_error_label = crate::utils::format_vm_error(exec.vm_error);
                    let user_error_label = format!("0x{:X}", exec.user_error_code);
                    return CliError::TransactionFailed {
                        message: format!(
                            "Transaction failed with execution result: {} (VM error: {}, User error: {})",
                            exec.execution_result, vm_error_label, user_error_label
                        ),
                        execution_result: exec.execution_result,
                        vm_error: exec.vm_error,
                        vm_error_label,
                        user_error_code: exec.user_error_code,
                        user_error_label,
                        signature,
                    };
                }
                CliError::TransactionDetailsUnavailable {
                    signature,
                    outcome,
                    message: source.to_string(),
                }
            }
            /* A dropped subscription is an RPC failure to the CLI, but say why:
            the server disconnects a subscriber that falls behind rather than
            skipping messages, so whatever was being followed now has a gap. */
            thru_client::ClientError::StreamLagged(msg) => {
                CliError::Rpc(format!("stream dropped for falling behind: {}", msg))
            }
            thru_client::ClientError::RateLimited {
                message, unkeyed, ..
            } => CliError::RateLimited { message, unkeyed },
            thru_client::ClientError::AccountNotFound(msg) => CliError::AccountNotFound(msg),
            thru_client::ClientError::Generic { message } => CliError::Generic { message },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNKEYED: &str = "rate limit for requests without an API key exceeded (10 weighted \
        requests/s per IP). Get a free key with higher limits at \
        https://dev.thru.org/keys?ref=edge-429 and send it as \"Authorization: Bearer thru_...\". \
        Docs: https://thru.org/docs/api-ref/rate-limits/";

    #[test]
    fn rate_limited_or_keeps_rate_limits_for_the_hint() {
        let limited = thru_client::ClientError::from(tonic::Status::resource_exhausted(UNKEYED));
        assert!(matches!(
            CliError::rate_limited_or(limited, |_| CliError::Rpc("other".into())),
            CliError::RateLimited { unkeyed: true, .. }
        ));
        let failed = thru_client::ClientError::Rpc("boom".into());
        assert!(matches!(
            CliError::rate_limited_or(failed, |e| CliError::TransactionSubmission(e.to_string())),
            CliError::TransactionSubmission(_)
        ));
    }

    #[test]
    fn rate_limit_status_keeps_its_kind() {
        match CliError::from(tonic::Status::resource_exhausted(UNKEYED)) {
            CliError::RateLimited { message, unkeyed } => {
                assert_eq!(message, UNKEYED);
                assert!(unkeyed);
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
        match CliError::from(tonic::Status::resource_exhausted("rate limit exceeded")) {
            CliError::RateLimited { message, unkeyed } => {
                assert_eq!(message, "rate limit exceeded");
                assert!(!unkeyed);
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn rate_limit_client_error_keeps_its_kind() {
        let client = thru_client::ClientError::from(tonic::Status::resource_exhausted(UNKEYED));
        match CliError::from(client) {
            CliError::RateLimited { unkeyed, .. } => assert!(unkeyed),
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn other_resource_exhausted_stays_rpc() {
        match CliError::from(tonic::Status::resource_exhausted("message too large")) {
            CliError::Rpc(_) => {}
            other => panic!("expected Rpc, got {other:?}"),
        }
    }
}
