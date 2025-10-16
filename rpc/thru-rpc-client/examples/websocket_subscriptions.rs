//! WebSocket Subscriptions Example
//!
//! This example demonstrates how to use the Thru RPC client for real-time WebSocket subscriptions.
//! It shows how to:
//! - Connect to WebSocket endpoint
//! - Subscribe to account changes
//! - Subscribe to signature status updates
//! - Subscribe to slot updates
//! - Handle subscription notifications
//! - Manage subscription lifecycle

use std::time::Duration;
use thru_base::rpc_types::ProgramAccountFilter;
use thru_base::tn_tools::KeyPair;
use thru_base::txn_tools::TransactionBuilder;
use thru_rpc_client::types::{
    BlockSubscriptionConfig, CommitmentLevel, EventSubscriptionConfig, ProgramSubscriptionConfig,
    SendTransactionConfig,
};
use thru_rpc_client::{Client, Pubkey, Result};
use tokio::time::sleep;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use url::Url;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize the tracing subscriber.
    // EnvFilter::from_default_env() reads the RUST_LOG environment variable.
    tracing_subscriber::registry()
        .with(fmt::layer()) // Add a formatter layer for console output
        .with(EnvFilter::from_default_env()) // Add the environment filter layer
        .init();

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

    // Initialize logging to see connection details (optional)
    // tracing_subscriber::init();

    println!("🌐 Thru RPC Client - WebSocket Subscriptions Example");
    println!("===================================================");

    // Create a client with WebSocket endpoint configured
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:8080/api").unwrap())
        .ws_endpoint(Some(Url::parse("ws://localhost:8080/ws").unwrap()))
        .timeout(Duration::from_secs(3))
        .ws_reconnect_attempts(5)
        .ws_reconnect_delay(Duration::from_secs(2))
        .build();

    println!("✅ Client created with WebSocket support");

    // Get the WebSocket client (this will establish the connection)
    println!("\n🔌 Connecting to WebSocket...");
    let ws_client = match client.websocket().await {
        Ok(ws) => {
            println!("✅ WebSocket connection established");
            ws
        }
        Err(e) => {
            println!("❌ Failed to connect to WebSocket: {}", e);
            println!("💡 Make sure the Thru RPC server is running on ws://localhost:3001");
            return Ok(());
        }
    };

    // Example 1: Subscribe to slot updates
    println!("\n📡 Subscribing to slot updates...");
    let (slot_subscription_id, mut slot_notifications) = match ws_client.slot_subscribe().await {
        Ok((subscription_id, rx)) => {
            println!("✅ Subscribed to slot updates (ID: {})", subscription_id);
            (subscription_id, rx)
        }
        Err(e) => {
            println!("❌ Failed to subscribe to slots: {}", e);
            return Ok(());
        }
    };

    // Example: Block Raw Subscription
    println!("\n📦 Testing blockRawSubscribe...");
    let block_config = BlockSubscriptionConfig {
        mentions_account: Some(bob.address_string.to_string()),
        blocks_producer: None,
    };

    let (subscription_id, mut block_raw_rx) =
        ws_client.block_raw_subscribe(Some(block_config)).await?;

    println!(
        "✅ Block raw subscription created with ID: {}",
        subscription_id
    );

    // Example: Block Summary Subscription
    println!("\n📋 Testing blockSummarySubscribe...");
    let (summary_id, mut block_summary_rx) = ws_client.block_summary_subscribe(None).await?;

    println!(
        "✅ Block summary subscription created with ID: {}",
        summary_id
    );

    // Example: Program Subscription
    println!("\n🔧 Testing programSubscribe...");
    let program_config = ProgramSubscriptionConfig {
        program_id: bob.address_string.to_string(),
        data_slice: None,
        filters: Some(vec![ProgramAccountFilter::DataSize { data_size: 80 }]),
    };

    let (program_id, mut program_rx) = ws_client.program_subscribe(program_config).await?;

    println!("✅ Program subscription created with ID: {}", program_id);

    // Example: Subscribe to account changes
    println!("\n👤 Subscribing to account changes...");

    let (account_subscription_id, mut account_notifications) =
        match ws_client.account_subscribe(&bob.address_string, None).await {
            Ok((subscription_id, rx)) => {
                println!(
                    "✅ Subscribed to account changes for {} (ID: {})",
                    bob.address_string.as_str(),
                    subscription_id
                );
                (subscription_id, rx)
            }
            Err(e) => {
                println!("❌ Failed to subscribe to account: {}", e);
                return Ok(());
            }
        };
    let mut bob_nonce: u64 = 0;
    // server should have sent initial notification with current account info
    let account_notification = account_notifications.recv().await;
    if let Some(account_data) = account_notification {
        println!("✅ Account update: {:?}", account_data);
        bob_nonce = account_data.value.nonce;
    }

    // Example 3: Subscribe to signature status
    println!("\n📝 Subscribing to signature status...");
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
    let signature = transaction.get_signature().unwrap();

    // Example: Events Subscription
    println!("\n🎯 Testing eventsSubscribe...");
    let events_config = EventSubscriptionConfig {
        signatures: Some(vec![signature.as_str().to_string()]),
        programs: Some(vec![bob.address_string.to_string()]),
        starts_with_bytes: None,
    };

    let (events_id, mut events_rx) = ws_client.events_subscribe(Some(events_config)).await?;

    println!("✅ Events subscription created with ID: {}", events_id);

    let all_events_config = EventSubscriptionConfig {
        signatures: None,
        programs: None,
        starts_with_bytes: None,
    };

    let (all_events_id, mut all_events_rx) =
        ws_client.events_subscribe(Some(all_events_config)).await?;

    println!(
        "✅ All events subscription created with ID: {}",
        all_events_id
    );

    let (signature_subscription_id, mut signature_notifications) =
        match ws_client.signature_subscribe(&signature, None).await {
            Ok((subscription_id, rx)) => {
                println!(
                    "✅ Subscribed to signature status for {} (ID: {})",
                    signature.as_str(),
                    subscription_id
                );
                (subscription_id, rx)
            }
            Err(e) => {
                println!("❌ Failed to subscribe to signature: {}", e);
                return Ok(());
            }
        };
    // Example 4: Send transaction
    println!("\n📤 Sending transaction...");
    let (signature, _subscription_rx) = ws_client
        .send_transaction(&transaction.to_wire(), None)
        .await?;
    println!("✅ Transaction sent! Signature: {}", signature.as_str());

    // Example 4: Listen for notifications
    println!("\n👂 Listening for notifications (5 seconds)...");
    println!(
        "   (In a real application, you would handle these notifications in your business logic)"
    );

    let mut notification_count = 0;
    let start_time = std::time::Instant::now();

    while start_time.elapsed() < Duration::from_secs(5) {
        tokio::select! {
            // Handle block raw notifications
            notification = block_raw_rx.recv() => {
                notification_count += 1;
                tracing::info!("Received block raw notification: {:?}", notification);
                if let Some(notification) = notification {
                    println!("📦 Received block raw notification: slot {} bytes: {}", notification.context.slot, notification.value.block.len() );
                }
            }
            notification = block_summary_rx.recv() => {
                notification_count += 1;
                tracing::info!("Received block summary notification: {:?}", notification);
                if let Some(notification) = notification {
                    println!("📋 Received block summary notification: slot {}, transactions: {}",
                             notification.value.slot, notification.value.block.transactions);
                }
            }
            notification = events_rx.recv() => {
                notification_count += 1;
                if let Some(notification) = notification {
                    println!("🎯 Received event notification: signature {}, count: {}",
                             notification.value.signature, notification.value.count);
                }
            }
            notification = all_events_rx.recv() => {
                notification_count += 1;
                if let Some(notification) = notification {
                    println!("🎯 Received all events notification: signature {}, count: {}",
                             notification.value.signature, notification.value.count);
                    for event in notification.value.events {
                        println!("🎯 Event: call_idx {}, program_idx {}, data size {}",
                                 event.call_idx, event.program_idx, event.data.len());
                    }
                }
            }
            notification = program_rx.recv() => {
                notification_count += 1;
                if let Some(notification) = notification {
                    println!("🔧 Received program notification: account {}", notification.value.pubkey);
                }
            }
            // Handle slot notifications
            slot_notification = slot_notifications.recv() => {
                if let Some(slot_data) = slot_notification {
                    notification_count += 1;
                    println!("   📡 Slot update #{}: {:?}", notification_count, slot_data);
                }
            }

            // Handle account notifications
            account_notification = account_notifications.recv() => {
                if let Some(account_data) = account_notification {
                    notification_count += 1;
                    println!("   👤 Account update #{}: {:?}", notification_count, account_data);
                    bob_nonce = account_data.value.nonce;
                }
            }

            // Handle signature notifications
            signature_notification = signature_notifications.recv() => {
                if let Some(signature_data) = signature_notification {
                    notification_count += 1;
                    println!("   📝 Signature update #{}: {:?}", notification_count, signature_data);
                }
            }

            // Timeout to prevent infinite waiting
            _ = sleep(Duration::from_millis(100)) => {
                // Continue the loop
            }
        }
    }

    println!(
        "\n📊 Received {} notifications in 5 seconds",
        notification_count
    );
    transaction = transaction.with_nonce(bob_nonce);
    // Sign transaction
    transaction.sign(&bob.private_key).map_err(|e| {
        thru_rpc_client::error::ThruError::Configuration(format!(
            "Failed to sign transaction: {}",
            e
        ))
    })?;

    // Example 5: Send transaction with automatic subscription
    println!("\n📤 Sending transaction with automatic subscription...");
    let config = Some(SendTransactionConfig {
        signature_notification: Some(CommitmentLevel::Executed),
    });

    let (signature, auto_subscription_rx) = ws_client
        .send_transaction(&transaction.to_wire(), config)
        .await?;
    println!(
        "✅ Transaction sent with auto-subscription! Signature: {}",
        signature.as_str()
    );

    if let Some(mut auto_rx) = auto_subscription_rx {
        println!("✅ Auto-subscription created, waiting for signature notification...");
        // Wait for signature notification with timeout
        let notification_result =
            tokio::time::timeout(Duration::from_secs(5), auto_rx.recv()).await;

        match notification_result {
            Ok(Some(notification)) => {
                println!("✅ Received signature notification: {:?}", notification);
            }
            Ok(None) => {
                println!("❌ Auto-subscription channel closed");
            }
            Err(_) => {
                println!("⏰ Timeout waiting for signature notification");
            }
        }
        let notification_result =
            tokio::time::timeout(Duration::from_secs(5), auto_rx.recv()).await;

        match notification_result {
            Ok(Some(notification)) => {
                println!("✅ Received signature notification: {:?}", notification);
            }
            Ok(None) => {
                println!("❌ Auto-subscription channel closed");
            }
            Err(_) => {
                println!("⏰ Timeout waiting for signature notification");
            }
        }
    } else {
        println!("ℹ️  No auto-subscription created");
    }

    // Example 6: Demonstrate subscription cleanup
    println!("\n🧹 Cleaning up subscriptions...");

    // Example: Unsubscribe from specific subscriptions using the subscription IDs
    println!(
        "   🔓 Unsubscribing from slot updates (ID: {})...",
        slot_subscription_id
    );
    match ws_client.slot_unsubscribe(slot_subscription_id).await {
        Ok(true) => println!("   ✅ Successfully unsubscribed from slot updates"),
        Ok(false) => println!("   ⚠️  Slot subscription was not active"),
        Err(e) => println!("   ❌ Failed to unsubscribe from slots: {}", e),
    }

    println!(
        "   🔓 Unsubscribing from account updates (ID: {})...",
        account_subscription_id
    );
    match ws_client.account_unsubscribe(account_subscription_id).await {
        Ok(true) => println!("   ✅ Successfully unsubscribed from account updates"),
        Ok(false) => println!("   ⚠️  Account subscription was not active"),
        Err(e) => println!("   ❌ Failed to unsubscribe from account: {}", e),
    }

    println!(
        "   🔓 Unsubscribing from signature updates (ID: {})...",
        signature_subscription_id
    );
    match ws_client
        .signature_unsubscribe(signature_subscription_id)
        .await
    {
        Ok(true) => println!("   ✅ Successfully unsubscribed from signature updates"),
        Ok(false) => println!("   ⚠️  Signature subscription was not active"),
        Err(e) => println!("   ❌ Failed to unsubscribe from signature: {}", e),
    }

    println!("✅ Explicit subscription cleanup completed");

    println!("\n✨ WebSocket subscriptions example completed!");
    println!("\n💡 Tips:");
    println!("   - Always handle subscription errors gracefully");
    println!("   - Store subscription IDs if you need to unsubscribe later");
    println!("   - Use tokio::select! to handle multiple subscription streams");
    println!("   - Consider implementing reconnection logic for production use");
    println!("   - Monitor subscription health and recreate if needed");

    Ok(())
}

