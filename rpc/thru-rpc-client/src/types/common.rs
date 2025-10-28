//! Common types used across the client

use base64::Engine;
use serde::{Deserialize, Deserializer, Serialize};

use crate::{ProgramAccount, types::transaction::Event};
use thru_base::rpc_types::ProgramAccountFilter;

/// Configuration for data slicing in account operations
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataSliceConfig {
    /// The offset to start slicing from
    pub offset: usize,
    /// The length of the slice
    pub length: usize,
}

/// Commitment level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitmentLevel {
    /// Query the most recent block finalized by the chain
    Finalized,
    /// Query the most recent block executed by the chain
    Executed,
}

impl Default for CommitmentLevel {
    fn default() -> Self {
        Self::Finalized
    }
}

/// Response context
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResponseContext {
    /// The slot number
    pub slot: u64,
}

/// Block height information
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockHeight {
    /// The finalized height
    #[serde(rename = "finalized")]
    pub finalized_height: u64,
    /// The executed height
    #[serde(rename = "executed")]
    pub executed_height: u64,
}

/// Version information for the RPC node
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Version {
    /// The Thru RPC version
    #[serde(rename = "thru-rpc")]
    pub thru_rpc: String,
    /// The Thru node version
    #[serde(rename = "thru-node")]
    pub thru_node: String,
}

/// Configuration for block subscriptions (blockRawSubscribe, blockSummarySubscribe)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockSubscriptionConfig {
    /// Filter for accounts mentioned in transactions
    #[serde(rename = "mentionsAccount", skip_serializing_if = "Option::is_none")]
    pub mentions_account: Option<String>,
    /// Filter for blocks produced by specific validator
    #[serde(rename = "blocksProducer", skip_serializing_if = "Option::is_none")]
    pub blocks_producer: Option<String>,
}

/// Configuration for event subscriptions (eventsSubscribe)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventSubscriptionConfig {
    /// Filter for specific transaction signatures
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signatures: Option<Vec<String>>,
    /// Filter for specific programs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub programs: Option<Vec<String>>,
    /// Filter by starting bytes
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "startsWithBytes")]
    pub starts_with_bytes: Option<String>,
}

/// Configuration for program subscriptions (programSubscribe)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgramSubscriptionConfig {
    /// The program ID to subscribe to
    pub program_id: String,
    /// Request a slice of the account's data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_slice: Option<DataSliceConfig>,
    /// Filter results using various filter objects
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filters: Option<Vec<ProgramAccountFilter>>,
}

/// Block raw notification data structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockRawNotification {
    /// Context information
    pub context: ResponseContext,
    /// The block raw value
    pub value: BlockRawValue,
}

/// Block raw value containing the actual block data
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockRawValue {
    /// The raw block data (automatically decoded from base64)
    #[serde(deserialize_with = "deserialize_base64")]
    pub block: Vec<u8>,
    /// Error field (if any)
    pub err: Option<serde_json::Value>,
    /// Slot number
    pub slot: u64,
}

/// Custom deserializer for base64 strings
fn deserialize_base64<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
where
    D: Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    base64::engine::general_purpose::STANDARD
        .decode(&s)
        .map_err(serde::de::Error::custom)
}

/// Block summary notification data structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockSummaryNotification {
    /// Context information
    pub context: ResponseContext,
    /// The block summary value
    pub value: BlockSummaryValue,
}

/// Block summary value containing the actual summary data
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockSummaryValue {
    /// The block summary data
    pub block: BlockSummary,
    /// Error field (if any)
    pub err: Option<serde_json::Value>,
    /// Slot number
    pub slot: u64,
}

/// Block summary data structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockSummary {
    /// The block hash
    #[serde(rename = "blockhash")]
    pub block_hash: String,
    /// The block producer
    pub producer: String,
    /// The block size in bytes
    pub size: u64,
    /// The number of transactions in the block
    pub transactions: u64,
}

/// Event notification data structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventNotification {
    /// Context information
    pub context: ResponseContext,
    /// The event data
    pub value: EventData,
}

/// Event data structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventData {
    /// The signature of the transaction that generated this event
    pub signature: String,
    /// The number of events in this notification
    pub count: u64,
    /// The events array (fully typed with automatic base64 decoding)
    pub events: Vec<Event>,
}

/// Program notification data structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgramNotification {
    /// Context information
    pub context: ResponseContext,
    /// The program account data
    pub value: ProgramAccount,
}

/// Slot notification data structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotNotification {
    /// The finalized slot
    pub finalized: u64,
    /// The executed slot
    pub executed: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn test_event_data_deserialization() {
        // Test JSON structure from the user's example
        let json = r#"{
            "signature": "tsEq9hKwXE4Wf6shGJWbL3141Z3L3XclfsIJT2wdiyGP-k_CApVBhAzSt4MGRozA-2MbNSRGIDkgQrJwD3u7DQCh8p",
            "count": 1,
            "events": [
                {
                    "call_idx": 0,
                    "data": "AQAAAAAAAABGaWx0ZXIgdGVzdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    "program_idx": 1
                }
            ]
        }"#;

        let event_data: EventData = serde_json::from_str(json).unwrap();

        // Verify basic fields
        assert_eq!(
            event_data.signature,
            "tsEq9hKwXE4Wf6shGJWbL3141Z3L3XclfsIJT2wdiyGP-k_CApVBhAzSt4MGRozA-2MbNSRGIDkgQrJwD3u7DQCh8p"
        );
        assert_eq!(event_data.count, 1);
        assert_eq!(event_data.events.len(), 1);

        // Verify the event is fully typed
        let event = &event_data.events[0];
        assert_eq!(event.call_idx, 0);
        assert_eq!(event.program_idx, 1);

        // Verify the data field is automatically decoded from base64
        // The base64 string should decode to binary data starting with [1, 0, 0, 0, 0, 0, 0, 0]
        // followed by "Filter test" and padding
        assert_eq!(event.data[0], 1);
        assert_eq!(event.data[1], 0);
        assert_eq!(event.data[2], 0);
        assert_eq!(event.data[3], 0);
        assert_eq!(event.data[4], 0);
        assert_eq!(event.data[5], 0);
        assert_eq!(event.data[6], 0);
        assert_eq!(event.data[7], 0);

        // Verify "Filter test" string is contained in the decoded data
        let filter_test_bytes = b"Filter test";
        assert!(
            event
                .data
                .windows(filter_test_bytes.len())
                .any(|window| window == filter_test_bytes)
        );
    }

    #[test]
    fn test_event_data_roundtrip_serialization() {
        // Test that EventData can be serialized and deserialized correctly
        let original_event_data = EventData {
            signature: "test_signature".to_string(),
            count: 2,
            events: vec![
                Event {
                    call_idx: 0,
                    program_idx: 1,
                    data: b"Hello".to_vec(),
                },
                Event {
                    call_idx: 1,
                    program_idx: 2,
                    data: b"World".to_vec(),
                },
            ],
        };

        // Serialize to JSON
        let serialized = serde_json::to_string(&original_event_data).unwrap();

        // Deserialize back
        let deserialized: EventData = serde_json::from_str(&serialized).unwrap();

        // Verify they match
        assert_eq!(original_event_data, deserialized);

        // Verify the data fields are base64 encoded in the JSON
        assert!(serialized.contains("SGVsbG8=")); // "Hello" in base64
        assert!(serialized.contains("V29ybGQ=")); // "World" in base64
    }
}
