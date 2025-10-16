//! Basic HTTP Client Example
//!
//! This example demonstrates how to use the Thru RPC client for basic HTTP operations.
//! It shows how to:
//! - Create and configure a client
//! - Send transactions
//! - Query account information and balances
//! - Retrieve transaction details
//! - Get blockchain information

use std::time::Duration;
use thru_base::{tn_tools::KeyPair, txn_tools::TransactionBuilder};
use thru_rpc_client::{Client, Pubkey, Result};
use url::Url;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging (optional - comment out if not needed)
    // tracing_subscriber::init();

    println!("🚀 Thru RPC Client - Basic HTTP Example");
    println!("========================================");

    // Create a client with custom configuration
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:8080/api").unwrap())
        .timeout(Duration::from_secs(30))
        .max_connections(50)
        .auth_token(None) // Add your auth token here if needed
        .build();

    println!("✅ Client created and configured");

    // Example 1: Get version information
    println!("\n📋 Getting version information...");
    match client.get_version().await {
        Ok(version) => println!(
            "   Version: {} (Node: {})",
            version.thru_rpc, version.thru_node
        ),
        Err(e) => println!("   Error: {}", e),
    }

    let bob = KeyPair::from_hex_private_key(
        "bob",
        "4444444444444444444444444444444444444444444444444444444444444444",
    )
    .unwrap();
    let alice = KeyPair::from_hex_private_key(
        "alice",
        "3333333333333333333333333333333333333333333333333333333333333333",
    )
    .unwrap();

    // Example 2: Get current block height
    println!("\n📏 Getting current block height...");
    match client.get_block_height().await {
        Ok(height) => println!(
            "   Block height: Finalized: {}, Executed: {}",
            height.finalized_height, height.executed_height
        ),
        Err(e) => println!("   Error: {}", e),
    }

    // Example 3: Create a test account and get balance
    println!("\n💰 Getting account balance...");

    match client.get_balance(&bob.address_string).await {
        Ok(balance) => println!("   Balance: {}", balance),
        Err(e) => println!("   Error: {}", e),
    }

    // Example 4: Get account information
    println!("\n📄 Getting account information...");
    let mut bob_nonce: u64 = 0;
    match client.get_account_info(&bob.address_string, None).await {
        Ok(Some(account)) => {
            println!("   Bob account:");
            println!("     Balance: {}", account.balance);
            println!("     Owner: {}", account.owner);
            println!("     Program: {}", account.program);
            println!("     Data size: {} bytes", account.data_size);
            println!("     Nonce: {}", account.nonce);
            bob_nonce = account.nonce;
        }
        Ok(None) => println!("   Bob account not found"),
        Err(e) => println!("   Error: {}", e),
    }

    // Example 5: Send a transaction (commented out as it requires valid transaction data)
    println!("\n📤 Sending transaction...");
    let mut transaction = TransactionBuilder::build_transfer(
        bob.public_key,
        [0u8; 32], // System program (all zeros)
        alice.public_key,
        2,
        1,
        bob_nonce,
        1, // start_slot
    )
    .map_err(|e| thru_rpc_client::error::ThruError::Configuration(e.to_string()))?;
    transaction = transaction
        .with_compute_units(1000000)
        .with_state_units(10000)
        .with_memory_units(10000)
        .with_expiry_after(1000000);

    // Sign transaction
    transaction.sign(&bob.private_key).map_err(|e| {
        thru_rpc_client::error::ThruError::Configuration(format!(
            "Failed to sign transaction: {}",
            e
        ))
    })?;

    // Serialize and encode
    let wire_data = transaction.to_wire();

    let signature = client.send_transaction(&wire_data).await?;
    let mut slot = 1;
    for _i in 0..10 {
        match client.get_transaction_detailed(&signature).await {
            Ok(Some(tx_details)) => {
                println!("   Transaction found:");
                println!("     Signature: {}", tx_details.signature.as_str());
                println!(
                    "     Compute units consumed: {}",
                    tx_details.compute_units_consumed
                );
                println!("     Execution result: {}", tx_details.execution_result);
                println!("     Events count: {}", tx_details.events_cnt);
                slot = tx_details.slot;
                break;
            }
            Ok(None) => println!("   Transaction not found"),
            Err(e) => println!("   Error: {}", e),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    println!("\n📏 Getting current block height...");
    match client.get_block_height().await {
        Ok(height) => println!(
            "   Block height: Finalized: {}, Executed: {}",
            height.finalized_height, height.executed_height
        ),
        Err(e) => println!("   Error: {}", e),
    }

    // Example 6: Get raw block data
    println!("\n📦 Getting raw block data...");
    match client.get_block_raw(slot).await {
        Ok(Some(block_data)) => {
            println!("   Block data retrieved: {} bytes", block_data.len());
        }
        Ok(None) => println!("   Block not found"),
        Err(e) => println!("   Error: {}", e),
    }

    let tx_raw = client.get_transaction_raw(&signature).await?;
    println!("   Transaction raw: {:?}", tx_raw);
    let tx_details = client.get_transaction_detailed(&signature).await?;
    println!("   Transaction details: {:?}", tx_details);

    // Example 7: Query transaction (if you have a signature)
    println!("\n🔍 Querying transaction details...");

    println!("\n✨ HTTP client example completed!");
    println!("\n💡 Tips:");
    println!("   - Always handle errors appropriately in production code");
    println!("   - Use proper Thru addresses starting with 'ta' for pubkeys");
    println!("   - Use proper Thru signatures starting with 'ts' for signatures");
    println!("   - Configure timeouts and connection limits based on your needs");
    println!("   - Consider using the WebSocket client for real-time updates");

    Ok(())
}

/// Helper function to demonstrate error handling patterns
#[allow(dead_code)]
async fn demonstrate_error_handling() -> Result<()> {
    println!("\n🛡️  Error Handling Examples:");

    // Example 1: Invalid pubkey format
    match Pubkey::new("invalid_pubkey".to_string()) {
        Ok(_) => println!("   Unexpected: Invalid pubkey was accepted"),
        Err(e) => println!("   ✅ Invalid pubkey rejected: {}", e),
    }

    // Example 2: Network timeout handling
    let quick_client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .timeout(Duration::from_millis(1)) // Very short timeout
        .build();

    match quick_client.get_version().await {
        Ok(_) => println!("   Unexpected: Request succeeded with 1ms timeout"),
        Err(e) => println!("   ✅ Timeout handled gracefully: {}", e),
    }

    Ok(())
}

/// Helper function to demonstrate advanced client configuration
#[allow(dead_code)]
fn demonstrate_client_configuration() {
    println!("\n⚙️  Advanced Client Configuration:");

    let _advanced_client = Client::builder()
        .http_endpoint(Url::parse("https://mainnet.thru.io").unwrap())
        .timeout(Duration::from_secs(60))
        .max_connections(100)
        .auth_token(Some("your-auth-token".to_string()))
        .build();

    println!("   ✅ Client configured for production use");
    println!("   - HTTPS endpoint for security");
    println!("   - 60-second timeout for reliability");
    println!("   - 100 max connections for performance");
    println!("   - Authorization token for authenticated requests");
}

/// Helper function to demonstrate WebSocket authentication configuration
#[allow(dead_code)]
fn demonstrate_websocket_auth_config() {
    println!("\n🔐 WebSocket with Authentication:");

    let _ws_client = Client::builder()
        .http_endpoint(Url::parse("https://mainnet.thru.io").unwrap())
        .ws_endpoint(Some(Url::parse("wss://mainnet.thru.io/ws").unwrap()))
        .auth_token(Some("your-bearer-token".to_string()))
        .build();

    println!("   ✅ WebSocket client configured with authentication");
    println!("   - HTTPS/WSS endpoints for secure connections");
    println!("   - Bearer token sent in Authorization header");
    println!("   - Works for both HTTP RPC and WebSocket subscriptions");
    println!("   - Example usage:");
    println!("     // All these calls will include authentication:");
    println!("     // client.get_version().await");
    println!("     // client.account_subscribe(\"ta...\").await");
}
