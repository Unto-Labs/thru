# Thru RPC Client

An async Rust client library for interacting with the Thru blockchain via HTTP RPC and WebSocket subscriptions.

[![Crates.io](https://img.shields.io/crates/v/thru-rpc-client.svg)](https://crates.io/crates/thru-rpc-client)
[![Documentation](https://docs.rs/thru-rpc-client/badge.svg)](https://docs.rs/thru-rpc-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Async-first**: Built with `tokio` for high-performance async operations
- **HTTP RPC**: Complete support for all Thru RPC methods
- **WebSocket Subscriptions**: Real-time account, signature, and slot updates
- **Type Safety**: Strongly typed request/response structures
- **Error Handling**: Comprehensive error types with context
- **Subscription Management**: RAII-style handles for automatic cleanup
- **Proper Encoding**: Uses official Thru encoding with checksum validation
- **Connection Management**: Automatic reconnection and connection pooling

## Quick Start

Add this to your `Cargo.toml`:

```toml
[dependencies]
thru-rpc-client = "0.1.0"
tokio = { version = "1.0", features = ["full"] }
```

### Basic HTTP Usage

```rust
use thru_rpc_client::{Client, Pubkey};
use url::Url;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create a client
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000")?)
        .build();

    // Get version information
    let version = client.get_version().await?;
    println!("Connected to Thru version: {}", version.version);

    // Get block height
    let height = client.get_block_height().await?;
    println!("Current block height: {}", height.height);

    // Query account balance
    let pubkey = Pubkey::new("ta1234...".to_string())?;
    let balance = client.get_balance(&pubkey).await?;
    println!("Account balance: {} units", balance);

    Ok(())
}
```

### WebSocket Subscriptions

```rust
use thru_rpc_client::{Client, Pubkey};
use url::Url;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000")?)
        .ws_endpoint(Some(Url::parse("ws://localhost:3001")?))
        .build();

    // Get WebSocket client
    let ws_client = client.websocket().await?;

    // Subscribe to account changes
    let pubkey = Pubkey::new("ta1234...".to_string())?;
    let mut account_notifications = ws_client.account_subscribe(&pubkey, None).await?;

    // Listen for notifications
    while let Some(notification) = account_notifications.recv().await {
        println!("Account updated: {:?}", notification);
    }

    Ok(())
}
```

### Subscription Handles (RAII)

```rust
use thru_rpc_client::{Client, SubscriptionManager};
use url::Url;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000")?)
        .ws_endpoint(Some(Url::parse("ws://localhost:3001")?))
        .build();

    let ws_client = client.websocket().await?;
    let manager = SubscriptionManager::new(ws_client);

    // Create subscription handles that auto-cleanup when dropped
    {
        let pubkey = Pubkey::new("ta1234...".to_string())?;
        let account_handle = manager.subscribe_account(&pubkey, None).await?;
        
        // Use the subscription...
        while let Some(notification) = account_handle.next_notification().await? {
            println!("Account notification: {:?}", notification);
            break; // Just get one notification for demo
        }
    } // Handle automatically unsubscribes when dropped

    println!("Subscription cleaned up automatically");
    Ok(())
}
```

## Client Configuration

The client can be configured using the builder pattern:

```rust
use thru_rpc_client::Client;
use url::Url;
use std::time::Duration;

let client = Client::builder()
    .http_endpoint(Url::parse("https://mainnet.thru.io")?)
    .ws_endpoint(Some(Url::parse("wss://mainnet.thru.io/ws")?))
    .timeout(Duration::from_secs(30))
    .max_connections(100)
    .ws_reconnect_attempts(5)
    .ws_reconnect_delay(Duration::from_secs(2))
    .auth_token(Some("your-auth-token".to_string()))
    .build();
```

### Configuration Options

- `http_endpoint`: HTTP RPC endpoint URL
- `ws_endpoint`: WebSocket endpoint URL (optional)
- `timeout`: Request timeout duration
- `max_connections`: Maximum concurrent connections
- `ws_reconnect_attempts`: Number of WebSocket reconnection attempts
- `ws_reconnect_delay`: Delay between reconnection attempts
- `auth_token`: Optional authorization token for HTTP requests (sent as Bearer token)

## Authentication

If your Thru node requires authentication, you can configure an authorization token:

```rust
use thru_rpc_client::Client;
use url::Url;

let client = Client::builder()
    .http_endpoint(Url::parse("https://private.thru.io")?)
    .auth_token(Some("your-bearer-token".to_string()))
    .build();

// All HTTP requests will now include: Authorization: Bearer your-bearer-token
let version = client.get_version().await?;
```

The auth token is sent as a Bearer token in the Authorization header for all HTTP requests and WebSocket connections.

## WebSocket Authentication

WebSocket connections also support authentication using the same `auth_token` configuration:

```rust
use thru_rpc_client::Client;
use url::Url;

let client = Client::builder()
    .http_endpoint(Url::parse("https://private.thru.io")?)
    .ws_endpoint(Some(Url::parse("wss://private.thru.io/ws")?))
    .auth_token(Some("your-bearer-token".to_string()))
    .build();

// WebSocket connection will include: Authorization: Bearer your-bearer-token
let subscription_id = client.account_subscribe("ta...").await?;
```

## HTTP RPC Methods

The client supports all Thru RPC methods:

### Transaction Methods
- `send_transaction(transaction: &[u8])` - Submit a transaction
- `get_transaction_raw(signature: &Signature)` - Get raw transaction data
- `get_transaction_detailed(signature: &Signature)` - Get detailed transaction info

### Account Methods
- `get_balance(pubkey: &Pubkey)` - Get account balance
- `get_account_info(pubkey: &Pubkey, config: Option<AccountInfoConfig>)` - Get account information

### Blockchain Methods
- `get_block_height()` - Get current block height
- `get_block_raw(slot: u64)` - Get raw block data
- `get_version()` - Get node version information

## WebSocket Subscriptions

### Account Subscriptions
Monitor changes to specific accounts:

```rust
let mut notifications = ws_client.account_subscribe(&pubkey, None).await?;
while let Some(notification) = notifications.recv().await {
    println!("Account {} updated", notification.value.pubkey);
}
```

### Signature Subscriptions
Track transaction confirmation status:

```rust
let mut notifications = ws_client.signature_subscribe(&signature, None).await?;
while let Some(notification) = notifications.recv().await {
    match notification.value {
        SignatureStatus::Confirmed { .. } => println!("Transaction confirmed!"),
        SignatureStatus::Finalized { .. } => println!("Transaction finalized!"),
        SignatureStatus::Failed { .. } => println!("Transaction failed"),
    }
}
```

### Slot Subscriptions
Monitor blockchain slot updates:

```rust
let mut notifications = ws_client.slot_subscribe().await?;
while let Some(notification) = notifications.recv().await {
    println!("New slot: {}", notification.slot);
}
```

## Types and Encoding

### Pubkey
Public keys are 46-character strings starting with "ta" using custom base64-url encoding with checksum:

```rust
let pubkey = Pubkey::new("ta1234abcd...".to_string())?;
let bytes = pubkey.to_bytes()?; // Convert to [u8; 32]
let pubkey2 = Pubkey::from_bytes(&bytes); // Create from bytes
```

### Signature
Signatures are 90-character strings starting with "ts" using custom base64-url encoding with checksum:

```rust
let signature = Signature::new("ts1234abcd...".to_string())?;
let bytes = signature.to_bytes()?; // Convert to [u8; 64]
let signature2 = Signature::from_bytes(&bytes); // Create from bytes
```

## Error Handling

The client provides comprehensive error types:

```rust
use thru_rpc_client::{ThruError, ValidationError};

match client.get_balance(&pubkey).await {
    Ok(balance) => println!("Balance: {}", balance),
    Err(ThruError::Http(http_err)) => println!("HTTP error: {}", http_err),
    Err(ThruError::WebSocket(ws_err)) => println!("WebSocket error: {}", ws_err),
    Err(ThruError::Validation(ValidationError::InvalidPubkey(msg))) => {
        println!("Invalid pubkey: {}", msg);
    }
    Err(ThruError::Timeout(duration)) => {
        println!("Request timed out after {:?}", duration);
    }
    Err(e) => println!("Other error: {}", e),
}
```

### Error Categories
- `ValidationError`: Input validation failures
- `HttpError`: HTTP request/response errors
- `WebSocketError`: WebSocket connection/message errors
- `ConnectionError`: Network connection issues
- `SerializationError`: JSON/binary serialization failures
- `SubscriptionError`: Subscription management errors

## Examples

The `examples/` directory contains comprehensive examples:

- `basic_http_client.rs` - Basic HTTP RPC usage
- `websocket_subscriptions.rs` - WebSocket subscription examples
- `subscription_handles.rs` - RAII subscription management

Run examples with:

```bash
cargo run --example basic_http_client
cargo run --example websocket_subscriptions
cargo run --example subscription_handles
```

## Testing

Run the test suite:

```bash
# Unit tests
cargo test --lib

# Integration tests
cargo test --test integration_tests

# All tests
cargo test
```

## Requirements

- Rust 1.70+
- Tokio runtime
- Access to a Thru node with RPC and WebSocket endpoints

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Changelog

### 0.1.0
- Initial release
- HTTP RPC client with all Thru methods
- WebSocket client with subscription support
- RAII subscription handles
- Comprehensive error handling
- Full async/await support
- Proper Thru encoding validation 