//! Transaction-related types

use base64::Engine;
use serde::{Deserialize, Deserializer, Serialize};
use thru_base::tn_tools::{Pubkey, Signature};

use crate::types::CommitmentLevel;

/// Transaction details from getTransactionDetailed
#[derive(Debug, Clone, Deserialize)]
pub struct TransactionDetails {
    /// The number of compute units consumed
    pub compute_units_consumed: u64,
    /// The number of events
    pub events_cnt: u32,
    /// The size of the events
    pub events_sz: u32,
    /// The execution result
    pub execution_result: i32,
    /// The number of pages used
    pub pages_used: u32,
    /// The number of state units consumed
    pub state_units_consumed: u64,
    /// The user error code
    pub user_error_code: u64,
    /// The VM error
    pub vm_error: i32,
    /// The signature
    pub signature: Signature,
    /// The read-write accounts
    pub rw_accounts: Vec<Pubkey>,
    /// The read-only accounts
    pub ro_accounts: Vec<Pubkey>,
    /// The slot
    pub slot: u64,
    /// The proof slot
    pub proof_slot: u64,
    /// The events
    pub events: Vec<Event>,
}

/// Custom deserializer for base64-encoded event data
fn deserialize_event_data<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
where
    D: Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    base64::engine::general_purpose::STANDARD
        .decode(&s)
        .map_err(serde::de::Error::custom)
}

/// Custom serializer for base64-encoded event data
fn serialize_event_data<S>(data: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    serializer.serialize_str(&encoded)
}

/// Event data from transaction execution
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    /// The call index
    pub call_idx: u16,
    /// The program index
    pub program_idx: u16,
    /// The event data (automatically decoded from base64)
    #[serde(
        deserialize_with = "deserialize_event_data",
        serialize_with = "serialize_event_data"
    )]
    pub data: Vec<u8>,
}

/// Configuration for sendTransaction
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SendTransactionConfig {
    /// Commitment level for which to subscribe to the signature
    #[serde(
        rename = "signatureNotification",
        skip_serializing_if = "Option::is_none"
    )]
    pub signature_notification: Option<CommitmentLevel>,
}

/// Transaction response from getTransaction
#[derive(Debug, Clone, Deserialize)]
pub struct TransactionResponse {
    /// The transaction data (Base64 encoded)
    pub transaction: String, // Base64 encoded
    /// The slot
    pub slot: Option<u64>,
    /// The block time
    #[serde(rename = "blockTime")]
    pub block_time: Option<i64>,
    /// The meta data
    pub meta: Option<serde_json::Value>,
}

/// Result of sendTransaction via WebSocket
#[derive(Debug, Clone, Deserialize)]
pub struct SendTransactionResult {
    /// The signature of the transaction
    pub signature: Signature,
    /// The subscription id for the signature
    #[serde(rename = "signatureSubscriptionId")]
    pub signature_subscription_id: Option<u64>,
    /// The subscription error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_error: Option<String>,
}

/// Signature status notification
#[derive(Debug, Clone, Deserialize)]
pub struct SignatureNotification {
    /// The context of the notification
    pub context: SignatureNotificationContext,
    /// The signature status information
    pub value: SignatureStatus,
}

/// Signature notification context
#[derive(Debug, Clone, Deserialize)]
pub struct SignatureNotificationContext {
    /// The slot number
    pub slot: u64,
}

/// Signature status from WebSocket notifications
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureStatus {
    /// The confirmation status (commitment level)
    pub confirmation_status: CommitmentLevel,
    /// Error information (null for success)
    pub err: Option<serde_json::Value>,
    /// Transaction execution result (only present for executed transactions)
    pub result: Option<SignatureExecutionResult>,
    /// The signature
    pub signature: Signature,
    /// The slot
    pub slot: u64,
}

/// Transaction execution result for signature notifications
#[derive(Debug, Clone, Deserialize)]
pub struct SignatureExecutionResult {
    /// The number of compute units consumed
    pub compute_units_consumed: u64,
    /// The number of events
    pub events_cnt: u32,
    /// The size of the events
    pub events_sz: u32,
    /// The execution result
    pub execution_result: u64,
    /// The number of pages used
    pub pages_used: u32,
    /// The number of state units consumed
    pub state_units_consumed: u64,
    /// The user error code
    pub user_error_code: u64,
    /// The VM error
    pub vm_error: i32,
}