/// Example of advanced subscription management
#[allow(dead_code)]
async fn demonstrate_subscription_management(client: &Client) -> Result<()> {
    println!("\n🔧 Advanced Subscription Management:");

    let ws_client = client.websocket().await?;

    // Create multiple subscriptions
    let account1 = Pubkey::new("ta1111111111111111111111111111111111111111111111".to_string())?;
    let account2 = Pubkey::new("ta2222222222222222222222222222222222222222222222".to_string())?;

    let _sub1 = ws_client.account_subscribe(&account1, None).await?;
    let _sub2 = ws_client.account_subscribe(&account2, None).await?;

    println!("   ✅ Created multiple subscriptions");

    // In a real application, you would:
    // 1. Store subscription IDs
    // 2. Monitor subscription health
    // 3. Implement error recovery
    // 4. Clean up subscriptions when done

    Ok(())
}

/// Example of error handling in subscriptions
#[allow(dead_code)]
async fn demonstrate_subscription_error_handling() {
    println!("\n🛡️  Subscription Error Handling:");

    // Example 1: Handle connection failures
    let bad_client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .ws_endpoint(Some(Url::parse("ws://invalid-host:9999").unwrap()))
        .timeout(Duration::from_secs(5))
        .build();

    match bad_client.websocket().await {
        Ok(_) => println!("   Unexpected: Connection to invalid host succeeded"),
        Err(e) => println!("   ✅ Connection error handled: {}", e),
    }

    // Example 2: Handle invalid subscription parameters
    // This would be demonstrated with actual invalid parameters
    println!("   ✅ Always validate subscription parameters before subscribing");
}
