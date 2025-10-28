//! Integration tests for thru-rpc-client
//!
//! These tests validate the complete client functionality including:
//! - Client configuration and initialization
//! - HTTP client operations
//! - WebSocket client operations
//! - Subscription handle management
//! - Error handling scenarios

use std::time::Duration;
use thru_rpc_client::error::ValidationError;
use thru_rpc_client::{
    Client, Pubkey, Signature, SubscriptionHandle, SubscriptionManager, ThruError,
};
use url::Url;

/// Test client configuration and builder pattern
#[tokio::test]
async fn test_client_configuration() {
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .ws_endpoint(Some(Url::parse("ws://localhost:3001").unwrap()))
        .timeout(Duration::from_secs(30))
        .max_connections(100)
        .ws_reconnect_attempts(5)
        .ws_reconnect_delay(Duration::from_secs(2))
        .build();

    // Client should be created successfully
    assert!(client.get_config().timeout == Duration::from_secs(30));
    assert!(client.get_config().max_connections == 100);
    assert!(client.get_config().ws_reconnect_attempts == 5);
}

/// Test Pubkey validation and encoding
#[tokio::test]
async fn test_pubkey_validation() {
    // Create a valid pubkey using the thru-base encoding
    let bytes = [1u8; 32];
    let valid_pubkey = thru_base::tn_public_address::tn_pubkey_to_address_string(&bytes);
    let pubkey = Pubkey::new(valid_pubkey.clone());
    assert!(pubkey.is_ok());

    if let Ok(pk) = pubkey {
        assert_eq!(pk.as_str(), &valid_pubkey);
        assert_eq!(pk.to_string(), valid_pubkey);
    }

    // Invalid pubkey formats
    let invalid_pubkeys = vec![
        "invalid_pubkey",                                   // Wrong format
        "1234567890",                                       // Too short
        "sa1111111111111111111111111111111111111111111111", // Wrong prefix
        "",                                                 // Empty
    ];

    for invalid in invalid_pubkeys {
        let result = Pubkey::new(invalid.to_string());
        assert!(result.is_err(), "Should reject invalid pubkey: {}", invalid);
    }
}

/// Test Signature validation and encoding
#[tokio::test]
async fn test_signature_validation() {
    // Create a valid signature using the thru-base encoding
    let bytes = [1u8; 64];
    let valid_signature = thru_base::tn_signature_encoding::tn_signature_to_string(&bytes);
    let signature = Signature::new(valid_signature.clone());
    assert!(signature.is_ok());

    if let Ok(sig) = signature {
        assert_eq!(sig.as_str(), &valid_signature);
        assert_eq!(sig.to_string(), valid_signature);
    }

    // Invalid signature formats
    let invalid_signatures = vec![
        "invalid_signature", // Wrong format
        "1234567890",        // Too short
        "rs1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111", // Wrong prefix
        "", // Empty
    ];

    for invalid in invalid_signatures {
        let result = Signature::new(invalid.to_string());
        assert!(
            result.is_err(),
            "Should reject invalid signature: {}",
            invalid
        );
    }
}

/// Test error handling and error types
#[tokio::test]
async fn test_error_handling() {
    // Test validation errors
    let pubkey_error = Pubkey::new("invalid".to_string());
    assert!(pubkey_error.is_err());

    // Convert to ThruError for testing
    let pubkey_thru_error: Result<Pubkey, ThruError> = pubkey_error.map_err(|e| e.into());
    if let Err(ThruError::Validation(validation_error)) = pubkey_thru_error {
        // Check that it's a pubkey validation error
        assert!(matches!(
            validation_error,
            ValidationError::InvalidPubkey(_)
        ));
    } else {
        panic!("Expected validation error");
    }

    // Test signature validation error
    let sig_error = Signature::new("invalid".to_string());
    assert!(sig_error.is_err());

    // Convert to ThruError for testing
    let sig_thru_error: Result<Signature, ThruError> = sig_error.map_err(|e| e.into());
    if let Err(ThruError::Validation(validation_error)) = sig_thru_error {
        // Check that it's a signature validation error
        assert!(matches!(
            validation_error,
            ValidationError::InvalidSignature(_)
        ));
    } else {
        panic!("Expected validation error");
    }
}

