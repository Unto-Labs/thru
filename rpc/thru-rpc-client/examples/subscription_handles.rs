//! Subscription Handles Example
//!
//! This example demonstrates the handle-based subscription system which provides
//! RAII-style automatic cleanup and easier subscription management.
//! It shows how to:
//! - Use subscription handles for automatic cleanup
//! - Manage multiple subscriptions with SubscriptionManager
//! - Handle subscription lifecycle properly
//! - Use convenient subscription methods

use std::time::Duration;
use thru_base::TransactionBuilder;
use thru_base::tn_tools::KeyPair;
use thru_rpc_client::websocket::{SubscriptionHandle, SubscriptionManager};
use thru_rpc_client::{Client, Pubkey, Result};
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

    println!("🎯 Thru RPC Client - Subscription Handles Example");
    println!("=================================================");

    // Create a client with WebSocket support
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:8080/api").unwrap())
        .ws_endpoint(Some(Url::parse("ws://localhost:8080/ws").unwrap()))
        .timeout(Duration::from_secs(30))
        .ws_reconnect_attempts(5)
        .ws_reconnect_delay(Duration::from_secs(2))
        .build();

    println!("✅ Client created with WebSocket support");

    // Get WebSocket client and create subscription manager
    println!("\n🔌 Connecting to WebSocket and creating subscription manager...");
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

    let subscription_manager = SubscriptionManager::new(ws_client);
    println!("✅ Subscription manager created");

    // Example 1: Account subscription with handle
    println!("\n👤 Creating account subscription handle...");
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

    let mut account_handle = match subscription_manager
        .subscribe_account(&bob.address_string, None)
        .await
    {
        Ok(handle) => {
            println!(
                "✅ Account subscription created (ID: {})",
                handle.subscription_id()
            );
            handle
        }
        Err(e) => {
            println!("❌ Failed to create account subscription: {}", e);
            return Ok(());
        }
    };
    let bob_nonce = if let Some(account_data) = account_handle.next_notification().await {
        account_data.value.nonce
    } else {
        println!("❌ Failed to get account data");
        return Ok(());
    };
    println!("Bob nonce: {}", bob_nonce);
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

    // Example 2: Signature subscription with handle
    println!("\n📝 Creating signature subscription handle...");
    let mut signature_handle = match subscription_manager
        .subscribe_signature(&signature, None)
        .await
    {
        Ok(handle) => {
            println!(
                "✅ Signature subscription created (ID: {})",
                handle.subscription_id()
            );
            handle
        }
        Err(e) => {
            println!("❌ Failed to create signature subscription: {}", e);
            return Ok(());
        }
    };

    // Example 3: Slot subscription with handle
    println!("\n📡 Creating slot subscription handle...");
    let mut slot_handle = match subscription_manager.subscribe_slots().await {
        Ok(handle) => {
            println!(
                "✅ Slot subscription created (ID: {})",
                handle.subscription_id()
            );
            handle
        }
        Err(e) => {
            println!("❌ Failed to create slot subscription: {}", e);
            return Ok(());
        }
    };

    // Example 4: Check subscription manager status
    println!("\n📊 Subscription manager status:");
    println!(
        "   Active subscriptions: {}",
        subscription_manager.active_count().await
    );

    let ws_client_2 = match client.websocket().await {
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
    println!("\n📤 Sending transaction...");
    let (signature, _subscription_rx) = ws_client_2
        .send_transaction(&transaction.to_wire(), None)
        .await?;
    println!("✅ Transaction sent! Signature: {}", signature.as_str());

    // Example 5: Listen for notifications using handles
    println!("\n👂 Listening for notifications using handles (5 seconds)...");
    let start_time = std::time::Instant::now();
    let mut notification_count = 0;

    while start_time.elapsed() < Duration::from_secs(5) {
        tokio::select! {
            // Handle account notifications
            account_notification = account_handle.next_notification() => {
                if let Some(data) = account_notification {
                    notification_count += 1;
                    println!("   👤 Account notification #{}: {:?}", notification_count, data);
                }
            }

            // Handle signature notifications with timeout
            signature_result = signature_handle.wait_for_confirmation(Duration::from_millis(100)) => {
                match signature_result {
                    Ok(Some(data)) => {
                        notification_count += 1;
                        println!("   📝 Signature confirmed #{}: {:?}", notification_count, data);
                    }
                    Ok(None) => {
                        // No notification received
                    }
                    Err(_) => {
                        // Timeout - this is expected in this example
                    }
                }
            }

            // Handle slot notifications (get multiple at once)
            _ = tokio::time::sleep(Duration::from_millis(200)) => {
                let slot_notifications = slot_handle.next_notifications(5).await;
                if !slot_notifications.is_empty() {
                    notification_count += slot_notifications.len();
                    println!("   📡 Received {} slot notifications", slot_notifications.len());
                }
            }
        }
    }

    println!(
        "\n📊 Received {} notifications in 5 seconds",
        notification_count
    );

    // Example 6: Manual subscription management
    println!("\n🔧 Demonstrating manual subscription management...");

    // Check if subscriptions are still active
    println!(
        "   Account subscription active: {}",
        account_handle.is_active()
    );
    println!(
        "   Signature subscription active: {}",
        signature_handle.is_active()
    );
    println!("   Slot subscription active: {}", slot_handle.is_active());

    // Manually unsubscribe one subscription
    println!("\n🗑️  Manually unsubscribing account subscription...");
    match account_handle.unsubscribe().await {
        Ok(success) => {
            if success {
                println!("✅ Account subscription unsubscribed successfully");
            } else {
                println!("⚠️  Account subscription was already inactive");
            }
        }
        Err(e) => println!("❌ Failed to unsubscribe: {}", e),
    }

    println!(
        "   Account subscription active: {}",
        account_handle.is_active()
    );

    // Example 7: Automatic cleanup demonstration
    println!("\n🧹 Demonstrating automatic cleanup...");
    println!(
        "   Active subscriptions before cleanup: {}",
        subscription_manager.active_count().await
    );

    // Drop handles to trigger automatic cleanup
    drop(signature_handle);
    drop(slot_handle);

    println!("✅ Subscription handles dropped - automatic cleanup triggered");

    // Example 8: Bulk operations
    println!("\n📦 Demonstrating bulk subscription management...");

    // Create multiple subscriptions
    let account1 = Pubkey::new("taoJql9HpnWYAv-VX43C0qFKXJnSO-l_hkEn_5ODRVpPAH".to_string())?;
    let account2 = Pubkey::new("taF8t5-ytBIPKx7GXkGY1uCLKOgT_rAeSkAIObheGAgM6c".to_string())?;

    let _handle1 = subscription_manager
        .subscribe_account(&account1, None)
        .await?;
    let _handle2 = subscription_manager
        .subscribe_account(&account2, None)
        .await?;
    let _handle3 = subscription_manager.subscribe_slots().await?;

    println!("✅ Created 3 additional subscriptions");
    println!(
        "   Total active subscriptions: {}",
        subscription_manager.active_count().await
    );

    // Unsubscribe all at once
    let unsubscribed_count = subscription_manager.unsubscribe_all().await?;
    println!(
        "✅ Unsubscribed {} subscriptions in bulk",
        unsubscribed_count
    );
    println!(
        "   Remaining active subscriptions: {}",
        subscription_manager.active_count().await
    );

    println!("\n✨ Subscription handles example completed!");
    println!("\n💡 Key Benefits of Handle-Based Subscriptions:");
    println!("   - Automatic cleanup when handles are dropped");
    println!("   - Type-safe subscription management");
    println!("   - Convenient methods for common operations");
    println!("   - Centralized subscription tracking");
    println!("   - Easy bulk operations");

    Ok(())
}