impl SignatureStatus {
    /// Check if the transaction was successful
    pub fn is_success(&self) -> bool {
        self.err.is_none()
    }

    /// Check if the transaction was executed (has execution result)
    pub fn is_executed(&self) -> bool {
        self.result.is_some()
    }

    /// Check if the transaction was finalized
    pub fn is_finalized(&self) -> bool {
        self.confirmation_status == CommitmentLevel::Finalized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn test_transaction_details_deserialization() {
        let json = r#"{
            "compute_units_consumed": 1000,
            "events_cnt": 2,
            "events_sz": 128,
            "execution_result": 0,
            "pages_used": 5,
            "state_units_consumed": 500,
            "user_error_code": 0,
            "vm_error": 0,
            "signature": "ts111111111111111111111111111111111111111111111111111111111111111111111111111111111111",
            "rw_accounts": ["ta1111111111111111111111111111111111111111111"],
            "ro_accounts": ["ta2222222222222222222222222222222222222222222"],
            "slot": 12345,
            "proof_slot": 12345,
            "events": [
                {
                    "call_idx": 0,
                    "program_idx": 1,
                    "data": "SGVsbG8="
                }
            ]
        }"#;

        let details: TransactionDetails = serde_json::from_str(json).unwrap();
        assert_eq!(details.compute_units_consumed, 1000);
        assert_eq!(details.events.len(), 1);
        // "SGVsbG8=" decodes to "Hello" in binary
        assert_eq!(details.events[0].data, b"Hello");
    }

    #[test]
    fn test_send_transaction_config() {
        let config = SendTransactionConfig {
            signature_notification: Some(CommitmentLevel::Finalized),
        };

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"signatureNotification\":\"finalized\""));
    }

    #[test]
    fn test_signature_notification_deserialization() {
        // Test executed transaction notification
        let executed_json = r#"{
            "context": {"slot": 18},
            "value": {
                "confirmationStatus": "executed",
                "err": null,
                "result": {
                    "compute_units_consumed": 301,
                    "events_cnt": 0,
                    "events_sz": 0,
                    "execution_result": 0,
                    "pages_used": 1,
                    "state_units_consumed": 0,
                    "user_error_code": 0,
                    "vm_error": 0
                },
                "signature": "tsIVVM8N8IvVmVWKOCi07bOPXpN0C325il3F90hfC47RrXq-zwr8x3gA12Asf9kZjYCs2M7NrVoyytI2oz9HFRCyPJ",
                "slot": 18
            }
        }"#;

        let notification: SignatureNotification = serde_json::from_str(executed_json).unwrap();
        assert_eq!(notification.context.slot, 18);
        assert_eq!(notification.value.slot, 18);
        assert_eq!(
            notification.value.confirmation_status,
            CommitmentLevel::Executed
        );
        assert!(notification.value.err.is_none());
        assert!(notification.value.result.is_some());
        assert!(notification.value.is_success());
        assert!(notification.value.is_executed());
        assert!(!notification.value.is_finalized());

        // Test finalized transaction notification (no result field)
        let finalized_json = r#"{
            "context": {"slot": 20},
            "value": {
                "confirmationStatus": "finalized",
                "err": null,
                "signature": "tsIVVM8N8IvVmVWKOCi07bOPXpN0C325il3F90hfC47RrXq-zwr8x3gA12Asf9kZjYCs2M7NrVoyytI2oz9HFRCyPJ",
                "slot": 20
            }
        }"#;

        let notification: SignatureNotification = serde_json::from_str(finalized_json).unwrap();
        assert_eq!(notification.context.slot, 20);
        assert_eq!(notification.value.slot, 20);
        assert_eq!(
            notification.value.confirmation_status,
            CommitmentLevel::Finalized
        );
        assert!(notification.value.err.is_none());
        assert!(notification.value.result.is_none());
        assert!(notification.value.is_success());
        assert!(!notification.value.is_executed());
        assert!(notification.value.is_finalized());
    }
}