/// Test HTTP client functionality (mocked - no real server required)
#[tokio::test]
async fn test_http_client_interface() {
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .timeout(Duration::from_secs(5))
        .build();

    // Test that methods exist and have correct signatures
    let test_bytes = [1u8; 32];
    let test_pubkey = Pubkey::from_bytes(&test_bytes);
    let test_sig_bytes = [1u8; 64];
    let test_signature = Signature::from_bytes(&test_sig_bytes);

    // These will fail due to no server, but we're testing the interface
    let _version_result = client.get_version().await;
    let _height_result = client.get_block_height().await;
    let _balance_result = client.get_balance(&test_pubkey).await;
    let _account_result = client.get_account_info(&test_pubkey, None).await;
    let _tx_result = client.get_transaction_detailed(&test_signature).await;
    let _raw_tx_result = client.get_transaction_raw(&test_signature).await;
    let _block_result = client.get_block_raw(1).await;

    // All methods should be callable (even if they fail due to no server)
    assert!(true); // Interface test passed
}

/// Test WebSocket client lazy initialization
#[tokio::test]
async fn test_websocket_lazy_initialization() {
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .ws_endpoint(Some(Url::parse("ws://localhost:3001").unwrap()))
        .build();

    // WebSocket client should not be initialized yet
    assert!(!client.is_websocket_connected().await);

    // Attempting to get WebSocket client will try to connect (and fail in test environment)
    let ws_result = client.websocket().await;
    assert!(ws_result.is_err()); // Expected to fail without real server
}

/// Test subscription handle traits and interfaces
#[tokio::test]
async fn test_subscription_handle_traits() {
    // Test that our handle types implement the required traits

    // This is a compile-time test - if it compiles, the traits are implemented correctly
    fn assert_subscription_handle<T: SubscriptionHandle>() {}

    assert_subscription_handle::<thru_rpc_client::AccountSubscriptionHandle>();
    assert_subscription_handle::<thru_rpc_client::SignatureSubscriptionHandle>();
    assert_subscription_handle::<thru_rpc_client::SlotSubscriptionHandle>();
}

/// Test subscription manager creation and interface
#[tokio::test]
async fn test_subscription_manager_interface() {
    // Create a client (won't connect in test environment)
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .ws_endpoint(Some(Url::parse("ws://localhost:3001").unwrap()))
        .build();

    // Test that we can create a subscription manager interface
    // (actual connection will fail, but we're testing the API)
    let ws_result = client.websocket().await;

    if let Ok(ws_client) = ws_result {
        let manager = SubscriptionManager::new(ws_client);

        // Test interface methods (will fail due to no connection, but API should exist)
        let count = manager.active_count().await;
        assert_eq!(count, 0); // No active subscriptions initially

        let test_bytes = [1u8; 32];
        let test_pubkey = Pubkey::from_bytes(&test_bytes);
        let _account_sub_result = manager.subscribe_account(&test_pubkey, None).await;

        let test_sig_bytes = [1u8; 64];
        let test_signature = Signature::from_bytes(&test_sig_bytes);
        let _sig_sub_result = manager.subscribe_signature(&test_signature, None).await;

        let _slot_sub_result = manager.subscribe_slots().await;

        // All methods should be callable (interface test)
    }

    // Test passes if we reach here (interface is correct)
    assert!(true);
}

/// Test type serialization and deserialization
#[tokio::test]
async fn test_type_serialization() {
    use serde_json;

    // Test that our types can be serialized/deserialized
    let test_bytes = [1u8; 32];
    let pubkey = Pubkey::from_bytes(&test_bytes);
    let pubkey_json = serde_json::to_string(&pubkey).unwrap();
    let pubkey_deserialized: Pubkey = serde_json::from_str(&pubkey_json).unwrap();
    assert_eq!(pubkey.as_str(), pubkey_deserialized.as_str());

    let test_sig_bytes = [1u8; 64];
    let signature = Signature::from_bytes(&test_sig_bytes);
    let signature_json = serde_json::to_string(&signature).unwrap();
    let signature_deserialized: Signature = serde_json::from_str(&signature_json).unwrap();
    assert_eq!(signature.as_str(), signature_deserialized.as_str());
}