/// Demonstrate advanced handle patterns
#[allow(dead_code)]
async fn demonstrate_advanced_patterns(subscription_manager: &SubscriptionManager) -> Result<()> {
    println!("\n🚀 Advanced Handle Patterns:");

    // Pattern 1: Scoped subscriptions
    {
        let account = Pubkey::new("ta1111111111111111111111111111111111111111111111".to_string())?;
        let _handle = subscription_manager
            .subscribe_account(&account, None)
            .await?;
        println!("   ✅ Subscription created in scope");
        // Handle automatically cleaned up when scope ends
    }
    println!("   ✅ Subscription automatically cleaned up when scope ended");

    // Pattern 2: Conditional subscriptions
    let should_monitor_account = true;
    let mut optional_handle = None;

    if should_monitor_account {
        let account = Pubkey::new("ta3333333333333333333333333333333333333333333333".to_string())?;
        optional_handle = Some(
            subscription_manager
                .subscribe_account(&account, None)
                .await?,
        );
        println!("   ✅ Conditional subscription created");
    }

    // Pattern 3: Handle storage in collections
    let mut handles = Vec::new();
    for i in 1..=3 {
        let account_str = format!("ta{:044}", i);
        let account = Pubkey::new(account_str)?;
        let handle = subscription_manager
            .subscribe_account(&account, None)
            .await?;
        handles.push(handle);
    }
    println!(
        "   ✅ Created {} subscriptions in collection",
        handles.len()
    );

    Ok(())
}
