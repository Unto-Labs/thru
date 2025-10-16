//! Error types for the Thru RPC client
//!
//! This module provides a comprehensive error hierarchy for all failure modes
//! in HTTP and WebSocket operations.

use std::time::Duration;
use thiserror::Error;

/// Main error type for the Thru RPC client
#[derive(Error, Debug)]
pub enum ThruError {
    /// HTTP-specific errors
    #[error("HTTP error: {0}")]
    Http(#[from] HttpError),

    /// WebSocket-specific errors
    #[error("WebSocket error: {0}")]
    WebSocket(#[from] WebSocketError),

    /// Serialization/deserialization errors
    #[error("Serialization error: {0}")]
    Serialization(#[from] SerializationError),

    /// Validation errors
    #[error("Validation error: {0}")]
    Validation(#[from] ValidationError),

    /// Network/connection errors
    #[error("Connection error: {0}")]
    Connection(#[from] ConnectionError),

    /// Subscription-specific errors
    #[error("Subscription error: {0}")]
    Subscription(#[from] SubscriptionError),

    /// Timeout errors
    #[error("Operation timed out after {0:?}")]
    Timeout(Duration),

    /// Configuration errors
    #[error("Configuration error: {0}")]
    Configuration(String),
}

/// Result type alias for convenience
pub type Result<T> = std::result::Result<T, ThruError>;

/// HTTP-specific errors
#[derive(Error, Debug)]
pub enum HttpError {
    /// Request failed with HTTP error
    #[error("HTTP request failed with status {status}: {message}")]
    RequestFailed {
        /// The HTTP status code
        status: u16,
        /// The error message from the server
        message: String,
        /// The source error
        #[source]
        source: Option<reqwest::Error>,
    },

    /// JSON-RPC error response
    #[error("RPC error {code}: {message}")]
    RpcError {
        /// The JSON-RPC error code
        code: i32,
        /// The error message
        message: String,
        /// The error data
        data: Option<serde_json::Value>,
    },

    /// Request building failed
    #[error("Failed to build request")]
    RequestBuilder(#[from] reqwest::Error),

    /// Response parsing failed
    #[error("Failed to parse response")]
    ResponseParsing {
        /// The source error
        #[source]
        source: reqwest::Error,
        /// The response body
        body: Option<String>,
    },

    /// Invalid endpoint URL
    #[error("Invalid endpoint URL: {0}")]
    InvalidEndpoint(String),
}

impl HttpError {
    /// Create an RPC error from a JSON-RPC error response
    pub fn from_rpc_error(code: i32, message: String, data: Option<serde_json::Value>) -> Self {
        Self::RpcError {
            code,
            message,
            data,
        }
    }
}

/// WebSocket-specific errors
#[derive(Error, Debug)]
pub enum WebSocketError {
    /// Connection failed
    #[error("Failed to connect to WebSocket")]
    ConnectionFailed(#[source] tokio_tungstenite::tungstenite::Error),

    /// Connection closed unexpectedly
    #[error("WebSocket connection closed: {reason}")]
    ConnectionClosed {
        /// The reason for the connection closure
        reason: String,
        /// The WebSocket close code
        code: Option<u16>,
    },

    /// Message send failed
    #[error("Failed to send message")]
    SendFailed(#[source] tokio_tungstenite::tungstenite::Error),

    /// Message receive failed
    #[error("Failed to receive message")]
    ReceiveFailed(#[source] tokio_tungstenite::tungstenite::Error),

    /// Invalid message format
    #[error("Invalid message format: {0}")]
    InvalidMessage(String),

    /// Subscription not found
    #[error("Subscription {0} not found")]
    SubscriptionNotFound(u64),

    /// Maximum reconnection attempts exceeded
    #[error("Maximum reconnection attempts ({max}) exceeded")]
    ReconnectionFailed {
        /// The maximum number of reconnection attempts
        max: u32,
    },

    /// WebSocket not connected
    #[error("WebSocket is not connected")]
    NotConnected,
}

/// Validation errors for input data
#[derive(Error, Debug)]
pub enum ValidationError {
    /// Invalid public key format
    #[error("Invalid public key: {0}")]
    InvalidPubkey(String),

    /// Invalid signature format
    #[error("Invalid signature: {0}")]
    InvalidSignature(String),

    /// Invalid transaction data
    #[error("Invalid transaction: {0}")]
    InvalidTransaction(String),

    /// Invalid configuration
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    /// Parameter out of range
    #[error("Parameter {param} out of range: {value} not in [{min}, {max}]")]
    OutOfRange {
        /// The parameter name
        param: String,
        /// The parameter value
        value: String,
        /// The minimum value
        min: String,
        /// The maximum value
        max: String,
    },
}

/// Network and connection errors
#[derive(Error, Debug)]
pub enum ConnectionError {
    /// DNS resolution failed
    #[error("Failed to resolve host: {0}")]
    DnsResolution(String),

    /// TCP connection failed
    #[error("TCP connection failed")]
    TcpConnection(#[source] std::io::Error),

    /// TLS handshake failed
    #[error("TLS handshake failed")]
    TlsHandshake(#[source] Box<dyn std::error::Error + Send + Sync>),

    /// Connection pool exhausted
    #[error("Connection pool exhausted: max {max} connections")]
    PoolExhausted {
        /// The maximum number of connections
        max: usize,
    },

    /// Network timeout
    #[error("Network operation timed out")]
    NetworkTimeout,

    /// Maximum reconnection attempts reached
    #[error("Maximum reconnection attempts reached: {0}")]
    MaxReconnectAttemptsReached(usize),
}

/// Serialization/deserialization errors
#[derive(Error, Debug)]
pub enum SerializationError {
    /// JSON serialization failed
    #[error("Failed to serialize to JSON")]
    JsonSerialize(#[source] serde_json::Error),

    /// JSON deserialization failed
    #[error("Failed to deserialize from JSON")]
    JsonDeserialize {
        /// The source error
        #[source]
        source: serde_json::Error,
        /// The data that failed to deserialize
        data: String,
    },

    /// Base64 encoding failed
    #[error("Failed to encode base64: {0}")]
    Base64Encode(String),

    /// Base64 decoding failed
    #[error("Failed to decode base64: {0}")]
    Base64Decode(String),

    /// Binary serialization failed
    #[error("Failed to serialize binary data: {0}")]
    BinarySerialize(String),
}

/// Subscription-related errors
#[derive(Error, Debug)]
pub enum SubscriptionError {
    /// Failed to create subscription
    #[error("Failed to create subscription: {0}")]
    CreationFailed(String),

    /// Subscription confirmation timeout
    #[error("Subscription confirmation timeout")]
    ConfirmationTimeout,

    /// Invalid subscription ID
    #[error("Invalid subscription ID: {0}")]
    InvalidId(u64),

    /// Subscription already exists
    #[error("Subscription already exists")]
    AlreadyExists,
}

/// Extension trait for adding context to errors
pub trait ErrorContext<T> {
    /// Add context to an error
    fn context(self, msg: &str) -> Result<T>;

    /// Add context with format arguments
    fn with_context<F>(self, f: F) -> Result<T>
    where
        F: FnOnce() -> String;
}

impl<T, E> ErrorContext<T> for std::result::Result<T, E>
where
    E: Into<ThruError>,
{
    fn context(self, _msg: &str) -> Result<T> {
        self.map_err(|e| {
            let base_error = e.into();
            // For now, we just return the base error
            base_error
        })
    }

    fn with_context<F>(self, f: F) -> Result<T>
    where
        F: FnOnce() -> String,
    {
        self.map_err(|e| {
            let _context = f();
            let base_error = e.into();
            // For now, we just return the base error
            base_error
        })
    }
}

/// Helper functions for common error patterns
impl ThruError {
    /// Create a timeout error
    pub fn timeout(duration: Duration) -> Self {
        Self::Timeout(duration)
    }

    /// Create a subscription timeout error
    pub fn subscription_timeout() -> Self {
        Self::Subscription(SubscriptionError::ConfirmationTimeout)
    }

    /// Check if error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::Connection(_)
                | Self::WebSocket(WebSocketError::ConnectionClosed { .. })
                | Self::Timeout(_)
        )
    }

    /// Get error code for JSON-RPC errors
    pub fn rpc_code(&self) -> Option<i32> {
        match self {
            Self::Http(HttpError::RpcError { code, .. }) => Some(*code),
            _ => None,
        }
    }
}

impl From<thru_base::tn_tools::ValidationError> for ValidationError {
    fn from(base_error: thru_base::tn_tools::ValidationError) -> Self {
        match base_error {
            thru_base::tn_tools::ValidationError::InvalidPubkey(s) => {
                ValidationError::InvalidPubkey(s)
            }
            thru_base::tn_tools::ValidationError::InvalidSignature(s) => {
                ValidationError::InvalidSignature(s)
            }
        }
    }
}

impl From<anyhow::Error> for ThruError {
    fn from(error: anyhow::Error) -> Self {
        // Try to downcast to known error types first
        match error.downcast::<thru_base::tn_tools::ValidationError>() {
            Ok(validation_error) => ThruError::Validation(validation_error.into()),
            Err(original_error) => {
                // Fallback to a generic validation error
                ThruError::Validation(ValidationError::InvalidConfig(original_error.to_string()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let error = ThruError::Validation(ValidationError::InvalidPubkey("bad format".to_string()));
        assert_eq!(
            error.to_string(),
            "Validation error: Invalid public key: bad format"
        );
    }

    #[test]
    fn test_is_retryable() {
        let timeout_error = ThruError::timeout(Duration::from_secs(5));
        assert!(timeout_error.is_retryable());

        let validation_error =
            ThruError::Validation(ValidationError::InvalidPubkey("bad".to_string()));
        assert!(!validation_error.is_retryable());
    }

    #[test]
    fn test_rpc_code() {
        let rpc_error = ThruError::Http(HttpError::RpcError {
            code: -32602,
            message: "Invalid params".to_string(),
            data: None,
        });
        assert_eq!(rpc_error.rpc_code(), Some(-32602));

        let other_error = ThruError::Timeout(Duration::from_secs(5));
        assert_eq!(other_error.rpc_code(), None);
    }
}