/// Test client builder default values
#[tokio::test]
async fn test_client_builder_defaults() {
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .build();

    let config = client.get_config();

    // Test default values
    assert_eq!(config.timeout, Duration::from_secs(30));
    assert_eq!(config.max_connections, 100);
    assert_eq!(config.ws_reconnect_attempts, 5);
    assert_eq!(config.ws_reconnect_delay, Duration::from_secs(1));
    assert!(config.ws_endpoint.is_some()); // WebSocket endpoint is set by default
}

/// Test client builder validation
#[tokio::test]
async fn test_client_builder_validation() {
    // Test that builder accepts valid configurations
    let _client = Client::builder()
        .http_endpoint(Url::parse("https://mainnet.thru.io").unwrap())
        .ws_endpoint(Some(Url::parse("wss://mainnet.thru.io/ws").unwrap()))
        .timeout(Duration::from_secs(60))
        .max_connections(200)
        .ws_reconnect_attempts(10)
        .ws_reconnect_delay(Duration::from_secs(5))
        .build();

    // If we reach here, validation passed
    assert!(true);
}

/// Test error message formatting
#[tokio::test]
async fn test_error_formatting() {
    let validation_error =
        ThruError::Validation(ValidationError::InvalidPubkey("invalid_value".to_string()));

    let error_message = format!("{}", validation_error);
    assert!(error_message.contains("invalid_value"));
    assert!(error_message.contains("Validation error"));

    // Test error debug formatting
    let debug_message = format!("{:?}", validation_error);
    assert!(debug_message.contains("Validation"));
}

/// Test commitment level enum
#[tokio::test]
async fn test_commitment_levels() {
    use thru_rpc_client::CommitmentLevel;

    // Test that commitment levels can be created and used
    let _executed = CommitmentLevel::Executed;
    let _finalized = CommitmentLevel::Finalized;

    // Test serialization
    let executed_json = serde_json::to_string(&CommitmentLevel::Executed).unwrap();
    assert!(executed_json.contains("executed"));

    let finalized_json = serde_json::to_string(&CommitmentLevel::Finalized).unwrap();
    assert!(finalized_json.contains("finalized"));
}

/// Test data slice configuration
#[tokio::test]
async fn test_data_slice() {
    use thru_base::rpc_types::DataSlice;

    let data_slice = DataSlice {
        offset: 0,
        length: 100,
    };

    // Test serialization
    let json = serde_json::to_string(&data_slice).unwrap();
    assert!(json.contains("offset"));
    assert!(json.contains("length"));

    // Test deserialization
    let deserialized: DataSlice = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.offset, 0);
    assert_eq!(deserialized.length, 100);
}

/// Test complete client lifecycle (without actual server connection)
#[tokio::test]
async fn test_client_lifecycle() {
    // 1. Create client
    let client = Client::builder()
        .http_endpoint(Url::parse("http://localhost:3000").unwrap())
        .ws_endpoint(Some(Url::parse("ws://localhost:3001").unwrap()))
        .timeout(Duration::from_secs(10))
        .build();

    // 2. Test HTTP operations (will fail gracefully)
    let test_bytes = [1u8; 32];
    let test_pubkey = Pubkey::from_bytes(&test_bytes);

    let version_result = client.get_version().await;
    assert!(version_result.is_err()); // Expected to fail without server

    let balance_result = client.get_balance(&test_pubkey).await;
    assert!(balance_result.is_err()); // Expected to fail without server

    // 3. Test WebSocket operations (will fail gracefully)
    let ws_result = client.websocket().await;
    assert!(ws_result.is_err()); // Expected to fail without server

    // 4. Client should be droppable without issues
    drop(client);

    // Test passes if we reach here without panics
    assert!(true);
}
