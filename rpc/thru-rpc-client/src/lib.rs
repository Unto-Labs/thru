//! Official Rust client for Thru RPC/WebSocket API
//!
//! This crate provides an async client for interacting with the Thru blockchain
//! via its RPC and WebSocket APIs.
//!
//! # Example
//!
//! ```no_run
//! use thru_rpc_client::{Client, Pubkey};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Create a client
//!     let client = Client::builder()
//!         .http_endpoint(url::Url::parse("http://localhost:3000").unwrap())
//!         .ws_endpoint(Some(url::Url::parse("ws://localhost:3001").unwrap()))
//!         .build();
//!
//!     // Get account balance - use proper Thru address format (ta...)
//!     let pubkey = Pubkey::from_bytes(&[1u8; 32]);
//!     let balance = client.get_balance(&pubkey).await?;
//!     println!("Balance: {}", balance);
//!
//!     Ok(())
//! }
//! ```

#![warn(missing_docs)]
#![warn(missing_debug_implementations)]

pub mod client;
pub mod error;
pub mod http;
pub mod types;
pub mod utils;
pub mod websocket;

// Re-export main types and traits
pub use client::{Client, ClientBuilder, ClientConfig};
pub use error::{Result, ThruError};

// Re-export Thru base types for convenience
pub use thru_base::tn_tools::{Pubkey, Signature};
pub use types::{
    // Account types
    Account,
    AccountInfoConfig,
    AccountInfoResponse,
    AccountNotification,
    AccountSubscribeConfig,
    BlockHeight,
    CommitmentLevel,
    Event,
    // getProgramAccounts types
    GetProgramAccountsResponse,
    MultipleAccountsResponse,
    ProgramAccount,
    // Common types
    SendTransactionConfig,
    SendTransactionResult,
    SignatureExecutionResult,
    SignatureNotification,
    SignatureStatus,
    // Transaction types
    TransactionDetails,
    TransactionResponse,
    Version,
};

// Re-export thru-base types for makeStateProof
pub use thru_base::rpc_types::{MakeStateProofConfig, ProofType};

// Re-export WebSocket types
pub use websocket::{
    AccountSubscriptionHandle, SignatureSubscriptionHandle, SlotSubscriptionHandle,
    SubscriptionHandle, SubscriptionManager, WebSocketClient,
};

// Version information
/// Get the version of this client library
pub fn client_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
