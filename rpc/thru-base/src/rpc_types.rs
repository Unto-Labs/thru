use serde::{Deserialize, Serialize};

/// Data slice configuration for account queries
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataSlice {
    /// Offset from start of account data
    pub offset: usize,
    /// Number of bytes to return
    pub length: usize,
}

/// Filter types for getProgramAccounts
#[derive(Debug, Serialize, Eq, Deserialize, Clone, PartialEq)]
#[serde(untagged)]
pub enum ProgramAccountFilter {
    /// Filter by account data size
    DataSize {
        #[serde(rename = "dataSize")]
        /// data size
        data_size: u64,
    },
    /// Filter by memory comparison
    Memcmp {
        /// memory comparison filter
        memcmp: MemcmpFilter,
    },
}

/// Memory comparison filter
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct MemcmpFilter {
    /// Offset in the account data
    pub offset: usize,
    /// Base64-encoded bytes to match
    pub bytes: String,
}

/// Configuration for getProgramAccounts operations
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GetProgramAccountsConfig {
    /// Whether to skip data
    #[serde(rename = "skipData", skip_serializing_if = "Option::is_none")]
    pub skip_data: Option<bool>,
    /// The data slice
    #[serde(rename = "dataSlice", skip_serializing_if = "Option::is_none")]
    pub data_slice: Option<DataSlice>,
    /// Filters to apply
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filters: Option<Vec<ProgramAccountFilter>>,
}

/// Proof type for makeStateProof operations
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProofType {
    /// Create a state proof for a new account
    Creating,
    /// Create a state proof for an account update
    Updating,
    /// Create a state proof for account uncompression
    Existing,
}

/// Configuration for makeStateProof operations
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MakeStateProofConfig {
    /// Type of proof to create
    pub proof_type: ProofType,
    /// Optional slot to create the proof for
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<u64>,
}
