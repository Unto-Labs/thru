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

    /// The stream observed execution or confirmation, but the detail query
    /// failed. Query this signature again; do not infer that submission failed.
    /// `outcome` may contain an execution failure and must be inspected.
    #[error(
        "Transaction observed via stream but details unavailable (signature: {signature}): {source}"
    )]
    TransactionDetailsUnavailable {
        signature: String,
        outcome: Box<thru_grpc_client::thru::services::v1::SendAndTrackTxnResponse>,
        #[source]
        source: Box<ClientError>,
    },

    /// A server-side stream dropped this subscriber for falling behind.
    ///
    /// The server disconnects a slow subscriber rather than silently skipping
    /// messages, so this is terminal for the subscription and re-subscribing
    /// resumes from the present, leaving a gap that must be filled through the
    /// query service.
    #[error("Stream lagged: {0}")]
    StreamLagged(String),

    /// The RPC endpoint rejected the request for exceeding a rate limit.
    ///
    /// The Thru edge reports a rate limit as `RESOURCE_EXHAUSTED` with a
    /// message that starts with `rate limit`. `unkeyed` is set when the request
    /// carried no API key and hit the per-IP limit, which a free API key lifts;
    /// see [`ClientError::get_key_url`].
    #[error("RPC error: {}", escape_controls(.message))]
    RateLimited {
        /// The server's message, verbatim.
        message: String,
        /// Whether the limit is the one for requests without an API key.
        unkeyed: bool,
        /// Where to get an API key: the first [`GET_KEY_URL`] link in the
        /// message, else [`GET_KEY_URL`] itself.
        get_key_url: String,
    },

    /// Account not found errors
    #[error("Account not found: {0}")]
    AccountNotFound(String),

    /// Generic error with context
    #[error("{message}")]
    Generic { message: String },
}

/// Page where a developer gets a Thru API key.
pub const GET_KEY_URL: &str = "https://dev.thru.org/keys";

/// `message` with control characters escaped (`\u{1b}` and so on), for
/// showing a server-supplied message in a terminal: tonic percent-decodes
/// `grpc-message`, so a third-party RPC could otherwise send escape sequences.
/// Structured fields keep the original.
pub fn escape_controls(message: &str) -> String {
    message
        .chars()
        .flat_map(|c| {
            let escaped: Vec<char> = if c.is_control() {
                c.escape_default().collect()
            } else {
                vec![c]
            };
            escaped
        })
        .collect()
}

impl ClientError {
    /// Classify `status` as the edge's rate limit: code `RESOURCE_EXHAUSTED`
    /// and a message that starts with `rate limit`. Returns `None` for every
    /// other status, including other `RESOURCE_EXHAUSTED` causes such as a
    /// slow stream subscriber or a message-size limit.
    pub fn rate_limited_from_status(status: &tonic::Status) -> Option<Self> {
        if status.code() != tonic::Code::ResourceExhausted {
            return None;
        }
        let message = status.message();
        if !message.starts_with("rate limit") {
            return None;
        }
        Some(ClientError::RateLimited {
            message: message.to_string(),
            unkeyed: message.contains("without an API key"),
            get_key_url: get_key_url_in(message).unwrap_or(GET_KEY_URL).to_string(),
        })
    }

    /// Whether this is a rate-limit rejection ([`ClientError::RateLimited`]).
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, ClientError::RateLimited { .. })
    }

    /// Where to get an API key that lifts this error's limit: `Some` only for
    /// the rate limit on requests without an API key. A keyed caller that hits
    /// its own limit gains nothing from another key, so it gets `None`.
    pub fn get_key_url(&self) -> Option<&str> {
        match self {
            ClientError::RateLimited {
                unkeyed: true,
                get_key_url,
                ..
            } => Some(get_key_url),
            _ => None,
        }
    }
}

/// The first [`GET_KEY_URL`] link in `message`, up to the next whitespace,
/// without trailing sentence punctuation.
fn get_key_url_in(message: &str) -> Option<&str> {
    let start = message.find(GET_KEY_URL)?;
    let rest = &message[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    Some(rest[..end].trim_end_matches(['.', ',', ';', ')', '"', '\'']))
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
        Self::rate_limited_from_status(&status)
            .unwrap_or_else(|| ClientError::Rpc(status.to_string()))
    }
}

impl From<tonic::transport::Error> for ClientError {
    fn from(err: tonic::transport::Error) -> Self {
        ClientError::Transport(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The deny message the edge sends a caller without an API key.
    const UNKEYED: &str = "rate limit for requests without an API key exceeded (10 weighted \
        requests/s per IP). Get a free key with higher limits at \
        https://dev.thru.org/keys?ref=edge-429 and send it as \"Authorization: Bearer thru_...\". \
        Docs: https://thru.org/docs/api-ref/rate-limits/";

    #[test]
    fn unkeyed_edge_message_is_rate_limited_with_key_url() {
        let err = ClientError::from(tonic::Status::resource_exhausted(UNKEYED));
        match &err {
            ClientError::RateLimited {
                message,
                unkeyed,
                get_key_url,
            } => {
                assert_eq!(message, UNKEYED);
                assert!(*unkeyed);
                assert_eq!(get_key_url, "https://dev.thru.org/keys?ref=edge-429");
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
        assert!(err.is_rate_limited());
        assert_eq!(
            err.get_key_url(),
            Some("https://dev.thru.org/keys?ref=edge-429")
        );
    }

    #[test]
    fn keyed_message_is_rate_limited_without_key_url() {
        let err = ClientError::from(tonic::Status::resource_exhausted("rate limit exceeded"));
        match &err {
            ClientError::RateLimited {
                message,
                unkeyed,
                get_key_url,
            } => {
                assert_eq!(message, "rate limit exceeded");
                assert!(!*unkeyed);
                assert_eq!(get_key_url, GET_KEY_URL);
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
        assert!(err.is_rate_limited());
        assert_eq!(err.get_key_url(), None);
    }

    #[test]
    fn unkeyed_message_without_url_falls_back() {
        let err = ClientError::from(tonic::Status::resource_exhausted(
            "rate limit for requests without an API key exceeded",
        ));
        assert_eq!(err.get_key_url(), Some(GET_KEY_URL));
    }

    #[test]
    fn key_url_stops_at_whitespace_and_trailing_punctuation() {
        assert_eq!(
            get_key_url_in("see https://dev.thru.org/keys?ref=x. Then retry"),
            Some("https://dev.thru.org/keys?ref=x")
        );
        assert_eq!(
            get_key_url_in("at https://dev.thru.org/keys"),
            Some("https://dev.thru.org/keys")
        );
        assert_eq!(get_key_url_in("no link here"), None);
    }

    /* Only RESOURCE_EXHAUSTED with a "rate limit" message is a rate limit:
    other exhaustion (message size, a slow subscriber) and other codes that
    mention rate limits stay plain RPC errors. */
    #[test]
    fn other_statuses_stay_rpc_errors() {
        for status in [
            tonic::Status::resource_exhausted("message larger than max"),
            tonic::Status::unavailable("rate limit exceeded"),
            tonic::Status::internal("boom"),
        ] {
            let code = status.code();
            match ClientError::from(status) {
                ClientError::Rpc(_) => {}
                other => panic!("{code:?} must stay an Rpc error, got {other:?}"),
            }
        }
    }

    #[test]
    fn rate_limit_display_escapes_control_characters() {
        let err = ClientError::from(tonic::Status::resource_exhausted(
            "rate limit exceeded\u{1b}[2J",
        ));
        assert_eq!(err.to_string(), "RPC error: rate limit exceeded\\u{1b}[2J");
        match err {
            ClientError::RateLimited { message, .. } => {
                assert_eq!(message, "rate limit exceeded\u{1b}[2J")
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }
}
